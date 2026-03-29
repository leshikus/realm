# UI Panel Module Specifications

Covers all UI panel classes in `client/js/`:
`orderspanel.js`, `eventviewer.js`, `statspanel.js`, `setuppanel.js`, `regionpanel.js`, `regionorders.js`.

For the region info and orders overlay layout, see `ui.md §2.4`.
For map interaction, see `map.md`.

---

## 1. OrdersPanel (`orderspanel.js`)

### 1.1 Purpose

Manages the order queue and PR submission. The queue display (list, count badge, Clear and Submit buttons) is rendered in the left side panel of the Region Selection UI (§2.4 of `ui.md`). The type selector and params textarea are kept in a hidden DOM element for internal use. Exposes `addOrder()` so `RegionOrdersPanel` can queue orders programmatically.

### 1.2 Constructor

```js
new OrdersPanel({ typeEl, paramsEl, listEl, countEl, statusEl, addBtn, clearBtn, submitBtn })
```

Populates `typeEl` (a `<select>`) with all `ORDER_TYPES` and sets a placeholder hint in `paramsEl`.

### 1.3 Order types

```
army_directive, raise_army, recruit_hero, assign_hero,
set_propaganda, levy_tax, begin_research, build
```

When the type changes, `paramsEl` is updated with a JSON example for that type.

### 1.4 Methods

#### `setContext(gh, userid, turn, { onSubmit }?)`

Must be called after authentication before any submission. `onSubmit` callback is invoked after a successful PR.

#### `addOrder(type, params)`

Pushes `{ type, params }` onto the internal orders queue and appends a list item. Used by `RegionOrdersPanel` to queue region-level actions.

### 1.5 Submit flow

On "Submit Turn" click:
1. Validates queue is non-empty and `gh` context is set
2. Builds payload: `{ userid, turn, orders: [{ type, params }, …] }`
3. Calls `gh.submitOrders(userid, turn, payload)` — returns PR URL
4. Clears queue and shows PR URL in status element

---

## 2. EventViewer (`eventviewer.js`)

### 2.1 Purpose

Renders the reverse-chronological narrative event log fetched from `{userid}/history/events.log`.

### 2.2 Constructor

```js
new EventViewer(listEl, filterEl, onRegionClick?)
```

Attaches `input` listener to `filterEl` for live filtering.

### 2.3 Methods

#### `load(entries)`

Replaces the displayed entries and re-renders with no filter.

### 2.4 Rendering

Each entry is a `<li>` with a CSS class determined by the line prefix:

| Prefix | Class | Visual |
|---|---|---|
| `===` | `turn-header` | Turn separator |
| `[WORLD EVENT]` | `world-event` | Highlighted event |
| (other) | `normal` | Standard log line |

#### Region links

If `onRegionClick` is provided, tokens matching `reg_[a-z0-9_]+` inside entry text are replaced with clickable `<span class="region-link">` elements. Clicking fires `onRegionClick(regionId)`, which in `app.js` navigates to the Map tab and selects that region.

### 2.5 Filtering

Case-insensitive substring match against the full entry string. Entries not matching are skipped in the render loop.

---

## 3. StatsPanel (`statspanel.js`)

### 3.1 Purpose

Renders four Chart.js line charts from the per-turn stats snapshots written by the engine.

### 3.2 Constructor

```js
new StatsPanel()
```

### 3.3 Methods

#### `render(snapshots)`

Accepts an array of stats snapshots (from `gh.loadStats()`). Each snapshot:

```json
{ "turn": N, "trust": N, "belief": N, "army_strength": N, "unrest": N }
```

Renders four charts into their canvas elements:

| Canvas ID | Metric | Colour |
|---|---|---|
| `chart-trust` | `trust` | `#7c5cbf` (purple) |
| `chart-belief` | `belief` | `#4a9eff` (blue) |
| `chart-army` | `army_strength` | `#e74c3c` (red) |
| `chart-unrest` | `unrest` | `#e67e22` (orange) |

X-axis labels are `T0`, `T1`, … Turn numbers from the snapshot's `turn` field.

Old charts are destroyed before recreating (prevents Chart.js canvas reuse errors).

### 3.4 Chart options

- Type: `line`
- Fill: enabled with 13% opacity
- Tension: 0.3 (slightly smoothed)
- `responsive: true`, `maintainAspectRatio: false`
- Dark theme: tick and grid colours match the app's colour palette

---

## 4. SetupPanel (`setuppanel.js`)

### 4.1 Purpose

Guides a new player through the three-step onboarding flow:

1. Fork the canonical `conspiracy` repo
2. Create an initial world file on the fork
3. Open a join PR to the canonical repo

### 4.2 Constructor

```js
new SetupPanel({ forkBtn, forkStatus, initBtn, initStatus, prBtn, prStatus }, gh, userid)
```

Buttons are wired internally; steps are gated (each step enables the next button on success).

### 4.3 Steps

#### Step 1 — Fork

Calls `gh.forkCanonical()`, then polls `gh.isForkReady(userid)` every 3 seconds, up to 20 attempts (60 s timeout). Enables "Initialize World" button on success.

#### Step 2 — Initialize world

Calls `gh.initWorldBranch(userid)`. Creates the `join/{userid}` branch with `{userid}/turn.json`. Stores the branch name internally. Enables "Submit Join PR" button on success.

#### Step 3 — Submit join PR

Calls `gh.submitJoinPR(userid, branch)`. Shows the PR URL as a clickable link.

### 4.4 Status display

Each step has a status paragraph that receives one of three CSS classes: `info`, `ok`, `error`.

---

## 5. RegionInfoPanel (`regionpanel.js`)

### 5.1 Purpose

Read-only widget displaying the stats of the currently selected region. Rendered inside `#region-info` within the `#map-selection` overlay.

### 5.2 Constructor

```js
new RegionInfoPanel(containerEl, onDismiss)
```

### 5.3 Methods

#### `render(region, world)`

Populates the container with:

- Region name (header)
- Close button (calls `onDismiss()`)
- Population and controlling faction
- **Prosperity bar** — segmented bar with threshold markers at 25, 50, 75
- **Unrest bar** — segmented bar; turns red above 60
- **Belief tags** — shows `world.belief` domain levels as coloured badges
- **Adjacent regions** — comma-separated list of `adjacent_region_ids`
- **Active events** — any world events that mention this region's `id`
- **Policies** — controlling faction type drives displayed policy text

### 5.4 Visual design

Bars are CSS-rendered using percentage width. Threshold lines overlay the bar at 25 %, 50 %, 75 % positions. Unrest above 60 applies a red modifier class.

---

## 6. RegionOrdersPanel (`regionorders.js`)

### 6.1 Purpose

Interactive widget for issuing orders that target the selected region: deploy heroes, configure missions, and trigger region-level actions. Rendered inside `#wo-content`, which is the scrollable upper section of the left side panel (`#region-orders`) in the Region Selection UI. The lower section of the same panel contains the order queue and Submit button (managed by `OrdersPanel`).

### 6.2 Constructor

```js
new RegionOrdersPanel(containerEl, addOrderFn)
```

`addOrderFn` is `(type, params) => ordersPanel.addOrder(type, params)`.

### 6.3 Hero roster

Renders the list of heroes currently assigned to the region (`hero.region_id === region.id`).

For each hero a collapsible form shows:
- Hero name, role, key skill values
- **Mission type** `<select>`: `espionage`, `diplomacy`, `sabotage`, `recruit`
- **Risk** `<select>`: `low`, `medium`, `high`
- **Queue** button — calls `addOrderFn("assign_hero", { hero_id, target_id: region.id })` and appends a mission note

### 6.4 Region actions

Four action buttons that directly queue orders:

| Button | Order type | Params |
|---|---|---|
| Fund Propaganda | `set_propaganda` | `{ faction_id: controllingFactionId, value: 10 }` |
| Levy Tax | `levy_tax` | `{ region_id, amount: 10 }` |
| Sponsor Construction | `build` | `{ region_id, structure: "fort" }` |
| Dispatch Agent | `recruit_hero` | `{ name: "Agent", role: "agent", region_id }` |

All buttons call `addOrderFn` immediately and show a brief "Queued" confirmation.

### 6.5 Empty state

If no heroes are in the region, shows a "No agents in this region" message with only the region action buttons active.
