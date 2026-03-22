/**
 * app.js — Root controller.
 * Wires together config, GitHub client, and all UI panels.
 */
import { Config }       from './config.js';
import { handleCallback, startLogin } from './auth.js';
import { GitHubClient, AuthError } from './github.js';
import { dbg, initDebugPanel } from './debug.js';
import { MapView }      from './mapview.js';
import { EventViewer }  from './eventviewer.js';
import { StatsPanel }   from './statspanel.js';
import { OrdersPanel }  from './orderspanel.js';
import { SetupPanel }   from './setuppanel.js';

// ── State ──────────────────────────────────────────────────────────────────
let gh     = null;
let world  = null;
let cfg    = null;

// ── Boot ───────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  dbg.info('DOMContentLoaded');

  // 1. Handle OAuth callback (present when GitHub redirects back with ?code=...)
  let callbackError = null;
  try {
    const token = await handleCallback();
    if (token) {
      // Fetch the authenticated user to get their login name
      const me = await fetch('https://api.github.com/user', {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
      }).then(r => r.json());

      Config.save({
        userid:       me.login,
        github_token: token,
        github_repo:  `${me.login}/conspiracy`,
      });
      dbg.info('OAuth callback: token saved', { userid: me.login });
    }
  } catch (err) {
    callbackError = err.message;
    dbg.error('OAuth callback failed', { message: err.message });
  }

  // 2. Check stored config
  cfg = Config.load();
  dbg.info('Config loaded', {
    userid:  cfg?.userid ?? null,
    repo:    cfg?.github_repo ?? null,
    hasToken: !!cfg?.github_token,
  });

  if (!cfg?.github_token) {
    dbg.info('No token — showing login screen');
    showLogin(callbackError);
    return;
  }

  initApp();
});

// ── Login screen ─────────────────────────────────────────────────────────────
function showLogin(errorMsg) {
  document.getElementById('login-screen').classList.remove('hidden');
  document.getElementById('app').classList.add('hidden');

  if (errorMsg) {
    const errEl = document.getElementById('login-error');
    errEl.textContent = errorMsg;
    errEl.classList.remove('hidden');
  }

  document.getElementById('btn-login').addEventListener('click', () => startLogin());

  document.getElementById('btn-pat').addEventListener('click', async () => {
    const token  = document.getElementById('pat-input').value.trim();
    const userid = document.getElementById('pat-userid').value.trim();
    const errEl  = document.getElementById('login-error');

    if (!token || !userid) {
      errEl.textContent = 'Enter both a token and your GitHub username.';
      errEl.classList.remove('hidden');
      return;
    }

    // Verify token by fetching the authenticated user
    try {
      const me = await fetch('https://api.github.com/user', {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
      }).then(r => r.ok ? r.json() : Promise.reject(new Error('Invalid token')));

      Config.save({ userid: me.login ?? userid, github_token: token, github_repo: `${me.login ?? userid}/conspiracy` });
      initApp();
    } catch (err) {
      errEl.textContent = `Token error: ${err.message}`;
      errEl.classList.remove('hidden');
    }
  });
}

// ── Re-auth helper ────────────────────────────────────────────────────────────
function handleAuthError() {
  Config.clear();
  startLogin();
}

// ── Main app ────────────────────────────────────────────────────────────────
function initApp() {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');

  const debugPanel = initDebugPanel(() => cfg);
  document.getElementById('btn-debug').addEventListener('click', () => debugPanel.toggle());
  dbg.info('App initialised', { userid: cfg.userid, repo: cfg.github_repo });

  gh = new GitHubClient({ token: cfg.github_token, repo: cfg.github_repo });

  // Tab switching
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
    });
  });

  // Config button — clear and return to login
  document.getElementById('btn-config').addEventListener('click', () => {
    if (confirm('Log out and reset configuration?')) {
      Config.clear();
      location.reload();
    }
  });

  // Reload button
  document.getElementById('btn-reload').addEventListener('click', () => loadWorld());

  // Init panels
  const mapView = new MapView(
    document.getElementById('map-canvas'),
    document.getElementById('region-detail'),
    () => {},
  );

  const eventViewer = new EventViewer(
    document.getElementById('events-list'),
    document.getElementById('events-filter'),
  );

  const statsPanel = new StatsPanel();

  new SetupPanel(
    {
      forkBtn:    document.getElementById('btn-fork'),
      forkStatus: document.getElementById('fork-status'),
      initBtn:    document.getElementById('btn-init-world'),
      initStatus: document.getElementById('init-status'),
      prBtn:      document.getElementById('btn-join-pr'),
      prStatus:   document.getElementById('pr-status'),
    },
    gh,
    cfg.userid,
  );

  const ordersPanel = new OrdersPanel({
    typeEl:    document.getElementById('order-type'),
    paramsEl:  document.getElementById('order-params'),
    listEl:    document.getElementById('orders-list'),
    countEl:   document.getElementById('order-count'),
    statusEl:  document.getElementById('orders-status'),
    addBtn:    document.getElementById('btn-add-order'),
    clearBtn:  document.getElementById('btn-clear-orders'),
    submitBtn: document.getElementById('btn-submit-orders'),
  });

  // Load world and wire everything up
  async function loadWorld() {
    document.getElementById('header-turn').textContent  = 'Loading…';
    document.getElementById('header-trust').textContent = '';
    try {
      dbg.info('Loading world…', { userid: cfg.userid });
      world = await gh.loadWorld(cfg.userid);
      dbg.info('World loaded', {
        turn:    world.turn,
        regions: world.regions?.length ?? 0,
        heroes:  world.heroes?.length  ?? 0,
        factions: world.factions?.length ?? 0,
      });
      dbg.setWorld(world);

      // Header
      document.getElementById('header-turn').textContent  = `Turn ${world.turn}`;
      document.getElementById('header-trust').textContent =
        `Trust: ${world.economy.trust ?? 0}`;

      // Map
      mapView.render(world);

      // Orders context
      ordersPanel.setContext(gh, cfg.userid, world.turn);

      // Events
      const events = await gh.loadEventLog(cfg.userid);
      dbg.info('Event log loaded', { entries: events.length });
      eventViewer.load(events);

      // Stats
      const snapshots = await gh.loadStats(cfg.userid);
      dbg.info('Stats snapshots loaded', { count: snapshots.length });
      statsPanel.render(snapshots);

    } catch (err) {
      if (err instanceof AuthError) {
        dbg.error('Auth error during world load — re-authenticating');
        handleAuthError();
        return;
      }
      dbg.error('World load failed', { message: err.message, stack: err.stack });
      document.getElementById('header-turn').textContent = 'Error loading world';
      console.error(err);
    }
  }

  loadWorld();
}
