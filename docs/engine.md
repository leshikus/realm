# Python Simulation Engine Specification

## 1. Overview

The engine is a pure Python package (`engine/`) that runs server-side (GitHub Actions CI). It loads world state from disk, validates player orders, resolves a turn deterministically, and writes updated state back to disk. The browser has no simulation code — all game logic lives here.

Entry point: `python -m engine.main <userid> <turn>`

---

## 2. Module Map

| Module | Responsibility |
|---|---|
| `models.py` | Pydantic schemas for all world-state objects |
| `orders.py` | `OrderType` enum, `Order`/`TurnOrders` schemas, validation |
| `simulation.py` | `resolve_turn()` — pure, deterministic turn resolution |
| `loader.py` | File I/O: read/write JSON files, append event history |
| `main.py` | CLI entry point; orchestrates load → validate → resolve → persist |

---

## 3. Data Model (`models.py`)

### 3.1 Enums

| Enum | Values |
|---|---|
| `FactionType` | `federation`, `syndicate`, `conspiracy` |
| `DoctrineType` | `attrition`, `maneuver`, `siege`, `raid` |
| `HeroRole` | `agent`, `general`, `demigod`, `scholar` |

### 3.2 Hero

```
Hero:
  id:           str          # short UUID (8 chars)
  name:         str
  owner:        str          # userid
  role:         HeroRole
  skills:       SkillGraph   # combat/diplomacy/espionage/scholarship/leadership (ints)
  personality:  PersonalityMatrix
  region_id:    str | None
  alive:        bool
  turn_created: int
```

`PersonalityMatrix` fields: `loyalty`, `paranoia`, `ambition`, `competence` (0–100 each), `vices: list[str]` (accumulates through failure).

### 3.3 Faction

```
Faction:
  id, name, owner
  type:               FactionType
  influence:          int (0–100)
  economy:            int (0–100)
  crime:              int (0–100)
  ideology_stability: int (0–100)
```

### 3.4 Region

Regions are contested territory — no single player owns them. Each faction holds a fractional share of influence that sums toward 1.0 across all factions active in the region.

```
Region:
  id, name
  faction_influence:   dict[faction_id → float]   # 0.0–1.0 per faction
  adjacent_region_ids: list[str]
  population:          int
  prosperity:          int (0–100)
  unrest:              int (0–100)
```

The **dominant faction** — the one with the highest influence share — determines the region's political colour on the map and is the default target for propaganda orders. Multiple factions can hold meaningful shares simultaneously.

### 3.5 Economy

```
Economy:
  owner
  trust:                int (≥0)  # primary currency
  output_per_turn:      int       # default 10
  consumption_per_turn: int       # default 8
  propaganda_bonus:     int       # added to trust income
```

Net trust per turn: `output - consumption + propaganda_bonus` (army upkeep deducted separately).

### 3.6 BeliefIndex

```
BeliefIndex:
  owner
  aggregate:   int (0–100)   # mean of domains; drives resource availability
  agriculture: int (0–100)
  military:    int (0–100)
  governance:  int (0–100)
```

### 3.7 Army

```
Army:
  id, name, owner
  region_id:              str
  commander_hero_id:      str | None
  doctrine:               DoctrineType
  strength:               int (≥0)
  morale:                 int (0–100)
  economy_upkeep_per_turn: int   # default 5
```

### 3.8 PlayerWorld

Aggregates all per-player state:

```
PlayerWorld:
  userid: str
  turn:   int
  heroes, factions, regions, armies: lists
  economy: Economy
  belief:  BeliefIndex
```

### 3.9 SharedWorld

Global state. `world.json` and `regions.json` both live under `shared/`:

```
SharedWorld:  (shared/world.json)
  current_turn:       int
  turn_deadline_utc:  str | None   # ISO 8601
  player_ids:         list[str]

shared/regions.json:  list[Region]   # loaded into PlayerWorld.regions at runtime
```

Regions are shared because they are contested territory with no single owner. The engine loads them from `shared/regions.json` into `PlayerWorld.regions` so simulation code can access them without structural changes. After turn resolution the updated regions are written back to `shared/regions.json`.

---

## 4. Orders (`orders.py`)

### 4.1 OrderType enum

| Type | Description | Required params | Trust cost |
|---|---|---|---|
| `set_propaganda` | Adjust faction propaganda bonus | `faction_id`, `value` (0–50) | 0 |
| `levy_tax` | Collect trust, raise unrest | `region_id`, `amount` | 0 |
| `assign_hero` | Move hero to region/army | `hero_id`, `target_id` | 0 |
| `recruit_hero` | Create new hero | `name`, `role`, `region_id` | 20 |
| `army_directive` | Issue directive to army | `army_id`, `directive` | 0 |
| `raise_army` | Recruit new army in region | `name`, `region_id`, `doctrine` | 30 |
| `begin_research` | Assign scholar to tech | `scholar_hero_id`, `tech` | 0 |
| `build` | Construct structure in region | `region_id`, `structure` | 0 |

### 4.2 Order schema

```python
class Order(BaseModel):
    type:   OrderType
    params: dict[str, Any] = {}
```

A Pydantic `model_validator` checks that all required params are present.

### 4.3 TurnOrders schema

```python
class TurnOrders(BaseModel):
    userid: str
    turn:   int
    orders: list[Order] = []
```

Stored at `{userid}/orders/turn.json` on the player's fork.

### 4.4 validate_orders()

```python
def validate_orders(orders: TurnOrders, world: PlayerWorld) -> list[str]
```

Returns a list of error strings (empty = valid). Checks:
- Referenced `hero_id`, `army_id`, `region_id`, `faction_id` exist in world
- Propaganda value is 0–50
- Total trust cost of all orders does not exceed `world.economy.trust`

---

## 5. Simulation (`simulation.py`)

### 5.1 Entry point

```python
def resolve_turn(world: PlayerWorld, orders: TurnOrders, seed: int | None = None) -> ResolutionResult
```

Stateless: operates on a deep copy of `world`. Returns `ResolutionResult(world, events, errors)`. Same `seed` + same input always produces the same output.

### 5.2 Resolution phases (in order)

1. **Apply orders** — execute each order in submission order
2. **Economy tick** — `trust += output - consumption + propaganda_bonus`
3. **Belief tick** — drain all belief domains by `avg_unrest // 10`; recalculate aggregate
4. **Faction AI tick** — crime rises when `trust < 50`, else decays; `ideology_stability` tracks `belief.aggregate`
5. **Hero mutation tick** — random +0/+1 skill point; paranoia creep (5 % chance +1); vices acquired when `ambition > 70 && loyalty < 40`
6. **Army upkeep tick** — deduct `upkeep_per_turn` from trust for each live army; unpaid armies lose 10 morale
7. **Global event roll** — 20 % chance of a random world event from a fixed table
8. **Advance turn** — `world.turn += 1`

### 5.3 Army directives

Handled by `_execute_directive()`. Supported directive strings:

| Directive | Effect |
|---|---|
| `advance` | Success → +5 morale; failure → −5–20 strength, −5–15 morale |
| `hold` | Low-loyalty commander may cause desertions (−1–5 strength) |
| `raid` | Success → +5–20 trust; failure → −5–20 morale |
| `encircle` | Narrative result; outcome logged but no stat change |

Success probability: `(competence + strength/2) / 150`. Paranoid commanders (>60) have a 40% chance to hesitate and skip execution.

### 5.4 Global events table

Six flavour events drawn randomly. Some apply side effects:
- "civil war over a comma" → `belief.governance -= 5`
- "agricultural faith crisis" → `belief.agriculture -= 8`
- Others are narrative-only

---

## 6. File I/O (`loader.py`)

### 6.1 World root

Determined by `CONSPIRACY_WORLD_ROOT` environment variable (set by CI to the checked-out `conspiracy` repo workspace). Falls back to `../conspiracy` relative to the package for local development.

### 6.2 File layout

Region data is split across two files:

| File | Repo | Fields | Mutability |
|---|---|---|---|
| `world/map.json` | `conspiracy-game` | `id`, `name`, `adjacent_region_ids`, `lon`, `lat` | Static — game master only |
| `shared/regions.json` | `conspiracy` | `id`, `faction_influence`, `population`, `prosperity`, `unrest` | Dynamic — written each turn |

The loader merges both into a full `Region` object at load time. Only dynamic fields are written back after turn resolution.

```
conspiracy-game/
  world/
    map.json          # static region topology (id, name, adjacency, coordinates)

conspiracy/
  shared/
    world.json        # SharedWorld: current turn, deadline, player list
    regions.json      # dynamic region state (faction_influence, population, prosperity, unrest)

  {userid}/
    heroes.json       # list of Hero objects
    factions.json     # list of Faction objects
    armies.json       # list of Army objects
    economy.json      # single Economy object
    belief.json       # single BeliefIndex object
    turn.json         # { "turn": N }
    orders/
      turn.json       # TurnOrders (submitted via PR)
    history/
      events.log      # append-only narrative log
      stats_NNNN.json # per-turn stats snapshot
```

### 6.3 Functions

| Function | Description |
|---|---|
| `load_player_world(userid)` | Reads `{userid}/*.json` + merges map + region state; supplies defaults for missing files |
| `save_player_world(world)` | Writes `{userid}/*.json` (not regions); creates directory if needed |
| `load_shared_world()` | Reads `shared/world.json` |
| `save_shared_world(shared)` | Writes `shared/world.json` |
| `load_map()` | Reads `world/map.json` from `conspiracy-game`; returns static region descriptors |
| `save_regions(regions)` | Writes dynamic fields only to `shared/regions.json` |
| `append_history(userid, entry)` | Appends a line to `{userid}/history/events.log` |

---

## 7. CLI Entry Point (`main.py`)

### 7.1 Invocation

```bash
python -m engine.main <userid> <turn>
```

Called by the `process-turn.yml` GitHub Actions workflow after a player's orders PR is merged.

### 7.2 Execution pipeline

1. Load `PlayerWorld` and `TurnOrders`
2. Validate orders — exit code 1 + stderr on failure (causes CI to reject the PR)
3. Call `resolve_turn(world, orders, seed=turn)`
4. Persist updated world files
5. Append turn header + events to `history/events.log`
6. Write `history/stats_{turn:04d}.json` (read by browser Statistics panel)
7. Print summary to stdout (becomes git commit body in CI)

### 7.3 Stats snapshot schema

```json
{
  "turn":          42,
  "trust":         120,
  "belief":        65,
  "army_strength": 320,
  "unrest":        18
}
```

`unrest` is the average across all regions; `army_strength` is the sum across all armies.

---

## 8. Testing

```bash
pytest engine/tests/ -v
pytest engine/tests/test_simulation.py::test_name -v
```

Tests must not mock the database — they operate on real `PlayerWorld` / `TurnOrders` instances. Determinism is enforced: same seed must always produce identical `ResolutionResult`.
