// Main menu / loading screen. Shows a blurred live satellite view of Slovenia
// with Play / Multiplayer / Settings, while the game loads in the background.
// The game itself is booted by main.js (bootGame → gameReady), and only starts
// ticking once the player picks a mode here (startGame in main.js).

let menuBgMap = null;

// Persisted settings (fullscreen isn't stored — it can't be forced on load
// without a user gesture, so we only restore sound/hillshade).
const SETTINGS_KEY = "sc_settings";
function loadSettings() {
  let s = { sound: true, menuMusic: true, volume: 55, hillshade: false, natoSymbols: false };
  try { Object.assign(s, JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}")); } catch (e) {}
  return s;
}
function saveSettings(s) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch (e) {}
}
let scSettings = loadSettings();

function initMenu() {
  buildMenuVideo();
  wireMenuButtons();
  wireSettings();
  applySoundSettings();
  wireMenuParallax();
  playStartupIntro();
}

// Subtle mouse parallax: the background layers drift a few pixels opposite the
// cursor for a bit of depth on the menu. We take over the map-bg's idle CSS
// drift animation (inline transform can't beat a running @keyframes) and ease
// toward the cursor target each frame.
function wireMenuParallax() {
  const menu = document.getElementById("mainMenu");
  if (!menu) return;
  const bg = document.getElementById("menuMapBg");
  const vid = document.getElementById("menuVideoBg");
  // Stop the CSS keyframe drift so our inline transform actually applies, and
  // scale the layers up a touch so their edges never show as they shift.
  if (bg)  { bg.style.animation = "none"; }
  let tx = 0, ty = 0, cx = 0, cy = 0, raf = 0;
  const BG_AMP = 28;
  function frame() {
    cx += (tx - cx) * 0.08;
    cy += (ty - cy) * 0.08;
    if (bg)  bg.style.transform  = `scale(1.12) translate(${cx}px, ${cy}px)`;
    if (vid) vid.style.transform = `scale(1.09) translate(${cx * 0.6}px, ${cy * 0.6}px)`;
    if (Math.abs(tx - cx) > 0.1 || Math.abs(ty - cy) > 0.1) raf = requestAnimationFrame(frame);
    else raf = 0;
  }
  menu.addEventListener("mousemove", (e) => {
    const nx = (e.clientX / window.innerWidth) - 0.5;   // -0.5 .. 0.5
    const ny = (e.clientY / window.innerHeight) - 0.5;
    tx = -nx * BG_AMP; ty = -ny * BG_AMP;               // opposite to cursor
    if (!raf) raf = requestAnimationFrame(frame);
  });
}

// ---- Startup intro (videos/STARTUPINTRO.mp4) ----
// Plays full-screen before the main menu is revealed, then fades away and
// kicks off the menu music. Skippable via the Skip button, click, or Esc.
let _introDone = false;
function playStartupIntro() {
  const wrap = document.getElementById("startupIntro");
  const vid = document.getElementById("startupIntroVideo");
  if (!wrap || !vid) { startMenuMusic(); return; }

  // Skip the intro when coming back from an in-game "Return to Main Menu".
  try {
    if (sessionStorage.getItem("sc_skipIntro")) {
      sessionStorage.removeItem("sc_skipIntro");
      wrap.remove();
      startMenuMusic();
      return;
    }
  } catch (e) {}

  const finish = () => {
    if (_introDone) return;
    _introDone = true;
    wrap.classList.add("introHiding");
    setTimeout(() => { try { vid.pause(); } catch (e) {} wrap.remove(); }, 700);
    startMenuMusic();
  };

  // Intro plays to the end on its own — no skipping. It only ends early if the
  // video errors or can't load (handled below).
  vid.src = "videos/STARTUPINTRO.mp4";
  vid.addEventListener("ended", finish);
  vid.addEventListener("error", finish);

  // Electron allows autoplay with sound; a plain browser may block it, so fall
  // back to a muted play so the intro still shows.
  vid.play().catch(() => { vid.muted = true; vid.play().catch(finish); });
  // Safety net: never let a stalled/missing video trap the player on a black screen.
  setTimeout(() => { if (!_introDone && (vid.error || vid.readyState === 0)) finish(); }, 4000);
}

// ---- Menu music ("Polje Boja") ----
let menuMusicAudio = null;
function startMenuMusic() {
  if (menuMusicAudio) { applyMenuMusic(); return; }
  menuMusicAudio = new Audio("sounds/Polje Boja.mp3");
  menuMusicAudio.loop = true;
  menuMusicAudio.volume = (scSettings.volume || 0) / 100;
  applyMenuMusic();
  // If the browser blocks autoplay, start on the first user interaction.
  const kick = () => {
    if (scSettings.menuMusic && menuMusicAudio && menuMusicAudio.paused) menuMusicAudio.play().catch(() => {});
    document.removeEventListener("pointerdown", kick);
    document.removeEventListener("keydown", kick);
  };
  document.addEventListener("pointerdown", kick);
  document.addEventListener("keydown", kick);
}
// Play/pause the menu theme to match the setting (and stop it once in-game).
function applyMenuMusic() {
  if (!menuMusicAudio) return;
  menuMusicAudio.volume = (scSettings.volume || 0) / 100;
  const inGame = typeof gameStarted !== "undefined" && gameStarted;
  if (scSettings.menuMusic && !inGame) menuMusicAudio.play().catch(() => {});
  else menuMusicAudio.pause();
}
function stopMenuMusic() {
  if (!menuMusicAudio) return;
  try { menuMusicAudio.pause(); menuMusicAudio.currentTime = 0; } catch (e) {}
}

// Play a random menu video (any file in videos/ containing "MAINMENU") as the
// backdrop. Falls back to the live satellite map only when no such video exists.
function buildMenuVideo() {
  const vid = document.getElementById("menuVideoBg");
  if (!vid) { buildMenuBackground(); return; }
  fetch("videos/list")
    .then((r) => r.json())
    .then((list) => {
      if (!Array.isArray(list) || !list.length) throw new Error("no menu videos");
      const pick = list[Math.floor(Math.random() * list.length)];
      vid.src = "videos/" + encodeURIComponent(pick);
      const bg = document.getElementById("menuMapBg");
      if (bg) bg.style.display = "none";
      vid.play().catch(() => {});
    })
    .catch(() => {
      // No menu videos (or listing failed) — restore the satellite backdrop.
      if (vid) vid.remove();
      const bg = document.getElementById("menuMapBg");
      if (bg) bg.style.display = "";
      buildMenuBackground();
    });
}

// A non-interactive WebGL satellite map framing the whole country, blurred via CSS.
function buildMenuBackground() {
  const canvas = document.getElementById("menuMapCanvas");
  if (!canvas || typeof WebGLTileMap === "undefined") return;
  try {
    menuBgMap = new WebGLTileMap(canvas, {
      center: [46.15, 14.85],
      zoom: 7.5,
      minZoom: 3,
      maxNativeZoom: 19,
      maxZoom: 21,
      controls: false,
      embedded: true,
      tileUrl: "tiles/imagery/{z}/{y}/{x}",
    });
  } catch (e) { /* offline / blocked fallback */ }
}

function wireMenuButtons() {
  const single = document.getElementById("btnSingle");
  const multi = document.getElementById("btnMulti");
  const settings = document.getElementById("btnSettings");
  const quit = document.getElementById("btnQuit");
  const load = document.getElementById("btnLoad");
  if (single) single.addEventListener("click", () => launchGame("single"));
  if (multi) multi.addEventListener("click", () => { if (typeof mpOpenLobby === "function") mpOpenLobby(); });
  if (load) load.addEventListener("click", () => triggerLoadPicker(loadGameFromMenu));
  if (settings) settings.addEventListener("click", openSettings);
  if (quit) quit.addEventListener("click", quitGame);
  wireMpLobby();
}

// ---- Multiplayer lobby wiring ----
function wireMpLobby() {
  const on = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener("click", fn); };
  on("mpClose", () => { if (typeof mpCloseLobby === "function") mpCloseLobby(); });
  on("mpHostBtn", () => { if (typeof mpPrepareHost === "function") mpPrepareHost(); });
  on("mpJoinBtn", () => { if (typeof mpPrepareJoin === "function") mpPrepareJoin(); });
  on("mpHostBack", () => { if (typeof mpShowView === "function") mpShowView("choice"); });
  on("mpJoinBack", () => { if (typeof mpShowView === "function") mpShowView("choice"); });
  on("mpEnterAsHost", () => { if (typeof mpStartHosting === "function") mpStartHosting(); });
  on("mpConnect", () => { if (typeof mpDoJoin === "function") mpDoJoin(); });
  on("mpCopyCode", () => copyText(document.getElementById("mpCodeText"), document.getElementById("mpCopyCode")));
  on("pmMpCopy", () => copyText(document.getElementById("pmMpCodeText"), document.getElementById("pmMpCopy")));
  const jc = document.getElementById("mpJoinCode");
  if (jc) jc.addEventListener("keydown", (e) => { if (e.key === "Enter" && typeof mpDoJoin === "function") mpDoJoin(); });
}
function copyText(srcEl, btn) {
  if (!srcEl) return;
  const txt = srcEl.textContent || "";
  const done = () => { if (btn) { const o = btn.textContent; btn.textContent = "Copied!"; setTimeout(() => { btn.textContent = o; }, 1200); } };
  try { navigator.clipboard.writeText(txt).then(done, done); } catch (e) { done(); }
}

// Called by main.js once all data is loaded and the map/UI are built.
function onGameReady() {
  const single = document.getElementById("btnSingle");
  const multi = document.getElementById("btnMulti");
  const loading = document.getElementById("menuLoading");
  const load = document.getElementById("btnLoad");
  if (single) single.disabled = false;
  if (multi) multi.disabled = false;
  if (load) load.disabled = false;
  if (loading) loading.classList.add("ready");
  if (loading) loading.innerHTML = "Ready — choose a mode to begin";
  // Apply the saved hillshade preference now that the map exists.
  applyHillshade(scSettings.hillshade);
}

function launchGame(mode) {
  if (typeof gameReady === "undefined" || !gameReady) return;
  if (typeof startGame === "function") startGame(mode);
  stopMenuMusic();
  const menu = document.getElementById("mainMenu");
  if (menu) {
    menu.classList.add("menuHiding");
    setTimeout(() => {
      menu.remove();
      menuBgMap = null;
      if (typeof mapEngine !== "undefined" && mapEngine) mapEngine._scheduleRender();
    }, 550);
  }
}

// ---- Settings ----
function openSettings() {
  const panel = document.getElementById("menuSettings");
  if (panel) panel.classList.remove("hidden");
  syncSettingsUI();
}
function closeSettings() {
  const panel = document.getElementById("menuSettings");
  if (panel) panel.classList.add("hidden");
}

function setToggle(btn, on) {
  if (!btn) return;
  btn.classList.toggle("on", !!on);
  btn.setAttribute("aria-checked", on ? "true" : "false");
}

function syncSettingsUI() {
  setToggle(document.getElementById("setSound"), scSettings.sound);
  setToggle(document.getElementById("setMenuMusic"), scSettings.menuMusic);
  setToggle(document.getElementById("setHillshade"), scSettings.hillshade);
  setToggle(document.getElementById("setNatoSymbols"), scSettings.natoSymbols);
  const vol = document.getElementById("setVolume");
  const volVal = document.getElementById("setVolVal");
  if (vol) vol.value = scSettings.volume;
  if (volVal) volVal.textContent = scSettings.volume + "%";
  setToggle(document.getElementById("setFullscreen"), !!document.fullscreenElement);
}

function wireSettings() {
  const close = document.getElementById("msClose");
  const done = document.getElementById("msDone");
  if (close) close.addEventListener("click", closeSettings);
  if (done) done.addEventListener("click", closeSettings);

  const fs = document.getElementById("setFullscreen");
  if (fs) fs.addEventListener("click", () => {
    const goingFull = !document.fullscreenElement;
    try {
      if (goingFull) (document.documentElement.requestFullscreen || function () {}).call(document.documentElement);
      else (document.exitFullscreen || function () {}).call(document);
    } catch (e) {}
  });
  document.addEventListener("fullscreenchange", () => setToggle(document.getElementById("setFullscreen"), !!document.fullscreenElement));

  const sound = document.getElementById("setSound");
  if (sound) sound.addEventListener("click", () => {
    scSettings.sound = !scSettings.sound;
    setToggle(sound, scSettings.sound);
    applySoundSettings(); saveSettings(scSettings);
  });

  const music = document.getElementById("setMenuMusic");
  if (music) music.addEventListener("click", () => {
    scSettings.menuMusic = !scSettings.menuMusic;
    setToggle(music, scSettings.menuMusic);
    applyMenuMusic(); saveSettings(scSettings);
  });

  const vol = document.getElementById("setVolume");
  if (vol) vol.addEventListener("input", () => {
    scSettings.volume = Number(vol.value) || 0;
    const volVal = document.getElementById("setVolVal");
    if (volVal) volVal.textContent = scSettings.volume + "%";
    applySoundSettings();
    if (menuMusicAudio) menuMusicAudio.volume = (scSettings.volume || 0) / 100;
    saveSettings(scSettings);
  });

  const hs = document.getElementById("setHillshade");
  if (hs) hs.addEventListener("click", () => {
    scSettings.hillshade = !scSettings.hillshade;
    setToggle(hs, scSettings.hillshade);
    applyHillshade(scSettings.hillshade); saveSettings(scSettings);
  });

  const nato = document.getElementById("setNatoSymbols");
  if (nato) nato.addEventListener("click", () => {
    scSettings.natoSymbols = !scSettings.natoSymbols;
    setToggle(nato, scSettings.natoSymbols);
    saveSettings(scSettings);
    // Unit markers are dynamic, so the next frame picks the new style up —
    // just nudge a render in case the sim is paused.
    if (typeof mapEngine !== "undefined" && mapEngine) mapEngine._scheduleRender();
  });

  const dlBtn = document.getElementById("setDownloadMap");
  if (dlBtn) dlBtn.addEventListener("click", startOfflineDownload);

  const glBtn = document.getElementById("setOpenGLMap");
  if (glBtn) glBtn.addEventListener("click", () => { window.location.href = "map-engine.html"; });

  wirePauseMenu();
}

// ---- Offline map pre-download ----
let _offlinePoll = null;
function _fmtN(n) { return Math.round(n).toLocaleString(); }
function setOfflineStatus(txt) { const el = document.getElementById("offlineStatus"); if (el) el.textContent = txt; }
function startOfflineDownload() {
  const btn = document.getElementById("setDownloadMap");
  fetch("tiles/download/start").then(r => r.json()).then(() => {
    if (btn) { btn.textContent = "Downloading…"; btn.disabled = true; }
    const prog = document.getElementById("offlineProg");
    if (prog) prog.classList.remove("hidden");
    setOfflineStatus("Downloading map tiles — you can keep playing; leave this open to watch progress.");
    pollOffline();
  }).catch(() => setOfflineStatus("Couldn't start the download — no internet connection?"));
}
function pollOffline() {
  clearTimeout(_offlinePoll);
  fetch("tiles/download/status").then(r => r.json()).then(s => {
    const total = s.total || s.planTotal || 1;
    const pct = Math.min(100, Math.floor((s.done / total) * 100));
    const fill = document.getElementById("offlineProgFill"); if (fill) fill.style.width = pct + "%";
    const txt = document.getElementById("offlineProgTxt"); if (txt) txt.textContent = `${pct}% · ${_fmtN(s.done)}/${_fmtN(total)}`;
    if (s.active) { _offlinePoll = setTimeout(pollOffline, 1000); }
    else {
      const btn = document.getElementById("setDownloadMap");
      if (btn) { btn.textContent = s.label === "cancelled" ? "Download" : "Done ✓"; btn.disabled = false; }
      const mb = Math.round((s.bytes || 0) / 1048576);
      setOfflineStatus(s.label === "cancelled"
        ? "Download cancelled. You can resume anytime — cached tiles are kept."
        : `Map ready offline — ${_fmtN((s.ok || 0) + (s.cached || 0))} tiles cached (${mb} MB downloaded). The game now works with no internet.`);
    }
  }).catch(() => { _offlinePoll = setTimeout(pollOffline, 2000); });
}

function settingsOpen() {
  const p = document.getElementById("menuSettings");
  return p && !p.classList.contains("hidden");
}

// ---- In-game ESC pause menu ----
let pauseMenuOpen = false;
let pausePrevPaused = false;

function wirePauseMenu() {
  const resume = document.getElementById("pmResume");
  const saveBtn = document.getElementById("pmSave");
  const loadBtn = document.getElementById("pmLoad");
  const setBtn = document.getElementById("pmSettings");
  const menuBtn = document.getElementById("pmMenu");
  const quitBtn = document.getElementById("pmQuit");
  if (resume) resume.addEventListener("click", closePauseMenu);
  if (saveBtn) saveBtn.addEventListener("click", saveGame);
  if (loadBtn) loadBtn.addEventListener("click", () => triggerLoadPicker(loadGameInGame));
  if (setBtn) setBtn.addEventListener("click", openSettings);
  if (menuBtn) menuBtn.addEventListener("click", () => {
    // Returning to the menu shouldn't replay the startup intro.
    try { sessionStorage.setItem("sc_skipIntro", "1"); } catch (e) {}
    window.location.reload();
  });
  if (quitBtn) quitBtn.addEventListener("click", quitGame);
}

function openPauseMenu() {
  if (pauseMenuOpen) return;
  pauseMenuOpen = true;
  // Pause the sim while the menu is up, remembering the prior state.
  pausePrevPaused = !!(typeof state !== "undefined" && state.paused);
  if (typeof state !== "undefined") { state.paused = true; if (typeof refreshSpeedButtons === "function") refreshSpeedButtons(); }
  const app = document.getElementById("app");
  if (app) app.classList.add("blurred");
  const pm = document.getElementById("pauseMenu");
  if (pm) pm.classList.remove("hidden");
  if (typeof mpRefreshPauseCode === "function") mpRefreshPauseCode();
}

function closePauseMenu() {
  if (!pauseMenuOpen) return;
  pauseMenuOpen = false;
  closeSettings();
  const pm = document.getElementById("pauseMenu");
  if (pm) pm.classList.add("hidden");
  const app = document.getElementById("app");
  if (app) app.classList.remove("blurred");
  if (typeof state !== "undefined") { state.paused = pausePrevPaused; if (typeof refreshSpeedButtons === "function") refreshSpeedButtons(); }
}

// ---- Save / Load ----------------------------------------------------------
// A save is the whole game state serialized to a JSON file the player downloads.
// Loading reads one back, mutates the (const) state object in place, revives its
// Date fields, and refreshes every view. On the co-op host, a load re-broadcasts
// to all joiners automatically via the normal state snapshot.
function saveGame() {
  if (typeof state === "undefined") return;
  let snap;
  try { snap = JSON.parse(JSON.stringify(state)); }
  catch (e) { if (typeof logEvent === "function") logEvent("Save failed — state could not be serialized."); return; }
  const payload = { __sc_save: 1, version: 1, savedAt: new Date().toISOString(), state: snap };
  const d = (state.date instanceof Date) ? state.date : new Date();
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.getElementById("saveDownloadAnchor") || document.createElement("a");
  a.href = url;
  a.download = `slovenia-command-${stamp}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  if (typeof logEvent === "function") logEvent("Game saved to " + a.download + ".");
  if (typeof closePauseMenu === "function") closePauseMenu();
}

function parseSaveText(text) {
  let obj;
  try { obj = JSON.parse(text); } catch (e) { return null; }
  if (obj && obj.__sc_save && obj.state) return obj.state; // wrapped save
  if (obj && obj.econ && obj.date !== undefined) return obj; // bare state
  return null;
}

function applyLoadedState(snap) {
  if (!snap || typeof snap !== "object") return false;
  for (const k in snap) state[k] = snap[k];
  if (typeof snap.date === "string") state.date = new Date(snap.date);
  (state.pendingDecisions || []).forEach(dd => { if (dd && typeof dd.deadlineDate === "string") dd.deadlineDate = new Date(dd.deadlineDate); });
  (state.pendingOutcomes || []).forEach(o => { if (o && typeof o.resolveDate === "string") o.resolveDate = new Date(o.resolveDate); });
  // Per-player fields never carry over from a save.
  state.selectedUnitId = null;
  state.selectedCityId = null;
  state.selectedMunicipalityId = null;
  state.pendingWaypoints = [];
  return true;
}

function refreshAfterLoad() {
  if (typeof invalidateStaticMapCache === "function") invalidateStaticMapCache();
  if (typeof renderTopBar === "function") try { renderTopBar(); } catch (e) {}
  if (typeof renderWarBanner === "function") try { renderWarBanner(); } catch (e) {}
  if (typeof refreshSpeedButtons === "function") try { refreshSpeedButtons(); } catch (e) {}
  if (typeof updateSelectedUnitBox === "function") try { updateSelectedUnitBox(); } catch (e) {}
  if (typeof renderPendingTray === "function") try { renderPendingTray(); } catch (e) {}
  if (typeof renderModifierBar === "function") try { renderModifierBar(); } catch (e) {}
  if (typeof closeCityPanel === "function") try { closeCityPanel(); } catch (e) {}
  if (typeof syncEnemyMarkers === "function") try { syncEnemyMarkers(); } catch (e) {}
  if (typeof mapEngine !== "undefined" && mapEngine) mapEngine._scheduleRender();
}

// From the main menu (game not started yet) -> start singleplayer with the save.
function loadGameFromMenu(text) {
  const snap = parseSaveText(text);
  if (!snap) { alert("That file isn't a valid Slovenia Command save."); return; }
  if (typeof launchGame === "function") launchGame("single");
  applyLoadedState(snap);
  refreshAfterLoad();
  if (typeof logEvent === "function") logEvent("Save loaded — resuming your campaign.");
}

// From the in-game pause menu. On the co-op host this rebroadcasts to everyone.
function loadGameInGame(text) {
  if (typeof mpRole !== "undefined" && mpRole === "client") { alert("Only the host can load a save in multiplayer."); return; }
  const snap = parseSaveText(text);
  if (!snap) { alert("That file isn't a valid Slovenia Command save."); return; }
  applyLoadedState(snap);
  refreshAfterLoad();
  if (typeof closePauseMenu === "function") closePauseMenu();
  if (typeof logEvent === "function") logEvent("Save loaded.");
}

function triggerLoadPicker(handler) {
  const input = document.getElementById("loadFileInput");
  if (!input) return;
  input.value = "";
  input.onchange = () => {
    const file = input.files && input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => handler(String(reader.result || ""));
    reader.readAsText(file);
  };
  input.click();
}

function quitGame() {
  // In the packaged (Electron) app this closes the window and exits. In a plain
  // browser tab window.close() only works for script-opened windows, so fall
  // back to a blank end screen.
  try { window.close(); } catch (e) {}
  setTimeout(() => {
    document.body.innerHTML = '<div style="position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:#0a0f14;color:#8ba0ad;font-family:sans-serif;font-size:15px;letter-spacing:1px">You can close this window now.</div>';
  }, 150);
}

// Push sound prefs into the audio helper (sounds.js reads these globals).
function applySoundSettings() {
  if (typeof window !== "undefined") {
    window.soundMuted = !scSettings.sound;
    window.soundVolume = (scSettings.volume || 0) / 100;
  }
}

// Toggle the in-game terrain hillshade layer if the map is up.
function applyHillshade(on) {
  if (typeof layerState !== "undefined") {
    layerState.relief = !!on;
    if (typeof mapEngine !== "undefined" && mapEngine) mapEngine._scheduleRender();
  }
}
