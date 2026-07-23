// Rise-of-Nations-style national LAWS + a political-compass IDEOLOGY.
//
// Every law group offers options ordered left→right from most restrictive/
// state-controlled to most permissive/market-driven. Each option carries an
// fx object of ADDITIVE deltas from neutral (0 = no change):
//   growthBonus        annual GDP growth delta (0.001 = +0.1%/yr)
//   stabilityBonus     stability delta per day
//   researchRateMult   ±fraction of research output
//   buildCostMult / buildTimeMult   ±fraction of building cost / time
//   unitCostMult       ±fraction of unit deployment cost
//   upkeepMult         ±fraction of the military budget expense row
//   manpowerCapMult    ±fraction of the recruitable active-duty cap
//   recruitRateMult    ±fraction of daily manpower intake
//   deployDaysMult     ±fraction of unit training time
//   taxIncomeMult      ±fraction of all tax income
//   tradeIncomeMult    ±fraction of commodity sale income
//   migrationPerYear   net migration as a fraction of population per year
//   crimeBonus         crime index target shift
//   fertilityBonus     fertility target shift
//   treasuryBonusMonthly  flat EUR/month
//
// The additive keys that economy.js already reads (growthBonus,
// stabilityBonus, researchRateMult, buildCostMult, buildTimeMult, crimeBonus,
// fertilityBonus, treasuryBonusMonthly) flow in automatically via
// totalEffects(); the law-specific multipliers are read at their own hook
// points via lawEffects().

const LAW_CHANGE_COST = 15e6;        // treasury cost to enact a different law
const LAW_CHANGE_STABILITY = 1.5;    // one-time stability hit
const LAW_CHANGE_COOLDOWN_DAYS = 60; // per-group cooldown between changes

const LAW_GROUPS = [
  {
    key: "conscription", icon: svgIcon("military"), label: "Conscription",
    blurb: "Who serves: from a demilitarized state to universal mandatory service.",
    options: [
      { key: "disarmed", label: "Disarmed", fx: { manpowerCapMult: -0.7, recruitRateMult: -0.7, upkeepMult: -0.4, unitCostMult: 0.3, deployDaysMult: 0.6, growthBonus: 0.0015, stabilityBonus: 0.015 } },
      { key: "volunteer", label: "Volunteer", fx: {} },
      { key: "limited", label: "Limited", fx: { manpowerCapMult: 0.8, recruitRateMult: 0.8, upkeepMult: 0.1, deployDaysMult: -0.1, growthBonus: -0.0003, stabilityBonus: -0.008 } },
      { key: "extensive", label: "Extensive", fx: { manpowerCapMult: 2.0, recruitRateMult: 2.0, upkeepMult: 0.25, deployDaysMult: -0.2, growthBonus: -0.0007, stabilityBonus: -0.018 } },
      { key: "required", label: "Required", fx: { manpowerCapMult: 3.5, recruitRateMult: 3.5, upkeepMult: 0.45, deployDaysMult: -0.3, growthBonus: -0.0012, stabilityBonus: -0.035 } },
    ],
  },
  {
    key: "economy", icon: svgIcon("bank"), label: "Economic System",
    blurb: "How much of the economy the state runs directly.",
    options: [
      { key: "planned", label: "Planned Economy", fx: { growthBonus: -0.004, buildCostMult: -0.20, buildTimeMult: -0.10, taxIncomeMult: 0.10, researchRateMult: -0.10, stabilityBonus: -0.01 } },
      { key: "interventionism", label: "Interventionism", fx: { growthBonus: -0.001, buildCostMult: -0.08, taxIncomeMult: 0.04 } },
      { key: "mixed", label: "Mixed Economy", fx: {} },
      { key: "free_market", label: "Free Market", fx: { growthBonus: 0.003, buildCostMult: 0.05, taxIncomeMult: -0.04, crimeBonus: 1 } },
      { key: "laissez_faire", label: "Laissez-Faire", fx: { growthBonus: 0.006, buildCostMult: 0.10, taxIncomeMult: -0.12, crimeBonus: 3, stabilityBonus: -0.008 } },
    ],
  },
  {
    key: "trade", icon: svgIcon("ship"), label: "Trade Policy",
    blurb: "Openness of the borders to goods and capital.",
    options: [
      { key: "closed", label: "Closed Borders", fx: { growthBonus: -0.006, tradeIncomeMult: -0.5, taxIncomeMult: -0.03, stabilityBonus: 0.005 } },
      { key: "protectionism", label: "Protectionism", fx: { growthBonus: -0.002, tradeIncomeMult: -0.2, taxIncomeMult: 0.03 } },
      { key: "limited_trade", label: "Limited Trade", fx: {} },
      { key: "free_trade", label: "Free Trade", fx: { growthBonus: 0.003, tradeIncomeMult: 0.15, taxIncomeMult: -0.02 } },
    ],
  },
  {
    key: "press", icon: svgIcon("press"), label: "Press & Speech",
    blurb: "State control over media and public discourse.",
    options: [
      { key: "propaganda", label: "State Propaganda", fx: { stabilityBonus: 0.03, researchRateMult: -0.15, growthBonus: -0.001 } },
      { key: "censored", label: "Censored Press", fx: { stabilityBonus: 0.012, researchRateMult: -0.06 } },
      { key: "regulated", label: "Regulated Press", fx: {} },
      { key: "free_press", label: "Free Press", fx: { stabilityBonus: -0.005, researchRateMult: 0.08, growthBonus: 0.0005 } },
    ],
  },
  {
    key: "immigration", icon: svgIcon("passport"), label: "Immigration",
    blurb: "Who may settle in Slovenia — and how many.",
    options: [
      { key: "closed_imm", label: "Closed", fx: { migrationPerYear: -0.001, growthBonus: -0.001, stabilityBonus: 0.005 } },
      { key: "restrictive", label: "Restrictive", fx: {} },
      { key: "selective", label: "Selective", fx: { migrationPerYear: 0.002, growthBonus: 0.0005 } },
      { key: "open_imm", label: "Open Borders", fx: { migrationPerYear: 0.006, growthBonus: 0.0015, stabilityBonus: -0.01, crimeBonus: 2 } },
    ],
  },
  {
    key: "surveillance", icon: svgIcon("eye"), label: "Surveillance & Policing",
    blurb: "How closely the state watches its citizens.",
    options: [
      { key: "minimal", label: "Minimal", fx: { crimeBonus: 4, stabilityBonus: -0.004, growthBonus: 0.0005 } },
      { key: "standard", label: "Standard", fx: {} },
      { key: "heavy", label: "Heavy", fx: { crimeBonus: -5, stabilityBonus: 0.008, researchRateMult: -0.03, growthBonus: -0.0005 } },
      { key: "total", label: "Total Surveillance", fx: { crimeBonus: -12, stabilityBonus: 0.02, researchRateMult: -0.08, growthBonus: -0.0015 } },
    ],
  },
  {
    key: "science", icon: svgIcon("flask"), label: "Science Policy",
    blurb: "State priority given to research programs.",
    options: [
      { key: "underfunded", label: "Underfunded", fx: { researchRateMult: -0.25, treasuryBonusMonthly: 6e6 } },
      { key: "standard_sci", label: "Standard", fx: {} },
      { key: "prioritized", label: "Prioritized", fx: { researchRateMult: 0.20, treasuryBonusMonthly: -8e6 } },
      { key: "moonshot", label: "Moonshot Program", fx: { researchRateMult: 0.5, treasuryBonusMonthly: -25e6, growthBonus: 0.0005 } },
    ],
  },
];

function lawGroup(key) { return LAW_GROUPS.find(g => g.key === key); }
function activeLawOption(group) {
  return group.options.find(o => o.key === state.laws[group.key]) || group.options.find(o => Object.keys(o.fx).length === 0) || group.options[0];
}

// ---- Ideology: 2D political compass ----
// x: economic axis, -1 = fully planned/left, +1 = fully free-market/right
// y: authority axis, -1 = libertarian, +1 = authoritarian
// The player clicks a TARGET; the nation's actual position drifts toward it
// slowly (ideological change takes months). Effects scale linearly with how
// far from the center you are — the deeper into a corner, the stronger.
const IDEOLOGY_DRIFT_PER_DAY = 0.006;

function ideologyEffects(x, y) {
  const fx = {};
  const add = (k, v) => { fx[k] = (fx[k] || 0) + v; };
  if (x >= 0) { // market right
    add("growthBonus", x * 0.005);
    add("taxIncomeMult", -x * 0.10);
    add("buildCostMult", x * 0.06);
    add("tradeIncomeMult", x * 0.10);
  } else { // planned left
    const ax = -x;
    add("growthBonus", -ax * 0.004);
    add("buildCostMult", -ax * 0.15);
    add("buildTimeMult", -ax * 0.08);
    add("taxIncomeMult", ax * 0.10);
    add("upkeepMult", -ax * 0.08);
  }
  if (y >= 0) { // authoritarian
    add("stabilityBonus", y * 0.035);
    add("crimeBonus", -y * 8);
    add("researchRateMult", -y * 0.12);
    add("growthBonus", -y * 0.002);
    add("manpowerCapMult", y * 0.8);
    add("deployDaysMult", -y * 0.2);
    add("migrationPerYear", -y * 0.002);
  } else { // libertarian
    const ly = -y;
    add("researchRateMult", ly * 0.10);
    add("growthBonus", ly * 0.001);
    add("stabilityBonus", -ly * 0.008);
    add("crimeBonus", ly * 3);
    add("migrationPerYear", ly * 0.002);
  }
  return fx;
}

function ideologyName(x, y) {
  const strength = Math.max(Math.abs(x), Math.abs(y));
  if (strength < 0.25) return "Centrist Democracy";
  const strong = strength > 0.65;
  if (x >= 0 && y >= 0) return strong ? "Fascism" : "Conservative Nationalism";
  if (x < 0 && y >= 0) return strong ? "Communism" : "State Socialism";
  if (x < 0 && y < 0) return strong ? "Libertarian Socialism" : "Social Democracy";
  return strong ? "Libertarian Capitalism" : "Liberal Democracy";
}

// Combined law + ideology effect deltas (all additive from neutral 0).
function lawEffects() {
  const out = {};
  const merge = fx => { for (const k in fx) out[k] = (out[k] || 0) + fx[k]; };
  LAW_GROUPS.forEach(g => merge(activeLawOption(g).fx));
  merge(ideologyEffects(state.ideology.x, state.ideology.y));
  return out;
}

// Daily tick: the nation's ideology drifts toward the chosen target.
function tickLawsAndIdeology() {
  const id = state.ideology;
  const step = (cur, tgt) => Math.abs(tgt - cur) <= IDEOLOGY_DRIFT_PER_DAY ? tgt : cur + Math.sign(tgt - cur) * IDEOLOGY_DRIFT_PER_DAY;
  id.x = step(id.x, id.tx);
  id.y = step(id.y, id.ty);
}

// Enact a different option in a law group (costs money + stability, per-group
// cooldown). Returns an error string, or null on success.
function enactLaw(groupKey, optionKey) {
  // Co-op: a joined player's law change is enacted by the authoritative host.
  if (typeof mpRelayIfClient === "function" && mpRelayIfClient("enactLaw", { groupKey, optionKey })) return null;
  const group = lawGroup(groupKey);
  if (!group || state.laws[groupKey] === optionKey) return null;
  const cdUntil = state.lawCooldowns[groupKey] || 0;
  if (state.date.getTime() < cdUntil) {
    return `Parliament won't revisit this law for another ${Math.ceil((cdUntil - state.date.getTime()) / 86400000)} day(s).`;
  }
  if (state.econ.treasury < LAW_CHANGE_COST) return `Changing a law costs ${fmtEUR(LAW_CHANGE_COST)} — treasury too low.`;
  const opt = group.options.find(o => o.key === optionKey);
  if (!opt) return null;
  state.econ.treasury -= LAW_CHANGE_COST;
  state.econ.stability = clamp(state.econ.stability - LAW_CHANGE_STABILITY, 0, 100);
  state.laws[groupKey] = optionKey;
  state.lawCooldowns[groupKey] = state.date.getTime() + LAW_CHANGE_COOLDOWN_DAYS * 86400000;
  logEvent(`<b>${group.icon} ${group.label}</b> law changed to <b>${opt.label}</b> (${fmtEUR(LAW_CHANGE_COST)}, -${LAW_CHANGE_STABILITY} stability).`);
  return null;
}

// Human-readable summary of an fx delta object (for buttons + active rows).
function lawFxSummary(fx) {
  const parts = [];
  const pct = v => `${v > 0 ? "+" : ""}${Math.round(v * 100)}%`;
  if (fx.manpowerCapMult) parts.push(`${pct(fx.manpowerCapMult)} recruitable manpower`);
  if (fx.recruitRateMult) parts.push(`${pct(fx.recruitRateMult)} recruitment rate`);
  if (fx.deployDaysMult) parts.push(`${pct(fx.deployDaysMult)} training time`);
  if (fx.unitCostMult) parts.push(`${pct(fx.unitCostMult)} unit cost`);
  if (fx.upkeepMult) parts.push(`${pct(fx.upkeepMult)} military upkeep`);
  if (fx.growthBonus) parts.push(`${fx.growthBonus > 0 ? "+" : ""}${(fx.growthBonus * 100).toFixed(2)}%/yr growth`);
  if (fx.stabilityBonus) parts.push(`${fx.stabilityBonus > 0 ? "+" : ""}${fx.stabilityBonus.toFixed(3)}/day stability`);
  if (fx.taxIncomeMult) parts.push(`${pct(fx.taxIncomeMult)} tax income`);
  if (fx.tradeIncomeMult) parts.push(`${pct(fx.tradeIncomeMult)} trade income`);
  if (fx.buildCostMult) parts.push(`${pct(fx.buildCostMult)} building cost`);
  if (fx.buildTimeMult) parts.push(`${pct(fx.buildTimeMult)} build time`);
  if (fx.researchRateMult) parts.push(`${pct(fx.researchRateMult)} research output`);
  if (fx.crimeBonus && Math.abs(fx.crimeBonus) >= 0.05) parts.push(`${fx.crimeBonus > 0 ? "+" : ""}${Math.abs(fx.crimeBonus) < 1 ? fx.crimeBonus.toFixed(1) : Math.round(fx.crimeBonus)} crime index`);
  if (fx.fertilityBonus) parts.push(`${fx.fertilityBonus > 0 ? "+" : ""}${fx.fertilityBonus.toFixed(2)} fertility`);
  if (fx.migrationPerYear) parts.push(`${fx.migrationPerYear > 0 ? "+" : ""}${(fx.migrationPerYear * 1000).toFixed(1)}‰/yr net migration`);
  if (fx.treasuryBonusMonthly) parts.push(`${fx.treasuryBonusMonthly > 0 ? "+" : ""}${fmtEUR(fx.treasuryBonusMonthly)}/mo`);
  return parts.length ? parts.join(" · ") : "No modifiers (baseline)";
}
