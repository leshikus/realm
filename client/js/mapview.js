/**
 * mapview.js — Geographic polygon world map (~150 regions).
 * Regions are drawn as rectangular geographic polygons (equirectangular projection).
 */

// ── Colours ──────────────────────────────────────────────────────────────────

const FACTION_COLORS = {
  federation: '#4a9eff',
  syndicate:  '#e6a820',
  conspiracy: '#9b59b6',
};
const COL_OCEAN      = '#0a1020';
const COL_LAND_DEF   = '#1a2030';
const COL_BORDER     = '#2a3548';
const COL_BORDER_HOV = '#4a6088';
const COL_BORDER_SEL = '#8090c8';
const COL_TEXT       = '#d4d4e8';
const COL_MUTED      = '#6878a0';
const COL_UNREST_LO  = '#27ae60';
const COL_UNREST_MD  = '#e67e22';
const COL_UNREST_HI  = '#c0392b';

function unrestColor(u) {
  if (u > 60) return COL_UNREST_HI;
  if (u > 30) return COL_UNREST_MD;
  return COL_UNREST_LO;
}

// ── Geographic polygon data ──────────────────────────────────────────────────
// _b(W, S, E, N) creates a rectangular polygon from bounding box.
// Equirectangular: x = (lon+180)/360, y = (90-lat)/180.

function _b(W, S, E, N) {
  return { poly: [[W,N],[E,N],[E,S],[W,S]], cx: (W+E)/2, cy: (N+S)/2 };
}

const GEO_REGIONS = {
  // ── North America ──
  alaska:               _b(-170, 54, -130, 72),
  canada_west:          _b(-140, 49, -100, 70),
  canada_east:          _b(-100, 45,  -52, 70),
  greenland:            _b( -60, 60,  -16, 84),
  usa_pacific:          _b(-125, 32, -114, 49),
  usa_mountain:         _b(-114, 32, -103, 49),
  usa_great_plains:     _b(-103, 36,  -93, 49),
  usa_midwest:          _b( -93, 36,  -80, 48),
  usa_northeast:        _b( -80, 40,  -67, 47),
  usa_south_central:    _b(-100, 25,  -87, 36),
  usa_southeast:        _b( -87, 25,  -75, 36),
  mexico:               _b(-118, 14,  -87, 32),
  central_america:      _b( -92,  8,  -77, 18),
  caribbean_west:       _b( -90, 18,  -72, 26),
  caribbean_east:       _b( -72, 12,  -60, 24),

  // ── South America ──
  colombia_venezuela:   _b( -82,  0,  -60, 12),
  guiana:               _b( -65, -2,  -44,  8),
  ecuador_peru:         _b( -82,-18,  -68,  4),
  bolivia:              _b( -70,-23,  -55,-10),
  brazil_north:         _b( -70, -5,  -44,  5),
  brazil_northeast:     _b( -50,-16,  -35, -3),
  brazil_central:       _b( -58,-20,  -44, -8),
  brazil_south:         _b( -58,-34,  -43,-20),
  argentina:            _b( -72,-56,  -52,-22),
  chile:                _b( -76,-56,  -66,-18),

  // ── Europe ──
  iceland:              _b( -26, 63,  -12, 67),
  ireland:              _b( -11, 51,   -5, 56),
  england_wales:        _b(  -5, 50,    2, 56),
  scotland:             _b(  -8, 55,    2, 61),
  norway:               _b(   4, 57,   34, 72),
  sweden:               _b(  12, 55,   26, 70),
  finland:              _b(  24, 60,   32, 70),
  denmark:              _b(   8, 54,   16, 58),
  netherlands_belgium:  _b(   2, 50,    8, 54),
  portugal:             _b( -10, 36,   -6, 42),
  spain_north:          _b(  -8, 40,    4, 45),
  spain_south:          _b(  -8, 36,    0, 41),
  france_north:         _b(  -4, 47,    8, 52),
  france_south:         _b(  -2, 42,    8, 47),
  germany_north:        _b(   8, 52,   16, 56),
  germany_south:        _b(   8, 47,   16, 52),
  switzerland_austria:  _b(   6, 46,   18, 49),
  italy_north:          _b(   7, 44,   16, 47),
  italy_south:          _b(  14, 37,   20, 43),
  poland:               _b(  14, 49,   24, 55),
  czechia_slovakia:     _b(  14, 47,   24, 50),
  hungary_croatia:      _b(  14, 45,   22, 48),
  romania:              _b(  22, 43,   30, 48),
  bulgaria_greece:      _b(  20, 36,   28, 44),
  serbia_albania:       _b(  18, 41,   24, 46),
  ukraine_west:         _b(  22, 44,   32, 52),
  ukraine_east:         _b(  32, 44,   40, 52),
  belarus:              _b(  24, 52,   34, 56),
  baltics:              _b(  22, 54,   28, 60),

  // ── Russia & Central Asia ──
  russia_northwest:     _b(  28, 58,   52, 70),
  russia_volga:         _b(  44, 48,   58, 60),
  russia_south:         _b(  38, 42,   54, 52),
  caucasus:             _b(  38, 38,   52, 44),
  kazakhstan:           _b(  50, 40,   84, 56),
  uzbekistan_tajikistan:_b(  56, 36,   76, 44),
  turkmenistan:         _b(  52, 34,   62, 40),
  siberia_west:         _b(  60, 55,   90, 70),
  siberia_central:      _b(  88, 55,  120, 72),
  siberia_east:         _b( 118, 55,  165, 72),
  russia_far_east:      _b( 130, 42,  180, 58),
  russia_yakutia:       _b( 108, 62,  150, 74),

  // ── Middle East & North Africa ──
  turkey_west:          _b(  26, 36,   36, 42),
  turkey_east:          _b(  36, 36,   46, 42),
  georgia_armenia:      _b(  38, 38,   50, 44),
  azerbaijan:           _b(  46, 38,   52, 44),
  syria_lebanon:        _b(  34, 32,   42, 38),
  israel_jordan:        _b(  34, 28,   38, 34),
  iraq:                 _b(  38, 28,   50, 38),
  iran_north:           _b(  44, 34,   62, 42),
  iran_south:           _b(  50, 24,   62, 34),
  iran_central:         _b(  52, 28,   64, 36),
  saudi_arabia:         _b(  36, 14,   52, 32),
  yemen:                _b(  42, 12,   56, 20),
  oman_uae:             _b(  52, 14,   62, 26),
  egypt:                _b(  24, 20,   38, 32),
  libya:                _b(  10, 20,   26, 34),
  algeria_tunisia:      _b(  -2, 20,   14, 38),
  morocco:              _b( -10, 28,    0, 38),
  mauritania_sahara:    _b( -18, 16,   -2, 32),
  sahel_north:          _b(  -2, 10,   22, 22),

  // ── Sub-Saharan Africa ──
  chad:                 _b(  14,  8,   24, 20),
  sudan:                _b(  22, 10,   38, 22),
  south_sudan:          _b(  26,  4,   38, 12),
  ethiopia:             _b(  36,  4,   46, 16),
  somalia:              _b(  42,  0,   52, 12),
  kenya:                _b(  36, -4,   42,  4),
  tanzania:             _b(  30,-12,   40, -4),
  uganda:               _b(  30, -2,   36,  4),
  drc_north:            _b(  18, -2,   32,  6),
  drc_south:            _b(  18,-14,   30, -2),
  angola:               _b(  10,-20,   24, -4),
  zambia:               _b(  22,-18,   34, -8),
  zimbabwe_mozambique:  _b(  30,-26,   40,-14),
  namibia_botswana:     _b(  14,-28,   28,-18),
  south_africa:         _b(  16,-36,   34,-26),
  senegal_guinea:       _b( -18,  8,   -8, 16),
  liberia_ivory_coast:  _b( -10,  4,   -2, 10),
  ghana_togo:           _b(  -2,  4,    4, 10),
  nigeria:              _b(   2,  4,   16, 12),
  cameroon_gabon:       _b(   8, -4,   16,  8),
  congo_eq_guinea:      _b(  12, -8,   20,  4),
  madagascar:           _b(  42,-26,   52,-12),

  // ── South Asia ──
  afghanistan:          _b(  60, 28,   76, 38),
  pakistan:             _b(  60, 22,   76, 30),
  india_north:          _b(  74, 26,   88, 34),
  india_central:        _b(  72, 18,   82, 26),
  india_west:           _b(  68, 14,   76, 22),
  india_south:          _b(  72,  8,   80, 18),
  india_east:           _b(  78, 18,   88, 26),
  nepal_bhutan:         _b(  80, 26,   92, 30),
  bangladesh:           _b(  88, 20,   94, 26),
  sri_lanka:            _b(  80,  6,   82, 10),
  myanmar:              _b(  92, 14,  102, 28),

  // ── East Asia ──
  mongolia:             _b(  88, 40,  120, 50),
  china_xinjiang:       _b(  72, 34,   92, 48),
  china_tibet:          _b(  80, 26,  102, 36),
  china_northeast:      _b( 118, 40,  136, 54),
  china_north:          _b( 104, 36,  124, 44),
  china_east:           _b( 116, 28,  124, 36),
  china_south:          _b( 104, 20,  122, 30),
  china_sichuan:        _b(  96, 26,  110, 34),
  taiwan:               _b( 120, 22,  124, 26),
  korea_north:          _b( 124, 38,  132, 44),
  korea_south:          _b( 126, 34,  130, 40),
  japan_west:           _b( 128, 30,  136, 36),
  japan_central:        _b( 134, 34,  140, 40),
  japan_north:          _b( 138, 40,  148, 46),
  inner_mongolia:       _b( 106, 40,  122, 48),

  // ── Southeast Asia ──
  thailand_laos:        _b(  96,  8,  106, 22),
  cambodia_vietnam:     _b( 102,  8,  110, 20),
  malaysia:             _b( 100,  0,  120,  8),
  philippines:          _b( 116,  6,  128, 22),
  sumatra:              _b(  94, -6,  108,  6),
  java_bali:            _b( 104,-10,  116, -4),
  borneo:               _b( 108, -4,  122,  8),
  indonesia_east:       _b( 120,-10,  142,  2),
  new_guinea:           _b( 130,-10,  142,  0),
  indochina_coast:      _b( 100,  2,  112, 12),

  // ── Oceania ──
  australia_west:       _b( 112,-36,  130,-22),
  australia_north:      _b( 128,-22,  142,-14),
  australia_south:      _b( 128,-38,  154,-22),
  new_zealand:          _b( 164,-48,  178,-34),
  pacific_islands_west: _b( 142,-20,  170, 20),
  pacific_islands_east: _b( 160,-28,  180, 24),

  // ── Polar ──
  arctic:               _b(-180, 68,  180, 90),
  antarctica:           _b(-180,-90,  180,-62),
};

// Match a game region to its GEO_REGIONS entry.
function findGeo(id, name) {
  const norm = s => (s ?? '').toLowerCase()
    .replace(/^reg_/, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  const nid   = norm(id);
  const nname = norm(name);

  if (GEO_REGIONS[nid])   return { key: nid,   geo: GEO_REGIONS[nid] };
  if (GEO_REGIONS[nname]) return { key: nname, geo: GEO_REGIONS[nname] };

  // Substring match (only for longer keys to avoid false positives)
  for (const key of Object.keys(GEO_REGIONS)) {
    if (key.length >= 5 && nid.length >= 5 && (nid === key || nid.includes(key) || key.includes(nid)))
      return { key, geo: GEO_REGIONS[key] };
  }

  // Common aliases
  const ALIAS = {
    usa: 'usa_midwest', america: 'usa_midwest',
    russia: 'russia_northwest', siberia: 'siberia_west',
    china: 'china_north', japan: 'japan_central',
    india: 'india_north', africa: 'nigeria',
    uk: 'england_wales', britain: 'england_wales',
    france: 'france_north', germany: 'germany_north',
    iran: 'iran_north', turkey: 'turkey_west',
    korea: 'korea_south', australia: 'australia_south',
    brazil: 'brazil_central', mexico: 'mexico',
    canada: 'canada_west', argentina: 'argentina',
  };
  for (const [alias, geoKey] of Object.entries(ALIAS)) {
    if (nname.includes(alias) || nid.includes(alias)) {
      const geo = GEO_REGIONS[geoKey];
      if (geo) return { key: geoKey, geo };
    }
  }
  return null;
}

// ── Projection ───────────────────────────────────────────────────────────────

const MAP_PAD = 6;

function project(lon, lat, W, H) {
  return {
    x: MAP_PAD + ((lon + 180) / 360) * (W - MAP_PAD * 2),
    y: MAP_PAD + ((90 - lat) / 180) * (H - MAP_PAD * 2),
  };
}

// ── Point-in-polygon (ray casting) ───────────────────────────────────────────

function pointInPoly(px, py, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const { x: xi, y: yi } = pts[i];
    const { x: xj, y: yj } = pts[j];
    if (((yi > py) !== (yj > py)) &&
        (px < ((xj - xi) * (py - yi)) / (yj - yi) + xi))
      inside = !inside;
  }
  return inside;
}

// ── MapView ──────────────────────────────────────────────────────────────────

export class MapView {
  constructor(canvas, onSelect) {
    this.canvas   = canvas;
    this.ctx      = canvas.getContext('2d');
    this.onSelect = onSelect;

    this._world    = null;
    this._entries  = [];  // { region, pts, cx, cy, key }
    this._allGeo   = [];  // { key, pts }
    this._selected = null;
    this._hovered  = null;

    canvas.addEventListener('click',      e => this._onClick(e));
    canvas.addEventListener('mousemove',  e => this._onHover(e));
    canvas.addEventListener('mouseleave', () => { this._hovered = null; this._draw(); });

    this._ro = new ResizeObserver(() => { if (this._world) this._layout(); });
    this._ro.observe(canvas.parentElement ?? canvas);
  }

  render(world) {
    this._world    = world;
    this._selected = null;
    this._layout();
  }

  deselect() {
    this._selected = null;
    this._draw();
  }

  _layout() {
    const container = this.canvas.parentElement ?? document.body;
    const W = Math.max(container.clientWidth  - 2, 400);
    const H = Math.max(container.clientHeight - 2, 250);
    this.canvas.width  = W;
    this.canvas.height = H;

    this._allGeo = Object.entries(GEO_REGIONS).map(([key, geo]) => ({
      key,
      pts: geo.poly.map(([lon, lat]) => project(lon, lat, W, H)),
    }));

    this._entries = (this._world?.regions ?? []).map(r => {
      const match = findGeo(r.id, r.name);
      if (!match) return null;
      const { key, geo } = match;
      const pts = geo.poly.map(([lon, lat]) => project(lon, lat, W, H));
      const { x: cx, y: cy } = project(geo.cx, geo.cy, W, H);
      return { region: r, pts, cx, cy, key };
    }).filter(Boolean);

    this._draw();
  }

  _draw() {
    const W = this.canvas.width, H = this.canvas.height;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = COL_OCEAN;
    ctx.fillRect(0, 0, W, H);

    if (!this._world) { this._drawEmpty(); return; }

    const factionCol = this._factionColorMap();
    const armies     = this._indexBy(this._world.armies ?? [],  'region_id');
    const heroes     = this._indexBy(this._world.heroes ?? [],  'region_id');
    const byKey = {};
    for (const e of this._entries) byKey[e.key] = e;

    for (const { key, pts } of this._allGeo) {
      const ge    = byKey[key];
      const isSel = ge && this._selected === ge.region.id;
      const isHov = ge && this._hovered  === ge.region.id;

      let fill = COL_LAND_DEF;
      if (ge) {
        const base = factionCol[ge.region.controlling_faction_id] ?? COL_LAND_DEF;
        fill = isHov ? base : this._dim(base, 0.55);
      }

      if (isSel) {
        ctx.shadowColor = factionCol[ge.region.controlling_faction_id] ?? '#7070b0';
        ctx.shadowBlur  = 16;
      }

      ctx.beginPath();
      pts.forEach(({ x, y }, i) => i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y));
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.shadowBlur = 0;

      ctx.strokeStyle = isSel ? COL_BORDER_SEL : isHov ? COL_BORDER_HOV : COL_BORDER;
      ctx.lineWidth   = isSel ? 2 : 0.5;
      ctx.stroke();
    }

    for (const { region, cx, cy } of this._entries) {
      this._drawOverlay(ctx, region, cx, cy,
        this._hovered  === region.id,
        this._selected === region.id,
        armies[region.id] ?? [],
        heroes[region.id] ?? []);
    }
  }

  _drawOverlay(ctx, region, cx, cy, isHov, isSel, armies, heroes) {
    const unrest = region.unrest ?? 0;

    if (unrest > 0) {
      ctx.beginPath();
      ctx.arc(cx, cy - 14, 4, 0, Math.PI * 2);
      ctx.fillStyle = unrestColor(unrest);
      ctx.fill();
    }

    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.font         = `${isSel ? 'bold ' : ''}10px system-ui`;
    ctx.fillStyle    = isHov || isSel ? COL_TEXT : 'rgba(212,212,232,0.8)';
    ctx.fillText(region.name ?? region.id, cx, cy);

    const pop = region.population >= 1000
      ? `${(region.population / 1000).toFixed(1)}B`
      : `${region.population}M`;
    ctx.font      = '8px system-ui';
    ctx.fillStyle = isHov || isSel ? COL_MUTED : 'rgba(104,120,160,0.6)';
    ctx.fillText(pop, cx, cy + 11);

    let bx = cx + 22;
    if (armies.length) { this._badge(ctx, bx, cy - 18, `⚔${armies.length}`, '#e74c3c'); bx += 26; }
    if (heroes.length) { this._badge(ctx, bx, cy - 18, `★${heroes.length}`, '#f39c12'); }
  }

  _badge(ctx, x, y, text, color) {
    ctx.fillStyle = color;
    _roundRect(ctx, x - 10, y - 7, 22, 14, 4);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 8px system-ui';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x + 1, y);
  }

  _dim(hex, factor) {
    if (!hex?.startsWith('#') || hex.length < 7) return COL_LAND_DEF;
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    if (isNaN(r)) return COL_LAND_DEF;
    return `rgb(${Math.round(r * factor)},${Math.round(g * factor)},${Math.round(b * factor)})`;
  }

  _drawEmpty() {
    const W = this.canvas.width  || 480;
    const H = this.canvas.height || 140;
    const ctx = this.ctx;
    ctx.fillStyle = COL_OCEAN;
    ctx.fillRect(0, 0, W, H);
    if (this._allGeo.length > 0) {
      for (const { pts } of this._allGeo) {
        ctx.beginPath();
        pts.forEach(({ x, y }, i) => i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y));
        ctx.closePath();
        ctx.fillStyle   = COL_LAND_DEF;
        ctx.fill();
        ctx.strokeStyle = COL_BORDER;
        ctx.lineWidth   = 0.5;
        ctx.stroke();
      }
    }
    ctx.fillStyle = COL_MUTED;
    ctx.font = '14px system-ui';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('No world data — complete setup or wait for turn 1.', W / 2, H / 2);
  }

  _onClick(e) {
    const { x, y } = this._canvasPos(e);
    const hit = this._hitTest(x, y);
    if (hit) {
      this._selected = hit.region.id;
      this.onSelect(hit.region);
    } else {
      this._selected = null;
      this.onSelect(null);
    }
    this._draw();
  }

  _onHover(e) {
    const { x, y } = this._canvasPos(e);
    const hit = this._hitTest(x, y);
    const id  = hit?.region.id ?? null;
    if (id !== this._hovered) {
      this._hovered = id;
      this.canvas.style.cursor = id ? 'pointer' : 'default';
      this._draw();
    }
  }

  _hitTest(x, y) {
    for (const entry of this._entries) {
      if (pointInPoly(x, y, entry.pts)) return entry;
    }
    return null;
  }

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

  _canvasPos(e) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
}

function _roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}
