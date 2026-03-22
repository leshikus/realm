# GitHub Authentication & Order Submission

---

## The Problem

The browser client is a static site on GitHub Pages. It needs to:

1. Fetch world state JSON from the player's fork (read)
2. Submit orders as a PR against that fork's `main` branch (write)

There is no backend. `CLIENT_SECRET` cannot be stored in frontend code.

---

## Full Turn Flow

```
Player visits https://{userid}.github.io/realm
    │
    ▼
[1] Auth check — is a token in localStorage?
    │   No → run Device Flow → get token → store in localStorage
    │   Yes → use it (re-auth on 401)
    │
    ▼
[2] Load world state
    │   GET raw.githubusercontent.com/{userid}/realm/main/shared/turn.json
    │   GET raw.githubusercontent.com/{userid}/realm/main/{userid}/world/*.json
    │
    ▼
[3] Player composes orders in the Orders panel
    │   Result: orders JSON object
    │
    ▼
[4] Submit orders
    │   POST api.github.com → create branch  orders/turn-{N}
    │   PUT  api.github.com → create file    {userid}/orders/turn_{N}_orders.json
    │   POST api.github.com → open PR        orders/turn-{N} → main
    │
    ▼
[5] Poll PR until CI resolves
    │   GET  api.github.com/repos/{userid}/realm/pulls/{pr_number}
    │   GET  api.github.com → check-runs on head commit
    │
    ▼
[6] CI auto-merges on success
    │   World state updated in main
    │
    ▼
[7] Reload world state → re-render client
```

---

## Step 0: Fork Setup (one-time)

Each player's world lives in their fork of the canonical `realm` repo. This is done once when they join.

The client should detect a missing fork on first load and prompt the player to fork:

```js
// client/setup.js

export async function ensureFork(userid, token) {
  // Check if the fork exists
  const res = await githubFetch(`/repos/${userid}/realm`);
  if (res.status === 404) {
    // Fork the canonical repo
    await githubFetch("/repos/realm-canonical/realm/forks", {
      method: "POST",
    });
    // GitHub forks are async — poll until available
    await waitForFork(userid);
  }
}

async function waitForFork(userid) {
  const delay = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 20; i++) {
    await delay(3000);
    const res = await githubFetch(`/repos/${userid}/realm`);
    if (res.ok) return;
  }
  throw new Error("Fork did not appear after 60s.");
}
```

---

## Step 1: Authentication

### Option comparison

| Method | Works without backend? | UX | Notes |
|---|---|---|---|
| PAT (manual) | Yes | Poor | Current approach; fine for private beta |
| OAuth Web Flow | No | Good | Needs backend to hold `CLIENT_SECRET` |
| **Device Flow** | **Yes** | **Good** | Right answer for static sites |
| GitHub App | No | Best | Consider for public release |

### Current approach: PAT

User generates a token at GitHub → Settings → Developer settings → Personal access tokens, pastes it into the client settings field.

```js
// client/config.js
export const getToken  = () => localStorage.getItem("github_token");
export const setToken  = (t) => localStorage.setItem("github_token", t);
export const getUserid = () => localStorage.getItem("github_userid");
export const setUserid = (u) => localStorage.setItem("github_userid", u);
```

Required scope: `repo` (read + write access to the player's fork).

### Target approach: OAuth Device Flow

No redirect URI. No `CLIENT_SECRET`. Works from any static page.

**Register once:**
- GitHub → Settings → Developer settings → OAuth Apps → New OAuth App
- Authorization callback URL: your Pages URL (unused by Device Flow)
- Copy `CLIENT_ID` — safe to commit to frontend code
- Do **not** generate a `CLIENT_SECRET`

```js
// client/auth.js

const CLIENT_ID = "your_client_id_here";
const SCOPES    = "repo";

export async function startDeviceFlow() {
  const res = await fetch("https://github.com/login/device/code", {
    method:  "POST",
    headers: { "Accept": "application/json", "Content-Type": "application/json" },
    body:    JSON.stringify({ client_id: CLIENT_ID, scope: SCOPES }),
  });
  const { device_code, user_code, verification_uri, interval } = await res.json();

  // Show the user: "Go to {verification_uri} and enter {user_code}"
  renderAuthPrompt(verification_uri, user_code);

  const token = await pollForToken(device_code, interval);
  setToken(token);

  // Also store userid: who is this token for?
  const me = await (await githubFetch("/user")).json();
  setUserid(me.login);

  return token;
}

async function pollForToken(device_code, interval_seconds) {
  const delay = (ms) => new Promise((r) => setTimeout(r, ms));
  while (true) {
    await delay(interval_seconds * 1000);
    const res = await fetch("https://github.com/login/oauth/access_token", {
      method:  "POST",
      headers: { "Accept": "application/json", "Content-Type": "application/json" },
      body:    JSON.stringify({
        client_id:  CLIENT_ID,
        device_code,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      }),
    });
    const data = await res.json();
    if (data.access_token)               return data.access_token;
    if (data.error === "authorization_pending") continue;
    if (data.error === "slow_down")      { interval_seconds += 5; continue; }
    if (data.error === "expired_token")  throw new Error("Auth expired. Retry.");
    if (data.error === "access_denied")  throw new Error("Access denied.");
    throw new Error(`OAuth error: ${data.error}`);
  }
}
```

**Init flow:**

```js
// client/main.js

async function init() {
  let token = getToken();
  if (!token) token = await startDeviceFlow();

  await ensureFork(getUserid(), token);
  await loadWorldState();
}
```

**All API calls go through a single wrapper** that handles 401 re-auth:

```js
// client/api.js

export async function githubFetch(path, options = {}) {
  const token = getToken();
  const res = await fetch(`https://api.github.com${path}`, {
    ...options,
    headers: {
      "Authorization":        `Bearer ${token}`,
      "Accept":               "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...options.headers,
    },
  });
  if (res.status === 401) {
    // Token expired or revoked — re-auth and retry once
    await startDeviceFlow();
    return githubFetch(path, options);
  }
  return res;
}
```

---

## Step 2: Loading World State

World state lives in the player's fork. Use the raw content API for reads — no auth needed for public forks, faster, no rate-limit overhead.

```js
// client/world.js

const RAW = "https://raw.githubusercontent.com";

export async function loadWorldState() {
  const userid = getUserid();
  const base   = `${RAW}/${userid}/realm/main`;

  const [turn, factions, heroes, regions, economy, belief] = await Promise.all([
    fetchJSON(`${RAW}/realm-canonical/realm/main/shared/turn.json`),
    fetchJSON(`${base}/${userid}/world/factions.json`),
    fetchJSON(`${base}/${userid}/world/heroes.json`),
    fetchJSON(`${base}/${userid}/world/regions.json`),
    fetchJSON(`${base}/${userid}/world/economy.json`),
    fetchJSON(`${base}/${userid}/world/belief.json`),
  ]);

  return { turn, factions, heroes, regions, economy, belief };
}

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  return res.json();
}
```

`shared/turn.json` lives in the canonical repo (not the player's fork) and is the authoritative turn counter:

```json
{
  "turn": 42,
  "deadline": "2026-03-26T00:00:00Z",
  "status": "open"
}
```

---

## Step 3: Composing Orders

The Orders panel lets the player build up a list of actions. Each action maps to an entry in the orders JSON. The schema matches what the Python engine expects:

```json
{
  "turn": 42,
  "faction": "bureau_of_conspiracies",
  "orders": [
    {
      "type": "military",
      "army": "3rd Legion",
      "directive": "encircle",
      "target_region": "valdenmoor"
    },
    {
      "type": "policy",
      "action": "activate",
      "policy_id": "industrialization_drive",
      "target_region": "heartland"
    },
    {
      "type": "hero",
      "hero_id": "agent_77",
      "mission": "infiltrate",
      "target_faction": "shadow_guilds"
    }
  ]
}
```

The client assembles this in memory as the player clicks through the Orders panel. Nothing is sent to GitHub until they confirm submission.

---

## Step 4: Submitting Orders as a PR

This is the core write operation. Four GitHub API calls in sequence:

```
1. Get main branch HEAD SHA
2. Create orders branch from that SHA
3. Create (or update) the orders file on that branch
4. Open a PR: orders branch → main
```

```js
// client/submit.js

export async function submitOrders(orders) {
  const userid  = getUserid();
  const repo    = `${userid}/realm`;
  const turn    = orders.turn;
  const branch  = `orders/turn-${String(turn).padStart(3, "0")}`;
  const filePath = `${userid}/orders/turn_${String(turn).padStart(3, "0")}_orders.json`;

  // 1. Get current HEAD SHA of main
  const refRes = await githubFetch(`/repos/${repo}/git/ref/heads/main`);
  if (!refRes.ok) throw new Error("Could not read main branch ref.");
  const { object: { sha: mainSha } } = await refRes.json();

  // 2. Create the orders branch (idempotent: skip if it already exists)
  const branchRes = await githubFetch(`/repos/${repo}/git/refs`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ ref: `refs/heads/${branch}`, sha: mainSha }),
  });
  if (!branchRes.ok && branchRes.status !== 422) {
    // 422 = branch already exists; anything else is a real error
    throw new Error(`Failed to create branch: ${branchRes.status}`);
  }

  // 3. Create (or update) the orders file on the branch
  const content = btoa(unescape(encodeURIComponent(
    JSON.stringify(orders, null, 2)
  )));

  // Check if the file already exists on the branch (need its SHA to update)
  let existingSha = undefined;
  const existingRes = await githubFetch(
    `/repos/${repo}/contents/${filePath}?ref=${branch}`
  );
  if (existingRes.ok) {
    existingSha = (await existingRes.json()).sha;
  }

  const fileRes = await githubFetch(`/repos/${repo}/contents/${filePath}`, {
    method:  "PUT",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({
      message: `Submit orders for turn ${turn}`,
      content,
      branch,
      ...(existingSha ? { sha: existingSha } : {}),
    }),
  });
  if (!fileRes.ok) throw new Error(`Failed to write orders file: ${fileRes.status}`);

  // 4. Open a PR (idempotent: return existing PR if one is already open)
  const existingPr = await findOpenPR(repo, branch);
  if (existingPr) return existingPr;

  const prRes = await githubFetch(`/repos/${repo}/pulls`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({
      title: `Orders: Turn ${turn}`,
      head:  branch,
      base:  "main",
      body:  `Turn ${turn} orders submitted via Conspiracy client.`,
    }),
  });
  if (!prRes.ok) throw new Error(`Failed to open PR: ${prRes.status}`);

  return prRes.json(); // { number, html_url, ... }
}

async function findOpenPR(repo, branch) {
  const res = await githubFetch(
    `/repos/${repo}/pulls?state=open&head=${repo.split("/")[0]}:${branch}`
  );
  if (!res.ok) return null;
  const prs = await res.json();
  return prs.length > 0 ? prs[0] : null;
}
```

On success, `submitOrders()` returns the PR object. Show the player a link to it.

---

## Step 5: Polling CI Status

After the PR is open, CI runs `process-turn.yml`. The client can poll for resolution:

```js
// client/submit.js (continued)

export async function waitForTurnResolution(repo, prNumber, onStatus) {
  const delay = (ms) => new Promise((r) => setTimeout(r, ms));

  while (true) {
    await delay(10_000); // poll every 10s

    const prRes  = await githubFetch(`/repos/${repo}/pulls/${prNumber}`);
    const pr     = await prRes.json();

    if (pr.merged) {
      onStatus("resolved");
      return { success: true };
    }
    if (pr.state === "closed" && !pr.merged) {
      // CI failed and closed the PR
      const reason = await getCIFailureReason(repo, pr.head.sha);
      onStatus("failed", reason);
      return { success: false, reason };
    }

    // Still running — check check-run status for progress display
    const checksRes  = await githubFetch(
      `/repos/${repo}/commits/${pr.head.sha}/check-runs`
    );
    const { check_runs } = await checksRes.json();
    const runStatus  = check_runs[0]?.status ?? "queued";
    onStatus("pending", runStatus); // "queued" | "in_progress" | "completed"
  }
}

async function getCIFailureReason(repo, sha) {
  // CI posts failure details as a PR review comment
  // For now, return the check-run output summary
  const res = await githubFetch(`/repos/${repo}/commits/${sha}/check-runs`);
  const { check_runs } = await res.json();
  return check_runs[0]?.output?.summary ?? "Unknown CI failure.";
}
```

**CI outcomes:**

| Outcome | What happened | Client response |
|---|---|---|
| PR merged | Orders valid; turn resolved; world state updated | Reload world state, re-render |
| PR closed (not merged) | Orders invalid or simulation error | Show failure reason from CI output |
| PR still open after deadline | Player missed the turn window | Show warning; orders ignored this turn |

---

## Step 6: Reloading World State

After the PR merges, `main` on the player's fork has the new world state. Just call `loadWorldState()` again:

```js
// client/main.js

async function onTurnResolved() {
  const world = await loadWorldState();
  renderWorld(world);
  // The event log for this turn is now in /{userid}/history/events.log
  await loadEventLog();
}
```

The event log is also a raw-content fetch:

```js
const logUrl = `${RAW}/${userid}/realm/main/${userid}/history/events.log`;
const log    = await fetch(logUrl).then((r) => r.text());
```

---

## Error Reference

| Situation | API status | Handling |
|---|---|---|
| Token missing | — | Run Device Flow |
| Token expired/revoked | 401 | Re-run Device Flow, retry |
| Fork doesn't exist | 404 on repo fetch | Create fork, wait for it |
| Branch already exists | 422 on ref creation | Proceed — file write still works |
| File already exists on branch | Need SHA | Fetch existing file SHA, include in PUT |
| PR already open for this turn | 422 on pulls create | Fetch existing PR and return it |
| CI validation failure | PR closed | Display `check_runs[0].output.summary` |
| Rate limit | 403 + `X-RateLimit-Remaining: 0` | Show retry-after from `X-RateLimit-Reset` header |

---

## Required Scopes

| Scope | Why |
|---|---|
| `repo` | Read/write private forks; create branches, files, PRs |

If the game ever moves to public forks only, `public_repo` suffices. Until then, `repo` is required.

---

## Security Notes

`localStorage` is readable by any JS on the page. Acceptable for private beta. For public release:

- Replace with a Cloudflare Worker proxy that holds the OAuth token server-side and issues HttpOnly session cookies
- Or enforce Fine-Grained PATs scoped to the player's specific fork (`contents: write`, `pull_requests: write`)

The token obtained via Device Flow acts on behalf of the user — it can only do what the user's own GitHub account can do. It cannot access other players' private forks.

---

## CORS Notes

- **GitHub API** (`api.github.com`): full CORS support; all write calls work from the browser
- **Raw content** (`raw.githubusercontent.com`): CORS supported for GET; no auth header needed for public repos
- **OAuth Device Flow endpoints** (`github.com/login/...`): CORS supported only if `Accept: application/json` is sent — without it GitHub returns `application/x-www-form-urlencoded` and the preflight fails
