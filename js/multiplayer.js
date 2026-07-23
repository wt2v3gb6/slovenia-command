// ===================== CO-OP MULTIPLAYER (client side) =====================
// Slovenia Command co-op = two+ players commanding the ONE Slovenia together.
// One player HOSTS (their app runs the authoritative simulation) and shares a
// room code; friends JOIN with that code over the internet (the host forwards
// the game port on their router). The relay mailbox lives in the host's HTTP
// server (see mp-relay.js).
//
//   HOST  : runs the sim, pushes full state snapshots, applies joiners' actions.
//   CLIENT: mirrors the host's state, and relays its own actions to the host.
//
// Everything here is a no-op in singleplayer (mpRole stays null), so the normal
// game is untouched.

let mpRole = null;          // null (singleplayer) | "host" | "client"
let mpHostBase = "";        // "" = same origin (host); "http://ip:port" for a client
let mpCode = "";            // the room code (shown to the host, typed by joiners)
let mpConnected = false;    // client: are we receiving host snapshots?
let mpHostSeenRecently = false;
let mpLastPushAt = 0, mpLastPullAt = 0;
let mpSnapSeq = 0;          // host: increments per snapshot; client: last seq seen
let mpHostAck = 0;          // host: highest joiner-action seq already applied
let mpLastStateAt = 0;      // client: last time we successfully applied a snapshot

const MP_PORT_DEFAULT = 8934;
const MP_PUSH_MS = 350;     // host: how often to broadcast state
const MP_PULL_MS = 350;     // client: how often to fetch state

// Fields that are per-player (each player has their own selection/camera), so a
// joiner must NOT have them overwritten by the host's snapshot.
const MP_SKIP = new Set(["selectedUnitId", "selectedCityId", "selectedMunicipalityId", "pendingWaypoints"]);

// ---- Room code encode/decode (packs IPv4 + port into a short base-36 code) ----
function mpEncodeCode(host, port) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host || "");
  if (m) {
    const ip32 = ((((+m[1]) * 256) + (+m[2])) * 256 + (+m[3])) * 256 + (+m[4]);
    const num = ip32 * 65536 + (port & 0xffff);
    return num.toString(36).toUpperCase();
  }
  // Non-IPv4 fallback: base64url of "host:port".
  return "H" + btoa(host + ":" + port).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function mpDecodeCode(code) {
  code = (code || "").trim();
  if (!code) return null;
  // Accept a raw "ip:port" pasted directly.
  if (code.indexOf(":") >= 0 && /\d+\.\d+/.test(code)) {
    const i = code.lastIndexOf(":");
    return { ip: code.slice(0, i).replace(/^https?:\/\//, ""), port: (+code.slice(i + 1)) || MP_PORT_DEFAULT };
  }
  if (code[0] === "H") {
    try {
      const s = atob(code.slice(1).replace(/-/g, "+").replace(/_/g, "/"));
      const i = s.lastIndexOf(":");
      return { ip: s.slice(0, i), port: (+s.slice(i + 1)) || MP_PORT_DEFAULT };
    } catch (e) { return null; }
  }
  const num = parseInt(code, 36);
  if (!isFinite(num) || num <= 0) return null;
  const port = num % 65536;
  const ip32 = Math.floor(num / 65536);
  const ip = [(ip32 >>> 24) & 255, (ip32 >>> 16) & 255, (ip32 >>> 8) & 255, ip32 & 255].join(".");
  return { ip, port };
}

// ---- The single choke point every relayed action passes through. -----------
// Returns true if it forwarded the action to the host (so the caller must NOT
// also run it locally). Returns false in singleplayer and on the host, so the
// caller executes the action normally.
function mpRelayIfClient(name, payload) {
  if (mpRole !== "client") return false;
  try {
    fetch(mpHostBase + "/mp/action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, payload }),
    }).catch(() => {});
  } catch (e) {}
  return true;
}

// ---- Host: how each incoming joiner action is applied to the real sim. ------
const MP_ACTIONS = {
  deployUnit: (p) => { if (typeof deployUnit === "function") deployUnit(p.type, p.cityId); },
  moveUnit: (p) => {
    const u = (state.units || []).find(x => x.id === p.unitId);
    if (u && typeof applyMoveOrder === "function") { u.freePath = !!p.freePath; applyMoveOrder(u, p.waypoints || []); }
  },
  haltAll: () => { if (typeof haltAllUnits === "function") haltAllUnits(); },
  ping: (p) => { if (p && p.lat != null) { if (!state.pings) state.pings = []; state.pings.push({ id: p.id, lat: p.lat, lon: p.lon }); } },
  setPaused: (p) => { state.paused = !!p.paused; if (typeof refreshSpeedButtons === "function") refreshSpeedButtons(); },
  setSpeed: (p) => { state.speedIndex = p.index; state.paused = false; if (typeof refreshSpeedButtons === "function") refreshSpeedButtons(); },
  enactLaw: (p) => { if (typeof enactLaw === "function") enactLaw(p.groupKey, p.optionKey); },
  buildInfra: (p) => { if (typeof applyInfraProject === "function") applyInfraProject(p); },
  resolveChoice: (p) => {
    const d = (state.pendingDecisions || []).find(x => x.id === p.decisionId);
    if (d && typeof resolveChoice === "function") {
      const c = d.ev && d.ev.choices ? d.ev.choices[p.choiceIndex] : null;
      if (c) resolveChoice(d, c);
    }
  },
  hireExperts: (p) => {
    const d = (state.pendingDecisions || []).find(x => x.id === p.decisionId);
    if (d && !d.expertsRevealed && d.ev && d.ev.expertsCost != null) {
      state.econ.treasury -= d.ev.expertsCost;
      d.expertsRevealed = true;
      if (typeof logEvent === "function") logEvent(`Hired experts to assess: ${d.ev.title}.`);
    }
  },
};

function mpApplyActions(actions) {
  if (!actions || !actions.length) return;
  for (const a of actions) {
    if (a.seq <= mpHostAck) continue;
    mpHostAck = a.seq;
    const fn = MP_ACTIONS[a.name];
    if (fn) { try { fn(a.payload || {}); } catch (e) { /* keep the sim alive */ } }
  }
}

// ---- Snapshot serialize (host) / apply (client) ----------------------------
function mpSerializeState() {
  try { return JSON.parse(JSON.stringify(state)); } catch (e) { return null; }
}
function mpApplySnapshot(snap) {
  if (!snap) return;
  for (const k in snap) { if (MP_SKIP.has(k)) continue; state[k] = snap[k]; }
  if (typeof snap.date === "string") state.date = new Date(snap.date);
  (state.pendingDecisions || []).forEach(d => { if (d && typeof d.deadlineDate === "string") d.deadlineDate = new Date(d.deadlineDate); });
  (state.pendingOutcomes || []).forEach(o => { if (o && typeof o.resolveDate === "string") o.resolveDate = new Date(o.resolveDate); });
}

function mpRenderMirror() {
  if (typeof refreshSpeedButtons === "function") refreshSpeedButtons();
  if (typeof renderTopBar === "function") renderTopBar();
  if (typeof renderMap === "function") renderMap();
  if (typeof updateSelectedUnitBox === "function") updateSelectedUnitBox();
  if (typeof renderPendingLine === "function") renderPendingLine();
  if (typeof renderPendingTray === "function") try { renderPendingTray(); } catch (e) {}
  if (typeof renderModifierBar === "function") try { renderModifierBar(); } catch (e) {}
}

// ---- The per-tick hooks called from gameTick() (main.js) --------------------
function mpHostTick() {
  const now = Date.now();
  if (now - mpLastPushAt < MP_PUSH_MS) return;
  mpLastPushAt = now;
  const snap = mpSerializeState();
  if (!snap) return;
  mpSnapSeq++;
  fetch("/mp/host/state", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ seq: mpSnapSeq, state: snap, code: mpCode, ackAction: mpHostAck }),
  }).then(r => r.json()).then(d => { if (d && d.actions) mpApplyActions(d.actions); }).catch(() => {});
}

function mpClientTick() {
  const now = Date.now();
  if (now - mpLastPullAt < MP_PULL_MS) return;
  mpLastPullAt = now;
  fetch(mpHostBase + "/mp/state").then(r => r.json()).then(d => {
    mpConnected = true;
    if (d && d.state && d.seq !== mpSnapSeq) {
      mpSnapSeq = d.seq;
      mpApplySnapshot(d.state);
      mpLastStateAt = Date.now();
      mpRenderMirror();
    }
    mpHostSeenRecently = d && d.hostSeenAt && (Date.now() - d.hostSeenAt < 6000);
  }).catch(() => { mpConnected = false; });
}

// ---- Lobby: host / join ----------------------------------------------------
function mpOpenLobby() {
  const el = document.getElementById("mpLobby");
  if (!el) return;
  el.classList.remove("hidden");
  mpShowView("choice");
  const err = document.getElementById("mpJoinStatus");
  if (err) err.textContent = "";
}
function mpCloseLobby() {
  const el = document.getElementById("mpLobby");
  if (el) el.classList.add("hidden");
}
function mpShowView(which) {
  ["mpChoice", "mpHostView", "mpJoinView"].forEach(id => {
    const v = document.getElementById(id);
    if (v) v.classList.add("hidden");
  });
  const map = { choice: "mpChoice", host: "mpHostView", join: "mpJoinView" };
  const show = document.getElementById(map[which]);
  if (show) show.classList.remove("hidden");
}

// Host flow: figure out our address, build a code, reset the relay, show it.
function mpPrepareHost() {
  mpShowView("host");
  const codeEl = document.getElementById("mpCodeText");
  const hintEl = document.getElementById("mpHostHint");
  if (codeEl) codeEl.textContent = "…";
  fetch("/mp/whoami").then(r => r.json()).then(info => {
    const host = info.publicIp || info.localIp || "127.0.0.1";
    const port = info.port || MP_PORT_DEFAULT;
    mpCode = mpEncodeCode(host, port);
    if (codeEl) codeEl.textContent = mpCode;
    if (hintEl) {
      hintEl.innerHTML = info.publicIp
        ? `Forward port <b>${port}</b> (TCP) on your router to this PC, then send friends the code above. Your address: <b>${host}:${port}</b>.`
        : `Couldn't detect your public IP. On the same Wi‑Fi, friends can use <b>${host}:${port}</b>. For internet play, forward port <b>${port}</b> and share your public IP.`;
    }
    // Reset the relay mailbox for a fresh room.
    fetch("/mp/reset", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: mpCode }) }).catch(() => {});
  }).catch(() => { if (codeEl) codeEl.textContent = "error"; });
}

function mpStartHosting() {
  mpRole = "host";
  mpHostBase = "";
  mpCloseLobby();
  if (typeof launchGame === "function") launchGame("coop");
}

function mpPrepareJoin() {
  mpShowView("join");
  const input = document.getElementById("mpJoinCode");
  if (input) { input.value = ""; input.focus(); }
  const status = document.getElementById("mpJoinStatus");
  if (status) status.textContent = "";
}

function mpDoJoin() {
  const input = document.getElementById("mpJoinCode");
  const status = document.getElementById("mpJoinStatus");
  const raw = input ? input.value : "";
  const dec = mpDecodeCode(raw);
  if (!dec || !dec.ip) { if (status) status.textContent = "That code doesn't look right — check it and try again."; return; }
  const base = "http://" + dec.ip + ":" + dec.port;
  if (status) status.textContent = "Connecting to " + dec.ip + ":" + dec.port + "…";
  fetch(base + "/mp/join", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: raw.trim() }) })
    .then(r => r.json()).then(d => {
      mpRole = "client";
      mpHostBase = base;
      mpCode = raw.trim();
      if (status) status.textContent = d && d.hasHost ? "Connected — joining the session…" : "Connected — waiting for the host to start…";
      mpCloseLobby();
      if (typeof launchGame === "function") launchGame("coop");
    })
    .catch(() => { if (status) status.textContent = "Couldn't reach that host. Make sure they're hosting and the port is forwarded."; });
}

// ---- Pause-menu code display (Esc) -----------------------------------------
function mpRefreshPauseCode() {
  const row = document.getElementById("pmMpCode");
  if (!row) return;
  if (!mpRole) { row.classList.add("hidden"); return; }
  row.classList.remove("hidden");
  const label = document.getElementById("pmMpCodeText");
  const sub = document.getElementById("pmMpCodeSub");
  if (label) label.textContent = mpCode || "—";
  if (sub) {
    if (mpRole === "host") sub.textContent = mpConnectedPlayersText();
    else sub.textContent = mpConnected ? "Connected to host" : "Reconnecting to host…";
  }
}
function mpConnectedPlayersText() {
  return "You are hosting — share this code with friends.";
}
