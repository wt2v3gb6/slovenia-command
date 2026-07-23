// Assemble OSM multipolygon relations (way members with role=outer, possibly
// split into several arcs) into closed ring polygons.

const fs = require("fs");

function assembleRings(ways) {
  // ways: array of arrays of [lat,lon], each an open or closed arc.
  const remaining = ways.map(w => w.slice());
  const rings = [];
  while (remaining.length) {
    let ring = remaining.shift();
    let changed = true;
    while (changed && !pointsEqual(ring[0], ring[ring.length - 1])) {
      changed = false;
      for (let i = 0; i < remaining.length; i++) {
        const w = remaining[i];
        if (pointsEqual(ring[ring.length - 1], w[0])) {
          ring = ring.concat(w.slice(1));
          remaining.splice(i, 1); changed = true; break;
        } else if (pointsEqual(ring[ring.length - 1], w[w.length - 1])) {
          ring = ring.concat(w.slice().reverse().slice(1));
          remaining.splice(i, 1); changed = true; break;
        } else if (pointsEqual(ring[0], w[w.length - 1])) {
          ring = w.slice(0, -1).concat(ring);
          remaining.splice(i, 1); changed = true; break;
        } else if (pointsEqual(ring[0], w[0])) {
          ring = w.slice().reverse().slice(0, -1).concat(ring);
          remaining.splice(i, 1); changed = true; break;
        }
      }
    }
    rings.push(ring);
  }
  return rings;
}

function pointsEqual(a, b) { return a[0] === b[0] && a[1] === b[1]; }

function loadElements(file) {
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  const nodeLL = {};
  const wayNodeIds = {};
  const relations = [];
  raw.elements.forEach(el => {
    if (el.type === "node") nodeLL[el.id] = [el.lat, el.lon];
    else if (el.type === "way") wayNodeIds[el.id] = el.nodes;
    else if (el.type === "relation") relations.push(el);
  });
  return { nodeLL, wayNodeIds, relations };
}

function relationToRings({ nodeLL, wayNodeIds }, relation) {
  const outerWays = relation.members
    .filter(m => m.type === "way" && (m.role === "outer" || m.role === ""))
    .map(m => (wayNodeIds[m.ref] || []).map(id => nodeLL[id]).filter(Boolean))
    .filter(pts => pts.length >= 2);
  return assembleRings(outerWays).filter(r => r.length >= 4);
}

// Douglas-Peucker simplification to keep ring point counts renderable.
function perpDist(p, a, b) {
  const [x, y] = [p[1], p[0]], [x1, y1] = [a[1], a[0]], [x2, y2] = [b[1], b[0]];
  const dx = x2 - x1, dy = y2 - y1;
  if (dx === 0 && dy === 0) return Math.hypot(x - x1, y - y1);
  const t = ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy);
  const tt = Math.max(0, Math.min(1, t));
  return Math.hypot(x - (x1 + tt * dx), y - (y1 + tt * dy));
}
function simplify(points, tolerance) {
  if (points.length < 3) return points;
  let maxDist = 0, idx = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const d = perpDist(points[i], points[0], points[points.length - 1]);
    if (d > maxDist) { maxDist = d; idx = i; }
  }
  if (maxDist > tolerance) {
    const left = simplify(points.slice(0, idx + 1), tolerance);
    const right = simplify(points.slice(idx), tolerance);
    return left.slice(0, -1).concat(right);
  }
  return [points[0], points[points.length - 1]];
}

module.exports = { loadElements, relationToRings, assembleRings, simplify };

if (require.main === module) {
  const { nodeLL, wayNodeIds, relations } = loadElements(process.argv[2]);
  const rel = relations[0];
  const rings = relationToRings({ nodeLL, wayNodeIds }, rel).map(r => simplify(r, 0.0008));
  const out = { name: rel.tags && rel.tags.name, rings };
  fs.writeFileSync(process.argv[3], JSON.stringify(out));
  console.log(`${process.argv[3]}: ${rings.length} ring(s), largest ${Math.max(...rings.map(r => r.length))} points (simplified)`);
}
