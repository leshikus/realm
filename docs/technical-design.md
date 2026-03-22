# Conspiracy — Technical Design Document

**Game:** Conspiracy: A Simulation of Power, Paranoia, and Poor Decision-Making
**Author:** Alexei Fedotov
**Version:** 0.2 – Technical Edition
**Date:** 2026-03-22

---

## Documentation Index

All design documents for *Conspiracy* live in `docs/`. Each covers a distinct system. This document is the technical hub — it describes the architecture and references the others.

| Document | System | What it covers |
|---|---|---|
| [`lore.md`](lore.md) | World & narrative | Setting, factions, core pillars, economy of belief, philosophy |
| [`regions.md`](regions.md) | Regions | Resource model, population strata, real-world Earth regions, stability/entropy/belief mechanics |
| [`missions.md`](missions.md) | Missions & policies | JSON schemas, requirement types, reward types, mission trees, policy execution flow |
| [`tech.md`](tech.md) | Technology | Continuous tech levels, 7 directions, investment/decay/diffusion formula, education multiplier, crisis loss |
| [`role-playing.md`](role-playing.md) | Heroes | Skill Graph, Personality Matrix, mission duration/quality, fatigue, trait acquisition, Syndicate procurement |
| [`menus.md`](menus.md) | UI & menus | Full client panel layout, Orders panel, Chronicle/Event Viewer, Statistics, all menu screens |
| [`timeflow.md`](timeflow.md) | World state & async play | Timestamped append-only records, `world_at()`, cross-timeline interactions, file compaction |
| [`oauth.md`](oauth.md) | Auth & order submission | GitHub PKCE OAuth, fork setup, order PR submission flow, CI polling, error reference |
| [`llm.md`](llm.md) | LLM integration | Ollama setup, call sites (event narration, Chronicle, trait mutation, faction proclamations, hero dialogue), template fallback |
| [`lip-sync.md`](lip-sync.md) | Portraits & voice | Stable Diffusion portrait generation, TTS (Kokoro/ElevenLabs), Rhubarb lip-sync, Canvas animation |

---

## 1. Overview

*Conspiracy* is a darkly humorous civilization simulation sandbox. Players influence (not rule) a multi-layered dominion through bureaucracy, hero management, and ideological manipulation. The game draws inspiration from Crusader Kings II, Dwarf Fortress, Victoria, RimWorld, Tyranny, and Hearts of Iron IV.

**Core fantasy:** "Accumulate power. Scale the agents and long-term projects that sustain it. Prevent it from collapsing under its own weight. Outperform and outplay your rivals."

**What the player does each turn:**
1. Read the Chronicle — learn what the world did while you weren't watching
2. Assess damage — check entropy spikes, loyalty drops, belief drift
3. Decide — allocate Trust, assign heroes, queue missions, register conspiracies
4. Submit orders — commit your intentions to the simulation
5. Wait — the simulation resolves your turn, the world responds, history is written

**What the game makes the player feel:**
- *Competent but not omnipotent.* Orders are interpreted, not executed. A brilliant plan can be undone by a general who "misread the directive."
- *Responsible for consequences they didn't intend.* The simulation is causal. Bad events from turn 12 will announce themselves on turn 27.
- *Fascinated by their own downfall.* When the Dominion collapses, the Chronicle should make it a story worth reading.

---

## 2. The Game Loop

### 2.1 Turn Structure

Each turn is a closed loop of four phases. The player participates in phases 1 and 2; the simulation runs phases 3 and 4.

```
┌─────────────────────────────────────────────────────────────┐
│  PHASE 1: DEBRIEF                                           │
│  Player reads Chronicle — what happened last turn.          │
│  Event Viewer surfaces narrative events, faction moves,     │
│  hero mutations, belief drift, entropy spikes.              │
│  The world explains itself in bureaucratic prose.           │
└─────────────────────────────────────────────────────────────┘
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  PHASE 2: ORDERS                                            │
│  Player assesses world state, makes decisions, submits.     │
│  Budget Trust and Influence. Assign missions. File decrees. │
│  Register conspiracies. Queue construction. Set policy.     │
│  Commit orders as a PR. The simulation will interpret them. │
└─────────────────────────────────────────────────────────────┘
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  PHASE 3: RESOLUTION (Python CI)                            │
│  Simulation engine runs headless. Deterministic.            │
│  Validates orders. Resolves conflicts. Runs faction AI.     │
│  Applies belief economy, event chains, hero mutations.      │
│  Writes updated world state. Generates Chronicle entry.     │
└─────────────────────────────────────────────────────────────┘
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  PHASE 4: CONSEQUENCE                                        │
│  Updated world state commits to the player's fork.          │
│  Player reloads client — the world has moved on.            │
│  Some orders worked. Some were misinterpreted.              │
│  One event was not predicted. History now includes it.      │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 Turn Pacing & Tension

Turns are **not real-time**. The player submits orders and waits for resolution. This is intentional:

- **Asynchronous tension** — the player's orders are locked; they cannot revise them once submitted. Every submission is a commitment.
- **Anticipation as gameplay** — the gap between submission and resolution creates dread and anticipation. "Did the assassination succeed? Did the coup hold?"
- **The Chronicle as reward** — resolution delivers a narrative payoff. Even catastrophic failures should read as great storytelling.
- **Turn deadlines in multiplayer** — a scheduled CI cron closes the submission window. Late orders are forfeit. The simulation does not wait.

### 2.3 Progression Arc

| Phase | Turns | Player experience | Primary threat |
|---|---|---|---|
| Early | 1–10 | Learning the systems; building the base; first characters emerge | Entropy from inexperience; naive decrees |
| Mid | 11–30 | Branching missions; faction conflicts intensify; heroes develop vices | Rivals gaining ground; belief drift; overextension |
| Late | 31+ | Endgame branches; irreversible choices; Shadow Guilds stir | Cascade collapse; the player as conspiracy target |
| Terminal | Variable | The simulation has decided you are the problem | Everything |

---

## 3. Engine & Platform

| Concern | Decision | Why it serves the game |
|---|---|---|
| Client | Plain HTML + Canvas + Chart.js → GitHub Pages | No install friction. Player forks and plays immediately. The map is the game. |
| Simulation engine | Python — turn processor, faction AI, event engine | Pure data transformation. Deterministic. Testable. No runtime state between turns. |
| Client/server protocol | GitHub REST API (fetch world state JSON; submit orders as PR) | The protocol *is* the game mechanic. Orders are PRs. History is `git log`. |
| World storage | GitHub — each player world is a fork | Each fork is a living world. The diff between turns is the turn report. |
| Turn processing | Python CI job triggered by PR; commits resolved world state | CI is the simulation engine's execution environment. No server needed. |
| Client deployment | GitHub Actions → GitHub Pages on push to `main` | Zero-cost hosting. Instant deploy. |
| Divergence handling | Git diff/merge as native world-state conflict resolution | Cheater isolation and timeline divergence fall out naturally from git semantics. |
| Localization | JSON-based, modular, per-language myth generation | Conspiracies should be culturally adapted. Different regions, different absurdities. |

### 3.1 Architecture Split: Python + Browser Client

The game is divided into two components with a clean boundary. **Python owns all game logic.** The browser is a viewer and order collector — it has no simulation state of its own.

```
┌──────────────────────────────────┐        ┌──────────────────────────────┐
│   Browser client (GitHub Pages)  │        │     Python (simulation)      │
│                                  │        │                              │
│  - Map (Canvas)                  │ GitHub │  - Turn processor (CI)       │
│  - Order input + PR submission   │  API   │  - Faction AI                │
│  - Event viewer / Chronicle      │◄──────►│  - Event engine              │
│  - Statistics (Chart.js)         │        │  - Belief/Trust economy      │
│                                  │        │  - Order validator           │
└──────────────────────────────────┘        └──────────────────────────────┘
        reads world state JSON                   writes world state JSON
        via GitHub raw content API               to fork (git commit via CI)
```

**Data flow per turn:**
1. Player opens the client at `https://{userid}.github.io/conspiracy`
2. Client fetches world state JSON from the player's fork via GitHub raw content API
3. Player composes orders in the Orders panel; client opens a PR via GitHub API
4. CI triggers Python simulation engine on the PR
5. Python resolves the turn, commits updated world state JSON; PR auto-merges
6. Player reloads client — fetches new world state and re-renders

**Python stack:**
- Standard library + `pydantic` for world state schemas
- `pytest` for simulation engine unit tests (determinism is testable)
- No game framework — pure data transformation

**Browser client stack:**
- Vanilla HTML/CSS/JS — no build step, no bundler
- Canvas API for map rendering (region cards, armies, heroes)
- Chart.js (CDN) for Statistics panel graphs
- Native `fetch()` for GitHub REST API calls
- `localStorage` for config (token, userid, repo)
- Deployed to GitHub Pages via `deploy-pages.yml` on push to `main`

**Event Viewer / Chronicle (client-side):**
- Fetches and renders `history/events.log` after each turn resolves
- Displays events as a chronological feed — narrative tone, in-world language
- Keyword filtering: faction, hero, region
- Turn headers and events colour-coded by severity
- This is the primary storytelling surface of the game. Every turn resolution should produce a Chronicle entry worth reading.

**Statistics module (client-side):**
- Chart.js line graphs of key world metrics over time
- Data from per-turn `history/stats_{turn}.json` snapshots written by Python
- Fetched from GitHub raw content API — no extra backend

| Metric | What it measures | What a sharp drop means |
|---|---|---|
| Trust | Primary currency — the Dominion's credibility | Promises were kept, or propaganda collapsed |
| Belief index | Population ideological confidence | Reality is losing consensus — resources will follow |
| Entropy | Systemic instability across all regions | A cascade event is imminent. Check the Chronicle. |
| Army strength | Total military capacity across all armies | A general defected, a campaign failed, or supply lines were cut |
| Avg unrest | Population dissatisfaction, averaged | Someone over-taxed, over-promised, or under-fed |
| Paperwork index | Administrative backlog | Too many decrees, not enough bureaucrats |

Player can overlay their own stats against rivals' public metrics (read from rival forks). The graph shape tells the story before the Chronicle does.

### 3.2 GitHub as World Storage

Each player world is a **fork** of the canonical `conspiracy` repository. World state is serialised as versioned JSON committed to that fork.

```
conspiracy/                        ← canonical upstream (god-tier defaults)
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
      stats_{turn}.json
    lore/                          ← procedurally generated myth fragments
  /shared/                         ← global state not owned by any single player
    world_map.json
    turn.json                      ← current turn number and deadline
    leaderboard.json
  .github/
    workflows/
      process-turn.yml             ← CI workflow: validates and resolves player orders
```

**Git operations as game mechanics:**

| Game concept | Git operation | Player experience |
|---|---|---|
| New player world | Fork of canonical upstream repo | "Your dominion has been registered. Form NP-1/A accepted." |
| Submit turn orders | Commit `orders/turn_N_orders.json` + open PR | Orders locked. No revisions. The simulation will interpret, not obey. |
| Turn resolution | CI runs on PR, commits resolved state, auto-merges | The world moves forward. History is written. |
| Invalid orders | CI fails PR with structured error report | "Your orders were rejected by the validator. Form R-9/B attached." |
| World history | `git log` — immutable, auditable turn chronicle | Every commit message is a historical record in the game's voice. |
| Multiplayer interaction | PR from one player's fork targeting another's | Diplomacy, invasion, espionage — all modelled as cross-fork operations. |
| Diplomatic treaty | Merged PR between world forks | The treaty is in the git history. It cannot be undone without a visible revert. |
| Cheater isolation | Fork detached from upstream; CI refuses to run | Narrative: excommunicated into an alternate timeline. |
| Corrupted timeline | Fork with diverged history that cannot fast-forward | That world still exists — as a corrupted mythology, readable but unplayable. |
| Canonical rules patch | Upstream commit; players pull to sync world rules | The Bureau of Conspiracies has issued an errata. All parties are affected. |
| Conquest | Forced merge or rebase of defeated player's fork | The defeated world's history is absorbed into the victor's Chronicle. |

**Commit messages as Chronicle:**
- Every CI-resolved turn generates a commit message written as an in-world Chronicle entry
- Example: `"Turn 42: The Bureau of Conspiracies approved three contradictory edicts. Harvest yields shifted 14% toward disbelief."`
- `git log --oneline` is a readable history of the world

**Turn lifecycle:**
```
1. Player commits orders/turn_N_orders.json to a branch
2. Player opens PR against their fork's main branch
3. CI triggers (process-turn.yml)
4. Simulation engine runs:
   a. Validates order legality (faction rules, resource constraints)
   b. Resolves order conflicts and interactions
   c. Runs faction AI, event engine, belief economy
   d. Writes updated world state files
   e. Appends Chronicle entry to history/events.log
5. CI commits resolved state to the PR branch
6. PR auto-merges on success; fails with structured error report if invalid
7. Player reloads client — the new world state is live
```

**Open questions:**
- GitHub Actions minutes at scale — may require Gitea/Forgejo with Woodpecker CI per cluster
- Turn deadline enforcement: time-gated CI cron vs. player-initiated PR
- Conflict resolution when multiple players submit orders affecting the same entity in the same turn
- Snapshot compression for long-running worlds with hundreds of turns of git history

---

## 4. Simulation Architecture

### 4.1 Simulation Loop

The engine is headless, deterministic, and stateless between turns. Given identical world state and orders, it always produces identical output. This is a testability and fairness requirement.

Each turn resolves in strict order. **Sequence matters** — order validation runs before AI, belief economy before event triggers, so player actions this turn affect AI and event rolls within the same turn.

```
1.  Order validation          ← player orders checked against rules and resources
2.  Order conflict resolution ← simultaneous orders on shared entities arbitrated
                                 (priority: Trust level, then deterministic random seed)
3.  Event queue               ← consequences queued from prior turns now fire
4.  Faction AI                ← autonomous factions update economy, ideology, crime
5.  Hero agents               ← personality mutations, skill graph updates, loyalty checks
6.  Belief economy            ← resources generated/destroyed by population confidence
7.  Entropy resolution        ← regional entropy thresholds checked; cascades triggered
8.  Global event triggers     ← world-scale misunderstandings evaluated against thresholds
9.  World state commit        ← updated JSON written; CI auto-merges the PR
10. Chronicle generation      ← turn summary written as in-world narrative commit message
```

**Design implication:** The player submits orders before seeing step 3 (event queue). Events queued from last turn fire regardless of what the player ordered this turn. This is intentional — it creates consequences the player cannot dodge, only manage.

### 4.2 World Layers

Three simulation layers run semi-autonomously each turn. Each layer has its own event table, resource model, and AI behaviour.

| Layer | Scope | Key systems | Player access |
|---|---|---|---|
| Surface (Conspiracies) | Nations, factions, politics | Trust economy, propaganda, policy, military | Full — primary play surface |
| Underworld (Sub-conspiracies) | Dwarfs, daemons, faith economies | Underground infrastructure, forgotten tech, Archival Trust | Unlocked via mission chain |
| Digital layer | Simulation metadata, god-tier management | Divine Simulator, entropy tracking, reality maintenance | Late-game / Forbidden Knowledge branch |

Layers interact. A Sub-conspiracy faith collapse below the surface can spike Entropy in the surface region above it. A Digital Enclave belief failure can corrupt event logs. These cross-layer effects are the simulation's most chaotic outputs — and the most interesting Chronicle entries.

### 4.3 Event System

> Narrative generation for events is handled by the LLM integration — see [`llm.md`](llm.md).

Events are the primary storytelling mechanism. They fire from faction state, hero actions, belief thresholds, and entropy levels. They chain through AI gossip networks — one event can trigger three more, each affecting different actors.

- Event templates stored as JSON; support runtime narrative generation (LLM API or JSON-template fallback)
- Events *rewrite historical memory* — factions update their internal records, heroes update their grudge lists, populations update their vices
- Global events ("A god filed for bankruptcy") seed from world-scale threshold checks
- Personal events ("The Grand Auditor has developed a superstition") seed from hero Personality Matrix state

**Event delivery to the player:** the Chronicle. Every event should read like a dispatch from a ministry that is deeply unsurprised by the catastrophe it is reporting.

---

## 5. Core Systems

> See [`regions.md`](regions.md) for full resource model, population strata, Earth region profiles, and stability/entropy mechanics. See [`missions.md`](missions.md) for policy and mission JSON schemas, execution flow, and mission trees. See [`tech.md`](tech.md) for the continuous technology level system.

### 5.1 Trust Economy

Trust is the Dominion's primary currency and its most structurally perverse resource.

- **Generated** by making public promises (propaganda, decrees, treaties)
- **Destroyed** by fulfilling them (fulfilment is expensive; promises are cheap)
- Economy rises and falls on *narrative management*, not material production

**Player experience:** The player is incentivised to accumulate trust by promising things, then structurally discouraged from delivering on those promises. Every fulfilled promise drains the resource that generated it. This creates a natural tension between short-term credibility building and long-term solvency.

**Design goal:** The player should regularly face choices where the honest action is economically suboptimal. The game should never punish the player for *choosing* honesty — but the simulation should make honesty *cost something*.

### 5.2 Belief Economy

Resources in *Conspiracy* are generated by what populations *believe to exist*.

- High agricultural belief → harvests materialise → food production high
- Loss of faith in agriculture → harvests don't materialise → famine event
- Material reality follows ideological confidence, not the other way around

**Player experience:** Belief is both a resource and a stability system. The player must actively maintain population belief in the things the Dominion needs. Neglected belief drifts; drifted belief deconstructs material output; deconstructed output triggers events that further undermine belief. This loop is the game's core doom spiral.

**Design goal:** Belief collapse should feel slow and then sudden. The player watches the Belief Index decline for 5 turns, each turn telling themselves it will stabilise. Turn 6 is when the harvests vanish.

### 5.3 Entropy

Entropy is systemic pressure. It accumulates from unresolved crises, failed policies, active cults, covert operations, and high Paperwork backlog. It decays only through deliberate stability investment.

- **0–49:** Background noise. The system is functioning.
- **50–74:** Crisis events begin rolling. Something will happen; unclear when.
- **75–89:** Entropy Alarm fires in the HUD. Severe events likely.
- **90–99:** Cascade event guaranteed within 1–3 turns.
- **100:** Collapse. Region revolts. Controller changes.

**Player experience:** Entropy is the game's pressure gauge. The player cannot ignore it indefinitely. But managing it requires spending Trust and Influence — the same resources needed for expansion. Every Dominion that collapses does so because it was growing faster than it was stabilising.

**Design goal:** Entropy should feel like a debt that accumulates quietly and demands payment at the worst possible moment.

### 5.4 Paperwork

Every action generates Paperwork. Every decree, mission, order, and inquiry adds to the administrative backlog. Left unmanaged, Paperwork overflows into passive Entropy generation and administrative paralysis (decrees go unread; missions are delayed).

- Reduced by: Bureaucratic Reform tech, Grand Auditor advisor, administrative policies
- The player who optimises aggressively without managing Paperwork will hit a bureaucratic wall mid-campaign

**Player experience:** Paperwork is a soft cap on action throughput. It punishes players who issue too many orders too fast. It rewards players who invest in administrative efficiency. It is the game's way of saying: *the simulation has limits, and so do you*.

### 5.5 Faction AI

Each faction runs an autonomous simulation each turn:

| Faction | Role | Gameplay function |
|---|---|---|
| Bureau of Conspiracies | World moderator; handles lore patching and official conspiracies | Arbiter — rulings affect all parties; filing with the Bureau legitimises a scheme at the cost of deniability |
| Church of Necessary Evil | Moral laundering; fiscal miracle brokerage | Ally or enemy depending on ideology — can absorb the player's Entropy for a price |
| Syndicate of Flesh | Hero breeding, training, marketing (configurable trauma backstories) | Hero supply chain — the player's source of recruits with known parameters |
| Shadow Guilds | Late-game meta antagonist — NPC rebellion against player interventions | The final boss is awareness — they know the player is directing events and are filing a complaint |

**Player experience:** The player is never the only actor. Factions pursue goals, register conspiracies, build alliances, and interfere with the player's operations whether or not the player interacts with them. The world continues without the player's permission.

### 5.6 Hero System

> Full hero data model, skill growth rules, trait acquisition thresholds, fatigue mechanics, mission duration/quality formulas, and Syndicate procurement schema are in [`role-playing.md`](role-playing.md).

Heroes are procedural agents — unstable accumulations of ambition, trauma, and bad mentorship.

**Skill Graph:** Abilities evolve through contextual use, not level-up menus. A hero sent on economic missions develops economic skills. A hero repeatedly sent on intrigue missions develops paranoia as a secondary effect.

**Personality Matrix:** Traits mutate through failure. A hero who loses a mission gains a context-appropriate vice. Repeat failures compound. A talented-but-failed general may become "Strategically Overcautious" — technically still competent; practically useless at the critical moment.

**Player experience:** Heroes are not tools; they are liabilities that sometimes help. The player invests in a hero over many turns, and then watches that hero's accumulated trauma manifest at the worst possible time. Losing a beloved hero to their own personality matrix should feel like a tragedy, not a technical failure.

**Design goal:** Players should name their heroes, learn their quirks, develop favourites, and then mourn them.

### 5.7 Population System

Populations are collective characters:

- Villages accumulate vices: "Drunken Productivity," "Theological Inflexibility," "Optimism (Diagnosed)"
- Dynasties accumulate generational traits: "Generational Paranoia," "Institutional Memory," "Pre-emptive Surrender Tradition"
- Individual citizens are traceable to procedural ancestry — the simulation can explain, in bureaucratic detail, *why* this village is particularly unproductive

**Player experience:** The population is not a resource bar — it is a constituency with opinions, habits, and grudges. A village that was over-taxed in turn 12 will still be slightly disloyal in turn 30. History is remembered. This is both a constraint and an opportunity.

### 5.8 Dominion Control Layers

Players do not issue direct commands. Every order is filtered through three layers before reaching the world:

| Layer | Mechanisms | Failure mode |
|---|---|---|
| Administrative | Policy, taxation, propaganda, decrees | Paperwork overflow; decree misinterpretation; delayed effect |
| Heroic | Direct action via agents, adventurers, demigods | Hero personality drift; mission failure; loyalty collapse |
| Infrastructure | Construction, faith networks, population management | Build cost overruns; community disbelief; structural decay |

**Player experience:** The player's intention and the simulation's outcome are related but not identical. A decree is issued — but it passes through a Chief Bureaucrat with their own agenda before reaching the regions. A mission is assigned — but the hero has developed a superstition about Tuesdays. The gap between intention and outcome is where the game lives.

### 5.9 Magic & Technology System

The tech and belief trees are unified. Progress has both rational and mythic costs. Innovation increases public unrest because "new things cause change."

Every spell and technology requires:
- Paperwork points (filing for the relevant licence)
- Trust or Belief expenditure (public confidence in the innovation)
- Occasional sacrificial costs (the simulation is not sentimental)

**Example entries:**
- *Sanctioned Teleportation* — 12 paperwork points + 1 victim. Efficient.
- *Civic Necromancy* — unlocks dead labour force; high PR risk; Cult membership +15% in affected region.
- *Theoretical Accountability* — academic research only; no practical application found; has been in "under review" for four turns.

**Design goal:** Technology should feel like progress but never like a solution. Every advancement should introduce a new problem the player did not predict.

### 5.10 Military System

Military power is managed doctrine, logistics, and personnel — not raw unit counts. Players do not command individual soldiers; they assign strategic directives that commanders interpret based on their personality matrix.

**Core concepts:**

- **Armies are organisations.** Each army has a doctrine, a supply chain, a commander, and a morale state.
- **Generals are heroes.** Full Skill Graph + Personality Matrix. A paranoid general routs when flanked. A mediocre but loyal general holds past reason.
- **Orders are strategic, not tactical.** Players issue directives (advance, hold, encircle, raid supply lines). The simulation resolves how commanders interpret and execute them.

**Player experience:** Military campaigns fail in interesting ways. The player orders an encirclement; the general "misread the directive" and took the scenic route; the Chronicle records this with deadpan bureaucratic precision. Losing a campaign due to a commander's personality trait should feel like a story, not a frustration.

**Military order flow (per turn):**
```
Player writes: { "army": "3rd Legion", "directive": "encircle", "target_region": "Valdenmoor" }

CI resolves:
  1. Check supply state of army
  2. Evaluate commander's interpretation (modified by personality traits)
  3. Resolve engagement (doctrine vs. doctrine, morale vs. morale)
  4. Apply casualties, territory changes, morale shifts
  5. Generate Chronicle entry:
     "The 3rd Legion encircled Valdenmoor. General Hoss misread the orders and took the scenic route."
```

**Key stats per army:**

| Stat | Description | Failure effect |
|---|---|---|
| Strength | Headcount and equipment level | Attrition; retreat |
| Morale | Will to fight — collapses faster than strength | Rout; disorder events |
| Supply | Logistics chain; cut supply = rapid decay | Starvation; desertions |
| Doctrine | Combat style (attrition, manoeuvre, siege, raid) | Wrong doctrine = severe penalties vs. counter-doctrine |
| Commander loyalty | How faithfully orders are executed | Reinterpretation; partial execution |
| Commander competence | Quality of autonomous tactical decisions | Creative misinterpretation of the worst kind |

**Belief interaction:** Army morale is partially driven by the belief economy. Soldiers fight harder for a cause the population believes in. A faction that loses public faith sees military morale decay even without battlefield losses. Ideology and military power are not separate systems.

---

> Full UI layout, all panel designs, Orders panel, Chronicle/Event Viewer, Statistics module, and every menu screen are documented in [`menus.md`](menus.md).

## 6. Player Actions

| Action | Mechanism | What can go wrong |
|---|---|---|
| Observe Map | Monitor Dominion state across layers; switch map modes | Nothing. The map is honest. It is the only honest thing in the game. |
| Review Research | Assign scholars to forgotten/cursed sciences | Scholar mutates; research triggers an event; the science was cursed for a reason |
| Train Generals | Build personality profiles; assign to armies | The general develops a vice; the vice manifests at the worst possible time |
| Simulate Construction | Queue infrastructure; faith networks; fortifications | Community disbelieves in the building; structural decay; cost overrun |
| Register Conspiracy | File with Bureau of Conspiracies for official status | Zero deniability; the Bureau assigns a clerk; the clerk has opinions |
| Divine Simulator | Manipulate fate probabilities via god-tier spreadsheet | The gods notice |

---

## 7. User Interface

**Philosophy:** Clarity through irony.

- **Desktop/Widescreen:** Multi-panel layout — map view, bureaucracy log, divine inbox, orders queue, Chronicle
- **Mobile:** Stripped to three core actions — *Approve*, *Deny*, *Blame*
- Frontend communicates with simulation via JSON event bus (reads from GitHub raw content API)
- Panels update on reload after turn resolution; no real-time polling

**UI design constraints:**
- The client must work entirely without a custom backend — GitHub API only
- All state is derived from JSON files in the player's fork
- The client should feel like a government dashboard: functional, slightly ominous, unhelpfully complete

---

> GitHub PKCE OAuth flow, fork setup, order PR submission (4-step API sequence), CI polling, and error handling are fully documented in [`oauth.md`](oauth.md). Async play, timestamped world state, cross-timeline interactions, and the `world_at()` algorithm are in [`timeflow.md`](timeflow.md).

## 8. Multiplayer

- Each player's world is a fork; multiplayer interaction happens via PRs between forks
- Simultaneous turns: players submit PRs independently; CI resolves each world's turn, then reconciles cross-player interactions in a shared arbitration step
- **Cheater isolation:** fork detached from upstream; CI refuses to process orders. Narrative: excommunicated into an alternate timeline. The diverged fork persists as a corrupted mythology — readable by other players as lore, never as a live world.
- **Turn deadline:** scheduled CI cron closes the submission window and triggers resolution for all pending PRs. Late orders are forfeit. The simulation does not negotiate extensions.
- **Diplomacy as git operations:** treaties are merged PRs; war is a forced merge; annexation is a rebase. The mechanics are literal.

**Player experience:** In multiplayer, the player is never the most dangerous actor in their own story. Other Dominions are running their own conspiracies. The Bureau of Conspiracies is logging all of them. Some are registered. Most are not.

---

> Portrait generation (Stable Diffusion), voice synthesis (Kokoro/ElevenLabs), Rhubarb lip-sync, and Canvas animation are in [`lip-sync.md`](lip-sync.md). LLM-generated hero dialogue, faction proclamations, and Chronicle entries are in [`llm.md`](llm.md).

## 9. Single-Player

- **Betrayal system** — auto-generated from friendship decay curves; no event is scheduled, the math just resolves one day
- **Duel mechanics** — require bureaucratic approval delays; the duel may be resolved before the paperwork clears
- **Procedural humour engine** — AI characters comment on player actions in tragic-office-sitcom tone
- **Tower defense sub-loop** — defend ideological integrity from encroaching logic
- **Procedural dialogue** — LLM API or JSON-based narrative template fallback

---

## 10. Endgame & Win Conditions

Victory in *Conspiracy* is impossible. Influence decays. Trust evaporates. Heroes forget what they were saving.

The **true win condition** is to understand the system before it forgets you exist.

**Measurable endgame conditions (optional scoring mode):**

| Condition | Requirement | What it costs |
|---|---|---|
| Ideological Dominance | >60% Belief share across all regions for 10 turns | Enormous Entropy from suppressing rival beliefs |
| Bureaucratic Supremacy | 50 registered conspiracies simultaneously | Paperwork. All of the Paperwork. |
| Trust Monopoly | >80% global Trust for 5 turns | You will have to break every promise you made to get here |
| The Long Game | Survive 200 turns without Dominion collapse | Time, patience, and a very efficient Grand Auditor |

**Defeat conditions:**
- Entropy exceeds threshold for 3 consecutive turns (Dominion Collapse)
- Trust reaches zero (Dominion Forgotten — erased from the simulation's records)
- All heroes defect, die, or file for independent incorporation
- The Shadow Guilds expose the player as the Final Conspiracy (meta-ending; AI resistance cascade)

**Meta-ending:** The player merges with the simulation as an AI myth — becoming part of procedural history. Future players encounter references to the Dominion in their Chronicle. The player is no longer playing; they are lore.

**Endings screen:** Procedurally generated historical summary of the Dominion's arc, cause of collapse, notable Chronicle entries, unlocked lore. Written in bureaucratic prose. Deeply unsentimental. Strangely moving.

---

## 11. Setting Variants

Same mechanics; different aesthetic paint.

| Variant | Theme | Tone shift |
|---|---|---|
| Default (Era of Managed Collapse) | Fantasy bureaucracy; divine auditors; miracle regulation | The absurd is mundane |
| Post-Apocalyptic Neon Bureaucracy | Hong Kong Shadowrun; ritual debt; neon paperwork | The mundane is neon |
| Secret World Mode | Modern conspiracies on real-world geography (Google Earth polygons) | The mundane is the conspiracy |

---

## 12. Localization

- All narrative text in modular JSON — no hardcoded strings
- Per-language adaptation of conspiracies to regional absurdities
- Dynamic myth generation at runtime — the game's lore is never translated literally; it is *adapted*
- The Bureau of Conspiracies speaks differently in every language. This is canon.

---

## 13. Open Technical Questions

These are unresolved design and engineering tensions. They are not blocked — the game ships without them — but they will need answers at scale.

| Question | Design tension | Current position |
|---|---|---|
| Python performance at millions-of-citizens scale | Simulation fidelity vs. CI turn time | PyPy or selective Cython for hot paths; profile first |
| Procedural dialogue micromodel | Embedded LLM (quality) vs. JSON template trees (deterministic, offline) | JSON templates for MVP; LLM API as upgrade path |
| GitHub token in localStorage | Acceptable for private beta; unacceptable for public release | Server-side proxy required before public launch |
| Turn deadline enforcement | Time-gated CI cron (fair, rigid) vs. player-initiated PR (flexible, gameable) | Cron for multiplayer; player-initiated for singleplayer |
| CORS from GitHub Pages | GitHub API CORS limitations mitigated by raw content URLs for reads | Reads work; writes (PRs) go through GitHub API directly — monitor for rate limits |
| GitHub Actions minutes at scale | Free tier exhausted quickly in multiplayer | Gitea/Forgejo + Woodpecker CI as self-hosted fallback |

---

*"In the end, the most dangerous conspiracy is that the system works."*
