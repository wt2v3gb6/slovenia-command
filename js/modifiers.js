// Timed national modifiers (buffs/debuffs) granted by events, plus the two
// slow-burn stats they interact with: CORRUPTION and WAR EXHAUSTION.
//
// A modifier is { key, label, icon, fx, daysLeft, permanent }. fx uses the
// same additive-delta keys as laws (growthBonus, stabilityBonus,
// researchRateMult, buildTimeMult, buildCostMult, taxIncomeMult, upkeepMult,
// crimeBonus, fertilityBonus, treasuryBonusMonthly, ...) plus:
//   factoryOutputMult  ±fraction of state factory/mine commodity output
//   unitAttackMult / unitDefenseMult   combat strength of all units
//   corruptionPerDay / warExhaustionPerDay   daily drift of those stats
// Everything additive flows into totalEffects() automatically.

function activeModifiers() { return state.modifiers; }

function hasModifier(key) { return state.modifiers.some(m => m.key === key); }

function modifierEffects() {
  const out = {};
  for (const m of state.modifiers) {
    for (const k in m.fx) out[k] = (out[k] || 0) + m.fx[k];
  }
  return out;
}

// Add (or refresh) a modifier. days = duration in game days; omit or pass
// permanent: true for a permanent one.
function addModifier(def) {
  const existing = state.modifiers.find(m => m.key === def.key);
  if (existing) {
    // re-applying refreshes the clock rather than stacking
    existing.daysLeft = def.permanent ? null : (def.days || 90);
    existing.permanent = !!def.permanent;
    return existing;
  }
  const m = {
    key: def.key, label: def.label, icon: def.icon || svgIcon('gauge'),
    fx: def.fx || {}, permanent: !!def.permanent,
    daysLeft: def.permanent ? null : (def.days || 90),
  };
  state.modifiers.push(m);
  logEvent(`${m.icon} Modifier gained: <b>${m.label}</b> (${m.permanent ? "permanent" : m.daysLeft + " days"}) — ${lawFxSummary(m.fx)}`);
  return m;
}

function removeModifier(key, silent) {
  const m = state.modifiers.find(x => x.key === key);
  if (!m) return false;
  state.modifiers = state.modifiers.filter(x => x.key !== key);
  if (!silent) logEvent(`${m.icon} Modifier ended: <b>${m.label}</b>.`);
  return true;
}

function tickModifiers() {
  const expired = [];
  state.modifiers.forEach(m => {
    if (m.permanent || m.daysLeft == null) return;
    m.daysLeft -= 1;
    if (m.daysLeft <= 0) expired.push(m.key);
  });
  expired.forEach(k => removeModifier(k));

  const econ = state.econ, fx = modifierEffects();

  // WAR EXHAUSTION: creeps up while fighting, decays in peacetime. High
  // exhaustion bleeds stability (applied in runDailyUpdate).
  const warNow = typeof atWarAny === "function" && atWarAny();
  let weDelta = (fx.warExhaustionPerDay || 0);
  weDelta += warNow ? 0.06 : -0.12;
  econ.warExhaustion = clamp((econ.warExhaustion || 0) + weDelta, 0, 100);

  // CORRUPTION: drifts toward a structural target set by surveillance/press
  // laws and ideology, nudged by event modifiers. High corruption skims tax
  // income and stability (applied in runDailyUpdate / getIncomeBreakdown).
  const le = lawEffects();
  let corrTarget = 25;
  if (state.laws.surveillance === "heavy") corrTarget -= 5;
  if (state.laws.surveillance === "total") corrTarget -= 10;
  if (state.laws.press === "free_press") corrTarget -= 6;
  if (state.laws.press === "censored") corrTarget += 5;
  if (state.laws.press === "propaganda") corrTarget += 12;
  corrTarget += Math.max(0, state.ideology.y) * 10; // unchecked authority breeds graft
  econ.corruption = clamp((econ.corruption || 25) + (corrTarget - (econ.corruption || 25)) * 0.005 + (fx.corruptionPerDay || 0), 0, 100);

  // Hyperinflation: printing money raises the risk; each day the dice roll.
  if (state.hyperinflationRisk > 0 && !hasModifier("hyperinflation") && Math.random() < state.hyperinflationRisk / 365) {
    triggerHyperinflation();
  }
  // ...and while it rages, a small daily chance it burns out on its own
  // (much better odds under Harsh Economic Measures).
  if (hasModifier("hyperinflation")) {
    const endChance = hasModifier("harsh_measures") ? 0.02 : 0.004;
    if (Math.random() < endChance) {
      removeModifier("hyperinflation");
      state.hyperinflationRisk = 0;
      pushReportMail("Hyperinflation Ends", "The currency has finally stabilized. Markets breathe again; the hyperinflation debuff is lifted.");
    }
  }

  // Post-war recovery: once every war ends, skilled emigrants may return.
  if (state.wasAtWar && !warNow) {
    state.wasAtWar = false;
    state.postWarPending = true;
  }
  if (warNow) state.wasAtWar = true;
  if (state.postWarPending && !warNow && hasModifier("skills_shortage") && Math.random() < 0.02) {
    state.postWarPending = false;
    removeModifier("skills_shortage");
    pushReportMail("Return of the Skilled Workers", "With peace restored, engineers and specialists who fled abroad are coming home. The Skills Shortage debuff is removed.");
  }
}

function triggerHyperinflation() {
  const lost = state.econ.treasury > 0 ? state.econ.treasury : 0;
  state.econ.treasury = Math.min(state.econ.treasury, 0); // savings wiped, debt stays
  state.econ.stability = clamp(state.econ.stability - 10, 0, 100);
  state.econ.inflation = 0.15;
  addModifier({ key: "hyperinflation", label: "Hyperinflation", icon: svgIcon('moneyburn'), permanent: true,
    fx: { growthBonus: -0.02, stabilityBonus: -0.02, taxIncomeMult: -0.25 } });
  pushReportMail("HYPERINFLATION", `The currency is in free fall. Treasury savings (${fmtEUR(lost)}) are wiped out, stability -10, and the economy is crippled until it ends. Harsh Economic Measures (event) can speed up recovery.`);
}

// Drop a one-button informational mail into the tray (reuses the decision UI).
function pushReportMail(title, body) {
  state.pendingDecisions.push({
    id: state.infraSeq + Math.random(),
    ev: { title, body, choices: [{ label: "Acknowledged", delta: {} }], expiredConsequence: {} },
    createdDate: new Date(state.date),
    deadlineDate: new Date(state.date.getTime() + 30 * 86400000),
    expertsRevealed: false,
  });
  playSound("mail");
  renderPendingTray();
}

// ---- Modifier chips bar (under the top bar) ----
let modifierBarSig = null;
function renderModifierBar() {
  const bar = document.getElementById("modifierBar");
  if (!bar) return;
  const econ = state.econ;
  const chips = [];
  if ((econ.warExhaustion || 0) >= 1) chips.push({ icon: svgIcon('medal'), text: `War exhaustion ${econ.warExhaustion.toFixed(0)}`, tip: "Rises while at war, fades in peace. Drains stability and slows recruitment.", cls: econ.warExhaustion > 40 ? "bad" : "" });
  if ((econ.corruption || 0) >= 35) chips.push({ icon: svgIcon('hole'), text: `Corruption ${econ.corruption.toFixed(0)}`, tip: "Skims tax income and stability. Surveillance and a free press both push it down.", cls: econ.corruption > 55 ? "bad" : "" });
  state.modifiers.forEach(m => {
    chips.push({ icon: m.icon, text: m.label + (m.permanent ? "" : ` (${Math.ceil(m.daysLeft)}d)`), tip: lawFxSummary(m.fx), cls: (m.fx.growthBonus || 0) + (m.fx.stabilityBonus || 0) * 10 >= 0 ? "good" : "bad" });
  });
  const sig = chips.map(c => c.icon + c.text + c.cls).join("|");
  if (sig === modifierBarSig) return;
  modifierBarSig = sig;
  bar.classList.toggle("hidden", chips.length === 0);
  bar.innerHTML = chips.map(c => `<span class="modChip ${c.cls}" title="${c.tip.replace(/"/g, "&quot;")}">${c.icon} ${c.text}</span>`).join("");
}
