# JavaScript World Map Control Specification (X-COM Style)

## 1. Overview

This document defines the specification for an interactive JavaScript-based world map control inspired by X-COM-style geoscapes. The control supports rendering a global map, zooming (scaling), dragging (panning), and selecting regions.

The goal is to provide a reusable, performant, and extensible component suitable for browser-based games and data visualization.

---

## 2. Core Features

* Render a 2D world map (equirectangular projection by default)
* Smooth zoom (scale in/out)
* Drag/pan across the map
* Region selection (hover + click)
* Event-driven API
* High-performance rendering (Canvas or WebGL preferred)

---

## 3. Coordinate System

### 3.1 Geographic Coordinates

* Longitude: `-180 .. +180`
* Latitude: `-90 .. +90`

### 3.2 Screen Coordinates

* Origin: top-left corner
* X axis: left → right
* Y axis: top → bottom

### 3.3 Projection

Default: **Equirectangular projection**

```
x = (lon + 180) / 360 * mapWidth
y = (90 - lat) / 180 * mapHeight
```

---

## 4. Rendering

### 4.1 Layers

1. Base map (image or tile set)
2. Region overlays
3. Interaction layer (hover/selection highlights)
4. UI layer (markers, labels)

### 4.2 Rendering Options

* Canvas 2D (simple)
* WebGL (recommended for large datasets / smooth zoom)

### 4.3 Resolution Handling

* Support `devicePixelRatio` scaling — canvas physical size = CSS size × dpr; ctx is pre-scaled so all draw calls use logical (CSS) pixels
* Use offscreen buffers for performance

---

## 5. Scaling (Zoom)

### 5.1 Scale Model

* Continuous zoom
* Scale factor: `minScale <= scale <= maxScale`

```
minScale = 0.5   // whole world visible plus margins
maxScale = 8.0
```

### 5.2 Zoom Centering

Zoom must be centered on:

* Mouse position (preferred)
* Or viewport center

### 5.3 Zoom Formula

When zooming at point `(mx, my)`:

```
newOffsetX = mx - (mx - offsetX) * (newScale / oldScale)
newOffsetY = my - (my - offsetY) * (newScale / oldScale)
```

### 5.4 Input Methods

* Mouse wheel (`deltaY`)
* Trackpad pinch (two-finger)
* Touch pinch (two-finger)
* Keyboard `+` / `-` (zooms on viewport centre)

### 5.5 Constraints

* Clamp scale to min/max
* Optional zoom smoothing (lerp)

---

## 6. Dragging (Panning)

### 6.1 Interaction

* Click + drag to move map
* Touch: single-finger drag

### 6.2 State

```
isDragging: boolean
startX, startY
initialOffsetX, initialOffsetY
```

### 6.3 Update Logic

```
offsetX = initialOffsetX + (currentX - startX)
offsetY = initialOffsetY + (currentY - startY)
```

### 6.4 Bounds Handling

**Horizontal (longitude):** Infinite wrap — the map tiles seamlessly at the antimeridian (±180°). Dragging past the right edge reveals the left side of the world and vice versa. The internal pan offset accumulates freely; the draw call normalises it into `[0, tileWidth)` before rendering. No horizontal clamp is applied.

**Vertical (latitude):** Hard clamp — the viewport cannot scroll above the North Pole or below the South Pole. At zoom ≥ 1 the map fills the canvas height exactly; at smaller zoom the map is centred and vertical pan is disabled.

`panX` is never directly clamped. It is normalised as:

```
normPanX = ((panX % tileW) + tileW) % tileW   // tileW = canvasW × zoom
```

Rendering draws copies at `normPanX + n × tileW` for `n ∈ {−1, 0, 1, …}` until the canvas is covered.

Deprecated options (not implemented):
* Hard clamp
* Soft clamp / elastic edges

---

## 7. Region Model

### 7.1 Region Definition

Each region is defined as:

```
{
  id: string,
  name: string,
  polygons: [ [ [lon, lat], ... ] ],
  metadata: object
}
```

### 7.2 Geometry

* Polygon or multi-polygon
* Preprocessed into screen-space paths

### 7.3 Spatial Indexing

* Use R-tree or quadtree for hit detection

---

## 8. Region Selection

### 8.1 Hit Detection

Steps:

1. Convert mouse position → world coordinates
2. Convert to geo coordinates
3. Test against region polygons (point-in-polygon)

### 8.2 Interaction States

* `hoveredRegion`
* `selectedRegion`

### 8.3 Events

* `onRegionHover(regionId)`
* `onRegionLeave(regionId)`
* `onRegionClick(regionId)`

### 8.4 Visual Feedback

* Hover: highlight outline or fill
* Selected: persistent highlight

---

## 9. Event System

### 9.1 Supported Events

* `zoom`
* `pan`
* `region:hover`
* `region:click`
* `region:select`

### 9.2 API Example

```
map.on('region:click', (region) => {
  console.log(region.id)
})
```

---

## 10. Performance Considerations

* Debounce wheel events
* Use requestAnimationFrame for rendering
* Cache transformed geometries
* Avoid full redraws when possible

---

## 11. API Design

### 11.1 Initialization

```
const map = new WorldMap({
  container: HTMLElement,
  minScale: 0.5,
  maxScale: 8,
  enableWrapping: true
})
```

### 11.2 Methods

```
map.setScale(scale)
map.panTo(x, y)
map.selectRegion(id)
map.loadRegions(data)
```

### 11.3 Getters

```
map.getScale()
map.getOffset()
map.getSelectedRegion()
```

---

## 12. Mobile Support

* Pinch-to-zoom
* Touch drag
* Tap selection

---

## 13. Optional Enhancements

* Day/night terminator shading
* Animated radar sweep (X-COM style)
* Markers (UFOs, bases)
* Time acceleration controls

---

## 14. Extensibility

* Plugin system for overlays
* Custom projections
* Custom renderers

---

## 15. Summary

This control provides a flexible foundation for an interactive world map with smooth zooming, intuitive dragging, and efficient region selection, suitab
