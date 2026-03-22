# Regional Missions & Policies System

---

## 1. Overview

Missions and policies are the primary mechanism through which a Dominion pursues long-term strategic goals.

**Missions** are structured objectives on a directed graph — complete them to unlock new capabilities, policies, and narrative branches. Inspired by EU4 mission trees.

**Policies** are timed executive decrees that apply modifiers, consume resources, and trigger events while active. Inspired by HoI4 national focuses.

Both are defined in JSON, stored in the player's fork, evaluated by the Python simulation engine each turn, and rendered in the browser client.

---

## 2. Data Schemas

### 2.1 Mission

```json
{
  "id": "industrialize_heartland",
  "name": "Industrialize the Heartland",
  "description": "Coerce the population into productive labour through a combination of incentives and paperwork.",
  "category": "economy",
  "requires": {
    "missions_completed": ["survey_resources"],
    "region_infrastructure": 5,
    "trust": 30
  },
  "visibility": {
    "min_turn": 3
  },
  "rewards": {
    "modifiers": [{"production_output": 0.10}],
    "unlocks_policies": ["industrialization_drive"],
    "events": ["great_works_of_bureaucracy"]
  },
  "ai_weight": 80,
  "narrative_hint": "A dusty ministry report declares the region 'theoretically productive'."
}
```

**Field reference:**

| Field | Type | Description |
|---|---|---|
| `id` | string | Unique identifier; referenced by other missions and the engine |
| `category` | enum | `economy`, `military`, `diplomacy`, `expansion`, `internal`, `space` |
| `requires` | object | All conditions must be true on the turn the player claims the mission |
| `visibility` | object | Conditions under which the mission node is shown in the UI |
| `rewards` | object | Applied immediately on claim; multiple reward types can coexist |
| `ai_weight` | int | 0–100; how strongly AI factions prioritise this mission |
| `narrative_hint` | string | Passed to the LLM as flavour context when generating the claim event |

### 2.2 Policy

```json
{
  "id": "industrialization_drive",
  "name": "Industrialization Drive",
  "description": "Mandate factory quotas. Morale is optional.",
  "category": "economy",
  "duration_turns": 6,
  "cooldown_turns": 4,
  "cost": {"influence": 20, "trust": 10},
  "requires": {
    "missions_completed": ["industrialize_heartland"]
  },
  "effects": {
    "while_active": [
      {"production_output": 0.20},
      {"unrest": 5},
      {"belief": -0.05}
    ],
    "on_complete": [
      {"infrastructure": 2}
    ],
    "on_cancel": [
      {"stability": -10}
    ]
  },
  "events": {
    "mid_execution": ["factory_collapse_maybe", "labour_uprising_check"],
    "on_complete": ["ministry_of_plenty_report"]
  },
  "ai_priority": "proactive"
}
```

**Field reference:**

| Field | Type | Description |
|---|---|---|
| `duration_turns` | int | How many turns the policy runs before completing |
| `cooldown_turns` | int | Turns before the same policy can be activated again |
| `cost` | object | Paid once on activation; supports `influence`, `trust`, `money`, `belief` |
| `effects.while_active` | list | Modifiers applied every turn while active |
| `effects.on_complete` | list | One-time effects on successful completion |
| `effects.on_cancel` | list | Penalties if the player cancels early |
| `events` | object | Event IDs rolled during and after execution |
| `ai_priority` | enum | `proactive` (growth/expansion) or `reactive` (war/crisis) |

---

## 3. Requirement Types

| Requirement | Example |
|---|---|
| Missions completed | `"missions_completed": ["survey_resources"]` |
| Territory control | `"controls_region": "northern_reaches"` |
| Resource threshold | `"resources.ore": {"gte": 50}` |
| Infrastructure level | `"region_infrastructure": 5` |
| Technology | `"tech_level": {"military": 3}` |
| Trust | `"trust": {"gte": 40}` |
| Belief | `"belief": {"gte": 0.6}` |
| Character trait | `"ruler_has_trait": "ruthless_industrialist"` |
| Diplomatic relation | `"relation": {"faction": "iron_syndicate", "gte": 20}` |
| Colony status | `"colony_type": "space_colony"` |

---

## 4. Reward Types

| Reward | Effect |
|---|---|
| `modifiers` | Permanent stat modifier applied to region or dominion |
| `unlocks_policies` | Makes a policy available for activation |
| `events` | Triggers a specific event or event chain |
| `unlocks_mission` | Overrides graph structure; makes a hidden mission visible |
| `new_unit` | Unlocks a unit type for recruitment |
| `new_building` | Unlocks a building type for construction |
| `character_trait` | Grants or removes a trait from the ruler or a named character |
| `claims` | Creates a territorial claim on a region |
| `trust_delta` | Immediate trust gain/loss |

---

## 5. Mission Categories

### Economy
Build the productive base of the Dominion. Typically prerequisite for military and space branches.

- Survey Resources → Build Basic Industry → Industrialize Heartland → Export Economy
- Trade Hub → Merchant Guilds → Monopoly Regime

### Military
Conscript, equip, and deploy. Most military missions have unrest costs.

- Raise Levies → Standing Army → Professional Corps → Mechanized Division
- Border Forts → Fortress Line → Bastion Network

### Diplomacy
Relationships, treaties, and influence. Blocked for isolationist character traits.

- Trade Mission → Permanent Embassy → Alliance Framework
- Propaganda Bureau → Cultural Hegemony

### Expansion
Territorial acquisition. Requires existing claims or a sufficiently high threat index.

- Claim Frontier → Pacify Region → Integrate Territory → Core Province

### Internal
Stability, institutions, and governance. The least glamorous missions; the AI undervalues them.

- Standardize Law → Bureaucratic Reform → Centralization → Efficient Administration
- Suppress Dissent → Loyalty Purges → Total Surveillance (unlocks Dystopia branch)

### Space
Available once a space colony exists. Gated behind `colony_type: space_colony`.

- Survey Asteroid Belt → Mining Operations → Orbital Industry → Dyson Ambition

---

## 6. Example Tree: Industrial Region

```
[Start]
    ↓
"Survey Resources"          requires: control region
    ↓
"Build Basic Industry"      requires: infrastructure ≥ 5
    ↓
   ┌────────────────────┬──────────────────────┐
   ▼                    ▼                      ▼
"Expand Civilian      "Develop Military     "Automate Labour"
 Industry"             Industry"             (requires: tech ≥ 4)
   ↓                    ↓                      ↓
"Export Economy"      "War Machine"         "Post-Scarcity Dreams"
                                            (rare; triggers event)
```

**Mission detail: Survey Resources**

- Requirements: control the target region
- Rewards:
  - Reveal all resource deposits in region
  - Unlock `resource_extraction_policy`
  - Narrative: *"Surveyors return with maps, injuries, and an expense report."*

**Mission detail: Build Basic Industry**

- Requirements: infrastructure ≥ 5, trust ≥ 20
- Rewards:
  - `production_output +0.10` (permanent)
  - Unlock `industrialization_drive` policy
  - Unlock next tier missions

**Mission detail: Automate Labour**

- Requirements: tech_level.economy ≥ 4, `industrialization_drive` completed at least once
- Rewards:
  - `production_output +0.25`
  - `labour_demand -0.40`
  - Trigger event chain `automation_displacement_crisis`
  - Unlock `post_scarcity_experiment` policy

---

## 7. Policy Execution Flow

```
Turn N:   Player activates policy
            → cost deducted
            → effects.while_active applied this turn

Turn N+k: Each turn, mid-execution events are rolled
            → random events may modify, extend, or end the policy early

Turn N+D: Duration expires
            → effects.on_complete applied
            → cooldown begins
            → completion event triggered
            → mission graph checks updated
```

If the player cancels before completion:
- `effects.on_cancel` applied
- Cooldown is **halved** (partial credit)
- No completion event fires

---

## 8. Integration with the Simulation Engine

Missions and policies live in `world/missions/` in the player's fork:

```
world/
  missions/
    available.json       # missions visible but not yet claimed
    completed.json       # claimed missions (append-only)
  policies/
    active.json          # currently running policies with turn counters
    available.json       # unlocked but inactive policies
    definitions/         # base game + mod policy defs
```

The Python engine evaluates missions and policies in `engine/missions.py` during each `resolve_turn()` call:

1. Check `requires` for each available mission against current world state
2. Apply `while_active` modifiers for all active policies
3. Roll mid-execution events
4. Decrement policy timers; fire `on_complete` for any that expire
5. Unlock new missions based on completed set

Narrative text for mission claims and policy completions is generated via `generate_narrative()` (see technical-design §3.4), with the `narrative_hint` field passed as context.

---

## 9. Character Interaction

| Character trait | Effect |
|---|---|
| `ruthless_industrialist` | Industrial policy duration −20%, unrest cost +10% |
| `pacifist` | Military branch missions hidden; unlocks exclusive `Peaceful Expansion` branch |
| `reformer` | Internal missions cost −15% trust |
| `paranoid` | Unlocks `Total Surveillance` mission regardless of prerequisites |
| `visionary` | Space branch missions have AI weight ×2 |

Advisors modify policy execution:

- **Trade Minister**: `Export Economy` +1 permanent bonus on completion
- **General**: Military policies trigger additional unit unlock events
- **Spymaster**: Unlocks `Covert Industrialization` — a hidden version of the industrial tree that doesn't show in rivals' espionage reports

---

## 10. AI Behaviour

AI factions evaluate missions each turn using:

```
score = ai_weight
      + strategic_modifier(faction_doctrine)
      + threat_modifier(current_threat_level)
      - cost_modifier(available_influence)
```

`ai_priority` on policies:
- `proactive`: AI activates during peacetime growth phases
- `reactive`: AI activates when under threat or in war

AI will cancel a policy early if `stability < 20` or if a crisis event fires that conflicts with the policy's category.

---

## 11. Regional Specialization

Each region type modifies mission/policy behaviour:

| Region type | Modifier |
|---|---|
| Core Homeland | All costs −10%; failure events less severe |
| Colony | Infrastructure requirements −2; unrest events more frequent |
| Occupied Territory | Military missions available immediately; diplomacy missions blocked |
| Space Colony | Space branch unlocked; all surface missions unavailable |

Regional modifiers stack on top of character and tech modifiers.

---

## 12. Progression Arc

| Phase | Available missions | Policy profile |
|---|---|---|
| Early (turns 1–10) | Stabilization, survey, basic infrastructure | Short-duration, low-cost, reversible |
| Mid (turns 11–30) | Specialization, branching, first military/diplomatic trees | Trade-off decisions; some irreversible |
| Late (turns 31+) | Endgame branches: hegemony, automation, space dominance | Powerful, risky, high unrest cost |

Late-game policies are deliberately destabilizing — `War Machine`, `Total Surveillance`, and `Post-Scarcity Experiment` all create crisis event chains if stacked carelessly.

---

## 13. Modding

Mission trees and policy definitions are plain JSON in `world/missions/definitions/` and `world/policies/definitions/`. Mods can:

- Add new mission nodes to existing trees (by referencing existing mission IDs in `requires`)
- Define entirely new trees with new categories
- Override `ai_weight` and `narrative_hint` on base game missions
- Add new reward types via Python hooks registered in `engine/rewards.py`

---

## 14. Design Principles

- **Every bonus has a cost.** Production bonuses raise unrest; military policies lower belief.
- **No obvious best path.** The economic and military branches both lead to viable late-game positions via different trade-offs.
- **Regional identity.** A space colony tree looks nothing like a core homeland tree.
- **Bureaucratic tone.** Mission names and narrative hints should sound like they came from a very tired ministry official.
- **Meaningful irreversibility.** Some late-game branches close off alternatives permanently — players should feel the weight of committing.
