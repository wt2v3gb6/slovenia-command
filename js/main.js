// Entry point: init subsystems and run the game loop.
// Uses setInterval rather than requestAnimationFrame so the simulation keeps
// running even when the tab is backgrounded/hidden (rAF is suspended then).

const TICK_MS = 100;
let lastTickAt = null;

// The simulation ticks 10x/sec, but the map and top bar don't need redrawing
// that often. Rendering the map ~5x/sec (and only ~1x/sec while paused, since
// nothing moves) roughly halves idle CPU with no visible difference. Pan/zoom
// smoothness doesn't depend on this — WebGLTileMap runs its own rAF loop.
const MAP_RENDER_MS = 200;
const UI_RENDER_MS = 200;
let lastMapRenderAt = 0;
let lastUiRenderAt = 0;
// In-game-day scheduler for random decisions (see gameTick).
let gameDaysSinceEvent = 0;
let nextEventInDays = 2 + Math.random() * 2;

function gameTick() {
  // Co-op joiner: don't run the sim locally — mirror the host's state instead.
  if (typeof mpRole !== "undefined" && mpRole === "client") {
    if (typeof mpClientTick === "function") mpClientTick();
    return;
  }
  const now = Date.now();
  if (lastTickAt === null) lastTickAt = now;
  const dtSeconds = Math.min((now - lastTickAt) / 1000, 1);
  lastTickAt = now;

  const { simHours, simDays } = tickEconomy(dtSeconds);
  if (simHours > 0) {
    tickUnits(simHours);
    tickEnemyUnits(simHours);
  }
  // Decisions arrive on an IN-GAME schedule (every ~2–4 game days) rather than a
  // real-time timer, so they feel consistent at any speed and don't flood the
  // tray now that the clock runs slower.
  if (simDays > 0 && !state.paused) {
    gameDaysSinceEvent += simDays;
    if (gameDaysSinceEvent >= nextEventInDays) {
      gameDaysSinceEvent = 0;
      nextEventInDays = 2 + Math.random() * 2; // next one 2–4 game days out
      triggerRandomEvent();
    }
  }

  if (now - lastUiRenderAt >= UI_RENDER_MS) {
    lastUiRenderAt = now;
    renderTopBar();
    renderWarBanner();
    if (activeTab === "diplomacy" && atWarAny()) renderDiplomacyTab();
  }

  const mapInterval = state.paused ? 1000 : MAP_RENDER_MS;
  if (now - lastMapRenderAt >= mapInterval) {
    lastMapRenderAt = now;
    renderMap();
  }

  // Co-op host: broadcast the authoritative state and apply joiners' actions.
  if (typeof mpRole !== "undefined" && mpRole === "host" && typeof mpHostTick === "function") mpHostTick();
}

// Boot happens in two phases so the main menu can act as a loading screen:
//   1. bootGame()  — load all data and build the map/UI in the background.
//   2. startGame() — called when the player picks a mode from the menu; this
//                    is what actually starts the simulation ticking.
let gameReady = false;   // data loaded, map/UI built — menu can enable Play
let gameStarted = false; // simulation loop running

async function bootGame() {
  updateCityStats();
  updateNationalIndices();
  // Relief is needed before the first move order (it gates ground speed), and
  // it's only ~30 KB, so it loads with the rest of the country data.
  await Promise.all([loadRoadNetwork(), loadRailNetwork(), loadWaterNetwork(), loadRealBuildings(),
    loadBorder(), loadMunicipalities(), loadElevation(), loadResourceSites()]);
  initMap();
  initUI();
  logEvent("Government formed. Welcome, Prime Minister.");
  // Continental backdrop layers (borders + Europe-wide roads/rail/rivers/urban).
  // Loaded after the country itself so the game is playable immediately; each
  // one invalidates the static map cache as it lands so it appears without a
  // reload. All are optional — the game runs fine if any fail to load.
  const backdrop = [loadWorldBorders(), loadWorldRoads(), loadWorldRail(), loadWorldRivers(), loadWorldUrban()];
  backdrop.forEach(p => p.then(() => {
    if (typeof invalidateStaticMapCache === "function") invalidateStaticMapCache();
    if (typeof mapEngine !== "undefined" && mapEngine) mapEngine._scheduleRender();
  }).catch(() => {}));
  gameReady = true;
  if (typeof onGameReady === "function") onGameReady();
}

// mode: "single" (solo) or "coop" (shared-screen multiplayer — both players
// command the one Slovenia together).
function startGame(mode) {
  if (gameStarted) return;
  gameStarted = true;
  state.gameMode = mode || "single";
  state.coop = mode === "coop";
  setInterval(gameTick, TICK_MS);
}

window.addEventListener("DOMContentLoaded", () => {
  if (typeof initMenu === "function") initMenu();
  bootGame();
});
