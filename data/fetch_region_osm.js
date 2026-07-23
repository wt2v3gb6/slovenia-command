// Fetch EXACT road/rail/river/urban geometry from OpenStreetMap (via Overpass)
// for the region around Slovenia, replacing the Natural Earth approximations.
//
// WHY: Natural Earth 10m is cartographic generalisation — a motorway can sit a
// kilometre off its true line and a river is a smooth suggestion of its course.
// OSM is survey-grade, and it's the same source Slovenia's own layers already
// use, so the whole map ends up at one level of truth instead of two.
//
// WHY TILED: the public Overpass instances time out (504) on a request this
// large, so the bbox is split into ~0.8° x 1.2° tiles and fetched one at a time.
// Every tile is cached under data/.osmcache/, so re-running after a failure
// resumes instead of starting over. Overpass is a free shared service — this
// deliberately runs sequentially with pauses rather than hammering it.
//
// Usage:  node data/fetch_region_osm.js [--bbox=S,W,N,E] [--only=roads,rail,...]
// Writes: data/world_roads.json, world_rail.json, world_rivers.json,
//         world_urban.json  (the format the game already loads)

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

// Slovenia plus ~100-150 km of every neighbour — the area a game set in
// Slovenia can plausibly reach.
let BBOX = [45.0, 12.6, 47.3, 17.2]; // S, W, N, E
const bboxArg = process.argv.find(a => a.startsWith("--bbox="));
if (bboxArg) BBOX = bboxArg.slice(7).split(",").map(Number);
const onlyArg = process.argv.find(a => a.startsWith("--only="));
const ONLY = onlyArg ? onlyArg.slice(7).split(",") : null;

const TILE_LAT = 0.8, TILE_LON = 1.2; // sized so a tile completes well under the timeout
const DP = 5;                          // ~1 m — OSM deserves the precision
const CACHE = path.join(__dirname, ".osmcache");

const round = v => Math.round(v * 1e5) / 1e5;
const sleep = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

const LAYERS = {
  roads: { file: "world_roads.json", key: "lines",
    filter: `way["highway"~"^(motorway|trunk|primary|secondary)$"]` },
  rail: { file: "world_rail.json", key: "lines",
    filter: `way["railway"~"^(rail|light_rail|narrow_gauge)$"]["service"!~"."]` },
  rivers: { file: "world_rivers.json", key: "lines",
    filter: `way["waterway"~"^(river|canal)$"]` },
  urban: { file: "world_urban.json", key: "rings",
    filter: `way["landuse"~"^(residential|commercial|industrial|retail)$"]` },
};

function tiles() {
  const [S, W, N, E] = BBOX;
  const out = [];
  for (let lat = S; lat < N; lat += TILE_LAT) {
    for (let lon = W; lon < E; lon += TILE_LON) {
      out.push([+lat.toFixed(3), +lon.toFixed(3),
                +Math.min(lat + TILE_LAT, N).toFixed(3), +Math.min(lon + TILE_LON, E).toFixed(3)]);
    }
  }
  return out;
}

// curl, not fetch(): Overpass rejects Node's default user-agent with a 406.
function fetchTile(filter, [s, w, n, e], cacheFile) {
  // Validate the CONTENT of a cached tile, not just its size: Overpass answers
  // an overloaded request with a multi-KB XML error page, and trusting that on
  // the resume path crashed the whole run on a tile that had "already been
  // fetched". Anything that isn't JSON gets thrown away and re-requested.
  if (fs.existsSync(cacheFile)) {
    const cached = fs.readFileSync(cacheFile, "utf8");
    if (cached.startsWith("{")) return JSON.parse(cached);
    fs.unlinkSync(cacheFile);
  }
  const ql = `[out:json][timeout:600];\n${filter}(${s},${w},${n},${e});\nout geom;`;
  const qlFile = cacheFile + ".ql";
  fs.writeFileSync(qlFile, ql);
  for (let attempt = 1; attempt <= 3; attempt++) {
    for (const url of ENDPOINTS) {
      try {
        execFileSync("curl", ["-s", "--compressed", "-A", "SloveniaCommand/1.0 (map build)",
          "-X", "POST", "--data-urlencode", "data@" + qlFile, url,
          "-o", cacheFile, "--max-time", "700"], { stdio: "ignore" });
        const txt = fs.readFileSync(cacheFile, "utf8");
        if (txt.startsWith("{")) { fs.unlinkSync(qlFile); return JSON.parse(txt); }
      } catch (err) { /* fall through to the next endpoint */ }
      sleep(4000 * attempt);
    }
  }
  try { fs.unlinkSync(cacheFile); } catch (e) {}
  throw new Error(`tile ${s},${w},${n},${e} failed on every endpoint`);
}

// Overpass `out geom` puts geometry inline on each way as [{lat,lon},...].
function waysToLines(json, seen, out) {
  for (const el of json.elements || []) {
    const g = el.geometry;
    if (!g || g.length < 2) continue;
    if (seen.has(el.id)) continue; // ways on a tile seam come back twice
    seen.add(el.id);
    const line = new Array(g.length);
    for (let i = 0; i < g.length; i++) line[i] = [round(g[i].lat), round(g[i].lon)];
    out.push(line);
  }
}

function main() {
  fs.mkdirSync(CACHE, { recursive: true });
  const tl = tiles();
  console.log(`Region ${BBOX.join(",")} -> ${tl.length} tiles`);

  for (const [name, def] of Object.entries(LAYERS)) {
    if (ONLY && !ONLY.includes(name)) continue;
    const lines = [], seen = new Set();
    console.log(`\n${name}:`);
    tl.forEach((t, i) => {
      const cacheFile = path.join(CACHE, `${name}_${t.join("_")}.json`);
      process.stdout.write(`  tile ${i + 1}/${tl.length} `);
      const json = fetchTile(def.filter, t, cacheFile);
      const before = lines.length;
      waysToLines(json, seen, lines);
      console.log(`+${lines.length - before} ways`);
      sleep(3000);
    });
    // Merge in the Natural Earth backdrop for everything OUTSIDE the OSM box.
    // Without this, replacing NE would leave the rest of the continent empty;
    // with it, the layer is survey-grade where you play and still has context to
    // the horizon. Features are dropped rather than clipped — a line straddling
    // the boundary is kept from whichever set covers its midpoint.
    const neFile = path.join(__dirname, def.file.replace(".json", "_ne.json"));
    let neAdded = 0;
    if (fs.existsSync(neFile)) {
      const ne = JSON.parse(fs.readFileSync(neFile, "utf8"))[def.key] || [];
      const [S, W, N, E] = BBOX;
      for (const line of ne) {
        const m = line[Math.floor(line.length / 2)];
        if (m && m[0] >= S && m[0] <= N && m[1] >= W && m[1] <= E) continue; // OSM owns this area
        lines.push(line);
        neAdded++;
      }
    }

    const payload = {};
    payload[def.key] = lines;
    const dest = path.join(__dirname, def.file);
    fs.writeFileSync(dest, JSON.stringify(payload));
    const verts = lines.reduce((s, l) => s + l.length, 0);
    console.log(`  -> ${def.file}: ${lines.length} ways (${neAdded} from Natural Earth outside the region), ${verts} verts, ${(fs.statSync(dest).size / 1048576).toFixed(2)} MB`);
  }
  console.log("\nDone. Delete data/.osmcache once happy, then rebuild the exe.");
}

main();
