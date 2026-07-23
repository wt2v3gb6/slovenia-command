// ===================== CO-OP MULTIPLAYER RELAY (mailbox) =====================
// A tiny in-memory mailbox that lives inside the HOST's HTTP server. Because
// Slovenia Command co-op is one shared nation, the host runs the authoritative
// simulation and pushes full game-state snapshots here; joined players pull
// those snapshots and push their own action commands back. The host reads the
// action queue and applies each command to its running sim.
//
//   host renderer  --POST /mp/host/state-->  [ relay ]  <--GET /mp/state--  joiner
//   host renderer  <--(actions in reply)---  [ relay ]  <--POST /mp/action- joiner
//
// The relay itself holds NO game logic — it just shuttles JSON between players.
// It is required by both server.js (dev) and electron-main.js (packaged app).

const https = require("https");

const room = {
  snapshot: null,   // latest full game state (plain JSON) from the host
  snapSeq: 0,       // increments each push, so joiners can detect fresh state
  actions: [],      // queued { seq, name, payload, at } commands from joiners
  actionSeq: 0,
  hostSeenAt: 0,    // last time the host pushed state
  joinSeenAt: 0,    // last time any joiner talked to us
  players: 0,       // rough count of joiners that have connected
  code: null,       // the room code the host advertised
};

let publicIpCache = null;
let publicIpAt = 0;

// Best-effort public IP lookup (used to build the shareable room code). Cached
// for 5 min. Never throws — falls back to null so the caller can use the LAN IP.
function fetchPublicIp() {
  return new Promise((resolve) => {
    if (publicIpCache && Date.now() - publicIpAt < 300000) return resolve(publicIpCache);
    const req = https.get("https://api.ipify.org", { timeout: 4000 }, (res) => {
      let d = "";
      res.on("data", (c) => (d += c));
      res.on("end", () => {
        const ip = (d || "").trim();
        if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) { publicIpCache = ip; publicIpAt = Date.now(); resolve(ip); }
        else resolve(null);
      });
    });
    req.on("error", () => resolve(null));
    req.on("timeout", () => { req.destroy(); resolve(null); });
  });
}

function sendJson(res, obj, code) {
  const body = JSON.stringify(obj);
  res.writeHead(code || 200, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve) => {
    let d = "";
    req.on("data", (c) => { d += c; if (d.length > 8e6) req.destroy(); });
    req.on("end", () => { try { resolve(d ? JSON.parse(d) : {}); } catch (e) { resolve({}); } });
    req.on("error", () => resolve({}));
  });
}

// Handle any /mp/* request. Returns true if it consumed the request.
// opts: { port, localIp }
async function handleMp(req, res, pathname, opts) {
  if (pathname.indexOf("/mp/") !== 0) return false;
  opts = opts || {};

  if (req.method === "OPTIONS") { sendJson(res, {}, 204); return true; }

  if (pathname === "/mp/whoami" && req.method === "GET") {
    const publicIp = await fetchPublicIp();
    sendJson(res, { port: opts.port || 0, publicIp: publicIp, localIp: opts.localIp || null });
    return true;
  }

  // Host pushes the authoritative snapshot AND collects queued joiner actions.
  if (pathname === "/mp/host/state" && req.method === "POST") {
    const b = await readBody(req);
    if (b.state) room.snapshot = b.state;
    room.snapSeq = (b.seq != null) ? b.seq : room.snapSeq + 1;
    room.hostSeenAt = Date.now();
    if (b.code) room.code = b.code;
    const since = b.ackAction || 0;
    sendJson(res, { ok: true, actions: room.actions.filter((a) => a.seq > since), players: room.players, joinSeenAt: room.joinSeenAt });
    return true;
  }

  // Joiner pulls the latest snapshot.
  if (pathname === "/mp/state" && req.method === "GET") {
    room.joinSeenAt = Date.now();
    sendJson(res, { seq: room.snapSeq, state: room.snapshot, hostSeenAt: room.hostSeenAt, code: room.code });
    return true;
  }

  // Joiner pushes one action command.
  if (pathname === "/mp/action" && req.method === "POST") {
    const b = await readBody(req);
    room.actionSeq++;
    room.actions.push({ seq: room.actionSeq, name: b.name, payload: b.payload, at: Date.now() });
    if (room.actions.length > 500) room.actions = room.actions.slice(-300);
    room.joinSeenAt = Date.now();
    sendJson(res, { ok: true, seq: room.actionSeq });
    return true;
  }

  // Joiner announces itself (optionally with the code it typed).
  if (pathname === "/mp/join" && req.method === "POST") {
    await readBody(req);
    room.players = (room.players || 0) + 1;
    room.joinSeenAt = Date.now();
    sendJson(res, { ok: true, hasHost: !!room.snapshot, code: room.code });
    return true;
  }

  // Host (re)starts a room: clear everything.
  if (pathname === "/mp/reset" && req.method === "POST") {
    const b = await readBody(req);
    room.snapshot = null; room.snapSeq = 0; room.actions = []; room.actionSeq = 0;
    room.players = 0; room.hostSeenAt = 0; room.joinSeenAt = 0;
    room.code = (b && b.code) || null;
    sendJson(res, { ok: true });
    return true;
  }

  if (pathname === "/mp/info" && req.method === "GET") {
    sendJson(res, { hasHost: !!room.snapshot, players: room.players, hostSeenAt: room.hostSeenAt, joinSeenAt: room.joinSeenAt, code: room.code });
    return true;
  }

  sendJson(res, { error: "unknown mp endpoint" }, 404);
  return true;
}

module.exports = { handleMp, fetchPublicIp };
