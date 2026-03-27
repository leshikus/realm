# Client Module Specifications

Covers the utility and infrastructure modules used by the browser client:
`config.js`, `debug.js`, and `app.js` (root controller).

---

## 1. Config (`config.js`)

### 1.1 Overview

Thin wrapper around `localStorage` for persisting the client configuration object. No class — exported as a plain object `Config`.

### 1.2 Config object shape

```js
{
  github_token:    string,   // PAT (ghp_…)
  github_repo:     string,   // "owner/conspiracy" (player's fork)
  userid:          string,   // GitHub username
  mubert_key:      string,   // optional Mubert API key

  music_mode:      "procedural" | "youtube" | "mp3",
  yt_api_key:      string,   // YouTube Data API v3 key (enables library search)
  mp3_service_url: string,   // base URL of yt-dlp HTTP service (mp3 mode)
  autosave_music:  boolean,  // auto-save non-skipped tracks
  autosave_pct:    number,   // threshold % for auto-save (default 80)
}
```

### 1.3 API

| Method | Description |
|---|---|
| `Config.load()` | Returns parsed object from localStorage, or `null` if absent |
| `Config.save(cfg)` | Serialises and stores the config object |
| `Config.clear()` | Removes the config key (logout) |

Storage key: `conspiracy_config`.

---

## 2. Debug Logger (`debug.js`)

### 2.1 Overview

Two exports:
- `dbg` — singleton `DebugLogger` instance used throughout the codebase
- `initDebugPanel(getCfg)` — initialises the overlay UI

### 2.2 DebugLogger

#### Logging methods

```js
dbg.info(msg, data?)
dbg.warn(msg, data?)
dbg.error(msg, data?)
dbg.api(method, url, status, ms, rateRemaining?)
```

`api()` automatically maps HTTP 4xx/5xx to `error` level.

Entries are stored newest-first, capped at 300 entries. Each entry:

```js
{ level, msg, data, time, ts }
// time: "HH:MM:SS", ts: Unix ms
```

#### Side-channel methods

| Method | Description |
|---|---|
| `dbg.setRateLimit({ remaining, limit, reset })` | Called by `GitHubClient` after each API response |
| `dbg.setWorld(world)` | Called by `app.js` after world loads; used for panel meta display |
| `dbg.getEntries()` | Returns copy of entry array |
| `dbg.getWorld()` | Returns last stored world snapshot |
| `dbg.getRateLimit()` | Returns `{ remaining, limit, reset }` or null |
| `dbg.clear()` | Empties the log |
| `dbg.onChange(fn)` | Subscribe to any change (log, rate limit, world) |
| `dbg.report(cfg)` | Returns plain-text bug report string |

#### Auto-capture

The constructor intercepts:
- `window.error` — uncaught JS exceptions
- `window.unhandledrejection` — unhandled promise rejections
- `console.error` / `console.warn` — proxied to the log (also forwarded to real console)

### 2.3 initDebugPanel(getCfg)

Injects `#debug-panel` into `<body>` and wires UI.

**Toggle:** `Ctrl+Shift+D` or the `#btn-debug` header button.

Panel sections:
- **Meta row:** User, Repo, Token (first 8 chars), Turn, Regions, Heroes, Factions
- **Rate limit badge:** `Rate: N/5000`
- **Log:** scrollable list of entries with level colouring (info/warn/error/api)
- **Copy report button:** copies `dbg.report(cfg)` to clipboard
- **Clear button:** clears log entries

Returns `{ toggle }` so `app.js` can wire the header button.

---

## 3. Root Controller (`app.js`)

### 3.1 Overview

`app.js` is the single ES module entry point. It owns all global state, initialises every panel and service, and drives the world-load/render cycle.

### 3.2 Startup flow

1. Load `Config` from localStorage
2. If missing → show `#login-screen`; on Connect button: validate token via GitHub API, save config, reload
3. If present → hide login, show `#app`, call `_loadWorld()`

### 3.3 World load / render cycle

`_loadWorld()`:
1. `gh.loadWorld(userid)` → `gh.loadEventLog(userid)` → `gh.loadStats(userid)` (parallel where possible)
2. `dbg.setWorld(world)`
3. Render map (`mapView.load(regions)`)
4. Render events (`eventViewer.load(entries)`)
5. Render stats (`statsPanel.render(snapshots)`)
6. Update header turn + trust display
7. Set `ordersPanel.setContext(gh, userid, turn)`
8. Non-blocking: sync music library from GitHub

### 3.4 Tab navigation

Four tabs: Map, Orders, Events, Statistics. Tab buttons (`.tab-btn`) toggle `.active` class; corresponding `.tab` divs toggle `.hidden`.

### 3.5 Map integration

- `MapView` instance listens for region clicks and calls `onSelect(region)`
- `onSelect` opens `#map-selection` overlay (adds `.open`), renders `RegionInfoPanel` and `RegionOrdersPanel`
- `dismissMapSelection()` removes `.open` and calls `mapView.deselect()`
- Map toolbar buttons (`.map-view-btn`) call `mapView.setViewMode(mode)` — modes: `political`, `population`, `unrest`, `prosperity`

### 3.6 Music

`_createMusicPlayer(cfg)` factory:
- `music_mode === "youtube"` or `"mp3"` → returns `YTMusicPlayer`
- otherwise → returns procedural `MusicPlayer`

Music player UI (`#music-player`):
- ▶ Play/Pause → `player.triggerResolution()`
- ▶▶ Skip → `player.skip()`
- ♫ Library → opens `#music-modal`

Music library modal tabs:
- **Saved tracks**: lists `library.getAll()` grouped by mood; remove button calls `library.removeTrack()`
- **Search YouTube**: `YouTubeSearchService.search(query)` → result list with save-to-library buttons; mood select populates search query from `MOOD_QUERIES`

Music settings modal (`#music-settings-modal`):
- Source: procedural / youtube / mp3
- YouTube Data API Key
- MP3 Extract Service URL
- Auto-save threshold %

### 3.7 Config dropdown (Options menu)

| Item | Action |
|---|---|
| Refresh world | `_loadWorld()` |
| Create turn | Opens `#create-turn-modal` (game master: calls `gh.advanceTurn()`) |
| Setup / onboarding | Shows `#tab-setup` |
| Music settings | Opens `#music-settings-modal` |
| Log out | `Config.clear()` + `location.reload()` |

### 3.8 Panel instances

| Variable | Class | DOM anchor |
|---|---|---|
| `mapView` | `MapView` | `#map-canvas` |
| `ordersPanel` | `OrdersPanel` | `#tab-orders` elements |
| `eventViewer` | `EventViewer` | `#events-list`, `#events-filter` |
| `statsPanel` | `StatsPanel` | chart canvases |
| `regionInfoPanel` | `RegionInfoPanel` | `#region-info` |
| `setupPanel` | `SetupPanel` | `#tab-setup` elements |

### 3.9 Key invariants

- `mapView` is declared as `let` (not `const`) to allow `dismissMapSelection` to reference it in a closure before the assignment
- `ordersPanel` is referenced by `RegionOrdersPanel` callback closures; this is safe because closures are only invoked after full initialisation
- All GitHub API calls go through a single `GitHubClient` instance (`gh`)
- World state is never mutated client-side; it is always re-fetched from GitHub
