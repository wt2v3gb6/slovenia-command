// Build a simplified, routable road graph from raw Overpass OSM data.
// Collapses shape-only (degree-2, single-way) nodes into single edges so the
// resulting graph is small enough for browser-side Dijkstra, while keeping
// the full real geometry (and real cumulative distance) on each edge so
// rendering stays pixel-accurate to the actual road.

const fs = require("fs");
const path = require("path");

const EARTH_KM = 6371;
function haversineKm(lat1, lon1, lat2, lon2) {
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.sqrt(a));
}

function processFile(inFile, outFile, { buildGraph }) {
  const raw = JSON.parse(fs.readFileSync(inFile, "utf8"));
  const nodeLL = {};
  const ways = [];

  raw.elements.forEach(el => {
    if (el.type === "node") nodeLL[el.id] = [el.lat, el.lon];
    else if (el.type === "way") ways.push(el.nodes);
  });

  if (!buildGraph) {
    // Rendering-only dataset (e.g. railways): just emit line geometries.
    const lines = ways
      .map(nodeIds => nodeIds.map(id => nodeLL[id]).filter(Boolean))
      .filter(pts => pts.length >= 2);
    fs.writeFileSync(outFile, JSON.stringify({ lines }));
    console.log(`${outFile}: ${lines.length} lines`);
    return;
  }

  // Degree + way-membership count per node, to find real junctions/endpoints.
  const neighborSets = {};   // nodeId -> Set of neighbor nodeIds
  const wayCount = {};       // nodeId -> number of distinct ways referencing it

  ways.forEach(nodeIds => {
    const seenInThisWay = new Set();
    for (let i = 0; i < nodeIds.length; i++) {
      const id = nodeIds[i];
      if (!neighborSets[id]) neighborSets[id] = new Set();
      if (!seenInThisWay.has(id)) { wayCount[id] = (wayCount[id] || 0) + 1; seenInThisWay.add(id); }
      if (i > 0) neighborSets[id].add(nodeIds[i - 1]);
      if (i < nodeIds.length - 1) neighborSets[id].add(nodeIds[i + 1]);
    }
  });

  // Degree is computed from the merged neighbor set across ALL ways, so a
  // node that's simply where OSM happened to split one physical road into
  // two way objects (common: bridges, tunnels, tag changes) still nets out
  // to degree 2 and gets collapsed. Only real branches/dead-ends (degree
  // != 2) are kept.
  const isKeep = id => (neighborSets[id] || new Set()).size !== 2;

  const graphNodes = {};   // id -> [lat, lon]  (only "keep" nodes)
  const edgeMap = new Map(); // "a|b" -> { a, b, distKm, points }

  ways.forEach(nodeIds => {
    let segStart = 0;
    for (let i = 1; i < nodeIds.length; i++) {
      const id = nodeIds[i];
      const isLast = i === nodeIds.length - 1;
      if (isKeep(id) || isLast) {
        const startId = nodeIds[segStart];
        const endId = id;
        if (!nodeLL[startId] || !nodeLL[endId] || startId === endId) { segStart = i; continue; }
        const segPointsIds = nodeIds.slice(segStart, i + 1);
        const points = segPointsIds.map(nid => nodeLL[nid]).filter(Boolean);
        if (points.length < 2) { segStart = i; continue; }
        let dist = 0;
        for (let k = 0; k < points.length - 1; k++) {
          dist += haversineKm(points[k][0], points[k][1], points[k + 1][0], points[k + 1][1]);
        }
        graphNodes[startId] = nodeLL[startId];
        graphNodes[endId] = nodeLL[endId];
        const key = startId < endId ? `${startId}|${endId}` : `${endId}|${startId}`;
        if (!edgeMap.has(key) || edgeMap.get(key).distKm > dist) {
          edgeMap.set(key, { a: startId, b: endId, distKm: dist, points });
        }
        segStart = i;
      }
    }
  });

  const edges = Array.from(edgeMap.values());
  fs.writeFileSync(outFile, JSON.stringify({ nodes: graphNodes, edges }));
  console.log(`${outFile}: ${Object.keys(graphNodes).length} graph nodes, ${edges.length} edges (from ${Object.keys(nodeLL).length} raw nodes, ${ways.length} ways)`);
}

const dataDir = __dirname;

if (require.main === module && process.argv[2]) {
  // CLI: node process_roads.js <in.json> <out.json> [graph|lines]
  processFile(process.argv[2], process.argv[3], { buildGraph: process.argv[4] !== "lines" });
} else if (require.main === module) {
  processFile(path.join(dataDir, "roads_raw.json"), path.join(dataDir, "roads_graph.json"), { buildGraph: true });
  const railRawPath = path.join(dataDir, "rail_raw.json");
  if (fs.existsSync(railRawPath)) {
    processFile(railRawPath, path.join(dataDir, "rail_lines.json"), { buildGraph: false });
  } else {
    console.log("rail_raw.json not present yet, skipping rail processing.");
  }
}
