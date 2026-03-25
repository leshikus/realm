/**
 * app.js — Root controller.
 * Wires together config, GitHub client, and all UI panels.
 */
import { Config }       from './config.js';
import { GitHubClient, AuthError } from './github.js';
import { MusicPlayer }  from './musicplayer.js';
import { dbg, initDebugPanel } from './debug.js';
import { MapView }      from './mapview.js';
import { EventViewer }  from './eventviewer.js';
import { StatsPanel }   from './statspanel.js';
import { OrdersPanel }  from './orderspanel.js';
import { SetupPanel }   from './setuppanel.js';
import { RegionInfoPanel }   from './regionpanel.js';
import { RegionOrdersPanel } from './regionorders.js';

// ── Turn → date ────────────────────────────────────────────────────────────
const GAME_START_YEAR = new Date().getFullYear();
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function turnToDate(turn) {
  const d = new Date(GAME_START_YEAR, 0, 1 + (turn - 1) * 7);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

// ── State ──────────────────────────────────────────────────────────────────
let gh     = null;
let world  = null;
let cfg    = null;
let music  = null;

// ── Boot ───────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  dbg.info('DOMContentLoaded');

  cfg = Config.load();
  dbg.info('Config loaded', {
    userid:   cfg?.userid ?? null,
    repo:     cfg?.github_repo ?? null,
    hasToken: !!cfg?.github_token,
  });

  if (!cfg?.github_token) {
    dbg.info('No token — showing login screen');
    showLogin();
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

  document.getElementById('btn-pat').addEventListener('click', async () => {
    const token      = document.getElementById('pat-input').value.trim();
    const mubertKey  = document.getElementById('mubert-key-input').value.trim();
    const errEl      = document.getElementById('login-error');

    if (!token) {
      errEl.textContent = 'Enter a Personal Access Token.';
      errEl.classList.remove('hidden');
      return;
    }

    errEl.classList.add('hidden');
    try {
      const me = await fetch('https://api.github.com/user', {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
      }).then(r => r.ok ? r.json() : Promise.reject(new Error('Invalid token')));

      cfg = { userid: me.login, github_token: token, github_repo: `${me.login}/conspiracy`, ...(mubertKey ? { mubert_api_key: mubertKey } : {}) };
      Config.save(cfg);
      dbg.info('PAT login successful', { userid: cfg.userid });
      initApp();
    } catch (err) {
      dbg.error('PAT login failed', { message: err.message });
      errEl.textContent = `Token error: ${err.message}`;
      errEl.classList.remove('hidden');
    }
  }, { once: true });
}

// ── Re-auth helper ────────────────────────────────────────────────────────────
function handleAuthError() {
  Config.clear();
  cfg = null;
  dbg.warn('Token invalid — returning to login');
  showLogin('Your token has expired or been revoked. Please enter a new one.');
}

// ── Main app ────────────────────────────────────────────────────────────────
function initApp() {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');

  const debugPanel = initDebugPanel(() => cfg);
  const btnDebug = document.getElementById('btn-debug');
  if (cfg.debug) btnDebug.classList.remove('hidden');
  btnDebug.addEventListener('click', () => debugPanel.toggle());
  dbg.info('App initialised', { userid: cfg.userid, repo: cfg.github_repo });

  gh = new GitHubClient({ token: cfg.github_token, repo: cfg.github_repo });

  music = new MusicPlayer({
    playBtn:      document.getElementById('btn-music-play'),
    skipBtn:      document.getElementById('btn-music-skip'),
    titleEl:      document.getElementById('music-title'),
    volumeEl:     document.getElementById('music-volume'),
    mubertApiKey: cfg.mubert_api_key ?? null,
  });

  // Tab switching
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
    });
  });

  // Config dropdown menu
  const cfgWrap  = document.getElementById('config-menu-wrap');
  const cfgMenu  = document.getElementById('config-menu');
  document.getElementById('btn-config').addEventListener('click', e => {
    e.stopPropagation();
    cfgMenu.classList.toggle('hidden');
  });
  document.addEventListener('click', () => cfgMenu.classList.add('hidden'));

  document.getElementById('cfg-reload').addEventListener('click', () => {
    cfgMenu.classList.add('hidden');
    loadWorld();
  });
  document.getElementById('cfg-logout').addEventListener('click', () => {
    cfgMenu.classList.add('hidden');
    if (confirm('Log out and reset configuration?')) { Config.clear(); location.reload(); }
  });
  document.getElementById('cfg-new-turn').addEventListener('click', () => {
    cfgMenu.classList.add('hidden');
    openCreateTurnModal();
  });

  // ── Map selection overlay ─────────────────────────────────────────────
  const mapSelectionEl = document.getElementById('map-selection');
  const regionInfoEl   = document.getElementById('region-info');
  const regionOrdersEl = document.getElementById('region-orders');

  // mapView is assigned below; dismissMapSelection closes over the let binding.
  let mapView;

  function dismissMapSelection() {
    mapSelectionEl.classList.remove('open');
    mapView?.deselect();
  }

  const regionInfoPanel   = new RegionInfoPanel(regionInfoEl, { onDismiss: dismissMapSelection });
  // ordersPanel is declared below; the lambda closes over it — safe because it only
  // fires after user interaction, by which point ordersPanel is fully initialised.
  const regionOrdersPanel = new RegionOrdersPanel(regionOrdersEl, (type, params) => {
    ordersPanel.addOrder(type, params);
  });

  // Init panels
  mapView = new MapView(
    document.getElementById('map-canvas'),
    (region) => {
      if (region && world) {
        regionInfoPanel.show(region, world);
        regionOrdersPanel.show(region, world);
        mapSelectionEl.classList.add('open');
      } else {
        mapSelectionEl.classList.remove('open');
      }
    },
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
        turn:     world.turn,
        regions:  world.regions?.length ?? 0,
        heroes:   world.heroes?.length  ?? 0,
        factions: world.factions?.length ?? 0,
      });
      dbg.setWorld(world);
      music.update(world);

      document.getElementById('header-turn').textContent  = turnToDate(world.turn);
      document.getElementById('header-trust').textContent = `Trust: ${world.economy.trust ?? 0}`;

      mapView.render(world);
      ordersPanel.setContext(gh, cfg.userid, world.turn, { onSubmit: () => music.triggerResolution() });

      const events = await gh.loadEventLog(cfg.userid);
      dbg.info('Event log loaded', { entries: events.length });
      eventViewer.load(events);

      const snapshots = await gh.loadStats(cfg.userid);
      dbg.info('Stats snapshots loaded', { count: snapshots.length });
      statsPanel.render(snapshots);

    } catch (err) {
      if (err instanceof AuthError) {
        dbg.error('Auth error during world load');
        handleAuthError();
        return;
      }
      dbg.error('World load failed', { message: err.message, stack: err.stack });
      document.getElementById('header-turn').textContent = 'Error loading world';
      console.error(err);
    }
  }

  // ── Create Turn modal ─────────────────────────────────────────────────────
  function openCreateTurnModal() {
    const current = world?.turn ?? 1;
    const next    = current + 1;
    document.getElementById('ct-current').value = `Turn ${current} — ${turnToDate(current)}`;
    document.getElementById('ct-next').value    = `Turn ${next} — ${turnToDate(next)}`;
    // Default deadline: 7 days from now at noon UTC
    const dl = new Date();
    dl.setDate(dl.getDate() + 7);
    dl.setHours(12, 0, 0, 0);
    document.getElementById('ct-deadline').value = dl.toISOString().slice(0, 16);
    document.getElementById('ct-status').textContent = '';
    document.getElementById('create-turn-modal').classList.remove('hidden');
  }

  document.getElementById('ct-cancel').addEventListener('click', () => {
    document.getElementById('create-turn-modal').classList.add('hidden');
  });

  document.getElementById('ct-confirm').addEventListener('click', async () => {
    const statusEl  = document.getElementById('ct-status');
    const deadlineEl = document.getElementById('ct-deadline');
    const deadline  = deadlineEl.value ? new Date(deadlineEl.value).toISOString() : null;
    statusEl.textContent = 'Advancing turn…';
    try {
      await gh.advanceTurn(cfg.userid, deadline);
      document.getElementById('create-turn-modal').classList.add('hidden');
      await loadWorld();
    } catch (err) {
      statusEl.textContent = `Error: ${err.message}`;
    }
  });

  loadWorld();
}
