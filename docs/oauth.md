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
Player visits https://{userid}.github.io/conspiracy
    │
    ▼
[1] Auth check — is a token in localStorage?
    │   No → PKCE login → redirect to GitHub → callback → get token → store in localStorage
    │   Yes → use it (clear + re-auth on 401)
    │
    ▼
[2] Load world state
    │   GET raw.githubusercontent.com/{userid}/conspiracy/main/shared/turn.json
    │   GET raw.githubusercontent.com/{userid}/conspiracy/main/{userid}/world/*.json
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
    │   GET  api.github.com/repos/{userid}/conspiracy/pulls/{pr_number}
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

Each player's world lives in their fork of the canonical `conspiracy` repo. This is done once when they join.

The client should detect a missing fork on first load and prompt the player to fork:

```js
// client/setup.js

export async function ensureFork(userid, token) {
  // Check if the fork exists
  const res = await githubFetch(`/repos/${userid}/conspiracy`);
  if (res.status === 404) {
    // Fork the canonical repo
    await githubFetch("/repos/conspiracy-canonical/conspiracy/forks", {
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
    const res = await githubFetch(`/repos/${userid}/conspiracy`);
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
| PAT (manual) | Yes | Poor | Fine for private beta; no user-friendly flow |
| **OAuth Web Flow + PKCE** | **Yes** | **Good** | **Right answer for static sites** |
| Device Flow | Yes | Acceptable | Requires user to manually copy a code |
| GitHub App | No | Best | Consider for public release |

### Current approach: PAT

User generates a token at GitHub → Settings → Developer settings → Personal access tokens, pastes it into the client settings field. Simple but poor UX.

Required scope: `repo` (read + write access to the player's fork).

### Target approach: OAuth PKCE (Web Flow)

PKCE (Proof Key for Code Exchange, RFC 7636) extends the standard OAuth Authorization Code flow to work without a `CLIENT_SECRET`. The client generates a random `code_verifier`, sends its SHA-256 hash (`code_challenge`) to GitHub during authorization, then presents the raw verifier during the token exchange. GitHub validates that they match — proving the token request came from the same client that started the flow.

**No redirect from an external server needed; no secret in frontend code.**

**Register once:**
- GitHub → Settings → Developer settings → OAuth Apps → New OAuth App
- Authorization callback URL: `https://{userid}.github.io/conspiracy` (your Pages URL)
- Copy `CLIENT_ID` — safe to commit to frontend code
- Do **not** generate a `CLIENT_SECRET`

```js
// client/js/auth.js

const CLIENT_ID = 'YOUR_GITHUB_OAUTH_APP_CLIENT_ID';
const SCOPES    = 'repo';

function redirectUri() {
  return window.location.origin + window.location.pathname.replace(/\/$/, '');
}

function base64url(bytes) {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function randomVerifier() {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return base64url(b);
}

async function challenge(verifier) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(hash));
}

/** Redirect the browser to GitHub's OAuth consent screen. */
export async function startLogin() {
  const verifier = randomVerifier();
  const state    = crypto.randomUUID();
  sessionStorage.setItem('pkce_verifier', verifier);
  sessionStorage.setItem('pkce_state', state);

  const q = new URLSearchParams({
    client_id:             CLIENT_ID,
    redirect_uri:          redirectUri(),
    scope:                 SCOPES,
    state,
    code_challenge:        await challenge(verifier),
    code_challenge_method: 'S256',
  });
  window.location.href = `https://github.com/login/oauth/authorize?${q}`;
}

/**
 * If the current URL contains ?code=..., exchange it for a token.
 * Clears the code from the URL. Returns the access token or null.
 */
export async function handleCallback() {
  const p    = new URLSearchParams(window.location.search);
  const code = p.get('code');
  if (!code) return null;

  if (p.get('state') !== sessionStorage.getItem('pkce_state')) {
    throw new Error('OAuth state mismatch — possible CSRF');
  }
  const verifier = sessionStorage.getItem('pkce_verifier');
  sessionStorage.removeItem('pkce_verifier');
  sessionStorage.removeItem('pkce_state');
  history.replaceState(null, '', location.pathname);  // clean the URL

  const res  = await fetch('https://github.com/login/oauth/access_token', {
    method:  'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      client_id:     CLIENT_ID,
      code,
      redirect_uri:  redirectUri(),
      code_verifier: verifier,
    }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error_description ?? data.error);
  return data.access_token;
}
```

**Init flow:**

```js
// client/js/app.js

async function init() {
  // 1. Handle the OAuth callback if redirected back from GitHub
  const callbackToken = await handleCallback();
  if (callbackToken) {
    const me = await fetch('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${callbackToken}` },
    }).then(r => r.json());
    Config.save({ userid: me.login, github_token: callbackToken, github_repo: `${me.login}/conspiracy` });
  }

  // 2. Check stored token
  const cfg = Config.load();
  if (!cfg?.github_token) {
    showLogin();   // renders a "Login with GitHub" button that calls startLogin()
    return;
  }

  await ensureFork(cfg.userid, cfg.github_token);
  await loadWorldState();
}
```

**All API calls go through a single wrapper** that detects 401 and triggers re-auth:

```js
// client/js/github.js

export class AuthError extends Error {}

async _request(method, path, body) {
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: { ...this._headers(), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) throw new AuthError('Token expired');
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`);
  return res.json();
}
```

In `app.js`, catch `AuthError` → `Config.clear()` → `startLogin()`.

---

## Step 2: Loading World State

World state lives in the player's fork. Use the raw content API for reads — no auth needed for public forks, faster, no rate-limit overhead.

```js
// client/world.js

const RAW = "https://raw.githubusercontent.com";

export async function loadWorldState() {
  const userid = getUserid();
  const base   = `${RAW}/${userid}/conspiracy/main`;

  const [turn, factions, heroes, regions, economy, belief] = await Promise.all([
    fetchJSON(`${RAW}/conspiracy-canonical/conspiracy/main/shared/turn.json`),
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
  const repo    = `${userid}/conspiracy`;
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
const logUrl = `${RAW}/${userid}/conspiracy/main/${userid}/history/events.log`;
const log    = await fetch(logUrl).then((r) => r.text());
```

---

## Error Reference

| Situation | API status | Handling |
|---|---|---|
| Token missing | — | Run PKCE login flow |
| Token expired/revoked | 401 | Clear token, re-run PKCE login |
| OAuth state mismatch | — | Abort and show error (possible CSRF) |
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

PKCE prevents authorization code interception attacks. The `state` parameter prevents CSRF. The token obtained via PKCE acts on behalf of the user — it can only do what the user's own GitHub account can do and cannot access other players' private forks.

---

## CORS Notes

- **GitHub API** (`api.github.com`): full CORS support; all write calls work from the browser
- **Raw content** (`raw.githubusercontent.com`): CORS supported for GET; no auth header needed for public repos
- **OAuth PKCE endpoints** (`github.com/login/oauth/...`): CORS supported only if `Accept: application/json` is sent — without it GitHub returns `application/x-www-form-urlencoded` and the preflight fails
