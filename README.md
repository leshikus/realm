# Realm
A darkly humorous turn-based civilization simulation. Players accumulate power, scale agents and long-term projects, and compete against rivals — while their dominion threatens to collapse under its own weight.

See [`docs/technical-design.md`](docs/technical-design.md) and [`docs/lore.md`](docs/lore.md) for full design documentation.

---

## Development Plan — Version 1.0

### Phase 1: World Foundation
- [ ] Define world state JSON schema (`factions`, `heroes`, `regions`, `economy`, `belief`)
- [ ] Set up canonical `realm/` repository structure with `/{userid}/` ownership paths
- [ ] Implement Python simulation engine skeleton (reads orders JSON → writes world state JSON)
- [ ] CI pipeline: GitHub Actions workflow `process-turn.yml` that triggers on PR, runs engine, commits result

### Phase 2: Core Simulation
- [ ] Trust economy — generation, decay, propaganda modifiers
- [ ] Belief economy — resource generation driven by population confidence
- [ ] Faction AI — autonomous per-faction state updates each turn
- [ ] Order validator — schema check and rule enforcement before simulation runs
- [ ] Turn resolution loop — event queue, faction AI, hero agents, belief economy, global events

### Phase 3: Heroes & Agents
- [ ] Hero data model — Skill Graph + Personality Matrix
- [ ] Hero mutation on turn resolution (trait drift through failure/success)
- [ ] Agent assignment to player orders (heroic layer)
- [ ] Basic military resolution — army strength + commander traits + doctrine vs. opponent

### Phase 4: Browser Client (GitHub Pages)
- [ ] Map view — Canvas-rendered region cards with armies and heroes
- [ ] Order input UI — compose orders as JSON and submit PR via GitHub API
- [ ] Event Viewer — chronological narrative feed from `history/events.log`
- [ ] Statistics module — Chart.js graphs of Trust, Belief, army strength, unrest over time
- [ ] Deploy workflow — `deploy-pages.yml` publishes `client/` to GitHub Pages on push to `main`

### Phase 5: Multiplayer
- [ ] Fork-based player onboarding — new player forks canonical repo
- [ ] Cross-player turn arbitration — CI reconciles interactions between player forks
- [ ] Turn deadline enforcement — cron-triggered resolution window
- [ ] Rival stats overlay in Statistics module (public fork data)

---

## Credits
Alexei Fedotov http://www.dataved.ru/
