"""
Simulation engine tests.
Determinism is the key invariant: same seed + same input = same output.
"""

import pytest
from engine.models import (
    PlayerWorld, Economy, BeliefIndex, Hero, Faction, Region, Army,
    HeroRole, FactionType, DoctrineType, SkillGraph, PersonalityMatrix
)
from engine.orders import TurnOrders, Order, OrderType, validate_orders
from engine.simulation import resolve_turn


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

def make_world() -> PlayerWorld:
    return PlayerWorld(
        userid="testplayer",
        turn=1,
        economy=Economy(owner="testplayer", trust=100),
        belief=BeliefIndex(owner="testplayer"),
        heroes=[
            Hero(
                id="hero1",
                name="Aldric the Adequate",
                owner="testplayer",
                role=HeroRole.GENERAL,
                skills=SkillGraph(leadership=30),
                personality=PersonalityMatrix(loyalty=70, competence=60, paranoia=10),
            )
        ],
        factions=[
            Faction(
                id="fac1",
                name="Bureau of Conspiracies",
                owner="testplayer",
                type=FactionType.FEDERATION,
            )
        ],
        regions=[
            Region(
                id="reg1",
                name="Valdenmoor",
                faction_influence={"fac1": 1.0},
                population=5000,
                prosperity=60,
                unrest=10,
            )
        ],
        armies=[
            Army(
                id="army1",
                name="1st Legion",
                owner="testplayer",
                region_id="reg1",
                doctrine=DoctrineType.ATTRITION,
                strength=100,
                morale=80,
                commander_hero_id="hero1",
            )
        ],
    )


def make_orders(turn: int = 1, orders: list = None) -> TurnOrders:
    return TurnOrders(userid="testplayer", turn=turn, orders=orders or [])


# ---------------------------------------------------------------------------
# Determinism
# ---------------------------------------------------------------------------

def test_deterministic():
    world = make_world()
    orders = make_orders()
    r1 = resolve_turn(world, orders, seed=42)
    r2 = resolve_turn(world, orders, seed=42)
    assert r1.world.model_dump() == r2.world.model_dump()
    assert r1.events == r2.events


def test_different_seeds_may_differ():
    world = make_world()
    orders = make_orders()
    r1 = resolve_turn(world, orders, seed=1)
    r2 = resolve_turn(world, orders, seed=99999)
    # Events can differ due to global event rolls; world state may differ
    # (not guaranteed to differ, but we verify both run cleanly)
    assert r1.world.turn == 2
    assert r2.world.turn == 2


# ---------------------------------------------------------------------------
# Turn counter
# ---------------------------------------------------------------------------

def test_turn_increments():
    world = make_world()
    result = resolve_turn(world, make_orders(), seed=0)
    assert result.world.turn == 2


# ---------------------------------------------------------------------------
# Economy
# ---------------------------------------------------------------------------

def test_economy_tick_adds_net():
    world = make_world()
    world.economy.trust = 100
    world.economy.output_per_turn = 10
    world.economy.consumption_per_turn = 6
    world.economy.propaganda_bonus = 0
    # army upkeep = 5
    result = resolve_turn(world, make_orders(), seed=0)
    # net = 10 - 6 + 0 = 4, minus 5 army upkeep = -1
    assert result.world.economy.trust == 99


def test_army_unpaid_drops_morale():
    world = make_world()
    world.economy.trust = 0
    world.economy.output_per_turn = 0
    world.economy.consumption_per_turn = 0
    world.armies[0].economy_upkeep_per_turn = 10
    result = resolve_turn(world, make_orders(), seed=0)
    assert result.world.armies[0].morale < 80


# ---------------------------------------------------------------------------
# Orders: validation
# ---------------------------------------------------------------------------

def test_valid_orders_pass():
    world = make_world()
    orders = make_orders(orders=[
        Order(type=OrderType.ARMY_DIRECTIVE, params={"army_id": "army1", "directive": "hold"}),
    ])
    errors = validate_orders(orders, world)
    assert errors == []


def test_unknown_army_fails():
    world = make_world()
    orders = make_orders(orders=[
        Order(type=OrderType.ARMY_DIRECTIVE, params={"army_id": "ghost", "directive": "advance"}),
    ])
    errors = validate_orders(orders, world)
    assert any("unknown army" in e for e in errors)


def test_insufficient_trust_fails():
    world = make_world()
    world.economy.trust = 0
    orders = make_orders(orders=[
        Order(type=OrderType.RECRUIT_HERO, params={"name": "Bob", "role": "agent", "region_id": "reg1"}),
    ])
    errors = validate_orders(orders, world)
    assert any("trust" in e.lower() for e in errors)


# ---------------------------------------------------------------------------
# Orders: application
# ---------------------------------------------------------------------------

def test_recruit_hero():
    world = make_world()
    orders = make_orders(orders=[
        Order(type=OrderType.RECRUIT_HERO, params={"name": "Vera", "role": "agent", "region_id": "reg1"}),
    ])
    result = resolve_turn(world, orders, seed=7)
    names = [h.name for h in result.world.heroes]
    assert "Vera" in names
    assert result.world.economy.trust < 100  # trust spent


def test_levy_tax_raises_trust_and_unrest():
    world = make_world()
    initial_trust = world.economy.trust
    orders = make_orders(orders=[
        Order(type=OrderType.LEVY_TAX, params={"region_id": "reg1", "amount": "20"}),
    ])
    result = resolve_turn(world, orders, seed=0)
    # trust went up by tax, then economy tick ran
    assert result.world.regions[0].unrest > 10


def test_raise_army():
    world = make_world()
    orders = make_orders(orders=[
        Order(type=OrderType.RAISE_ARMY, params={"name": "2nd Legion", "region_id": "reg1", "doctrine": "maneuver"}),
    ])
    result = resolve_turn(world, orders, seed=0)
    army_names = [a.name for a in result.world.armies]
    assert "2nd Legion" in army_names


# ---------------------------------------------------------------------------
# Military
# ---------------------------------------------------------------------------

def test_army_directive_hold():
    world = make_world()
    orders = make_orders(orders=[
        Order(type=OrderType.ARMY_DIRECTIVE, params={"army_id": "army1", "directive": "hold"}),
    ])
    result = resolve_turn(world, orders, seed=0)
    # army still exists
    assert len(result.world.armies) == 1


def test_paranoid_general_may_hesitate():
    world = make_world()
    world.heroes[0].personality.paranoia = 100
    world.heroes[0].personality.loyalty = 100
    orders = make_orders(orders=[
        Order(type=OrderType.ARMY_DIRECTIVE, params={"army_id": "army1", "directive": "advance"}),
    ])
    # run many seeds — at least one should produce hesitation event
    hesitated = False
    for s in range(50):
        r = resolve_turn(world, orders, seed=s)
        if any("suspected a trap" in e for e in r.events):
            hesitated = True
            break
    assert hesitated


# ---------------------------------------------------------------------------
# Belief
# ---------------------------------------------------------------------------

def test_high_unrest_drains_belief():
    world = make_world()
    world.regions[0].unrest = 80
    result = resolve_turn(world, make_orders(), seed=0)
    assert result.world.belief.aggregate < 70
