// Real-world reference data for Slovenia: cities, airports, ports, bases,
// and hand-mapped motorway routes (approximate real routing, not survey-grade).

// wealthFactor: relative local prosperity multiplier applied to national
// GDP-per-capita to derive an average salary. happinessBias: local offset
// applied to national stability to derive local happiness.
const CITIES = [
  { id: "LJ", name: "Ljubljana",     lat: 46.0569, lon: 14.5058, capital: true, pop: 295504, wealthFactor: 1.35, happinessBias: -2 },
  { id: "MB", name: "Maribor",       lat: 46.5547, lon: 15.6459, pop: 112325, wealthFactor: 1.05, happinessBias: 0 },
  { id: "CE", name: "Celje",         lat: 46.2311, lon: 15.2683, pop: 37872, wealthFactor: 1.00, happinessBias: 0 },
  { id: "KR", name: "Kranj",         lat: 46.2437, lon: 14.3557, pop: 37725, wealthFactor: 1.15, happinessBias: 1 },
  { id: "KP", name: "Koper",         lat: 45.5481, lon: 13.7302, pop: 25753, wealthFactor: 1.15, happinessBias: 2 },
  { id: "NM", name: "Novo Mesto",    lat: 45.8033, lon: 15.1689, pop: 23384, wealthFactor: 1.20, happinessBias: 2 },
  { id: "NG", name: "Nova Gorica",   lat: 45.9558, lon: 13.6483, pop: 13252, wealthFactor: 0.95, happinessBias: 1 },
  { id: "MS", name: "Murska Sobota", lat: 46.6625, lon: 16.1664, pop: 18645, wealthFactor: 0.75, happinessBias: -1 },
  { id: "PT", name: "Ptuj",          lat: 46.4205, lon: 15.8700, pop: 18586, wealthFactor: 0.85, happinessBias: 0 },
  { id: "JE", name: "Jesenice",      lat: 46.4300, lon: 14.0600, pop: 12730, wealthFactor: 0.85, happinessBias: -1 },
  { id: "VE", name: "Velenje",       lat: 46.3592, lon: 15.1100, pop: 25200, wealthFactor: 0.90, happinessBias: -1 },
  { id: "PO", name: "Postojna",      lat: 45.7756, lon: 14.2136, pop: 9271, wealthFactor: 0.90, happinessBias: 2 },
  { id: "KRS", name: "Krško",        lat: 45.9600, lon: 15.4900, pop: 13061, wealthFactor: 1.10, happinessBias: 0 },
  { id: "DO", name: "Domžale",       lat: 46.1400, lon: 14.5950, pop: 13200, wealthFactor: 1.10, happinessBias: 1 },
  // Smaller garrison towns — added so their real barracks (below) have a
  // deployable home region.
  { id: "VR", name: "Vrhnika",             lat: 45.9631, lon: 14.2953, pop: 8620,  wealthFactor: 1.05, happinessBias: 1 },
  { id: "SB", name: "Slovenska Bistrica",  lat: 46.3919, lon: 15.5744, pop: 8060,  wealthFactor: 0.95, happinessBias: 0 },
  { id: "AN", name: "Ankaran",             lat: 45.5786, lon: 13.7367, pop: 3230,  wealthFactor: 1.05, happinessBias: 2 },
  { id: "PI", name: "Pivka",               lat: 45.6822, lon: 14.1956, pop: 2210,  wealthFactor: 0.85, happinessBias: 1 },
  { id: "VP", name: "Vipava",              lat: 45.8467, lon: 13.9633, pop: 1910,  wealthFactor: 0.90, happinessBias: 1 },
  { id: "BB", name: "Bohinjska Bela",      lat: 46.3311, lon: 14.0656, pop: 490,   wealthFactor: 0.90, happinessBias: 2 },
  // Cerklje ob Krki air base sits in the Brežice municipality, not Krško — the
  // base garrison below is homed here so deployment happens at the airfield.
  { id: "BRE", name: "Brežice",            lat: 45.9047, lon: 15.5917, pop: 6780,  wealthFactor: 1.00, happinessBias: 0 },
];

const AIRPORTS = [
  { id: "LJU", name: "Ljubljana Jože Pučnik Airport", lat: 46.2237, lon: 14.4576, civil: true },
  { id: "MBX", name: "Maribor Edvard Rusjan Airport", lat: 46.4799, lon: 15.6861, civil: true },
  { id: "POW", name: "Portorož Airport", lat: 45.4733, lon: 13.6150, civil: true },
  { id: "CEK", name: "Cerklje ob Krki Air Base", lat: 45.9020, lon: 15.5340, military: true },
];

const PORTS = [
  { id: "KOP", name: "Port of Koper", lat: 45.5450, lon: 13.7450 },
];

// Real named barracks (well-documented); a few cities get a generic
// "Garrison" entry instead of a specific historic name where the exact
// facility name couldn't be confidently verified — still real coverage,
// just honestly labeled. Only cities listed here allow troop deployment.
const MILITARY_BASES = [
  { id: "MB01", name: "Edvard Peperko Barracks", lat: 46.0470, lon: 14.5130, city: "LJ" },
  { id: "MB02", name: "General Maister Barracks (Kadetnica)", lat: 46.5620, lon: 15.6550, city: "MB" },
  { id: "MB03", name: "Baron Andrej Čehovin Barracks", lat: 45.7790, lon: 14.2190, city: "PO" },
  { id: "MB04", name: "Cerklje ob Krki Air Base Garrison", lat: 45.9020, lon: 15.5340, city: "BRE" },
  { id: "MB05", name: "Peter Petrič Barracks", lat: 46.2480, lon: 14.3600, city: "KR" },
  { id: "MB06", name: "Franc Uršič Barracks", lat: 45.8010, lon: 15.1730, city: "NM" },
  { id: "MB07", name: "Koper Coastal Defense Garrison", lat: 45.5430, lon: 13.7330, city: "KP" },
  { id: "MB08", name: "Franc Rozman-Stane Barracks", lat: 46.2360, lon: 15.2550, city: "CE" },
  { id: "MB09", name: "Ivan Cankar Barracks", lat: 45.9660, lon: 14.3000, city: "VR" },
  { id: "MB10", name: "Janko Premrl-Vojko Barracks", lat: 45.8450, lon: 13.9600, city: "VP" },
  { id: "MB11", name: "Slovenian Mariners Barracks", lat: 45.5790, lon: 13.7350, city: "AN" },
  { id: "MB12", name: "Boštjan Kekec Barracks", lat: 46.3240, lon: 14.0580, city: "BB" },
  { id: "MB13", name: "Pivka Garrison", lat: 45.6790, lon: 14.1900, city: "PI" },
  { id: "MB14", name: "Murska Sobota Garrison", lat: 46.6580, lon: 16.1600, city: "MS" },
  { id: "MB15", name: "Slovenska Bistrica Garrison", lat: 46.3890, lon: 15.5700, city: "SB" },
];

// Real motorway/trunk geometry is loaded at runtime from data/roads_graph.json
// (fetched from OpenStreetMap and pre-processed — see data/process_roads.js),
// not hand-mapped here. See js/geo.js: loadRoadNetwork().

// Real reference photos (Wikimedia Commons, via the stable Special:FilePath
// redirect rather than a hand-guessed upload URL) so the deploy/build UI can
// show what the thing actually looks like instead of a generic icon.
function commonsImage(filename, width) {
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${filename}?width=${width || 500}`;
}

// domain: "ground" units deploy from a base; "air" units deploy from a
// military airbase and burn fuel (refuel at any friendly airport). attack =
// firepower vs ground; airAttack = firepower vs aircraft; defense = ability to
// absorb hits; range = engagement/strike range in km.
const UNIT_TYPES = {
  inf:   { label: "Infantry Company",        domain: "ground", speed: 22, manpower: 120, cost: 0.9e6, attack: 20, defense: 30, airAttack: 0,  range: 4,  image: commonsImage("Slovenian_soldier-FN_F2000.jpg") },
  ifv:   { label: "Patria AMV (IFV Coy)",    domain: "ground", speed: 46, manpower: 90,  cost: 3.5e6, attack: 45, defense: 40, airAttack: 5,  range: 4,  image: commonsImage("Slovenia_Patria_AMV_Svarun-CV.jpg") },
  mbt:   { label: "M-84 Tank Platoon",       domain: "ground", speed: 38, manpower: 30,  cost: 2.2e6, attack: 70, defense: 60, airAttack: 0,  range: 4,  image: commonsImage("M-84_Tank-Slovenia.jpg") },
  arty:  { label: "155mm Artillery Battery", domain: "ground", speed: 30, manpower: 60,  cost: 2.8e6, attack: 90, defense: 15, airAttack: 0,  range: 15, image: commonsImage("TN90-Slovenia.jpg") },
  // Recon keeps STANDARD INFANTRY attack/defence but has the game's highest
  // scout radius (see scoutRadiusKm) — its job is to see, not to fight.
  recon: { label: "Reconnaissance Platoon",  domain: "ground", speed: 58, manpower: 25,  cost: 0.6e6, attack: 20, defense: 30, airAttack: 0,  range: 4,  image: commonsImage("Valuk_2.jpg") },
  aa:    { label: "Air Defense (SAM) Battery", domain: "ground", speed: 40, manpower: 40, cost: 2.0e6, attack: 20, defense: 30, airAttack: 90, range: 25, requiresAirbase: true, image: commonsImage("Roland_missile_system.jpg") },
  // Mobile logistics: parks near friendly units and replenishes their supply &
  // condition like a mobile base (see groundSupplySourceKm / replenishRateAt).
  supply: { label: "Supply Company", domain: "ground", speed: 42, manpower: 40, cost: 1.2e6, attack: 5, defense: 20, airAttack: 0, range: 2, isSupply: true, supplyRangeKm: 6, replenish: 70, image: commonsImage("Military_logistics_truck.jpg") },

  fighter:      { label: "Fighter Squadron",        domain: "air", speed: 900, manpower: 20, cost: 14e6, attack: 25,  defense: 40, airAttack: 95, range: 40, fuelKm: 1400, image: commonsImage("F-16_Fighting_Falcon.jpg") },
  attack_air:   { label: "Attack Aircraft (CAS)",   domain: "air", speed: 720, manpower: 16, cost: 10e6, attack: 90,  defense: 30, airAttack: 20, range: 35, fuelKm: 1000, image: commonsImage("A-10_Thunderbolt_II.jpg") },
  bomber:       { label: "Bomber Squadron",         domain: "air", speed: 780, manpower: 24, cost: 16e6, attack: 130, defense: 20, airAttack: 10, range: 45, fuelKm: 1800, image: commonsImage("Bomber_aircraft.jpg") },
  attack_drone: { label: "Attack Drone",            domain: "air", speed: 240, manpower: 5,  cost: 4.5e6, attack: 65,  defense: 12, airAttack: 15, range: 30, fuelKm: 1800, image: commonsImage("Bayraktar_TB2.jpg") },
};

const STARTING_INVENTORY = {
  vehicles: { ifv: 76, mbt: 54, trucks: 380, arty: 18, recon: 8 },
  aircraft: { pc9: 12, helicopters: 15 },
  ships: { patrolboats: 5 },
  fuel_tons: 8200,
  ammo_tons: 3100,
  medical_units: 640,
  food_tons: 5200,
};

// Buildings: constructed at a city, cost drawn from treasury upfront, take
// real time to complete, then apply a national bonus.
//
// Two different realism mechanics apply depending on sector:
//  - "social" buildings (hospital/school/university/police) are capped by
//    the target municipality's population — a second hospital in a small
//    town gets ~0 marginal benefit because the first one already covers
//    everyone who could use it. See servesPopulation + economy.js.
//  - "energy"/"economy" buildings feed a national sector demand/supply
//    pool — building past current demand for that sector wastes money for
//    no extra effect until demand (population/GDP growth) catches up. See
//    demandKey + capacity + economy.js applyBuildingEffect().
const BUILDING_TYPES = {
  hospital: {
    label: "Hospital", sector: "social", cost: 45e6, days: 120, servesPopulation: 80000,
    footprintM: 320,
    effectLabel: "+0.02/day Stability trend (scales with local population served)",
    apply: (mult) => { state.buildingEffects.stabilityBonus += 0.02 * mult; },
    image: commonsImage("Ljubljana,_Land_hospital_at_Zaloska_cesta_01.jpg"), // real UKC Ljubljana building
  },
  school: {
    label: "Primary/Secondary School", sector: "social", cost: 30e6, days: 90, servesPopulation: 25000,
    footprintM: 110,
    effectLabel: "+40/day Research (scales with local population served)",
    apply: (mult) => { state.buildingEffects.researchBonus += 40 * mult; },
    image: commonsImage("Osnovna_%C5%A1ola_Puconci.jpg"), // real Slovenian primary school
  },
  university: {
    label: "University", sector: "social", cost: 70e6, days: 200, servesPopulation: 150000,
    footprintM: 300,
    effectLabel: "+120/day Research (scales with local population served)",
    apply: (mult) => { state.buildingEffects.researchBonus += 120 * mult; },
    image: commonsImage("University_of_Ljubljana_Palace.jpg"),
  },
  police_station: {
    label: "Police Station", sector: "social", cost: 18e6, days: 60, servesPopulation: 40000,
    footprintM: 90,
    effectLabel: "-4 Crime Index (scales with local population served)",
    apply: (mult) => { state.buildingEffects.crimeBonus -= 4 * mult; },
    image: commonsImage("Slovenia_-_National_Police_POLICIJA_(Uniformed_Police_Service)_(4346961993).jpg"),
  },
  factory_electronics: {
    label: "Electronics Factory", sector: "economy", cost: 80e6, days: 180, demandKey: "electronics", capacity: 1,
    effectLabel: "+0.15%/yr GDP growth (scales with national demand for electronics)",
    apply: (mult) => { state.buildingEffects.growthBonus += 0.0015 * mult; },
    image: commonsImage("Electronics_factory_in_Shenzhen.jpg"),
  },
  factory_automotive: {
    label: "Automotive Plant", sector: "economy", cost: 95e6, days: 200, demandKey: "automotive", capacity: 1,
    effectLabel: "+0.18%/yr GDP growth (scales with national demand for automotive)",
    apply: (mult) => { state.buildingEffects.growthBonus += 0.0018 * mult; },
    image: commonsImage("GM_Fairfax_Assembly_Plant.jpg"),
  },
  tech_park: {
    label: "Tech Park", sector: "economy", cost: 65e6, days: 150, demandKey: "tech", capacity: 1,
    effectLabel: "+0.10%/yr GDP growth, +30/day Research (scales with demand)",
    apply: (mult) => { state.buildingEffects.growthBonus += 0.0010 * mult; state.buildingEffects.researchBonus += 30 * mult; },
    image: commonsImage("Modern_office_building_(8210028813).jpg"),
  },
  warehouse: {
    label: "Warehouse", sector: "economy", cost: 12e6, days: 45, demandKey: "logistics", capacity: 1,
    effectLabel: "+€0.4M/mo income (scales with national demand for logistics)",
    apply: (mult) => { state.buildingEffects.treasuryBonusMonthly += 0.4e6 * mult; },
    image: commonsImage("Storage_Warehouse_(3).JPG"),
  },
  oil_rig: {
    label: "Offshore Oil Rig", sector: "energy", cost: 70e6, days: 160, demandKey: "fuel", capacity: 1, placeOnWater: true,
    effectLabel: "-8 Fuel Price Index, +0.06%/yr GDP growth · must be placed DIRECTLY on open water (sea or lake)",
    apply: (mult) => { state.buildingEffects.fuelPriceBonus -= 8 * mult; state.buildingEffects.growthBonus += 0.0006 * mult; },
    image: commonsImage("Oil_platform_in_the_North_Sea.jpg"),
  },
  // Solar Power Plant is now a drawable ZONE (see ZONE_TYPES.solar) rather than
  // a placed building — outline a photovoltaic farm and it fills in over time.
  power_wind: {
    label: "Wind Farm", sector: "energy", cost: 55e6, days: 140, demandKey: "electricity", capacity: 1,
    footprintM: 110,
    effectLabel: "-6 Electricity Price Index, +0.07%/yr GDP growth (scales with demand)",
    apply: (mult) => { state.buildingEffects.electricityPriceBonus -= 6 * mult; state.buildingEffects.growthBonus += 0.0007 * mult; },
    image: commonsImage("A_close_shot_of_wind_turbines_wind_farm.jpg"),
  },
  power_hydro: {
    // Built by drawing a dam wall (point A → point B) across a river — see the
    // "dam" build mode in map.js. drawMode keeps it out of the placed-building
    // picker; the def is still used for its cost/effects/electricity output.
    label: "Hydroelectric Dam", sector: "energy", cost: 90e6, days: 220, demandKey: "electricity", capacity: 1.5, drawMode: "dam",
    effectLabel: "-10 Electricity Price Index, +0.12%/yr GDP growth (scales with demand)",
    apply: (mult) => { state.buildingEffects.electricityPriceBonus -= 10 * mult; state.buildingEffects.growthBonus += 0.0012 * mult; },
    image: commonsImage("Hidroelektrarna_Medvode.jpg"), // real Slovenian hydro plant on the Sava
  },
  military_base: {
    label: "Military Base", sector: "military", cost: 45e6, days: 120, enablesDeploy: true,
    replenish: 100, deployDays: 2, // full logistics: fast repair of nearby units, quick training
    effectLabel: "+5,000 Manpower cap · trains units fast · fully replenishes nearby units",
    apply: (mult) => { state.buildingEffects.manpowerCapBonus += 5000 * mult; },
    image: commonsImage("Slovenia_Svarun_8x8.jpg"),
  },
  fob: {
    label: "Forward Operating Base (FOB)", sector: "military", cost: 18e6, days: 60, enablesDeploy: true,
    replenish: 40, deployDays: 5, // austere: slower training, partial replenishment
    effectLabel: "+1,800 Manpower cap · slower training · partial replenishment of nearby units",
    apply: (mult) => { state.buildingEffects.manpowerCapBonus += 1800 * mult; },
    image: commonsImage("Forward_operating_base.jpg"),
  },
};

const BUILDING_SECTORS = [
  { id: "social", label: svgIcon("social") + " Social", icon: svgIcon("social") },
  { id: "economy", label: svgIcon("economy") + " Economy", icon: svgIcon("economy") },
  { id: "energy", label: svgIcon("energy") + " Energy", icon: svgIcon("energy") },
  { id: "resource", label: svgIcon("mines") + " Mines", icon: svgIcon("mines") },
  { id: "military", label: svgIcon("military") + " Military", icon: svgIcon("military") },
];

// Footprint checker colour per sector (paired with near-black for the checker).
const SECTOR_STYLE = {
  social:   { color: "#c0504a" }, // red
  economy:  { color: "#8a8f96" }, // grey
  energy:   { color: "#4faf6a" }, // green
  resource: { color: "#45494f" }, // dark grey
  military: { color: "#2f5f3a" }, // dark green
};

// ---- Nuclear power (real: NEK Krško is Slovenia's only nuclear plant) ----
BUILDING_TYPES.power_nuclear = {
  label: "Nuclear Power Plant", sector: "energy", cost: 420e6, days: 400, demandKey: "electricity", capacity: 4,
  footprintM: 500,
  effectLabel: "Huge electricity output, -18 Electricity Price Index, +0.20%/yr GDP growth",
  apply: (mult) => { state.buildingEffects.electricityPriceBonus -= 18 * mult; state.buildingEffects.growthBonus += 0.0020 * mult; },
  image: commonsImage("Nuclear_Power_Plant_Krško.jpg"),
};

// ---- Mines: buildable ONLY within range of a real resource deposit whose
// resourceId matches. They produce a tradeable commodity every month (sold
// via the TRADE tab). requiresDeposit is enforced in map.js placement. ----
Object.assign(BUILDING_TYPES, {
  mine_coal: {
    label: "Coal Mine", sector: "resource", cost: 55e6, days: 150, requiresDeposit: true, resourceId: "coal",
    effectLabel: "Produces Coal for export · +0.05%/yr GDP growth",
    apply: (mult) => { state.buildingEffects.growthBonus += 0.0005 * mult; },
    image: commonsImage("Coal_mine_Velenje.jpg"),
  },
  mine_mercury: {
    label: "Mercury Mine", sector: "resource", cost: 40e6, days: 140, requiresDeposit: true, resourceId: "mercury",
    effectLabel: "Produces high-value Mercury for export",
    apply: () => {},
    image: commonsImage("Idrija_mercury_mine.jpg"),
  },
  mine_leadzinc: {
    label: "Lead & Zinc Mine", sector: "resource", cost: 45e6, days: 150, requiresDeposit: true, resourceId: "leadzinc",
    effectLabel: "Produces Lead & Zinc for export",
    apply: () => {},
    image: commonsImage("Mežica_mine.jpg"),
  },
  mine_gas: {
    label: "Gas & Oil Field", sector: "resource", cost: 90e6, days: 180, requiresDeposit: true, resourceId: "gas",
    effectLabel: "Extracts Natural Gas · -6 Fuel Price Index",
    apply: (mult) => { state.buildingEffects.fuelPriceBonus -= 6 * mult; },
    image: commonsImage("Petišovci_gas_field.jpg"),
  },
  mine_salt: {
    label: "Salt Works", sector: "resource", cost: 18e6, days: 90, requiresDeposit: true, requiresWater: true, resourceId: "salt",
    effectLabel: "Harvests Sea Salt at the Sečovlje pans — must be on the coastal water",
    apply: () => {},
    image: commonsImage("Sečovlje_Salina.jpg"),
  },
  mine_stone: {
    label: "Stone Quarry", sector: "resource", cost: 22e6, days: 80, requiresDeposit: true, resourceId: "stone",
    effectLabel: "Quarries Stone & Aggregate · -0.02 building cost",
    apply: (mult) => { state.buildingEffects.growthBonus += 0.0002 * mult; },
    image: commonsImage("Limestone_quarry.jpg"),
  },
});

// ---- Additional building variety across sectors ----
Object.assign(BUILDING_TYPES, {
  fire_station: {
    label: "Fire & Rescue Station", sector: "social", cost: 16e6, days: 55, servesPopulation: 55000,
    footprintM: 90,
    effectLabel: "+0.015/day Stability (public safety, scales with population served)",
    apply: (mult) => { state.buildingEffects.stabilityBonus += 0.015 * mult; },
    image: commonsImage("Fire_station.jpg"),
  },
  // Public housing is now a drawable RESIDENTIAL ZONE (see ZONE_TYPES.residential),
  // not a point building.
  sports_center: {
    label: "Sports & Culture Center", sector: "social", cost: 24e6, days: 85, servesPopulation: 70000,
    footprintM: 140,
    effectLabel: "+0.012/day Stability (public wellbeing, scales with population served)",
    apply: (mult) => { state.buildingEffects.stabilityBonus += 0.012 * mult; },
    image: commonsImage("Sports_hall_interior.jpg"),
  },
  retail_park: {
    label: "Retail Park", sector: "economy", cost: 35e6, days: 90, demandKey: "logistics", capacity: 1,
    effectLabel: "+€0.6M/mo income, +0.08%/yr GDP growth (scales with demand)",
    apply: (mult) => { state.buildingEffects.treasuryBonusMonthly += 0.6e6 * mult; state.buildingEffects.growthBonus += 0.0008 * mult; },
    image: commonsImage("Shopping_mall.jpg"),
  },
  food_plant: {
    label: "Food Processing Plant", sector: "economy", cost: 48e6, days: 110, demandKey: "logistics", capacity: 1,
    effectLabel: "+€0.5M/mo income, +0.10%/yr GDP growth (scales with demand)",
    apply: (mult) => { state.buildingEffects.treasuryBonusMonthly += 0.5e6 * mult; state.buildingEffects.growthBonus += 0.0010 * mult; },
    image: commonsImage("Food_processing_plant.jpg"),
  },
  geothermal: {
    label: "Geothermal Plant", sector: "energy", cost: 68e6, days: 170, demandKey: "electricity", capacity: 1,
    requiresDeposit: true, resourceId: "geothermal", footprintM: 160,
    effectLabel: "-7 Electricity Price Index, +0.09%/yr GDP growth · only on a real geothermal field (enable the Resources layer)",
    apply: (mult) => { state.buildingEffects.electricityPriceBonus -= 7 * mult; state.buildingEffects.growthBonus += 0.0009 * mult; },
    image: commonsImage("Geothermal_power_plant.jpg"),
  },
  military_airbase: {
    label: "Military Airbase", sector: "military", cost: 130e6, days: 200, enablesAir: true,
    effectLabel: "Enables air units (fighters, drones, bombers) in this region · +3,000 Manpower cap",
    apply: (mult) => { state.buildingEffects.manpowerCapBonus += 3000 * mult; },
    image: commonsImage("Military_airbase.jpg"),
  },
  radar_station: {
    label: "Air Defense Radar", sector: "military", cost: 45e6, days: 120,
    effectLabel: "+0.02/day Stability (early warning & airspace control)",
    apply: (mult) => { state.buildingEffects.stabilityBonus += 0.02 * mult; },
    image: commonsImage("Radar_antenna.jpg"),
  },
});

// Real (and historically real) Slovenian mineral deposits. A mine may only be
// built within DEPOSIT_RANGE_KM of a deposit whose resourceId it matches.
const DEPOSIT_RANGE_KM = 9;
const RESOURCE_DEPOSITS = [
  { id: "coal_velenje",  resourceId: "coal",     name: "Velenje Lignite Basin",   lat: 46.3630, lon: 15.1110 },
  { id: "coal_zasavje",  resourceId: "coal",     name: "Zasavje Coal (Trbovlje)", lat: 46.1500, lon: 15.0530 },
  { id: "merc_idrija",   resourceId: "mercury",  name: "Idrija Mercury Mine",     lat: 46.0020, lon: 14.0300 },
  { id: "lz_mezica",     resourceId: "leadzinc", name: "Mežica Lead-Zinc",        lat: 46.5210, lon: 14.8500 },
  { id: "lz_litija",     resourceId: "leadzinc", name: "Litija Ore Field",        lat: 46.0580, lon: 14.8280 },
  { id: "gas_petisovci", resourceId: "gas",      name: "Petišovci Gas & Oil",     lat: 46.5170, lon: 16.5000 },
  { id: "salt_secovlje", resourceId: "salt",     name: "Sečovlje Salt Pans",      lat: 45.4890, lon: 13.6070 },
  { id: "stone_podpec",  resourceId: "stone",    name: "Podpeč Limestone Quarry", lat: 45.9800, lon: 14.4200 },
  { id: "stone_hotavlje",resourceId: "stone",    name: "Hotavlje Marble Quarry",  lat: 46.1300, lon: 14.1000 },
  // Real Slovenian geothermal fields (NE Pannonian basin + Krško basin) —
  // geothermal plants may only be built on one of these.
  { id: "geo_lendava",   resourceId: "geothermal", name: "Lendava Geothermal Field",    lat: 46.5560, lon: 16.4520 },
  { id: "geo_moravske",  resourceId: "geothermal", name: "Moravske Toplice Geothermal", lat: 46.6870, lon: 16.2210 },
  { id: "geo_catez",     resourceId: "geothermal", name: "Čatež Geothermal Springs",    lat: 45.8900, lon: 15.6250 },
];
// `icon` is SVG markup for HTML panels. `glyph` is a plain character for the
// map, which draws labels with canvas fillText — passing the SVG string there
// printed its source code across the map instead of an icon.
const RESOURCE_META = {
  geothermal: { label: "Geothermal Heat", icon: svgIcon("geothermal"), glyph: "♨", color: "#e07f5a" },
  coal:     { label: "Coal",       icon: svgIcon("coal"),    glyph: "⛏", color: "#5a5148" },
  mercury:  { label: "Mercury",    icon: svgIcon("mercury"), glyph: "☿", color: "#c96a6a" },
  leadzinc: { label: "Lead & Zinc",icon: svgIcon("gear"),    glyph: "⚙", color: "#8a97a0" },
  gas:      { label: "Gas & Oil",  icon: svgIcon("oildrum"), glyph: "🛢", color: "#c9a24a" },
  salt:     { label: "Sea Salt",   icon: svgIcon("salt"),    glyph: "🧂", color: "#cfd6da" },
  stone:    { label: "Stone",      icon: svgIcon("stone"),   glyph: "🪨", color: "#9a8f7a" },
};

// Tradeable commodities. Government-owned factories & mines produce these
// automatically each month (no material inputs — the plants buy their own);
// you sell the output for treasury income, or buy to build up a stockpile.
const COMMODITIES = {
  electronics: { label: "Electronics",        price: 90000,  unit: "lots" },
  automotive:  { label: "Vehicles & Parts",   price: 110000, unit: "lots" },
  coal:        { label: "Coal",               price: 50000,  unit: "kt" },
  mercury:     { label: "Mercury",            price: 200000, unit: "t" },
  lead_zinc:   { label: "Lead & Zinc",        price: 80000,  unit: "kt" },
  natural_gas: { label: "Natural Gas",        price: 120000, unit: "Mm³" },
  salt:        { label: "Sea Salt",           price: 20000,  unit: "kt" },
  stone:       { label: "Stone & Aggregate",  price: 15000,  unit: "kt" },
};

// Economic vs industrial zones. Instead of point factories, the player draws a
// polygon; the zone's output scales with its area and with how much of its
// input commodities the nation is holding (logical supply chains).
const ZONE_TYPES = {
  economic: {
    label: "Economic Zone", icon: svgIcon("office"), color: "#7fb0e0",
    commodities: ["electronics", "automotive"],
    costPerKm2: 30e6, baseGrowthPerKm2: 0.0016, baseIncomePerKm2: 0.9e6,
    desc: "Offices, retail and services. Output rises with electronics & vehicle supply.",
  },
  industrial: {
    label: "Industrial Zone", icon: svgIcon("economy"), color: "#b0894f",
    commodities: ["coal", "lead_zinc", "natural_gas", "stone", "mercury"],
    costPerKm2: 26e6, baseGrowthPerKm2: 0.0020, baseIncomePerKm2: 0.7e6,
    desc: "Heavy industry & manufacturing. Output rises with coal, metals, gas & stone supply.",
  },
  // The old Commercial Port building is now a drawable coastal zone: outline
  // docks/terminals on the Adriatic shore and they fill in over time.
  port: {
    label: "Port Zone", icon: svgIcon("anchor"), color: "#5aa0d8", requiresCoast: true,
    commodities: [],
    costPerKm2: 60e6, baseGrowthPerKm2: 0.0028, baseIncomePerKm2: 2.4e6,
    desc: "Docks, cranes and terminals. Must touch the Adriatic coast; earns trade income as it builds out.",
  },
  // Public housing is now a drawn residential zone: affordable homes that
  // raise stability and fertility as the district fills in. No resource
  // inputs, no growth/income — a social zone.
  residential: {
    label: "Residential Zone", icon: svgIcon("family"), color: "#c98fd0",
    commodities: [],
    costPerKm2: 18e6, baseGrowthPerKm2: 0, baseIncomePerKm2: 0,
    stabilityPerKm2: 0.010, fertilityPerKm2: 0.018, happinessPerKm2: 0.9,
    desc: "Affordable housing districts. Raises happiness, stability and fertility as they build out; no resource inputs.",
  },
  // Solar Power Plant: a photovoltaic farm drawn like any other zone. As panels
  // are installed (build-out) it feeds electricity into the grid and pushes the
  // electricity price index down — no resource inputs.
  solar: {
    label: "Solar Power Plant", icon: svgIcon("energy"), color: "#e0b84f",
    commodities: [],
    costPerKm2: 40e6, baseGrowthPerKm2: 0.0006, baseIncomePerKm2: 0,
    electricityPerKm2: 1600, elecPriceBonusPerKm2: 3.5,
    desc: "Photovoltaic solar farm. Feeds the grid and lowers electricity prices as panels are installed; no resource inputs.",
  },
};
const COMMODITY_ZONE_TARGET = 60; // stock that fully supplies a zone commodity

// Which building types produce a commodity, and how much per month.
const BUILDING_PRODUCTION = {
  factory_electronics: { commodity: "electronics", perMonth: 40 },
  factory_automotive:  { commodity: "automotive",  perMonth: 35 },
  mine_coal:     { commodity: "coal",       perMonth: 60 },
  mine_mercury:  { commodity: "mercury",    perMonth: 8 },
  mine_leadzinc: { commodity: "lead_zinc",  perMonth: 30 },
  mine_gas:      { commodity: "natural_gas",perMonth: 40 },
  mine_salt:     { commodity: "salt",       perMonth: 50 },
  mine_stone:    { commodity: "stone",      perMonth: 120 },
};

// World market: who you can buy commodities/electricity from. Neighbors plus
// a handful of major exporters. elecPrice is EUR/MWh; commodityMult scales the
// base commodity price when buying from them.
// reliability = base chance a deal goes through; avail = max units they can
// supply per order. Neighbors' effective reliability also flexes with your
// diplomatic relations (see partnerReliability in economy.js). natId links a
// market partner to its diplomacy nation where one exists.
// res = per-resource availability per order, reflecting each country's real
// production strengths (China dominates electronics, Germany vehicles, Norway
// gas, Poland-like coal from the US/China, etc.). geoName matches the Natural
// Earth ADMIN field so the world trade map can find the polygon.
const WORLD_MARKET = [
  { id: "DE", name: "Germany",        flag: "🇩🇪", geoName: "Germany",                  elecPrice: 78, commodityMult: 1.05, reliability: 0.95, avail: 400,
    res: { electronics: 350, automotive: 900, coal: 300, lead_zinc: 120, natural_gas: 80,  salt: 200, stone: 300, mercury: 5 } },
  { id: "AT", name: "Austria",        flag: "🇦🇹", geoName: "Austria",                  elecPrice: 80, commodityMult: 1.04, reliability: 0.92, avail: 250, natId: "AUT",
    res: { electronics: 150, automotive: 250, coal: 40,  lead_zinc: 80,  natural_gas: 40,  salt: 120, stone: 400, mercury: 2 } },
  { id: "IT", name: "Italy",          flag: "🇮🇹", geoName: "Italy",                    elecPrice: 82, commodityMult: 1.03, reliability: 0.92, avail: 300, natId: "ITA",
    res: { electronics: 250, automotive: 500, coal: 60,  lead_zinc: 100, natural_gas: 90,  salt: 300, stone: 600, mercury: 8 } },
  { id: "HU", name: "Hungary",        flag: "🇭🇺", geoName: "Hungary",                  elecPrice: 74, commodityMult: 0.98, reliability: 0.9,  avail: 220, natId: "HUN",
    res: { electronics: 200, automotive: 350, coal: 120, lead_zinc: 60,  natural_gas: 60,  salt: 60,  stone: 250, mercury: 1 } },
  { id: "HR", name: "Croatia",        flag: "🇭🇷", geoName: "Croatia",                  elecPrice: 76, commodityMult: 1.00, reliability: 0.9,  avail: 180, natId: "CRO",
    res: { electronics: 60,  automotive: 80,  coal: 30,  lead_zinc: 40,  natural_gas: 120, salt: 250, stone: 350, mercury: 1 } },
  { id: "FR", name: "France",         flag: "🇫🇷", geoName: "France",                   elecPrice: 70, commodityMult: 1.02, reliability: 0.93, avail: 350,
    res: { electronics: 300, automotive: 600, coal: 80,  lead_zinc: 90,  natural_gas: 50,  salt: 350, stone: 450, mercury: 3 } },
  { id: "CN", name: "China",          flag: "🇨🇳", geoName: "China",                    elecPrice: 55, commodityMult: 0.88, reliability: 0.85, avail: 900,
    res: { electronics: 2000, automotive: 1200, coal: 2500, lead_zinc: 900, natural_gas: 400, salt: 800, stone: 1500, mercury: 60 } },
  { id: "US", name: "United States",  flag: "🇺🇸", geoName: "United States of America", elecPrice: 68, commodityMult: 1.00, reliability: 0.9,  avail: 600,
    res: { electronics: 900, automotive: 800, coal: 1200, lead_zinc: 500, natural_gas: 1500, salt: 600, stone: 900, mercury: 20 } },
  { id: "TR", name: "Türkiye",        flag: "🇹🇷", geoName: "Turkey",                   elecPrice: 60, commodityMult: 0.93, reliability: 0.86, avail: 400,
    res: { electronics: 250, automotive: 450, coal: 500, lead_zinc: 300, natural_gas: 60,  salt: 400, stone: 900, mercury: 10 } },
  { id: "NO", name: "Norway",         flag: "🇳🇴", geoName: "Norway",                   elecPrice: 52, commodityMult: 1.06, reliability: 0.94, avail: 300,
    res: { electronics: 80,  automotive: 60,  coal: 40,  lead_zinc: 250, natural_gas: 2000, salt: 100, stone: 400, mercury: 2 } },
];

// Buildable road & railway types (real-world reference images). Roads feed the
// routing graph at their tier (fast motorway vs slower local); rail is
// rendered and costed but movement stays road-based.
const ROAD_TYPES = {
  local:   { label: "Local Road",  kind: "road", tier: "local",   costPerKm: 1.2e6, daysPerKm: 2, color: "#e0a860", image: commonsImage("Regionalna_cesta_R2.jpg") },
  motorway:{ label: "Motorway",    kind: "road", tier: "highway", costPerKm: 3.6e6, daysPerKm: 4, color: "#ffd35c", image: commonsImage("Avtocesta_A1_Slovenija.jpg") },
};
// Both rail types draw in the same grey-dashed style as the existing network.
const RAIL_TYPES = {
  regional:  { label: "Regional Railway", kind: "rail", costPerKm: 4.5e6, daysPerKm: 4, color: "#c9c9d8", image: commonsImage("Slovenske_železnice_312.jpg") },
  highspeed: { label: "High-Speed Rail",  kind: "rail", costPerKm: 9.0e6, daysPerKm: 7, color: "#c9c9d8", image: commonsImage("TGV_Duplex.jpg") },
};

// Electricity output (MWh/month) by power-plant building type.
const ELECTRICITY_OUTPUT = {
  // Solar output is handled by the solar ZONE (see state.solarZoneMWh), not here.
  power_wind: 3000,
  power_hydro: 6000,
  power_nuclear: 25000,
  geothermal: 4000,
};
// Existing grid Slovenia already runs (NEK, Dravske HE, TEŠ, etc.), so you
// start near self-sufficient and expand toward exporting.
const BASE_ELECTRICITY_MWH = 85000;
const ELEC_IMPORT_PRICE = 85;  // €/MWh bought when short
const ELEC_EXPORT_PRICE = 55;  // €/MWh sold when in surplus

// ----------------------------------------------------------------------------
// LOCAL ARTWORK (images/ folder)
// ----------------------------------------------------------------------------
// The player drops PNGs into slovenia-command/images/ and they are used for the
// build/deploy cards, the placement ghost, and the finished building/zone art.
// Keyed by building type, zone kind, or unit type. Filenames use plain
// UPPERCASE names (with spaces/&) exactly as listed here — add a matching file
// and it appears automatically; missing files fall back to the hatched
// placeholder or the Wikimedia photo. Zone art is used as a SEAMLESS repeating
// tile that fills the zone polygon, so those PNGs should tile edge-to-edge.
const LOCAL_BUILDING_ART = {
  hospital:         "HOSPITAL.png",
  school:           "PRIMARY SECONDARY SCHOOL.png",
  university:       "UNIVERSITY.png",
  police_station:   "POLICE STATION.png",
  fire_station:     "FIRE STATION.png",
  sports_center:    "SPORTS & CULTURE CENTER.png",
  military_base:    "MILITARY BASE.png",
  fob:              "FOB.png",
  military_airbase: "AIR BASE.png",
  radar_station:    "AIR DEFENSE RADAR.png",
  power_nuclear:    "NUCLEAR POWER PLANT.png",
  geothermal:       "GEOTHERMAL PLANT.png",
  power_wind:       "WIND TURBINE PLANT.png",
  oil_rig:          "OFFSHORE OIL RIG.png",
  mine_coal:        "COAL MINE.png",
  mine_leadzinc:    "LEAD & ZINC MINE.png",
  mine_mercury:     "MERCURY MINE.png",
  mine_gas:         "GAS & OIL FIELD.png",
  mine_salt:        "SALT WORKS.png",
  mine_stone:       "STONE QUARRY.png",
  // Hydro dam is drawn as a LINE across a river, not a footprint, so it has no
  // building image (see the dam branch in map.js).
};
const LOCAL_ZONE_ART = {
  industrial:  "INDUSTRIAL ZONE.png",
  residential: "RESIDENTAL ZONE.png",
  solar:       "SOLAR PANEL PLANT.png",
  economic:    "ECONOMIC ZONE.png",
  port:        "PORT ZONE.png",
};
// Units use their built-in reference photos (commonsImage) — no local art files.
// Add an entry here only if you drop a matching PNG into images/ for a unit.
const LOCAL_UNIT_ART = {};

// Image cache. loadArt() kicks off the load once, returns the <img> only when it
// is decoded and safe to draw, and schedules a repaint on arrival so the art
// pops in without a game tick. Failed/missing files resolve to null forever.
const _artImgCache = Object.create(null);
function loadArt(filename) {
  if (!filename) return null;
  let e = _artImgCache[filename];
  if (e) return e.ready ? e.img : null;
  e = { img: new Image(), ready: false, failed: false };
  e.img.onload = () => {
    e.ready = true;
    if (typeof mapEngine !== "undefined" && mapEngine) mapEngine._scheduleRender();
  };
  e.img.onerror = () => { e.failed = true; };
  // encode spaces / & etc.; the dev + electron servers both decodeURIComponent.
  e.img.src = "images/" + encodeURIComponent(filename);
  _artImgCache[filename] = e;
  return null;
}
function buildingArt(type) { return loadArt(LOCAL_BUILDING_ART[type]); }
function zoneArt(kind)     { return loadArt(LOCAL_ZONE_ART[kind]); }
function unitArt(type)     { return loadArt(LOCAL_UNIT_ART[type]); }
// URL (or null) for a type's local art — used by HTML <img> cards which can do
// their own onerror fallback. Does not touch the decode cache.
function localArtUrl(map, key) {
  const f = map[key];
  return f ? "images/" + encodeURIComponent(f) : null;
}

// Canvas pattern cache for seamless zone fills. Built once per (kind,image).
const _zonePatternCache = Object.create(null);
function zonePattern(ctx, kind) {
  const img = zoneArt(kind);
  if (!img) return null;
  let pat = _zonePatternCache[kind];
  if (!pat) { pat = ctx.createPattern(img, "repeat"); _zonePatternCache[kind] = pat; }
  return pat;
}

// ----------------------------------------------------------------------------
// UNIT EXPERIENCE (veterancy)
// ----------------------------------------------------------------------------
// A unit earns experience by fighting; more battles → more experience → more
// stars (1..5) → a combat-stat multiplier. Winning battles also lifts national
// stability and loots supply off the dead (see diplomacy.js combat).
const EXP_STAR_THRESHOLDS = [0, 25, 70, 150, 300]; // exp needed for stars 1..5
function unitStars(u) {
  const exp = (u && u.exp) || 0;
  let s = 1;
  for (let i = 1; i < EXP_STAR_THRESHOLDS.length; i++) if (exp >= EXP_STAR_THRESHOLDS[i]) s = i + 1;
  return s; // 1..5
}
// +6% combat power per star above the first, so a 5-star veteran hits ~24% harder.
function unitExpMult(u) { return 1 + (unitStars(u) - 1) * 0.06; }
// Render stars as filled/empty pips (used in the unit panel & battle modal).
function starString(n) { return "★★★★★".slice(0, n) + "☆☆☆☆☆".slice(0, 5 - n); }
