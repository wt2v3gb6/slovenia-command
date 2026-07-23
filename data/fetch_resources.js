// Fetch REAL extraction sites from OpenStreetMap — quarries, mines and
// mineshafts with their actual mapped outlines, replacing the hand-placed
// circles that only approximated where Slovenia's resources are.
//
// The hand-written RESOURCE_DEPOSITS list in data.js still drives gameplay (it
// carries the resourceId a mine/quarry building needs). This adds the true
// footprints on top, so the Resources layer shows the real pits and adits rather
// than a ring drawn around a guessed centre.
//
// Usage:  node data/fetch_resources.js
// Writes: data/resource_sites.json  { sites: [{ kind, name, resource, rings }] }

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];
const BBOX = [45.35, 13.30, 46.95, 16.65]; // Slovenia + a margin
const OUT = path.join(__dirname, "resource_sites.json");
const round = v => Math.round(v * 1e5) / 1e5;
const sleep = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// Map OSM's free-form resource tags onto the game's resource ids.
function resourceFor(tags) {
  const t = (tags.resource || tags.mineral || tags["quarry:resource"] || "").toLowerCase();
  if (/coal|lignite/.test(t)) return "coal";
  if (/mercury|cinnabar/.test(t)) return "mercury";
  if (/lead|zinc|galena/.test(t)) return "leadzinc";
  if (/gas|oil|petrol/.test(t)) return "gas";
  if (/salt|halite/.test(t)) return "salt";
  if (/limestone|marble|granite|stone|gravel|sand|dolomite|aggregate/.test(t)) return "stone";
  if (tags.landuse === "quarry") return "stone"; // untagged quarries are almost always aggregate
  return null;
}

function fetchOverpass(ql) {
  const qf = path.join(__dirname, ".resq.ql");
  fs.writeFileSync(qf, ql);
  for (let attempt = 1; attempt <= 4; attempt++) {
    for (const url of ENDPOINTS) {
      try {
        const txt = execFileSync("curl", ["-s", "--compressed", "-A", "SloveniaCommand/1.0 (map build)",
          "-X", "POST", "--data-urlencode", "data@" + qf, url, "--max-time", "600"],
          { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 });
        if (txt.startsWith("{")) { fs.unlinkSync(qf); return JSON.parse(txt); }
      } catch (e) { /* try the next mirror */ }
      sleep(5000 * attempt);
    }
  }
  throw new Error("overpass failed for resource sites");
}

function main() {
  const [S, W, N, E] = BBOX;
  const bb = `(${S},${W},${N},${E})`;
  const ql = `[out:json][timeout:600];
(
  way["landuse"="quarry"]${bb};
  way["man_made"="mineshaft"]${bb};
  way["historic"="mine"]${bb};
  way["industrial"="mine"]${bb};
  node["man_made"="mineshaft"]${bb};
  node["historic"="mine"]${bb};
);
out geom;`;

  console.log("Fetching quarries & mines…");
  const json = fetchOverpass(ql);

  const sites = [];
  for (const el of json.elements || []) {
    const tags = el.tags || {};
    const resource = resourceFor(tags);
    const name = tags.name || (tags.landuse === "quarry" ? "Quarry" : "Mine");
    const kind = tags.landuse === "quarry" ? "quarry" : "mine";
    if (el.type === "node") {
      if (el.lat == null) continue;
      sites.push({ kind, name, resource, lat: round(el.lat), lon: round(el.lon) });
    } else if (el.geometry && el.geometry.length >= 3) {
      const ring = el.geometry.map(g => [round(g.lat), round(g.lon)]);
      // Centroid so the label has somewhere to sit without recomputing in-game.
      let la = 0, lo = 0;
      for (const p of ring) { la += p[0]; lo += p[1]; }
      sites.push({ kind, name, resource, lat: round(la / ring.length), lon: round(lo / ring.length), ring });
    }
  }

  fs.writeFileSync(OUT, JSON.stringify({ sites }));
  const withShape = sites.filter(s => s.ring).length;
  console.log(`-> resource_sites.json: ${sites.length} sites (${withShape} with real outlines), ` +
    `${(fs.statSync(OUT).size / 1048576).toFixed(2)} MB`);
}

main();
