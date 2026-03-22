# Conspiracy

A darkly humorous turn-based civilization simulation. Players accumulate power, scale agents and long-term projects, and compete against rivals — while their dominion threatens to collapse under its own weight.

**Stack:** Python simulation engine (CI) · Vanilla HTML/JS browser client (GitHub Pages) · GitHub API as the game protocol · Git history as the world chronicle.

---

## Design Documents

| Document | System |
|---|---|
| [`docs/lore.md`](docs/lore.md) | World, factions, narrative pillars |
| [`docs/technical-design.md`](docs/technical-design.md) | Architecture, simulation loop, all core systems |
| [`docs/regions.md`](docs/regions.md) | Earth regions, resources, population strata, stability/entropy |
| [`docs/missions.md`](docs/missions.md) | Mission trees, policy schemas, execution flow |
| [`docs/tech.md`](docs/tech.md) | Continuous technology levels, diffusion, decay, crisis loss |
| [`docs/role-playing.md`](docs/role-playing.md) | Hero Skill Graph, Personality Matrix, fatigue, Syndicate procurement |
| [`docs/menus.md`](docs/menus.md) | Full UI layout, Orders panel, Chronicle, Statistics |
| [`docs/timeflow.md`](docs/timeflow.md) | Timestamped world state, async play, cross-timeline interactions |
| [`docs/oauth.md`](docs/oauth.md) | GitHub PKCE auth, order PR submission, CI polling |
| [`docs/llm.md`](docs/llm.md) | LLM narrative generation, event descriptions, Chronicle, template fallback |
| [`docs/lip-sync.md`](docs/lip-sync.md) | AI portraits, voice synthesis, lip-sync animation |

---

## Development Plan

### Phase 1 — World State Foundation

Establish the data layer. Everything else builds on this.

- [ ] Define append-only timestamped JSON schemas for `factions`, `heroes`, `regions`, `economy`, `belief` ([`timeflow.md`](docs/timeflow.md))
- [ ] Implement `world_at(records, turn)` — constructs current world view from record log ([`timeflow.md`](docs/timeflow.md))
- [ ] Set up canonical `conspiracy/` repo structure: `/{userid}/world/`, `/shared/`, `/.github/workflows/`
- [ ] `shared/turn.json` — global turn counter and deadline
- [ ] `{userid}/world/meta.json` — per-player turn position
- [ ] Seed canonical world state: Earth regions, starting factions, initial tech levels

---

### Phase 2 — Python Simulation Engine

The engine is headless, deterministic, stateless between turns. Reads world state JSON in; writes world state JSON out.

- [ ] `engine/main.py` — `resolve_turn(world_state, orders) → updated_records`
- [ ] Turn resolution order: order validation → conflict resolution → event queue → faction AI → hero agents → belief economy → entropy resolution → global events → world state commit ([`technical-design.md §4`](docs/technical-design.md))
- [ ] Trust economy — generation from propaganda/decrees, destruction from fulfilment ([`technical-design.md §5.1`](docs/technical-design.md))
- [ ] Belief economy — resource generation driven by population confidence; drift per turn ([`technical-design.md §5.2`](docs/technical-design.md))
- [ ] Entropy — accumulation from crises/cults/Paperwork; decay from stability actions; cascade at threshold ([`regions.md §7.2`](docs/regions.md))
- [ ] Order validator — schema check (Pydantic) + rule enforcement before simulation runs
- [ ] Faction AI — autonomous per-faction state updates each turn ([`technical-design.md §5.5`](docs/technical-design.md))

---

### Phase 3 — Missions & Policies Engine

- [ ] `engine/missions.py` — evaluate mission requirements against world state each turn ([`missions.md`](docs/missions.md))
- [ ] Mission claim flow: check `requires` → apply `rewards` → append to `completed.json` → unlock next nodes
- [ ] Policy execution: deduct cost on activation → apply `while_active` modifiers each turn → decrement timer → fire `on_complete` or `on_cancel` ([`missions.md §7`](docs/missions.md))
- [ ] Mid-execution event rolls for active policies
- [ ] Mission/policy JSON definitions in `world/missions/definitions/` and `world/policies/definitions/`

---

### Phase 4 — Technology System

- [ ] `engine/tech.py` — per-direction level update each turn: `Δlevel = investment_gain + diffusion_gain + synergy_gain − decay − crisis_loss` ([`tech.md §3`](docs/tech.md))
- [ ] Education multiplier derived from Scholar/Bureaucrat strata per region ([`tech.md §5`](docs/tech.md))
- [ ] Adjacency diffusion — tech flows from higher-level neighbours via active trade routes ([`tech.md §3.2`](docs/tech.md))
- [ ] Cross-direction synergy coefficients ([`tech.md §3.3`](docs/tech.md))
- [ ] Crisis loss — military conflict and events spike degradation on affected directions ([`tech.md §3.5`](docs/tech.md))
- [ ] Integer threshold effects — capabilities that suspend when level drops below threshold ([`tech.md §4.2`](docs/tech.md))
- [ ] `world/tech.json` — per-Dominion float levels for all 7 directions

---

### Phase 5 — Hero System

- [ ] Hero data model: `skill_graph` (7 skills, 0–10), `personality_matrix` (trait list), `fatigue`, `assignment` ([`role-playing.md`](docs/role-playing.md))
- [ ] `engine/heroes.py` — `mission_duration()` and `mission_quality()` using skill + trait modifiers ([`role-playing.md §3`](docs/role-playing.md))
- [ ] Skill growth on mission completion — primary and secondary accumulator increments ([`role-playing.md §2`](docs/role-playing.md))
- [ ] Trait acquisition — accumulator threshold crossing appends trait to `personality_matrix` ([`role-playing.md §4`](docs/role-playing.md))
- [ ] Fatigue — increments per assignment, decays on idle turns ([`role-playing.md §5`](docs/role-playing.md))
- [ ] Syndicate of Flesh procurement — order schema, delivery delay, configurable initial traits ([`role-playing.md §7`](docs/role-playing.md))
- [ ] Hero loss — `marked_by_shadow_guilds`, loyalty collapse, burnout breakdown ([`role-playing.md §8`](docs/role-playing.md))

---

### Phase 6 — CI Pipeline

- [ ] `process-turn.yml` — triggers on PR; runs engine; commits resolved world state; auto-merges on success, posts structured error on failure
- [ ] Order validation step — reject malformed or illegal orders before simulation runs
- [ ] LLM Chronicle generation — CI calls `engine/llm.py` to produce in-world commit message ([`llm.md §2`](docs/llm.md))
- [ ] Template fallback — all LLM call sites fall back to `engine/templates/*.json` when Ollama unreachable ([`llm.md`](docs/llm.md))
- [ ] `deploy-pages.yml` — publishes `client/` to GitHub Pages on push to `main`

---

### Phase 7 — Browser Client

- [ ] GitHub PKCE OAuth login flow — `client/js/auth.js`; `CLIENT_ID` in frontend; no secret ([`oauth.md §1`](docs/oauth.md))
- [ ] Fork setup — detect missing fork on first load, create via GitHub API, poll until ready ([`oauth.md §0`](docs/oauth.md))
- [ ] World state loading — `client/js/world.js`; fetch record arrays from raw content API; call `worldAt()` in browser ([`timeflow.md`](docs/timeflow.md), [`oauth.md §2`](docs/oauth.md))
- [ ] Map view — Canvas-rendered region cards with stability, entropy, belief, hero/army markers ([`menus.md §2.2`](docs/menus.md))
- [ ] Orders panel — compose orders JSON, validate client-side, submit as PR via 4-step GitHub API sequence ([`oauth.md §4`](docs/oauth.md), [`menus.md §6`](docs/menus.md))
- [ ] CI status polling — poll PR state and check-runs; show progress in Orders status badge ([`oauth.md §5`](docs/oauth.md))
- [ ] Event Viewer / Chronicle — fetch and render `history/events.log`; chronological feed with turn headers, keyword filter ([`menus.md §7`](docs/menus.md))
- [ ] Statistics panel — Chart.js line graphs of Trust, Belief, Entropy, army strength, unrest, Paperwork over time ([`menus.md §8`](docs/menus.md))
- [ ] Top bar — resources strip (Trust/Influence/Belief/Entropy/Paperwork with trend arrows), turn counter, orders status badge ([`menus.md §2.1`](docs/menus.md))

---

### Phase 8 — LLM Narrative Layer

All LLM call sites have template fallbacks. This phase adds quality but is never in the critical path.

- [ ] `engine/llm.py` — `generate()` base call to Ollama; `None` on failure ([`llm.md`](docs/llm.md))
- [ ] `narrate_event()` — one sentence per event, in-world tone ([`llm.md §1`](docs/llm.md))
- [ ] `narrate_turn_summary()` — in-world git commit message / Chronicle entry ([`llm.md §2`](docs/llm.md))
- [ ] `narrate_trait_mutation()` — one sentence on hero trait change ([`llm.md §3`](docs/llm.md))
- [ ] `narrate_proclamation()` — faction edict text for Event Viewer ([`llm.md §4`](docs/llm.md))
- [ ] `generate_hero_dialogue()` — spoken lines for voice pipeline ([`llm.md §5`](docs/llm.md))
- [ ] LLM-driven faction AI orders — validated against Pydantic schema; falls back to rule-based AI ([`llm.md §6`](docs/llm.md))
- [ ] `engine/templates/` — `events.json`, `proclamations.json`, `trait_mutations.json`, `turn_summary.json`

---

### Phase 9 — Multiplayer & Async Play

- [ ] `{userid}/world/incoming.json` — cross-player event queue; append-only; gains resolution fields ([`timeflow.md`](docs/timeflow.md))
- [ ] Engine resolves incoming events at receiver's current turn, not sender's ([`timeflow.md §5`](docs/timeflow.md))
- [ ] Diplomatic offer / military attack cross-timeline resolution rules ([`timeflow.md §5`](docs/timeflow.md))
- [ ] Turn deadline enforcement — cron-triggered CI job closes submission window and resolves all pending PRs
- [ ] Rival stats overlay in Statistics panel — read rivals' public fork data via raw content API
- [ ] Cheater isolation — CI detects fork detached from upstream; refuses to process; narrative: excommunication event
- [ ] File compaction — `engine/timeflow.py compact()` for long-running worlds; CI commit marks compaction point ([`timeflow.md §6`](docs/timeflow.md))

---

### Phase 10 — Portraits, Voice & Lip-Sync

Optional depth; significant production value uplift. Fallback (text + neutral portrait) works without this phase.

- [ ] Stable Diffusion portrait generation — 4 expression sprites per hero from trait descriptors ([`lip-sync.md §1`](docs/lip-sync.md))
- [ ] `/{userid}/assets/heroes/{hero_id}/` — `neutral.png`, `talking.png`, `surprised.png`, `angry.png`, `metadata.json`
- [ ] Kokoro TTS in CI — `engine/voice.py synthesise()` → `voice.mp3` + word timing ([`lip-sync.md §2`](docs/lip-sync.md))
- [ ] Rhubarb lip-sync — `visemes.json` from audio + transcript ([`lip-sync.md §3`](docs/lip-sync.md))
- [ ] `client/js/portrait.js PortraitPlayer` — Canvas animation driven by viseme schedule ([`lip-sync.md §4`](docs/lip-sync.md))
- [ ] `engine/assets.py generate_hero_voice_assets()` — full pipeline called from CI after turn resolves ([`lip-sync.md §5`](docs/lip-sync.md))
- [ ] Audio fallback — text dialogue box + neutral sprite when TTS unavailable ([`lip-sync.md §6`](docs/lip-sync.md))

---

## Credits

Alexei Fedotov · http://www.dataved.ru/
