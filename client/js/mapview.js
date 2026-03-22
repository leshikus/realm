/**
 * mapview.js — Canvas-based map rendering.
 * Draws region cards in a grid. Click a region to show detail panel.
 */
export class MapView {
  constructor(canvas, detailEl, onSelect) {
    this.canvas   = canvas;
    this.ctx      = canvas.getContext('2d');
    this.detailEl = detailEl;
    this.onSelect = onSelect;
    this._regions  = [];
    this._armies   = {};
    this._heroes   = {};
    this._cards    = [];   // { region, x, y, w, h }

    canvas.addEventListener('click', e => this._onClick(e));
    canvas.addEventListener('mousemove', e => this._onHover(e));
  }

  // ── Layout constants ────────────────────────────────────────────────
  static CARD_W  = 200;
  static CARD_H  = 140;
  static CARD_PAD = 12;
  static COLS    = 4;

  render(world) {
    this._regions = world.regions ?? [];
    this._armies  = this._indexBy(world.armies  ?? [], 'region_id');
    this._heroes  = this._indexBy(world.heroes  ?? [], 'region_id');

    if (this._regions.length === 0) {
      this.canvas.width  = 480;
      this.canvas.height = 120;
      const ctx = this.ctx;
      ctx.clearRect(0, 0, 480, 120);
      ctx.fillStyle = '#2e2e42';
      ctx.fillRect(0, 0, 480, 120);
      ctx.fillStyle = '#7878a0';
      ctx.font = '14px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText('No world data found.', 240, 48);
      ctx.font = '12px system-ui';
      ctx.fillText('Complete setup or wait for your first turn to resolve.', 240, 72);
      ctx.textAlign = 'left';
      return;
    }

    const cols = MapView.COLS;
    const rows = Math.ceil(this._regions.length / cols);
    const w = cols * (MapView.CARD_W + MapView.CARD_PAD) + MapView.CARD_PAD;
    const h = rows * (MapView.CARD_H + MapView.CARD_PAD) + MapView.CARD_PAD;

    this.canvas.width  = w;
    this.canvas.height = h;

    this._cards = [];
    this._regions.forEach((region, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = MapView.CARD_PAD + col * (MapView.CARD_W + MapView.CARD_PAD);
      const y = MapView.CARD_PAD + row * (MapView.CARD_H + MapView.CARD_PAD);
      this._cards.push({ region, x, y, w: MapView.CARD_W, h: MapView.CARD_H });
      this._drawCard(region, x, y);
    });
  }

  _drawCard(region, x, y) {
    const ctx = this.ctx;
    const W = MapView.CARD_W, H = MapView.CARD_H;
    const unrest = region.unrest ?? 0;

    // Card background — tinted by unrest
    let bg = '#1a1a24';
    if (unrest > 60) bg = '#2a1a1a';
    else if (unrest > 30) bg = '#231f18';

    ctx.fillStyle = bg;
    ctx.strokeStyle = unrest > 60 ? '#8b2020' : unrest > 30 ? '#7a5f20' : '#2e2e42';
    ctx.lineWidth = 1;
    _roundRect(ctx, x, y, W, H, 6);
    ctx.fill();
    ctx.stroke();

    ctx.save();
    ctx.translate(x + 10, y + 10);

    // Region name
    ctx.fillStyle = '#a89ad4';
    ctx.font = 'bold 13px system-ui';
    ctx.fillText(region.name ?? 'Unknown', 0, 14);

    // Stats row
    ctx.fillStyle = '#7878a0';
    ctx.font = '11px system-ui';
    ctx.fillText(`Pop ${(region.population ?? 0).toLocaleString()}`, 0, 34);
    ctx.fillText(`Prosperity ${region.prosperity ?? 0}`, 80, 34);

    // Unrest bar
    const barW = W - 20;
    ctx.fillStyle = '#2e2e42';
    ctx.fillRect(0, 44, barW, 6);
    const unrestColor = unrest > 60 ? '#c0392b' : unrest > 30 ? '#e67e22' : '#27ae60';
    ctx.fillStyle = unrestColor;
    ctx.fillRect(0, 44, barW * (unrest / 100), 6);
    ctx.fillStyle = '#7878a0';
    ctx.fillText(`Unrest ${unrest}`, 0, 66);

    // Armies
    const armies = this._armies[region.id] ?? [];
    if (armies.length) {
      ctx.fillStyle = '#e74c3c';
      ctx.fillText('⚔ ' + armies.map(a => a.name).join(', '), 0, 84);
    }

    // Heroes
    const heroes = this._heroes[region.id] ?? [];
    if (heroes.length) {
      ctx.fillStyle = '#f39c12';
      ctx.fillText('★ ' + heroes.map(h => h.name).join(', '), 0, 100);
    }

    // Faction label
    if (region.controlling_faction_id) {
      ctx.fillStyle = '#4a9eff';
      ctx.font = '10px system-ui';
      ctx.fillText(region.controlling_faction_id, 0, 118);
    }

    ctx.restore();
  }

  _onClick(e) {
    const { x, y } = this._pos(e);
    const card = this._cards.find(c =>
      x >= c.x && x <= c.x + c.w && y >= c.y && y <= c.y + c.h
    );
    if (card) {
      this.onSelect(card.region);
      this._showDetail(card.region);
    }
  }

  _onHover(e) {
    const { x, y } = this._pos(e);
    const hit = this._cards.some(c =>
      x >= c.x && x <= c.x + c.w && y >= c.y && y <= c.y + c.h
    );
    this.canvas.style.cursor = hit ? 'pointer' : 'default';
  }

  _showDetail(region) {
    const armies = this._armies[region.id] ?? [];
    const heroes = this._heroes[region.id] ?? [];
    const el = this.detailEl;
    el.classList.remove('hidden');
    el.innerHTML = `
      <h3>${region.name}</h3>
      <div class="stat"><span>Population</span><span class="val">${(region.population ?? 0).toLocaleString()}</span></div>
      <div class="stat"><span>Prosperity</span><span class="val">${region.prosperity ?? 0}</span></div>
      <div class="stat"><span>Unrest</span><span class="val">${region.unrest ?? 0}</span></div>
      <div class="stat"><span>Faction</span><span class="val">${region.controlling_faction_id ?? '—'}</span></div>
      ${armies.length ? `<div class="stat"><span>Armies</span><span class="val">${armies.map(a => a.name).join(', ')}</span></div>` : ''}
      ${heroes.length ? `<div class="stat"><span>Heroes</span><span class="val">${heroes.map(h => h.name).join(', ')}</span></div>` : ''}
      <div class="stat"><span>Adjacent</span><span class="val">${(region.adjacent_region_ids ?? []).join(', ') || '—'}</span></div>
    `;
  }

  _pos(e) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  _indexBy(arr, key) {
    return arr.reduce((acc, item) => {
      const k = item[key];
      if (k) (acc[k] = acc[k] ?? []).push(item);
      return acc;
    }, {});
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
