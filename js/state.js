// Central mutable game state. Numbers are rough real-world-scale starting
// values for Slovenia (order-of-magnitude realistic, not exact statistics).

const state = {
  date: new Date(2026, 6, 14), // start "today"
  speedIndex: 1, // index into SPEEDS, default 1x
  paused: false,

  econ: {
    gdp: 68.4e9,           // annual GDP, EUR
    gdpGrowth: 0.021,       // annual %
    population: 2_120_000,
    // Realistic scale: Slovenian Armed Forces active duty is ~7,000, not a
    // percentage of total population. Reserves exist but are only usable
    // once activated (with consequences) — see runDailyUpdate.
    manpowerActive: 6_800,
    manpowerActiveCap: 7_000,
    manpowerReserve: 14_500,
    manpowerReserveCap: 15_000,
    reserveActivated: false,
    treasury: 3.1e9,
    debt: 49.5e9,
    inflation: 0.024,
    stability: 71,          // 0-100
    research: 0,            // accumulated research points
    researchRate: 340,      // points/day baseline
    corpTax: 19,
    vat: 22,
    incomeTaxAvg: 25,
    eventGrowthBonus: 0, // permanent small nudges from event choices

    lifeExpectancy: 81.3,
    fertilityRate: 1.62,
    hdi: 0.918,
    overallHappiness: 71,
    unemploymentRate: 5.0,
    emigrationRate: 0,
    crimeRate: 18, // 0-100, informal "public safety concern" index
    crudeBirthRate: 9.5,  // births per 1000 population/year
    crudeDeathRate: 10.7, // deaths per 1000 population/year
    corruption: 25,       // 0-100: skims tax income + stability (see modifiers.js)
    warExhaustion: 0,     // 0-100: rises at war, fades at peace, drains stability
  },

  policy: {
    militaryPctGDP: 2.0,
    healthPctBudget: 16,
    eduPctBudget: 12,
    corpTax: 19,
    vat: 22,
    familyTaxExemption: false, // no income tax for families with 3+ children
    minimumWageEUR: 1250,       // real threshold; baseline ~1250 EUR/mo (roughly Slovenia's actual minimum wage)
    conscription: false,        // mandatory service: large active-duty boost, ongoing stability/growth cost
    martialLaw: false,          // emergency powers: unlocks full reserve pool, severe stability/happiness/growth cost
    fullRecruitment: false,     // run recruiting facilities at full capacity: +100-300 personnel/day (300-500 under martial law)
  },

  inventory: JSON.parse(JSON.stringify(STARTING_INVENTORY)),

  units: [], // { id, type, cityId, lat, lon, path:[{lat,lon,cityId,onRoad}], moving, hp, name }
  selectedUnitId: null,

  pendingWaypoints: [], // building a path before ENTER

  buildingEffects: {
    stabilityBonus: 0,
    researchBonus: 0,
    growthBonus: 0,
    manpowerCapBonus: 0,
    treasuryBonusMonthly: 0,
    fuelPriceBonus: 0,        // negative = cheaper fuel
    electricityPriceBonus: 0, // negative = cheaper electricity
    crimeBonus: 0,             // negative = less crime
    fertilityBonus: 0,         // raises the fertility target (e.g. public housing)
  },
  constructions: [], // { id, type, cityId, municipalityId, daysLeft, totalDays, effectMult }
  completedBuildings: [], // { id, type, cityId, municipalityId }
  buildSeq: 1,

  // National sector demand/supply — building past current demand for a
  // sector wastes money for near-zero extra effect (see economy.js).
  sectorDemand: { fuel: 0, electricity: 0, electronics: 0, automotive: 0, logistics: 0, tech: 0 },
  sectorSupply: { fuel: 0, electricity: 0, electronics: 0, automotive: 0, logistics: 0, tech: 0 },

  // Per-municipality counts of "social" buildings already built there, used
  // to cap effect by local population (see economy.js).
  municipalityBuildingCounts: {}, // municipalityId -> { hospital: n, school: n, ... }

  econExtra: { fuelPriceIndex: 100, electricityPriceIndex: 100 },

  cityStats: {}, // cityId -> { happiness, avgSalary }
  selectedCityId: null,
  selectedMunicipalityId: null,

  techUnlocked: {}, // nodeId -> true
  techEffects: {
    growthBonus: 0, stabilityBonus: 0, researchRateFlat: 0, researchRateMult: 0,
    unitCostMult: 0, unitSpeedMult: 0, buildCostMult: 0, buildTimeMult: 0,
    manpowerCapBonus: 0, treasuryBonusMonthly: 0,
  },

  infraProjects: [], // { id, kind: 'road'|'rail', points, cityA, cityB, daysLeft, totalDays }
  customRoads: [], // completed player-built roads, folded into the routing graph
  infraSeq: 1,

  // RoN-style national laws (see js/laws.js for groups/options/effects).
  laws: {
    conscription: "volunteer",
    economy: "mixed",
    trade: "limited_trade",
    press: "regulated",
    immigration: "restrictive",
    surveillance: "standard",
    science: "standard_sci",
  },
  lawCooldowns: {}, // groupKey -> epoch ms until the law can change again

  // Political compass: x = planned(-1)..free-market(+1), y = libertarian(-1)..
  // authoritarian(+1). (x,y) is the nation's actual position; (tx,ty) is the
  // player's chosen target it drifts toward. Slovenia starts as a mildly
  // market-leaning liberal democracy.
  ideology: { x: 0.3, y: -0.25, tx: 0.3, ty: -0.25 },

  eventLog: [],
  nextEventInDays: 6 + Math.random() * 10,
  unitSeq: 1,

  pendingDecisions: [], // queued/postponed events: { ev, deadlineDate, expiredConsequence }

  // Timed national buffs/debuffs from events (see js/modifiers.js).
  modifiers: [],          // { key, label, icon, fx, daysLeft, permanent }
  hyperinflationRisk: 0,  // 0..1-ish, raised by printing money
  wasAtWar: false,
  postWarPending: false,

  // Risky (chance-based) event choices don't reveal their outcome
  // immediately — they resolve a few in-game days later and the result
  // arrives as a report in the mail tray. { ev, choice, resolveDate }
  pendingOutcomes: [],

  // Day-over-day deltas for the bottom dock's color/trend-arrow display.
  statTrends: { stability: 0, gdp: 0, treasury: 0, population: 0, research: 0, manpower: 0 },
  prevDayValues: null,
};

// ---- Spending departments (each = % of GDP per year). This is now the
// single source of truth for government expenditure; every slider carries a
// real consequence on the metric it funds (see economy.js runDailyUpdate). ----
state.spending = {
  military: 2.0,
  healthcare: 7.0,
  education: 5.0,
  pensions: 11.0,
  police: 1.7,
  infrastructure: 4.0,
  welfare: 5.0,
};

// ---- Research: pick up to 3 techs to research at once. Speed is driven by
// how many schools/universities you've built, not by a budget slider. ----
state.researchQueue = [];      // up to 3 node ids currently being researched
state.researchProgress = {};   // nodeId -> accumulated research points
state.researchBoost = { mult: 0, daysLeft: 0 }; // temporary research-speed multiplier from events

// ---- Trade / resources / energy ----
state.commodityStock = {};     // commodityKey -> units held in national storage
state.sellPercent = {};        // commodityKey -> 0..100: auto-sell this % of stock/day
state.elecImportDeal = null;   // nation id of a standing electricity import deal, or null
state.tradePartner = "DE";     // fallback partner id (all buying now happens per-country on the trade map)
state.energyContractMWh = 0;   // standing monthly electricity import (buying)
state.elecContractPartner = null; // world-market partner id the electricity import contract is with
state.energyExportMWh = 0;     // standing monthly electricity export (selling) to a partner
state.elecExportPartner = null; // world-market partner id the electricity export contract is with
state.partnerTraded = { _month: null }; // "partnerId|resource" -> units bought this calendar month
state.energyStatus = { supplyMWh: 0, demandMWh: 0, balanceMWh: 0, importCostMonthly: 0, exportIncomeMonthly: 0, contractCostMonthly: 0, exportContractMWh: 0, exportContractIncomeMonthly: 0 };

// ---- Economic / industrial zones (drawn polygons, not point buildings) ----
state.zones = [];              // { id, kind, points:[[lat,lon]], cityId, municipalityId, areaKm2, dev }
state.zoneSeq = 1;
state.zoneEffects = { growth: 0, incomeMonthly: 0, stability: 0, fertility: 0, happiness: 0, electricityPriceBonus: 0 }; // recomputed each day from resource supply
state.solarZoneMWh = 0;        // grid electricity (MWh/month) from drawable solar zones

// Standing monthly resource purchases: key -> { qty, partner }
state.monthlyBuy = {};

// Speed ladder shown in the top bar. Index 0 is the paused state, kept for the
// pause toggle's internal use. Four real speeds: 1x, 5x, 50x, 100x.
const SPEEDS = [
  { label: "II", mult: 0, arrows: 0 },   // pause
  { label: "1x", mult: 1, arrows: 1 },
  { label: "5x", mult: 5, arrows: 2 },
  { label: "50x", mult: 50, arrows: 3 },
  { label: "100x", mult: 100, arrows: 4 },
];
