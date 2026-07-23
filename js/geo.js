// Geographic helpers: haversine distance, and routing over the real
// OSM-derived road graph (highways + local roads), loaded at runtime.

const EARTH_KM = 6371;

function haversineKm(lat1, lon1, lat2, lon2) {
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.sqrt(a));
}

let ROAD_GRAPH = null;       // nodeId -> [{ to, edge, dist, forward, tier }]
let ROAD_NODES = null;       // nodeId -> [lat, lon]
let ROAD_EDGES_REAL = [];    // highway edges, for rendering
let LOCAL_ROAD_EDGES_REAL = []; // local (primary/secondary) edges, for rendering
let RAIL_LINES = [];         // array of [ [lat,lon], ... ] polylines, rendering-only
let WATER_LINES = [];
let BORDER_RING = [];
let MUNICIPALITIES = [];     // { id, name, centroid, rings }
let CITY_NEAREST_NODE = {};  // cityId -> { nodeId, distKm }
let roadDataReady = false;

const HIGHWAY_SPEED_MULT = 1.0;
const LOCAL_ROAD_SPEED_MULT = 0.65; // local roads are slower than motorways

// Minimal binary min-heap for Dijkstra, keyed by numeric priority.
class MinHeap {
  constructor() { this.items = []; }
  get size() { return this.items.length; }
  push(item, priority) {
    this.items.push({ item, priority });
    let i = this.items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.items[parent].priority <= this.items[i].priority) break;
      [this.items[parent], this.items[i]] = [this.items[i], this.items[parent]];
      i = parent;
    }
  }
  pop() {
    const top = this.items[0];
    const last = this.items.pop();
    if (this.items.length) {
      this.items[0] = last;
      let i = 0;
      while (true) {
        const l = i * 2 + 1, r = i * 2 + 2;
        let smallest = i;
        if (l < this.items.length && this.items[l].priority < this.items[smallest].priority) smallest = l;
        if (r < this.items.length && this.items[r].priority < this.items[smallest].priority) smallest = r;
        if (smallest === i) break;
        [this.items[smallest], this.items[i]] = [this.items[i], this.items[smallest]];
        i = smallest;
      }
    }
    return top ? top.item : undefined;
  }
}

function addGraphEdge(a, b, edge, tier) {
  const A = String(a), B = String(b);
  if (!ROAD_GRAPH[A]) ROAD_GRAPH[A] = [];
  if (!ROAD_GRAPH[B]) ROAD_GRAPH[B] = [];
  // effective weight = real km / speed tier multiplier, so Dijkstra naturally
  // prefers faster roads even if geometrically longer.
  const mult = tier === "local" ? LOCAL_ROAD_SPEED_MULT : HIGHWAY_SPEED_MULT;
  const weight = edge.distKm / mult;
  ROAD_GRAPH[A].push({ to: B, edge, dist: edge.distKm, weight, forward: true, tier });
  ROAD_GRAPH[B].push({ to: A, edge, dist: edge.distKm, weight, forward: false, tier });
}

async function loadRoadNetwork() {
  const [hwRes, localRes] = await Promise.all([
    fetch("data/roads_graph.json"),
    fetch("data/local_roads_graph.json").catch(() => null),
  ]);
  const hw = await hwRes.json();
  ROAD_NODES = Object.assign({}, hw.nodes);
  ROAD_EDGES_REAL = hw.edges;
  ROAD_GRAPH = {};
  hw.edges.forEach(edge => addGraphEdge(edge.a, edge.b, edge, "highway"));

  if (localRes && localRes.ok) {
    const local = await localRes.json();
    Object.assign(ROAD_NODES, local.nodes);
    LOCAL_ROAD_EDGES_REAL = local.edges;
    local.edges.forEach(edge => addGraphEdge(edge.a, edge.b, edge, "local"));
  }

  CITIES.forEach(c => {
    let best = null, bestDist = Infinity;
    for (const nodeId in ROAD_NODES) {
      const [lat, lon] = ROAD_NODES[nodeId];
      const d = haversineKm(c.lat, c.lon, lat, lon);
      if (d < bestDist) { bestDist = d; best = nodeId; }
    }
    CITY_NEAREST_NODE[c.id] = { nodeId: best, distKm: bestDist };
  });

  roadDataReady = true;
}

async function loadRailNetwork() {
  try { RAIL_LINES = (await (await fetch("data/rail_lines.json")).json()).lines; }
  catch (e) { RAIL_LINES = []; }
}
async function loadWaterNetwork() {
  try { WATER_LINES = (await (await fetch("data/water_lines.json")).json()).lines; }
  catch (e) { WATER_LINES = []; }
}
let REAL_BUILDINGS = []; // curated real-world Slovenian buildings (see data/real_buildings.json)
async function loadRealBuildings() {
  try { REAL_BUILDINGS = (await (await fetch("data/real_buildings.json")).json()).buildings; }
  catch (e) { REAL_BUILDINGS = []; }
}
async function loadBorder() {
  try { BORDER_RING = (await (await fetch("data/border.json")).json()).rings[0]; }
  catch (e) { BORDER_RING = []; }
}
async function loadMunicipalities() {
  try { MUNICIPALITIES = await (await fetch("data/municipalities.json")).json(); }
  catch (e) { MUNICIPALITIES = []; }
}

// Real quarries and mines from OSM (data/fetch_resources.js) — actual mapped
// outlines, as opposed to the hand-placed circles in RESOURCE_DEPOSITS, which
// still exist because they carry the resourceId gameplay needs.
let RESOURCE_SITES = [];
async function loadResourceSites() {
  try { RESOURCE_SITES = (await (await fetch("data/resource_sites.json")).json()).sites || []; }
  catch (e) { RESOURCE_SITES = []; }
}

// ---- Relief (digital elevation model, built by data/fetch_elevation.js) -----
// One coarse grid drives two things: the Relief map layer, and how much the
// ground slows a formation down. Terrain difficulty is about SLOPE, not height —
// a high flat plateau is easy going, a 600 m ridge is not — so the movement
// penalty is computed from the gradient between neighbouring cells.
let ELEVATION = null;
async function loadElevation() {
  try { ELEVATION = await (await fetch("data/elevation.json")).json(); }
  catch (e) { ELEVATION = null; }
}

// Metres above sea level at a point (nearest cell), or null outside the grid.
function elevationAt(lat, lon) {
  const g = ELEVATION;
  if (!g) return null;
  const r = Math.round((lat - g.minLat) / g.dLat);
  const c = Math.round((lon - g.minLon) / g.dLon);
  if (r < 0 || c < 0 || r >= g.rows || c >= g.cols) return null;
  return g.alt[r * g.cols + c];
}

// Steepest gradient across the cell, as a rise/run fraction (0.10 = 10% grade).
function slopeAt(lat, lon) {
  const g = ELEVATION;
  if (!g) return 0;
  const r = Math.round((lat - g.minLat) / g.dLat);
  const c = Math.round((lon - g.minLon) / g.dLon);
  if (r < 1 || c < 1 || r >= g.rows - 1 || c >= g.cols - 1) return 0;
  const at = (rr, cc) => g.alt[rr * g.cols + cc];
  // Cell size in metres (latitude is constant, longitude shrinks with cos lat).
  const mLat = g.dLat * 111320;
  const mLon = g.dLon * 111320 * Math.cos(lat * Math.PI / 180);
  const dzdy = (at(r + 1, c) - at(r - 1, c)) / (2 * mLat);
  const dzdx = (at(r, c + 1) - at(r, c - 1)) / (2 * mLon);
  return Math.hypot(dzdx, dzdy);
}

// Terrain class, used for the movement penalty and the relief legend.
//   flat      < 4% grade   — full speed
//   rolling   4-8%         — slight drag
//   hills     8-15%        — noticeably slower
//   mountains > 15%        — slowest
function terrainClass(lat, lon) {
  const s = slopeAt(lat, lon);
  if (s >= 0.15) return "mountains";
  if (s >= 0.08) return "hills";
  if (s >= 0.04) return "rolling";
  return "flat";
}

const TERRAIN_SPEED = { flat: 1.0, rolling: 0.85, hills: 0.6, mountains: 0.35 };

// Speed multiplier for ground movement across this point. Aircraft ignore it.
function terrainSpeedMult(lat, lon) {
  if (!ELEVATION) return 1;
  return TERRAIN_SPEED[terrainClass(lat, lon)] || 1;
}

// ---- Europe-wide backdrop (Natural Earth 10m, built by data/process_world.js)
// Slovenia keeps its full-detail OSM layers; these are the coarse continental
// versions so the country isn't an island of detail in an empty map. Shipping
// OSM-detail data for Europe would be ~13 GB, so "significant roads only" is
// not a shortcut, it's the only workable option.
let WORLD_ROADS = [], WORLD_RAIL = [], WORLD_RIVERS = [], WORLD_URBAN = [];
async function loadWorldRoads() {
  try { WORLD_ROADS = (await (await fetch("data/world_roads.json")).json()).lines; }
  catch (e) { WORLD_ROADS = []; }
}
async function loadWorldRail() {
  try { WORLD_RAIL = (await (await fetch("data/world_rail.json")).json()).lines; }
  catch (e) { WORLD_RAIL = []; }
}
async function loadWorldRivers() {
  try { WORLD_RIVERS = (await (await fetch("data/world_rivers.json")).json()).lines; }
  catch (e) { WORLD_RIVERS = []; }
}
async function loadWorldUrban() {
  try { WORLD_URBAN = (await (await fetch("data/world_urban.json")).json()).rings; }
  catch (e) { WORLD_URBAN = []; }
}

// World country borders (low-res Natural Earth). Bundling the whole world's
// ROAD network is infeasible (gigabytes), but country outlines are small — we
// load them for display and to detect which foreign country a point is in.
let WORLD_COUNTRIES = null;      // GeoJSON features (for drawing)
let NEIGHBOR_POLYGONS = {};      // ITA/AUT/HUN/CRO -> array of rings [[lat,lon],...]

function geojsonToLatLngRings(geom) {
  const rings = [];
  const pushPoly = poly => poly.forEach(r => rings.push(r.map(c => [c[1], c[0]]))); // [lon,lat] -> [lat,lon]
  if (!geom) return rings;
  if (geom.type === "Polygon") pushPoly(geom.coordinates);
  else if (geom.type === "MultiPolygon") geom.coordinates.forEach(pushPoly);
  return rings;
}

async function loadWorldBorders() {
  try {
    // Bundled locally so borders work offline; the remote copy is only a
    // fallback for an install that predates data/world_countries.json.
    let res = await fetch("data/world_countries.json");
    if (!res.ok) res = await fetch("https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson");
    const gj = await res.json();
    WORLD_COUNTRIES = gj.features || [];
    const nameToId = { Italy: "ITA", Austria: "AUT", Hungary: "HUN", Croatia: "CRO" };
    WORLD_COUNTRIES.forEach(f => {
      const p = f.properties || {};
      const nm = p.ADMIN || p.NAME || p.name || p.SOVEREIGNT;
      const id = nameToId[nm];
      if (id) NEIGHBOR_POLYGONS[id] = geojsonToLatLngRings(f.geometry);
    });
  } catch (e) {
    WORLD_COUNTRIES = null; // offline / blocked — foreign detection falls back to the border ring
  }
}

// Which neighbor's territory contains this point (null = Slovenia or beyond).
function countryForPoint(lat, lon) {
  for (const id in NEIGHBOR_POLYGONS) {
    for (const ring of NEIGHBOR_POLYGONS[id]) {
      if (ring.length > 2 && pointInRing([lat, lon], ring)) return id;
    }
  }
  return null;
}

// True if a point is outside Slovenia's own border ring.
function isOutsideSlovenia(lat, lon) {
  if (!BORDER_RING || BORDER_RING.length < 3) return false;
  return !pointInRing([lat, lon], BORDER_RING);
}

// Fold a completed player-built road into the routing graph as a new edge
// between two synthetic node ids (keyed by their coordinates).
function addCustomRoadToGraph(proj, tier) {
  const nodeIdFor = (lat, lon) => `custom_${lat.toFixed(6)}_${lon.toFixed(6)}`;
  const points = proj.points;
  const aId = nodeIdFor(points[0][0], points[0][1]);
  const bId = nodeIdFor(points[points.length - 1][0], points[points.length - 1][1]);
  ROAD_NODES[aId] = points[0];
  ROAD_NODES[bId] = points[points.length - 1];
  let dist = 0;
  for (let i = 0; i < points.length - 1; i++) dist += haversineKm(points[i][0], points[i][1], points[i + 1][0], points[i + 1][1]);
  const edge = { a: aId, b: bId, distKm: dist, points };
  addGraphEdge(aId, bId, edge, tier === "local" ? "local" : "highway");

  // re-snap any city that's now closer to this new road than its old nearest node
  CITIES.forEach(c => {
    const dA = haversineKm(c.lat, c.lon, points[0][0], points[0][1]);
    const dB = haversineKm(c.lat, c.lon, points[points.length - 1][0], points[points.length - 1][1]);
    const best = Math.min(dA, dB);
    if (best < (CITY_NEAREST_NODE[c.id] ? CITY_NEAREST_NODE[c.id].distKm : Infinity)) {
      CITY_NEAREST_NODE[c.id] = { nodeId: dA < dB ? aId : bId, distKm: best };
    }
  });
}

// Dijkstra shortest path (by time-weighted cost) between two graph node ids.
function dijkstraNodes(fromNode, toNode) {
  const dist = {}, prev = {};
  const visited = new Set();
  const heap = new MinHeap();
  dist[fromNode] = 0;
  heap.push(fromNode, 0);

  while (heap.size) {
    const u = heap.pop();
    if (visited.has(u)) continue;
    visited.add(u);
    if (u === toNode) break;
    for (const link of ROAD_GRAPH[u] || []) {
      if (visited.has(link.to)) continue;
      const alt = dist[u] + link.weight;
      if (dist[link.to] === undefined || alt < dist[link.to]) {
        dist[link.to] = alt;
        prev[link.to] = { from: u, link };
        heap.push(link.to, alt);
      }
    }
  }

  if (!(toNode in prev) && fromNode !== toNode) return null;
  const hops = [];
  let cur = toNode;
  while (cur !== fromNode) {
    const p = prev[cur];
    if (!p) return null;
    hops.unshift(p.link);
    cur = p.from;
  }
  return hops;
}

// Nearest road-graph node to an arbitrary point (not tied to a known city).
// Used to make routing work between ANY two map points, not just named
// cities — critical now that waypoints mostly come from municipality/map
// clicks rather than clicking a specific city.
function nearestRoadNode(lat, lon) {
  let best = null, bestDist = Infinity;
  for (const id in ROAD_NODES) {
    const [la, lo] = ROAD_NODES[id];
    const d = haversineKm(lat, lon, la, lo);
    if (d < bestDist) { bestDist = d; best = id; }
  }
  return best ? { nodeId: best, distKm: bestDist } : null;
}

// Route between two lat/lon points: connector to nearest road node, shortest
// path along the real road graph, connector from road node to destination.
// The "last mile" connector is only tagged onRoad if it's short (< 3km) —
// otherwise that stretch is genuinely off-road and gets the off-road speed
// penalty rather than a free pass.
function findRoute(fromPoint, toPoint) {
  if (!roadDataReady) return null;
  if (haversineKm(fromPoint.lat, fromPoint.lon, toPoint.lat, toPoint.lon) < 0.05) return [];

  const fromNode = nearestRoadNode(fromPoint.lat, fromPoint.lon);
  const toNode = nearestRoadNode(toPoint.lat, toPoint.lon);
  if (!fromNode || !toNode) return null;

  const hops = dijkstraNodes(fromNode.nodeId, toNode.nodeId);
  if (!hops) return null;

  const points = [];
  points.push({ lat: fromPoint.lat, lon: fromPoint.lon, onRoad: fromNode.distKm < 3, cityId: null });
  const entryLL = ROAD_NODES[fromNode.nodeId];
  points.push({ lat: entryLL[0], lon: entryLL[1], onRoad: fromNode.distKm < 3, cityId: null });

  hops.forEach(hop => {
    let pts = hop.edge.points.slice();
    if (!hop.forward) pts = pts.slice().reverse();
    const speedMult = hop.tier === "local" ? LOCAL_ROAD_SPEED_MULT : HIGHWAY_SPEED_MULT;
    pts.forEach(p => points.push({ lat: p[0], lon: p[1], onRoad: true, roadSpeedMult: speedMult, cityId: null }));
  });

  const exitLL = ROAD_NODES[toNode.nodeId];
  points.push({ lat: exitLL[0], lon: exitLL[1], onRoad: toNode.distKm < 3, cityId: null });
  points.push({ lat: toPoint.lat, lon: toPoint.lon, onRoad: toNode.distKm < 3, cityId: toPoint.cityId || null });

  return points;
}

// Area of a lat/lon polygon in km² (equirectangular around its mean latitude).
function polygonAreaKm2(ring) {
  if (!ring || ring.length < 3) return 0;
  const latMean = ring.reduce((s, p) => s + p[0], 0) / ring.length;
  const kLat = 110.574, kLon = 111.320 * Math.cos(latMean * Math.PI / 180);
  let area = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][1] * kLon, yi = ring[i][0] * kLat;
    const xj = ring[j][1] * kLon, yj = ring[j][0] * kLat;
    area += (xj * yi - xi * yj);
  }
  return Math.abs(area / 2);
}

// Point-in-polygon (ray casting), pt = [lat, lon], ring = [[lat,lon],...]
function pointInRing(pt, ring) {
  const [y, x] = pt;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [yi, xi] = ring[i], [yj, xj] = ring[j];
    const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function municipalityAt(lat, lon) {
  for (const m of MUNICIPALITIES) {
    for (const ring of m.rings) {
      if (pointInRing([lat, lon], ring)) return m;
    }
  }
  return null;
}

// ---- Per-municipality stats (estimates for the ~200 municipalities that
// aren't gameplay cities) ----
function municipalityAreaKm2(m) {
  if (m._areaKm2) return m._areaKm2;
  let area = 0;
  for (const ring of m.rings) {
    let s = 0;
    for (let i = 0; i < ring.length; i++) {
      const [la1, lo1] = ring[i], [la2, lo2] = ring[(i + 1) % ring.length];
      s += (lo1 * la2 - lo2 * la1);
    }
    // deg² → km² at Slovenia's latitude (111 km/deg lat, ~77 km/deg lon)
    area += Math.abs(s / 2) * 111 * 77.2;
  }
  m._areaKm2 = area;
  return area;
}

// Population estimate: gameplay cities inside the polygon count in full;
// the rest of the area gets a realistic rural/small-town density.
function municipalityPopEstimate(m) {
  if (m._popEst) return m._popEst;
  const inside = CITIES.filter(c => m.rings.some(r => pointInRing([c.lat, c.lon], r)));
  const area = municipalityAreaKm2(m);
  const density = inside.length ? 38 : 62; // city already counted → rural remainder only
  m._popEst = Math.max(350, inside.reduce((s, c) => s + c.pop, 0) + Math.round(area * density));
  return m._popEst;
}

// Local flavor stats: anchored to the nearest gameplay city's economy with a
// small deterministic per-municipality offset so neighboring municipalities
// don't all read identically.
function municipalityStats(m) {
  const near = nearestCityTo(m.centroid[0], m.centroid[1]);
  const base = state.cityStats[near.id] || { happiness: state.econ.stability, avgSalary: 0 };
  const jitter = ((m.id % 13) - 6) / 6; // -1..+1, stable per municipality
  return {
    pop: municipalityPopEstimate(m),
    areaKm2: municipalityAreaKm2(m),
    happiness: clamp(base.happiness + jitter * 4, 0, 100),
    avgSalary: base.avgSalary * (1 + jitter * 0.07),
    unemployment: clamp(state.econ.unemploymentRate * (1 - jitter * 0.15), 1, 40),
    nearestCity: near,
  };
}

// Nearest CITIES entry to a lat/lon (used to tie a municipality to the
// closest known city for build/deploy purposes).
function nearestCityTo(lat, lon) {
  let best = null, bestDist = Infinity;
  CITIES.forEach(c => {
    const d = haversineKm(lat, lon, c.lat, c.lon);
    if (d < bestDist) { bestDist = d; best = c; }
  });
  return best;
}
