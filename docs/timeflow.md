# Timeflow: Timestamped World State & Timeline Divergence

---

## Core Idea

Every object in `world/` carries the turn it was last written. The world state a player sees is not a static snapshot — it is **computed on demand** by collecting all records up to their current turn and taking the latest version of each entity.

This means two players can be at different turns and each see a fully valid, self-consistent world. Their states are not "out of sync" — they are on different positions in the same timeline.

---

## Why This Matters

Without timestamps, world state is a snapshot: one file, one truth, overwritten each turn. Players must be at the same turn or the state is incoherent.

With timestamps, world state is a **log**. Each turn appends new records. The "current" state is a view derived from that log at a given turn index. Players at different turns naturally see different views — and the engine can reason about what each player sees when they interact.

This unlocks:

- **Async play**: Player A can be on turn 30, Player B on turn 45. Both play normally.
- **Retrospective interaction**: A diplomatic offer sent at turn 45 arrives in Player A's world at whatever turn A processes it.
- **Time-displaced conflict**: A military attack from turn 45 lands on a world still in turn 30 — the engine resolves this as an arrival event at the target player's next turn.
- **Full in-file history**: The turn log inside each file is a complete record. Git history and file history both tell the story.

---

## Object Schema

Every record in every world file has a `turn` field. This is the turn at which the engine wrote this version of the object.

### Faction record

```json
{
  "turn": 42,
  "id": "bureau_of_conspiracies",
  "trust": 45,
  "influence": 30,
  "stability": 72,
  "active_policies": ["industrialization_drive"],
  "completed_missions": ["survey_resources", "build_basic_industry"]
}
```

### Hero record

```json
{
  "turn": 38,
  "id": "agent_77",
  "name": "Inquisitor Voss",
  "faction": "bureau_of_conspiracies",
  "location": "heartland",
  "traits": ["paranoid", "efficient"],
  "skill_graph": {
    "infiltration": 4,
    "persuasion": 2
  },
  "status": "active"
}
```

### Region record

```json
{
  "turn": 40,
  "id": "heartland",
  "owner": "bureau_of_conspiracies",
  "infrastructure": 7,
  "unrest": 12,
  "belief": 0.68,
  "garrison": 200
}
```

### Economy record

```json
{
  "turn": 42,
  "faction": "bureau_of_conspiracies",
  "trust": 450,
  "influence": 120,
  "production_output": 1.3,
  "consumption": 1.1
}
```

---

## File Structure

Each world file is an **append-only array of timestamped records**, not a snapshot. The engine never overwrites a record — it appends.

```json
// {userid}/world/factions.json
[
  { "turn": 1,  "id": "bureau_of_conspiracies", "trust": 10, "stability": 80 },
  { "turn": 1,  "id": "church_of_necessary_evil", "trust": 5, "stability": 90 },
  { "turn": 15, "id": "bureau_of_conspiracies", "trust": 30, "stability": 74 },
  { "turn": 28, "id": "bureau_of_conspiracies", "trust": 38, "stability": 68 },
  { "turn": 28, "id": "church_of_necessary_evil", "trust": 12, "stability": 85 },
  { "turn": 42, "id": "bureau_of_conspiracies", "trust": 45, "stability": 72 }
]
```

Multiple entities interleave in the same file. Records for different entities are appended independently as they change — an entity that doesn't change in a given turn gets no new record.

---

## World State Construction

To compute the world state at turn `N`, the algorithm is:

```python
# engine/timeflow.py

def world_at(records: list[dict], turn: int) -> dict[str, dict]:
    """
    Given a flat list of timestamped records, return a dict keyed by entity id
    containing the latest record for each entity at or before `turn`.
    """
    latest: dict[str, dict] = {}
    for record in records:
        if record["turn"] > turn:
            continue
        entity_id = record["id"]
        if entity_id not in latest or record["turn"] > latest[entity_id]["turn"]:
            latest[entity_id] = record
    return latest
```

Example:

```python
factions = load_json(f"{userid}/world/factions.json")

# Player is on turn 30 — sees bureau at trust=38 (from turn 28)
state_t30 = world_at(factions, turn=30)
# { "bureau_of_conspiracies": { "turn": 28, "trust": 38, ... }, ... }

# Player is on turn 45 — sees bureau at trust=45 (from turn 42)
state_t45 = world_at(factions, turn=45)
# { "bureau_of_conspiracies": { "turn": 42, "trust": 45, ... }, ... }
```

The engine calls `world_at()` at the start of every `resolve_turn()`. It always constructs a fresh view — nothing is cached or mutated.

### Writing a new turn

After resolution, the engine appends only the records that changed:

```python
def apply_turn(records: list[dict], updates: list[dict], turn: int) -> list[dict]:
    """
    Append new versioned records for any entities that changed this turn.
    Entities that didn't change get no new record.
    """
    for update in updates:
        update["turn"] = turn
        records.append(update)
    return records
```

The file grows by one record per changed entity per turn. Unchanged entities are implicitly carried forward from their last record.

---

## Player Timeline Positions

Each player's fork tracks their current turn in `{userid}/world/meta.json`:

```json
{
  "turn": 30,
  "last_resolved": "2026-03-20T14:32:00Z",
  "fork_of": "conspiracy-canonical/conspiracy",
  "player": "alice"
}
```

The shared `shared/turn.json` is the **global ceiling** — the latest turn that has been processed anywhere. Individual players may lag behind it.

```
Global turn (shared/turn.json):   45
  Player A (alice):                30   ← 15 turns behind
  Player B (bob):                  45   ← at the frontier
  Player C (carol):                42   ← 3 turns behind
```

This is not an error state. It is the normal condition. Players advance at their own pace.

---

## Cross-Timeline Interactions

When Player B (turn 45) interacts with Player A (turn 30), the interaction is modelled as an **incoming event** delivered to Player A at their next unresolved turn.

### Example: diplomatic offer

Bob sends a trade offer at turn 45. Alice is on turn 30.

1. Bob's engine writes a cross-player event into the shared event bus or directly into Alice's fork:

```json
// alice/world/incoming.json  (appended by Bob's CI run)
{
  "turn_sent": 45,
  "turn_received": null,
  "from_player": "bob",
  "type": "diplomatic_offer",
  "offer": { "type": "trade_agreement", "terms": { "trust": 10 } },
  "expires_at_turn": 55
}
```

2. When Alice processes turn 31, the engine finds this pending incoming event. It was sent at turn 45 but arrives at turn 31 — the engine resolves it at the **receiver's current turn**, not the sender's. Alice sees it in her turn 31 event log.

3. If Alice accepts, her acceptance is written as a new event. Bob sees it when he next loads his world state — as an event that resolved at Alice's turn 31, cross-referenced in his timeline.

### Example: military attack

Bob launches an attack at his turn 45 targeting Alice's region. Alice is on turn 30.

- The attack is queued as an incoming event in `alice/world/incoming.json`
- When Alice processes turn 31, the attack arrives — her garrison at turn 30 is the defender
- Alice cannot retroactively avoid the attack by staying on turn 30; `expires_at_turn` enforces a deadline after which the attack resolves automatically by default

### Resolution rules

| Sender turn | Receiver turn | Rule |
|---|---|---|
| Higher | Lower | Event queued; resolved at receiver's next turn |
| Lower | Higher | Event queued; resolved immediately (receiver has already passed sender's time) |
| Equal | Equal | Resolved simultaneously in the same CI run |

When receiver turn > sender turn, the event resolves against the receiver's **current** world state (not the state at sender's turn). A faction that has grown stronger since turn 45 defends with its turn-60 strength.

---

## Client Rendering

The client always renders the world at the player's current turn. It fetches the full record arrays and calls `world_at()` in the browser:

```js
// client/timeflow.js

export function worldAt(records, turn) {
  const latest = {};
  for (const record of records) {
    if (record.turn > turn) continue;
    const id = record.id ?? record.faction ?? record.region;
    if (!latest[id] || record.turn > latest[id].turn) {
      latest[id] = record;
    }
  }
  return latest;
}
```

```js
// client/world.js

export async function loadWorldState() {
  const userid = getUserid();
  const meta   = await fetchJSON(rawUrl(userid, "world/meta.json"));
  const turn   = meta.turn;

  const [factions, heroes, regions, economy, belief] = await Promise.all([
    fetchJSON(rawUrl(userid, "world/factions.json")),
    fetchJSON(rawUrl(userid, "world/heroes.json")),
    fetchJSON(rawUrl(userid, "world/regions.json")),
    fetchJSON(rawUrl(userid, "world/economy.json")),
    fetchJSON(rawUrl(userid, "world/belief.json")),
  ]);

  return {
    turn,
    factions: worldAt(factions, turn),
    heroes:   worldAt(heroes,   turn),
    regions:  worldAt(regions,  turn),
    economy:  worldAt(economy,  turn),
    belief:   worldAt(belief,   turn),
  };
}
```

The client can trivially render the world at **any** past turn by passing a different value to `worldAt()` — this is the replay / chronicle view, no extra data needed.

---

## File Growth & Compaction

Records accumulate over time. A world with 200 turns and 50 heroes has up to 10,000 hero records in `heroes.json`.

**This is intentional for most of the game's lifetime.** The full log is the history. Diffs are human-readable. Players can inspect their entire world history by reading the file.

When files grow too large, the engine can compact: replace all records before turn `N` with a single baseline snapshot at turn `N`, and continue appending from there. Compaction is lossy for history but lossless for current state.

```python
def compact(records: list[dict], before_turn: int) -> list[dict]:
    """
    Replace all records before `before_turn` with a single baseline per entity,
    then keep all records from `before_turn` onward.
    """
    baseline = world_at(records, before_turn - 1)
    kept     = [r for r in records if r["turn"] >= before_turn]
    return list(baseline.values()) + kept
```

Compaction is a CI operation committed to `main` like any other turn. The commit message marks it: `"Compaction: world history archived before turn 100"`.

---

## Incoming Events File

`{userid}/world/incoming.json` holds cross-player events that have been delivered but not yet resolved. It uses the same append model:

```json
[
  {
    "turn_sent":     45,
    "turn_received": null,
    "from_player":   "bob",
    "type":          "diplomatic_offer",
    "id":            "offer_bob_45_001",
    "payload":       { "type": "trade_agreement", "terms": { "trust": 10 } },
    "expires_at_turn": 55
  }
]
```

When the engine resolves a turn for Alice and processes this event, it appends a resolution record:

```json
{
  "turn_sent":     45,
  "turn_received": 31,
  "from_player":   "bob",
  "type":          "diplomatic_offer",
  "id":            "offer_bob_45_001",
  "payload":       { "type": "trade_agreement", "terms": { "trust": 10 } },
  "resolved":      true,
  "outcome":       "accepted",
  "expires_at_turn": 55
}
```

Bob's client reads Alice's `incoming.json` (via the raw content API on her fork) to see the resolution status.

---

## Summary of Files

```
{userid}/world/
  meta.json          ← current turn; single record, overwritten
  factions.json      ← append-only; one record per faction per changed turn
  heroes.json        ← append-only; one record per hero per changed turn
  regions.json       ← append-only; one record per region per changed turn
  economy.json       ← append-only; one record per faction per changed turn
  belief.json        ← append-only; one record per faction per changed turn
  incoming.json      ← cross-player events; append-only; records gain resolution fields
```

Only `meta.json` is a single overwritten record. Everything else is append-only.

---

## Design Implications

- **The engine never needs the full history** to resolve a turn — `world_at(records, N)` is O(n) over a typically small file
- **Rollback is free** — pass a previous turn to `world_at()` and you have the exact world as it was
- **Cross-player interactions have a natural temporal model** — events carry `turn_sent`; the receiver's engine resolves them at `turn_received`
- **Late players are not broken players** — being 10 turns behind is a valid game state, not data corruption
- **The client's "history" view is zero-cost** — no extra API calls; all data is already in the record arrays
