/**
 * github.js — GitHub REST API client.
 * Fetches world state JSON from the repo and submits orders as a PR.
 */
import { dbg } from './debug.js';

/** Thrown when the GitHub API responds with 401. Caller should re-auth. */
export class AuthError extends Error {
  constructor() { super('GitHub token expired or revoked'); this.status = 401; }
}

export class GitHubClient {
  constructor({ token, repo }) {
    this.token = token;
    this.repo  = repo;   // "owner/repo" — authenticated user owns this repo
    this.base  = 'https://api.github.com';
  }

  // ── Raw file fetch ──────────────────────────────────────────────────

  /** Fetch a JSON file from the repo's default branch. */
  async fetchJSON(path) {
    const url = `https://raw.githubusercontent.com/${this.repo}/main/${path}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`fetchJSON ${path}: ${res.status}`);
    return res.json();
  }

  /** Fetch a text file (e.g. events.log). Returns string or null. */
  async fetchText(path) {
    const url = `https://raw.githubusercontent.com/${this.repo}/main/${path}`;
    const res = await fetch(url);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`fetchText ${path}: ${res.status}`);
    return res.text();
  }

  // ── World state loading ─────────────────────────────────────────────

  async loadWorld(userid) {
    const load = async (path, fallback) => {
      try {
        const url = `https://raw.githubusercontent.com/${this.repo}/main/${path}`;
        const res = await fetch(url);
        if (res.ok) return res.json();
      } catch {}
      return fallback;
    };

    const [heroes, factions, regions, armies, economy, belief, turnObj] =
      await Promise.all([
        load(`${userid}/heroes.json`,   []),
        load(`${userid}/factions.json`, []),
        load(`${userid}/regions.json`,  []),
        load(`${userid}/armies.json`,   []),
        load(`${userid}/economy.json`,  {}),
        load(`${userid}/belief.json`,   {}),
        load(`${userid}/turn.json`,     { turn: 0 }),
      ]);
    return { heroes, factions, regions, armies, economy, belief, turn: turnObj.turn ?? 0 };
  }

  async loadEventLog(userid) {
    const url = `https://raw.githubusercontent.com/${this.repo}/main/${userid}/history/events.log`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const text = await res.text();
    return text.split('\n').map(l => l.trim()).filter(Boolean).reverse();
  }

  /** Load per-turn stats snapshots for the Statistics panel. */
  async loadStats(userid) {
    const res    = await this._get(`/repos/${this.repo}/git/trees/main?recursive=1`);
    const prefix = `${userid}/history/stats_`;
    const files  = (res.tree ?? [])
      .filter(f => f.path.startsWith(prefix) && f.path.endsWith('.json'))
      .map(f => f.path)
      .sort();

    const snapshots = await Promise.all(
      files.map(f => {
        const url = `https://raw.githubusercontent.com/${this.repo}/main/${f}`;
        return fetch(url).then(r => r.ok ? r.json() : null).catch(() => null);
      })
    );
    return snapshots.filter(Boolean);
  }

  // ── Onboarding helpers ─────────────────────────────────────────────

  /**
   * Fork the canonical conspiracy repo into the authenticated user's account.
   * Returns the fork object. GitHub creates forks asynchronously — callers
   * should poll isForkReady() after this returns.
   */
  async forkCanonical() {
    return this._post(`/repos/${this.repo}/forks`, {});
  }

  /** Returns true once the player's fork exists and is accessible. */
  async isForkReady(userid) {
    try {
      await this._get(`/repos/${userid}/conspiracy`);
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
    const path   = `${userid}/turn.json`;

    // Get HEAD of main on the fork
    const ref = await this._get(`/repos/${userid}/conspiracy/git/ref/heads/main`);
    const sha  = ref.object.sha;

    // Create the join branch
    await this._post(`/repos/${userid}/conspiracy/git/refs`, {
      ref: `refs/heads/${branch}`,
      sha,
    });

    // Commit the initial world file
    await this._put(`/repos/${userid}/conspiracy/contents/${path}`, {
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
    return this._post(`/repos/${this.repo}/pulls`, {
      title: `Join: ${userid}`,
      head:  `${userid}:${branch}`,
      base:  'main',
      body:  `World initialization for player **${userid}**.`,
    });
  }

  // ── Order submission ────────────────────────────────────────────────

  /**
   * Commit orders to a branch on the player's fork, then open a PR
   * from that branch to the canonical repo's main.
   * Returns the PR HTML URL.
   */
  async submitOrders(userid, turn, ordersObj) {
    const branch  = `orders/turn-${String(turn).padStart(4, '0')}`;
    const path    = `${userid}/orders/turn.json`;
    const content = JSON.stringify(ordersObj, null, 2);

    // 1. Get HEAD of main on the player's fork
    const ref = await this._get(`/repos/${this.repo}/git/ref/heads/main`);
    const sha = ref.object.sha;

    // 2. Create orders branch on the fork (ignore 422 if it already exists)
    try {
      await this._post(`/repos/${this.repo}/git/refs`, {
        ref: `refs/heads/${branch}`, sha,
      });
    } catch (err) {
      if (!err.message.includes('422')) throw err;
    }

    // 3. Commit orders file to the branch (fetch existing SHA if present)
    let existingSha;
    try {
      const existing = await this._get(`/repos/${this.repo}/contents/${path}?ref=${branch}`);
      existingSha = existing.sha;
    } catch {}

    await this._put(`/repos/${this.repo}/contents/${path}`, {
      message: `Turn ${turn} orders`,
      content: btoa(unescape(encodeURIComponent(content))),
      branch,
      ...(existingSha ? { sha: existingSha } : {}),
    });

    // 4. Open PR from fork branch to canonical repo main
    const pr = await this._post(`/repos/${this.repo}/pulls`, {
      title: `Turn ${turn} orders — ${userid}`,
      head:  `${userid}:${branch}`,
      base:  'main',
      body:  `Turn ${turn} order submission by ${userid}.`,
    });

    return pr.html_url;
  }

  // ── Turn management ────────────────────────────────────────────────

  /**
   * Advance shared/world.json to the next turn and optionally set a deadline.
   * This writes directly to the canonical repo's main branch (game-master only).
   */
  async advanceTurn(userid, deadlineUtc = null) {
    const path = 'shared/world.json';
    // Read current world.json
    const fileRes  = await this._get(`/repos/${this.repo}/contents/${path}`);
    const current  = JSON.parse(atob(fileRes.content.replace(/\n/g, '')));
    const nextTurn = (current.current_turn ?? 1) + 1;
    const updated  = { ...current, current_turn: nextTurn, turn_deadline_utc: deadlineUtc ?? null };
    await this._put(`/repos/${this.repo}/contents/${path}`, {
      message: `Advance to turn ${nextTurn}`,
      content: btoa(JSON.stringify(updated, null, 2)),
      sha:     fileRes.sha,
    });
    return nextTurn;
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
    const url = `${this.base}${path}`;
    const t0  = Date.now();
    const res = await fetch(url, {
      method,
      headers: { ...this._headers(), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const ms = Date.now() - t0;

    const remaining = res.headers.get('X-RateLimit-Remaining');
    const limit     = res.headers.get('X-RateLimit-Limit');
    const reset     = res.headers.get('X-RateLimit-Reset');
    if (remaining != null) dbg.setRateLimit({ remaining: +remaining, limit: +limit, reset: +reset });

    dbg.api(method, url, res.status, ms, remaining != null ? +remaining : undefined);

    if (res.status === 401) throw new AuthError();
    if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`);
    return res.json();
  }

  _get(path)        { return this._request('GET',  path); }
  _post(path, body) { return this._request('POST', path, body); }
  _put(path, body)  { return this._request('PUT',  path, body); }
}
