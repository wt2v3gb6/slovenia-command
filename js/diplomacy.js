// Diplomacy & war with Slovenia's four real neighbors. Relations, tension,
// pacts, EU/NATO standing, and — if things go badly — a shooting war fought
// on the real map: enemy battlegroups enter at real border crossings and
// advance down the real road network toward Ljubljana.
//
// Real-world starting data (mid-2020s figures, order-of-magnitude accurate):
// population, nominal GDP, active-duty military size, and the actual state of
// each bilateral relationship (e.g. Croatia lower due to the Piran Bay
// arbitration dispute and the Krško nuclear waste question).

const NEIGHBOR_NATIONS = {
  ITA: {
    name: "Italy", flag: "🇮🇹", pop: 58_900_000, gdp: 2_192e9, milActive: 165_500,
    eu: true, nato: true,
    blurb: "Largest neighbor and #2 trade partner. Rivalry between Trieste and Koper ports; Slovene minority in Friuli–Venezia Giulia.",
    // Real crossings: Fernetti/Sežana, Rabuiese/Škofije, Vrtojba (Nova Gorica)
    entryPoints: [
      { lat: 45.709, lon: 13.874, label: "Sežana/Fernetti" },
      { lat: 45.592, lon: 13.795, label: "Škofije/Rabuiese" },
      { lat: 45.925, lon: 13.638, label: "Vrtojba" },
    ],
    tradePactGrowth: 0.0020,
  },
  AUT: {
    name: "Austria", flag: "🇦🇹", pop: 9_160_000, gdp: 473e9, milActive: 22_500,
    eu: true, nato: false, // Austria is constitutionally neutral
    blurb: "Key transit and investment partner; Slovene-speaking minority in Carinthia. Periodically reinstates Schengen border checks at the Karavanke crossing.",
    entryPoints: [
      { lat: 46.443, lon: 14.008, label: "Karavanke Tunnel" },
      { lat: 46.678, lon: 15.647, label: "Šentilj" },
      { lat: 46.427, lon: 14.257, label: "Ljubelj Pass" },
    ],
    tradePactGrowth: 0.0015,
  },
  HUN: {
    name: "Hungary", flag: "🇭🇺", pop: 9_580_000, gdp: 202e9, milActive: 21_600,
    eu: true, nato: true,
    blurb: "Shares the Prekmurje frontier; Hungarian minority around Lendava. Energy and rail corridors east; occasional friction over media investments.",
    entryPoints: [
      { lat: 46.535, lon: 16.478, label: "Pince/Lendava" },
      { lat: 46.822, lon: 16.328, label: "Hodoš" },
    ],
    tradePactGrowth: 0.0008,
  },
  CRO: {
    name: "Croatia", flag: "🇭🇷", pop: 3_850_000, gdp: 82e9, milActive: 14_300,
    eu: true, nato: true,
    blurb: "Longest border and closest cultural ties — but also the Piran Bay arbitration dispute, the Krško nuclear-waste question, and the old Ljubljanska banka claims.",
    entryPoints: [
      { lat: 45.855, lon: 15.690, label: "Obrežje" },
      { lat: 46.216, lon: 15.930, label: "Gruškovje" },
      { lat: 45.500, lon: 14.258, label: "Jelšane" },
      { lat: 45.475, lon: 13.615, label: "Sečovlje" },
    ],
    tradePactGrowth: 0.0012,
  },
};

// Combat now reads each unit's own attack/range stats (see UNIT_TYPES).
const POWER_SCALE = 6; // tunes attack stat into the strength scale used below
const ENGAGE_RANGE_KM = 5; // fallback if a unit has no explicit range
// Operational advance rate, not vehicle top speed: an invading column
// secures ground as it moves, so it crawls (~60 km/day). This is what gives
// the player time to mobilize and intercept before cities start falling.
const ENEMY_SPEED_KMH = 2.5;

function initDiplomacyState() {
  if (state.diplomacy) return;
  state.diplomacy = {
    euNatoStanding: 82, // 0-100 standing with EU/NATO institutions
    sanctioned: false,
    nations: {
      ITA: { relation: 74, tension: 5,  tradePact: false, nonAggression: false, atWar: false, cooldowns: {} },
      AUT: { relation: 76, tension: 4,  tradePact: false, nonAggression: false, atWar: false, cooldowns: {} },
      HUN: { relation: 66, tension: 10, tradePact: false, nonAggression: false, atWar: false, cooldowns: {} },
      CRO: { relation: 62, tension: 16, tradePact: false, nonAggression: false, atWar: false, cooldowns: {} },
    },
    wars: [],        // { nation, aggressor:'them'|'player', startDate, wavesPlanned, wavesLaunched, nextWaveInDays, strengthCommitted, strengthDestroyed, occupied:[cityId], ljFallDays }
    enemyUnits: [],  // { id, nation, strength, initialStrength, lat, lon, path, targetCityId, engaged }
    enemySeq: 1,
    capturedMunicipalities: {}, // municipalityId -> occupying nation id (their people/output/industry now serve the enemy)
  };
}
initDiplomacyState();

function natState(id) { return state.diplomacy.nations[id]; }
function warWith(id) { return state.diplomacy.wars.find(w => w.nation === id) || null; }
function atWarAny() { return state.diplomacy.wars.length > 0; }

// ---- Aggregate effects read by economy.js ----
function diplomacyGrowthBonus() {
  let g = 0;
  for (const id in NEIGHBOR_NATIONS) {
    if (natState(id).tradePact) g += NEIGHBOR_NATIONS[id].tradePactGrowth;
  }
  if (state.diplomacy.sanctioned) g -= 0.020;   // EU/NATO sanctions bite hard
  if (atWarAny()) g -= 0.015;                    // wartime disruption
  return g;
}

function diplomacyStabilityDelta() {
  let d = 0;
  if (atWarAny()) d -= 0.08;
  if (state.diplomacy.sanctioned) d -= 0.05;
  for (const w of state.diplomacy.wars) d -= w.occupied.length * 0.15;
  return d;
}

// ---- Diplomatic actions ----
function actionCooldownLeft(id, action) {
  const until = natState(id).cooldowns[action];
  return until && state.date < new Date(until) ? Math.ceil((new Date(until) - state.date) / 86400000) : 0;
}
function setCooldown(id, action, days) {
  natState(id).cooldowns[action] = new Date(state.date.getTime() + days * 86400000).toISOString();
}
function changeRelation(id, amount) {
  const n = natState(id);
  n.relation = clamp(n.relation + amount, 0, 100);
  if (n.tradePact && n.relation < 45) {
    n.tradePact = false;
    logEvent(`<b>${NEIGHBOR_NATIONS[id].name}</b> suspends the economic partnership — relations have deteriorated too far.`);
  }
}

const DIPLO_ACTIONS = {
  envoy: {
    label: "Send Envoy", cost: 2e6, cooldownDays: 45,
    desc: "+3–6 relations",
    can: (id) => !natState(id).atWar,
    run: (id) => {
      const gain = 3 + Math.round(Math.random() * 3);
      changeRelation(id, gain);
      logEvent(`Diplomatic mission to <b>${NEIGHBOR_NATIONS[id].name}</b> concludes successfully (+${gain} relations).`);
    },
  },
  summit: {
    label: "Bilateral Summit", cost: 10e6, cooldownDays: 180,
    desc: "+7–11 relations, −15 tension",
    can: (id) => !natState(id).atWar && natState(id).relation >= 35,
    run: (id) => {
      const gain = 7 + Math.round(Math.random() * 4);
      changeRelation(id, gain);
      natState(id).tension = clamp(natState(id).tension - 15, 0, 100);
      logEvent(`Heads-of-government summit with <b>${NEIGHBOR_NATIONS[id].name}</b> (+${gain} relations, tensions ease).`);
    },
  },
  tradePact: {
    label: "Economic Partnership", cost: 25e6, cooldownDays: 120,
    desc: (id) => `Permanent +${(NEIGHBOR_NATIONS[id].tradePactGrowth * 100).toFixed(2)}%/yr GDP growth while relations ≥ 45`,
    can: (id) => !natState(id).atWar && !natState(id).tradePact && natState(id).relation >= 65,
    reqNote: "requires relations ≥ 65",
    run: (id) => {
      natState(id).tradePact = true;
      logEvent(`<b>Economic partnership signed with ${NEIGHBOR_NATIONS[id].name}</b> — deeper supply-chain and investment integration.`);
    },
  },
  nonAggression: {
    label: "Non-Aggression Pact", cost: 5e6, cooldownDays: 120,
    desc: "Halves tension growth with this nation",
    can: (id) => !natState(id).atWar && !natState(id).nonAggression && natState(id).relation >= 55,
    reqNote: "requires relations ≥ 55",
    run: (id) => {
      natState(id).nonAggression = true;
      logEvent(`Non-aggression pact signed with <b>${NEIGHBOR_NATIONS[id].name}</b>.`);
    },
  },
  hardline: {
    label: "Hardline Stance", cost: 0, cooldownDays: 60,
    desc: "+2 stability at home, −8–12 relations, +10 tension",
    can: (id) => !natState(id).atWar,
    run: (id) => {
      const loss = 8 + Math.round(Math.random() * 4);
      changeRelation(id, -loss);
      natState(id).tension = clamp(natState(id).tension + 10, 0, 100);
      state.econ.stability = clamp(state.econ.stability + 2, 0, 100);
      logEvent(`Government takes a <b>hardline stance</b> toward ${NEIGHBOR_NATIONS[id].name} (−${loss} relations, domestic base rallies).`);
    },
  },
};

function runDiploAction(id, actionKey) {
  const a = DIPLO_ACTIONS[actionKey];
  if (!a) return false;
  if (actionCooldownLeft(id, actionKey) > 0) return false;
  if (!a.can(id) || state.econ.treasury < a.cost) return false;
  state.econ.treasury -= a.cost;
  a.run(id);
  setCooldown(id, actionKey, a.cooldownDays);
  renderDiplomacyTab();
  return true;
}

// ---- War ----
function declareWar(id, aggressor) {
  const n = natState(id);
  if (n.atWar) return;
  n.atWar = true;
  n.nonAggression = false;
  n.tradePact = false;
  n.relation = clamp(Math.min(n.relation, 15), 0, 100);
  n.tension = 100;

  const def = NEIGHBOR_NATIONS[id];
  // Committed force: political reality caps how much of an army a modern
  // European state throws at a border war. Bigger if the player started it.
  const base = clamp(def.milActive * 0.30, 2500, 8000);
  const committed = aggressor === "player" ? base * 1.35 : base;

  const war = {
    nation: id, aggressor,
    startDate: new Date(state.date).toISOString(),
    wavesPlanned: 3, wavesLaunched: 0, nextWaveInDays: 0,
    strengthCommitted: 0, strengthTotal: Math.round(committed),
    strengthDestroyed: 0,
    occupied: [], ljFallDays: 0,
  };
  state.diplomacy.wars.push(war);

  if (aggressor === "player") {
    // Attacking a fellow EU (and mostly NATO) member is diplomatic suicide.
    state.diplomacy.euNatoStanding = clamp(state.diplomacy.euNatoStanding - 60, 0, 100);
    logEvent(`<b style="color:#e06c60">WAR: Slovenia declares war on ${def.name}.</b> The EU and NATO respond with immediate sanctions and suspension procedures.`);
  } else {
    state.diplomacy.euNatoStanding = clamp(state.diplomacy.euNatoStanding + 6, 0, 100);
    logEvent(`<b style="color:#e06c60">WAR: ${def.name} opens hostilities against Slovenia.</b> Allied consultations under way — Slovenia fights with alliance backing.`);
  }
  state.econ.stability = clamp(state.econ.stability - (aggressor === "player" ? 12 : 6), 0, 100);
  renderDiplomacyTab();
  renderWarBanner();
}

function alliedSupportMult(war) {
  // Defender with good EU/NATO standing fights with allied intel, logistics
  // and air policing behind it. An aggressor gets nothing.
  if (war.aggressor !== "them") return 1.0;
  return 1.0 + clamp(state.diplomacy.euNatoStanding / 100, 0, 1) * 1.5;
}

function spawnInvasionWave(war) {
  const def = NEIGHBOR_NATIONS[war.nation];
  war.wavesLaunched++;
  const remaining = war.strengthTotal - war.strengthCommitted;
  const waveStrength = war.wavesLaunched === war.wavesPlanned ? remaining : Math.round(war.strengthTotal / war.wavesPlanned);
  const groups = Math.min(2 + Math.floor(Math.random() * 2), def.entryPoints.length);
  const per = Math.round(waveStrength / groups);

  // Give each battlegroup a recognisable composition so the player can see what
  // TYPE of troops they're facing (with recon or in battle you also see detail).
  const ENEMY_KINDS = [
    { kind: "mech",  label: "Mechanized Battlegroup", image: commonsImage("BMP-2_(Croatia).jpg") },
    { kind: "armor", label: "Armored Battlegroup",    image: commonsImage("M-84_tank.jpg") },
    { kind: "inf",   label: "Infantry Battalion",     image: commonsImage("Soldiers_marching.jpg") },
    { kind: "arty",  label: "Artillery Group",        image: commonsImage("Howitzer_firing.jpg") },
  ];
  for (let g = 0; g < groups; g++) {
    const entry = def.entryPoints[Math.floor(Math.random() * def.entryPoints.length)];
    const kind = ENEMY_KINDS[Math.floor(Math.random() * ENEMY_KINDS.length)];
    const unit = {
      id: state.diplomacy.enemySeq++,
      nation: war.nation,
      strength: per, initialStrength: per,
      kind: kind.kind, kindLabel: kind.label, image: kind.image, exp: 0,
      lat: entry.lat + (Math.random() - 0.5) * 0.02,
      lon: entry.lon + (Math.random() - 0.5) * 0.02,
      path: [], targetCityId: null, engaged: false,
    };
    assignEnemyTarget(unit);
    state.diplomacy.enemyUnits.push(unit);
    war.strengthCommitted += per;
    logEvent(`<b style="color:#e06c60">${def.flag} ${def.name} battlegroup (${fmtNum(per)} troops)</b> crosses the border at ${entry.label}.`);
  }
}

function assignEnemyTarget(unit) {
  // Head for the nearest unoccupied major city; from there, Ljubljana.
  const war = warWith(unit.nation);
  const occupied = war ? war.occupied : [];
  let target = null, best = Infinity;
  for (const c of CITIES) {
    if (occupied.includes(c.id)) continue;
    const d = haversineKm(unit.lat, unit.lon, c.lat, c.lon);
    // Ljubljana is always the strategic prize — weight it closer than it is.
    const weighted = c.capital ? d * 0.55 : d;
    if (weighted < best) { best = weighted; target = c; }
  }
  if (!target) target = cityById("LJ");
  unit.targetCityId = target.id;
  const route = typeof findRoute === "function" ? findRoute({ lat: unit.lat, lon: unit.lon }, { lat: target.lat, lon: target.lon }) : null;
  unit.path = route && route.length ? route : [{ lat: target.lat, lon: target.lon, onRoad: false }];
}

function playerUnitPower(u) {
  const def = UNIT_TYPES[u.type];
  // Ground firepower scales with each unit's attack stat (aircraft, artillery
  // and attack drones hit hard; fighters/recon contribute little to ground),
  // multiplied by weapons research + event modifiers, VETERANCY (stars), unit
  // condition and its low-supply penalty.
  const expMult = typeof unitExpMult === "function" ? unitExpMult(u) : 1;
  const supMult = typeof supplyEffMult === "function" ? supplyEffMult(u) : (unitSupply(u) / 100);
  return (def.attack || 10) * unitCombatMult(u.type, "attack") * POWER_SCALE * (u.condition / 100) * supMult * expMult;
}

// Experience gained per hour of contact, and the bonus for finishing a foe off.
const EXP_PER_HOUR = 1.4;
const EXP_KILL_BONUS = 18;

function tickEnemyUnits(simHours) {
  // Units in contact burn supply fast; units.js reads this set each tick, so it
  // must be reset even on the early-return path (nobody is fighting then).
  state.engagedUnitIds = new Set();
  if (!atWarAny() && !state.diplomacy.enemyUnits.length) return;
  const d = state.diplomacy;
  const lowAmmo = state.inventory.ammo_tons <= 0;

  for (const e of d.enemyUnits) {
    const war = warWith(e.nation);
    const support = war ? alliedSupportMult(war) : 1.0;

    // Which player units can hit this group? Each uses its own strike range
    // (artillery, drones and aircraft reach far; infantry must be close).
    const engaged = state.units.filter(u => {
      const dist = haversineKm(u.lat, u.lon, e.lat, e.lon);
      return dist <= (UNIT_TYPES[u.type].range || ENGAGE_RANGE_KM);
    });
    e.engaged = engaged.length > 0;
    e.engagedUnitIds = engaged.map(u => u.id); // read by the battle-status modal
    engaged.forEach(u => state.engagedUnitIds.add(u.id));

    if (e.engaged) {
      // Both sides gain veterancy while in contact.
      engaged.forEach(u => { u.exp = (u.exp || 0) + EXP_PER_HOUR * simHours; u.battles = u.battles || 1; });
      e.exp = (e.exp || 0) + EXP_PER_HOUR * simHours;

      let power = engaged.reduce((s, u) => s + playerUnitPower(u), 0) * support;
      if (lowAmmo) power *= 0.45; // out of ammunition — fighting at a fraction of effectiveness
      const losses = power * 0.02 * simHours;
      e.strength -= losses;
      if (war) war.strengthDestroyed += Math.min(losses, Math.max(0, e.strength + losses));

      // Ammunition burn while in contact
      state.inventory.ammo_tons = Math.max(0, state.inventory.ammo_tons - engaged.length * 1.5 * simHours);

      // Return fire only reaches units in the enemy's own ~5 km envelope, so
      // artillery, drones and aircraft that stand off take no return fire.
      const totalPower = Math.max(1, power);
      for (const u of engaged) {
        if (haversineKm(u.lat, u.lon, e.lat, e.lon) > ENGAGE_RANGE_KM) continue;
        const dmg = Math.min(5, (e.strength / totalPower) * 1.2) * simHours * (30 / ((UNIT_TYPES[u.type].defense || 30) * unitCombatMult(u.type, "defense")));
        u.supply = Math.max(0, unitSupply(u) - dmg); u.hp = u.supply;
        u.condition = Math.max(10, u.condition - dmg * 0.4);
      }
    } else {
      // Advance along the road network.
      let remainingKm = ENEMY_SPEED_KMH * simHours;
      while (remainingKm > 0 && e.path.length) {
        const t = e.path[0];
        const dist = haversineKm(e.lat, e.lon, t.lat, t.lon);
        if (dist <= remainingKm || dist < 0.02) {
          e.lat = t.lat; e.lon = t.lon;
          e.path.shift();
          remainingKm -= dist;
        } else {
          const frac = remainingKm / dist;
          e.lat += (t.lat - e.lat) * frac;
          e.lon += (t.lon - e.lon) * frac;
          remainingKm = 0;
        }
      }
      if (!e.path.length) tryOccupyCity(e);
    }
  }

  // Remove destroyed formations / destroyed player units.
  const destroyed = d.enemyUnits.filter(e => e.strength <= 0);
  if (destroyed.length) {
    d.enemyUnits = d.enemyUnits.filter(e => e.strength > 0);
    destroyed.forEach(e => {
      logEvent(`<b style="color:#7fc97f">Enemy battlegroup destroyed</b> near ${nearestCityName(e.lat, e.lon)} (${NEIGHBOR_NATIONS[e.nation].flag} ${fmtNum(e.initialStrength)} troops neutralized).`);
      // Winning a battle: the victors gain a kill-bonus of experience, loot
      // supply off the dead, and the win lifts national stability.
      const winners = state.units.filter(u => (e.engagedUnitIds || []).includes(u.id));
      winners.forEach(u => {
        u.exp = (u.exp || 0) + EXP_KILL_BONUS;
        u.wins = (u.wins || 0) + 1;
        u.supply = Math.min(100, unitSupply(u) + 12); u.hp = u.supply; // battlefield loot
      });
      if (winners.length) state.econ.stability = clamp(state.econ.stability + 1.5, 0, 100);
    });
  }
  const lost = state.units.filter(u => unitSupply(u) <= 0);
  if (lost.length) {
    state.units = state.units.filter(u => u.supply > 0);
    lost.forEach(u => {
      if (state.selectedUnitId === u.id) deselectAll();
      logEvent(`<b style="color:#e06c60">${u.name} destroyed in combat</b> near ${nearestCityName(u.lat, u.lon)}.`);
    });
  }

  // Liberation check: occupied city with a player unit on it and no enemy nearby.
  for (const war of d.wars) {
    war.occupied = war.occupied.filter(cityId => {
      const c = cityById(cityId);
      const defenders = state.units.some(u => haversineKm(u.lat, u.lon, c.lat, c.lon) < 3);
      const enemies = d.enemyUnits.some(e => e.nation === war.nation && haversineKm(e.lat, e.lon, c.lat, c.lon) < ENGAGE_RANGE_KM);
      if (defenders && !enemies) {
        logEvent(`<b style="color:#7fc97f">${c.name} liberated.</b>`);
        return false;
      }
      return true;
    });
  }
}

// ---- Municipality control ---------------------------------------------------
// A municipality falls when an enemy formation stands inside it and no friendly
// unit is there to hold it; it is liberated the moment a friendly unit is inside
// with no enemy of the occupying nation present. While held, its population,
// income and industry are counted as lost to the occupier — modelled as the
// "Occupied Territory" national modifier scaled by the captured population share.
function pointInMunicipality(lat, lon, m) {
  return m && m.rings && m.rings.some(r => pointInRing([lat, lon], r));
}
function municipalityById(id) {
  if (typeof municipalityPolygons !== "undefined" && municipalityPolygons[id]) return municipalityPolygons[id];
  return (typeof MUNICIPALITIES !== "undefined" ? MUNICIPALITIES : []).find(m => String(m.id) === String(id)) || null;
}

function updateMunicipalityControl() {
  const d = state.diplomacy;
  if (!d.capturedMunicipalities) d.capturedMunicipalities = {};
  const cap = d.capturedMunicipalities;
  const readyFriendly = state.units.filter(u => (u.trainingDaysLeft || 0) <= 0);

  // Capture: an enemy formation inside an unheld municipality with no friendly
  // unit inside takes it.
  for (const e of d.enemyUnits) {
    const m = municipalityAt(e.lat, e.lon);
    if (!m) continue;
    if (cap[m.id]) continue;
    const held = readyFriendly.some(u => pointInMunicipality(u.lat, u.lon, m));
    if (!held) {
      cap[m.id] = e.nation;
      const nm = (NEIGHBOR_NATIONS[e.nation] || {}).name || "enemy";
      logEvent(`<b style="color:#e06c60">${m.name} municipality captured</b> by ${nm} — its people, income and factories now serve the occupier until it is retaken.`);
      state.econ.stability = clamp(state.econ.stability - 1.5, 0, 100);
    }
  }

  // Liberation: friendly unit inside, no enemy of the occupying nation present.
  for (const id in cap) {
    const m = municipalityById(id);
    if (!m) { delete cap[id]; continue; }
    const nation = cap[id];
    const friendlyInside = readyFriendly.some(u => pointInMunicipality(u.lat, u.lon, m));
    const enemyInside = d.enemyUnits.some(e => e.nation === nation && pointInMunicipality(e.lat, e.lon, m));
    if (friendlyInside && !enemyInside) {
      delete cap[id];
      logEvent(`<b style="color:#7fc97f">${m.name} municipality liberated</b> — its population and output return to Slovenia.`);
    }
  }

  updateOccupationModifier();
}

// Sum the population of every currently-captured municipality and express it as
// a national modifier: the enemy is taking that share of tax income and factory
// output, and it dents stability and growth while the territory is held.
function updateOccupationModifier() {
  const cap = (state.diplomacy && state.diplomacy.capturedMunicipalities) || {};
  let capPop = 0, n = 0;
  for (const id in cap) {
    const m = municipalityById(id);
    if (m && typeof municipalityPopEstimate === "function") { capPop += municipalityPopEstimate(m); n++; }
  }
  const key = "occupied_territory";
  if (n === 0) { if (typeof removeModifier === "function") removeModifier(key, true); return; }
  const frac = clamp(capPop / (state.econ.population || 1), 0, 0.95);
  const fx = {
    taxIncomeMult: -frac,
    factoryOutputMult: -frac,
    growthBonus: -frac * 0.03,
    stabilityBonus: -frac * 0.05,
  };
  let mod = state.modifiers.find(m => m.key === key);
  if (mod) { mod.fx = fx; mod.label = `Occupied Territory (${n})`; }
  else {
    state.modifiers.push({
      key, label: `Occupied Territory (${n})`,
      icon: (typeof svgIcon === "function" ? svgIcon("gauge") : ""),
      fx, permanent: true, daysLeft: null,
    });
  }
}

// Release every municipality a nation held (called when its war ends).
function releaseCapturedBy(nation) {
  const cap = state.diplomacy && state.diplomacy.capturedMunicipalities;
  if (!cap) return;
  for (const id in cap) if (cap[id] === nation) delete cap[id];
  updateOccupationModifier();
}

function nearestCityName(lat, lon) {
  let best = null, bd = Infinity;
  for (const c of CITIES) {
    const d = haversineKm(lat, lon, c.lat, c.lon);
    if (d < bd) { bd = d; best = c; }
  }
  return best ? best.name : "the border";
}

function tryOccupyCity(e) {
  const c = cityById(e.targetCityId);
  if (!c || haversineKm(e.lat, e.lon, c.lat, c.lon) > 3) { assignEnemyTarget(e); return; }
  const defended = state.units.some(u => haversineKm(u.lat, u.lon, c.lat, c.lon) < ENGAGE_RANGE_KM);
  if (defended) return; // combat will resolve it
  const war = warWith(e.nation);
  if (war && !war.occupied.includes(c.id)) {
    war.occupied.push(c.id);
    logEvent(`<b style="color:#e06c60">${c.name} has fallen</b> — occupied by ${NEIGHBOR_NATIONS[e.nation].name} forces.`);
    state.econ.stability = clamp(state.econ.stability - (c.capital ? 10 : 4), 0, 100);
  }
  assignEnemyTarget(e); // push on toward the next objective
}

// ---- Daily diplomacy tick (called from runDailyUpdate) ----
function tickDiplomacy() {
  const d = state.diplomacy;

  // Territory control: who holds which municipalities, and the economic cost of
  // any the enemy is occupying.
  updateMunicipalityControl();

  for (const id in NEIGHBOR_NATIONS) {
    const n = natState(id);
    if (n.atWar) continue;

    // Tension: grows when relations are bad, decays when they're decent.
    let growth = n.relation < 40 ? (40 - n.relation) * 0.08 : -1.5;
    if (n.nonAggression && growth > 0) growth *= 0.5;
    n.tension = clamp(n.tension + growth, 0, 100);

    // Occasional border incidents when relations are poor.
    if (n.relation < 50 && Math.random() < 0.02) {
      n.tension = clamp(n.tension + 8, 0, 100);
      logEvent(`<b>Border incident</b> with ${NEIGHBOR_NATIONS[id].name} — patrols confront each other; nationalist press on both sides inflames it (+8 tension).`);
    }

    // Full-blown war only erupts from sustained hostility.
    if (n.tension >= 100 && n.relation < 20) {
      declareWar(id, "them");
    }

    // Relations naturally drift back toward a lukewarm middle.
    n.relation += (58 - n.relation) * 0.001;
  }

  // EU/NATO standing recovers slowly at peace; sanctions when it's wrecked.
  if (!atWarAny() && d.euNatoStanding < 80) d.euNatoStanding = clamp(d.euNatoStanding + 0.04, 0, 100);
  d.sanctioned = d.euNatoStanding < 40;

  // War upkeep + wave scheduling + end conditions.
  for (const war of d.wars.slice()) {
    state.econ.treasury -= state.econ.gdp * 0.010 / 365; // emergency defense spending

    if (war.wavesLaunched < war.wavesPlanned) {
      war.nextWaveInDays -= 1;
      if (war.nextWaveInDays <= 0) {
        spawnInvasionWave(war);
        war.nextWaveInDays = 12 + Math.random() * 8;
      }
    }

    const enemiesLeft = d.enemyUnits.some(e => e.nation === war.nation);

    // Capital fallen: countdown to capitulation.
    if (war.occupied.includes("LJ")) {
      war.ljFallDays += 1;
      if (war.ljFallDays >= 10) { endWar(war, "defeat"); continue; }
    } else war.ljFallDays = 0;

    // Victory: every planned wave committed and crushed, nothing occupied.
    if (war.wavesLaunched >= war.wavesPlanned && !enemiesLeft && war.occupied.length === 0) {
      endWar(war, "victory");
    }
  }
}

function endWar(war, outcome) {
  const d = state.diplomacy;
  const def = NEIGHBOR_NATIONS[war.nation];
  const n = natState(war.nation);
  d.wars = d.wars.filter(w => w !== war);
  d.enemyUnits = d.enemyUnits.filter(e => e.nation !== war.nation);
  releaseCapturedBy(war.nation); // occupied territory is returned when the war ends
  n.atWar = false;
  n.tension = 30;

  if (outcome === "victory") {
    const reparations = clamp(def.gdp * 0.0004, 200e6, 900e6);
    state.econ.treasury += reparations;
    n.relation = 42;
    state.econ.stability = clamp(state.econ.stability + 6, 0, 100);
    if (war.aggressor === "them") d.euNatoStanding = clamp(d.euNatoStanding + 8, 0, 100);
    logEvent(`<b style="color:#7fc97f">VICTORY — ${def.name} sues for peace.</b> Slovenia receives ${fmtEUR(reparations)} in reparations. The armed forces return home to a hero's welcome.`);
  } else if (outcome === "defeat") {
    state.econ.treasury *= 0.85;
    state.econ.stability = clamp(state.econ.stability - 25, 0, 100);
    n.relation = 35;
    logEvent(`<b style="color:#e06c60">CAPITULATION.</b> With Ljubljana under occupation, the government signs an armistice with ${def.name} on unfavorable terms. Occupied territory is returned; the political damage will take years to heal.`);
  } else { // negotiated
    n.relation = Math.max(n.relation, 38);
    logEvent(`<b>Armistice signed with ${def.name}.</b> The guns fall silent.`);
  }
  renderDiplomacyTab();
  renderWarBanner();
}

function sueForPeace(id) {
  const war = warWith(id);
  if (!war) return;
  const winning = war.strengthDestroyed >= war.strengthTotal * 0.4 && war.occupied.length === 0;
  if (winning) {
    endWar(war, "negotiated");
  } else {
    const cost = 400e6;
    if (state.econ.treasury < cost) { logEvent(`Peace feelers rejected — ${NEIGHBOR_NATIONS[id].name} demands reparations Slovenia cannot currently pay (${fmtEUR(cost)}).`); return; }
    state.econ.treasury -= cost;
    state.econ.stability = clamp(state.econ.stability - 6, 0, 100);
    logEvent(`Slovenia pays ${fmtEUR(cost)} in reparations to end the war with ${NEIGHBOR_NATIONS[id].name}.`);
    endWar(war, "negotiated");
  }
}

// ---- Map markers for enemy formations ----
// Enemy formations are drawn straight onto the WebGL map's overlay canvas
// (see drawMapOverlays / drawEnemyMarker in map.js). syncEnemyMarkers() lives
// there too and just requests a redraw — nothing to maintain here anymore.

// ---- Diplomacy tab UI ----
let declareWarArmed = null; // nation id whose declare button is in confirm state

function relationLabel(r) {
  if (r >= 80) return ["Allied", "#7fc97f"];
  if (r >= 65) return ["Friendly", "#a8c97f"];
  if (r >= 45) return ["Cordial", "#c9c07f"];
  if (r >= 30) return ["Strained", "#d99a5b"];
  if (r >= 15) return ["Hostile", "#e06c60"];
  return ["Enemy", "#e04040"];
}

function renderDiplomacyTab() {
  const box = document.getElementById("diplomacyList");
  if (!box) return;
  const d = state.diplomacy;

  const standingColor = d.euNatoStanding >= 60 ? "#7fc97f" : d.euNatoStanding >= 40 ? "#c9c07f" : "#e06c60";
  let html = `
    <div class="diploStanding">
      <span>🇪🇺 EU / NATO STANDING</span>
      <div class="relbar"><div class="relfill" style="width:${d.euNatoStanding}%;background:${standingColor}"></div></div>
      <b style="color:${standingColor}">${d.euNatoStanding.toFixed(0)}%</b>
      ${d.sanctioned ? '<span class="sanctionTag">UNDER SANCTIONS — −2.0%/yr growth</span>' : ""}
    </div>`;

  for (const id in NEIGHBOR_NATIONS) {
    const def = NEIGHBOR_NATIONS[id];
    const n = natState(id);
    const [relText, relColor] = relationLabel(n.relation);
    const war = warWith(id);

    let actionsHTML = "";
    if (war) {
      const winning = war.strengthDestroyed >= war.strengthTotal * 0.4 && war.occupied.length === 0;
      actionsHTML = `
        <div class="warStatus">
          <b style="color:#e06c60">⚔ AT WAR</b> (${war.aggressor === "player" ? "Slovenian offensive" : "defending against invasion"})<br>
          Enemy committed: ${fmtNum(war.strengthCommitted)} / ${fmtNum(war.strengthTotal)} troops · destroyed: ${fmtNum(Math.round(war.strengthDestroyed))}<br>
          Waves: ${war.wavesLaunched}/${war.wavesPlanned} · Occupied cities: ${war.occupied.length ? war.occupied.map(c => cityById(c).name).join(", ") : "none"}
        </div>
        <button class="diplobtn peace" data-nation="${id}" data-action="peace">${winning ? "Accept their surrender (white peace)" : "Sue for peace (€400M reparations)"}</button>`;
    } else {
      for (const key in DIPLO_ACTIONS) {
        const a = DIPLO_ACTIONS[key];
        const cd = actionCooldownLeft(id, key);
        const ok = a.can(id) && cd === 0 && state.econ.treasury >= a.cost;
        const desc = typeof a.desc === "function" ? a.desc(id) : a.desc;
        const note = cd > 0 ? `${cd}d cooldown` : (!a.can(id) && a.reqNote ? a.reqNote : (a.cost ? fmtEUR(a.cost) : "free"));
        const done = (key === "tradePact" && n.tradePact) || (key === "nonAggression" && n.nonAggression);
        if (done) { actionsHTML += `<span class="pactTag">✓ ${a.label} active</span>`; continue; }
        actionsHTML += `<button class="diplobtn" data-nation="${id}" data-action="${key}" ${ok ? "" : "disabled"} title="${desc}">${a.label} <small>(${note})</small></button>`;
      }
      const dwArmed = declareWarArmed === id;
      actionsHTML += `<button class="diplobtn war ${dwArmed ? "armed" : ""}" data-nation="${id}" data-action="declareWar">${dwArmed ? "⚠ CONFIRM — EU/NATO WILL SANCTION SLOVENIA" : "Declare War"}</button>`;
    }

    html += `
      <div class="diploCard ${war ? "atwar" : ""}">
        <div class="nationHead">
          <span class="nationFlag">${def.flag}</span>
          <b>${def.name.toUpperCase()}</b>
          <span class="relTag" style="color:${relColor}">${relText}</span>
          ${def.nato ? '<span class="orgTag">NATO</span>' : ""}${def.eu ? '<span class="orgTag">EU</span>' : ""}
        </div>
        <div class="nationStats">
          Population ${(def.pop / 1e6).toFixed(1)}M · GDP ${fmtEUR(def.gdp)} · Active military ${fmtNum(def.milActive)}
        </div>
        <div class="nationBlurb">${def.blurb}</div>
        <div class="relRow"><span>Relations</span><div class="relbar"><div class="relfill" style="width:${n.relation}%;background:${relColor}"></div></div><b>${n.relation.toFixed(0)}</b></div>
        <div class="relRow"><span>Tension</span><div class="relbar"><div class="relfill" style="width:${n.tension}%;background:#e06c60"></div></div><b>${n.tension.toFixed(0)}</b></div>
        <div class="nationActions">${actionsHTML}</div>
      </div>`;
  }
  box.innerHTML = html;

  box.querySelectorAll(".diplobtn").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.nation, action = btn.dataset.action;
      if (action === "peace") { sueForPeace(id); return; }
      if (action === "declareWar") {
        if (declareWarArmed === id) { declareWarArmed = null; declareWar(id, "player"); }
        else { declareWarArmed = id; renderDiplomacyTab(); setTimeout(() => { if (declareWarArmed === id) { declareWarArmed = null; renderDiplomacyTab(); } }, 6000); }
        return;
      }
      runDiploAction(id, action);
    });
  });
}

// ---- War banner over the map ----
function renderWarBanner() {
  const el = document.getElementById("warBanner");
  if (!el) return;
  const d = state.diplomacy;
  if (!d.wars.length) { el.classList.add("hidden"); return; }
  el.classList.remove("hidden");
  el.innerHTML = d.wars.map(w => {
    const def = NEIGHBOR_NATIONS[w.nation];
    const enemyIn = d.enemyUnits.filter(e => e.nation === w.nation);
    const strength = enemyIn.reduce((s, e) => s + Math.max(0, e.strength), 0);
    const lj = w.occupied.includes("LJ") ? ` · <b>LJUBLJANA OCCUPIED — CAPITULATION IN ${10 - w.ljFallDays}d</b>` : "";
    return `⚔ WAR WITH ${def.flag} ${def.name.toUpperCase()} — ${enemyIn.length} enemy formation(s), ${fmtNum(Math.round(strength))} troops in-country · ${w.occupied.length} cities occupied${lj}`;
  }).join("<br>");
}
