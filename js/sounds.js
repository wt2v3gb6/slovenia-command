// Tiny sound-effect helper. Files live in sounds/. Browsers block autoplay
// until the first user gesture, so every play() failure is swallowed — timer
// driven sounds (event mail) simply stay silent until the player has clicked
// something once.

const SOUNDS = {
  mail: "sounds/notification.mp3",        // a new decision/event lands in the tray
  troopSelect: "sounds/click.mp3",        // selecting any unit
  infantryMove: "sounds/infantry_move.mp3", // infantry move order
  vehicleMove: "sounds/vehicle_move.mp3",   // ground-vehicle move order
  planeFly: "sounds/plane_fly.wav",         // aircraft move order
  orderA: "sounds/ukaz_sprejet.mp3",      // move order confirmed (radio voice 1)
  orderB: "sounds/enote_naprej.mp3",      // move order confirmed (radio voice 2)
  construction: "sounds/construction.mp3",// building / zone / road / rail placed
};

// Master sound settings — controlled from the Settings panel (see menu.js).
// Defaults match the previous hard-coded behaviour (on, 55% volume).
window.soundMuted = window.soundMuted || false;
window.soundVolume = (typeof window.soundVolume === "number") ? window.soundVolume : 0.55;

const soundCache = {};
function playSound(key) {
  if (window.soundMuted) return;
  const src = SOUNDS[key];
  if (!src) return;
  try {
    // Clone so rapid repeats can overlap instead of restarting one element.
    if (!soundCache[key]) { soundCache[key] = new Audio(src); soundCache[key].preload = "auto"; }
    const a = soundCache[key].cloneNode();
    a.volume = Math.max(0, Math.min(1, window.soundVolume));
    a.play().catch(() => {});
  } catch (e) { /* audio unavailable — never break the game over a sound */ }
}

// Move-order sound depends on what's actually moving: boots, tracks or wings.
function playOrderConfirm(unitType) {
  const def = typeof UNIT_TYPES !== "undefined" && UNIT_TYPES[unitType];
  if (def && def.domain === "air") { playSound("planeFly"); return; }
  if (unitType === "inf") { playSound("infantryMove"); return; }
  if (def) { playSound("vehicleMove"); return; }
  playSound(Math.random() < 0.5 ? "orderA" : "orderB");
}
