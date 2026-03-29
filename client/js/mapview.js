/**
 * mapview.js — Geographic polygon world map (~150 regions).
 *
 * Spec: docs/map.md
 *
 * Key behaviours:
 *  - Orthographic (globe) projection; drag rotates lon0/lat0
 *  - Zoom range: 0.5 … 8 (scales globe radius)
 *  - Input: mouse wheel, trackpad/touch pinch, keyboard +/-, touch drag, tap-to-select
 *  - devicePixelRatio-aware canvas sizing (§4.3)
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
// _b(W, S, E, N) creates a rectangular polygon from a bounding box.

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

  for (const key of Object.keys(GEO_REGIONS)) {
    if (key.length >= 5 && nid.length >= 5 && (nid === key || nid.includes(key) || key.includes(nid)))
      return { key, geo: GEO_REGIONS[key] };
  }

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
//
// Orthographic projection centred at (lon0, lat0).
// Returns {x, y} in screen pixels, or null if the point is on the back hemisphere.

function projectOrtho(lon, lat, lon0, lat0, R, cx, cy) {
  const toRad = Math.PI / 180;
  const φ  = lat  * toRad;
  const φ0 = lat0 * toRad;
  const Δλ = (lon - lon0) * toRad;
  const cosC = Math.sin(φ0) * Math.sin(φ) + Math.cos(φ0) * Math.cos(φ) * Math.cos(Δλ);
  if (cosC <= 0) return null;
  return {
    x: cx + R * Math.cos(φ) * Math.sin(Δλ),
    y: cy - R * (Math.cos(φ0) * Math.sin(φ) - Math.sin(φ0) * Math.cos(φ) * Math.cos(Δλ)),
  };
}

// ── Point-in-polygon (ray casting, lon/lat space) ────────────────────────────

function pointInPolyLonLat(lon, lat, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (((yi > lat) !== (yj > lat)) &&
        (lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi))
      inside = !inside;
  }
  return inside;
}

// ── View-mode colour helpers ──────────────────────────────────────────────────

const VIEWS = {
  political:  { label: 'Political',  legend: null },
  population: { label: 'Population', legend: [['Low','#1a3a5c'],['High','#00d4ff']] },
  unrest:     { label: 'Unrest',     legend: [['Low','#27ae60'],['Mid','#e67e22'],['High','#c0392b']] },
  prosperity: { label: 'Prosperity', legend: [['Low','#c0392b'],['Mid','#e67e22'],['High','#27ae60']] },
};

function lerp(a, b, t) { return a + (b - a) * t; }

function heatColor(value, lo, hi, fromHex, toHex) {
  const t  = Math.max(0, Math.min(1, (value - lo) / (hi - lo)));
  const fr = parseInt(fromHex.slice(1,3),16), fg = parseInt(fromHex.slice(3,5),16), fb = parseInt(fromHex.slice(5,7),16);
  const tr = parseInt(toHex.slice(1,3),16),   tg = parseInt(toHex.slice(3,5),16),   tb = parseInt(toHex.slice(5,7),16);
  return `rgb(${Math.round(lerp(fr,tr,t))},${Math.round(lerp(fg,tg,t))},${Math.round(lerp(fb,tb,t))})`;
}

function threeStopColor(value, lo, mid, hi, colLo, colMid, colHi) {
  if (value <= mid) return heatColor(value, lo, mid, colLo, colMid);
  return heatColor(value, mid, hi, colMid, colHi);
}

// ── Constants ────────────────────────────────────────────────────────────────

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 8;

// ── MapView ──────────────────────────────────────────────────────────────────

export class MapView {
  constructor(canvas, onSelect) {
    this.canvas   = canvas;
    this.ctx      = canvas.getContext('2d');
    this.onSelect = onSelect;

    this._world    = null;
    this._entries  = [];   // { region, key, cLon, cLat }
    this._allGeo   = [];   // { key, poly, cLon, cLat }
    this._selected = null;
    this._hovered  = null;
    this._view     = 'political';

    // Zoom / pan state (in logical/CSS pixels)
    this._zoom  = 1;
    this._panX  = 0;   // unclamped; normalised in _draw / _hitTest
    this._panY  = 0;

    // Drag state
    this._drag  = null;   // { startX, startY, panX0, panY0, moved }
    this._pinch = null;   // { dist0, zoom0, panX0, panY0 }

    // Keyboard zoom
    this._keyHandler = e => this._onKey(e);
    document.addEventListener('keydown', this._keyHandler);

    canvas.addEventListener('click',      e => this._onClick(e));
    canvas.addEventListener('mousemove',  e => this._onMouseMove(e));
    canvas.addEventListener('mousedown',  e => this._onMouseDown(e));
    canvas.addEventListener('mouseup',    () => this._onMouseUp());
    canvas.addEventListener('mouseleave', () => { this._drag = null; this._hovered = null; this._draw(); });
    canvas.addEventListener('wheel',      e => this._onWheel(e), { passive: false });

    canvas.addEventListener('touchstart', e => this._onTouchStart(e), { passive: false });
    canvas.addEventListener('touchmove',  e => this._onTouchMove(e),  { passive: false });
    canvas.addEventListener('touchend',   e => this._onTouchEnd(e),   { passive: false });

    this._ro = new ResizeObserver(() => { if (this._world || this._allGeo.length) this._layout(); });
    this._ro.observe(canvas.parentElement ?? canvas);
  }

  // ── Public API ────────────────────────────────────────────────────────────

  render(world) {
    this._world    = world;
    this._selected = null;
    this._layout();
  }

  deselect() {
    this._selected = null;
    this._draw();
  }

  setView(mode) {
    if (!VIEWS[mode]) return;
    this._view = mode;
    this._draw();
  }

  /** Select a region by game ID and rotate the globe to centre on it. */
  selectById(regionId) {
    const entry = this._entries.find(e => e.region.id === regionId);
    if (!entry) return;
    this._selected = regionId;
    this._panX = entry.cLon;
    this._panY = entry.cLat;
    this._clampPanY();
    this.onSelect(entry.region);
    this._draw();
  }

  // ── Layout ────────────────────────────────────────────────────────────────

  _layout() {
    // Clear explicit styles so flex assigns the canvas its natural allocated size
    this.canvas.style.width  = '';
    this.canvas.style.height = '';
    const W = Math.max(this.canvas.clientWidth,  400);
    const H = Math.max(this.canvas.clientHeight, 250);
    const dpr = window.devicePixelRatio || 1;

    // Physical canvas size
    this.canvas.width  = Math.round(W * dpr);
    this.canvas.height = Math.round(H * dpr);
    this.canvas.style.width  = W + 'px';
    this.canvas.style.height = H + 'px';

    // All draw calls use logical (CSS) pixel coordinates
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Store raw lon/lat — projected per-frame in _draw()
    this._allGeo = Object.entries(GEO_REGIONS).map(([key, geo]) => ({
      key,
      poly: geo.poly,   // [[lon, lat], ...]
      cLon: geo.cx,
      cLat: geo.cy,
    }));

    this._entries = (this._world?.regions ?? []).map(r => {
      if (r.lon != null && r.lat != null) {
        // Use lon/lat from regions.json directly; derive key from id
        const key = r.id.replace(/^reg_/, '');
        return { region: r, key, cLon: r.lon, cLat: r.lat };
      }
      // Fallback: fuzzy-match via GEO_REGIONS
      const match = findGeo(r.id, r.name);
      if (!match) return null;
      const { key, geo } = match;
      return { region: r, key, cLon: geo.cx, cLat: geo.cy };
    }).filter(Boolean);

    // Index for O(1) lookup in _hitTest
    this._byKey = {};
    for (const e of this._entries) this._byKey[e.key] = e;

    this._clampPanY();
    this._draw();
  }

  // ── Coordinate helpers ────────────────────────────────────────────────────

  /** Logical canvas size in CSS pixels. */
  _logSize() {
    return {
      W: this.canvas.width  / (window.devicePixelRatio || 1),
      H: this.canvas.height / (window.devicePixelRatio || 1),
    };
  }

  /** Globe radius in logical pixels at current zoom. */
  _globeR(W, H) { return Math.max(10, Math.min(W, H) / 2 * this._zoom - 4); }

  /** Normalise lon0 to [-180, 180] after long drag sessions. */
  _normalisePanX() {
    this._panX = ((this._panX + 180) % 360 + 360) % 360 - 180;
  }

  /** Clamp lat0 so the poles stay on the globe. */
  _clampPanY() {
    this._panY = Math.max(-85, Math.min(85, this._panY));
  }

  // ── Rendering ─────────────────────────────────────────────────────────────

  _draw() {
    const { W, H } = this._logSize();
    const ctx  = this.ctx;
    const cx   = W / 2, cy = H / 2;
    const R    = this._globeR(W, H);
    const lon0 = this._panX, lat0 = this._panY;

    ctx.clearRect(0, 0, W, H);

    // Ocean sphere
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fillStyle = COL_OCEAN;
    ctx.fill();

    // Clip all land drawing to the globe disc
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.clip();

    if (!this._world) {
      this._drawEmpty(ctx, lon0, lat0, R, cx, cy);
    } else {
      const factionCol = this._factionColorMap();
      const armies     = this._indexBy(this._world.armies ?? [], 'region_id');
      const heroes     = this._indexBy(this._world.heroes ?? [], 'region_id');

      for (const { key, poly, cLon, cLat } of this._allGeo) {
        if (!projectOrtho(cLon, cLat, lon0, lat0, R, cx, cy)) continue; // back hemisphere

        const ge    = this._byKey[key];
        const isSel = ge && this._selected === ge.region.id;
        const isHov = ge && this._hovered  === ge.region.id;
        const fill  = ge ? this._regionFill(ge.region, factionCol, isHov) : COL_LAND_DEF;

        const pts = poly
          .map(([lo, la]) => projectOrtho(lo, la, lon0, lat0, R, cx, cy))
          .filter(Boolean);
        if (pts.length < 3) continue;

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
        ctx.lineWidth   = isSel ? 1.5 : 0.5;
        ctx.stroke();
      }

      // Overlays (labels, badges)
      for (const { region, cLon, cLat } of this._entries) {
        const pt = projectOrtho(cLon, cLat, lon0, lat0, R, cx, cy);
        if (!pt) continue;
        this._drawOverlay(ctx, region, pt.x, pt.y,
          this._hovered  === region.id,
          this._selected === region.id,
          armies[region.id] ?? [],
          heroes[region.id] ?? []);
      }
    }

    ctx.restore();

    // Globe rim
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.strokeStyle = '#243456';
    ctx.lineWidth   = 1;
    ctx.stroke();

    if (!this._world) {
      ctx.fillStyle    = COL_MUTED;
      ctx.font         = '14px system-ui';
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('No world data — complete setup or wait for turn 1.', cx, cy);
    }
  }

  _drawEmpty(ctx, lon0, lat0, R, cx, cy) {
    for (const { poly, cLon, cLat } of this._allGeo) {
      if (!projectOrtho(cLon, cLat, lon0, lat0, R, cx, cy)) continue;
      const pts = poly
        .map(([lo, la]) => projectOrtho(lo, la, lon0, lat0, R, cx, cy))
        .filter(Boolean);
      if (pts.length < 3) continue;
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
    ctx.fillStyle    = '#fff';
    ctx.font         = 'bold 8px system-ui';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x + 1, y);
  }

  _regionFill(region, factionCol, isHov) {
    const dim = c => this._dim(c, isHov ? 1 : 0.55);
    switch (this._view) {
      case 'population': {
        const pop = region.population ?? 0;
        const col = heatColor(Math.log10(Math.max(pop, 1)), 0, Math.log10(1400), '#1a3a5c', '#00d4ff');
        return isHov ? col : this._dim(col, 0.75);
      }
      case 'unrest': {
        const u = region.unrest ?? 0;
        const col = threeStopColor(u, 0, 40, 80, '#27ae60', '#e67e22', '#c0392b');
        return isHov ? col : this._dim(col, 0.75);
      }
      case 'prosperity': {
        const p = region.prosperity ?? 0;
        const col = threeStopColor(p, 0, 50, 100, '#c0392b', '#e67e22', '#27ae60');
        return isHov ? col : this._dim(col, 0.75);
      }
      default: {  // political
        const base = factionCol[region.controlling_faction_id] ?? COL_LAND_DEF;
        return dim(base);
      }
    }
  }

  _dim(hex, factor) {
    if (!hex?.startsWith('#') || hex.length < 7) return COL_LAND_DEF;
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    if (isNaN(r)) return COL_LAND_DEF;
    return `rgb(${Math.round(r * factor)},${Math.round(g * factor)},${Math.round(b * factor)})`;
  }

  // ── Hit test ──────────────────────────────────────────────────────────────
  //
  // Inverse-project screen (sx, sy) to (lon, lat), then test all geo polygons.

  _hitTest(sx, sy) {
    const { W, H } = this._logSize();
    const cx = W / 2, cy = H / 2;
    const R  = this._globeR(W, H);

    // Normalised coordinates relative to globe centre
    const p = (sx - cx) / R;
    const q = -(sy - cy) / R;
    if (p * p + q * q > 1) return null; // outside globe disc

    // Inverse orthographic → lon/lat
    const toDeg = 180 / Math.PI;
    const lat0  = this._panY * (Math.PI / 180);
    const ρ     = Math.sqrt(p * p + q * q);

    let lon, lat;
    if (ρ < 1e-9) {
      lat = this._panY;
      lon = this._panX;
    } else {
      const c = Math.asin(Math.min(ρ, 1));
      lat = Math.asin(Math.cos(c) * Math.sin(lat0) + q * Math.sin(c) * Math.cos(lat0) / ρ) * toDeg;
      lon = this._panX + Math.atan2(
        p * Math.sin(c),
        ρ * Math.cos(c) * Math.cos(lat0) - q * Math.sin(c) * Math.sin(lat0),
      ) * toDeg;
    }
    lon = ((lon + 180) % 360 + 360) % 360 - 180;

    for (const { key, poly } of this._allGeo) {
      if (pointInPolyLonLat(lon, lat, poly)) return this._byKey[key] ?? null;
    }
    return null;
  }

  // ── Mouse input ───────────────────────────────────────────────────────────

  _onClick(e) {
    if (this._drag?.moved) return;
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

  _onMouseDown(e) {
    const { x, y } = this._canvasPos(e);
    this._drag = { startX: x, startY: y, panX0: this._panX, panY0: this._panY, moved: false };
    this.canvas.style.cursor = 'grabbing';
  }

  _onMouseMove(e) {
    const { x, y } = this._canvasPos(e);
    if (this._drag) {
      const dx = x - this._drag.startX;
      const dy = y - this._drag.startY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) this._drag.moved = true;
      const { W, H } = this._logSize();
      const dpp = 180 / (Math.PI * this._globeR(W, H)); // degrees per pixel
      this._panX = this._drag.panX0 - dx * dpp;
      this._panY = this._drag.panY0 - dy * dpp;
      this._clampPanY();
      this._draw();
      return;
    }
    this._onHover(e);
  }

  _onMouseUp() {
    const wasDragging = this._drag?.moved;
    this._drag = null;
    if (!wasDragging) {
      this.canvas.style.cursor = this._hovered ? 'pointer' : 'default';
    } else {
      this.canvas.style.cursor = 'default';
      this._normalisePanX();  // prevent float drift after long drag
    }
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

  _onWheel(e) {
    e.preventDefault();
    this._applyZoom(e.deltaY < 0 ? 1.15 : 1 / 1.15);
  }

  // ── Keyboard input (§5.4) ─────────────────────────────────────────────────

  _onKey(e) {
    // Only respond when no input/textarea is focused
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (e.key === '+' || e.key === '=') this._applyZoom(1.15);
    if (e.key === '-')                   this._applyZoom(1 / 1.15);
  }

  _applyZoom(factor) {
    this._zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this._zoom * factor));
    this._draw();
  }

  // ── Touch input (§12) ─────────────────────────────────────────────────────

  _onTouchStart(e) {
    e.preventDefault();
    if (e.touches.length === 1) {
      const pos = this._touchPos(e.touches[0]);
      this._drag  = { startX: pos.x, startY: pos.y, panX0: this._panX, panY0: this._panY, moved: false };
      this._pinch = null;
    } else if (e.touches.length === 2) {
      this._drag  = null;
      this._pinch = {
        dist0: this._touchDist(e.touches[0], e.touches[1]),
        zoom0: this._zoom,
        panX0: this._panX,
        panY0: this._panY,
        midX:  (this._touchPos(e.touches[0]).x + this._touchPos(e.touches[1]).x) / 2,
        midY:  (this._touchPos(e.touches[0]).y + this._touchPos(e.touches[1]).y) / 2,
      };
    }
  }

  _onTouchMove(e) {
    e.preventDefault();
    if (e.touches.length === 1 && this._drag) {
      const pos = this._touchPos(e.touches[0]);
      const dx  = pos.x - this._drag.startX;
      const dy  = pos.y - this._drag.startY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) this._drag.moved = true;
      const { W, H } = this._logSize();
      const dpp = 180 / (Math.PI * this._globeR(W, H));
      this._panX = this._drag.panX0 - dx * dpp;
      this._panY = this._drag.panY0 - dy * dpp;
      this._clampPanY();
      this._draw();
    } else if (e.touches.length === 2 && this._pinch) {
      const dist = this._touchDist(e.touches[0], e.touches[1]);
      this._zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this._pinch.zoom0 * dist / this._pinch.dist0));
      this._draw();
    }
  }

  _onTouchEnd(e) {
    e.preventDefault();
    if (e.touches.length === 0) {
      // Tap to select
      if (this._drag && !this._drag.moved) {
        const hit = this._hitTest(this._drag.startX, this._drag.startY);
        if (hit) {
          this._selected = hit.region.id;
          this.onSelect(hit.region);
        } else {
          this._selected = null;
          this.onSelect(null);
        }
      }
      if (this._drag?.moved) this._normalisePanX();
      this._drag  = null;
      this._pinch = null;
      this._draw();
    }
  }

  _touchPos(touch) {
    const r = this.canvas.getBoundingClientRect();
    return { x: touch.clientX - r.left, y: touch.clientY - r.top };
  }

  _touchDist(t1, t2) {
    const dx = t1.clientX - t2.clientX;
    const dy = t1.clientY - t2.clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  // ── Utilities ─────────────────────────────────────────────────────────────

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
