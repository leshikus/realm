/**
 * github.js — GitHub REST API client.
 * Fetches world state JSON from the repo and submits orders as a PR.
 */

/** The upstream repo all player forks are created from. */
const CANONICAL_REPO = 'dataved/realm';

/** Thrown when the GitHub API responds with 401. Caller should re-auth. */
export class AuthError extends Error {
  constructor() { super('GitHub token expired or revoked'); this.status = 401; }
}

export class GitHubClient {
  constructor({ token, repo }) {
    this.token = token;
    this.repo  = repo;   // "owner/repo"
    this.base  = 'https://api.github.com';
  }

  // ── Raw file fetch ──────────────────────────────────────────────────

  /** Fetch a JSON file from the repo's default branch. */
  async fetchJSON(path) {
    const url = `https://raw.githubusercontent.com/${this.repo}/main/${path}`;
    const res = await fetch(url, { headers: this._headers() });
    if (!res.ok) throw new Error(`fetchJSON ${path}: ${res.status}`);
    return res.json();
  }

  /** Fetch a text file (e.g. events.log). Returns string or null. */
  async fetchText(path) {
    const url = `https://raw.githubusercontent.com/${this.repo}/main/${path}`;
    const res = await fetch(url, { headers: this._headers() });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`fetchText ${path}: ${res.status}`);
    return res.text();
  }

  // ── World state loading ─────────────────────────────────────────────

  async loadWorld(userid) {
    const base = `world/${userid}`;
    const [heroes, factions, regions, armies, economy, belief, turnObj] =
      await Promise.all([
        this.fetchJSON(`${base}/heroes.json`).catch(() => []),
        this.fetchJSON(`${base}/factions.json`).catch(() => []),
        this.fetchJSON(`${base}/regions.json`).catch(() => []),
        this.fetchJSON(`${base}/armies.json`).catch(() => []),
        this.fetchJSON(`${base}/economy.json`).catch(() => ({})),
        this.fetchJSON(`${base}/belief.json`).catch(() => ({})),
        this.fetchJSON(`${base}/turn.json`).catch(() => ({ turn: 0 })),
      ]);
    return { heroes, factions, regions, armies, economy, belief, turn: turnObj.turn ?? 0 };
  }

  async loadEventLog(userid) {
    const text = await this.fetchText(`world/${userid}/history/events.log`);
    if (!text) return [];
    return text.split('\n').map(l => l.trim()).filter(Boolean).reverse();
  }

  /** Load per-turn stats snapshots for the Statistics panel. */
  async loadStats(userid) {
    // List files in world/{userid}/history/ via GitHub Trees API
    const res = await this._get(`/repos/${this.repo}/git/trees/main?recursive=1`);
    const prefix = `world/${userid}/history/stats_`;
    const files = (res.tree ?? [])
      .filter(f => f.path.startsWith(prefix) && f.path.endsWith('.json'))
      .map(f => f.path)
      .sort();

    const snapshots = await Promise.all(
      files.map(f => this.fetchJSON(f).catch(() => null))
    );
    return snapshots.filter(Boolean);
  }

  // ── Onboarding helpers ─────────────────────────────────────────────

  /**
   * Fork the canonical realm repo into the authenticated user's account.
   * Returns the fork object. GitHub creates forks asynchronously — callers
   * should poll isForkReady() after this returns.
   */
  async forkCanonical() {
    return this._post(`/repos/${CANONICAL_REPO}/forks`, {});
  }

  /** Returns true once the player's fork exists and is accessible. */
  async isForkReady(userid) {
    try {
      await this._get(`/repos/${userid}/realm`);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Create a branch on the player's fork, add world/{userid}/turn.json,
   * and return the branch name. This is the "sample modification" step.
   */
  async initWorldBranch(userid) {
    const branch = `join/${userid}`;
    const path   = `world/${userid}/turn.json`;

    // Get HEAD of main on the fork
    const ref = await this._get(`/repos/${userid}/realm/git/ref/heads/main`);
    const sha  = ref.object.sha;

    // Create the join branch
    await this._post(`/repos/${userid}/realm/git/refs`, {
      ref: `refs/heads/${branch}`,
      sha,
    });

    // Commit the initial world file
    await this._put(`/repos/${userid}/realm/contents/${path}`, {
      message: `Initialize world for ${userid}`,
      content: btoa(JSON.stringify({ turn: 0 }, null, 2)),
      branch,
    });

    return branch;
  }

  /**
   * Open a PR from the player's fork branch to the canonical repo's main.
   * Returns the PR object (includes html_url).
   */
  async submitJoinPR(userid, branch) {
    return this._post(`/repos/${CANONICAL_REPO}/pulls`, {
      title: `Join: ${userid}`,
      head:  `${userid}:${branch}`,
      base:  'main',
      body:  `World initialization for player **${userid}**.`,
    });
  }

  // ── Order submission ────────────────────────────────────────────────

  /**
   * Create a branch, commit the orders file, and open a PR.
   * Returns the PR HTML URL.
   */
  async submitOrders(userid, turn, ordersObj) {
    const branch  = `orders/turn-${String(turn).padStart(4, '0')}-${userid}`;
    const path    = `world/${userid}/orders/turn.json`;
    const content = JSON.stringify(ordersObj, null, 2);

    // 1. Get main SHA
    const ref = await this._get(`/repos/${this.repo}/git/ref/heads/main`);
    const sha = ref.object.sha;

    // 2. Create branch
    await this._post(`/repos/${this.repo}/git/refs`, {
      ref: `refs/heads/${branch}`, sha,
    });

    // 3. Commit file
    await this._put(`/repos/${this.repo}/contents/${path}`, {
      message: `Turn ${turn} orders`,
      content: btoa(unescape(encodeURIComponent(content))),
      branch,
    });

    // 4. Open PR
    const pr = await this._post(`/repos/${this.repo}/pulls`, {
      title: `Turn ${turn} orders`,
      head:  branch,
      base:  'main',
      body:  `Automated turn ${turn} order submission.`,
    });

    return pr.html_url;
  }

  // ── HTTP helpers ────────────────────────────────────────────────────

  _headers() {
    return {
      'Authorization':        `Bearer ${this.token}`,
      'Accept':               'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
  }

  async _request(method, path, body) {
    const res = await fetch(`${this.base}${path}`, {
      method,
      headers: { ...this._headers(), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401) throw new AuthError();
    if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`);
    return res.json();
  }

  _get(path)        { return this._request('GET',  path); }
  _post(path, body) { return this._request('POST', path, body); }
  _put(path, body)  { return this._request('PUT',  path, body); }
}
