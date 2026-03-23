# Authentication — Conspiracy

Authentication is PAT-only. The browser client is a static site on GitHub Pages with no backend; there is no place to store a `client_secret`, so OAuth web flow is not available. Players authenticate by pasting a Personal Access Token into the login screen.

---

## Getting a Token

### Classic token (simplest)

1. Go to **GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic)**
2. Click **Generate new token (classic)**
3. Set an expiration (90 days is reasonable)
4. Select one scope: **`repo`**
   - This grants read and write access to your repositories — required to create branches, commit files, and open PRs on your fork
5. Click **Generate token**
6. Copy the token immediately — GitHub shows it once

Paste the token and your GitHub username into the Conspiracy login screen.

### Fine-grained token (more limited)

Fine-grained tokens scope permissions per repository, reducing exposure if the token leaks.

1. Go to **GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens**
2. Click **Generate new token**
3. Set **Resource owner** to your account
4. Under **Repository access**, select **Only select repositories** → choose your `conspiracy` fork
5. Under **Repository permissions**, set:
   - **Contents**: Read and write (create/update files and branches)
   - **Pull requests**: Read and write (open PRs)
   - **Metadata**: Read (required — auto-selected)
6. Click **Generate token**

This token can only touch your `conspiracy` fork, nothing else in your account.

---

## Token Scope Reference

| Operation | Why it's needed |
|---|---|
| Read world state JSON | Raw content fetch — no auth required for public forks, but token needed if fork is private |
| Create branch | `Contents: write` or `repo` |
| Commit orders file | `Contents: write` or `repo` |
| Open PR | `Pull requests: write` or `repo` |

The client never requests more than these operations.

---

## Session Behaviour

The token is stored in `localStorage` under the key `conspiracy_config`. It persists until:

- You click **⚙ Config → Log out** in the header
- You clear site data in your browser
- The token expires or is revoked on GitHub

On a 401 response from the GitHub API, the client clears the stored token and returns to the login screen with a message.

---

## Full Turn Flow

```
Player opens https://{userid}.github.io/conspiracy
    │
    ▼
[1] Auth check — is a token in localStorage?
    │   No  → show login screen → user enters PAT + username → verify via api.github.com/user → store
    │   Yes → use it; clear + return to login on 401
    │
    ▼
[2] Load world state
    │   GET raw.githubusercontent.com/{userid}/conspiracy/main/world/{userid}/*.json
    │   Falls back to canonical repo if player's fork has no data yet
    │
    ▼
[3] Player composes orders in the Orders panel
    │
    ▼
[4] Submit orders
    │   POST api.github.com → create branch   orders/turn-{N}
    │   PUT  api.github.com → commit file      world/{userid}/orders/turn.json
    │   POST api.github.com → open PR          orders/turn-{N} → main
    │
    ▼
[5] CI runs process-turn.yml, auto-merges on success
    │
    ▼
[6] Player reloads client → new world state rendered
```

---

## Error Reference

| Situation | Handling |
|---|---|
| No token in storage | Show login screen |
| 401 from any API call | Clear token, show login screen with "Token expired or revoked" |
| Invalid token on login | Show error inline in login form |
| Branch already exists (422) | Proceed — file write still works |
| File already exists on branch | Fetch existing file SHA, include in PUT body |
| PR already open for this turn | Fetch existing PR and return its URL |
| Rate limit hit (403 + `X-RateLimit-Remaining: 0`) | Debug panel shows remaining/limit; retry after `X-RateLimit-Reset` |

---

## CORS Notes

- **`api.github.com`** — full CORS support; all write operations work from the browser
- **`raw.githubusercontent.com`** — CORS supported for GET; no auth header required for public forks
- There is no token exchange endpoint used (PAT does not require one)
