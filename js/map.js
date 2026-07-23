// ============================================================================
// WebGL Satellite Map Engine & Interactive Game Overlay Layer
// Replaces Leaflet with WebGLTileMap (standalone continuous GPU satellite rendering,
// smooth zoom-to-cursor, inertial panning, prefetching) + high-performance
// 2D Overlay canvas pass for all game vector layers and interactive controls.
// ============================================================================

let mapEngine = null;      // WebGLTileMap instance
let overlayCanvas = null;  // <canvas id="overlaycanvas">
let overlayCtx = null;     // 2D context for overlays

let unitMarkers = {};   // unit.id -> state
let pendingLine = null;
let pendingDots = [];

let municipalityPolygons = {}; // municipality.id -> geometry
let selectedMunicipalityId = null;

let isDrawingPath = false;
let dragPointCount = 0;
let lastDrawLatLng = null;

// Road/rail/zone/dam building tool state
let buildMode = null; // null | 'road' | 'rail' | 'zone' | 'dam'
let buildSubtype = null; // key into ROAD_TYPES / RAIL_TYPES
let zoneDraw = null;   // { kind, cityId, municipalityId } while drawing a zone
let damDraw = null;    // { cityId, municipalityId } while drawing a hydro dam (point A → point B)
let buildDrawPoints = [];

// Building placement state
let placementMode = null; // { type, cityId, municipalityId, municipality }
let cursorScreenPos = null;

// Layer toggles state
// Which map layers are painted. Essentials (the player's own country and its
// units) default on; everything optional defaults off so a fresh game starts
// readable and cheap, and the player opts into the extras from the dock.
// One entry per category — Slovenia and the wider continent share each layer
// rather than being split into "local" and "world" versions.
const layerState = {
  roads: true,          // major + local roads, everywhere
  rail: true,
  borders: true,        // country outlines + Slovenia's own border
  municipalities: true,
  labels: true,
  units: true,
  rivers: false,
  urban: false,
  poi: false,           // airports / ports
  militaryBases: false,
  supplyRange: false,
  resources: false,
  relief: false,
};

function cityById(id) { return CITIES.find(c => c.id === id); }

// ---- Main Map Initialization ----
function initMap() {
  const glCanvas = document.getElementById("mapcanvas");
  overlayCanvas = document.getElementById("overlaycanvas");
  if (overlayCanvas) overlayCtx = overlayCanvas.getContext("2d");

  mapEngine = new WebGLTileMap(glCanvas, {
    center: [46.15, 14.85],
    zoom: 9,
    minZoom: 3,
    maxNativeZoom: 19,
    maxZoom: 21,
    controls: true,
    tileUrl: "tiles/imagery/{z}/{y}/{x}",
    onOverlay: drawMapOverlays,
    // Left-drag belongs to the map only when no tool wants it. With a unit
    // selected a drag draws that unit's route; while building, it draws the
    // line. Right- or middle-drag always pans, so the camera is never stuck.
    canPan: () => !buildMode && !placementMode && !state.selectedUnitId,
  });

  // Layer toggle checkboxes
  bindLayerToggle("toggleRoads", "roads");
  bindLayerToggle("toggleRail", "rail");
  bindLayerToggle("toggleBorders", "borders");
  bindLayerToggle("toggleMunicipalities", "municipalities");
  bindLayerToggle("toggleLabels", "labels");
  bindLayerToggle("toggleUnits", "units");
  bindLayerToggle("toggleRivers", "rivers");
  bindLayerToggle("toggleUrban", "urban");
  bindLayerToggle("togglePOI", "poi");
  bindLayerToggle("toggleMilitaryBases", "militaryBases");
  bindLayerToggle("toggleSupplyRange", "supplyRange");
  bindLayerToggle("toggleResources", "resources");
  bindLayerToggle("toggleRelief", "relief");

  // Interaction handlers on map canvas
  let mouseDownPos = null;
  glCanvas.addEventListener("mousedown", (e) => {
    mouseDownPos = { x: e.clientX, y: e.clientY, time: Date.now() };
    onMapMouseDown(screenEventToLatLng(e), e);
  });

  glCanvas.addEventListener("mousemove", (e) => {
    const rect = glCanvas.getBoundingClientRect();
    cursorScreenPos = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    onMapMouseMove(screenEventToLatLng(e), e);
    // No _scheduleRender() here: the engine runs its own continuous rAF loop, so
    // requesting a render per mousemove just ran the whole overlay pass twice a
    // frame while the pointer was moving — i.e. exactly during pan.
  });

  glCanvas.addEventListener("mouseup", (e) => {
    onMapMouseUp(screenEventToLatLng(e), e);
    if (mouseDownPos) {
      const dx = e.clientX - mouseDownPos.x;
      const dy = e.clientY - mouseDownPos.y;
      const dt = Date.now() - mouseDownPos.time;
      if (Math.hypot(dx, dy) < 6 && dt < 400) {
        onMapClick(screenEventToLatLng(e), e);
      }
    }
    mouseDownPos = null;
  });

  window.addEventListener("keydown", onMapKeydown);

  // Pre-load data structures for fast overlay rendering
  prepareMunicipalitiesData();
}

function bindLayerToggle(id, key) {
  const el = document.getElementById(id);
  if (!el) return;
  el.checked = !!layerState[key];
  el.addEventListener("change", () => {
    layerState[key] = el.checked;
    if (mapEngine) mapEngine._scheduleRender();
  });
}

function screenEventToLatLng(e) {
  const rect = mapEngine.canvas.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const sx = (e.clientX - rect.left) * dpr;
  const sy = (e.clientY - rect.top) * dpr;
  const worldPt = mapEngine.screenToWorld(sx, sy);
  const ll = mapEngine.worldToLonLat(worldPt[0], worldPt[1]);
  return { latlng: { lat: ll[1], lng: ll[0] }, originalEvent: e, x: sx, y: sy };
}

function latLngToScreen(lat, lon) {
  const wp = mapEngine.lonLatToWorld(lon, lat);
  const sp = mapEngine.worldToScreen(wp[0], wp[1]);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  return [sp[0] / dpr, sp[1] / dpr];
}

function prepareMunicipalitiesData() {
  MUNICIPALITIES.forEach(m => {
    municipalityPolygons[m.id] = m;
  });
}

// ----------------------------------------------------------------------------
// Overlays Pass: Draws vectors, roads, borders, cities, units & UI tools
// ----------------------------------------------------------------------------
function drawMapOverlays(gl, engine) {
  if (!overlayCanvas || !overlayCtx) return;

  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.round(engine.canvas.clientWidth * dpr);
  const h = Math.round(engine.canvas.clientHeight * dpr);
  if (!w || !h) return;

  if (overlayCanvas.width !== w || overlayCanvas.height !== h) {
    overlayCanvas.width = w;
    overlayCanvas.height = h;
  }

  const ctx = overlayCtx;
  ctx.save();
  ctx.scale(dpr, dpr);
  const vw = engine.canvas.clientWidth;
  const vh = engine.canvas.clientHeight;
  ctx.clearRect(0, 0, vw, vh);

  const zoom = engine.zoom;
  // Refresh the world->screen affine + viewport rect that every vector draw below
  // reads. Must happen before the first drawPolyline/drawPolygonRing call.
  updateViewTransform(engine, vw, vh);

  // The geography (borders, municipalities, water, roads, rail) doesn't change
  // from frame to frame, so it's rendered into an offscreen canvas and blitted.
  // Zoomed out nothing culls and redrawing it live cost ~18ms every frame for a
  // picture identical to the last one; the blit is a fraction of that.
  drawStaticLayerCache(engine, ctx, vw, vh, dpr, zoom);

  drawDynamicOverlays(ctx, engine, vw, vh, zoom);

  ctx.restore();

  // Keep any open map popup glued to its lat/lon as the camera moves.
  if (mapPopupAnchor) positionMapPopup();
}

// ---- Static geography cache ----------------------------------------------
// Baked into an offscreen canvas 1.4x the viewport, so panning within that
// margin is a single drawImage. Rebuilt only when it can no longer serve the
// view: the camera left the margin, the zoom settled somewhere new, a layer was
// toggled, or the player's road/rail network grew.
//
// During an active zoom the cached bitmap is scale-blitted (briefly soft, the
// way a slippy map's tiles are mid-zoom) and re-baked crisply once the eased
// zoom settles — re-baking every frame of the animation would defeat the point.
const _staticCache = {
  canvas: null, ctx: null, valid: false,
  zoom: NaN, k: 0, cx: 0, cy: 0, w: 0, h: 0, dpr: 0, sig: "",
};
const STATIC_CACHE_MARGIN = 1.4;

function staticCacheSignature(zoom) {
  const len = a => (a && a.length) || 0;
  return [
    layerState.municipalities, layerState.roads, layerState.rail,
    layerState.borders, layerState.rivers, layerState.urban,
    len(typeof WORLD_ROADS !== "undefined" ? WORLD_ROADS : null),
    len(typeof WORLD_RAIL !== "undefined" ? WORLD_RAIL : null),
    len(typeof WORLD_RIVERS !== "undefined" ? WORLD_RIVERS : null),
    len(typeof WORLD_URBAN !== "undefined" ? WORLD_URBAN : null),
    zoom >= 7, zoom >= 11,
    len(typeof WORLD_COUNTRIES !== "undefined" ? WORLD_COUNTRIES : null),
    len(typeof ROAD_EDGES_REAL !== "undefined" ? ROAD_EDGES_REAL : null),
    len(typeof LOCAL_ROAD_EDGES_REAL !== "undefined" ? LOCAL_ROAD_EDGES_REAL : null),
    len(typeof RAIL_LINES !== "undefined" ? RAIL_LINES : null),
    len(typeof WATER_LINES !== "undefined" ? WATER_LINES : null),
    len(typeof BORDER_RING !== "undefined" ? BORDER_RING : null), layerState.relief, (typeof ELEVATION !== "undefined" && ELEVATION) ? 1 : 0,
    // Layers fade with zoom, so the baked bitmap is only valid for the zoom it
    // was baked at. Quantising to 0.25 of a level keeps the fade visually smooth
    // without re-baking on every fractional step of an eased zoom.
    Math.round(zoom * 4),
  ].join("|");
}

// Invalidate from elsewhere when static content changes outside the signature's
// reach (e.g. a road finishes building and mutates an existing edge list).
function invalidateStaticMapCache() { _staticCache.valid = false; }

function bakeStaticCache(engine, vw, vh, dpr, zoom) {
  const c = _staticCache.canvas || (_staticCache.canvas = document.createElement("canvas"));
  if (!_staticCache.ctx) _staticCache.ctx = c.getContext("2d");
  const cw = Math.ceil(vw * STATIC_CACHE_MARGIN), ch = Math.ceil(vh * STATIC_CACHE_MARGIN);
  const pw = Math.round(cw * dpr), ph = Math.round(ch * dpr);
  if (c.width !== pw || c.height !== ph) { c.width = pw; c.height = ph; }

  const cctx = _staticCache.ctx;
  const k = engine.scale / dpr;
  cctx.setTransform(1, 0, 0, 1, 0, 0);
  cctx.clearRect(0, 0, pw, ph);
  cctx.save();
  cctx.scale(dpr, dpr);
  setViewTransform(k, engine.cx, engine.cy, cw / 2, ch / 2, cw, ch, zoom);
  drawStaticLayers(cctx, zoom);
  cctx.restore();

  _staticCache.zoom = zoom; _staticCache.k = k;
  _staticCache.cx = engine.cx; _staticCache.cy = engine.cy;
  _staticCache.w = cw; _staticCache.h = ch; _staticCache.dpr = dpr;
  _staticCache.sig = staticCacheSignature(zoom);
  _staticCache.valid = true;
}

function drawStaticLayerCache(engine, ctx, vw, vh, dpr, zoom) {
  const sc = _staticCache;
  const liveK = engine.scale / dpr;
  const zoomSettled = Math.abs(engine.zoom - engine.tZoom) < 0.01;

  // Where the cached bitmap lands on screen under the CURRENT camera.
  const place = () => {
    const s = liveK / sc.k;
    const dw = sc.w * s, dh = sc.h * s;
    const dx = _vox + sc.cx * liveK - dw / 2;
    const dy = _voy + sc.cy * liveK - dh / 2;
    return { dx, dy, dw, dh, s };
  };

  let need = !sc.valid || !sc.canvas ||
    sc.dpr !== dpr || sc.w !== Math.ceil(vw * STATIC_CACHE_MARGIN) ||
    sc.sig !== staticCacheSignature(zoom);

  if (!need) {
    const p = place();
    // Re-bake if the margin no longer covers the viewport, if the blit would be
    // stretched far enough to look soft, or once an eased zoom has settled.
    if (p.dx > 0 || p.dy > 0 || p.dx + p.dw < vw || p.dy + p.dh < vh) need = true;
    // Mid-zoom the bitmap is allowed to stretch a lot before re-baking: a single
    // wheel notch is 0.5 zoom levels = 1.41x, so a tight limit here would fire a
    // ~22ms bake in the middle of the eased animation — precisely where a hitch
    // is most visible. Stay soft while it moves, re-bake sharp when it stops.
    else if (zoomSettled ? (p.s < 0.95 || p.s > 1.05) : (p.s < 0.45 || p.s > 2.2)) need = true;
  }

  if (need) {
    bakeStaticCache(engine, vw, vh, dpr, zoom);
    // Restore the live transform: the dynamic layers below draw in screen space.
    updateViewTransform(engine, vw, vh);
  }

  const p = place();
  ctx.drawImage(sc.canvas, p.dx, p.dy, p.dw, p.dh);
}

// Everything below is static geography: same pixels until the camera, a layer
// toggle, or the road/rail network itself changes. Drawn via the cache above.
// Linear fade between two zoom levels. Returns 0 below `start`, 1 above `full`.
// Layers use this both to look right (detail arrives as you close in, instead of
// snapping on) and to stay fast: at 0 the layer is skipped entirely, and the
// OSM road network is a million vertices that must not be touched when the whole
// country is on screen.
function zoomFade(zoom, start, full) {
  if (zoom <= start) return 0;
  if (zoom >= full) return 1;
  return (zoom - start) / (full - start);
}

// Relief shading from the elevation grid. Cells are coloured by terrain class —
// the same classes that slow ground units down — so the layer isn't decoration,
// it's a readout of where your troops will bog down.
const RELIEF_COLORS = {
  flat:      "rgba(90, 140, 90, 0.00)",  // no tint: flat ground is the baseline
  rolling:   "rgba(190, 175, 110, 0.22)",
  hills:     "rgba(190, 130, 70, 0.34)",
  mountains: "rgba(180, 90, 70, 0.46)",
};

function drawReliefLayer(ctx, zoom) {
  const g = typeof ELEVATION !== "undefined" ? ELEVATION : null;
  if (!g) return;
  // Work out which grid cells are on screen instead of walking all 15k.
  const tl = mapEngine.worldToLonLat(_vx0, _vy0);
  const br = mapEngine.worldToLonLat(_vx1, _vy1);
  const latMin = Math.min(tl[1], br[1]), latMax = Math.max(tl[1], br[1]);
  const lonMin = Math.min(tl[0], br[0]), lonMax = Math.max(tl[0], br[0]);
  const r0 = Math.max(1, Math.floor((latMin - g.minLat) / g.dLat));
  const r1 = Math.min(g.rows - 2, Math.ceil((latMax - g.minLat) / g.dLat));
  const c0 = Math.max(1, Math.floor((lonMin - g.minLon) / g.dLon));
  const c1 = Math.min(g.cols - 2, Math.ceil((lonMax - g.minLon) / g.dLon));
  if (r1 < r0 || c1 < c0) return;

  // One fill per class rather than per cell — same batching logic as the vector
  // layers, for the same reason.
  const buckets = { rolling: [], hills: [], mountains: [] };
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const lat = g.minLat + r * g.dLat, lon = g.minLon + c * g.dLon;
      const cls = terrainClass(lat, lon);
      if (cls === "flat") continue;
      buckets[cls].push(lat, lon);
    }
  }
  for (const cls of ["rolling", "hills", "mountains"]) {
    const pts = buckets[cls];
    if (!pts.length) continue;
    ctx.fillStyle = RELIEF_COLORS[cls];
    ctx.beginPath();
    for (let i = 0; i < pts.length; i += 2) {
      const a = latLngToScreen(pts[i] - g.dLat / 2, pts[i + 1] - g.dLon / 2);
      const b = latLngToScreen(pts[i] + g.dLat / 2, pts[i + 1] + g.dLon / 2);
      ctx.rect(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(b[0] - a[0]) + 0.5, Math.abs(b[1] - a[1]) + 0.5);
    }
    ctx.fill();
  }
}

function drawStaticLayers(ctx, zoom) {
  // 0. Relief underneath everything — it's ground, not an annotation.
  if (layerState.relief) drawReliefLayer(ctx, zoom);

  // Layers are drawn as ONE category each — the player's country and the rest of
  // the continent share a layer and a toggle, so there's no visible seam between
  // "Slovenia's roads" and "everyone else's roads". Slovenia's data is finer, so
  // it simply carries more detail where it exists.

  // 1. Urban areas — the ground everything else sits on.
  if (layerState.urban && typeof WORLD_URBAN !== "undefined" && WORLD_URBAN.length && zoom >= 10.5) {
    ctx.fillStyle = "rgba(196, 188, 170, 0.30)";
    ctx.strokeStyle = "rgba(214, 206, 188, 0.55)";
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    for (const ring of WORLD_URBAN) {
      if (!ring || ring.length < 3) continue;
      const p = projectPoints(ring);
      if (_culled(p)) continue;
      ensureLod(p);
      _tracePath(ctx, p);
      ctx.closePath();
    }
    ctx.fill();
    ctx.stroke();
  }

  // 2. Country borders — OUTLINE ONLY, no fill, and bright enough to actually
  // read as a border rather than a smudge.
  if (layerState.borders && typeof WORLD_COUNTRIES !== "undefined" && WORLD_COUNTRIES) {
    ctx.strokeStyle = "#93a7b4";
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    WORLD_COUNTRIES.forEach(f => {
      const props = f.properties || {};
      const nm = props.ADMIN || props.NAME || props.name || props.SOVEREIGNT;
      if (nm === "Slovenia") return; // drawn below, in its own colour
      // Cache the converted rings on the feature: geojsonToLatLngRings allocates
      // fresh arrays, so calling it per frame both churned GC and defeated the
      // projection cache (new array identity = guaranteed miss, every frame).
      const rings = f._rings || (f._rings = geojsonToLatLngRings(f.geometry));
      for (const ring of rings) {
        if (ring.length < 3) continue;
        const p = projectPoints(ring);
        if (_culled(p)) continue;
        ensureLod(p);
        _tracePath(ctx, p);
        ctx.closePath();
      }
    });
    ctx.stroke();
  }

  // 3. Slovenia's own border — the brightest line on the map.
  if (layerState.borders && BORDER_RING && BORDER_RING.length) {
    ctx.strokeStyle = "#ffe08a";
    ctx.lineWidth = 2.6;
    ctx.shadowColor = "rgba(0,0,0,0.6)";
    ctx.shadowBlur = 5;
    drawPolyline(ctx, BORDER_RING, true);
    ctx.shadowBlur = 0;
  }

  // 4. Municipalities
  if (layerState.municipalities) {
    ctx.strokeStyle = "rgba(127, 176, 224, 0.35)";
    ctx.lineWidth = 1.0;
    ctx.beginPath();
    MUNICIPALITIES.forEach(m => {
      for (const ring of m.rings) {
        if (ring.length < 2) continue;
        const p = projectPoints(ring);
        if (_culled(p)) continue;
        ensureLod(p);
        _tracePath(ctx, p);
        ctx.closePath();
      }
    });
    ctx.stroke();
  }

  // 5. Rivers & lakes — fade in from z8. Below that the whole network is on
  // screen at once and it is both illegible and expensive.
  const riverFade = zoomFade(zoom, 10, 13);
  if (layerState.rivers && riverFade > 0) {
    ctx.strokeStyle = "#4a90d0";
    ctx.lineWidth = 1.0 + riverFade * 1.4;
    ctx.globalAlpha = 0.18 + riverFade * 0.42;
    if (typeof WORLD_RIVERS !== "undefined" && WORLD_RIVERS.length) drawPolylineBatch(ctx, WORLD_RIVERS, null, false);
    if (WATER_LINES && WATER_LINES.length) drawPolylineBatch(ctx, WATER_LINES, null, false);
    ctx.globalAlpha = 1.0;
  }

  // 6. Railways — same treatment.
  const railFade = zoomFade(zoom, 10, 13);
  if (layerState.rail && railFade > 0) {
    ctx.strokeStyle = "#c9c9d8";
    ctx.lineWidth = 1.0 + railFade * 1.0;
    ctx.globalAlpha = 0.20 + railFade * 0.55;
    ctx.setLineDash([2, 5]);
    if (typeof WORLD_RAIL !== "undefined" && WORLD_RAIL.length) drawPolylineBatch(ctx, WORLD_RAIL, null, false);
    if (RAIL_LINES && RAIL_LINES.length) drawPolylineBatch(ctx, RAIL_LINES, null, false);
    ctx.setLineDash([]);
    ctx.globalAlpha = 1.0;
  }

  // 7. Roads. The OSM network is ~1M vertices, so this is the layer that decides
  // whether the map feels fast: major roads fade in from z7, and the local street
  // network — the heaviest data in the game — only from z12.
  const roadFade = zoomFade(zoom, 10.5, 13);
  if (layerState.roads && roadFade > 0) {
    ctx.strokeStyle = "#ffd35c";
    ctx.lineWidth = 1.0 + roadFade * 2.0;
    ctx.globalAlpha = 0.22 + roadFade * 0.63;
    if (typeof WORLD_ROADS !== "undefined" && WORLD_ROADS.length) drawPolylineBatch(ctx, WORLD_ROADS, null, false);
    if (ROAD_EDGES_REAL && ROAD_EDGES_REAL.length) drawPolylineBatch(ctx, ROAD_EDGES_REAL, e => e.points, false);
    ctx.globalAlpha = 1.0;

    const localFade = zoomFade(zoom, 12, 14);
    if (localFade > 0 && LOCAL_ROAD_EDGES_REAL && LOCAL_ROAD_EDGES_REAL.length) {
      ctx.strokeStyle = "#e0a860";
      ctx.lineWidth = 1.0 + localFade * 1.0;
      ctx.globalAlpha = 0.25 + localFade * 0.45;
      drawPolylineBatch(ctx, LOCAL_ROAD_EDGES_REAL, e => e.points, false);
      ctx.globalAlpha = 1.0;
    }
  }
}

// Everything that can change between two frames: selection, player-built things,
// units, previews. Always drawn live, on top of the cached geography.
//
// NOTE: zone fills used to sit underneath water/roads/rail in the draw order.
// They're dynamic (their extent grows with build-out) so they now paint on top
// of the cached geography instead. At ~13% fill alpha the roads still read
// through; it was the one z-order change the cache split forced.
function drawDynamicOverlays(ctx, engine, vw, vh, zoom) {
  // Supply range: the 8 km envelope around every barracks/base/FOB inside which
  // ground units resupply. Drawn first so it sits under everything else.
  if (layerState.supplyRange) {
    ctx.strokeStyle = "rgba(255, 211, 92, 0.45)";
    ctx.fillStyle = "rgba(255, 211, 92, 0.07)";
    ctx.lineWidth = 1.2;
    ctx.setLineDash([5, 5]);
    const radiusKm = typeof SUPPLY_SOURCE_RADIUS_KM !== "undefined" ? SUPPLY_SOURCE_RADIUS_KM : 8;
    MILITARY_BASES.forEach(b => {
      if (b.lat != null) drawCircleMeters(ctx, b.lat, b.lon, radiusKm * 1000);
    });
    state.completedBuildings.forEach(b => {
      if ((b.type === "military_base" || b.type === "fob") && b.lat != null) {
        drawCircleMeters(ctx, b.lat, b.lon, radiusKm * 1000);
      }
    });
    ctx.setLineDash([]);
  }

  // Military bases: the real barracks list plus anything the player has built.
  if (layerState.militaryBases) {
    MILITARY_BASES.forEach(b => {
      if (b.lat == null) return;
      const pt = latLngToScreen(b.lat, b.lon);
      drawCircleMarker(ctx, pt[0], pt[1], 7, "#7fe0c9", "★");
      if (zoom >= 11) drawLabelTag(ctx, pt[0], pt[1], b.name, "#7fe0c9");
    });
    state.completedBuildings.forEach(b => {
      if ((b.type !== "military_base" && b.type !== "fob") || b.lat == null) return;
      const pt = latLngToScreen(b.lat, b.lon);
      drawCircleMarker(ctx, pt[0], pt[1], 7, "#e0c97f", b.type === "fob" ? "▲" : "★");
      if (zoom >= 11) drawLabelTag(ctx, pt[0], pt[1], BUILDING_TYPES[b.type].label, "#e0c97f");
    });
  }

  // Selected Municipality Highlight
  if (selectedMunicipalityId && municipalityPolygons[selectedMunicipalityId]) {
    const selM = municipalityPolygons[selectedMunicipalityId];
    ctx.fillStyle = "rgba(127, 176, 224, 0.18)";
    ctx.strokeStyle = "#7fb0e0";
    ctx.lineWidth = 2.0;
    selM.rings.forEach(ring => drawPolygonRing(ctx, ring, true));
  }

  // 4. Economic / Industrial / Residential Zones
  if (state.zones && state.zones.length) {
    state.zones.forEach(z => {
      const zt = ZONE_TYPES[z.kind] || {};
      ctx.strokeStyle = zt.color || "#7fb0e0";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      drawPolygonRing(ctx, z.points, false);
      ctx.setLineDash([]);
      ctx.fillStyle = (zt.color || "#7fb0e0") + "22";
      drawPolygonRing(ctx, devScaledPoints(z), true);
    });
  }

  // 9. Player Infrastructure Projects in Progress
  if (state.infraProjects && state.infraProjects.length) {
    state.infraProjects.forEach(p => {
      const prog = Math.min(1, Math.max(0, 1 - p.daysLeft / p.totalDays));
      const color = p.color || (p.kind === "road" ? "#ffd35c" : "#c9c9d8");
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.45;
      ctx.setLineDash([3, 6]);
      drawPolyline(ctx, p.points, false);
      ctx.setLineDash([]);
      const builtCount = Math.max(2, Math.floor(p.points.length * prog));
      ctx.lineWidth = 3.5;
      ctx.globalAlpha = 0.95;
      drawPolyline(ctx, p.points.slice(0, builtCount), false);
      ctx.globalAlpha = 1.0;
    });
  }

  // 10. Air Defense Circles (Radar stations & SAM units)
  if (layerState.units) {
    ctx.strokeStyle = "rgba(127, 201, 224, 0.5)";
    ctx.fillStyle = "rgba(127, 201, 224, 0.05)";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 6]);
    state.completedBuildings.forEach(b => {
      if (b.type === "radar_station" && b.lat != null) {
        drawCircleMeters(ctx, b.lat, b.lon, 45000);
      }
    });
    ctx.strokeStyle = "rgba(224, 168, 96, 0.5)";
    ctx.fillStyle = "rgba(224, 168, 96, 0.05)";
    state.units.forEach(u => {
      if (u.type === "aa" && u.trainingDaysLeft <= 0) {
        drawCircleMeters(ctx, u.lat, u.lon, (UNIT_TYPES.aa.range || 30) * 1000);
      }
    });
    ctx.setLineDash([]);
  }

  // 11. Resource Deposits
  if (layerState.resources && RESOURCE_DEPOSITS) {
    RESOURCE_DEPOSITS.forEach(dep => {
      const meta = RESOURCE_META[dep.resourceId] || {};
      const pt = latLngToScreen(dep.lat, dep.lon);
      ctx.strokeStyle = meta.color || "#e0c97f";
      ctx.fillStyle = (meta.color || "#e0c97f") + "15";
      ctx.lineWidth = 1;
      drawCircleMeters(ctx, dep.lat, dep.lon, DEPOSIT_RANGE_KM * 1000);
      // meta.glyph, NOT meta.icon — the latter is SVG markup and canvas text
      // would draw it literally.
      drawIconTag(ctx, pt[0], pt[1], meta.glyph || "⛏", dep.name, meta.color || "#e0c97f");
    });

    // Real extraction sites from OSM, drawn as their true mapped outlines rather
    // than a ring around a guessed centre. Only worth showing once zoomed in —
    // a quarry is a few hundred metres across.
    if (typeof RESOURCE_SITES !== "undefined" && RESOURCE_SITES.length && zoom >= 11) {
      const named = zoom >= 13;
      RESOURCE_SITES.forEach(s => {
        const meta = RESOURCE_META[s.resource] || {};
        const color = meta.color || "#e0c97f";
        if (s.ring) {
          ctx.strokeStyle = color;
          ctx.fillStyle = color + "33";
          ctx.lineWidth = 1.4;
          drawPolygonRing(ctx, s.ring, true);
        } else {
          const p = latLngToScreen(s.lat, s.lon);
          ctx.strokeStyle = color;
          ctx.fillStyle = color + "33";
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.arc(p[0], p[1], 5, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
        if (named && s.name) {
          const p = latLngToScreen(s.lat, s.lon);
          drawIconTag(ctx, p[0], p[1] - 12, s.kind === "quarry" ? "⛏" : "⚒", s.name, color);
        }
      });
    }
  }

  // 13. Completed Player Buildings & Construction Sites
  if (state.completedBuildings) {
    state.completedBuildings.forEach(b => {
      const def = BUILDING_TYPES[b.type] || {};
      if (b.isDam) {
        ctx.strokeStyle = "#4a4f55";
        ctx.lineWidth = 6;
        drawPolyline(ctx, b.damPoints, false);
      } else if (b.lat != null && b.lon != null) {
        const bounds = buildingBounds(b.lat, b.lon, def, b.munScale || 1);
        ctx.strokeStyle = sectorColor(def);
        ctx.fillStyle = "rgba(10, 15, 20, 0.7)";
        ctx.lineWidth = 1.5;
        drawBoundsRect(ctx, bounds);
        const pt = latLngToScreen(b.lat, b.lon);
        drawLabelTag(ctx, pt[0], pt[1], def.label || b.type, sectorColor(def));
      }
    });
  }
  if (state.constructions) {
    state.constructions.forEach(p => {
      const def = BUILDING_TYPES[p.type] || {};
      if (p.isDam) {
        ctx.strokeStyle = "#4a4f55";
        ctx.lineWidth = 5;
        ctx.setLineDash([6, 8]);
        drawPolyline(ctx, p.damPoints, false);
        ctx.setLineDash([]);
      } else if (p.lat != null && p.lon != null) {
        const bounds = buildingBounds(p.lat, p.lon, def, municipalityScale(p.cityId, p.municipalityId));
        ctx.strokeStyle = sectorColor(def);
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]);
        drawBoundsRect(ctx, bounds);
        ctx.setLineDash([]);
        const pt = latLngToScreen(p.lat, p.lon);
        drawLabelTag(ctx, pt[0], pt[1], `${def.label || p.type} (${Math.ceil(p.daysLeft)}d)`, "#e0c97f");
      }
    });
  }

  // 14. Airports & Ports
  if (layerState.poi) {
    if (AIRPORTS) {
      AIRPORTS.forEach(a => {
        const pt = latLngToScreen(a.lat, a.lon);
        drawCircleMarker(ctx, pt[0], pt[1], 8, a.military ? "#e0917f" : "#7fb0e0", "✈");
      });
    }
    if (PORTS) {
      PORTS.forEach(p => {
        const pt = latLngToScreen(p.lat, p.lon);
        drawCircleMarker(ctx, pt[0], pt[1], 8, "#e0a860", "⚓");
      });
    }
  }

  // 15. Cities & Name Labels
  if (layerState.labels && CITIES) {
    CITIES.forEach(c => {
      const minZ = labelMinZoom(c.pop);
      if (zoom >= minZ) {
        const pt = latLngToScreen(c.lat, c.lon);
        drawCityLabel(ctx, pt[0], pt[1], c.name, c.capital);
      }
    });
  }

  // 16. Units (Friendly & Enemy)
  if (layerState.units) {
    // Unit Movement Paths
    state.units.forEach(u => {
      if (u.moving && u.path && u.path.length) {
        const sel = u.id === state.selectedUnitId;
        ctx.strokeStyle = sel ? "#ffe08a" : "#7fe0c9";
        ctx.lineWidth = sel ? 2.5 : 1.5;
        ctx.globalAlpha = sel ? 0.9 : 0.45;
        ctx.setLineDash([5, 7]);
        const pts = [[u.lat, u.lon], ...u.path.map(p => [p.lat, p.lon])];
        drawPolyline(ctx, pts, false);
        ctx.setLineDash([]);
        ctx.globalAlpha = 1.0;
      }
    });

    // Friendly Unit Icons
    state.units.forEach(u => {
      const pt = latLngToScreen(u.lat, u.lon);
      const sel = u.id === state.selectedUnitId;
      drawUnitMarker(ctx, pt[0], pt[1], u, sel);
    });

    // Enemy Formations
    if (state.diplomacy && state.diplomacy.enemyUnits) {
      state.diplomacy.enemyUnits.forEach(e => {
        const pt = latLngToScreen(e.lat, e.lon);
        const flag = (NEIGHBOR_NATIONS[e.nation] || {}).flag || "🚩";
        drawEnemyMarker(ctx, pt[0], pt[1], flag, Math.round(e.strength), e.engaged);
      });
    }
  }

  // 17. Pending Selected Unit Waypoint Line
  if (state.selectedUnitId) {
    const u = state.units.find(x => x.id === state.selectedUnitId);
    if (u && state.pendingWaypoints && state.pendingWaypoints.length) {
      const pts = [[u.lat, u.lon], ...state.pendingWaypoints.map(p => [p.lat, p.lon])];
      ctx.strokeStyle = "#e0c97f";
      ctx.lineWidth = 2.2;
      ctx.setLineDash([5, 5]);
      drawPolyline(ctx, pts, false);
      ctx.setLineDash([]);
      pts.slice(1).forEach(p => {
        const spt = latLngToScreen(p[0], p[1]);
        ctx.fillStyle = "#e0c97f";
        ctx.beginPath();
        ctx.arc(spt[0], spt[1], 4, 0, Math.PI * 2);
        ctx.fill();
      });
    }
  }

  // 18. Road/Rail/Zone/Dam Construction Preview Line
  if (buildMode && buildDrawPoints.length) {
    ctx.strokeStyle = "#ffe08a";
    ctx.lineWidth = 2.5;
    ctx.setLineDash([4, 4]);
    drawPolyline(ctx, buildDrawPoints, buildMode === "zone");
    ctx.setLineDash([]);
    buildDrawPoints.forEach(p => {
      const spt = latLngToScreen(p[0], p[1]);
      ctx.fillStyle = "#ffe08a";
      ctx.beginPath();
      ctx.arc(spt[0], spt[1], 4, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  // 19. Building Placement Ghost Cursor Preview
  if (placementMode && cursorScreenPos) {
    const def = BUILDING_TYPES[placementMode.type] || {};
    const color = sectorColor(def);
    ctx.fillStyle = color + "33";
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cursorScreenPos.x, cursorScreenPos.y, 18, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "#0a0f14";
    ctx.fillRect(cursorScreenPos.x + 12, cursorScreenPos.y - 12, 140, 32);
    ctx.strokeStyle = "#2a3a44";
    ctx.strokeRect(cursorScreenPos.x + 12, cursorScreenPos.y - 12, 140, 32);
    ctx.fillStyle = "#cfe3e8";
    ctx.font = "11px system-ui";
    ctx.fillText(def.label || placementMode.type, cursorScreenPos.x + 18, cursorScreenPos.y + 2);
  }
}

// ----------------------------------------------------------------------------
// Overlay Rendering Helpers
// ----------------------------------------------------------------------------
// PERFORMANCE — read before changing drawPolyline/drawPolygonRing.
//
// The vector layers are big: ~83k vertices of motorway, ~539k of local road,
// ~135k of water, ~86k of rail, ~51k of municipality boundary. The naive
// version called latLngToScreen() per point, and that runs a Math.sin + Math.log
// (the Mercator projection) every time — ~900k transcendental ops per frame
// once local roads switch on at z12. That alone made the map unplayable.
//
// Three fixes, in order of how much they buy:
//  1. Project each geometry to Mercator world space ONCE and keep it (the
//     projection is camera-independent — only the affine part changes). Per
//     frame a point is then just `w * k + o`: two multiplies, two adds.
//  2. Cull by bounding box. Zoomed into one valley, virtually every road in
//     the country is off-screen; the bbox test rejects it in ~4 comparisons.
//  3. Drop vertices that land within ~0.7px of the previous one. Zoomed out,
//     that collapses most of the detail with no visible difference.
// ----------------------------------------------------------------------------

// lat/lon array -> { flat Float64Array of world coords, bbox }, computed once.
// Keyed weakly off the source array so cached data dies with the geometry.
const _projCache = new WeakMap();
function projectPoints(points) {
  let p = _projCache.get(points);
  if (p) return p;
  const n = points.length;
  const w = new Float64Array(n * 2);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    const pt = points[i];
    const wx = (pt[1] + 180) / 360;
    const s = Math.sin(pt[0] * Math.PI / 180);
    const wy = 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
    w[i * 2] = wx; w[i * 2 + 1] = wy;
    if (wx < minX) minX = wx;
    if (wx > maxX) maxX = wx;
    if (wy < minY) minY = wy;
    if (wy > maxY) maxY = wy;
  }
  p = { w, n, minX, minY, maxX, maxY, lod: null, lodBucket: -1 };
  _projCache.set(points, p);
  return p;
}

// Level of detail. Decimating per point every frame still costs a multiply and
// two compares per vertex — at 900k vertices that's the whole frame budget. So
// decimate ONCE per zoom bucket and keep the reduced vertex list: while the
// player sits at a zoom level (the common case) each frame just walks a short
// array. Crossing a bucket rebuilds it, a one-off few-ms hitch instead of a
// permanent per-frame tax.
// PERF: this runs over tens of thousands of geometries whenever the zoom bucket
// changes, and the dominant cost is ALLOCATION, not arithmetic. Slovenia's local
// road layer is 51.5k separate edges averaging ~10 vertices; allocating a working
// buffer plus a trimmed copy for each one cost 113ms, while the actual vertex
// maths is a couple of ms. Hence: one shared scratch buffer, and no copy at all
// when decimation wouldn't remove anything.
let _lodScratch = new Float64Array(4096);
const LOD_MIN_VERTS = 16; // below this, decimating costs more than drawing

function ensureLod(p) {
  if (p.lodBucket === _lodBucket) return p;
  const w = p.w, n = p.n;
  // Short geometry: point straight at the projected data. Tracing a handful of
  // extra sub-pixel segments inside an already-batched path is far cheaper than
  // allocating a trimmed copy of it.
  if (n <= LOD_MIN_VERTS) { p.lod = w; p.lodBucket = _lodBucket; return p; }

  if (_lodScratch.length < n * 2) _lodScratch = new Float64Array(n * 2);
  const out = _lodScratch, tol = _lodTol;
  let m = 0, lx = w[0], ly = w[1];
  out[m++] = w[0]; out[m++] = w[1];
  for (let i = 1; i < n - 1; i++) {
    const x = w[i * 2], y = w[i * 2 + 1];
    if (Math.abs(x - lx) < tol && Math.abs(y - ly) < tol) continue;
    out[m++] = x; out[m++] = y; lx = x; ly = y;
  }
  out[m++] = w[(n - 1) * 2]; out[m++] = w[(n - 1) * 2 + 1];
  // Nothing was dropped — reuse the source rather than cloning it.
  p.lod = m === n * 2 ? w : out.slice(0, m);
  p.lodBucket = _lodBucket;
  return p;
}

// World -> CSS-pixel affine transform + the visible world rect, refreshed once
// per overlay pass instead of being re-derived per point.
let _vk = 1, _vox = 0, _voy = 0;          // x_css = wx * _vk + _vox
let _vx0 = 0, _vy0 = 0, _vx1 = 1, _vy1 = 1; // visible world rect (with margin)
let _lodBucket = -1, _lodTol = 0;           // half-zoom-step LOD bucket + its tolerance
// Point the shared transform at an arbitrary target: the visible canvas for the
// live pass, or the oversized offscreen canvas when baking the static cache.
//   k        — CSS px per world unit
//   cx, cy   — world coords at the target's centre
//   ox, oy   — that centre in target CSS px
//   tw, th   — target size in CSS px (defines the cull rect)
function setViewTransform(k, cx, cy, ox, oy, tw, th, zoom) {
  _vk = k;
  _vox = ox - cx * k;
  _voy = oy - cy * k;
  const pad = 64; // keep thick strokes near the edge from popping
  _vx0 = (-pad - _vox) / k; _vx1 = (tw + pad - _vox) / k;
  _vy0 = (-pad - _voy) / k; _vy1 = (th + pad - _voy) / k;
  // One bucket per whole zoom level. Rebuilding the LOD walks every vertex in
  // the country (~350k zoomed out), so it has to be rare: at half-level buckets
  // a single wheel notch triggered a rebuild *and* a cache re-bake in the same
  // frame, which is where the worst hitch came from. A whole level means the
  // usual notch stays inside its bucket, at the cost of the tolerance being up
  // to 2x off at the edges — invisible on 1-2px hairlines.
  _lodBucket = Math.round(zoom);
  _lodTol = 1.25 / k;
}

function updateViewTransform(engine, vw, vh) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  // Derive the origin from the actual backing-store size, exactly as
  // latLngToScreen does, rather than assuming canvas.width === vw * dpr.
  setViewTransform(engine.scale / dpr, engine.cx, engine.cy,
    engine.canvas.width / (2 * dpr), engine.canvas.height / (2 * dpr),
    vw, vh, engine.zoom);
}

// True when a cached geometry's bbox can't touch the viewport.
function _culled(p) {
  return p.maxX < _vx0 || p.minX > _vx1 || p.maxY < _vy0 || p.minY > _vy1;
}

// Walk a geometry's LOD vertex list into the current path. That list is already
// decimated for the current zoom bucket, so this is a straight affine loop with
// no per-point decision left in it.
function _tracePath(ctx, p) {
  const w = p.lod, n = w.length >> 1, k = _vk, ox = _vox, oy = _voy;
  ctx.moveTo(w[0] * k + ox, w[1] * k + oy);
  for (let i = 1; i < n; i++) ctx.lineTo(w[i * 2] * k + ox, w[i * 2 + 1] * k + oy);
}

function drawPolyline(ctx, points, close) {
  if (!points || points.length < 2) return;
  const p = projectPoints(points);
  if (_culled(p)) return;
  ensureLod(p);
  ctx.beginPath();
  _tracePath(ctx, p);
  if (close) ctx.closePath();
  ctx.stroke();
}

function drawPolygonRing(ctx, ring, fill) {
  if (!ring || ring.length < 3) return;
  const p = projectPoints(ring);
  if (_culled(p)) return;
  ensureLod(p);
  ctx.beginPath();
  _tracePath(ctx, p);
  ctx.closePath();
  if (fill) ctx.fill();
  ctx.stroke();
}

// Stroke a whole layer as ONE path. The per-shape cost of beginPath()+stroke()
// dominates once a layer has thousands of members — the road network alone is
// 11.7k edges, so the naive one-stroke-per-edge loop cost more than projecting
// the points did. Every member of a layer shares a style, so this is free.
//   items    — array of geometries, or of objects holding one
//   getPoints— optional accessor pulling the lat/lon array out of an item
// Per-layer bbox index, flat and typed. Without it, culling 54k local-road
// edges still meant 54k WeakMap lookups per frame just to throw them away —
// which was the ~9ms floor that survived every other optimisation. Reading four
// floats out of a Float64Array instead makes a rejected edge essentially free.
// Rebuilt when the layer's length changes (the player can add roads/rail).
const _layerIndex = new WeakMap();
function layerBBoxes(items, getPoints) {
  let ix = _layerIndex.get(items);
  if (ix && ix.n === items.length) return ix;
  const n = items.length, bb = new Float64Array(n * 4);
  for (let i = 0; i < n; i++) {
    const pts = getPoints ? getPoints(items[i]) : items[i];
    if (!pts || pts.length < 2) { bb[i * 4] = 1; bb[i * 4 + 1] = 1; bb[i * 4 + 2] = -1; bb[i * 4 + 3] = -1; continue; }
    const p = projectPoints(pts);
    bb[i * 4] = p.minX; bb[i * 4 + 1] = p.minY; bb[i * 4 + 2] = p.maxX; bb[i * 4 + 3] = p.maxY;
  }
  ix = { bb, n };
  _layerIndex.set(items, ix);
  return ix;
}

function drawPolylineBatch(ctx, items, getPoints, close) {
  if (!items || !items.length) return;
  const bb = layerBBoxes(items, getPoints).bb;
  ctx.beginPath();
  for (let i = 0; i < items.length; i++) {
    const o = i * 4;
    if (bb[o + 2] < _vx0 || bb[o] > _vx1 || bb[o + 3] < _vy0 || bb[o + 1] > _vy1) continue;
    const pts = getPoints ? getPoints(items[i]) : items[i];
    const p = projectPoints(pts);
    ensureLod(p);
    _tracePath(ctx, p);
    if (close) ctx.closePath();
  }
  ctx.stroke();
}

function drawBoundsRect(ctx, bounds) {
  const tl = latLngToScreen(bounds[1][0], bounds[0][1]);
  const br = latLngToScreen(bounds[0][0], bounds[1][1]);
  const x = Math.min(tl[0], br[0]), y = Math.min(tl[1], br[1]);
  const w = Math.abs(br[0] - tl[0]), h = Math.abs(br[1] - tl[1]);
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.fill();
  ctx.stroke();
}

function drawCircleMeters(ctx, lat, lon, radiusMeters) {
  const pt = latLngToScreen(lat, lon);
  const pxRadius = radiusMeters / metersPerPixel();
  if (pxRadius <= 0) return;
  ctx.beginPath();
  ctx.arc(pt[0], pt[1], pxRadius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}

function drawCircleMarker(ctx, x, y, r, color, icon) {
  ctx.fillStyle = color;
  ctx.strokeStyle = "#0a0f14";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  if (icon) {
    ctx.fillStyle = "#0a0f14";
    ctx.font = "10px system-ui";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(icon, x, y);
  }
}

function drawIconTag(ctx, x, y, icon, label, color) {
  ctx.fillStyle = "rgba(10,15,20,0.85)";
  ctx.strokeStyle = color || "#2a3a44";
  ctx.lineWidth = 1;
  const txt = `${icon || "📍"} ${label}`;
  ctx.font = "11px system-ui";
  const tw = ctx.measureText(txt).width;
  ctx.fillRect(x - tw / 2 - 4, y - 10, tw + 8, 18);
  ctx.strokeRect(x - tw / 2 - 4, y - 10, tw + 8, 18);
  ctx.fillStyle = "#cfe3e8";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(txt, x, y - 1);
}

function drawLabelTag(ctx, x, y, text, color) {
  ctx.fillStyle = "rgba(10,15,20,0.85)";
  ctx.strokeStyle = color || "#2a3a44";
  ctx.lineWidth = 1;
  ctx.font = "11px system-ui";
  const tw = ctx.measureText(text).width;
  ctx.fillRect(x - tw / 2 - 4, y - 10, tw + 8, 18);
  ctx.strokeRect(x - tw / 2 - 4, y - 10, tw + 8, 18);
  ctx.fillStyle = "#cfe3e8";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x, y - 1);
}

function drawCityLabel(ctx, x, y, name, isCapital) {
  ctx.fillStyle = "rgba(10,15,20,0.82)";
  ctx.strokeStyle = isCapital ? "#7a6a3a" : "#2a3a44";
  ctx.lineWidth = 1;
  ctx.font = isCapital ? "bold 12px system-ui" : "11px system-ui";
  const tw = ctx.measureText(name).width;
  ctx.fillRect(x + 4, y - 8, tw + 8, 18);
  ctx.strokeRect(x + 4, y - 8, tw + 8, 18);
  ctx.fillStyle = isCapital ? "#ffe08a" : "#cfe3e8";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(name, x + 8, y + 1);
}

// Supply colour ramp — yellow when healthy (the requested outline), shading to
// red as it runs out, so a starving unit reads at a glance without zooming in.
function supplyColor(pct) {
  if (pct >= 60) return "#ffd35c";
  if (pct >= 35) return "#e0a860";
  if (pct >= 15) return "#e08f5c";
  return "#e06c60";
}

function unitSupplyPct(unit) {
  return typeof unitSupply === "function" ? unitSupply(unit) : (unit.supply != null ? unit.supply : 100);
}

function drawUnitMarker(ctx, x, y, unit, selected) {
  if (scSettings && scSettings.natoSymbols) drawUnitMarkerNato(ctx, x, y, unit, selected);
  else drawUnitMarkerCircle(ctx, x, y, unit, selected);
}

// Classic round counter: dark disc, teal border, glyph in the middle, and a
// yellow supply arc sweeping clockwise from 12 o'clock around the rim.
function drawUnitMarkerCircle(ctx, x, y, unit, selected) {
  const isTraining = unit.trainingDaysLeft > 0 && unit.trainingDaysTotal;
  const r = 13;

  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = selected ? "rgba(127, 224, 201, 0.95)" : "rgba(14, 22, 29, 0.9)";
  ctx.fill();
  ctx.strokeStyle = selected ? "#ffe08a" : "#7fe0c9";
  ctx.lineWidth = selected ? 2.2 : 1.4;
  ctx.stroke();

  if (!isTraining) {
    const pct = Math.max(0, Math.min(100, unitSupplyPct(unit)));
    // Unfilled remainder, so the ring always reads as a gauge rather than an
    // arc of ambiguous length.
    ctx.beginPath();
    ctx.arc(x, y, r + 3, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.14)";
    ctx.lineWidth = 2.4;
    ctx.stroke();
    if (pct > 0) {
      ctx.beginPath();
      ctx.arc(x, y, r + 3, -Math.PI / 2, -Math.PI / 2 + (pct / 100) * Math.PI * 2);
      ctx.strokeStyle = supplyColor(pct);
      ctx.lineWidth = 2.4;
      ctx.lineCap = "butt";
      ctx.stroke();
    }
  }

  ctx.fillStyle = selected ? "#0a0f14" : "#cfe3e8";
  ctx.font = "bold 9px monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  if (isTraining) {
    const p = Math.max(0, Math.min(99, Math.round((1 - unit.trainingDaysLeft / unit.trainingDaysTotal) * 100)));
    ctx.fillText(p + "%", x, y);
  } else {
    ctx.fillText(unitGlyph(unit.type), x, y);
  }
}

// APP-6 / MIL-STD-2525 style friendly land frame: a rectangle for ground, a
// rounded "dome" for air, with the branch device drawn inside and a supply bar
// underneath acting as the readiness threshold line.
function drawUnitMarkerNato(ctx, x, y, unit, selected) {
  const isTraining = unit.trainingDaysLeft > 0 && unit.trainingDaysTotal;
  const air = UNIT_TYPES[unit.type] && UNIT_TYPES[unit.type].domain === "air";
  const w = 30, h = 20;
  const l = x - w / 2, rgt = x + w / 2, t = y - h / 2, b = y + h / 2;

  ctx.beginPath();
  if (air) {
    // Air frame: flat bottom, domed top.
    ctx.moveTo(l, b);
    ctx.lineTo(l, y);
    ctx.quadraticCurveTo(x, t - 6, rgt, y);
    ctx.lineTo(rgt, b);
    ctx.closePath();
  } else {
    ctx.rect(l, t, w, h);
  }
  ctx.fillStyle = selected ? "rgba(127, 224, 201, 0.95)" : "rgba(107, 178, 214, 0.85)"; // friendly blue
  ctx.fill();
  ctx.strokeStyle = selected ? "#ffe08a" : "#0a2432";
  ctx.lineWidth = selected ? 2.2 : 1.3;
  ctx.stroke();

  // Branch device inside the frame.
  ctx.strokeStyle = "#0a2432";
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  natoDevice(ctx, unit.type, l, t, rgt, b, x, y);
  ctx.stroke();

  if (isTraining) {
    ctx.fillStyle = "#0a2432";
    ctx.font = "bold 9px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const p = Math.max(0, Math.min(99, Math.round((1 - unit.trainingDaysLeft / unit.trainingDaysTotal) * 100)));
    ctx.fillText(p + "%", x, y);
    return;
  }

  // Supply threshold line under the symbol.
  const pct = Math.max(0, Math.min(100, unitSupplyPct(unit)));
  const by = b + 4, bw = w;
  ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
  ctx.fillRect(l - 1, by - 1, bw + 2, 5);
  ctx.fillStyle = "rgba(255, 255, 255, 0.18)";
  ctx.fillRect(l, by, bw, 3);
  ctx.fillStyle = supplyColor(pct);
  ctx.fillRect(l, by, bw * (pct / 100), 3);
}

// Minimal APP-6 branch devices: infantry crossed lines, armour oval, artillery
// dot, recon single diagonal, AA arch, air types get a plain frame + label.
function natoDevice(ctx, type, l, t, r, b, cx, cy) {
  const inset = 3;
  switch (type) {
    case "inf":
    case "recon_drone":
      ctx.moveTo(l + inset, t + inset); ctx.lineTo(r - inset, b - inset);
      ctx.moveTo(r - inset, t + inset); ctx.lineTo(l + inset, b - inset);
      break;
    case "recon":
      ctx.moveTo(l + inset, b - inset); ctx.lineTo(r - inset, t + inset);
      break;
    case "mbt":
    case "ifv":
      ctx.ellipse(cx, cy, (r - l) / 2 - inset, (b - t) / 2 - inset, 0, 0, Math.PI * 2);
      break;
    case "arty":
      ctx.moveTo(cx + 3, cy); ctx.arc(cx, cy, 3, 0, Math.PI * 2);
      break;
    case "aa":
      ctx.moveTo(l + inset, b - inset);
      ctx.quadraticCurveTo(cx, t + inset - 2, r - inset, b - inset);
      break;
    default: // aircraft — the domed frame already says "air"
      ctx.moveTo(cx - 5, cy + 2); ctx.lineTo(cx, cy - 3); ctx.lineTo(cx + 5, cy + 2);
      break;
  }
}

function drawEnemyMarker(ctx, x, y, flag, str, engaged) {
  const txt = `${flag} ${str}`;
  ctx.font = "bold 10px system-ui";
  ctx.fillStyle = engaged ? "rgba(224, 64, 64, 0.95)" : "rgba(160, 32, 32, 0.9)";
  ctx.strokeStyle = engaged ? "#ffe08a" : "#e08f7f";
  ctx.lineWidth = 1.5;
  const tw = ctx.measureText(txt).width;
  ctx.fillRect(x - tw / 2 - 4, y - 10, tw + 8, 20);
  ctx.strokeRect(x - tw / 2 - 4, y - 10, tw + 8, 20);
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(txt, x, y);
}

// ----------------------------------------------------------------------------
// Interactivity & Selection
// ----------------------------------------------------------------------------
function labelMinZoom(pop) {
  if (pop >= 100000) return 6;
  if (pop >= 20000) return 9;
  if (pop >= 10000) return 11;
  return 12;
}

function unitGlyph(type) {
  return { ifv: "IFV", mbt: "MBT", inf: "INF", arty: "ART", recon: "RCN", aa: "AA",
    fighter: "FTR", attack_air: "CAS", bomber: "BMB", recon_drone: "UAV", attack_drone: "UCV" }[type] || "?";
}

function metersPerPixel() {
  const z = mapEngine ? mapEngine.zoom : 9;
  return 40075016.686 * Math.cos(46.05 * Math.PI / 180) / (256 * Math.pow(2, z));
}

function buildingFootprintMeters(def) {
  if (!def) return 200;
  if (def.footprintM) return def.footprintM;
  return clamp(140 + Math.sqrt((def.cost || 20e6) / 1e6) * 45, 140, 1000);
}

function buildingBounds(lat, lon, def, scale) {
  const half = buildingFootprintMeters(def) * (scale || 1) / 2;
  const dLat = half / 111320;
  const dLon = half / (111320 * Math.cos(lat * Math.PI / 180));
  return [[lat - dLat, lon - dLon], [lat + dLat, lon + dLon]];
}

function sectorColor(def) {
  if (!def) return "#e0c97f";
  return (SECTOR_STYLE[def.sector] || {}).color || "#e0c97f";
}

function highlightMunicipality(id) {
  selectedMunicipalityId = id;
  if (mapEngine) mapEngine._scheduleRender();
}

function clearMunicipalityHighlight() {
  selectedMunicipalityId = null;
  if (mapEngine) mapEngine._scheduleRender();
}

function selectMunicipalityAt(lat, lon) {
  const m = municipalityAt(lat, lon);
  if (!m) return;
  highlightMunicipality(m.id);
  const nearest = nearestCityTo(m.centroid[0], m.centroid[1]);
  openCityPanel(nearest.id, m.id, m.name);
}

function selectUnit(id) {
  if (state.selectedUnitId !== id) playSound("troopSelect");
  state.selectedUnitId = id;
  state.pendingWaypoints = [];
  updateSelectedUnitBox();
  renderPendingLine();
  if (mapEngine) mapEngine._scheduleRender();
}

function deselectAll() {
  state.selectedUnitId = null;
  state.pendingWaypoints = [];
  state.selectedCityId = null;
  state.selectedMunicipalityId = null;
  buildMode = null;
  buildDrawPoints = [];
  placementMode = null;
  updateSelectedUnitBox();
  renderPendingLine();
  closeCityPanel();
  document.getElementById("roadBuildBar").classList.add("hidden");
  clearMunicipalityHighlight();
  if (mapEngine) mapEngine._scheduleRender();
}

function onMapClick(e) {
  if (buildMode) {
    addBuildPoint(e.latlng);
    return;
  }
  if (placementMode) { tryPlaceBuildingAt(e.latlng.lat, e.latlng.lng); return; }

  // Check if a unit icon was clicked
  const clickedUnit = state.units.find(u => {
    const pt = latLngToScreen(u.lat, u.lon);
    return Math.hypot(pt[0] - e.x, pt[1] - e.y) < 18;
  });
  if (clickedUnit) {
    selectUnit(clickedUnit.id);
    return;
  }

  if (!state.selectedUnitId) {
    if (typeof isOutsideSlovenia === "function" && isOutsideSlovenia(e.latlng.lat, e.latlng.lng)) {
      if (typeof openDiplomacyForPoint === "function") openDiplomacyForPoint(e.latlng.lat, e.latlng.lng);
    } else {
      selectMunicipalityAt(e.latlng.lat, e.latlng.lng);
    }
    return;
  }

  state.pendingWaypoints.push({ lat: e.latlng.lat, lon: e.latlng.lng, cityId: null });
  updateSelectedUnitBox();
  renderPendingLine();
}

function onMapMouseDown(e) {
  if (buildMode || !state.selectedUnitId) return;
  isDrawingPath = true;
  dragPointCount = 0;
  lastDrawLatLng = e.latlng;
}

function onMapMouseMove(e) {
  if (!isDrawingPath) return;
  const distKm = haversineKm(lastDrawLatLng.lat, lastDrawLatLng.lng, e.latlng.lat, e.latlng.lng);
  if (distKm < 1.2) return;
  if (dragPointCount === 0 && !e.originalEvent.shiftKey) state.pendingWaypoints = [];
  state.pendingWaypoints.push({ lat: e.latlng.lat, lon: e.latlng.lng, cityId: null });
  dragPointCount++;
  lastDrawLatLng = e.latlng;
  renderPendingLine();
}

function onMapMouseUp() {
  if (isDrawingPath && dragPointCount > 1) {
    const u = state.units.find(x => x.id === state.selectedUnitId);
    if (u) u.freePath = true;
    updateSelectedUnitBox();
  }
  isDrawingPath = false;
}

function onMapKeydown(e) {
  const tag = document.activeElement && document.activeElement.tagName;
  const typing = tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA";
  if (e.key === " " || e.code === "Space") {
    if (typing) return;
    e.preventDefault();
    state.paused = !state.paused;
    refreshSpeedButtons();
    return;
  }
  if (e.key === "Backspace") {
    if (typing) return;
    if (buildMode) {
      if (buildDrawPoints.length) { buildDrawPoints.pop(); redrawBuildLine(); }
      e.preventDefault();
      return;
    }
    if (state.selectedUnitId && state.pendingWaypoints.length) {
      state.pendingWaypoints.pop();
      updateSelectedUnitBox();
      renderPendingLine();
      e.preventDefault();
    }
    return;
  }
  // X toggles "ignore roads" on the selected ground unit (air units always fly
  // direct, so there's nothing to toggle for them).
  if ((e.key === "x" || e.key === "X") && !typing) {
    const u = state.units.find(x => x.id === state.selectedUnitId);
    if (u && !unitIsAir(u.type)) {
      u.freePath = !u.freePath;
      updateSelectedUnitBox();
      logEvent(`${u.name}: ${u.freePath ? "ignoring roads — will follow the exact drawn path" : "following roads again"}.`);
      e.preventDefault();
    }
    return;
  }
  // H halts EVERY unit: all outstanding move orders are forgotten and each unit
  // stops exactly where it is.
  if ((e.key === "h" || e.key === "H") && !typing) {
    e.preventDefault();
    // Co-op: let the host perform the halt authoritatively.
    if (typeof mpRelayIfClient === "function" && mpRelayIfClient("haltAll", {})) return;
    const n = haltAllUnits();
    updateSelectedUnitBox(); renderPendingLine();
    if (typeof mapEngine !== "undefined" && mapEngine) mapEngine._scheduleRender();
    logEvent(n ? `All units halted — ${n} order${n === 1 ? "" : "s"} cancelled.` : "All units halted in place.");
    return;
  }
  if (e.key === "Enter") {
    if (buildMode) { confirmBuild(); return; }
    confirmUnitMove();
    renderPendingLine();
  } else if (e.key === "Escape") {
    if (typing) return;
    if (typeof settingsOpen === "function" && settingsOpen()) { closeSettings(); return; }
    if (typeof pauseMenuOpen !== "undefined" && pauseMenuOpen) { closePauseMenu(); return; }
    if (placementMode) { cancelPlacementMode(); return; }
    if (buildMode) { cancelBuild(); return; }
    if (state.selectedUnitId || (state.pendingWaypoints && state.pendingWaypoints.length)) { deselectAll(); return; }
    if (typeof gameStarted !== "undefined" && gameStarted && typeof openPauseMenu === "function") openPauseMenu();
  }
}

// ---- Map popup (replaces L.popup) ----
// An absolutely-positioned <div> over #mapwrap, re-anchored every overlay pass
// so it tracks its lat/lon while the camera pans and zooms.
let mapPopupAnchor = null; // { lat, lon }

function showMapPopup(lat, lon, html) {
  const el = document.getElementById("mapPopup");
  if (!el) return;
  mapPopupAnchor = { lat, lon };
  el.innerHTML = `<button class="mapPopupClose" onclick="closeMapPopup()">✕</button>${html}`;
  el.classList.remove("hidden");
  positionMapPopup();
}

function closeMapPopup() {
  mapPopupAnchor = null;
  const el = document.getElementById("mapPopup");
  if (el) el.classList.add("hidden");
}

function positionMapPopup() {
  const el = document.getElementById("mapPopup");
  if (!el || !mapPopupAnchor || !mapEngine) return;
  const pt = latLngToScreen(mapPopupAnchor.lat, mapPopupAnchor.lon);
  el.style.left = pt[0] + "px";
  el.style.top = (pt[1] - 12) + "px";
}

function renderPendingLine() {
  if (mapEngine) mapEngine._scheduleRender();
}

function syncUnitMarkers() {
  if (mapEngine) mapEngine._scheduleRender();
}

function syncEnemyMarkers() {
  if (mapEngine) mapEngine._scheduleRender();
}

function drawUnitPaths() {}
function drawAirDefense() {}
function drawInfraProgress() {}
function updateConstructionMarkers() {}

// ---- Building Placement Tools ----
function startPlacementMode(type, cityId, municipalityId) {
  const municipality = MUNICIPALITIES.find(m => m.id === municipalityId);
  placementMode = { type, cityId, municipalityId, municipality };
}

function cancelPlacementMode() {
  placementMode = null;
  if (mapEngine) mapEngine._scheduleRender();
}

function isOpenWaterAt(lat, lon) {
  if (nearestWaterDistanceKm(lat, lon) < 0.2) return true;
  if (typeof isOutsideSlovenia === "function" && isOutsideSlovenia(lat, lon)) {
    if (typeof countryForPoint === "function" && countryForPoint(lat, lon) === null) return true;
  }
  return false;
}

function tryPlaceBuildingAt(lat, lon) {
  if (!placementMode) return;
  const defEarly = BUILDING_TYPES[placementMode.type] || {};
  const inside = defEarly.placeOnWater
    || (placementMode.municipality && placementMode.municipality.rings.some(r => pointInRing([lat, lon], r)));
  if (!inside) {
    logEvent(`That spot is outside ${placementMode.municipality ? placementMode.municipality.name : "the selected municipality"} — click inside the highlighted area.`);
    return;
  }
  const { type, cityId, municipalityId } = placementMode;
  const def = BUILDING_TYPES[type];

  if (def.placeOnWater && !isOpenWaterAt(lat, lon)) {
    logEvent(`A ${def.label} must be placed DIRECTLY on open water — click on the sea or right on a river/lake line.`);
    return;
  }

  if (pointInAnyZone(lat, lon)) {
    logEvent(`Can't build here — this land is inside an economic/industrial zone. Dissolve the zone first or pick another spot.`);
    return;
  }

  if (def.requiresDeposit) {
    const dist = nearestDepositKm(lat, lon, def.resourceId);
    if (dist > DEPOSIT_RANGE_KM) {
      logEvent(`No ${RESOURCE_META[def.resourceId].label} deposit here. ${def.label}s can only be built on a real deposit — enable the Resources layer (bottom-right) to find one.`);
      return;
    }
  }
  if (def.requiresWater) {
    if (nearestWaterDistanceKm(lat, lon) > 1.2) {
      logEvent(`A ${def.label} must be built on a river or lake — click directly on a blue water line.`);
      return;
    }
  }

  if (def.sector === "social" && def.servesPopulation) {
    const pop = municipalityPopFor(municipalityId, cityId);
    const planned = plannedCoverageCount(type, municipalityId) * def.servesPopulation;
    if ((pop - planned) / def.servesPopulation < 0.05) {
      logEvent(`${(placementMode.municipality || {}).name || "This area"} is already fully served by ${def.label.toLowerCase()}s — a new one would stand empty.`);
      return;
    }
  }

  const myR = buildingFootprintMeters(def) * municipalityScale(cityId, municipalityId) / 2 / 1000;
  const clashes = (bLat, bLon, bType, bMunScale) => haversineKm(lat, lon, bLat, bLon) < myR + buildingFootprintMeters(BUILDING_TYPES[bType]) * bMunScale / 2 / 1000;
  if (state.completedBuildings.some(b => b.lat != null && clashes(b.lat, b.lon, b.type, b.munScale || 1))
   || state.constructions.some(p => p.lat != null && clashes(p.lat, p.lon, p.type, municipalityScale(p.cityId, p.municipalityId)))) {
    logEvent(`Too close to an existing building — pick a spot with more room.`);
    return;
  }

  const proj = startConstruction(type, cityId, municipalityId, lat, lon);
  if (proj) {
    playSound("construction");
    logEvent(`Started construction: ${BUILDING_TYPES[type].label} at ${cityById(cityId).name} (${fmtEUR(buildCostFor(type))}).`);
    placementMode = { type, cityId, municipalityId, municipality: placementMode.municipality };
  } else {
    cancelPlacementMode();
  }
  if (typeof onBuildingPlaced === "function") onBuildingPlaced();
  if (mapEngine) mapEngine._scheduleRender();
}

function refreshBuildingMarkers() {}

// ---- Infrastructure Construction Tooling ----
function buildTypeMap() { return buildMode === "road" ? ROAD_TYPES : RAIL_TYPES; }

function startBuildMode(kind) {
  deselectAll();
  buildMode = kind;
  buildDrawPoints = [];
  buildSubtype = Object.keys(kind === "road" ? ROAD_TYPES : RAIL_TYPES)[0];
  document.getElementById("roadBuildBar").classList.remove("hidden");
  renderBuildTypePicker();
  document.getElementById("roadBuildConfirm").disabled = true;
  updateBuildCostPreview();
}

function renderBuildTypePicker() {
  const el = document.getElementById("roadTypePicker");
  if (!el) return;
  const types = buildTypeMap();
  el.innerHTML = Object.entries(types).map(([k, t]) =>
    `<div class="buildTypeCard ${k === buildSubtype ? "sel" : ""}" data-bt="${k}">
       <img src="${t.image}" alt="${t.label}" />
       <div class="btName">${t.label}</div>
       <div class="btMeta">${fmtEUR(t.costPerKm)}/km</div>
     </div>`).join("");
  el.querySelectorAll(".buildTypeCard").forEach(c => c.addEventListener("click", () => {
    buildSubtype = c.dataset.bt;
    el.querySelectorAll(".buildTypeCard").forEach(x => x.classList.toggle("sel", x.dataset.bt === buildSubtype));
    redrawBuildLine();
  }));
  document.getElementById("roadBuildLabel").textContent = `Drawing ${buildMode === "road" ? "road" : "railway"} — click points on map · ENTER build · BACKSPACE undo · ESC cancel`;
}

function startZoneDraw(kind, cityId, municipalityId) {
  cancelPlacementMode();
  buildMode = "zone";
  zoneDraw = { kind, cityId, municipalityId };
  buildDrawPoints = [];
  const zt = ZONE_TYPES[kind];
  document.getElementById("roadTypePicker").innerHTML = `<div class="zoneDrawHint" style="color:${zt.color}">${zt.icon} Drawing ${zt.label}</div>`;
  document.getElementById("roadBuildLabel").textContent = "Click ≥3 points to outline zone · ENTER build · BACKSPACE undo · ESC cancel";
  document.getElementById("roadBuildBar").classList.remove("hidden");
  document.getElementById("roadBuildConfirm").disabled = true;
  updateBuildCostPreview();
}

function startDamDraw(cityId, municipalityId) {
  cancelPlacementMode();
  buildMode = "dam";
  damDraw = { cityId, municipalityId };
  buildDrawPoints = [];
  document.getElementById("roadTypePicker").innerHTML = `<div class="zoneDrawHint" style="color:#c3c9ce">${svgIcon('energy')} Building Hydroelectric Dam</div>`;
  document.getElementById("roadBuildLabel").textContent = "Click point A then B across river · ENTER build · BACKSPACE undo · ESC cancel";
  document.getElementById("roadBuildBar").classList.remove("hidden");
  document.getElementById("roadBuildConfirm").disabled = true;
  updateBuildCostPreview();
}

function addBuildPoint(latlng) {
  if (buildMode === "dam" && buildDrawPoints.length >= 2) buildDrawPoints = [];
  buildDrawPoints.push([latlng.lat, latlng.lng]);
  redrawBuildLine();
}

function redrawBuildLine() {
  updateBuildCostPreview();
  if (mapEngine) mapEngine._scheduleRender();
}

const NETWORK_CONNECT_THRESHOLD_KM = 2;

function nearestRoadNetworkDistanceKm(lat, lon) {
  let best = Infinity;
  for (const id in ROAD_NODES) {
    const [la, lo] = ROAD_NODES[id];
    const d = haversineKm(lat, lon, la, lo);
    if (d < best) best = d;
  }
  return best;
}

function nearestRailNetworkDistanceKm(lat, lon) {
  let best = Infinity;
  RAIL_LINES.forEach(line => {
    for (let i = 0; i < line.length; i += Math.max(1, Math.floor(line.length / 30))) {
      const d = haversineKm(lat, lon, line[i][0], line[i][1]);
      if (d < best) best = d;
    }
  });
  return best;
}

function nearestWaterDistanceKm(lat, lon) {
  let best = Infinity;
  WATER_LINES.forEach(line => {
    for (let i = 0; i < line.length; i += Math.max(1, Math.floor(line.length / 15))) {
      const d = haversineKm(lat, lon, line[i][0], line[i][1]);
      if (d < best) best = d;
    }
  });
  return best;
}

let RIVER_LINES_CACHE = null;
function riverLines() {
  if (RIVER_LINES_CACHE) return RIVER_LINES_CACHE;
  RIVER_LINES_CACHE = (WATER_LINES || []).filter(line => {
    if (line.length < 2) return false;
    const a = line[0], b = line[line.length - 1];
    return haversineKm(a[0], a[1], b[0], b[1]) > 0.2;
  });
  return RIVER_LINES_CACHE;
}

function nearestRiverDistanceKm(lat, lon) {
  let best = Infinity;
  riverLines().forEach(line => {
    for (let i = 0; i < line.length; i++) {
      const d = haversineKm(lat, lon, line[i][0], line[i][1]);
      if (d < best) best = d;
    }
  });
  return best;
}

function damCrossesRiver(a, b) {
  const midLat = (a[0] + b[0]) / 2, midLon = (a[1] + b[1]) / 2;
  return nearestRiverDistanceKm(midLat, midLon) < 0.35 &&
    Math.max(nearestRiverDistanceKm(a[0], a[1]), nearestRiverDistanceKm(b[0], b[1])) < 0.6;
}

function updateBuildCostPreview() {
  const costEl = document.getElementById("roadBuildCost");
  const confirmBtn = document.getElementById("roadBuildConfirm");
  if (!costEl || !confirmBtn) return;

  if (buildMode === "zone") {
    if (buildDrawPoints.length < 3) { costEl.textContent = "Click at least 3 points to outline zone."; confirmBtn.disabled = true; return; }
    const zt = ZONE_TYPES[zoneDraw.kind];
    const area = polygonAreaKm2(buildDrawPoints);
    const cost = area * zt.costPerKm2;
    const cityPop = (cityById(zoneDraw.cityId) || { pop: 30000 }).pop;
    const maxArea = clamp(cityPop / 18000, 1.5, 40);
    const tooBig = area > maxArea;
    const affordable = state.econ.treasury >= cost;
    const overlaps = buildDrawPoints.some(p => pointInAnyZone(p[0], p[1]));
    const overBuilding = anyBuildingInPolygon(buildDrawPoints);
    const needsCoast = !!zt.requiresCoast;
    const coastal = !needsCoast || buildDrawPoints.some(([la, lo]) => la < 45.75 && lo < 14.0 && nearestWaterDistanceKm(la, lo) < 1.2);
    costEl.dataset.zoneCost = cost; costEl.dataset.zoneArea = area;
    const reasons = [`${zt.icon} ${zt.label}: ${area.toFixed(1)} km² × ${fmtEUR(zt.costPerKm2)}/km²`];
    if (tooBig) reasons.push(`⚠ too large for ${(cityById(zoneDraw.cityId) || {}).name || "this town"}`);
    if (overlaps) reasons.push("⚠ overlaps existing zone");
    if (overBuilding) reasons.push("⚠ covers existing building");
    if (!coastal) reasons.push("⚠ Port Zone must touch coast");
    if (!affordable) reasons.push("⚠ insufficient treasury");
    costEl.innerHTML = `<b>${fmtEUR(cost)}</b><br><span class="buildReasons">${reasons.join(" · ")}</span>`;
    confirmBtn.disabled = tooBig || overlaps || overBuilding || !coastal || !affordable;
    return;
  }

  if (buildMode === "dam") {
    const def = BUILDING_TYPES.power_hydro;
    if (buildDrawPoints.length < 2) { costEl.textContent = "Click point A then B across a river."; confirmBtn.disabled = true; return; }
    const a = buildDrawPoints[0], b = buildDrawPoints[1];
    const spanKm = haversineKm(a[0], a[1], b[0], b[1]);
    const onRiver = damCrossesRiver(a, b);
    const tooLong = spanKm > 3;
    const tooShort = spanKm < 0.03;
    const size = damSizeFactor(spanKm);
    const cost = Math.round(def.cost * size);
    const days = Math.max(30, Math.round(def.days * size));
    const elec = Math.round(6000 * size);
    const affordable = state.econ.treasury >= cost;
    costEl.dataset.damCost = cost;
    costEl.dataset.damDays = days;
    const reasons = [`${def.label}: ${Math.round(spanKm * 1000)} m wall · size ×${size.toFixed(2)} → ${fmtNum(elec)} MWh/mo`];
    if (!onRiver) reasons.push("⚠ must be drawn across a river");
    if (tooLong) reasons.push("⚠ dam wall too long (max 3 km)");
    if (!affordable) reasons.push("⚠ insufficient treasury");
    costEl.innerHTML = `<b>${fmtEUR(cost)}</b> · ${days} days<br><span class="buildReasons">${reasons.join(" · ")}</span>`;
    confirmBtn.disabled = !onRiver || tooLong || tooShort || !affordable;
    return;
  }

  if (buildDrawPoints.length < 2) {
    costEl.textContent = "Click at least 2 points on the map.";
    confirmBtn.disabled = true;
    return;
  }
  let distKm = 0;
  for (let i = 0; i < buildDrawPoints.length - 1; i++) {
    distKm += haversineKm(buildDrawPoints[i][0], buildDrawPoints[i][1], buildDrawPoints[i + 1][0], buildDrawPoints[i + 1][1]);
  }
  const t = buildTypeMap()[buildSubtype];
  const nearestFn = buildMode === "road" ? nearestRoadNetworkDistanceKm : nearestRailNetworkDistanceKm;
  const startDist = nearestFn(buildDrawPoints[0][0], buildDrawPoints[0][1]);
  const endDist = nearestFn(buildDrawPoints[buildDrawPoints.length - 1][0], buildDrawPoints[buildDrawPoints.length - 1][1]);
  const connected = Math.min(startDist, endDist) <= NETWORK_CONNECT_THRESHOLD_KM;
  const crossesWater = buildDrawPoints.some(([la, lo]) => nearestWaterDistanceKm(la, lo) < 0.15);
  const waterMult = crossesWater ? 1.25 : 1;

  const cost = distKm * t.costPerKm * waterMult;
  const days = Math.max(5, Math.round(distKm * t.daysPerKm * waterMult));
  const affordable = state.econ.treasury >= cost;

  costEl.dataset.cost = cost;
  costEl.dataset.days = days;
  costEl.dataset.distKm = distKm;
  costEl.dataset.connected = connected ? "1" : "0";

  const reasons = [`${t.label}: ${distKm.toFixed(1)} km × ${fmtEUR(t.costPerKm)}/km`];
  if (crossesWater) reasons.push("+25% water crossing");
  if (!connected) reasons.push(`⚠ not connected to network`);
  if (!affordable) reasons.push("⚠ insufficient treasury");

  costEl.innerHTML = `<b>${fmtEUR(cost)}</b> · ${days} days<br><span class="buildReasons">${reasons.join(" · ")}</span>`;
  confirmBtn.disabled = !connected || !affordable;
}

function confirmBuild() {
  if (buildMode === "zone") {
    if (buildDrawPoints.length < 3) return;
    const costEl = document.getElementById("roadBuildCost");
    const cost = Number(costEl.dataset.zoneCost || 0);
    const area = Number(costEl.dataset.zoneArea || 0);
    if (state.econ.treasury < cost) { logEvent("Zone cancelled: insufficient treasury."); cancelBuild(); return; }
    state.econ.treasury -= cost;
    const z = { id: state.zoneSeq++, kind: zoneDraw.kind, points: buildDrawPoints.slice(), cityId: zoneDraw.cityId, municipalityId: zoneDraw.municipalityId, areaKm2: area };
    state.zones.push(z);
    playSound("construction");
    logEvent(`<b>${ZONE_TYPES[z.kind].label}</b> established near ${(cityById(z.cityId) || {}).name || ""} (${area.toFixed(1)} km², ${fmtEUR(cost)}).`);
    cancelBuild();
    return;
  }
  if (buildMode === "dam") {
    if (buildDrawPoints.length < 2) return;
    const def = BUILDING_TYPES.power_hydro;
    const costEl = document.getElementById("roadBuildCost");
    const a = buildDrawPoints[0], b = buildDrawPoints[1];
    const spanKm = haversineKm(a[0], a[1], b[0], b[1]);
    if (!damCrossesRiver(a, b)) {
      logEvent(`A <b>${def.label}</b> must be drawn across a river.`);
      return;
    }
    if (spanKm > 3 || spanKm < 0.03) { logEvent("Dam cancelled: wall must span river."); return; }
    const size = damSizeFactor(spanKm);
    const cost = Number(costEl.dataset.damCost || Math.round(def.cost * size));
    const days = Number(costEl.dataset.damDays || Math.max(30, Math.round(def.days * size)));
    if (state.econ.treasury < cost) { logEvent("Dam cancelled: insufficient treasury."); cancelBuild(); return; }
    state.econ.treasury -= cost;
    const midLat = (a[0] + b[0]) / 2, midLon = (a[1] + b[1]) / 2;
    const proj = {
      id: state.buildSeq++, type: "power_hydro", isDam: true,
      damPoints: buildDrawPoints.slice(0, 2), sizeFactor: size, spanKm,
      cityId: damDraw.cityId, municipalityId: damDraw.municipalityId,
      lat: midLat, lon: midLon, daysLeft: days, totalDays: days,
    };
    state.constructions.push(proj);
    playSound("construction");
    logEvent(`Started building <b>${def.label}</b> across river (${fmtEUR(cost)}, ${days} days).`);
    cancelBuild();
    return;
  }

  if (buildDrawPoints.length < 2) return;
  const costEl = document.getElementById("roadBuildCost");
  const cost = Number(costEl.dataset.cost || 0);
  const days = Number(costEl.dataset.days || 30);
  const distKm = Number(costEl.dataset.distKm || 0);
  const connected = costEl.dataset.connected === "1";
  if (!connected || !cost || state.econ.treasury < cost) {
    logEvent("Infrastructure project cancelled.");
    cancelBuild();
    return;
  }
  const t = buildTypeMap()[buildSubtype];
  // Capture everything needed to commit the project as plain data, so a co-op
  // joiner can send it to the host to build authoritatively.
  const payload = {
    kind: buildMode, subtype: buildSubtype, points: buildDrawPoints.slice(),
    distKm, cost, days, tier: buildMode === "road" ? t.tier : null, color: t.color, label: t.label,
  };
  cancelBuild();
  if (typeof mpRelayIfClient === "function" && mpRelayIfClient("buildInfra", payload)) return;
  applyInfraProject(payload);
}

// Commit a road/rail project from explicit data. Used by confirmBuild() locally
// and by the host when it replays a joined player's "buildInfra" command.
function applyInfraProject(p) {
  if (!p || !p.points || p.points.length < 2) return;
  if (!p.cost || state.econ.treasury < p.cost) { logEvent("Infrastructure project cancelled: treasury too low."); return; }
  state.econ.treasury -= p.cost;
  state.infraProjects.push({
    id: state.infraSeq++, kind: p.kind, subtype: p.subtype,
    tier: p.tier, color: p.color, label: p.label,
    points: p.points.slice(), distKm: p.distKm, daysLeft: p.days, totalDays: p.days,
  });
  playSound("construction");
  logEvent(`Started building ${p.label} (${(p.distKm || 0).toFixed(1)} km, ${fmtEUR(p.cost)}).`);
  if (typeof mapEngine !== "undefined" && mapEngine) mapEngine._scheduleRender();
}

function cancelBuild() {
  buildMode = null;
  buildSubtype = null;
  zoneDraw = null;
  damDraw = null;
  buildDrawPoints = [];
  document.getElementById("roadBuildBar").classList.add("hidden");
  const picker = document.getElementById("roadTypePicker");
  if (picker) picker.innerHTML = "";
  if (mapEngine) mapEngine._scheduleRender();
}

function devScaledPoints(z) {
  const [clat, clon] = zoneCentroid(z);
  const s = Math.sqrt(Math.max(0.04, z.dev == null ? 0.05 : z.dev));
  return z.points.map(p => [clat + (p[0] - clat) * s, clon + (p[1] - clon) * s]);
}

function zoneCentroid(z) {
  const n = z.points.length;
  return [z.points.reduce((s, p) => s + p[0], 0) / n, z.points.reduce((s, p) => s + p[1], 0) / n];
}

function pointInAnyZone(lat, lon) {
  return state.zones.some(z => pointInRing([lat, lon], z.points));
}

function anyBuildingInPolygon(points) {
  const hit = (lat, lon) => pointInRing([lat, lon], points);
  return state.completedBuildings.some(b => b.lat != null && hit(b.lat, b.lon))
      || state.constructions.some(p => p.lat != null && hit(p.lat, p.lon));
}

function drawCustomRoad(proj) {}

function damSizeFactor(spanKm) { return clamp(spanKm / 0.4, 0.6, 3.0); }

function finalizeDam(points, cityId, municipalityId, sizeFactor) {
  const def = BUILDING_TYPES.power_hydro;
  const size = sizeFactor || 1;
  const midLat = (points[0][0] + points[1][0]) / 2;
  const midLon = (points[0][1] + points[1][1]) / 2;
  const baseMult = computeBuildingEffectMultiplier("power_hydro", cityId, municipalityId) * size;
  const roadFactor = roadConnectivityFactor(midLat, midLon);
  const munScale = municipalityScale(cityId, municipalityId);
  def.apply(baseMult * roadFactor * munScale);
  if (def.demandKey) state.sectorSupply[def.demandKey] = (state.sectorSupply[def.demandKey] || 0) + (def.capacity || 0) * size * munScale;
  const dam = {
    id: state.buildSeq++, type: "power_hydro", isDam: true, damPoints: points.slice(),
    sizeFactor: size, damMWh: Math.round(6000 * size),
    cityId, municipalityId, lat: midLat, lon: midLon, baseMult, roadFactor, munScale,
  };
  state.completedBuildings.push(dam);
  return dam;
}

function renderCompletedBuildingMarker() {}

function drawWorldBorders() {}
function drawResourceDeposits() {}
function drawRealBuildings() {}
function drawMunicipalities() {}
function drawBorder() {}
function drawWater() {}
function drawRoads() {}
function drawLocalRoads() {}
function drawRail() {}
function drawCities() {}
function drawAirports() {}
function drawPorts() {}
function applyWorldBordersLOD() {}

function renderMap() {
  if (mapEngine) mapEngine._scheduleRender();
}
