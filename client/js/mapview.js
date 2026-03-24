/**
 * mapview.js — Force-directed spatial map.
 * Regions are nodes; adjacency_region_ids define edges.
 * Positions are computed via a spring/repulsion simulation, then rendered to canvas.
 */

// ── Colours ──────────────────────────────────────────────────────────────────

const FACTION_COLORS = {
  federation: '#4a9eff',
  syndicate:  '#e6a820',
  conspiracy: '#9b59b6',
};
const COL_BG       = '#0f0f14';
const COL_SURFACE  = '#1a1a24';
const COL_BORDER   = '#2e2e42';
const COL_TEXT     = '#d4d4e8';
const COL_MUTED    = '#7878a0';
const COL_EDGE     = '#2a2a3a';
const COL_EDGE_HOV = '#4a4a6a';
const COL_UNREST_LO = '#27ae60';
const COL_UNREST_MD = '#e67e22';
const COL_UNREST_HI = '#c0392b';

function unrestColor(u) {
  if (u > 60) return COL_UNREST_HI;
  if (u > 30) return COL_UNREST_MD;
  return COL_UNREST_LO;
}

// ── Force-directed layout ────────────────────────────────────────────────────

class ForceLayout {
  constructor(ids, edges) {
    this.ids   = ids;
    this.edges = edges;          // [{a, b}]
    this.pos   = new Map();      // id → {x, y}
    this.vel   = new Map();      // id → {x, y}

    // Seed on a circle so disconnected components spread evenly
    const n = ids.length;
    ids.forEach((id, i) => {
      const angle = (2 * Math.PI * i) / n;
      this.pos.set(id, { x: Math.cos(angle) * 0.4 + (Math.random() - 0.5) * 0.05,
                         y: Math.sin(angle) * 0.4 + (Math.random() - 0.5) * 0.05 });
      this.vel.set(id, { x: 0, y: 0 });
    });
  }

  run(iterations = 300) {
    const K_REPEL  = 0.012;
    const K_SPRING = 0.06;
    const REST_LEN = 0.28;
    const DAMPING  = 0.82;

    for (let iter = 0; iter < iterations; iter++) {
      const force = new Map(this.ids.map(id => [id, { x: 0, y: 0 }]));

      // Repulsion — all pairs
      for (let i = 0; i < this.ids.length; i++) {
        for (let j = i + 1; j < this.ids.length; j++) {
          const a = this.ids[i], b = this.ids[j];
          const pa = this.pos.get(a), pb = this.pos.get(b);
          const dx = pa.x - pb.x, dy = pa.y - pb.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 0.001;
          const f = K_REPEL / (dist * dist);
          const fx = (dx / dist) * f, fy = (dy / dist) * f;
          force.get(a).x += fx; force.get(a).y += fy;
          force.get(b).x -= fx; force.get(b).y -= fy;
        }
      }

      // Spring attraction along edges
      for (const { a, b } of this.edges) {
        if (!this.pos.has(a) || !this.pos.has(b)) continue;
        const pa = this.pos.get(a), pb = this.pos.get(b);
        const dx = pb.x - pa.x, dy = pb.y - pa.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 0.001;
        const stretch = dist - REST_LEN;
        const fx = (dx / dist) * K_SPRING * stretch;
        const fy = (dy / dist) * K_SPRING * stretch;
        force.get(a).x += fx; force.get(a).y += fy;
        force.get(b).x -= fx; force.get(b).y -= fy;
      }

      // Integrate
      for (const id of this.ids) {
        const v = this.vel.get(id), f = force.get(id), p = this.pos.get(id);
        v.x = (v.x + f.x) * DAMPING;
        v.y = (v.y + f.y) * DAMPING;
        p.x += v.x;
        p.y += v.y;
      }
    }

    // Normalise to [-1, 1]
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of this.pos.values()) {
      if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
    }
    const rangeX = maxX - minX || 1, rangeY = maxY - minY || 1;
    for (const p of this.pos.values()) {
      p.x = ((p.x - minX) / rangeX) * 2 - 1;
      p.y = ((p.y - minY) / rangeY) * 2 - 1;
    }
  }
}

// ── MapView ──────────────────────────────────────────────────────────────────

const NODE_R     = 28;
const PADDING    = 80;
const LABEL_OFF  = NODE_R + 14;

export class MapView {
  constructor(canvas, detailEl, onSelect) {
    this.canvas    = canvas;
    this.ctx       = canvas.getContext('2d');
    this.detailEl  = detailEl;
    this.onSelect  = onSelect;

    this._world    = null;
    this._positions = new Map();   // id → {cx, cy}
    this._edges    = [];           // [{a, b}]
    this._selected = null;
    this._hovered  = null;

    canvas.addEventListener('click',     e => this._onClick(e));
    canvas.addEventListener('mousemove', e => this._onHover(e));
    canvas.addEventListener('mouseleave', () => { this._hovered = null; this._draw(); });

    // Resize observer keeps canvas filling its container
    this._ro = new ResizeObserver(() => { if (this._world) this._layout(); });
    this._ro.observe(canvas.parentElement ?? canvas);
  }

  render(world) {
    this._world = world;
    this._selected = null;
    this.detailEl.classList.add('hidden');
    this._layout();
  }

  // ── Layout ─────────────────────────────────────────────────────────────────

  _layout() {
    const regions = this._world?.regions ?? [];

    if (regions.length === 0) {
      this._drawEmpty();
      return;
    }

    // Build edge list (deduplicated)
    const edgeSet = new Set();
    const edges = [];
    for (const r of regions) {
      for (const nb of (r.adjacent_region_ids ?? [])) {
        const key = [r.id, nb].sort().join('|');
        if (!edgeSet.has(key)) { edgeSet.add(key); edges.push({ a: r.id, b: nb }); }
      }
    }
    this._edges = edges;

    // Run force layout
    const fl = new ForceLayout(regions.map(r => r.id), edges);
    fl.run(400);

    // Map normalised [-1,1] to canvas pixels
    const container  = this.canvas.parentElement ?? document.body;
    const W = Math.max(container.clientWidth  - 2, 400);
    const H = Math.max(container.clientHeight - 2, 400);
    this.canvas.width  = W;
    this.canvas.height = H;

    const usableW = W - PADDING * 2;
    const usableH = H - PADDING * 2;

    this._positions.clear();
    for (const r of regions) {
      const p = fl.pos.get(r.id);
      this._positions.set(r.id, {
        cx: PADDING + ((p.x + 1) / 2) * usableW,
        cy: PADDING + ((p.y + 1) / 2) * usableH,
      });
    }

    this._draw();
  }

  // ── Draw ───────────────────────────────────────────────────────────────────

  _draw() {
    const W = this.canvas.width, H = this.canvas.height;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, W, H);

    // Background
    ctx.fillStyle = COL_BG;
    ctx.fillRect(0, 0, W, H);

    if (!this._world?.regions?.length) { this._drawEmpty(); return; }

    const armies  = this._indexBy(this._world.armies ?? [],  'region_id');
    const heroes  = this._indexBy(this._world.heroes ?? [],  'region_id');
    const regions = Object.fromEntries((this._world.regions ?? []).map(r => [r.id, r]));
    const factionColor = this._factionColorMap();

    // Edges
    for (const { a, b } of this._edges) {
      const pa = this._positions.get(a), pb = this._positions.get(b);
      if (!pa || !pb) continue;
      const isHov = (this._hovered === a || this._hovered === b);
      ctx.strokeStyle = isHov ? COL_EDGE_HOV : COL_EDGE;
      ctx.lineWidth   = isHov ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(pa.cx, pa.cy);
      ctx.lineTo(pb.cx, pb.cy);
      ctx.stroke();
    }

    // Nodes
    for (const r of this._world.regions) {
      const pos = this._positions.get(r.id);
      if (!pos) continue;
      this._drawNode(ctx, r, pos, factionColor[r.controlling_faction_id],
                     armies[r.id] ?? [], heroes[r.id] ?? []);
    }
  }

  _drawNode(ctx, region, { cx, cy }, factionCol, armies, heroes) {
    const isSel = this._selected === region.id;
    const isHov = this._hovered  === region.id;
    const unrest = region.unrest ?? 0;

    // Outer glow for selected
    if (isSel) {
      ctx.shadowColor = factionCol ?? '#7c5cbf';
      ctx.shadowBlur  = 18;
    }

    // Node fill — base + unrest tint
    const base = factionCol ?? COL_SURFACE;
    ctx.fillStyle = base;
    ctx.beginPath();
    ctx.arc(cx, cy, NODE_R, 0, Math.PI * 2);
    ctx.fill();

    ctx.shadowBlur = 0;

    // Unrest arc (outer ring, filled clockwise from top)
    if (unrest > 0) {
      ctx.beginPath();
      ctx.arc(cx, cy, NODE_R, -Math.PI / 2, -Math.PI / 2 + (unrest / 100) * Math.PI * 2);
      ctx.strokeStyle = unrestColor(unrest);
      ctx.lineWidth   = 4;
      ctx.stroke();
    }

    // Border
    ctx.strokeStyle = isSel ? (factionCol ?? '#7c5cbf') : isHov ? '#5a5a7a' : COL_BORDER;
    ctx.lineWidth   = isSel ? 2.5 : 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, NODE_R, 0, Math.PI * 2);
    ctx.stroke();

    // Prosperity fill bar (inner circle fill level)
    const pro = (region.prosperity ?? 50) / 100;
    ctx.fillStyle = 'rgba(255,255,255,0.07)';
    ctx.beginPath();
    ctx.arc(cx, cy, NODE_R - 5, 0, Math.PI * 2);
    ctx.fill();

    // Population text (centre)
    ctx.fillStyle = COL_TEXT;
    ctx.font = 'bold 11px system-ui';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const pop = region.population >= 1000
      ? `${(region.population / 1000).toFixed(1)}k`
      : String(region.population ?? '?');
    ctx.fillText(pop, cx, cy);

    // Region name below node
    ctx.fillStyle = isHov || isSel ? COL_TEXT : COL_MUTED;
    ctx.font = `${isSel ? 'bold ' : ''}12px system-ui`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(region.name ?? region.id, cx, cy + LABEL_OFF - 10);

    // Army / hero badges (top-right)
    let badgeX = cx + NODE_R - 4;
    if (armies.length) {
      this._badge(ctx, badgeX, cy - NODE_R + 4, `⚔${armies.length}`, '#e74c3c');
      badgeX -= 26;
    }
    if (heroes.length) {
      this._badge(ctx, badgeX, cy - NODE_R + 4, `★${heroes.length}`, '#f39c12');
    }
  }

  _badge(ctx, x, y, text, color) {
    ctx.fillStyle = color;
    _roundRect(ctx, x - 20, y - 9, 22, 14, 4);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 9px system-ui';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x - 9, y - 2);
  }

  _drawEmpty() {
    const W = this.canvas.width  || 480;
    const H = this.canvas.height || 140;
    const ctx = this.ctx;
    ctx.fillStyle = COL_BG;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = COL_MUTED;
    ctx.font = '14px system-ui';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('No world data — complete setup or wait for turn 1.', W / 2, H / 2);
  }

  // ── Interaction ────────────────────────────────────────────────────────────

  _onClick(e) {
    const { x, y } = this._pos(e);
    const hit = this._hitTest(x, y);
    if (hit) {
      this._selected = hit.id;
      this.onSelect(hit);
      this._showDetail(hit);
      this._draw();
    }
  }

  _onHover(e) {
    const { x, y } = this._pos(e);
    const hit = this._hitTest(x, y);
    const id  = hit?.id ?? null;
    if (id !== this._hovered) {
      this._hovered = id;
      this.canvas.style.cursor = id ? 'pointer' : 'default';
      this._draw();
    }
  }

  _hitTest(x, y) {
    for (const r of (this._world?.regions ?? [])) {
      const pos = this._positions.get(r.id);
      if (!pos) continue;
      const dx = x - pos.cx, dy = y - pos.cy;
      if (dx * dx + dy * dy <= (NODE_R + 4) ** 2) return r;
    }
    return null;
  }

  _showDetail(region) {
    const armies = this._indexBy(this._world.armies ?? [], 'region_id')[region.id] ?? [];
    const heroes = this._indexBy(this._world.heroes ?? [], 'region_id')[region.id] ?? [];
    const factionCol = this._factionColorMap()[region.controlling_faction_id];
    const el = this.detailEl;
    el.classList.remove('hidden');
    el.innerHTML = `
      <h3 style="color:${factionCol ?? '#a89ad4'}">${region.name}</h3>
      <div class="stat"><span>Population</span><span class="val">${(region.population ?? 0).toLocaleString()}</span></div>
      <div class="stat"><span>Prosperity</span><span class="val">${region.prosperity ?? 0}</span></div>
      <div class="stat" style="color:${unrestColor(region.unrest ?? 0)}">
        <span>Unrest</span><span class="val">${region.unrest ?? 0}</span>
      </div>
      <div class="stat"><span>Faction</span><span class="val" style="color:${factionCol ?? COL_MUTED}">${region.controlling_faction_id ?? '—'}</span></div>
      ${armies.length ? `<div class="stat"><span>Armies</span><span class="val">⚔ ${armies.map(a => a.name).join(', ')}</span></div>` : ''}
      ${heroes.length ? `<div class="stat"><span>Heroes</span><span class="val">★ ${heroes.map(h => h.name).join(', ')}</span></div>` : ''}
      <div class="stat"><span>Adjacent</span><span class="val">${(region.adjacent_region_ids ?? []).join(', ') || '—'}</span></div>
    `;
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  _factionColorMap() {
    const map = {};
    for (const f of (this._world?.factions ?? [])) {
      map[f.id] = FACTION_COLORS[f.type] ?? '#7c5cbf';
    }
    return map;
  }

  _indexBy(arr, key) {
    return arr.reduce((acc, item) => {
      const k = item[key];
      if (k) (acc[k] = acc[k] ?? []).push(item);
      return acc;
    }, {});
  }

  _pos(e) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
}

function _roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}
