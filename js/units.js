// Unit deployment (from national inventory, at a treasury cost, only at a
// city with a military base) and real-world movement simulation.

const OFFROAD_MULT = 0.5;

function getInvField(path) {
  const [a, b] = path.split(".");
  return state.inventory[a][b];
}
function setInvField(path, val) {
  const [a, b] = path.split(".");
  state.inventory[a][b] = val;
}

function cityHasBase(cityId) {
  if (MILITARY_BASES.some(b => b.city === cityId)) return true;
  return state.completedBuildings.some(b => (b.type === "military_base" || b.type === "fob") && b.cityId === cityId);
}

// Training time (days) for a unit deployed here — driven by the best base in
// the region (full base fastest, FOB slowest, generic garrison in between).
function cityDeployDays(cityId) {
  let best = MILITARY_BASES.some(b => b.city === cityId) ? 2 : 4;
  state.completedBuildings.forEach(b => {
    if (b.cityId === cityId && BUILDING_TYPES[b.type] && BUILDING_TYPES[b.type].deployDays != null) {
      best = Math.min(best, BUILDING_TYPES[b.type].deployDays);
    }
  });
  // Conscription law / ideology scale training (recruitment) time.
  return Math.max(0.5, best * Math.max(0.3, 1 + (lawEffects().deployDaysMult || 0)));
}

// Best replenishment rate available at a point (units near a base/FOB heal
// and re-arm; a full base restores faster than an austere FOB).
function replenishRateAt(lat, lon, excludeId) {
  let rate = 0;
  // Same fix as groundSupplySourceKm: a barracks services the ground it stands
  // on, which isn't always its home city's centre.
  MILITARY_BASES.forEach(b => {
    if (b.lat != null && haversineKm(lat, lon, b.lat, b.lon) < 4) rate = Math.max(rate, 100);
    const c = cityById(b.city);
    if (c && haversineKm(lat, lon, c.lat, c.lon) < 4) rate = Math.max(rate, 100);
  });
  state.completedBuildings.forEach(b => {
    const def = BUILDING_TYPES[b.type];
    if (def && def.replenish && b.lat != null && haversineKm(lat, lon, b.lat, b.lon) < 4) rate = Math.max(rate, def.replenish);
  });
  // Mobile supply companies act as a moving base within their supply range.
  (state.units || []).forEach(s => {
    if (s.id === excludeId) return;
    const def = UNIT_TYPES[s.type];
    if (def && def.isSupply && def.replenish && (s.trainingDaysLeft || 0) <= 0 &&
        haversineKm(lat, lon, s.lat, s.lon) < (def.supplyRangeKm || 6)) rate = Math.max(rate, def.replenish);
  });
  return rate;
}

// How far a unit can SEE enemy detail. Recon has the highest radius of any unit
// in the game (that's its whole point); air units see moderately far; ordinary
// ground units only spot what's right on top of them.
function scoutRadiusKm(type) {
  if (type === "recon") return 55;      // highest in the game, by design
  const def = UNIT_TYPES[type] || {};
  if (def.domain === "air") return 28;
  if (type === "aa") return 30;         // SAM radar
  return 8;
}
// True if any ready friendly unit can scout this point (enemy detail visible).
function pointScouted(lat, lon) {
  return (state.units || []).some(u => (u.trainingDaysLeft || 0) <= 0 &&
    haversineKm(u.lat, u.lon, lat, lon) <= scoutRadiusKm(u.type));
}

// A region can field aircraft if a real military airport is nearby OR the
// player has built a Military Airbase in it.
function cityAirCapable(cityId) {
  const c = cityById(cityId);
  if (!c) return false;
  if (AIRPORTS.some(a => a.military && haversineKm(c.lat, c.lon, a.lat, a.lon) < 15)) return true;
  return state.completedBuildings.some(b => b.type === "military_airbase" && b.cityId === cityId);
}

// Aircraft refuel when parked near any friendly airport (all Slovenian
// airports + any built military airbase).
function nearestFriendlyAirportKm(lat, lon) {
  let best = Infinity;
  AIRPORTS.forEach(a => { const d = haversineKm(lat, lon, a.lat, a.lon); if (d < best) best = d; });
  state.completedBuildings.forEach(b => {
    if (b.type === "military_airbase" && b.lat != null) {
      const d = haversineKm(lat, lon, b.lat, b.lon); if (d < best) best = d;
    }
  });
  return best;
}

function unitIsAir(type) { return UNIT_TYPES[type].domain === "air"; }

// ---------------------------------------------------------------------------
// Supply
// ---------------------------------------------------------------------------
// Supply IS the unit's health pool: combat damage comes off it, and a unit that
// runs dry is lost. A formation cut off from its logistics stops being a
// formation, so there's no separate "HP" to whittle down independently.
//
// Rates are per simulated HOUR and deliberately slow outside combat — a real
// unit carries days of organic supply, so being briefly away from a base is
// nothing, while a week unsupported in the field is crippling.
const SUPPLY = {
  combatDrain: 5.0,      // in contact — ammunition, casualties, fuel burn
  airFlying: 7.0,        // aircraft airborne: ~14h of endurance from full
  airParkedOffBase: 1.5, // sat on a strip with no servicing
  groundUnsupplied: 0.30,// ~7%/day: a fortnight before a unit is combat-ineffective
  airbaseRegen: 18.0,    // turnaround at a proper airfield is quick
  baseRegen: 6.0,        // full military base / FOB resupply
  fieldRegen: 0.0,       // nothing regenerates in the open
};

function unitSupply(u) {
  // Older saves stored this as `hp`; keep them working.
  if (u.supply == null) u.supply = u.hp != null ? u.hp : 100;
  return u.supply;
}

// Is this ground unit inside a municipality that can actually sustain it?
// Real barracks, a built military base, or a FOB all count.
// NOTE: measure to the barracks' OWN coordinates, not its home city's. Cerklje
// ob Krki air base is ~4.5 km outside Brežice town, so keying off the city
// centre left units parked on the airfield reading as unsupplied.
const SUPPLY_SOURCE_RADIUS_KM = 8;
function groundSupplySourceKm(lat, lon, excludeId) {
  let best = Infinity;
  MILITARY_BASES.forEach(b => {
    if (b.lat != null) best = Math.min(best, haversineKm(lat, lon, b.lat, b.lon));
    const c = cityById(b.city);
    if (c) best = Math.min(best, haversineKm(lat, lon, c.lat, c.lon));
  });
  state.completedBuildings.forEach(b => {
    if ((b.type === "military_base" || b.type === "fob") && b.lat != null) {
      best = Math.min(best, haversineKm(lat, lon, b.lat, b.lon));
    }
  });
  // A friendly supply company is a mobile source of support in the field.
  (state.units || []).forEach(s => {
    if (s.id === excludeId) return;
    const def = UNIT_TYPES[s.type];
    if (def && def.isSupply && (s.trainingDaysLeft || 0) <= 0) {
      const d = haversineKm(lat, lon, s.lat, s.lon);
      // Normalise into the 8 km base envelope so "within its range" counts.
      if (d < (def.supplyRangeKm || 6)) best = Math.min(best, d);
    }
  });
  return best;
}

// Resupply is not free: hauling fuel, ammunition and stores to a formation
// costs money, scaled off what the unit is worth. ~12% of the unit's cost to
// take it from empty back to full.
function resupplyCostPerPoint(type) {
  return unitDeployCost(type) * 0.0012;
}

// Logistics attrition alone can't destroy a unit — it bottoms out here and the
// unit fights on (and can still move) at reduced effectiveness. Only COMBAT
// damage can take supply below this to 0 (= destroyed).
const SUPPLY_FLOOR = 8;
const REPLENISH_SUPPLY_PER_H = 28; // manual "START REPLENISHING" speed
const REPLENISH_COND_PER_H = 22;

// Draw manpower for reinforcements: active duty first, then activated reserves.
function chargeManpower(n) {
  n = Math.max(0, n);
  const fromActive = Math.min(state.econ.manpowerActive, n);
  state.econ.manpowerActive -= fromActive;
  const rest = n - fromActive;
  if (rest > 0 && state.econ.reserveActivated) state.econ.manpowerReserve = Math.max(0, state.econ.manpowerReserve - rest);
}
function replenishManpowerPerPoint(type) { return (UNIT_TYPES[type].manpower || 60) * 0.003; }

// Up-front cost estimate shown on the START REPLENISHING button.
function replenishCostEstimate(u) {
  const missSup = Math.max(0, 100 - unitSupply(u));
  const missCond = Math.max(0, 100 - (u.condition == null ? 100 : u.condition));
  const rate = resupplyCostPerPoint(u.type);
  const euros = missSup * rate + missCond * rate * 0.4;
  const manpower = Math.round(missSup * replenishManpowerPerPoint(u.type));
  return { euros, manpower, missSup, missCond };
}

// True while a unit is so short on supply it fights and moves at a penalty.
function outOfSupply(u) { return unitSupply(u) <= 20; }
// Movement / combat multiplier from low supply (1 at 25%+, down to ~0.55 empty).
function supplyEffMult(u) {
  const s = unitSupply(u);
  if (s >= 25) return 1;
  return 0.55 + (s / 25) * 0.45;
}

// Move one unit's supply for `simHours`, charging the treasury for whatever it
// actually draws. Returns the euros spent.
function tickUnitSupply(u, simHours, inCombat) {
  const air = unitIsAir(u.type);
  let supply = unitSupply(u);
  let spent = 0;

  // Manual replenish (player pressed START REPLENISHING): a fast top-up of both
  // supply AND condition, paid in treasury and MANPOWER. Only while parked in
  // supply range; auto-stops when full or when funds/manpower run out.
  if (u.replenishing && !u.moving && !inCombat) {
    const inRange = air ? nearestFriendlyAirportKm(u.lat, u.lon) < 6
                        : groundSupplySourceKm(u.lat, u.lon, u.id) < SUPPLY_SOURCE_RADIUS_KM;
    if (!inRange) { u.replenishing = false; u.lastSupplyState = "holding"; }
    else {
      const rate = resupplyCostPerPoint(u.type), mpPerPt = replenishManpowerPerPoint(u.type);
      let want = Math.min(100 - supply, REPLENISH_SUPPLY_PER_H * simHours);
      const maxByCash = rate > 0 ? state.econ.treasury / rate : want;
      const maxByMp = mpPerPt > 0 ? availableManpower() / mpPerPt : want;
      want = Math.max(0, Math.min(want, maxByCash, maxByMp));
      if (want > 0) {
        supply += want;
        spent = want * rate;
        state.econ.treasury -= spent;
        chargeManpower(want * mpPerPt);
      }
      if ((u.condition || 100) < 100) u.condition = Math.min(100, (u.condition || 100) + REPLENISH_COND_PER_H * simHours);
      u.supply = Math.max(0, Math.min(100, supply)); u.hp = u.supply;
      u.lastSupplyState = "replenishing_manual";
      if (u.supply >= 99.9 && (u.condition || 100) >= 99.9) {
        u.replenishing = false;
        logEvent(`<b>${u.name}</b> fully replenished and back to fighting shape.`);
      } else if (want <= 0) {
        u.replenishing = false; u.lastSupplyState = "unfunded";
      }
      return spent;
    }
  }

  let drain = 0, regen = 0;
  if (inCombat) drain += SUPPLY.combatDrain;

  if (air) {
    if (u.moving) drain += SUPPLY.airFlying;
    else if (nearestFriendlyAirportKm(u.lat, u.lon) < 6) regen = SUPPLY.airbaseRegen;
    else drain += SUPPLY.airParkedOffBase;
  } else {
    const nearBase = groundSupplySourceKm(u.lat, u.lon, u.id) < SUPPLY_SOURCE_RADIUS_KM;
    if (nearBase && !inCombat) regen = SUPPLY.baseRegen;
    else if (!nearBase) drain += SUPPLY.groundUnsupplied;
  }

  if (regen > 0 && supply < 100) {
    const wanted = Math.min(100 - supply, regen * simHours);
    const rate = resupplyCostPerPoint(u.type);
    const affordable = rate > 0 ? Math.min(wanted, state.econ.treasury / rate) : wanted;
    if (affordable > 0) {
      supply += affordable;
      spent = affordable * rate;
      state.econ.treasury -= spent;
    }
    u.lastSupplyState = affordable < wanted - 1e-6 ? "unfunded" : "resupplying";
  } else if (drain > 0) {
    const before = supply;
    supply -= drain * simHours;
    // Non-combat (logistics) attrition can't push a unit below the floor.
    if (!inCombat) supply = Math.max(supply, Math.min(before, SUPPLY_FLOOR));
    u.lastSupplyState = inCombat ? "combat" : "draining";
  } else {
    u.lastSupplyState = "holding";
  }

  u.supply = Math.max(0, Math.min(100, supply));
  u.hp = u.supply; // keep the legacy field in step for anything still reading it
  return spent;
}

// Plain-language reason for what supply is doing right now, so the player can
// see *why* a unit is bleeding out rather than just watching a bar fall.
function supplyStatusNote(u) {
  const air = unitIsAir(u.type);
  switch (u.lastSupplyState) {
    case "combat": return "In contact — burning supply fast";
    case "replenishing_manual": return "REPLENISHING — drawing stores & reinforcements";
    case "resupplying": return air ? "Resupplying at airfield" : "Resupplying from base";
    case "unfunded": return "Resupply halted — treasury empty";
    case "draining":
      if (air) return u.moving ? "Airborne — burning supply" : "Parked away from an airfield";
      return "Beyond base/FOB support — drawing down stores";
    default: return air ? "Secure at airfield" : "In supply";
  }
}

// Average difficulty of the ground along a path, as a multiplier >= 1 (1 = flat,
// higher = slower). Sampled from the relief grid; falls back to 1 when the grid
// isn't loaded, so movement still works without it.
//
// This was previously CALLED but never defined — the resulting ReferenceError
// threw inside confirmUnitMove(), which left units stuck on "Calculating terrain
// route…" forever because `calculatingRoute` was never cleared.
function estimateTerrainDifficulty(points) {
  if (!points || points.length < 2 || typeof terrainSpeedMult !== "function") return 1;
  let sum = 0, n = 0;
  for (let i = 1; i < points.length; i++) {
    const [aLat, aLon] = points[i - 1];
    const [bLat, bLon] = points[i];
    // Sample along each leg so a short hop over a ridge still registers.
    const steps = Math.max(1, Math.min(12, Math.round(haversineKm(aLat, aLon, bLat, bLon) / 3)));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const mult = terrainSpeedMult(aLat + (bLat - aLat) * t, aLon + (bLon - aLon) * t);
      sum += 1 / Math.max(0.1, mult);
      n++;
    }
  }
  return n ? clamp(sum / n, 1, 4) : 1;
}

function supplyLabel(s) {
  if (s >= 85) return "Fully supplied";
  if (s >= 60) return "Adequate";
  if (s >= 35) return "Running low";
  if (s >= 15) return "Critical — combat power failing";
  return "Out of supply — unit disintegrating";
}

// Per-class combat multipliers from research (atk_inf, def_armor, ...) plus
// global event modifiers (unitAttackMult / unitDefenseMult). Better weapons
// hit harder; better armor makes units absorb hits and survive longer.
const UNIT_CLASS = {
  inf: "inf", recon: "inf",
  ifv: "armor", mbt: "armor",
  arty: "arty", aa: "aa",
  fighter: "air", attack_air: "air", bomber: "air",
  recon_drone: "drone", attack_drone: "drone",
};
function unitCombatMult(type, stat) {
  const te = state.techEffects, me = modifierEffects();
  const cls = UNIT_CLASS[type] || "inf";
  let m = 1;
  if (stat === "attack") m += (me.unitAttackMult || 0) + (te.atk_all || 0) + (te["atk_" + cls] || 0);
  else m += (me.unitDefenseMult || 0) + (te.def_all || 0) + (te["def_" + cls] || 0);
  return Math.max(0.2, m);
}

function unitDeployCost(type) {
  return UNIT_TYPES[type].cost * (1 + (state.techEffects.unitCostMult || 0) + (lawEffects().unitCostMult || 0));
}
function unitEffectiveSpeed(type) {
  return UNIT_TYPES[type].speed * (1 + (state.techEffects.unitSpeedMult || 0));
}

// Rise-of-Nations style: units are trained on demand, paid for with treasury +
// manpower. Ground units need a military base; air units need a military
// airbase / airport.
function canDeploy(type, cityId) {
  const def = UNIT_TYPES[type];
  if (cityId) {
    if (def.domain === "air" || def.requiresAirbase) {
      if (!cityAirCapable(cityId)) return false;
    } else if (!cityHasBase(cityId)) return false;
  }
  return availableManpower() >= def.manpower &&
    state.econ.treasury >= unitDeployCost(type);
}

// Find a free spawn spot near a city so freshly trained units don't stack on
// top of each other: spiral outward in ~600 m steps until clear of others.
function freeSpawnSpot(lat, lon) {
  const clear = (la, lo) => !state.units.some(u => haversineKm(u.lat, u.lon, la, lo) < 0.45);
  if (clear(lat, lon)) return { lat, lon };
  for (let ring = 1; ring <= 6; ring++) {
    const r = ring * 0.006; // ≈ 0.65 km per ring
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + ring * 0.4;
      const la = lat + Math.sin(a) * r, lo = lon + Math.cos(a) * r * 1.4;
      if (clear(la, lo)) return { lat: la, lon: lo };
    }
  }
  return { lat, lon };
}

// Forget every unit's orders and stop each where it is. Returns how many units
// actually had an order cancelled. Shared by the H shortcut and co-op relay.
function haltAllUnits() {
  let n = 0;
  (state.units || []).forEach(u => {
    if (u.moving || (u.path && u.path.length) || u.preparing) n++;
    u.moving = false; u.path = []; u.preparing = false; u.crossPrepLeft = null;
  });
  state.pendingWaypoints = [];
  return n;
}

function deployUnit(type, cityId) {
  // Co-op: a joined player's deploy is executed by the authoritative host.
  if (typeof mpRelayIfClient === "function" && mpRelayIfClient("deployUnit", { type, cityId })) return null;
  const def = UNIT_TYPES[type];
  if (!canDeploy(type, cityId)) return null;
  const city = cityById(cityId);
  if (!city) return null;

  // Draw from active duty first, only dip into activated reserves once
  // active is exhausted.
  const fromActive = Math.min(state.econ.manpowerActive, def.manpower);
  state.econ.manpowerActive -= fromActive;
  const remainder = def.manpower - fromActive;
  if (remainder > 0) state.econ.manpowerReserve -= remainder;
  state.econ.treasury -= unitDeployCost(type);

  const spot = freeSpawnSpot(city.lat, city.lon);
  const unit = {
    id: state.unitSeq++,
    type,
    name: `${def.label} #${state.unitSeq - 1}`,
    lat: spot.lat, lon: spot.lon,
    cityId: city.id,
    path: [],
    moving: false,
    supply: 100,          // doubles as the unit's health pool — see tickUnitSupply
    hp: 100,              // legacy mirror of `supply`, kept in step for old code
    condition: 100,       // equipment/readiness status, decays with travel
    exp: 0,               // veterancy — grows with battles; drives stars (see unitStars)
    wins: 0, battles: 0,  // battle record
    replenishing: false,  // manual "START REPLENISHING" in progress
    freePath: false,      // if true, ignores road snapping on next move order
    fuelKm: def.fuelKm || null,     // air units only
    maxFuelKm: def.fuelKm || null,
    trainingDaysLeft: cityDeployDays(cityId), // deploys after training time
    trainingDaysTotal: cityDeployDays(cityId), // for the map progress ring
  };
  state.units.push(unit);
  // Deliberately NOT selected: a newly ordered unit is still in training, and
  // auto-selecting it stole the selection (and the panel) from whatever the
  // player was actually doing. Click it when it's ready.
  return unit;
}

// Turn the queued waypoints into a flat lat/lon path. Routing is now always
// point-to-point (snapped to the nearest road-graph node), not tied to
// clicking a specific named city — municipality clicks don't carry a
// cityId, so requiring one meant units silently stopped using roads at all
// once city dots went away. "Free path" mode opts out of roads entirely and
// pays a one-time terrain/water-crossing speed penalty instead.
async function confirmUnitMove() {
  const u = state.units.find(x => x.id === state.selectedUnitId);
  if (!u || !state.pendingWaypoints.length) return;
  const waypoints = state.pendingWaypoints.slice();
  state.pendingWaypoints = [];
  // In co-op, a joined player's move order is executed by the host (which owns
  // the authoritative sim). Send the explicit unit id + waypoints so it doesn't
  // depend on the host's own selection.
  if (typeof mpRelayIfClient === "function" && mpRelayIfClient("moveUnit", {
    unitId: u.id, freePath: !!u.freePath,
    waypoints: waypoints.map(w => ({ lat: w.lat, lon: w.lon, cityId: w.cityId || null })),
  })) { if (typeof renderPendingLine === "function") renderPendingLine(); return; }
  await applyMoveOrder(u, waypoints);
}

// Core move-order logic, taking an explicit unit + waypoints (u.freePath must
// already be set). Used both by the local confirmUnitMove() and by the host
// when it replays a joined player's "moveUnit" command.
async function applyMoveOrder(u, waypoints) {
  if (!u || !waypoints || !waypoints.length) return;
  let fullPath;
  if (unitIsAir(u.type)) {
    // Aircraft fly straight between waypoints — no roads, no terrain/water
    // penalties (they're in the air). They burn fuel per km instead.
    fullPath = waypoints.map(wp => ({ lat: wp.lat, lon: wp.lon, cityId: wp.cityId || null, onRoad: true, roadSpeedMult: 1 }));
  } else if (u.freePath) {
    fullPath = waypoints.map(wp => ({ lat: wp.lat, lon: wp.lon, cityId: wp.cityId || null, onRoad: false }));
    u.calculatingRoute = true;
    updateSelectedUnitBox();
    // Mountains/hills slow an off-road column: elevation change along the path
    // becomes a base off-road speed. (Bounded + timed out so it never hangs.)
    const allPts = [[u.lat, u.lon], ...fullPath.map(p => [p.lat, p.lon])];
    const terrainMult = await estimateTerrainDifficulty(allPts);
    const terrainOffroad = clamp(1 / terrainMult, 0.2, OFFROAD_MULT);
    fullPath.forEach(p => p.offRoadSpeedMult = terrainOffroad);
    u.calculatingRoute = false;
  } else {
    fullPath = [];
    let lastPoint = { lat: u.lat, lon: u.lon };
    for (const wp of waypoints) {
      const routePoints = findRoute(lastPoint, { lat: wp.lat, lon: wp.lon, cityId: wp.cityId });
      if (routePoints && routePoints.length) {
        fullPath.push(...routePoints);
      } else {
        fullPath.push({ lat: wp.lat, lon: wp.lon, cityId: wp.cityId || null, onRoad: false });
      }
      lastPoint = { lat: wp.lat, lon: wp.lon };
    }
  }

  // Water is the big one: any off-road segment on or beside a river/lake/pond
  // is much slower (and needs prep time to cross — see tickUnits). Ground only.
  if (!unitIsAir(u.type)) applyWaterPenalties(fullPath);

  // Transit through a foreign country needs permission (unless already at war
  // with them). Ask the player; a denial/cancel aborts the move.
  const foreign = foreignCountryOnPath(fullPath);
  if (foreign) {
    const decision = await requestTransit(foreign);
    if (decision !== "granted") { u.moving = false; updateSelectedUnitBox(); return; }
  }

  u.path = fullPath;
  u.moving = true;
  u.replenishing = false; // moving out of the depot cancels a manual replenish
  u.cityId = null;
  playOrderConfirm(u.type); // boots / tracks / wings, per unit type
  updateSelectedUnitBox();
}

function applyWaterPenalties(path) {
  for (const p of path) {
    if (p.onRoad) continue; // bridges/roads cross water fine
    const waterKm = nearestWaterDistanceKm(p.lat, p.lon);
    let m = p.offRoadSpeedMult || OFFROAD_MULT;
    if (waterKm < 0.15) { m = Math.min(m, 0.12); p.waterCrossing = true; } // fording — way slower + needs prep
    else if (waterKm < 0.5) m = Math.min(m, 0.28);                          // boggy ground near water
    p.offRoadSpeedMult = m;
  }
}

// Hours a unit needs to prepare before fording water — tanks/artillery need
// bridging/ferrying and take far longer than infantry.
function waterPrepHours(type) {
  const def = UNIT_TYPES[type];
  if (def.domain === "air") return 0;
  return ({ mbt: 14, arty: 11, aa: 9, ifv: 8 })[type] || 4;
}

// Nearest neighbor by their real border crossings — used to attribute foreign
// ground when precise country polygons aren't loaded.
function nearestNeighborByEntry(lat, lon) {
  let best = null, bd = Infinity;
  for (const id in NEIGHBOR_NATIONS) {
    for (const ep of NEIGHBOR_NATIONS[id].entryPoints) {
      const d = haversineKm(lat, lon, ep.lat, ep.lon);
      if (d < bd) { bd = d; best = id; }
    }
  }
  return best;
}

// First non-hostile neighbor whose territory the path enters (null if none).
function foreignCountryOnPath(path) {
  for (const p of path) {
    if (typeof isOutsideSlovenia === "function" && !isOutsideSlovenia(p.lat, p.lon)) continue;
    let c = typeof countryForPoint === "function" ? countryForPoint(p.lat, p.lon) : null;
    if (!c) c = nearestNeighborByEntry(p.lat, p.lon);
    if (c && state.diplomacy && state.diplomacy.nations[c] && !state.diplomacy.nations[c].atWar) return c;
  }
  return null;
}

function tickUnits(simHours) {
  // Units still in training don't move until their deploy time elapses.
  for (const u of state.units) {
    if (u.trainingDaysLeft > 0) { u.trainingDaysLeft = Math.max(0, u.trainingDaysLeft - simHours / 24); }
  }

  const crashed = [];
  for (const u of state.units) {
    if (u.trainingDaysLeft > 0) continue;
    if (!u.moving || !u.path.length) continue;
    const air = unitIsAir(u.type);

    // Water-crossing prep gate: before fording, the unit spends prep time
    // (tanks longest). It sits in place "preparing to cross" until ready.
    const next = u.path[0];
    if (next && next.waterCrossing && !next._prepped) {
      if (u.crossPrepLeft == null) u.crossPrepLeft = waterPrepHours(u.type);
      u.crossPrepLeft -= simHours;
      if (u.crossPrepLeft > 0) { u.preparing = true; continue; } // still preparing, no move this tick
      next._prepped = true; u.crossPrepLeft = null; u.preparing = false;
    }

    // Out-of-supply units still move, but slower (see supplyEffMult).
    const speed = unitEffectiveSpeed(u.type) * supplyEffMult(u);
    let remainingKm = speed * simHours;
    let traveledKm = 0;

    while (remainingKm > 0 && u.path.length) {
      const target = u.path[0];
      const distKm = haversineKm(u.lat, u.lon, target.lat, target.lon);
      let speedMult = target.onRoad ? (target.roadSpeedMult || 1) : (target.offRoadSpeedMult || OFFROAD_MULT);
      // Relief: ground units labour uphill. Roads are engineered around the
      // worst of it (cuttings, tunnels, switchbacks), so on-road movement only
      // takes a fraction of the penalty — off-road it applies in full.
      if (!air) {
        const terr = terrainSpeedMult(target.lat, target.lon);
        speedMult *= target.onRoad ? (1 - (1 - terr) * 0.35) : terr;
      }
      const travelableKm = remainingKm * speedMult;

      if (distKm <= travelableKm || distKm < 0.02) {
        u.lat = target.lat; u.lon = target.lon;
        if (target.cityId) u.cityId = target.cityId;
        u.path.shift();
        const usedKm = distKm / speedMult;
        remainingKm -= usedKm;
        traveledKm += distKm;
      } else {
        const frac = travelableKm / distKm;
        u.lat += (target.lat - u.lat) * frac;
        u.lon += (target.lon - u.lon) * frac;
        traveledKm += distKm * frac;
        remainingKm = 0;
      }
    }
    if (!u.path.length) u.moving = false;

    // Aircraft burn fuel with distance; running dry mid-air loses the aircraft.
    if (air && u.maxFuelKm && traveledKm > 0) {
      u.fuelKm = Math.max(0, (u.fuelKm || 0) - traveledKm);
      if (u.fuelKm <= 0) { crashed.push(u); continue; }
    }
    // Equipment condition slowly degrades with distance covered.
    if (traveledKm > 0) u.condition = Math.max(15, u.condition - traveledKm * (air ? 0.006 : 0.01));
  }

  // Stationary upkeep: aircraft refuel near a friendly airport; ground units
  // slowly restore readiness.
  for (const u of state.units) {
    const air = unitIsAir(u.type);
    if (air) {
      if (!u.moving && u.maxFuelKm && u.fuelKm < u.maxFuelKm && nearestFriendlyAirportKm(u.lat, u.lon) < 6) {
        u.fuelKm = Math.min(u.maxFuelKm, u.fuelKm + u.maxFuelKm * simHours * 0.25);
      }
    } else if (!u.moving) {
      // Near a base/FOB, equipment condition recovers (supply is handled below).
      const rep = replenishRateAt(u.lat, u.lon);
      const healRate = 0.05 + (rep / 100) * 0.6; // FOB ~0.29/h, full base ~0.65/h
      if (u.condition < 100) u.condition = Math.min(100, u.condition + simHours * healRate);
    }
  }

  // Supply: drains in contact / away from support, refills (for a price) at a
  // base or airfield. Units that run dry are lost the same way as in combat.
  // `engagedUnitIds` is populated by tickEnemyUnits each tick.
  let resupplyBill = 0;
  const inContact = state.engagedUnitIds || new Set();
  for (const u of state.units) {
    if (u.trainingDaysLeft > 0) { unitSupply(u); continue; }
    resupplyBill += tickUnitSupply(u, simHours, inContact.has(u.id));
  }
  if (resupplyBill > 0) state.econ.lastResupplySpend = resupplyBill;

  const starved = state.units.filter(u => u.supply <= 0);
  if (starved.length) {
    state.units = state.units.filter(u => u.supply > 0);
    starved.forEach(u => {
      if (state.selectedUnitId === u.id && typeof deselectAll === "function") deselectAll();
      logEvent(`<b style="color:#e06c60">${u.name} ran out of supply</b> near ${nearestCityName(u.lat, u.lon)} and disbanded — keep units near a base, FOB or airfield.`);
    });
  }

  if (crashed.length) {
    state.units = state.units.filter(u => !crashed.includes(u));
    crashed.forEach(u => {
      if (state.selectedUnitId === u.id && typeof deselectAll === "function") deselectAll();
      logEvent(`<b style="color:#e06c60">${u.name} ran out of fuel</b> and was lost — route aircraft through friendly airports to refuel.`);
    });
  }
}

function conditionLabel(c) {
  if (c >= 90) return "Excellent";
  if (c >= 70) return "Good";
  if (c >= 45) return "Fair — needs maintenance";
  if (c >= 20) return "Poor — combat effectiveness reduced";
  return "Critical — urgent overhaul needed";
}

function updateSelectedUnitBox() {
  const box = document.getElementById("selectedUnitBox");
  const panel = document.getElementById("unitPanel");
  if (!box) return;
  const u = state.units.find(x => x.id === state.selectedUnitId);
  if (!u) {
    box.innerHTML = "No unit selected.";
    if (panel) panel.classList.add("hidden");
    if (typeof layoutBottomLeftPanels === "function") layoutBottomLeftPanels();
    return;
  }
  if (panel) panel.classList.remove("hidden");
  const def = UNIT_TYPES[u.type];
  const air = unitIsAir(u.type);
  const loc = u.cityId ? cityById(u.cityId).name : "in transit";
  const stat = (label, val) => `<span class="ustat"><i>${label}</i><b>${val}</b></span>`;
  const fuelPct = air && u.maxFuelKm ? Math.round((u.fuelKm / u.maxFuelKm) * 100) : null;
  const sup = unitSupply(u);
  const bar = (label, pct, color, valText) => `
    <div class="uBarRow">
      <span class="uBarLabel">${label}</span>
      <span class="uBarTrack"><span class="uBarFill" style="width:${Math.max(0, Math.min(100, pct))}%;background:${color}"></span></span>
      <span class="uBarVal" style="color:${color}">${valText}</span>
    </div>`;
  const supColor = sup >= 60 ? "#7fe0a0" : sup >= 35 ? "#e0c97f" : "#e06c60";
  const condColor = u.condition >= 70 ? "#7fe0a0" : u.condition >= 40 ? "#e0c97f" : "#e06c60";

  const stars = unitStars(u);
  const engagedNow = state.engagedUnitIds && state.engagedUnitIds.has(u.id);
  const est = replenishCostEstimate(u);
  const inSupplyRange = air ? nearestFriendlyAirportKm(u.lat, u.lon) < 6
                            : groundSupplySourceKm(u.lat, u.lon, u.id) < SUPPLY_SOURCE_RADIUS_KM;
  const needsReplenish = sup < 99.5 || (u.condition || 100) < 99.5;
  let replenishBtn = "";
  if (u.trainingDaysLeft <= 0 && !u.moving) {
    if (u.replenishing) {
      replenishBtn = `<button class="uBtn" id="unitReplenishBtn">■ STOP REPLENISHING</button>
        <div class="usupplyNote" style="color:#7fe0a0">REPLENISHING — drawing stores &amp; reinforcements</div>`;
    } else if (needsReplenish && inSupplyRange) {
      replenishBtn = `<button class="uBtn" id="unitReplenishBtn">▶ START REPLENISHING</button>
        <div class="usupplyNote">Cost ≈ <b>${fmtEUR(est.euros)}</b> + <b>${fmtNum(est.manpower)}</b> manpower to full</div>`;
    } else if (needsReplenish) {
      replenishBtn = `<div class="usupplyNote">Park next to a base, FOB or Supply Company to replenish.</div>`;
    }
  }
  const battleBtn = engagedNow ? `<button class="uBtn uBtnWar" id="unitBattleBtn">⚔ View Battle</button>` : "";

  const status = u.trainingDaysLeft > 0
    ? `<span style="color:#e0c97f">Training — ready in ${u.trainingDaysLeft.toFixed(1)}d</span>`
    : u.calculatingRoute ? "Calculating terrain route…"
    : u.preparing ? `<span style="color:#e0c97f">Preparing to cross water (${Math.ceil(u.crossPrepLeft || 0)}h left)…</span>`
    : u.moving ? `Moving — ${u.path.length} waypoint(s) left`
    : "Stationary";

  box.innerHTML = `
    ${def.image ? `<img class="unitPanelImg" src="${def.image}" alt="${def.label}" onerror="this.style.display='none'">` : ""}
    <div class="uTitle">${u.name}
      <span class="udomain ${air ? "air" : "ground"}">${air ? svgIcon("plane") + " AIR" : svgIcon("military") + " GROUND"}</span>
    </div>
    <div class="uSubline">${def.label} · ${loc}</div>

    ${bar("Supply", sup, supColor, sup.toFixed(0) + "%")}
    <div class="usupplyNote">${supplyLabel(sup)} — ${supplyStatusNote(u)}</div>
    <div class="usupplyNote">Full resupply ≈ ${fmtEUR(resupplyCostPerPoint(u.type) * (100 - sup))}</div>

    ${bar("Condition", u.condition, condColor, u.condition.toFixed(0) + "%")}
    <div class="usupplyNote">${conditionLabel(u.condition)}</div>

    ${air && fuelPct != null ? bar("Fuel", fuelPct, fuelPct < 25 ? "#e06c60" : "#7fb0e0", fuelPct + "%") +
      `<div class="usupplyNote">${fmtNum(Math.round(u.fuelKm))} km range left — refuels at friendly airports</div>` : ""}

    <div class="uSection">COMBAT</div>
    <div class="ustatgrid">
      ${stat("ATK", Math.round(def.attack * unitCombatMult(u.type, "attack")) + (unitCombatMult(u.type, "attack") !== 1 ? "*" : ""))}
      ${stat("DEF", Math.round(def.defense * unitCombatMult(u.type, "defense")) + (unitCombatMult(u.type, "defense") !== 1 ? "*" : ""))}
      ${def.airAttack ? stat("AA", def.airAttack) : ""}
      ${stat("SPD", unitEffectiveSpeed(u.type).toFixed(0) + "km/h")}
      ${stat("RNG", def.range + "km")}
      ${stat("MEN", def.manpower)}
    </div>

    <div class="uSection">VETERANCY</div>
    <div class="uVet"><span class="uStars">${starString(stars)}</span> ${stars}/5 · +${Math.round((unitExpMult(u) - 1) * 100)}% combat · ${u.wins || 0} win${(u.wins || 0) === 1 ? "" : "s"}</div>

    <div class="uSection">ORDERS</div>
    <div>${status}</div>
    ${battleBtn}
    ${replenishBtn}
    ${air ? "" : `<label style="display:block;margin-top:5px;"><input type="checkbox" id="unitFreePathToggle" ${u.freePath ? "checked" : ""}> Ignore roads — follow exact drawn path <kbd>X</kbd></label>`}
    ${state.pendingWaypoints.length
      ? `<div style="color:#e0c97f;margin-top:5px">${state.pendingWaypoints.length} pending waypoint(s)</div>`
      : ""}
    <div class="uKeyHint" style="margin-top:6px">
      <kbd>Enter</kbd> move · <kbd>Backspace</kbd> undo · <kbd>Esc</kbd> cancel${air ? "" : " · <kbd>X</kbd> roads"}
    </div>
  `;
  const toggle = document.getElementById("unitFreePathToggle");
  if (toggle) toggle.addEventListener("change", (e) => { u.freePath = e.target.checked; });
  const rb = document.getElementById("unitReplenishBtn");
  if (rb) rb.addEventListener("click", () => {
    u.replenishing = !u.replenishing;
    if (u.replenishing) logEvent(`<b>${u.name}</b> begins replenishing — drawing supply and reinforcements from the depot.`);
    updateSelectedUnitBox();
    if (typeof mapEngine !== "undefined" && mapEngine) mapEngine._scheduleRender();
  });
  const bb = document.getElementById("unitBattleBtn");
  if (bb && typeof openBattleModal === "function") bb.addEventListener("click", () => openBattleModal({ friendlyUnitId: u.id }));
  if (typeof layoutBottomLeftPanels === "function") layoutBottomLeftPanels();
}
