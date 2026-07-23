// Build the relief grid: a coarse digital elevation model over Slovenia and its
// surroundings, used for BOTH the Relief map layer and the terrain movement
// penalty (troops slow on hills, slow further in mountains).
//
// Source: Open-Meteo's elevation endpoint (Copernicus DEM GLO-90 underneath),
// which is free, keyless, and accepts batches of 100 coordinates.
//
// Resolution is deliberately coarse — ~2.2 km cells. Movement cares about the
// character of the ground a formation crosses, not individual gullies, and this
// keeps the whole grid to a few tens of KB so it costs nothing to ship or query.
//
// Usage:  node data/fetch_elevation.js
// Writes: data/elevation.json  { minLat, minLon, dLat, dLon, rows, cols, alt[] }

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const MIN_LAT = 45.30, MAX_LAT = 47.00;
const MIN_LON = 13.20, MAX_LON = 16.70;
const STEP = 0.02;                 // ~2.2 km
const BATCH = 100;                 // Open-Meteo's per-request limit
const OUT = path.join(__dirname, "elevation.json");

const sleep = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// Fetch one batch and PROVE it came back complete. Open-Meteo answers a
// rate-limited request with HTTP 200 and a JSON error object, so "parsed as
// JSON" is not evidence of success — an earlier version of this script accepted
// those and silently wrote a grid that was 93% zeros. Nothing is returned unless
// there are exactly as many elevations as coordinates asked for.
function getBatch(url, expected) {
  let reason = "";
  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      const txt = execFileSync("curl", ["-s", "--compressed", "--max-time", "60", url],
        { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
      if (txt.startsWith("{")) {
        const json = JSON.parse(txt);
        if (Array.isArray(json.elevation) && json.elevation.length === expected &&
            json.elevation.every(v => typeof v === "number" && isFinite(v))) {
          return json.elevation;
        }
        reason = json.reason || json.error || `got ${(json.elevation || []).length}/${expected}`;
      }
    } catch (e) { reason = e.message; }
    sleep(5000 * attempt); // rate limits need real backoff, not a token pause
  }
  throw new Error(`elevation batch failed after 6 tries: ${reason}`);
}

function main() {
  const rows = Math.round((MAX_LAT - MIN_LAT) / STEP) + 1;
  const cols = Math.round((MAX_LON - MIN_LON) / STEP) + 1;
  const total = rows * cols;
  console.log(`Grid ${rows} x ${cols} = ${total} samples at ${STEP}° (~${Math.round(STEP * 111)} km)`);

  // Flatten to a row-major list of coordinates, then walk it in batches.
  const alt = new Array(total).fill(0);
  let done = 0;
  for (let start = 0; start < total; start += BATCH) {
    const lats = [], lons = [];
    for (let i = start; i < Math.min(start + BATCH, total); i++) {
      const r = Math.floor(i / cols), c = i % cols;
      lats.push((MIN_LAT + r * STEP).toFixed(4));
      lons.push((MIN_LON + c * STEP).toFixed(4));
    }
    const url = `https://api.open-meteo.com/v1/elevation?latitude=${lats.join(",")}&longitude=${lons.join(",")}`;
    const e = getBatch(url, lats.length);
    for (let k = 0; k < e.length; k++) alt[start + k] = Math.round(e[k]);
    done += e.length;
    if ((start / BATCH) % 20 === 0) console.log(`  ${done}/${total}`);
    sleep(1200); // ~50 req/min — comfortably inside the free minutely limit
  }
  if (done !== total) throw new Error(`incomplete grid: ${done}/${total}`);

  fs.writeFileSync(OUT, JSON.stringify({
    minLat: MIN_LAT, minLon: MIN_LON, dLat: STEP, dLon: STEP, rows, cols, alt,
  }));
  const mb = (fs.statSync(OUT).size / 1048576).toFixed(2);
  const max = Math.max(...alt), min = Math.min(...alt);
  console.log(`Done -> data/elevation.json (${mb} MB), range ${min}..${max} m`);
}

main();
