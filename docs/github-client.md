# GitHub Client Module Specification

## 1. Overview

`client/js/github.js` is the sole interface between the browser client and GitHub. It wraps the GitHub REST API v3 (Contents API, Git Data API, Pulls API) and provides typed methods for every operation the game needs: reading world state, submitting orders as PRs, onboarding, and persisting the music library.

All network calls are authenticated with the player's Personal Access Token (requires `repo` scope).

---

## 2. Exports

| Export | Kind | Description |
|---|---|---|
| `GitHubClient` | class | Main API client |
| `AuthError` | class | Thrown on 401; caller should re-authenticate |

---

## 3. GitHubClient

### 3.1 Constructor

```js
new GitHubClient({ token, repo })
```

| Param | Type | Description |
|---|---|---|
| `token` | string | GitHub PAT (`ghp_…`) |
| `repo` | string | `"owner/repo"` — the authenticated user's fork of `conspiracy` |

### 3.2 World state loading

#### `loadWorld(userid) → object`

Fetches all seven world-state files in parallel:

```
{userid}/heroes.json   → heroes:   Hero[]
{userid}/factions.json → factions: Faction[]
{userid}/regions.json  → regions:  Region[]
{userid}/armies.json   → armies:   Army[]
{userid}/economy.json  → economy:  Economy
{userid}/belief.json   → belief:   BeliefIndex
{userid}/turn.json     → turn:     number
```

Missing files return safe defaults (empty arrays / empty object / `{ turn: 0 }`). Never throws for 404s.

#### `loadEventLog(userid) → string[]`

Fetches `{userid}/history/events.log`. Returns lines in **reverse chronological order** (newest first), trimmed and filtered for empty lines.

#### `loadStats(userid) → object[]`

Walks the git tree (`GET /repos/{repo}/git/trees/main?recursive=1`) to discover all `{userid}/history/stats_NNNN.json` files, then fetches them in parallel. Returns an array of stats snapshots sorted by filename (ascending turn order). Null results from individual fetches are filtered out.

### 3.3 Onboarding

#### `forkCanonical() → object`

`POST /repos/{repo}/forks` — forks the canonical `conspiracy` repo into the authenticated user's account. Returns the fork object. GitHub creates forks asynchronously; callers must poll `isForkReady()` after this.

#### `isForkReady(userid) → boolean`

`GET /repos/{userid}/conspiracy` — returns `true` once the fork is accessible, `false` otherwise (never throws).

#### `initWorldBranch(userid) → string`

Creates a `join/{userid}` branch on the player's fork and commits `{userid}/turn.json` with `{ "turn": 0 }`. Returns the branch name.

#### `submitJoinPR(userid, branch) → object`

Opens a PR from `{userid}:{branch}` to the canonical repo's `main`. Returns the PR object (includes `html_url`).

### 3.4 Order submission

#### `submitOrders(userid, turn, ordersObj) → string`

Full PR submission flow:

1. Get HEAD SHA of `main` on the player's fork
2. Create `orders/turn-{NNNN}` branch (ignore 422 if already exists)
3. Commit `{userid}/orders/turn.json` to the branch (fetches existing file SHA for update)
4. Open PR from `{userid}:orders/turn-{NNNN}` to canonical `main`

Returns the PR HTML URL.

### 3.5 Music library

#### `loadMusicLibrary(userid) → object`

Fetches `{userid}/music.json` from the player's fork. Returns `{}` on 404 or any error.

#### `saveMusicLibrary(userid, data) → void`

Commits `{userid}/music.json` to the player's fork (creates or updates). Automatically fetches the existing file SHA before writing, as required by the Contents API.

### 3.6 Turn management (game master only)

#### `advanceTurn(userid, deadlineUtc?) → number`

Reads `shared/world.json`, increments `current_turn`, optionally sets `turn_deadline_utc`, and writes it back to the canonical repo's `main` branch. Returns the new turn number.

---

## 4. HTTP helpers

All API calls go through `_request(method, path, body)` which:

1. Sets required headers: `Authorization: Bearer {token}`, `Accept: application/vnd.github+json`, `X-GitHub-Api-Version: 2022-11-28`
2. Records timing and calls `dbg.api()` for every response
3. Parses and stores `X-RateLimit-*` headers via `dbg.setRateLimit()`
4. Throws `AuthError` on 401
5. Throws a plain `Error` with status + body for other non-ok responses

Shorthand methods: `_get(path)`, `_post(path, body)`, `_put(path, body)`.

---

## 5. File encoding

The GitHub Contents API requires base64-encoded content for writes:

```js
content: btoa(unescape(encodeURIComponent(jsonString)))
```

The `unescape(encodeURIComponent(...))` step handles non-ASCII characters (UTF-8 safe base64). Reads decode with `atob(data.content.replace(/\n/g, ''))`.

---

## 6. Error handling

| Condition | Behaviour |
|---|---|
| HTTP 401 | Throws `AuthError` — app.js catches this and redirects to login |
| HTTP 404 | `_fetchContents()` returns `null`; loading methods return defaults |
| HTTP 422 (branch exists) | `submitOrders()` catches and ignores this specific error |
| Other non-ok | Throws `Error` with `"METHOD /path: STATUS body"` |

---

## 7. Rate limits

GitHub's authenticated API rate limit is 5,000 requests/hour. `loadWorld()` costs 7 requests (parallel). `loadStats()` costs 1 (tree) + N (snapshots). The debug panel (`dbg.getRateLimit()`) shows current remaining/limit.
