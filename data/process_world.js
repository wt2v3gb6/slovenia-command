// Build the Europe-wide backdrop layers from Natural Earth 10m source data.
//
// WHY NATURAL EARTH AND NOT OSM: Slovenia's OSM extract is 27 MB of vector data
// for 20,273 km². At that density Europe would be ~13 GB and the world ~194 GB,
// which is obviously not shippable (and would not render either). Natural Earth
// 10m carries only significant roads/railways/rivers, which is exactly the right
// level of detail for everything outside the player's own country — Slovenia
// keeps its full-detail OSM layers on top.
//
// Usage:  node data/process_world.js <dir-with-ne-geojson>
// Writes: data/world_roads.json, world_rail.json, world_rivers.json,
//         world_urban.json
//
// Output format matches the existing layers: { lines: [ [ [lat,lon], ... ] ] }
// for line work, { rings: [...] } for the urban polygons.

const fs = require("fs");
const path = require("path");

// Europe + a margin, so the map has context well past any playable area.
const BBOX = { lonMin: -25, lonMax: 45, latMin: 33, latMax: 72 };
// 4 decimal places ≈ 11 m — far finer than these datasets are actually accurate
// to, and it roughly halves the file size versus full float precision.
const DP = 4;

function round(v) { return Math.round(v * 1e4) / 1e4; }

function inBox(lon, lat) {
  return lon >= BBOX.lonMin && lon <= BBOX.lonMax && lat >= BBOX.latMin && lat <= BBOX.latMax;
}

// Keep a whole feature if any vertex falls inside the box (no true clipping —
// a few trailing vertices outside the frame cost nothing and avoid seams).
function coordsToLatLng(coords, out) {
  let any = false;
  const line = [];
  for (const c of coords) {
    const lon = c[0], lat = c[1];
    if (inBox(lon, lat)) any = true;
    line.push([round(lat), round(lon)]);
  }
  if (any && line.length > 1) out.push(line);
}

function walk(geom, out) {
  if (!geom) return;
  switch (geom.type) {
    case "LineString": coordsToLatLng(geom.coordinates, out); break;
    case "MultiLineString": geom.coordinates.forEach(l => coordsToLatLng(l, out)); break;
    case "Polygon": geom.coordinates.forEach(r => coordsToLatLng(r, out)); break;
    case "MultiPolygon": geom.coordinates.forEach(p => p.forEach(r => coordsToLatLng(r, out))); break;
  }
}

function build(srcFile, destFile, key, filter) {
  if (!fs.existsSync(srcFile)) { console.log("SKIP (missing):", srcFile); return; }
  const gj = JSON.parse(fs.readFileSync(srcFile, "utf8"));
  const out = [];
  let kept = 0;
  for (const f of gj.features || []) {
    if (filter && !filter(f.properties || {})) continue;
    const before = out.length;
    walk(f.geometry, out);
    if (out.length > before) kept++;
  }
  const payload = {};
  payload[key] = out;
  fs.writeFileSync(destFile, JSON.stringify(payload));
  const mb = (fs.statSync(destFile).size / 1048576).toFixed(2);
  const verts = out.reduce((s, l) => s + l.length, 0);
  console.log(`${path.basename(destFile)}: ${kept} features, ${out.length} lines, ${verts} verts, ${mb} MB`);
}

const src = process.argv[2];
if (!src) { console.error("usage: node data/process_world.js <dir-with-ne-geojson>"); process.exit(1); }
const dest = __dirname;

// Roads: drop the very lowest-importance classes, they add bulk without reading
// at the zooms this layer is visible at.
build(path.join(src, "ne_10m_roads.geojson"), path.join(dest, "world_roads.json"), "lines",
  p => !p.scalerank || p.scalerank <= 9);
build(path.join(src, "ne_10m_railroads.geojson"), path.join(dest, "world_rail.json"), "lines", null);
build(path.join(src, "ne_10m_rivers_lake_centerlines.geojson"), path.join(dest, "world_rivers.json"), "lines", null);
build(path.join(src, "ne_10m_urban_areas.geojson"), path.join(dest, "world_urban.json"), "rings", null);
