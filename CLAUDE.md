# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Highlights

Do not agree to code something that is a bad decision — argue instead until you reach an acceptable solution.
Do not run `git commit`, I check all commits. Use `git status` to check if I have added all files.

## Two-Repo Structure

The game is split across two repositories:

- **`conspiracy`** — world state + CI workflow. Players fork this. Contains `world/` and `process-turn.yml`. The workflow checks out `conspiracy-game` at runtime to run the simulation.
- **`conspiracy-game`** — this repo. Client, engine, docs. Only the game master pushes here. Deployed to GitHub Pages.

## Commands

```bash
# Install Python dependencies
pip install -r requirements.txt

# Run tests
pytest engine/tests/ -v

# Run a single test
pytest engine/tests/test_simulation.py::test_name -v

# Manually invoke the engine (what CI does)
python -m engine.main <userid> <turn>
```

The browser client (`client/`) is vanilla HTML/CSS/JS — no build step.

**Live deployment:** https://leshikus.github.io/conspiracy-game/ — use this URL with Playwright to test client-side bugs.

## Architecture

### Turn Resolution Pipeline

1. Player submits `world/<userid>/orders/turn.json` as a PR to their fork of `conspiracy`
2. `process-turn.yml` triggers, checks out `conspiracy-game`, runs `python -m engine.main <userid> <turn>`
3. Engine loads world state, validates orders, simulates the turn (deterministically via seed), writes updated JSON + `history/events.log` + `history/stats_NNNN.json`
4. CI commits and auto-merges the PR

### Python Engine (`engine/`)

- `models.py` — Pydantic schemas for all world state (`PlayerWorld`, `Hero`, `Faction`, `Region`, `Army`, `Economy`, `BeliefIndex`, `SharedWorld`)
- `orders.py` — `OrderType` enum + validation logic; order costs (recruit hero: 20 trust, raise army: 30 trust)
- `simulation.py` — `resolve_turn(world, orders, seed)` is the core pure function; resolution phases: apply orders → economy tick → belief tick → faction AI tick → hero mutation → army upkeep → global event roll → increment turn
- `loader.py` — File I/O: reads/writes `world/<userid>/*.json` and shared state
- `main.py` — CLI entry point; orchestrates load → validate → resolve → persist; exits 1 on validation failure

### Browser Client (`client/js/`)

- `app.js` — Root controller; wires panels, manages config, drives world load/render cycle
- `github.js` — All GitHub API calls (fetch world JSON, load event log, submit orders as PR)
- `mapview.js` — Canvas map renderer
- `orderspanel.js` — Order composition UI; submits orders as a PR to the player's fork of `conspiracy`
- `eventviewer.js` / `statspanel.js` — Read-only views of `history/events.log` and `history/stats_*.json`

### World State Layout

Lives in the `conspiracy` repo (player forks):

```
shared/world.json          # Global state: current turn, deadline, player list
<userid>/
  heroes.json, factions.json, regions.json, armies.json
  economy.json, belief.json, turn.json
  orders/turn.json          # Submitted via PR
  history/events.log
  history/stats_NNNN.json   # Written by engine each turn
```

### Key Invariants

- All game logic lives in Python — the browser has no simulation state
- `resolve_turn` is deterministic: same seed + same input = same output (enforced by tests)
- GitHub is the entire infrastructure: storage, CI, and API protocol
- Players can only affect `conspiracy` (world repo) via PRs — client and engine are unreachable
