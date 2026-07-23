// Economic simulation: date/time progression and daily GDP/budget/stability ticks.

// At 1x, one real-life minute = one in-game hour (so a full day = 24 real
// minutes). 1 hour / 60s = (1/24 day)/60s = 1/1440 day per real second.
const BASE_DAYS_PER_SEC = 1 / 1440;
state.dayAccum = 0;

function currentSpeedMult() {
  return state.paused ? 0 : SPEEDS[state.speedIndex].mult;
}

function tickEconomy(dtRealSeconds) {
  const mult = currentSpeedMult();
  if (mult === 0) return { simDays: 0, simHours: 0 };

  const simDays = dtRealSeconds * BASE_DAYS_PER_SEC * mult;
  state.date = new Date(state.date.getTime() + simDays * 86400000);
  state.dayAccum += simDays;

  while (state.dayAccum >= 1) {
    state.dayAccum -= 1;
    runDailyUpdate();
  }
  return { simDays, simHours: simDays * 24 };
}

function revenueRate() {
  const p = state.policy;
  // Below ~40 stability, tax compliance erodes — informal economy grows,
  // businesses under-report, collection breaks down.
  const crisisGap = Math.max(0, 40 - state.econ.stability);
  const erosion = crisisGap > 10 ? (crisisGap - 10) * 0.003 : 0;
  return (0.38 + (p.corpTax - 19) * 0.002 + (p.vat - 22) * 0.0015) * (1 - clamp(erosion, 0, 0.6));
}

function getIncomeBreakdown() {
  const taxMult = Math.max(0.2, 1 + (lawEffects().taxIncomeMult || 0) + (modifierEffects().taxIncomeMult || 0));
  // Corruption above the ~25 baseline skims collected taxes off the top.
  const corruptionSkim = 1 - Math.max(0, (state.econ.corruption || 25) - 25) * 0.004;
  const monthlyBase = state.econ.gdp / 12 * revenueRate() * taxMult * corruptionSkim;
  const weights = {
    "Income Tax": 0.34, "Corporate Tax": 0.14, "VAT": 0.22, "Property Tax": 0.03,
    "Tariffs": 0.02, "State Companies": 0.05, "Natural Resources": 0.01,
    "Foreign Investment": 0.03, "Tourism": 0.06, "Customs": 0.02,
    "Exports (net)": 0.06, "Military Exports": 0.02,
  };
  const rows = {};
  for (const k in weights) rows[k] = monthlyBase * weights[k];
  // Real trade income lines so the budget view matches what actually flows.
  // These EUR amounts already hit the treasury inside tickTradeAndEnergy, so
  // they're shown in the rows/total but excluded from coreTotal (the figure
  // runDailyUpdate uses for the daily budget flow) to avoid double counting.
  const coreTotal = monthlyBase;
  const es = state.energyStatus || {};
  const elecExports = (es.exportIncomeMonthly || 0) + (es.exportContractIncomeMonthly || 0);
  if (elecExports > 0) rows["Electricity Exports"] = elecExports;
  let commoditySales = 0;
  const saleMult = Math.max(0.2, 1 + (lawEffects().tradeIncomeMult || 0));
  for (const key in state.sellPercent) {
    const pct = state.sellPercent[key] || 0, stock = state.commodityStock[key] || 0;
    if (pct > 0 && stock > 0) commoditySales += stock * (pct / 100) * (COMMODITIES[key] ? COMMODITIES[key].price : 0) * saleMult;
  }
  if (commoditySales > 0) rows["Commodity Sales"] = commoditySales;
  const total = Object.values(rows).reduce((a, b) => a + b, 0);
  return { rows, total, coreTotal };
}

// Expenses are now driven directly by the player's per-department spending
// allocations (each a % of GDP/year), plus debt interest. This is the single
// source of truth — the sliders in the Treasury panel move these rows, and
// each department's funding level feeds a real consequence in runDailyUpdate.
const SPENDING_BASELINE = {
  military: 2.0, healthcare: 7.0, education: 5.0,
  pensions: 11.0, police: 1.7, infrastructure: 4.0, welfare: 5.0,
};
function getExpenseBreakdown() {
  const gdp = state.econ.gdp;
  const sp = state.spending;
  const monthly = pct => gdp * (pct / 100) / 12;
  const rows = {
    "Military": monthly(sp.military) * Math.max(0.3, 1 + (lawEffects().upkeepMult || 0)),
    "Healthcare": monthly(sp.healthcare),
    "Education": monthly(sp.education),
    "Pensions": monthly(sp.pensions),
    "Police": monthly(sp.police),
    "Infrastructure": monthly(sp.infrastructure),
    "Social Welfare": monthly(sp.welfare),
    "Debt Interest": state.econ.debt * 0.032 / 12, // ~3.2%/yr servicing cost
  };
  // Trading costs are real budget lines, not silent treasury leaks. They're
  // paid inside tickTradeAndEnergy, so like the income side they're shown in
  // rows/total but kept out of coreTotal (used for the daily budget flow).
  const coreTotal = Object.values(rows).reduce((a, b) => a + b, 0);
  let resourceImports = 0;
  for (const key in state.monthlyBuy) {
    const mb = state.monthlyBuy[key];
    const p = worldPartner(mb.partner);
    resourceImports += mb.qty * COMMODITIES[key].price * (p ? p.commodityMult : 1) * 1.1;
  }
  if (resourceImports > 0) rows["Resource Imports"] = resourceImports;
  const es = state.energyStatus || {};
  const elecImports = (es.contractCostMonthly || 0) + (es.importCostMonthly || 0);
  if (elecImports > 0) rows["Electricity Imports"] = elecImports;
  const total = Object.values(rows).reduce((a, b) => a + b, 0);
  return { rows, total, coreTotal };
}

// Combined aggregate bonuses from completed buildings + unlocked tech +
// national laws/ideology + timed event modifiers, so every formula below
// reads from one place.
function totalEffects() {
  const be = state.buildingEffects, te = state.techEffects, le = lawEffects(), me = modifierEffects();
  const out = {};
  for (const k in be) out[k] = (be[k] || 0) + (te[k] || 0);
  for (const k in te) if (!(k in out)) out[k] = te[k] || 0;
  for (const k in le) out[k] = (out[k] || 0) + le[k];
  for (const k in me) out[k] = (out[k] || 0) + me[k];
  return out;
}

function runDailyUpdate() {
  const econ = state.econ;
  const pol = state.policy;
  const fx = totalEffects();
  tickZones(); // recompute zone growth/income from current commodity supply

  // Stability-driven crisis effects: below a crisis threshold, businesses
  // close (extra GDP drag beyond the normal stability formula below),
  // people emigrate (population decline, not just slower growth), and tax
  // compliance erodes (handled inside revenueRate()) — real knock-on
  // consequences rather than a single number ticking down in isolation.
  const crisisGap = Math.max(0, 40 - econ.stability);
  const businessCollapseDrag = crisisGap * crisisGap * 0.000015;
  econ.emigrationRate = crisisGap > 15 ? (crisisGap - 15) * 0.00004 : 0;
  econ.unemploymentRate = clamp(5 + crisisGap * 0.3 - econ.gdpGrowth * 100, 2, 35);

  // Minimum wage: a real EUR/month threshold, not a toggle. Baseline ~€1250
  // is treated as neutral; every euro above it trades growth/unemployment
  // for stability, every euro below it costs stability instead.
  const minWageGap = (pol.minimumWageEUR - 1250) / 1250;
  const minWageDrag = Math.max(0, minWageGap) * 0.0035;
  const minWageStabilityBonus = minWageGap * 0.03;
  econ.unemploymentRate = clamp(econ.unemploymentRate + Math.max(0, minWageGap) * 0.06, 2, 35);

  // Energy prices: fuel/electricity indices (baseline 100) driven by
  // oil rigs / power plants. Cheaper energy directly helps growth —
  // "build an oil rig, fuel gets cheaper, GDP grows" is a real mechanic,
  // not just flavor text.
  econ.fuelPriceIndex = clamp(100 + (fx.fuelPriceBonus || 0), 35, 160);
  econ.electricityPriceIndex = clamp(100 + (fx.electricityPriceBonus || 0) + (state.zoneEffects.electricityPriceBonus || 0), 35, 160);
  const energyCostDrag = ((econ.fuelPriceIndex - 100) + (econ.electricityPriceIndex - 100)) * 0.00003;

  // Department spending consequences (each measured against its baseline).
  const sp = state.spending, base = SPENDING_BASELINE;
  const infraGrowth = (sp.infrastructure - base.infrastructure) * 0.0004;   // roads/rail/utilities lift growth
  const gunsVsButter = Math.max(0, sp.military - 3.5) * 0.0010;             // very high military spend drags growth
  const welfareDrag = Math.max(0, sp.welfare - base.welfare) * 0.0003;      // generous welfare mildly drags growth
  // welfare also cushions unemployment and slows crisis emigration
  econ.unemploymentRate = clamp(econ.unemploymentRate - (sp.welfare - base.welfare) * 0.25, 2, 35);

  // GDP growth: baseline + mild effects from tax burden, stability, buildings/tech, events, spending
  const taxDrag = ((pol.corpTax - 19) + (pol.vat - 22)) * 0.0004;
  const stabilityBonus = (econ.stability - 60) * 0.0002;
  // conscription's growth cost now comes from the conscription LAW via
  // fx.growthBonus (see js/laws.js) instead of a hardcoded boolean drag.
  const reserveDrag = econ.reserveActivated ? 0.0004 : 0;
  const martialLawDrag = pol.martialLaw ? 0.0015 : 0;
  const diploGrowth = typeof diplomacyGrowthBonus === "function" ? diplomacyGrowthBonus() : 0;
  // Reliable power (energy supply meets or beats demand) lifts output & growth;
  // an energy deficit is a drag (also handled via price index above).
  const energyOk = state.energyStatus && state.energyStatus.balanceMWh >= 0;
  const energySurplusGrowth = energyOk ? 0.0010 : 0;
  const dailyGrowth = (0.021 - taxDrag + stabilityBonus - businessCollapseDrag - minWageDrag - reserveDrag - martialLawDrag - energyCostDrag + infraGrowth - gunsVsButter - welfareDrag + energySurplusGrowth + (state.zoneEffects.growth || 0) + (fx.growthBonus || 0) + econ.eventGrowthBonus + diploGrowth) / 365;
  econ.gdp *= (1 + dailyGrowth);
  econ.gdpGrowth = dailyGrowth * 365;

  // Budget flow to treasury. coreTotal excludes trade lines — those already
  // move money directly inside tickTradeAndEnergy.
  const income = getIncomeBreakdown().coreTotal;
  const expense = getExpenseBreakdown().coreTotal;
  const familyExemptionCost = pol.familyTaxExemption ? 9e6 : 0; // lost income-tax revenue, modeled directly
  econ.treasury += (income - expense) / 30 + (fx.treasuryBonusMonthly || 0) / 30 - familyExemptionCost / 30 + (state.zoneEffects.incomeMonthly || 0) / 30;

  // Stability drift — most departments buy social peace when funded above
  // baseline, and cost it when starved.
  let stabilityDelta = (fx.stabilityBonus || 0)
    + (sp.healthcare - base.healthcare) * 0.010
    + (sp.pensions - base.pensions) * 0.008
    + (sp.welfare - base.welfare) * 0.008
    + (sp.education - base.education) * 0.006
    + (sp.police - base.police) * 0.004
    - (pol.vat - 22) * 0.015 - (pol.corpTax - 19) * 0.005;
  if (pol.familyTaxExemption) stabilityDelta += 0.015;
  stabilityDelta += minWageStabilityBonus;
  // conscription's stability cost now flows in via fx.stabilityBonus (laws)
  if (econ.reserveActivated) stabilityDelta -= 0.03;
  if (pol.martialLaw) stabilityDelta -= 0.08;
  stabilityDelta -= (econ.crimeRate - 20) * 0.003;
  stabilityDelta -= Math.max(0, (econ.warExhaustion || 0)) * 0.004;       // tired nations fray
  stabilityDelta -= Math.max(0, (econ.corruption || 25) - 25) * 0.0015;   // graft erodes trust
  if (energyOk) stabilityDelta += 0.012; // dependable, affordable power keeps people happy
  stabilityDelta += (state.zoneEffects.stability || 0); // residential zones
  stabilityDelta += typeof diplomacyStabilityDelta === "function" ? diplomacyStabilityDelta() : 0;
  stabilityDelta += (Math.random() - 0.5) * 0.3;
  econ.stability = clamp(econ.stability + stabilityDelta, 0, 100);

  // Crime/public-safety index — police funding drives it down directly.
  const crimeTarget = clamp(15 + econ.unemploymentRate * 0.8 - (econ.stability - 50) * 0.15 - (sp.police - base.police) * 5 + (fx.crimeBonus || 0), 3, 85);
  econ.crimeRate += (crimeTarget - econ.crimeRate) * 0.015;

  // National sector demand is driven mainly by POPULATION (not GDP) so it's
  // finite and doesn't feed back on itself — building past it saturates hard,
  // so you can't usefully spam factories forever. A few plants meet each
  // sector; demand only creeps up as the population grows.
  const popM = econ.population / 1_000_000;
  state.sectorDemand.fuel = popM * 3.2;
  state.sectorDemand.electricity = popM * 4.0;
  state.sectorDemand.electronics = 1 + popM * 1.2;
  state.sectorDemand.automotive = 1 + popM * 1.0;
  state.sectorDemand.logistics = 1 + popM * 1.6;
  state.sectorDemand.tech = 1 + popM * 1.0;

  // Temporary research-speed boosts (from events) decay over time.
  if (state.researchBoost && state.researchBoost.daysLeft > 0) {
    state.researchBoost.daysLeft -= 1;
    if (state.researchBoost.daysLeft <= 0) state.researchBoost = { mult: 0, daysLeft: 0 };
  }

  // Research is now driven by how many schools/universities you've built
  // (see tickResearch), not an education budget slider. It distributes the
  // day's points across your (up to 3) selected techs.
  tickResearch(fx);

  // Manpower: a small professional active-duty force (~7,000, matching the
  // real Slovenian Armed Forces scale) rather than a percentage of the
  // whole population. Military budget scales the sustainable active cap;
  // conscription multiplies it sharply but costs stability/growth daily.
  // Reserves are a separate pool only usable once activated.
  const le = lawEffects();
  const conscriptionMult = Math.max(0.1, 1 + (le.manpowerCapMult || 0));
  const recruitMult = Math.max(0.1, 1 + (le.recruitRateMult || 0));
  const militaryFactor = clamp(state.spending.military / 2, 0.4, 3); // baseline 2% GDP = ×1
  econ.manpowerActiveCap = Math.round(econ.population * 0.0033 * conscriptionMult * militaryFactor) + (fx.manpowerCapBonus || 0);
  // Special measure: running recruiting facilities at full capacity pulls in a
  // big daily intake of fresh personnel — 100-300/day, or 300-500/day once
  // martial law is declared. It raises the active cap so the extra recruits
  // aren't immediately clipped by the peacetime ceiling.
  let fullRecruitIntake = 0;
  if (state.policy.fullRecruitment) {
    const lo = state.policy.martialLaw ? 300 : 100;
    const hi = state.policy.martialLaw ? 500 : 300;
    fullRecruitIntake = lo + Math.floor(Math.random() * (hi - lo + 1));
    econ.manpowerActiveCap += fullRecruitIntake;
  }
  econ.lastRecruitIntake = Math.round(econ.population * 0.000002 * recruitMult) + fullRecruitIntake;
  econ.manpowerActive = Math.min(econ.manpowerActiveCap, econ.manpowerActive + econ.lastRecruitIntake);
  econ.manpowerReserveCap = Math.round(econ.population * 0.008);
  econ.manpowerReserve = Math.min(econ.manpowerReserveCap, econ.manpowerReserve + Math.round(econ.population * 0.000003));

  // Population: real crude birth/death rates (per 1000/year), so the
  // headline population figure is the direct result of births minus
  // deaths minus emigration — not an opaque single growth constant.
  // Calibrated so fertility 1.62 / life expectancy 81.3 (today's real
  // Slovenia figures) reproduce Slovenia's actual crude rates (~9.5 births,
  // ~10.7 deaths per 1000/year).
  econ.crudeBirthRate = clamp(econ.fertilityRate * 5.9, 3, 25);
  econ.crudeDeathRate = clamp(10.7 - (econ.lifeExpectancy - 81.3) * 0.35, 6, 18);
  const dailyBirths = econ.population * (econ.crudeBirthRate / 1000) / 365;
  const dailyDeaths = econ.population * (econ.crudeDeathRate / 1000) / 365;
  const dailyEmigration = econ.population * econ.emigrationRate;
  // Immigration law + ideology drive a steady net migration flow.
  const dailyMigration = econ.population * ((le.migrationPerYear || 0) / 365);
  econ.population = Math.max(0, Math.round(econ.population + dailyBirths - dailyDeaths - dailyEmigration + dailyMigration));

  // Inflation drifts toward a target near 2%, nudged by deficit spending.
  // Under hyperinflation it's pinned sky-high until the debuff ends.
  if (hasModifier("hyperinflation")) {
    econ.inflation = clamp(econ.inflation + 0.01, 0.15, 0.9);
  } else {
    const deficitPressure = expense > income ? 0.0008 : -0.0004;
    econ.inflation = clamp(econ.inflation + deficitPressure + (Math.random() - 0.5) * 0.0006, -0.01, 0.15);
  }

  // Record a daily sample for the GDP insight chart (bounded history).
  if (!state.gdpHistory) state.gdpHistory = [];
  state.gdpHistory.push({ gdp: econ.gdp, inflation: econ.inflation, stability: econ.stability });
  if (state.gdpHistory.length > 3700) state.gdpHistory.shift();

  tickConstructions();
  tickInfraProjects();
  tickTradeAndEnergy();
  tickDiplomacy();
  updateCityStats();
  updateNationalIndices();
  tickLawsAndIdeology();
  tickModifiers();
  tickPendingDecisions();
  tickPendingOutcomes();
  updateStatTrends();
  // Random events now fire on a real-time timer (see main.js), not sim days,
  // so they arrive at a steady pace regardless of game speed.
}

// Day-over-day deltas, used by the bottom dock's color grading + trend
// arrows so "population is falling" etc. is visible at a glance.
function updateStatTrends() {
  const snapshot = {
    stability: state.econ.stability,
    happiness: state.econ.overallHappiness,
    gdp: state.econ.gdp,
    treasury: state.econ.treasury,
    population: state.econ.population,
    research: state.econ.research,
    manpower: availableManpower(),
  };
  if (state.prevDayValues) {
    for (const k in snapshot) state.statTrends[k] = snapshot[k] - state.prevDayValues[k];
  }
  state.prevDayValues = snapshot;
}

function updateNationalIndices() {
  const econ = state.econ;
  const cities = Object.values(state.cityStats);
  if (cities.length) {
    econ.overallHappiness = cities.reduce((s, c) => s + c.happiness, 0) / cities.length;
  }

  const leTarget = clamp(81.3 + (state.spending.healthcare - 7) * 0.45, 74, 87);
  econ.lifeExpectancy += (leTarget - econ.lifeExpectancy) * 0.01;

  const fertBonus = (totalEffects().fertilityBonus || 0) + (state.zoneEffects.fertility || 0);
  const fertTarget = clamp(1.35 + (econ.overallHappiness - 50) * 0.006 + (state.policy.familyTaxExemption ? 0.25 : 0) + fertBonus, 1.0, 2.6);
  econ.fertilityRate += (fertTarget - econ.fertilityRate) * 0.01;

  const gdpPerCapita = econ.gdp / econ.population;
  const lifeIndex = clamp((econ.lifeExpectancy - 20) / (85 - 20), 0, 1);
  const eduIndex = clamp(0.75 + (state.spending.education - 5) * 0.015 + Math.min(econ.research / 200000, 0.1), 0.4, 0.98);
  const incomeIndex = clamp((Math.log(gdpPerCapita) - Math.log(100)) / (Math.log(75000) - Math.log(100)), 0, 1);
  econ.hdi = Math.cbrt(lifeIndex * eduIndex * incomeIndex);
}

function updateCityStats() {
  const gdpPerCapitaMonthly = state.econ.gdp / state.econ.population / 12;
  CITIES.forEach(c => {
    const avgSalary = gdpPerCapitaMonthly * c.wealthFactor * 0.55;
    const happiness = clamp(state.econ.stability + (c.happinessBias || 0) + (state.zoneEffects.happiness || 0) + (Math.random() - 0.5) * 2, 0, 100);
    state.cityStats[c.id] = { avgSalary, happiness };
  });
}

// ---- Construction ----
function buildCostFor(type) {
  return BUILDING_TYPES[type].cost * (1 + (totalEffects().buildCostMult || 0));
}
function buildDaysFor(type) {
  return Math.max(5, Math.round(BUILDING_TYPES[type].days * (1 + (totalEffects().buildTimeMult || 0))));
}

function canAffordBuilding(type) {
  return state.econ.treasury >= buildCostFor(type);
}

// How effective a building will be, 0..1. "social" buildings are capped by
// how much of the target municipality's population isn't already served by
// buildings of the same type already there; sector buildings are capped by
// how much of national demand isn't already met by existing supply. This is
// what makes spamming factories or double-building a hospital in a small
// town a real money-waster instead of a free lunch.
// Local population of a municipality (its own estimate when we have it, else
// the nearest gameplay city's population).
function municipalityPopFor(municipalityId, cityId) {
  if (municipalityId != null && typeof MUNICIPALITIES !== "undefined") {
    const m = MUNICIPALITIES.find(x => x.id === municipalityId);
    if (m && typeof municipalityPopEstimate === "function") return municipalityPopEstimate(m);
  }
  const c = cityById(cityId);
  return c ? c.pop : 30000;
}

function computeBuildingEffectMultiplier(type, cityId, municipalityId) {
  const def = BUILDING_TYPES[type];
  if (def.sector === "social" && def.servesPopulation) {
    // Effect scales with the LOCAL (municipality) population still unserved.
    // Once existing buildings cover everyone here, a new one adds ~nothing —
    // and beyond that it's pure waste (floor is 0 now, not 5%).
    const pop = municipalityPopFor(municipalityId, cityId);
    const counts = state.municipalityBuildingCounts[municipalityId] || {};
    const existingCoverage = (counts[type] || 0) * def.servesPopulation;
    return clamp((pop - existingCoverage) / def.servesPopulation, 0, 1);
  }
  if (def.demandKey) {
    const demand = state.sectorDemand[def.demandKey] || 0;
    const supply = state.sectorSupply[def.demandKey] || 0;
    return clamp((demand - supply) / def.capacity, 0, 1);
  }
  return 1;
}

// Count of a social building type already covering a municipality, INCLUDING
// ones still under construction (so you can't queue ten hospitals in one town
// before any of them finishes).
function plannedCoverageCount(type, municipalityId) {
  const counts = state.municipalityBuildingCounts[municipalityId] || {};
  let n = counts[type] || 0;
  for (const p of state.constructions) if (p.type === type && p.municipalityId === municipalityId) n++;
  return n;
}

function startConstruction(type, cityId, municipalityId, lat, lon) {
  const def = BUILDING_TYPES[type];
  if (!def || !canAffordBuilding(type)) return null;
  const cost = buildCostFor(type);
  const days = buildDaysFor(type);
  state.econ.treasury -= cost;
  const project = { id: state.buildSeq++, type, cityId, municipalityId: municipalityId || cityId, daysLeft: days, totalDays: days, lat, lon };
  state.constructions.push(project);
  return project;
}

function tickConstructions() {
  for (const proj of state.constructions) {
    proj.daysLeft -= 1;
  }
  const finished = state.constructions.filter(p => p.daysLeft <= 0);
  state.constructions = state.constructions.filter(p => p.daysLeft > 0);
  finished.forEach(p => {
    // Dams complete via their own line-geometry path (scaled by dam size).
    if (p.isDam) {
      if (typeof finalizeDam === "function") finalizeDam(p.damPoints, p.cityId, p.municipalityId, p.sizeFactor);
      playSound("construction");
      logEvent(`<b>Construction complete</b>: ${BUILDING_TYPES.power_hydro.label} — ${fmtNum(Math.round(6000 * (p.sizeFactor || 1)))} MWh/mo online.`);
      return;
    }
    const def = BUILDING_TYPES[p.type];
    const baseMult = computeBuildingEffectMultiplier(p.type, p.cityId, p.municipalityId);
    const roadFactor = roadConnectivityFactor(p.lat, p.lon);
    const munScale = municipalityScale(p.cityId, p.municipalityId);
    def.apply(baseMult * roadFactor * munScale);
    if (def.demandKey) state.sectorSupply[def.demandKey] = (state.sectorSupply[def.demandKey] || 0) + def.capacity * munScale;
    if (def.sector === "social") {
      if (!state.municipalityBuildingCounts[p.municipalityId]) state.municipalityBuildingCounts[p.municipalityId] = {};
      state.municipalityBuildingCounts[p.municipalityId][p.type] = (state.municipalityBuildingCounts[p.municipalityId][p.type] || 0) + 1;
    }
    state.completedBuildings.push({ id: p.id, type: p.type, cityId: p.cityId, municipalityId: p.municipalityId, lat: p.lat, lon: p.lon, baseMult, roadFactor, munScale });
    const sat = baseMult < 0.3 ? " — mostly wasted, demand/population already saturated" : baseMult < 0.7 ? " — partial effect, approaching saturation" : "";
    const roadNote = roadFactor > 1 ? ` · road-connected (+${Math.round((roadFactor - 1) * 100)}% output)` : roadFactor < 1 ? ` · isolated (${Math.round((roadFactor - 1) * 100)}% output — build a road to it to boost productivity)` : "";
    logEvent(`<b>Construction complete</b>: ${def.label} at ${cityById(p.cityId).name} (${(baseMult * 100).toFixed(0)}% effective${sat})${roadNote}.`);
    if (typeof renderCompletedBuildingMarker === "function" && p.lat) renderCompletedBuildingMarker(state.completedBuildings[state.completedBuildings.length - 1]);
  });
}

// Distance (km) to the nearest MAJOR road — a motorway/trunk edge or a road
// the player built. Slovenia's local-road mesh is so dense that "near any
// road" is almost everywhere, so the productivity bonus keys off major roads.
function nearestMajorRoadKm(lat, lon) {
  let best = Infinity;
  if (typeof ROAD_EDGES_REAL !== "undefined") {
    for (const e of ROAD_EDGES_REAL) {
      const pts = e.points; const step = Math.max(1, Math.floor(pts.length / 4));
      for (let i = 0; i < pts.length; i += step) {
        const d = haversineKm(lat, lon, pts[i][0], pts[i][1]); if (d < best) best = d;
      }
    }
  }
  for (const r of (state.customRoads || [])) {
    for (const pt of r.points) { const d = haversineKm(lat, lon, pt[0], pt[1]); if (d < best) best = d; }
  }
  return best;
}

// ---- Economic / industrial zones ----
// A zone develops over time (businesses move in and physically fill the drawn
// area) — faster when corporate tax is low. Each month it CONSUMES its input
// resources; efficiency reflects how much of that need was actually met.
function zoneMonthlyNeed(z, key) {
  return Math.max(1, Math.round(z.areaKm2 * 1.5)); // per input resource, at full development
}

function zoneEfficiency(zone) {
  const eff = zone._eff != null ? zone._eff : 0.3 * (zone.dev || 0.05);
  return { eff };
}

function tickZones() {
  let growth = 0, income = 0, stability = 0, fertility = 0, happiness = 0;
  let solarMWh = 0, elecPriceBonus = 0;
  // Low corporate tax attracts businesses: build-out speed scales with it.
  const corpFactor = clamp(1 + (19 - state.policy.corpTax) * 0.08, 0.3, 2.2);
  for (const z of state.zones) {
    if (z.dev == null) z.dev = 0.05;
    z.dev = Math.min(1, z.dev + corpFactor / 300); // ~10 months to full at the 19% baseline
    const zt = ZONE_TYPES[z.kind];

    // Consume input resources (scaled by development); track fulfillment.
    let fulfillSum = 0;
    z._fulfill = {};
    zt.commodities.forEach(c => {
      const want = zoneMonthlyNeed(z, c) * z.dev / 30;
      const got = Math.min(want, state.commodityStock[c] || 0);
      state.commodityStock[c] = Math.max(0, (state.commodityStock[c] || 0) - got);
      const f = want > 0 ? got / want : 1;
      z._fulfill[c] = f;
      fulfillSum += f;
    });
    const supply = zt.commodities.length ? fulfillSum / zt.commodities.length : 1; // port zones need no inputs
    const eff = clamp(0.3 + supply * 0.9, 0.3, 1.2) * z.dev;
    z._eff = eff;

    growth += zt.baseGrowthPerKm2 * z.areaKm2 * eff;
    income += zt.baseIncomePerKm2 * z.areaKm2 * eff;
    // Residential zones raise stability + fertility instead of growth/income.
    if (zt.stabilityPerKm2) stability += zt.stabilityPerKm2 * z.areaKm2 * eff;
    if (zt.fertilityPerKm2) fertility += zt.fertilityPerKm2 * z.areaKm2 * eff;
    if (zt.happinessPerKm2) happiness += zt.happinessPerKm2 * z.areaKm2 * eff;
    // Industrial zones manufacture electronics & vehicles from raw materials,
    // which in turn feed economic zones.
    if (z.kind === "industrial") {
      state.commodityStock.electronics = (state.commodityStock.electronics || 0) + z.areaKm2 * eff * 0.8 / 30;
      state.commodityStock.automotive = (state.commodityStock.automotive || 0) + z.areaKm2 * eff * 0.6 / 30;
    }
    // Solar zones feed the grid and push electricity prices down as they build out.
    if (zt.electricityPerKm2) solarMWh += zt.electricityPerKm2 * z.areaKm2 * eff;
    if (zt.elecPriceBonusPerKm2) elecPriceBonus += zt.elecPriceBonusPerKm2 * z.areaKm2 * eff;
    if (typeof redrawZoneDev === "function") redrawZoneDev(z);
  }
  state.solarZoneMWh = solarMWh;
  state.zoneEffects = {
    growth: clamp(growth, 0, 0.03), incomeMonthly: income,
    stability: clamp(stability, 0, 0.15), fertility: clamp(fertility, 0, 0.4),
    happiness: clamp(happiness, 0, 12),
    electricityPriceBonus: -clamp(elecPriceBonus, 0, 45),
  };
}

function refundZone(id) {
  const idx = state.zones.findIndex(z => z.id === id);
  if (idx < 0) return;
  const z = state.zones[idx];
  const zt = ZONE_TYPES[z.kind];
  const refund = z.areaKm2 * zt.costPerKm2 * 0.4;
  state.econ.treasury += refund;
  state.zones.splice(idx, 1);
  if (typeof closeMapPopup === "function") closeMapPopup();
  logEvent(`<b>${zt.label}</b> dissolved — ${fmtEUR(refund)} recovered (60% lost).`);
}

// Demolish a completed building: reverse its (additive) effects, refund 40% of
// the build cost, and clean up supply/counts/marker.
function deleteBuildingById(id) {
  const idx = state.completedBuildings.findIndex(b => b.id === id);
  if (idx < 0) return;
  const b = state.completedBuildings[idx];
  const def = BUILDING_TYPES[b.type];
  const applied = (b.baseMult || 1) * (b.roadFactor || 1) * (b.munScale || 1);
  def.apply(-applied); // all effects are additive, so applying the negative reverses them
  if (def.demandKey) state.sectorSupply[def.demandKey] = Math.max(0, (state.sectorSupply[def.demandKey] || 0) - (def.capacity || 0) * (b.munScale || 1));
  if (def.sector === "social" && state.municipalityBuildingCounts[b.municipalityId]) {
    state.municipalityBuildingCounts[b.municipalityId][b.type] = Math.max(0, (state.municipalityBuildingCounts[b.municipalityId][b.type] || 0) - 1);
  }
  const refund = buildCostFor(b.type) * 0.4;
  state.econ.treasury += refund;
  state.completedBuildings.splice(idx, 1);
  if (typeof closeMapPopup === "function") closeMapPopup();
  logEvent(`<b>${def.label}</b> demolished — ${fmtEUR(refund)} recovered (60% of the build cost is lost).`);
}

// Bigger municipalities host bigger builds with bigger effects (and a bigger
// footprint on the map). Keyed off the nearest gameplay city's population.
function municipalityScale(cityId, municipalityId) {
  // Bigger municipalities host bigger builds with bigger effects. Keyed off the
  // municipality's own population when we know it, else the nearest city's.
  const pop = municipalityPopFor(municipalityId, cityId);
  return clamp(0.7 + pop / 250000, 0.7, 1.7);
}

// Buildings near a major road are most productive; those on only local roads
// do a bit better than baseline; truly remote sites run below par until a road
// reaches them (see reevaluateBuildingRoadBonus).
function roadConnectivityFactor(lat, lon) {
  if (lat == null) return 1;
  if (nearestMajorRoadKm(lat, lon) < 2) return 1.25;
  if (typeof nearestRoadNetworkDistanceKm === "function" && nearestRoadNetworkDistanceKm(lat, lon) < 0.8) return 1.05;
  return 0.9;
}

// When a new road opens, nearby buildings that are now better connected get a
// retroactive productivity boost applied to their (additive) effects.
function reevaluateBuildingRoadBonus(roadProj) {
  for (const b of state.completedBuildings) {
    if (b.lat == null) continue;
    let near = false;
    for (const pt of roadProj.points) { if (haversineKm(b.lat, b.lon, pt[0], pt[1]) < 4) { near = true; break; } }
    if (!near) continue;
    const newFactor = roadConnectivityFactor(b.lat, b.lon);
    const old = b.roadFactor || 1;
    if (newFactor > old + 0.001) {
      const def = BUILDING_TYPES[b.type];
      def.apply((b.baseMult || 1) * (newFactor - old)); // additive effects → apply the delta
      b.roadFactor = newFactor;
      logEvent(`<b>${def.label}</b> is now better road-connected — productivity up ${Math.round((newFactor - old) * 100)}%.`);
    }
  }
}

// ---- Player-built roads/railways ----
function tickInfraProjects() {
  for (const proj of state.infraProjects) proj.daysLeft -= 1;
  const finished = state.infraProjects.filter(p => p.daysLeft <= 0);
  state.infraProjects = state.infraProjects.filter(p => p.daysLeft > 0);
  finished.forEach(p => {
    if (p.kind === "road") {
      state.customRoads.push(p);
      addCustomRoadToGraph(p, p.tier);
      if (typeof drawCustomRoad === "function") drawCustomRoad(p);
      reevaluateBuildingRoadBonus(p);
      // Better connectivity lifts public happiness/stability (scales with length).
      state.buildingEffects.stabilityBonus += clamp(p.distKm * 0.0008, 0, 0.02);
    } else {
      RAIL_LINES.push(p.points);
      drawRail();
      // Rail freight makes factories more efficient — more output & income.
      state.buildingEffects.growthBonus += clamp(p.distKm * 0.00006, 0, 0.0012);
      state.buildingEffects.treasuryBonusMonthly += clamp(p.distKm * 0.02e6, 0, 0.5e6);
    }
    logEvent(`<b>Infrastructure complete</b>: new ${p.label || (p.kind === "road" ? "road" : "railway")} (${p.distKm.toFixed(1)} km) opened${p.kind === "road" ? " — connectivity lifts local happiness" : " — boosts factory output"}.`);
  });
}

// ---- Trade / commodities / electricity market ----
function completedBuildingCount(type) {
  return state.completedBuildings.filter(b => b.type === type).length;
}

function updateEnergyStatus() {
  let supply = BASE_ELECTRICITY_MWH;
  // Dams carry their own size-scaled output (damMWh); other plants use the flat
  // per-type table.
  for (const b of state.completedBuildings) supply += b.isDam ? (b.damMWh || 0) : (ELECTRICITY_OUTPUT[b.type] || 0);
  supply += state.solarZoneMWh || 0; // drawable solar zones feed the grid
  supply += state.energyContractMWh || 0; // standing import contract adds to available supply
  const demand = state.econ.population / 1_000_000 * 46000; // MWh/month
  const es = state.energyStatus;
  es.supplyMWh = supply;
  es.demandMWh = demand;
  // A standing export contract commits power to a partner, so it comes off the
  // grid before we work out the domestic balance. Oversell your surplus and the
  // remaining deficit gets bought back at the pricey spot rate — as it should.
  es.exportContractMWh = state.energyExportMWh || 0;
  es.balanceMWh = supply - demand - es.exportContractMWh;
  return es;
}

// Price a partner pays us for a standing electricity export contract — their
// local price (higher-price neighbours like Italy/Austria make selling worth it).
function partnerElecExportPrice() {
  const p = worldPartner(state.elecExportPartner);
  return p ? p.elecPrice : ELEC_EXPORT_PRICE;
}

// Price of an electricity import contract from the contract's partner
// (chosen by clicking a country on the world trade map).
function partnerElecPrice() {
  const p = worldPartner(state.elecContractPartner || state.tradePartner);
  let price = p ? p.elecPrice : ELEC_IMPORT_PRICE;
  if (p && p.natId && state.elecImportDeal === p.natId) price *= 0.75; // negotiated -25% deal
  return price;
}
function worldPartner(id) { return WORLD_MARKET.find(w => w.id === id) || null; }

function tickTradeAndEnergy() {
  // Government-owned factories & mines produce commodities automatically —
  // no material inputs, they buy their own. Accrue 1/30 of monthly output/day.
  const factoryMult = Math.max(0.1, 1 + (modifierEffects().factoryOutputMult || 0));
  for (const b of state.completedBuildings) {
    const prod = BUILDING_PRODUCTION[b.type];
    if (!prod) continue;
    state.commodityStock[prod.commodity] = (state.commodityStock[prod.commodity] || 0) + prod.perMonth * factoryMult / 30;
  }
  // Auto-sell a share of each commodity's stock per day, set by its sell-%.
  for (const key in state.sellPercent) {
    const pct = state.sellPercent[key] || 0;
    const stock = state.commodityStock[key] || 0;
    if (pct > 0 && stock > 0) {
      // Sell pct% of current stock per month, i.e. pct/100/30 of it each day.
      const daily = stock * (pct / 100) / 30;
      state.econ.treasury += daily * (COMMODITIES[key] ? COMMODITIES[key].price : 0) * Math.max(0.2, 1 + (lawEffects().tradeIncomeMult || 0));
      state.commodityStock[key] = Math.max(0, stock - daily);
    }
  }
  // Standing monthly resource imports: 1/30 delivered and paid each day (no
  // success roll — the contract is already signed; capped by availability).
  for (const key in state.monthlyBuy) {
    const mb = state.monthlyBuy[key];
    const p = worldPartner(mb.partner);
    const qty = Math.min(mb.qty, partnerAvail(p, key));
    if (qty <= 0) continue;
    // Standing imports draw on the same monthly export capacity as one-time
    // offers — a partner can run dry mid-month.
    const daily = Math.min(qty / 30, p ? partnerRemainingCapacity(p, key) : qty / 30);
    if (daily <= 0) continue;
    const cost = daily * COMMODITIES[key].price * (p ? p.commodityMult : 1) * 1.1;
    if (state.econ.treasury < cost) continue; // skip the delivery we can't pay for
    state.econ.treasury -= cost;
    state.commodityStock[key] = (state.commodityStock[key] || 0) + daily;
    if (p) addPartnerTraded(p.id, key, daily);
  }

  // Standing electricity import contract: pay the partner each day for it.
  const es = updateEnergyStatus();
  es.contractCostMonthly = (state.energyContractMWh || 0) * partnerElecPrice();
  state.econ.treasury -= es.contractCostMonthly / 30;
  // Standing electricity export contract: the partner pays us each day for it.
  es.exportContractIncomeMonthly = (state.energyExportMWh || 0) * partnerElecExportPrice();
  state.econ.treasury += es.exportContractIncomeMonthly / 30;
  // Any remaining deficit is covered by pricey spot imports; surplus is exported.
  if (es.balanceMWh < 0) {
    es.importCostMonthly = (-es.balanceMWh) * ELEC_IMPORT_PRICE;
    es.exportIncomeMonthly = 0;
    state.econ.treasury -= es.importCostMonthly / 30;
  } else {
    es.exportIncomeMonthly = es.balanceMWh * ELEC_EXPORT_PRICE;
    es.importCostMonthly = 0;
    state.econ.treasury += es.exportIncomeMonthly / 30;
  }
}

// Effective reliability of a trade partner: their base reliability, flexed by
// diplomatic relations for partners we have relations with (nil if at war).
function partnerReliability(id) {
  const p = worldPartner(id);
  if (!p) return 0.85;
  let r = p.reliability;
  if (p.natId && state.diplomacy && state.diplomacy.nations[p.natId]) {
    const n = state.diplomacy.nations[p.natId];
    if (n.atWar) return 0;
    r = clamp(r * (0.5 + n.relation / 100), 0.05, 0.99);
  }
  return r;
}

// How many units of a resource a partner can supply per order.
function partnerAvail(p, key) {
  if (!p) return 300;
  return (p.res && p.res[key] != null) ? p.res[key] : p.avail;
}

// ---- Monthly export capacity: a partner will only sell so much of a
// resource per calendar month before declining further offers. ----
function tradeMonthKey() { return state.date.getFullYear() + "-" + state.date.getMonth(); }

function resetPartnerTradedIfNewMonth() {
  if (state.partnerTraded._month !== tradeMonthKey()) state.partnerTraded = { _month: tradeMonthKey() };
}
function partnerTradedThisMonth(pid, key) {
  resetPartnerTradedIfNewMonth();
  return state.partnerTraded[pid + "|" + key] || 0;
}
function addPartnerTraded(pid, key, qty) {
  resetPartnerTradedIfNewMonth();
  state.partnerTraded[pid + "|" + key] = (state.partnerTraded[pid + "|" + key] || 0) + qty;
}
// A month's worth of exports ≈ 3 full orders of that resource.
function partnerMonthlyCapacity(p, key) { return partnerAvail(p, key) * 3; }
function partnerRemainingCapacity(p, key) {
  if (!p) return Infinity;
  return Math.max(0, partnerMonthlyCapacity(p, key) - partnerTradedThisMonth(p.id, key));
}

// Buy a whole quantity of a resource from a world partner (defaults to the
// selected one). Success depends on the partner's reliability (and your
// relations); they can only supply up to their availability for that resource.
// Returns { ok, msg } so the trade UI can show the accept/decline verdict
// inline, not just in the log.
function buyCommodity(key, qty, partnerId) {
  qty = Math.max(0, Math.floor(qty));
  if (!qty || !COMMODITIES[key]) return { ok: false, msg: "Nothing to order." };
  const p = worldPartner(partnerId || state.tradePartner);
  const who = p ? p.flag + " " + p.name : "The partner";
  const fail = msg => { logEvent(msg); return { ok: false, msg }; };
  const avail = partnerAvail(p, key);
  if (avail <= 0) return fail(`${svgIcon('cross')} ${who} has no ${COMMODITIES[key].label} to export.`);
  // Monthly export capacity: once it's used up, every further offer is declined.
  const remaining = partnerRemainingCapacity(p, key);
  if (remaining <= 0) return fail(`${svgIcon('cross')} <b>${who} declined</b> — they've already sold you their full monthly export capacity of ${COMMODITIES[key].label} (${fmtNum(partnerMonthlyCapacity(p, key))} ${COMMODITIES[key].unit}). Try again next month.`);
  if (qty > avail) qty = avail; // per-order cap
  if (qty > remaining) qty = Math.floor(remaining);
  const unit = COMMODITIES[key].price * (p ? p.commodityMult : 1) * 1.1;
  const cost = unit * qty;
  if (state.econ.treasury < cost) return fail(`${svgIcon('cross')} Cannot afford ${fmtNum(qty)} ${COMMODITIES[key].label} (${fmtEUR(cost)}).`);
  const rel = partnerReliability(p ? p.id : state.tradePartner);
  if (Math.random() > rel) {
    return fail(`${svgIcon('cross')} <b>${who} declined</b> the offer for ${fmtNum(qty)} ${COMMODITIES[key].unit} of ${COMMODITIES[key].label} (deal acceptance ${(rel * 100).toFixed(0)}% — improve relations for better odds).`);
  }
  state.econ.treasury -= cost;
  state.commodityStock[key] = (state.commodityStock[key] || 0) + qty;
  if (p) addPartnerTraded(p.id, key, qty);
  const msg = `${svgIcon('check')} <b>${who} accepted</b> — ${fmtNum(qty)} ${COMMODITIES[key].unit} of ${COMMODITIES[key].label} for <b>${fmtEUR(cost)}</b>. ${p ? `${fmtNum(partnerRemainingCapacity(p, key))} ${COMMODITIES[key].unit} left of their capacity this month.` : ""}`;
  logEvent(msg);
  return { ok: true, msg, cost };
}

// Adjust a standing monthly import (deltaQty can be negative to reduce it).
function adjustMonthlyBuy(key, deltaQty, partnerId) {
  const cur = state.monthlyBuy[key] || { qty: 0, partner: partnerId || state.tradePartner };
  cur.qty = Math.max(0, Math.round(cur.qty + deltaQty));
  cur.partner = partnerId || cur.partner;
  if (cur.qty === 0) delete state.monthlyBuy[key];
  else state.monthlyBuy[key] = cur;
  const p = worldPartner(cur.partner);
  logEvent(cur.qty
    ? `Monthly import set: <b>${fmtNum(cur.qty)} ${COMMODITIES[key].unit} of ${COMMODITIES[key].label}</b>/mo from ${p ? p.flag + " " + p.name : "the market"}.`
    : `Monthly import of ${COMMODITIES[key].label} cancelled.`);
}

// Sell (or buy) a commodity's stock immediately, from the TRADE tab.
function sellCommodity(key, all) {
  const stock = state.commodityStock[key] || 0;
  if (stock <= 0) return 0;
  const revenue = stock * (COMMODITIES[key] ? COMMODITIES[key].price : 0) * Math.max(0.2, 1 + (lawEffects().tradeIncomeMult || 0));
  state.econ.treasury += revenue;
  state.commodityStock[key] = 0;
  logEvent(`Sold ${fmtNum(stock)} ${COMMODITIES[key].unit} of ${COMMODITIES[key].label} for <b>${fmtEUR(revenue)}</b>.`);
  return revenue;
}

// ---- Insight breakdowns (why stability / inflation move) ----
function stabilityBreakdown() {
  const econ = state.econ, pol = state.policy, sp = state.spending, base = SPENDING_BASELINE, fx = totalEffects();
  const items = [];
  const add = (label, v) => { if (Math.abs(v) > 0.0005) items.push({ label, value: v }); };
  add("Healthcare funding", (sp.healthcare - base.healthcare) * 0.010);
  add("Pensions funding", (sp.pensions - base.pensions) * 0.008);
  add("Welfare funding", (sp.welfare - base.welfare) * 0.008);
  add("Education funding", (sp.education - base.education) * 0.006);
  add("Police funding", (sp.police - base.police) * 0.004);
  add("VAT level", -(pol.vat - 22) * 0.015);
  add("Corporate tax level", -(pol.corpTax - 19) * 0.005);
  add("Buildings, tech, laws & modifiers", fx.stabilityBonus || 0);
  if (pol.familyTaxExemption) add("Family tax exemption", 0.015);
  add("Minimum wage", ((pol.minimumWageEUR - 1250) / 1250) * 0.03);
  if (econ.reserveActivated) add("Reserves activated", -0.03);
  if (pol.martialLaw) add("Martial law", -0.08);
  add("Crime / public safety", -(econ.crimeRate - 20) * 0.003);
  add("War exhaustion", -Math.max(0, econ.warExhaustion || 0) * 0.004);
  add("Corruption", -Math.max(0, (econ.corruption || 25) - 25) * 0.0015);
  if (state.energyStatus && state.energyStatus.balanceMWh >= 0) add("Reliable energy supply", 0.012);
  add("Diplomacy / war", typeof diplomacyStabilityDelta === "function" ? diplomacyStabilityDelta() : 0);
  const net = items.reduce((s, i) => s + i.value, 0);
  return { items, net };
}

// Every term of the daily GDP-growth formula, annualized — mirrors
// runDailyUpdate's dailyGrowth exactly so the insight panel can show WHY the
// growth rate is what it is.
function growthBreakdown() {
  const econ = state.econ, pol = state.policy, sp = state.spending, base = SPENDING_BASELINE, fx = totalEffects();
  const items = [];
  const add = (label, v) => { if (Math.abs(v) > 0.00005) items.push({ label, value: v }); };
  add("Baseline growth", 0.021);
  add("Tax burden", -((pol.corpTax - 19) + (pol.vat - 22)) * 0.0004);
  add("Stability level", (econ.stability - 60) * 0.0002);
  const crisisGap = Math.max(0, 40 - econ.stability);
  add("Business collapse (crisis)", -crisisGap * crisisGap * 0.000015);
  add("Minimum wage", -Math.max(0, (pol.minimumWageEUR - 1250) / 1250) * 0.0035);
  if (econ.reserveActivated) add("Reserves activated", -0.0004);
  if (pol.martialLaw) add("Martial law", -0.0015);
  add("Energy prices", -((econ.fuelPriceIndex - 100) + (econ.electricityPriceIndex - 100)) * 0.00003);
  add("Infrastructure spending", (sp.infrastructure - base.infrastructure) * 0.0004);
  add("Military overspend", -Math.max(0, sp.military - 3.5) * 0.0010);
  add("Welfare generosity", -Math.max(0, sp.welfare - base.welfare) * 0.0003);
  if (state.energyStatus && state.energyStatus.balanceMWh >= 0) add("Reliable energy supply", 0.0010);
  add("Economic zones", state.zoneEffects.growth || 0);
  add("Buildings, tech, laws & modifiers", fx.growthBonus || 0);
  add("Event legacy (permanent)", econ.eventGrowthBonus || 0);
  add("Diplomacy / war", typeof diplomacyGrowthBonus === "function" ? diplomacyGrowthBonus() : 0);
  const net = items.reduce((s, i) => s + i.value, 0);
  return { items, net };
}

function inflationReasons() {
  const income = getIncomeBreakdown().total, expense = getExpenseBreakdown().total;
  const deficit = expense > income;
  return { current: state.econ.inflation, target: 0.02, deficit, income, expense };
}

// Deployable manpower: active duty always available; reserves only count
// once activated (state.econ.reserveActivated), which itself carries an
// ongoing stability/growth cost (see runDailyUpdate).
function availableManpower() {
  return state.econ.manpowerActive + (state.econ.reserveActivated ? state.econ.manpowerReserve : 0);
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function fmtEUR(v) {
  const abs = Math.abs(v);
  if (abs >= 1e9) return "€" + (v / 1e9).toFixed(2) + "B";
  if (abs >= 1e6) return "€" + (v / 1e6).toFixed(2) + "M";
  if (abs >= 1e3) return "€" + (v / 1e3).toFixed(1) + "K";
  return "€" + v.toFixed(0);
}

function fmtNum(v) {
  return Math.round(v).toLocaleString("en-US");
}
