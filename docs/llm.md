# LLM Integration

Conspiracy uses a locally-run LLM (Ollama) to generate human-readable text at several points during turn resolution. The LLM is never in the critical path for game logic — it produces flavour and narrative on top of deterministic simulation output. All call sites have JSON-template fallbacks for environments where Ollama is unavailable (e.g. GitHub Actions CI).

---

## Runtime

**Model:** `llama3.2` (7B) via [Ollama](https://ollama.com). Runs on a developer laptop. A 7B-class model produces adequate quality for the game's darkly bureaucratic tone and is fast enough to call multiple times per turn.

**CI fallback:** If Ollama is unreachable, all narrative call sites fall back to pre-written JSON template strings. Templates are stored in `engine/templates/` and selected by event type + outcome.

**Tone system prompt** (shared across all call sites):

```python
NARRATIVE_SYSTEM_PROMPT = (
    "You write darkly humorous in-world narrative for a bureaucratic fantasy civilization game. "
    "The tone is dry, ironic, and vaguely Kafkaesque. Officials speak in passive voice. "
    "Everything is framed as paperwork, committees, and edicts. "
    "Be concise (one sentence unless told otherwise). Never break the fourth wall. "
    "Never use the word 'tapestry'."
)
```

**Base call:**

```python
# engine/llm.py

import httpx

def generate(prompt: str, model: str = "llama3.2", max_tokens: int = 120) -> str:
    try:
        response = httpx.post(
            "http://localhost:11434/api/chat",
            json={
                "model": model,
                "options": {"temperature": 0.7, "num_predict": max_tokens},
                "messages": [
                    {"role": "system", "content": NARRATIVE_SYSTEM_PROMPT},
                    {"role": "user",   "content": prompt},
                ],
            },
            timeout=15.0,
        )
        return response.json()["message"]["content"].strip()
    except Exception:
        return None   # caller falls back to template
```

---

## Call Sites

### 1. Turn event descriptions

Called once per event that occurs during `resolve_turn()`. Converts a structured event record into an in-world narrative sentence.

**Input:** event type + affected entities + outcome delta
**Output:** one sentence, in-world tone

```python
def narrate_event(event: dict) -> str:
    prompt = (
        f"Event type: {event['type']}\n"
        f"Affected: {event['entities']}\n"
        f"Outcome: {event['outcome']}\n"
        f"Write one in-world sentence describing this event."
    )
    return generate(prompt) or TEMPLATES["events"][event["type"]][event["outcome"]]
```

Example output:
`"The Bureau of Fiscal Oversight regrets to inform all concerned parties that the harvest figures have been revised downward by an administratively convenient margin."`

---

### 2. CI commit message (turn chronicle)

Called once at the end of each turn resolution. Produces the git commit message, which doubles as the in-world chronicle entry.

**Input:** full turn summary (list of events, key stat changes)
**Output:** 2–4 line commit message in chronicle style

```python
def narrate_turn_summary(turn: int, events: list[dict], deltas: dict) -> str:
    event_lines = "\n".join(f"- {e['type']}: {e['outcome']}" for e in events)
    prompt = (
        f"Turn {turn} summary:\n{event_lines}\n"
        f"Key changes: trust {deltas.get('trust', 0):+d}, "
        f"stability {deltas.get('stability', 0):+d}, "
        f"belief {deltas.get('belief', 0):+.2f}\n\n"
        f"Write a 2-3 line git commit message as an in-world chronicle entry. "
        f"First line: 'Turn {turn}: <summary>'. Then one blank line. Then 1-2 detail lines."
    )
    return generate(prompt, max_tokens=200) or f"Turn {turn}: Resolution complete."
```

Example output:
```
Turn 42: The Bureau of Conspiracies approved three contradictory edicts simultaneously.

Harvest yields shifted 14% toward disbelief. The Church of Necessary Evil
filed a formal objection, which was stamped RECEIVED and placed in a drawer.
```

---

### 3. Hero trait mutation

Called when a hero's trait changes due to an event or action. Produces a one-sentence explanation of the change in the hero's own voice or the narrator's.

**Input:** hero name + old traits + new trait + triggering action
**Output:** one sentence

```python
def narrate_trait_mutation(hero: dict, old_traits: list, new_trait: str, cause: str) -> str:
    prompt = (
        f"Hero: {hero['name']}\n"
        f"Previous traits: {', '.join(old_traits)}\n"
        f"New trait acquired: {new_trait}\n"
        f"Cause: {cause}\n"
        f"Write one sentence explaining this character change in an in-world tone."
    )
    return generate(prompt) or f"{hero['name']} acquired the trait '{new_trait}'."
```

Example output:
`"After the third consecutive failed infiltration, Voss began checking door hinges before entering rooms — and people's faces before trusting them."`

---

### 4. Faction proclamation

Called when a faction activates a major policy or reaches a mission milestone. Produces an in-world edict or announcement text shown in the Event Viewer.

**Input:** faction name + faction state + policy/mission + effect summary
**Output:** 2–5 sentences in the faction's bureaucratic voice

```python
def narrate_proclamation(faction: dict, trigger: str, effects: dict) -> str:
    prompt = (
        f"Faction: {faction['name']}\n"
        f"Current trust: {faction['trust']}, stability: {faction['stability']}\n"
        f"Trigger: {trigger}\n"
        f"Effects: {effects}\n"
        f"Write a 2-4 sentence in-world proclamation or edict from this faction. "
        f"Use passive voice. Reference committees, departments, or regulatory bodies."
    )
    return generate(prompt, max_tokens=180) or f"The {faction['name']} announces {trigger}."
```

Example output:
`"It has been determined by the Sub-Committee on Productive Outcomes that all factory quotas shall henceforth be considered aspirational. Workers are reminded that morale is not a justification for reduced output. The relevant forms have been updated."`

---

### 5. Hero dialogue (for voice acting)

Called when a hero speaks during an event. Output is fed to the TTS pipeline (see `lip-sync.md`).

**Input:** hero traits + faction + event context
**Output:** 1–3 sentences of spoken dialogue in character

```python
def generate_hero_dialogue(hero: dict, event: dict) -> str:
    trait_str = ", ".join(hero["traits"])
    prompt = (
        f"Character: {hero['name']}, traits: {trait_str}, faction: {hero['faction']}\n"
        f"Situation: {event['description']}\n"
        f"Write 1-3 sentences of in-character spoken dialogue. "
        f"No stage directions. Just the words they say aloud."
    )
    return generate(prompt) or event.get("default_dialogue", "...")
```

---

### 6. AI-controlled faction orders

AI factions can use the LLM to generate orders instead of the rule-based AI. Each faction receives a system prompt encoding its personality and doctrine.

```python
def get_llm_orders(faction: str, world_state: dict) -> dict | None:
    """
    Returns a validated orders dict or None (falls back to rule-based AI).
    """
    personality = FACTION_PROMPTS[faction]  # per-faction system prompt
    prompt = (
        f"Current world state (your faction: {faction}):\n"
        f"{json.dumps(world_state, indent=2)}\n\n"
        f"Submit your orders as a JSON object matching the TurnOrders schema."
    )
    raw = generate(prompt, model="llama3.2", max_tokens=400)
    if raw is None:
        return None
    try:
        orders = json.loads(raw)
        return TurnOrders.model_validate(orders).model_dump()
    except Exception:
        return None   # validation failed → fall back to rule-based AI
```

**Key implementation notes:**

- LLM output is validated against `TurnOrders` (Pydantic schema) before use — it is never trusted directly
- `temperature: 0` for predictable/rational factions; raise to 0.9 for chaotic or unstable ones
- Ollama must be running locally; CI skips LLM orders and uses rule-based AI if unreachable
- 7B models produce adequate strategic reasoning; larger models add quality but reduce speed

**Faction personality prompts** (stored in `engine/faction_prompts.py`):

| Faction | Personality prompt excerpt |
|---|---|
| Bureau of Conspiracies | "You are a cautious, process-obsessed bureaucracy. You prefer stability. You never take irreversible actions without a committee review." |
| Church of Necessary Evil | "You are a morally flexible religious institution. You frame every action as spiritually justified. You expand influence through guilt." |
| Syndicate of Flesh | "You are a ruthless commercial operation. You trade in people and capabilities. You maximise short-term returns and externalise costs." |
| Shadow Guilds | "You are a decentralised network of opportunists. You destabilise other factions. You have no long-term plan beyond survival and profit." |

---

## Template Fallback System

All call sites return `None` on LLM failure and fall back to templates. Templates are JSON files keyed by event type and outcome:

```
engine/templates/
    events.json          ← { event_type: { outcome: "template string" } }
    proclamations.json   ← { policy_id: "template proclamation" }
    trait_mutations.json ← { trait: "template explanation" }
    turn_summary.json    ← default commit message format
```

Template strings support `{hero_name}`, `{faction}`, `{turn}`, and `{delta}` substitutions. They are intentionally dry and generic — the LLM is what gives each event its specific flavour. Templates are the safe floor, not the target.

---

## Adding a New Call Site

1. Write a `narrate_*` function in `engine/llm.py` using `generate()`
2. Add a fallback entry in the relevant `engine/templates/*.json`
3. Call it from the appropriate step in `resolve_turn()` and pass the result to the event record's `narrative` field
4. The Event Viewer and CI commit message renderer read `event["narrative"]` — no other changes needed

---

## Configuration

```python
# engine/config.py

LLM_ENABLED  = True               # set False to skip all LLM calls and use templates
LLM_BASE_URL = "http://localhost:11434"
LLM_MODEL    = "llama3.2"
LLM_TIMEOUT  = 15.0               # seconds; fail fast rather than stall CI
```

Override via environment variable:

```bash
LLM_ENABLED=false python -m engine.main   # use templates only (fast, deterministic)
```
