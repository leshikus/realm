/**
 * app.js — Root controller.
 * Wires together config, GitHub client, and all UI panels.
 */
import { Config }       from './config.js';
import { GitHubClient } from './github.js';
import { MapView }      from './mapview.js';
import { EventViewer }  from './eventviewer.js';
import { StatsPanel }   from './statspanel.js';
import { OrdersPanel }  from './orderspanel.js';

// ── State ──────────────────────────────────────────────────────────────────
let gh     = null;
let world  = null;
let cfg    = null;

// ── Boot ───────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  cfg = Config.load();
  if (!cfg || !cfg.github_token) {
    showSetup();
  } else {
    initApp();
  }
});

// ── Setup screen ────────────────────────────────────────────────────────────
function showSetup() {
  document.getElementById('setup-screen').classList.remove('hidden');
  document.getElementById('app').classList.add('hidden');

  document.getElementById('cfg-save').addEventListener('click', () => {
    const newCfg = {
      userid:       document.getElementById('cfg-userid').value.trim(),
      github_repo:  document.getElementById('cfg-repo').value.trim(),
      github_token: document.getElementById('cfg-token').value.trim(),
    };
    if (!newCfg.userid || !newCfg.github_repo || !newCfg.github_token) {
      alert('All fields are required.');
      return;
    }
    Config.save(newCfg);
    cfg = newCfg;
    document.getElementById('setup-screen').classList.add('hidden');
    initApp();
  });
}

// ── Main app ────────────────────────────────────────────────────────────────
async function initApp() {
  document.getElementById('app').classList.remove('hidden');

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

  // Config button — clear and reload
  document.getElementById('btn-config').addEventListener('click', () => {
    if (confirm('Reset configuration?')) {
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
      world = await gh.loadWorld(cfg.userid);

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
      eventViewer.load(events);

      // Stats
      const snapshots = await gh.loadStats(cfg.userid);
      statsPanel.render(snapshots);

    } catch (err) {
      document.getElementById('header-turn').textContent = 'Error loading world';
      console.error(err);
    }
  }

  loadWorld();
}
