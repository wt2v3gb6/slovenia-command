// Local satellite-tile cache/proxy. Both the dev server (server.js) and the
// packaged app (electron-main.js) route map tiles through this instead of
// hitting Esri directly on every pan/zoom. First view of a tile downloads it
// and writes it to disk; every view after that is served from local disk (and
// the browser's own HTTP cache, via the long max-age header) — so re-zooming
// an area you've already seen costs no network and far less CPU, and works
// offline once cached.

const fs = require("fs");
const path = require("path");
const https = require("https");

// Short name -> upstream tile URL builder. Same imagery the game always used.
const SOURCES = {
  imagery: (z, y, x) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`,
  hillshade: (z, y, x) => `https://server.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade/MapServer/tile/${z}/${y}/${x}`,
};

// In-flight fetches, so concurrent requests for the same tile share one download.
const inflight = new Map();

function fetchUpstream(url) {
  if (inflight.has(url)) return inflight.get(url);
  const p = new Promise((resolve, reject) => {
    https.get(url, { headers: { "User-Agent": "SloveniaCommand/1.0" } }, (up) => {
      if (up.statusCode !== 200) { up.resume(); reject(new Error("upstream " + up.statusCode)); return; }
      const chunks = [];
      up.on("data", (c) => chunks.push(c));
      up.on("end", () => resolve({ buf: Buffer.concat(chunks), type: up.headers["content-type"] || "image/jpeg" }));
    }).on("error", reject);
  }).finally(() => inflight.delete(url));
  inflight.set(url, p);
  return p;
}

// Returns handleTile(req, res, urlPath) -> true if it handled a /tiles/ request.
function makeTileHandler(cacheDir) {
  try { fs.mkdirSync(cacheDir, { recursive: true }); } catch (e) {}
  return function handleTile(req, res, urlPath) {
    const m = urlPath.match(/^\/tiles\/([a-z]+)\/(\d+)\/(\d+)\/(\d+)(?:\.\w+)?$/);
    if (!m) return false;
    const src = m[1], z = m[2], y = m[3], x = m[4];
    const srcFn = SOURCES[src];
    if (!srcFn) { res.writeHead(404); res.end("unknown tile source"); return true; }
    const file = path.join(cacheDir, src, z, y, x + ".img");
    fs.readFile(file, (err, data) => {
      if (!err && data && data.length) {
        res.writeHead(200, { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=31536000, immutable" });
        res.end(data);
        return;
      }
      fetchUpstream(srcFn(z, y, x)).then(({ buf, type }) => {
        // Write to disk in the background; don't block the response on it.
        fs.mkdir(path.dirname(file), { recursive: true }, () => fs.writeFile(file, buf, () => {}));
        res.writeHead(200, { "Content-Type": type, "Cache-Control": "public, max-age=31536000, immutable" });
        res.end(buf);
      }).catch(() => {
        // Offline and not cached — a transparent 1x1 keeps the map from erroring.
        res.writeHead(204); res.end();
      });
    });
    return true;
  };
}

// ---- Bulk region pre-download (for fully-offline play) ----
// Enumerates every tile in one or more lat/lon boxes over a zoom range and
// fetches them into the same on-disk cache the game reads from, so afterwards
// the whole area works with no network. One job at a time; progress is polled.
function lon2tileX(lon, z) { return Math.floor((lon + 180) / 360 * Math.pow(2, z)); }
function lat2tileY(lat, z) { const r = lat * Math.PI / 180; return Math.floor((1 - Math.asinh(Math.tan(r)) / Math.PI) / 2 * Math.pow(2, z)); }

let _dl = { active: false, done: 0, total: 0, ok: 0, cached: 0, fail: 0, bytes: 0, startedAt: 0, cancel: false, label: "" };

// plan: [{ source, minLat, maxLat, minLon, maxLon, minZoom, maxZoom }]
function enumerateJobs(plan) {
  const jobs = [];
  for (const rg of plan) {
    for (let z = rg.minZoom; z <= rg.maxZoom; z++) {
      const x0 = lon2tileX(rg.minLon, z), x1 = lon2tileX(rg.maxLon, z);
      const y0 = lat2tileY(rg.maxLat, z), y1 = lat2tileY(rg.minLat, z); // north lat -> smaller y
      for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) jobs.push([rg.source, z, x, y]);
    }
  }
  return jobs;
}

function countPlan(plan) { return enumerateJobs(plan).length; }

async function startRegionDownload(cacheDir, plan) {
  if (_dl.active) return _dl;
  const jobs = enumerateJobs(plan);
  _dl = { active: true, done: 0, total: jobs.length, ok: 0, cached: 0, fail: 0, bytes: 0, startedAt: Date.now(), cancel: false, label: "downloading" };
  const CONC = 6;
  let idx = 0;
  async function worker() {
    while (idx < jobs.length && !_dl.cancel) {
      const j = jobs[idx++];
      const src = j[0], z = j[1], x = j[2], y = j[3];
      const file = path.join(cacheDir, src, String(z), String(y), x + ".img");
      try {
        const st = await fs.promises.stat(file).catch(() => null);
        if (st && st.size > 0) { _dl.cached++; }
        else {
          const { buf } = await fetchUpstream(SOURCES[src](z, y, x));
          await fs.promises.mkdir(path.dirname(file), { recursive: true });
          await fs.promises.writeFile(file, buf);
          _dl.ok++; _dl.bytes += buf.length;
        }
      } catch (e) { _dl.fail++; }
      _dl.done++;
    }
  }
  const ws = [];
  for (let i = 0; i < CONC; i++) ws.push(worker());
  Promise.all(ws).then(() => { _dl.active = false; _dl.label = _dl.cancel ? "cancelled" : "done"; });
  return _dl;
}
function getDownloadStatus() { return _dl; }
function cancelDownload() { if (_dl.active) _dl.cancel = true; }

// The standard "Slovenia + surroundings" offline pack: a cheap wide-Europe
// backdrop at low zoom, plus Slovenia and its border regions in full detail,
// with terrain hillshade over the same close-up area.
const OFFLINE_PLAN_STANDARD = [
  { source: "imagery",   minLat: 34, maxLat: 71, minLon: -12, maxLon: 40, minZoom: 3, maxZoom: 6 },
  { source: "imagery",   minLat: 44.8, maxLat: 47.3, minLon: 12.0, maxLon: 17.5, minZoom: 7, maxZoom: 13 },
  // Hillshade only needs mid zooms — relief shading reads fine without close-up tiles.
  { source: "hillshade", minLat: 44.8, maxLat: 47.3, minLon: 12.0, maxLon: 17.5, minZoom: 7, maxZoom: 11 },
];

// HTTP routes for the offline download, shared by the dev server and the app:
//   GET /tiles/download/start   -> begin the standard pack, returns status JSON
//   GET /tiles/download/status  -> current progress JSON
//   GET /tiles/download/cancel  -> stop the running download
function makeDownloadHandler(cacheDir) {
  const sendStatus = (res) => {
    const s = getDownloadStatus();
    const total = s.total || countPlan(OFFLINE_PLAN_STANDARD);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(Object.assign({}, s, { total, planTotal: countPlan(OFFLINE_PLAN_STANDARD) })));
  };
  return function handleDownload(req, res, urlPath) {
    if (urlPath === "/tiles/download/start") { startRegionDownload(cacheDir, OFFLINE_PLAN_STANDARD); sendStatus(res); return true; }
    if (urlPath === "/tiles/download/status") { sendStatus(res); return true; }
    if (urlPath === "/tiles/download/cancel") { cancelDownload(); sendStatus(res); return true; }
    return false;
  };
}

module.exports = { makeTileHandler, makeDownloadHandler, startRegionDownload, getDownloadStatus, cancelDownload, countPlan, OFFLINE_PLAN_STANDARD };
