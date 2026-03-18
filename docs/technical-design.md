# Conspiracy — Technical Design Document

**Game:** Conspiracy: A Simulation of Power, Paranoia, and Poor Decision-Making
**Author:** Alexei Fedotov
**Version:** 0.1 – Technical Edition
**Date:** 2026-03-18

---

## 1. Overview

*Conspiracy* is a darkly humorous civilization simulation sandbox. Players influence (not rule) a multi-layered dominion through bureaucracy, hero management, and ideological manipulation. The game draws inspiration from Crusader Kings II, Dwarf Fortress, Victoria, RimWorld, Tyranny, and Hearts of Iron IV.

**Core fantasy:** "Accumulate power. Scale the agents and long-term projects that sustain it. Prevent it from collapsing under its own weight. Outperform and outplay your rivals."

---

## 2. Engine & Platform

| Concern | Recommendation |
|---|---|
| Client | Plain HTML + Canvas + Chart.js — deployed to GitHub Pages |
| Simulation engine | Python — turn processor, faction AI, event engine, CI pipeline |
| Client/server protocol | GitHub REST API (fetch world state JSON; submit orders as PR) |
| World storage | GitHub — each player world is a fork of the canonical repo |
| Turn processing | Python CI job triggered by PR; commits resolved world state |
| Client deployment | GitHub Actions → GitHub Pages on every push to `master` |
| Divergence handling | Git diff/merge as native world-state conflict resolution |
| Localization | JSON-based, modular, per-language myth generation |

### 2.0. Architecture Split: Python + Browser Client

The game is divided into two independent components with a clean boundary:

```
┌──────────────────────────────────┐        ┌──────────────────────────────┐
│   Browser client (GitHub Pages)  │        │     Python (simulation)      │
│                                  │        │                              │
│  - Map (Canvas)                  │ GitHub │  - Turn processor (CI)       │
│  - Order input + PR submission   │  API   │  - Faction AI                │
│  - Event viewer                  │◄──────►│  - Event engine              │
│  - Statistics (Chart.js)         │        │  - Belief/Trust economy      │
│                                  │        │  - Order validator           │
└──────────────────────────────────┘        └──────────────────────────────┘
        reads world state JSON                   writes world state JSON
        via GitHub raw content API               to fork (git commit via CI)
```

**Python owns all game logic.** The browser client is a viewer and input collector — it has no simulation state of its own.

**Data flow per turn:**
1. Player opens the client at `https://{userid}.github.io/realm`
2. Client fetches world state JSON from the player's fork via GitHub raw content API
3. Player composes orders in the Orders panel; client opens a PR via GitHub API
4. CI triggers Python simulation engine on the PR
5. Python resolves the turn, commits updated world state JSON; PR auto-merges
6. Player reloads client — fetches new world state and re-renders

**Python stack:**
- Standard library + `pydantic` for world state schemas
- `pytest` for simulation engine unit tests (determinism is testable)
- No game framework needed — pure data transformation

**Browser client stack:**
- Vanilla HTML/CSS/JS — no build step, no bundler
- Canvas API for map rendering (region cards, armies, heroes)
- Chart.js (CDN) for Statistics panel graphs
- Native `fetch()` for GitHub REST API calls
- `localStorage` for config (token, userid, repo)
- Deployed to GitHub Pages via `deploy-pages.yml` workflow on every push to `master`

**Event Viewer module (client-side):**
- Dedicated panel that fetches and renders `history/events.log` after each turn resolves
- Displays events as a chronological feed — narrative tone, in-world language
- Supports keyword filtering (faction, hero, region)
- Turn headers and world events colour-coded for readability
- Doubles as a post-turn debrief screen and long-form chronicle browser

**Statistics module (client-side):**
- Chart.js line graphs of key world metrics over time
- Data sourced from per-turn `history/stats_{turn}.json` snapshots written by Python engine
- Fetched from GitHub raw content API — no extra backend needed

Tracked metrics (per turn, plotted over time):

| Metric | Description |
|---|---|
| Trust | Dominion-wide trust level; primary currency curve |
| Belief index | Aggregate population belief; drives resource availability |
| Army strength | Total military strength across all armies |
| Avg unrest | Average unrest across all regions |

- Player can overlay their own stats against rivals' public metrics (read from their fork)
- Sharp drops and spikes visually apparent from the line shape

### 2.1. GitHub as World Storage

*Conspiracy* is **turn-based**. Each turn, players issue orders; those orders are submitted as a pull request against their world fork. A CI pipeline triggered by the PR runs the simulation engine, resolves the turn, and commits the resulting world state back to the fork.

Each player world is a **fork** of the canonical `realm` repository. World state is serialized as versioned files committed to that fork.

**Structure:**
```
realm/                             ← canonical upstream (god-tier defaults)
  /{userid}/                       ← all objects owned by this player
    world/
      factions.json
      heroes.json
      regions.json
      economy.json
      belief.json
    orders/                        ← player order files for the current turn
      turn_042_orders.json
    history/                       ← append-only event journal (git log = world history)
      events.log
    lore/                          ← procedurally generated myth fragments
  /shared/                         ← global state not owned by any single player
    world_map.json
    turn.json                      ← current turn number and deadline
    leaderboard.json
  .github/
    workflows/
      process-turn.yml             ← CI workflow: validates and resolves player orders
```

Each player forks this repo on account creation. Their fork is their world. All game objects (heroes, factions, regions, orders) live under `/{userid}/` — the owning player has full write authority over their subtree; CI enforces that players cannot modify other players' paths.

**Turn lifecycle:**

```
1. Player submits orders → commits orders/turn_N_orders.json to a branch
2. Player opens PR against their fork's main branch
3. CI pipeline triggers on PR (process-turn.yml)
4. CI runs simulation engine:
   a. Validates order legality (faction rules, resource constraints)
   b. Resolves order conflicts and interactions
   c. Runs faction AI, event engine, belief economy for this turn
   d. Writes updated world state files
   e. Appends to history/events.log
5. CI commits resolved world state to the PR branch
6. PR is auto-merged if simulation succeeds; rejected with error report if invalid
7. Player pulls main to see the new world state
```

**Key mechanics mapped to Git operations:**

| Game Concept | Git Operation |
|---|---|
| New player world | Fork of canonical upstream repo |
| Player submits turn orders | Commit `orders/turn_N_orders.json` + open PR |
| Turn resolution | CI runs on PR, commits resolved state, auto-merges |
| Invalid orders | CI fails PR with structured error report (review comments) |
| World history | `git log` — immutable, auditable chronicle of every turn |
| Multiplayer interaction | PR from one player's fork targeting another's |
| Diplomatic treaty / alliance | Merged PR between world forks |
| Cheater isolation | Fork detached from upstream; CI refuses to run |
| Corrupted alternate timeline | Fork with diverged history that cannot fast-forward |
| Canonical lore / rules patch | Upstream commit; players pull to sync world rules |
| Player takeover / conquest | Forced merge or rebase of defeated player's fork |

**CI workflow (`process-turn.yml`) responsibilities:**
- Checkout world state + incoming orders branch
- Run order validator (schema check, rule enforcement)
- Run simulation engine (headless, deterministic)
- Write updated JSON world state files
- Generate turn summary (narrative commit message, in-world tone)
- Auto-merge on success; post structured failure report as PR review on error

**Commit messages as chronicle:**
- Every CI-resolved turn produces a commit message written as an in-world chronicle entry
- Example: `"Turn 42: The Bureau of Conspiracies approved three contradictory edicts. Harvest yields shifted 14% toward disbelief."`
- `git log --oneline` is a readable history of the world

**Large assets:**
- Terrain, maps, and binary assets stored via Git LFS
- World state diffs per turn are human-readable JSON — inspectable, moddable, version-controlled

**Open questions:**
- GitHub Actions minutes at scale — may require Gitea/Forgejo with Woodpecker CI per cluster
- Turn deadline enforcement: time-gated CI trigger (cron) vs. player-initiated PR
- Conflict resolution when multiple players submit orders affecting the same world entity in the same turn
- Snapshot compression for long-running worlds with hundreds of turns of git history

---

## 3. Architecture

### 3.1. Simulation Loop

*Conspiracy* is turn-based. The simulation engine runs **once per turn**, triggered by a player's PR on their world fork. The engine is headless and deterministic — given the same world state and orders, it always produces the same result.

Each turn resolves in order:

1. **Order validation** — player orders checked against faction rules and resource constraints
2. **Order conflict resolution** — simultaneous orders affecting shared entities are arbitrated (priority by Trust level, then randomized)
3. **Event queue** — procedural cause-and-effect chains from prior turn consequences
4. **Faction AI** — autonomous societies update economy, ideology, crime
5. **Hero agents** — personality matrix mutations, skill graph updates
6. **Belief economy** — resource generation/destruction based on population confidence
7. **Global event triggers** — world-scale misunderstandings evaluated against thresholds
8. **World state commit** — updated JSON files committed to the PR branch; CI auto-merges

The simulation engine is a **Python program** invoked by CI, not a persistent server. It is stateless between turns — reads world state JSON in, writes world state JSON out. Inspiration: Dwarf Fortress resolution logic, RimWorld's storyteller, applied deterministically per-turn.

### 3.2. Layer Architecture

The world is divided into three simulation layers, each running semi-autonomously:

| Layer | Scope | Key Systems |
|---|---|---|
| Surface (Realms) | Nations, factions, politics | Trust economy, propaganda, policy |
| Underworld (Subrealms) | Dwarfs, daemons, faith economies | Underground infrastructure, forgotten tech |
| Digital layer | Simulation metadata, god-tier management | Divine Simulator, entropy tracking |

### 3.3. Event System

- Procedural event engine chains events through AI gossip networks
- Events rewrite historical memory (similar to CK2 narrative events)
- Global events are seeded by faction state, hero actions, and belief thresholds
- Event templates stored as JSON; support runtime narrative generation (GPT-style micromodel or JSON-template fallback)

---

## 4. Core Systems

### 4.1. Trust Economy

- **Trust** replaces gold as the primary currency
- Generated by public promises; destroyed by fulfilling them
- Economy rises/falls on propaganda management, not material production
- Modeled after Victoria's POP system, driven by ideological confidence rather than material surplus

### 4.2. Belief Economy

- Resources are generated by *what populations believe to exist*
- Disbelief triggers material deconstruction (e.g., loss of faith in agriculture → harvests vanish)
- Blends Victoria's POP model with Dwarf Fortress material simulation

### 4.3. Faction AI

Each faction runs an autonomous simulation tracking:
- Economy, crime, ideology
- Procedural event generation
- Inter-faction conspiracy registration (via the Bureau of Conspiracies as world moderator)

Factions:

| Faction | System Role |
|---|---|
| Bureau of Conspiracies | World moderator; handles save integrity, lore patching |
| Church of Necessary Evil | Moral laundering; Victoria moral reform + Tyranny faction politics |
| Syndicate of Flesh | Hero breeding, training, marketing |
| Shadow Guilds | Late-game meta mechanic; NPC rebellion against player interventions |

### 4.4. Hero System

Heroes are procedural agents with two core data structures:

- **Skill Graph** — abilities evolve through contextual use
- **Personality Matrix** — traits mutate through failure

Implementation notes:
- Merge CK2-style family/trait systems with Songs of Syx-scale population data
- Every citizen traceable to procedural ancestry
- Heroes produced by Syndicate of Flesh have configurable moral parameters and trauma backstories

### 4.5. Population System

Populations are treated as collective characters:
- Villages accumulate vices (e.g., "Drunken Productivity")
- Dynasties accumulate generational traits (e.g., "Generational Paranoia")
- Simulates millions of procedural citizens with opinions, jobs, and behaviors

### 4.6. Dominion System (Player Control)

Players influence their realm through three control layers:

| Layer | Mechanisms |
|---|---|
| Administrative | Policy, taxation, propaganda |
| Heroic | Direct action via agents, adventurers, demigods |
| Infrastructure | Construction, population management, faith networks |

All commands are filtered through bureaucracy and belief before execution — player intent ≠ outcome.

### 4.7. Magic & Technology System

- Unified **tech tree + belief tree**
- Progress has both rational and mythic costs
- Innovation increases public unrest ("new things cause change")
- Spells/technologies require licenses (paperwork points) and/or sacrificial costs

Example entries:
- *Sanctioned Teleportation*: 12 paperwork points + 1 victim
- *Civic Necromancy*: unlocks dead labor force; high PR risk

### 4.8. Military System

Inspired by Hearts of Iron IV — military power is a managed resource of doctrine, logistics, and personnel, not raw unit counts. Players do not command individual soldiers; they design military organizations, assign commanders, and issue strategic orders. Execution is handled autonomously by the simulation.

**Core concepts:**

- **Armies are organizations**, not stacks. Each army has a doctrine, a supply chain, a commander personality, and a morale state.
- **Generals are heroes.** Military commanders are full hero agents (Skill Graph + Personality Matrix). A brilliant general with paranoia will rout when flanked; a mediocre one with high loyalty will hold the line past reason.
- **Orders are strategic, not tactical.** Players issue directives (advance, hold, encircle, raid supply lines) — not move commands. The simulation resolves how the army interprets and executes them based on commander traits and doctrine.

**Military order flow (per turn):**

```
Player writes military orders → orders/turn_N_orders.json
  e.g. { "army": "3rd Legion", "directive": "encircle", "target_region": "Valdenmoor" }

CI resolves:
  1. Check supply state of army
  2. Evaluate commander's interpretation (modified by personality traits)
  3. Resolve engagement against defender (doctrine vs. doctrine, morale vs. morale)
  4. Apply casualties, territory changes, morale shifts
  5. Generate narrative event entry (e.g. "The 3rd Legion encircled Valdenmoor. General Hoss misread the orders and took the scenic route.")
```

**Key stats per army:**

| Stat | Description |
|---|---|
| Strength | Headcount and equipment level |
| Morale | Will to fight; collapses faster than strength |
| Supply | Logistics chain; armies cut off from supply decay rapidly |
| Doctrine | Combat style (attrition, maneuver, siege, raid) |
| Commander loyalty | How faithfully orders are executed |
| Commander competence | Quality of autonomous tactical decisions |

**HoI4 influences:**
- Supply lines as a strategic resource — cutting them is often more powerful than direct combat
- Doctrine selection shapes how the army behaves under autonomous resolution
- Front lines and encirclement as strategic concepts, not tile-by-tile movement
- Attrition and overextension as natural brakes on conquest

**Belief interaction:**
- Army morale is partially driven by the belief economy — soldiers fight harder for a cause populations believe in
- A faction that loses public faith sees military morale decay even without battlefield losses

---

## 5. Player Actions (UI Events)

| Action | Description |
|---|---|
| Observe Map | Monitor dominion sanity index across layers |
| Review Research | Assign scholars to cursed/forgotten sciences |
| Train Generals | Build personality profiles, not army stats |
| Simulate Construction | Infrastructure grows from communal belief |
| Divine Simulator | Manipulate fate probabilities via spreadsheet UI |

---

## 6. User Interface

**Philosophy:** Clarity through irony.

- **Desktop/Widescreen:** Multi-panel layout — map view, bureaucracy log, divine inbox
- **Mobile:** Stripped to three core actions — *Approve*, *Deny*, *Blame*
- Frontend communicates with simulation backend via JSON event bus
- Panels should reflect simulation state asynchronously (event-driven updates, not polling)

---

## 7. Multiplayer

- Each player's world is a fork; multiplayer interaction happens via PRs between forks
- Simultaneous turns: players submit PRs independently; CI resolves each world's turn separately, then reconciles cross-player interactions in a shared arbitration step
- Cheaters are isolated into divergent timelines — fork detached from upstream, CI refuses to process orders; narrative framing: excommunication into an alternate reality
- Divergent cheater timelines may reconnect later as corrupted mythologies (read-only import into other worlds' lore)
- Turn deadline: a scheduled CI job (cron) closes the submission window and triggers resolution for all pending PRs in a multiplayer session

---

## 8. Single-Player Features

- **Betrayal system** — auto-generated via friendship decay curves
- **Duel mechanics** — require bureaucratic approval delays before resolution
- **Procedural humor engine** — AI characters comment on player actions (tragic office sitcom tone)
- **Tower defense sub-loop** — defend ideological integrity from encroaching logic
- **Procedural dialogue** — GPT-style micromodel or JSON-based narrative templates

---

## 9. Endgame

- No hard win condition; influence decays, trust evaporates
- True objective: understand the system before it forgets you exist
- **Meta-ending candidate:** player merges with simulation as an AI myth, becoming procedural history
- NPC late-game rebellion: Shadow Guilds expose "the final conspiracy" — the player — triggering AI resistance mechanics

---

## 10. Setting Variants

Each variant repaints the same systems with a new aesthetic:

| Variant | Theme |
|---|---|
| Default Fantasy Bureaucracy | Divine auditors, miracle regulation |
| Post-Apocalyptic Hong Kong / Shadowrun | Neon bureaucracy, ritual debt |
| Secret World Mode | Modern conspiracies mapped to real-world geography (Google Earth polygons) |

---

## 11. Localization

- All narrative text stored as modular JSON
- Per-language adaptation of conspiracies to regional absurdities
- Support for dynamic myth generation at runtime
- No hardcoded strings; all UI/event text routed through localization layer

---

## 12. Open Technical Questions

- Python simulation engine performance at millions-of-citizens scale (consider PyPy or selective Cython for hot paths)
- Micromodel for procedural dialogue: embedded LLM via API vs. weighted JSON template trees
- GitHub token exposure: client stores token in `localStorage` — acceptable for private beta, needs server-side proxy for public release
- Turn deadline enforcement: time-gated CI cron trigger vs. player-initiated PR
- CORS limitations for GitHub API from GitHub Pages (currently mitigated by using raw content URLs for reads)

---

*"In the end, the most dangerous conspiracy is that the system works."*
