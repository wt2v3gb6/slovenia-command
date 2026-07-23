// Research tech tree — a real BRANCHING tree. Each category has a root that
// splits into sub-branches, which split again. A node unlocks only once its
// single prerequisite is complete. You may research up to 3 nodes at once;
// research speed comes from how many schools/universities/tech parks you've
// built (see researchPointsPerDay), not from a budget slider.

const TECH_TREE = [
  {
    id: "industry", label: "Economy & Industry", color: "#e0c97f",
    nodes: [
      { id: "ind_root", name: "Industrial Base", tier: 0, prereq: null, cost: 400, effects: { growthBonus: 0.0006 } },
      { id: "ind_auto", name: "Factory Automation", tier: 1, prereq: "ind_root", cost: 900, effects: { growthBonus: 0.0008, buildCostMult: -0.02 } },
      { id: "ind_logi", name: "Smart Logistics", tier: 1, prereq: "ind_root", cost: 900, effects: { treasuryBonusMonthly: 0.5e6 } },
      { id: "ind_robot", name: "Advanced Robotics", tier: 2, prereq: "ind_auto", cost: 1700, effects: { growthBonus: 0.0012, unitCostMult: -0.03 } },
      { id: "ind_export", name: "Export Champions", tier: 2, prereq: "ind_logi", cost: 1700, effects: { treasuryBonusMonthly: 1.1e6, growthBonus: 0.0006 } },
      { id: "ind_ai", name: "Full Industrial AI", tier: 3, prereq: "ind_robot", cost: 3000, effects: { growthBonus: 0.0022, buildCostMult: -0.05 } },
    ],
  },
  {
    id: "military", label: "Defense R&D", color: "#e08f7f",
    // atk_*/def_* are per-class combat multipliers (inf/armor/arty/air/drone/
    // aa, or *_all) applied in combat via unitCombatMult() — better weapons =
    // more damage, better armor = units absorb hits and survive longer.
    nodes: [
      { id: "mil_root", name: "Modern Small Arms", tier: 0, prereq: null, cost: 400, effects: { unitCostMult: -0.02, atk_inf: 0.12 } },
      { id: "mil_armor", name: "Composite Armor", tier: 1, prereq: "mil_root", cost: 900, effects: { unitCostMult: -0.03, def_armor: 0.15 } },
      { id: "mil_c2", name: "Digital Battle Mgmt", tier: 1, prereq: "mil_root", cost: 900, effects: { unitSpeedMult: 0.05, atk_all: 0.05 } },
      { id: "mil_drone", name: "Domestic Drones", tier: 2, prereq: "mil_armor", cost: 1700, effects: { unitCostMult: -0.05, atk_drone: 0.25 } },
      { id: "mil_smart_ammo", name: "Precision Ammunition", tier: 2, prereq: "mil_armor", cost: 1700, effects: { atk_arty: 0.25, atk_armor: 0.10 } },
      { id: "mil_ew", name: "Electronic Warfare", tier: 2, prereq: "mil_c2", cost: 1700, effects: { stabilityBonus: 0.015, unitSpeedMult: 0.04, def_air: 0.12 } },
      { id: "mil_exo", name: "Infantry Exoskeletons", tier: 3, prereq: "mil_smart_ammo", cost: 2800, effects: { atk_inf: 0.15, def_inf: 0.20 } },
      { id: "mil_armor2", name: "Reactive Armor", tier: 3, prereq: "mil_smart_ammo", cost: 2800, effects: { def_armor: 0.25 } },
      { id: "mil_nato", name: "NATO Interoperability", tier: 3, prereq: "mil_ew", cost: 2800, effects: { stabilityBonus: 0.02, manpowerCapBonus: 3000, def_all: 0.08 } },
      { id: "mil_doctrine", name: "Next-Gen Doctrine", tier: 3, prereq: "mil_drone", cost: 2800, effects: { unitCostMult: -0.06, unitSpeedMult: 0.05, atk_all: 0.10 } },
    ],
  },
  {
    id: "energy", label: "Energy & Environment", color: "#7fe0c9",
    nodes: [
      { id: "en_root", name: "Grid Modernization", tier: 0, prereq: null, cost: 400, effects: { growthBonus: 0.0005 } },
      { id: "en_solar", name: "High-Efficiency Solar", tier: 1, prereq: "en_root", cost: 900, effects: { growthBonus: 0.0007 } },
      { id: "en_storage", name: "Grid Battery Storage", tier: 1, prereq: "en_root", cost: 900, effects: { treasuryBonusMonthly: 0.5e6 } },
      { id: "en_hydro", name: "Hydropower Optimization", tier: 2, prereq: "en_storage", cost: 1600, effects: { treasuryBonusMonthly: 0.8e6 } },
      { id: "en_smr", name: "Small Modular Reactors", tier: 2, prereq: "en_solar", cost: 1800, effects: { growthBonus: 0.0018 } },
      { id: "en_fusion", name: "Fusion Partnership", tier: 3, prereq: "en_smr", cost: 3200, effects: { growthBonus: 0.0028 } },
    ],
  },
  {
    id: "society", label: "Health & Society", color: "#a8c97f",
    nodes: [
      { id: "soc_root", name: "Digital Health Records", tier: 0, prereq: null, cost: 400, effects: { stabilityBonus: 0.01 } },
      { id: "soc_tele", name: "Telemedicine Network", tier: 1, prereq: "soc_root", cost: 900, effects: { stabilityBonus: 0.015 } },
      { id: "soc_prevent", name: "Preventive Care", tier: 1, prereq: "soc_root", cost: 900, effects: { stabilityBonus: 0.015 } },
      { id: "soc_ai", name: "AI Diagnostics", tier: 2, prereq: "soc_tele", cost: 1700, effects: { stabilityBonus: 0.02, researchRateFlat: 15 } },
      { id: "soc_biotech", name: "Biotech Incubator", tier: 2, prereq: "soc_prevent", cost: 1700, effects: { growthBonus: 0.0008, stabilityBonus: 0.01 } },
      { id: "soc_longevity", name: "Longevity Institute", tier: 3, prereq: "soc_ai", cost: 2900, effects: { stabilityBonus: 0.03 } },
    ],
  },
  {
    id: "science", label: "Science & Digital", color: "#7fb0e0",
    nodes: [
      { id: "sci_root", name: "STEM Reform", tier: 0, prereq: null, cost: 400, effects: { researchRateFlat: 10 } },
      { id: "sci_labs", name: "University Lab Grants", tier: 1, prereq: "sci_root", cost: 900, effects: { researchRateMult: 0.05 } },
      { id: "sci_cyber", name: "National Cyber Center", tier: 1, prereq: "sci_root", cost: 900, effects: { stabilityBonus: 0.015 } },
      { id: "sci_cluster", name: "AI Research Cluster", tier: 2, prereq: "sci_labs", cost: 1800, effects: { researchRateMult: 0.08 } },
      { id: "sci_cloud", name: "Sovereign Cloud", tier: 2, prereq: "sci_cyber", cost: 1700, effects: { researchRateMult: 0.04, growthBonus: 0.0008 } },
      { id: "sci_super", name: "National Supercomputer", tier: 3, prereq: "sci_cluster", cost: 3000, effects: { researchRateMult: 0.12, researchRateFlat: 25 } },
    ],
  },
];

// Flatten into a lookup with category color/label attached.
const TECH_NODES = {};
TECH_TREE.forEach(cat => {
  cat.nodes.forEach(n => {
    TECH_NODES[n.id] = Object.assign({}, n, { category: cat.id, categoryLabel: cat.label, color: cat.color });
  });
});
const MAX_RESEARCH_QUEUE = 3;

function techEffectLabel(effects) {
  const parts = [];
  const fmtPct = v => (v >= 0 ? "+" : "") + (v * 100).toFixed(1) + "%";
  if (effects.growthBonus) parts.push(`${fmtPct(effects.growthBonus)}/yr GDP growth`);
  if (effects.stabilityBonus) parts.push(`+${effects.stabilityBonus.toFixed(2)}/day stability`);
  if (effects.researchRateFlat) parts.push(`+${effects.researchRateFlat}/day research`);
  if (effects.researchRateMult) parts.push(`${fmtPct(effects.researchRateMult)} research rate`);
  if (effects.unitCostMult) parts.push(`${fmtPct(effects.unitCostMult)} unit cost`);
  if (effects.unitSpeedMult) parts.push(`${fmtPct(effects.unitSpeedMult)} unit speed`);
  if (effects.buildCostMult) parts.push(`${fmtPct(effects.buildCostMult)} building cost`);
  if (effects.buildTimeMult) parts.push(`${fmtPct(effects.buildTimeMult)} building time`);
  if (effects.manpowerCapBonus) parts.push(`${effects.manpowerCapBonus >= 0 ? "+" : ""}${effects.manpowerCapBonus} manpower cap`);
  if (effects.treasuryBonusMonthly) parts.push(`+${fmtEUR(effects.treasuryBonusMonthly)}/mo income`);
  const combatLabels = {
    atk_all: "damage (all units)", def_all: "armor (all units)",
    atk_inf: "infantry damage", def_inf: "infantry armor",
    atk_armor: "tank/IFV damage", def_armor: "tank/IFV armor",
    atk_arty: "artillery damage", atk_air: "aircraft damage", def_air: "aircraft armor",
    atk_drone: "drone damage", def_drone: "drone armor", atk_aa: "AA damage", def_aa: "AA armor",
  };
  for (const k in combatLabels) if (effects[k]) parts.push(`${fmtPct(effects[k])} ${combatLabels[k]}`);
  return parts.join(", ");
}

// ---- Runtime: research is a flow of points/day split across the queue ----
function researchPointsPerDay(fx) {
  fx = fx || totalEffects();
  const schools = completedBuildingCount("school");
  const unis = completedBuildingCount("university");
  const parks = completedBuildingCount("tech_park");
  const base = 12 + schools * 8 + unis * 25 + parks * 6 + (fx.researchRateFlat || 0);
  const tempBoost = (state.researchBoost && state.researchBoost.daysLeft > 0) ? state.researchBoost.mult : 0;
  return Math.max(1, Math.round(base * (1 + (fx.researchRateMult || 0) + tempBoost)));
}

function tickResearch(fx) {
  const rate = researchPointsPerDay(fx);
  state.econ.researchRate = rate;
  state.econ.research += rate; // lifetime total, feeds HDI education index + dock display
  state.researchQueue = state.researchQueue.filter(id => TECH_NODES[id] && !state.techUnlocked[id]);
  if (!state.researchQueue.length) return;
  const share = rate / state.researchQueue.length;
  for (const id of state.researchQueue.slice()) {
    state.researchProgress[id] = (state.researchProgress[id] || 0) + share;
    if (state.researchProgress[id] >= TECH_NODES[id].cost) completeTech(id);
  }
}

function completeTech(id) {
  const node = TECH_NODES[id];
  if (!node || state.techUnlocked[id]) return;
  state.techUnlocked[id] = true;
  delete state.researchProgress[id];
  state.researchQueue = state.researchQueue.filter(q => q !== id);
  const te = state.techEffects;
  for (const k in node.effects) te[k] = (te[k] || 0) + node.effects[k];
  logEvent(`<b>Research complete</b>: ${node.name} (${node.categoryLabel}) — ${techEffectLabel(node.effects)}.`);
  if (typeof renderResearchTab === "function") renderResearchTab();
}

function techPrereqMet(id) {
  const node = TECH_NODES[id];
  return !node.prereq || !!state.techUnlocked[node.prereq];
}

// A node can be added to the queue if its prereq is met, it isn't done, it
// isn't already queued, and there's a free slot (max 3).
function canQueueTech(id) {
  if (state.techUnlocked[id] || state.researchQueue.includes(id)) return false;
  if (!techPrereqMet(id)) return false;
  return state.researchQueue.length < MAX_RESEARCH_QUEUE;
}

function toggleResearchQueue(id) {
  const i = state.researchQueue.indexOf(id);
  if (i >= 0) { state.researchQueue.splice(i, 1); return true; }   // click again to cancel
  if (!canQueueTech(id)) return false;
  state.researchQueue.push(id);
  return true;
}

// Days until this queued node finishes, given the current shared rate.
function researchETA(id) {
  const node = TECH_NODES[id];
  if (!node) return Infinity;
  const rate = researchPointsPerDay();
  const queueLen = Math.max(1, state.researchQueue.length);
  const share = rate / queueLen;
  const remaining = node.cost - (state.researchProgress[id] || 0);
  return Math.max(1, Math.ceil(remaining / share));
}