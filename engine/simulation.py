"""
Core turn resolution engine.
Stateless: given PlayerWorld + TurnOrders, returns updated PlayerWorld + event log entries.
Deterministic given the same seed.
"""

from __future__ import annotations
import random
import uuid
from dataclasses import dataclass, field

from .models import (
    PlayerWorld, Hero, Army, HeroRole, SkillGraph, PersonalityMatrix, DoctrineType
)
from .orders import TurnOrders, OrderType


@dataclass
class ResolutionResult:
    world: PlayerWorld
    events: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)


def resolve_turn(world: PlayerWorld, orders: TurnOrders, seed: int | None = None) -> ResolutionResult:
    rng = random.Random(seed)
    result = ResolutionResult(world=world.model_copy(deep=True))
    w = result.world

    # 1. Apply player orders
    _apply_orders(w, orders, result, rng)

    # 2. Economy tick
    _tick_economy(w, result)

    # 3. Belief tick
    _tick_belief(w, result)

    # 4. Faction AI tick
    _tick_factions(w, result, rng)

    # 5. Hero mutation tick
    _tick_heroes(w, result, rng)

    # 6. Army upkeep tick
    _tick_armies(w, result)

    # 7. Global event roll
    _roll_global_events(w, result, rng)

    # 8. Advance turn counter
    w.turn += 1

    return result


# ---------------------------------------------------------------------------
# Order application
# ---------------------------------------------------------------------------

def _apply_orders(w: PlayerWorld, orders: TurnOrders, result: ResolutionResult, rng: random.Random) -> None:
    for order in orders.orders:
        p = order.params

        if order.type == OrderType.SET_PROPAGANDA:
            faction = _get_faction(w, p["faction_id"])
            if faction:
                old = w.economy.propaganda_bonus
                w.economy.propaganda_bonus = int(p["value"])
                result.events.append(
                    f"The propaganda ministry recalibrated messaging for {faction.name}. "
                    f"Bonus shifted from {old} to {p['value']}."
                )

        elif order.type == OrderType.LEVY_TAX:
            region = _get_region(w, p["region_id"])
            amount = int(p["amount"])
            if region:
                w.economy.trust += amount
                region.unrest = min(100, region.unrest + max(5, amount // 2))
                result.events.append(
                    f"Tax levied on {region.name}. Treasury gained {amount} trust. "
                    f"Unrest now {region.unrest}."
                )

        elif order.type == OrderType.RECRUIT_HERO:
            hero = Hero(
                id=str(uuid.uuid4())[:8],
                name=p["name"],
                owner=w.userid,
                role=HeroRole(p["role"]),
                region_id=p["region_id"],
                turn_created=w.turn,
                skills=SkillGraph(),
                personality=PersonalityMatrix(
                    loyalty=rng.randint(30, 80),
                    competence=rng.randint(20, 80),
                    ambition=rng.randint(20, 70),
                    paranoia=rng.randint(0, 30),
                ),
            )
            w.heroes.append(hero)
            w.economy.trust -= 20
            result.events.append(
                f"A new {hero.role} named {hero.name} emerged from the Bureau's "
                f"recruitment program. Loyalty: {hero.personality.loyalty}. "
                f"Competence: {hero.personality.competence}."
            )

        elif order.type == OrderType.ASSIGN_HERO:
            hero = _get_hero(w, p["hero_id"])
            if hero:
                hero.region_id = p["target_id"]
                result.events.append(
                    f"{hero.name} was reassigned to {p['target_id']}."
                )

        elif order.type == OrderType.RAISE_ARMY:
            army = Army(
                id=str(uuid.uuid4())[:8],
                name=p["name"],
                owner=w.userid,
                region_id=p["region_id"],
                doctrine=DoctrineType(p["doctrine"]),
                strength=100,
                morale=80,
            )
            w.armies.append(army)
            w.economy.trust -= 30
            result.events.append(
                f"The {army.name} was raised in {army.region_id} "
                f"under {army.doctrine} doctrine."
            )

        elif order.type == OrderType.ARMY_DIRECTIVE:
            army = _get_army(w, p["army_id"])
            if army:
                _execute_directive(w, army, p["directive"], result, rng)


# ---------------------------------------------------------------------------
# Military directive resolution
# ---------------------------------------------------------------------------

def _execute_directive(
    w: PlayerWorld,
    army: Army,
    directive: str,
    result: ResolutionResult,
    rng: random.Random,
) -> None:
    commander = _get_hero(w, army.commander_hero_id) if army.commander_hero_id else None
    competence = commander.personality.competence if commander else 40
    paranoia = commander.personality.paranoia if commander else 0
    loyalty = commander.personality.loyalty if commander else 50

    # loyalty affects how faithfully the directive is followed
    faithfulness = loyalty + rng.randint(-10, 10)
    # paranoia causes hesitation
    hesitation = paranoia > 60 and rng.random() < 0.4

    if hesitation:
        result.events.append(
            f"{army.name} received directive '{directive}' but {commander.name} "
            f"suspected a trap and delayed execution."
        )
        army.morale = max(0, army.morale - 5)
        return

    # base success probability from competence + army strength
    base_success = (competence + army.strength // 2) / 150
    success = rng.random() < base_success

    if directive == "advance":
        if success:
            army.morale = min(100, army.morale + 5)
            result.events.append(
                f"{army.name} advanced successfully. "
                f"Morale rose to {army.morale}."
            )
        else:
            army.strength = max(0, army.strength - rng.randint(5, 20))
            army.morale = max(0, army.morale - rng.randint(5, 15))
            result.events.append(
                f"{army.name} attempted to advance but faltered. "
                f"Strength: {army.strength}, Morale: {army.morale}."
            )

    elif directive == "hold":
        result.events.append(
            f"{army.name} held their position. "
            f"{'Discipline held.' if faithfulness > 50 else 'Some desertions reported.'}"
        )
        if faithfulness <= 50:
            army.strength = max(0, army.strength - rng.randint(1, 5))

    elif directive == "raid":
        if success:
            loot = rng.randint(5, 20)
            w.economy.trust += loot
            result.events.append(
                f"{army.name} raided and secured {loot} trust in plunder."
            )
        else:
            army.morale = max(0, army.morale - rng.randint(5, 20))
            result.events.append(
                f"{army.name}'s raid failed. Morale dropped to {army.morale}."
            )

    elif directive == "encircle":
        result.events.append(
            f"{army.name} attempted encirclement. "
            f"{'The maneuver was textbook.' if success else 'The maneuver was described as optimistic.'}"
        )


# ---------------------------------------------------------------------------
# Economy tick
# ---------------------------------------------------------------------------

def _tick_economy(w: PlayerWorld, result: ResolutionResult) -> None:
    net = w.economy.output_per_turn - w.economy.consumption_per_turn + w.economy.propaganda_bonus
    # army upkeep is deducted separately in _tick_armies
    w.economy.trust = max(0, w.economy.trust + net)
    result.events.append(
        f"Economy: +{w.economy.output_per_turn} output, "
        f"-{w.economy.consumption_per_turn} consumption, "
        f"+{w.economy.propaganda_bonus} propaganda. "
        f"Trust now {w.economy.trust}."
    )


# ---------------------------------------------------------------------------
# Belief tick
# ---------------------------------------------------------------------------

def _tick_belief(w: PlayerWorld, result: ResolutionResult) -> None:
    # unrest in regions drains belief
    total_unrest = sum(r.unrest for r in w.regions)
    avg_unrest = total_unrest // max(1, len(w.regions))
    drain = avg_unrest // 10

    for domain in ("agriculture", "military", "governance"):
        current = getattr(w.belief, domain)
        setattr(w.belief, domain, max(0, current - drain))

    w.belief.aggregate = (
        w.belief.agriculture + w.belief.military + w.belief.governance
    ) // 3

    if drain > 0:
        result.events.append(
            f"Unrest ({avg_unrest} avg) eroded belief by {drain}. "
            f"Aggregate belief: {w.belief.aggregate}."
        )


# ---------------------------------------------------------------------------
# Faction AI tick
# ---------------------------------------------------------------------------

def _tick_factions(w: PlayerWorld, result: ResolutionResult, rng: random.Random) -> None:
    for faction in w.factions:
        # crime rises when economy is weak
        if w.economy.trust < 50:
            faction.crime = min(100, faction.crime + rng.randint(0, 3))
        else:
            faction.crime = max(0, faction.crime - rng.randint(0, 2))

        # ideology stability tracks belief aggregate
        delta = (w.belief.aggregate - faction.ideology_stability) // 10
        faction.ideology_stability = max(0, min(100, faction.ideology_stability + delta))

        if faction.crime > 70:
            result.events.append(
                f"Crime in {faction.name} has reached {faction.crime}. "
                f"Citizens are filing formal complaints."
            )


# ---------------------------------------------------------------------------
# Hero mutation tick
# ---------------------------------------------------------------------------

def _tick_heroes(w: PlayerWorld, result: ResolutionResult, rng: random.Random) -> None:
    for hero in w.heroes:
        if not hero.alive:
            continue
        # small random skill growth
        skill = rng.choice(["combat", "diplomacy", "espionage", "scholarship", "leadership"])
        current = getattr(hero.skills, skill)
        setattr(hero.skills, skill, current + rng.randint(0, 1))

        # paranoia can creep up
        if rng.random() < 0.05:
            hero.personality.paranoia = min(100, hero.personality.paranoia + 1)

        # heroes with high ambition and low loyalty may develop vices
        if hero.personality.ambition > 70 and hero.personality.loyalty < 40:
            if rng.random() < 0.1 and "Excessive Audit Enthusiasm" not in hero.personality.vices:
                hero.personality.vices.append("Excessive Audit Enthusiasm")
                result.events.append(
                    f"{hero.name} has developed a new vice: Excessive Audit Enthusiasm."
                )


# ---------------------------------------------------------------------------
# Army upkeep tick
# ---------------------------------------------------------------------------

def _tick_armies(w: PlayerWorld, result: ResolutionResult) -> None:
    for army in w.armies:
        if army.strength == 0:
            continue
        upkeep = army.economy_upkeep_per_turn
        if w.economy.trust >= upkeep:
            w.economy.trust -= upkeep
        else:
            # can't pay upkeep — morale drops
            army.morale = max(0, army.morale - 10)
            result.events.append(
                f"{army.name} went unpaid. Morale dropped to {army.morale}."
            )


# ---------------------------------------------------------------------------
# Global event roll
# ---------------------------------------------------------------------------

_GLOBAL_EVENTS = [
    ("A god filed for bankruptcy. Several miracles are now on hold.", lambda w: None),
    ("A utopia emerged in the eastern provinces. Later reclassified as tax fraud.", lambda w: None),
    ("A civil war erupted over a comma in a sacred text.", lambda w: setattr(w.belief, "governance", max(0, w.belief.governance - 5))),
    ("The Bureau of Conspiracies approved three contradictory edicts simultaneously.", lambda w: None),
    ("A prominent hero forgot what they were saving everyone from.", lambda w: None),
    ("Harvest yields shifted due to a collective crisis of agricultural faith.", lambda w: setattr(w.belief, "agriculture", max(0, w.belief.agriculture - 8))),
]

def _roll_global_events(w: PlayerWorld, result: ResolutionResult, rng: random.Random) -> None:
    # roughly 1-in-5 chance of a global event per turn
    if rng.random() < 0.2:
        text, effect = rng.choice(_GLOBAL_EVENTS)
        effect(w)
        result.events.append(f"[WORLD EVENT] {text}")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _get_faction(w, fid): return next((f for f in w.factions if f.id == fid), None)
def _get_region(w, rid):  return next((r for r in w.regions  if r.id == rid), None)
def _get_hero(w, hid):    return next((h for h in w.heroes   if h.id == hid), None)
def _get_army(w, aid):    return next((a for a in w.armies   if a.id == aid), None)
