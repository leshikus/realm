# Hero Role-Playing System

Heroes are procedural agents — unstable accumulations of ambition, context-appropriate skill, and mounting personality problems. They are the Heroic control layer through which the player acts on the world directly.

---

## Design Principles

- **No probability.** Mission outcomes are deterministic. A hero always completes an assigned mission. Skill level determines how long it takes and how good the result is — not whether it succeeds.
- **Failure comes from traits, not dice.** A hero doesn't fail because of a bad roll. A hero produces a degraded outcome because they have developed "Strategically Overcautious" after three military setbacks, and that trait adds two turns and reduces the mission's quality modifier.
- **Skills grow through use.** A hero sent on infiltration missions becomes a better infiltrator. There is no experience bar — skill levels are incremented by the engine when a mission completes, based on the mission type.
- **Personality mutates through consequence.** Traits are acquired when a mission produces a notable secondary outcome — repeated stress, repeated success, repeated exposure to a particular faction or environment. A hero is shaped by what they are asked to do.

---

## Data Structure

```json
{
  "turn": 38,
  "id": "agent_77",
  "name": "Inquisitor Voss",
  "faction": "bureau_of_conspiracies",
  "origin": "syndicate_of_flesh",
  "status": "active",
  "assignment": null,
  "assignment_started_turn": null,
  "fatigue": 2,
  "skill_graph": {
    "infiltration": 6,
    "bureaucracy": 8,
    "negotiation": 3,
    "propaganda": 4,
    "research": 2,
    "combat_command": 1,
    "logistics": 5
  },
  "personality_matrix": [
    { "trait": "efficient",            "acquired_turn": 3,  "source": "initial_posting" },
    { "trait": "paranoid",             "acquired_turn": 22, "source": "repeated_infiltration" },
    { "trait": "averse_to_paperwork",  "acquired_turn": 31, "source": "ministry_of_forms_assignment" }
  ]
}
```

Fields:
- `fatigue` — accumulated across consecutive assignments without rest; increases mission duration
- `assignment` — current mission ID if assigned, `null` if idle
- `origin` — which source produced this hero; Syndicate heroes have configurable initial trait loadouts

---

## Skill Graph

Seven skills cover all mission types. Each is an integer from 0 to 10.

| Skill | Mission types | What it governs |
|---|---|---|
| `infiltration` | Espionage, sabotage, assassination | Reach targets without leaving traces |
| `bureaucracy` | Administrative missions, decree execution, reform | Navigate the Dominion's own systems |
| `negotiation` | Diplomacy, treaties, recruitment, defection | Reach agreements with other parties |
| `propaganda` | Belief manipulation, public campaigns, cult suppression | Shape what populations believe |
| `research` | Technology, forgotten tech, Underworld knowledge | Generate and interpret information |
| `combat_command` | Military operations, garrison command, siege | Direct military assets |
| `logistics` | Construction, supply chains, infrastructure management | Move and transform physical resources |

### Skill growth

After each completed mission, the engine increments the relevant skill:

```python
SKILL_GROWTH = {
    "infiltration_mission":   {"infiltration": 1},
    "diplomatic_mission":     {"negotiation": 1},
    "administrative_mission": {"bureaucracy": 1},
    "propaganda_campaign":    {"propaganda": 1},
    "research_mission":       {"research": 1},
    "military_operation":     {"combat_command": 1},
    "construction_mission":   {"logistics": 1},
}

SECONDARY_GROWTH = {
    # Repeated infiltration work also builds paranoia (handled via Personality Matrix)
    "infiltration_mission":   {"paranoid": 1},        # accumulated stress counter
    "administrative_mission": {"averse_to_paperwork": 1},
    "propaganda_campaign":    {"ideologically_flexible": 1},
}
```

Secondary growth feeds the Personality Matrix accumulator (see below), not the skill graph directly.

---

## Mission Outcomes: Duration and Quality

Missions have no success/failure roll. They always complete. The two outcome variables are:

**Duration** — how many turns until the mission resolves. Lower skill means more turns.

```python
BASE_DURATION = {
    "infiltration_mission":   4,
    "diplomatic_mission":     3,
    "administrative_mission": 2,
    "propaganda_campaign":    5,
    "research_mission":       6,
    "military_operation":     4,
    "construction_mission":   5,
}

def mission_duration(hero: dict, mission_type: str) -> int:
    skill   = hero["skill_graph"].get(MISSION_SKILL[mission_type], 0)
    base    = BASE_DURATION[mission_type]
    fatigue = hero["fatigue"]

    # Skill reduces duration: skill 0 = full base; skill 10 = half base (rounded up)
    skill_reduction = skill // 2
    duration = max(1, base - skill_reduction + fatigue)

    # Trait modifiers (additive, deterministic)
    for entry in hero["personality_matrix"]:
        delta = TRAIT_DURATION_MOD.get(mission_type, {}).get(entry["trait"], 0)
        duration += delta

    return duration
```

**Quality** — a multiplier (0.5–1.0) applied to the mission's effect magnitude. Low skill produces a weaker result.

```python
def mission_quality(hero: dict, mission_type: str) -> float:
    skill   = hero["skill_graph"].get(MISSION_SKILL[mission_type], 0)

    # skill 0 → quality 0.5; skill 10 → quality 1.0
    quality = 0.5 + (skill / 20.0)

    for entry in hero["personality_matrix"]:
        mult = TRAIT_QUALITY_MULT.get(mission_type, {}).get(entry["trait"], 1.0)
        quality *= mult

    return round(min(1.0, max(0.1, quality)), 2)
```

Quality affects the magnitude of effects, not their type. A propaganda campaign at quality 0.6 shifts Belief by 60% of the listed amount. The same campaign at quality 1.0 delivers the full shift.

### Example

Inquisitor Voss (`infiltration: 6`, traits: `paranoid`) assigned to an infiltration mission:

```
base duration:   4 turns
skill reduction: 6 // 2 = 3
fatigue penalty: +2
paranoid trait (infiltration): +1 duration, ×0.85 quality

duration = 4 - 3 + 2 + 1 = 4 turns
quality  = (0.5 + 6/20) × 0.85 = 0.80 × 0.85 = 0.68
```

The mission takes 4 turns and delivers 68% of the listed effect. Voss gets the job done; it is just a bit messy and takes longer than it should, because she keeps checking whether she's being followed.

---

## Personality Matrix

Traits are not assigned at character creation (except for Syndicate-origin heroes, who have configurable initial loadouts). They accumulate during play.

### Acquisition

A trait is acquired when its accumulator crosses a threshold. Accumulators are incremented by the secondary growth table above and by specific event outcomes.

```python
TRAIT_THRESHOLDS = {
    "paranoid":               5,   # 5 infiltration missions completed
    "averse_to_paperwork":    4,
    "ideologically_flexible": 6,
    "battle_hardened":        4,
    "efficient":              3,   # 3 missions completed ahead of base duration
    "strategically_overcautious": 2,  # 2 military operations with quality < 0.7
    "burned_out":             3,   # 3 consecutive assignments without rest
}
```

When the threshold is crossed, the trait is appended to `personality_matrix` and the accumulator resets. The same trait can be acquired twice (compounding its effect) if conditions repeat.

### Trait effects

Each trait entry specifies duration modifiers and quality multipliers per mission type.

```python
TRAIT_DURATION_MOD = {
    "infiltration_mission": {
        "paranoid":               +1,
        "efficient":              -1,
        "burned_out":             +2,
    },
    "military_operation": {
        "strategically_overcautious": +2,
        "battle_hardened":            -1,
        "burned_out":                 +1,
    },
    "administrative_mission": {
        "averse_to_paperwork":    +2,
        "efficient":              -1,
    },
    "diplomatic_mission": {
        "ideologically_flexible": -1,
    },
}

TRAIT_QUALITY_MULT = {
    "infiltration_mission": {
        "paranoid":               0.85,   # leaves traces; mission is slightly compromised
        "efficient":              1.10,
    },
    "military_operation": {
        "strategically_overcautious": 0.75,
        "battle_hardened":            1.15,
    },
    "propaganda_campaign": {
        "ideologically_flexible": 1.10,   # comfortable with any message
        "burned_out":             0.70,
    },
    "administrative_mission": {
        "averse_to_paperwork":    0.80,
        "efficient":              1.10,
    },
}
```

### Notable traits

| Trait | How acquired | Duration effect | Quality effect |
|---|---|---|---|
| `efficient` | 3 missions completed under base duration | −1 on matching type | ×1.10 |
| `paranoid` | 5 infiltration missions | +1 infiltration | ×0.85 infiltration |
| `strategically_overcautious` | 2 military ops with quality < 0.7 | +2 military | ×0.75 military |
| `battle_hardened` | 4 military operations | −1 military | ×1.15 military |
| `ideologically_flexible` | 6 propaganda campaigns | −1 diplomatic | ×1.10 propaganda |
| `averse_to_paperwork` | 4 administrative missions | +2 administrative | ×0.80 administrative |
| `burned_out` | 3 consecutive assignments without rest | +1–2 all types | ×0.70 matching type |
| `ministry_favourite` | Assigned by Bureau of Conspiracies 3+ times | — | ×1.05 administrative |
| `marked_by_shadow_guilds` | Survived an assassination event | — | −0.15 infiltration (Guild agents shadow them) |

Traits are permanent unless removed by a specific event (recovery, reassignment, defection). Trait removal is itself a mission type (`rehabilitation_assignment`).

---

## Fatigue

Fatigue accumulates across consecutive assignments and decays during idle turns.

```python
def update_fatigue(hero: dict, assigned: bool) -> int:
    if assigned:
        return min(5, hero["fatigue"] + 1)
    else:
        return max(0, hero["fatigue"] - 1)   # one idle turn reduces fatigue by 1
```

A hero at fatigue 5 is adding 5 turns to every mission duration. Resting them for five idle turns resets this to zero. Players who never rest their heroes will find them performing at a structural disadvantage long before any trait kicks in.

---

## Assignment & Resolution

Heroes are assigned via the orders JSON:

```json
{
  "type": "hero",
  "hero_id": "agent_77",
  "mission": "infiltration_mission",
  "target": { "faction": "shadow_guilds", "objective": "identify_operatives" }
}
```

The engine records the assignment on turn N. On turn N + `duration`, the mission resolves: effects are applied at `quality` magnitude, skill growth is applied, secondary accumulator is incremented, fatigue increases.

The player cannot cancel a mission mid-execution. The hero is committed.

---

## Syndicate of Flesh: Hero Procurement

New heroes are sourced from the Syndicate of Flesh. Syndicate heroes come with:

- A configurable initial skill distribution (the player specifies a specialisation; the Syndicate delivers within range)
- A configurable initial trait loadout (trauma backstories produce specific starting traits)
- A trust cost and a delivery delay (heroes are not instant)

```json
{
  "type": "syndicate_order",
  "specialisation": "infiltration",
  "requested_traits": ["efficient"],
  "forbidden_traits": ["burned_out", "coward"],
  "delivery_turn": 48,
  "cost_trust": 40
}
```

The Syndicate fulfils the order within constraints but makes no guarantees about traits that develop after delivery. What happens to the hero after procurement is the player's problem.

---

## Hero Loss

Heroes can be removed from play by:

- **Assignment to the Shadow Guilds' attention** — they become `marked_by_shadow_guilds`, then on a subsequent mission they are intercepted. The mission still completes (a lower quality result is committed), but the hero's status becomes `compromised`, then `missing` after one more assignment.
- **Loyalty collapse** — a hero whose faction loses enough Trust and whose personal loyalty accumulator crosses a threshold will defect. Their skills now work against the player.
- **Burned out past recovery** — fatigue 5 + `burned_out` trait + a third consecutive assignment triggers a breakdown event. The hero is removed from active roster; they can be recovered via `rehabilitation_assignment` (costs turns and influence) or lost entirely.

There is no death roll. Loss is structural — the result of how the player used the hero over many turns, not a single bad moment.
