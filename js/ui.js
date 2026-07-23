// DOM wiring: nav drawer, bottom stat dock, hover breakdowns, speed controls,
// city panel (inline build/deploy), overview/research tabs, event modal with
// impact previews, uncertainty/experts/postpone, pending-decisions tray.

let activeTab = null;

function initUI() {
  // Swap any data-icon placeholder into an inline SVG (dock stat labels).
  document.querySelectorAll("[data-icon]").forEach(el => {
    el.innerHTML = `${svgIcon(el.dataset.icon)} ${el.innerHTML}`;
  });
  buildSpeedControls();
  buildNavButtons();
  buildTooltipHandlers();
  bindInsightAdjusters();
  buildLayerToggles();
  document.getElementById("drawerClose").addEventListener("click", closeDrawer);
  document.getElementById("alertBell").addEventListener("click", () => openTab("log"));
  document.getElementById("cityPanelClose").addEventListener("click", closeCityPanel);
  document.getElementById("roadBuildConfirm").addEventListener("click", () => confirmBuild());
  document.getElementById("roadBuildCancel").addEventListener("click", () => cancelBuild());
  document.getElementById("eventModalPostpone").addEventListener("click", postponeCurrentDecision);
  const rClose = document.getElementById("researchOverlayClose");
  if (rClose) rClose.addEventListener("click", closeResearchOverlay);
  document.getElementById("policiesOverlayClose").addEventListener("click", closePoliciesOverlay);
  document.getElementById("policiesOverlay").addEventListener("click", (e) => { if (e.target.id === "policiesOverlay") closePoliciesOverlay(); });
  document.getElementById("pTabLaws").addEventListener("click", () => switchPoliciesTab("laws"));
  document.getElementById("pTabIdeology").addEventListener("click", () => switchPoliciesTab("ideology"));
  const rOverlay = document.getElementById("researchOverlay");
  if (rOverlay) rOverlay.addEventListener("click", (e) => { if (e.target.id === "researchOverlay") closeResearchOverlay(); });
  window.addEventListener("resize", () => { if (researchOverlayOpen) drawTechConnectors(); });
  renderEventLog();
}

// ---- Nav / drawer ----
function buildNavButtons() {
  document.querySelectorAll(".navbtn").forEach(btn => {
    btn.addEventListener("click", () => {
      const tab = btn.dataset.tab;
      // Research gets a full-screen overlay (the branching tree needs room);
      // Trade opens the world trade map directly.
      if (tab === "research") { toggleResearchOverlay(); return; }
      if (tab === "trade") { openTradeMap(); return; }
      if (tab === "policies") { togglePoliciesOverlay(); return; }
      if (activeTab === tab) closeDrawer();
      else openTab(tab);
    });
  });
}

function openTab(tab) {
  activeTab = tab;
  document.getElementById("drawer").classList.remove("hidden");
  document.querySelectorAll(".tabpane").forEach(p => p.classList.toggle("active", p.id === "tab-" + tab));
  document.querySelectorAll(".navbtn").forEach(b => b.classList.toggle("active", b.dataset.tab === tab));
  const titles = { diplomacy: svgIcon('globe') + " DIPLOMACY", log: svgIcon('press') + " EVENT LOG" };
  document.getElementById("drawerTitle").innerHTML = titles[tab] || tab.toUpperCase();
  if (tab === "diplomacy") renderDiplomacyTab();
}

function closeDrawer() {
  activeTab = null;
  document.getElementById("drawer").classList.add("hidden");
  document.querySelectorAll(".navbtn").forEach(b => b.classList.remove("active"));
}

// ---- Speed controls ----
function buildSpeedControls() {
  const box = document.getElementById("speedControls");
  box.innerHTML = "";
  const pauseBtn = document.createElement("button");
  pauseBtn.id = "pauseBtn";
  pauseBtn.className = "playpause";
  pauseBtn.title = "Pause / Play (Space)";
  pauseBtn.addEventListener("click", () => {
    if (typeof mpRelayIfClient === "function" && mpRelayIfClient("setPaused", { paused: !state.paused })) return;
    state.paused = !state.paused; refreshSpeedButtons();
  });
  box.appendChild(pauseBtn);

  SPEEDS.forEach((sp, i) => {
    if (i === 0) return; // index 0 is the paused pseudo-speed
    const btn = document.createElement("button");
    btn.className = "speedbtn";
    btn.dataset.idx = i;
    btn.title = `${sp.label} speed`;
    btn.textContent = sp.label;
    btn.addEventListener("click", () => {
      if (typeof mpRelayIfClient === "function" && mpRelayIfClient("setSpeed", { index: i })) return;
      state.speedIndex = i;
      state.paused = false;
      refreshSpeedButtons();
    });
    box.appendChild(btn);
  });
  refreshSpeedButtons();
}

function refreshSpeedButtons() {
  const pb = document.getElementById("pauseBtn");
  if (pb) pb.textContent = state.paused ? "▶" : "⏸"; // play when paused, pause when running
  document.querySelectorAll("#speedControls .speedbtn").forEach(btn => {
    const idx = Number(btn.dataset.idx);
    btn.classList.toggle("active", !state.paused && idx === state.speedIndex);
  });
}

// ---- Map layer toggles + build mode ----
function buildLayerToggles() {
  // The checkboxes themselves are wired up by bindLayerToggle() in initMap() —
  // they flip flags in map.js's layerState, which the overlay pass reads each
  // frame. (They used to add/remove Leaflet layer objects here; those are gone.)
  // Little reference thumbnail next to each build button (reuses the real
  // road/rail photos from data.js).
  const roadBtn = document.getElementById("buildRoadModeBtn");
  const railBtn = document.getElementById("buildRailModeBtn");
  roadBtn.innerHTML = `<img class="buildBtnImg" src="${ROAD_TYPES.motorway.image}" alt="" onerror="this.remove()"><span>+ Build Road</span>`;
  railBtn.innerHTML = `<img class="buildBtnImg" src="${RAIL_TYPES.regional.image}" alt="" onerror="this.remove()"><span>+ Build Railway</span>`;
  roadBtn.addEventListener("click", () => startBuildMode("road"));
  railBtn.addEventListener("click", () => startBuildMode("rail"));
}

// ---- City / municipality panel ----
// IMPORTANT: this panel used to rebuild its entire innerHTML (including the
// interactive select/button elements) on every game tick, 10x/second. If a
// tick landed between a user's mousedown and mouseup, the button they were
// clicking got swapped out from under the pointer and the click silently
// never fired — a real, reproducible bug, not just a testing artifact.
// Fix: build the DOM structure once per selection/mode change; ticks only
// ever touch text content and .disabled, never remove/replace the controls
// themselves.
let cityPanelMode = null; // null | "build" | "deploy"
let cityPanelDisplayName = null;

function openCityPanel(gameplayCityId, selectionId, displayName) {
  state.selectedCityId = gameplayCityId;
  state.selectedMunicipalityId = selectionId;
  cityPanelDisplayName = displayName;
  cityPanelMode = null;
  document.getElementById("cityPanel").classList.remove("hidden");
  document.getElementById("pendingDecisions").classList.add("tray-shifted"); // don't cover the mail tray
  buildCityPanelStructure();
  // AFTER the content exists — the layout is measured, so running it on an
  // empty panel would read a height of ~0 and stack the unit panel wrongly.
  layoutBottomLeftPanels();
}

function closeCityPanel() {
  state.selectedCityId = null;
  state.selectedMunicipalityId = null;
  cityPanelMode = null;
  if (typeof cancelPlacementMode === "function") cancelPlacementMode();
  document.getElementById("cityPanel").classList.add("hidden");
  layoutBottomLeftPanels();
  document.getElementById("pendingDecisions").classList.remove("tray-shifted");
}

function buildCityPanelStructure() {
  const city = cityById(state.selectedCityId);
  const hasBase = cityHasBase(city.id);
  const airCapable = cityAirCapable(city.id);
  const canDeployHere = hasBase || airCapable;
  const label = cityPanelDisplayName || city.name;
  document.getElementById("cityPanelTitle").textContent = label.toUpperCase() + (city.capital ? " (CAPITAL REGION)" : "");

  const mun = MUNICIPALITIES.find(x => x.id === state.selectedMunicipalityId);
  const bCounts = (state.municipalityBuildingCounts || {})[state.selectedMunicipalityId] || {};
  const builtHere = Object.entries(bCounts).filter(([, n]) => n > 0).map(([t, n]) => `${(BUILDING_TYPES[t] || { label: t }).label} ×${n}`).join(", ");
  document.getElementById("cityPanelBody").innerHTML = `
    <div class="row"><span>Nearest gameplay city</span><b>${city.name}</b></div>
    ${mun ? `<div class="row"><span>Municipality population (est.)</span><b id="cpPop"></b></div>
    <div class="row"><span>Area</span><b>${municipalityAreaKm2(mun).toFixed(0)} km²</b></div>` : `<div class="row"><span>Population</span><b id="cpPop"></b></div>`}
    <div class="row"><span>Happiness</span><b id="cpHappy"></b></div>
    <div class="row"><span>Average Salary</span><b id="cpSalary"></b></div>
    <div class="row"><span>Unemployment</span><b id="cpUnemp"></b></div>
    ${builtHere ? `<div class="row"><span>Built here</span><b>${builtHere}</b></div>` : ""}
    <div class="row"><span>Military Base</span><b>${hasBase ? "Yes" : "No"}</b></div>
    <div class="row"><span>Air Base / Airport</span><b>${airCapable ? "Yes" : "No"}</b></div>
    <div class="cityActionButtons">
      <button id="cpChooseBuild">${svgIcon('mines')} Build Here</button>
      <button id="cpChooseDeploy" ${canDeployHere ? "" : "disabled"}>${svgIcon('military')} Deploy Troops</button>
    </div>
    <div id="cpFormArea"></div>
  `;
  document.getElementById("cpChooseBuild").addEventListener("click", () => { cityPanelMode = "build"; buildCityBuildForm(); });
  if (canDeployHere) document.getElementById("cpChooseDeploy").addEventListener("click", () => { cityPanelMode = "deploy"; buildCityDeployForm(); });
  updateCityPanelStats();
}

let cpSelectedBuildType = null;
let cpSelectedBuildSector = "social";
let cpSelectedUnitType = null;

function pickCardFallbackIcon(def) {
  if (def.domain) return svgIcon(def.domain === "air" ? "energy" : "military");
  const s = BUILDING_SECTORS.find(x => x.id === def.sector);
  return s ? s.icon : svgIcon('mines');
}

// Unit stat badges shown on deploy cards.
function unitStatBadges(def) {
  const parts = [`ATK ${def.attack}`, `DEF ${def.defense}`];
  if (def.airAttack) parts.push(`AA ${def.airAttack}`);
  parts.push(`${def.range}km`);
  if (def.fuelKm) parts.push(`fuel ${fmtNum(def.fuelKm)}km`);
  return `<div class="pickStats">${parts.join(" · ")}</div>`;
}

function pickerCardsHTML(entries, selectedKey, showStats) {
  return `<div class="pickerGrid">${entries.map(([key, def]) => {
    const bg = def.sector ? ((SECTOR_STYLE[def.sector] || {}).color || "#2a3a44") : "#2a3a44";
    return `
    <div class="pickCard ${key === selectedKey ? "pickCard-selected" : ""}" data-key="${key}">
      <div class="pickImgWrap" style="background:${bg}33"><span class="pickFallback">${pickCardFallbackIcon(def)}</span><img src="${def.image}" alt="${def.label}" onerror="this.style.display='none'" /></div>
      <div class="pickCardName">${def.label}${showStats ? unitStatBadges(def) : ""}</div>
    </div>`; }).join("")}</div>`;
}

function buildCityBuildForm() {
  const city = cityById(state.selectedCityId);
  const area = document.getElementById("cpFormArea");
  const sectorTabs = `<div class="sectorTabs">${BUILDING_SECTORS.map(s => `<button class="sectorTab ${s.id === cpSelectedBuildSector ? "sectorTab-active" : ""}" data-sector="${s.id}">${s.label}</button>`).join("")}</div>`;
  const bindSectorTabs = () => area.querySelectorAll(".sectorTab").forEach(tab => tab.addEventListener("click", () => { cpSelectedBuildSector = tab.dataset.sector; cpSelectedBuildType = null; buildCityBuildForm(); }));

  // Economy sector = draw-a-zone system (+ Port as a normal placed building).
  if (cpSelectedBuildSector === "economy") {
    if (typeof cancelPlacementMode === "function") cancelPlacementMode();
    const zoneCard = (k) => `<div class="pickCard zoneCard" data-zone="${k}"><div class="pickImgWrap" style="background:${ZONE_TYPES[k].color}33"><span class="pickFallback">${ZONE_TYPES[k].icon}</span></div><div class="pickCardName">${ZONE_TYPES[k].label}<div class="pickStats">draw ≥3 points</div></div></div>`;
    area.innerHTML = `
      <div class="panelhead" style="margin-top:10px;">BUILD HERE</div>
      ${sectorTabs}
      <div class="pickerGrid">
        ${zoneCard("economic")}${zoneCard("industrial")}${zoneCard("port")}${zoneCard("residential")}
      </div>
      <div class="buildHint">${ZONE_TYPES.economic.desc}<br>${ZONE_TYPES.industrial.desc}<br>${ZONE_TYPES.port.desc}<br>${ZONE_TYPES.residential.desc}<br><b>Zones:</b> click ≥3 points on the map to outline the area.</div>
    `;
    bindSectorTabs();
    area.querySelectorAll("[data-zone]").forEach(c => c.addEventListener("click", () => { startZoneDraw(c.dataset.zone, city.id, state.selectedMunicipalityId); }));
    return;
  }

  // Energy sector = Solar (drawable zone) + Hydro Dam (drawable line) + the
  // remaining placed plants (wind, nuclear, geothermal, oil rig).
  if (cpSelectedBuildSector === "energy") {
    if (typeof cancelPlacementMode === "function") cancelPlacementMode();
    const placedEntries = Object.entries(BUILDING_TYPES).filter(([, def]) => def.sector === "energy" && !def.drawMode);
    if (!cpSelectedBuildType || !placedEntries.some(([k]) => k === cpSelectedBuildType)) cpSelectedBuildType = placedEntries[0][0];
    const st = ZONE_TYPES.solar, damDef = BUILDING_TYPES.power_hydro;
    const solarCard = `<div class="pickCard zoneCard" data-solarzone="1"><div class="pickImgWrap" style="background:${st.color}33"><span class="pickFallback">${st.icon}</span></div><div class="pickCardName">${st.label}<div class="pickStats">draw ≥3 points</div></div></div>`;
    const damCard = `<div class="pickCard zoneCard" data-dam="1"><div class="pickImgWrap" style="background:#4a4f5533"><span class="pickFallback">${svgIcon('energy')}</span></div><div class="pickCardName">${damDef.label}<div class="pickStats">click A → B</div></div></div>`;
    area.innerHTML = `
      <div class="panelhead" style="margin-top:10px;">BUILD HERE</div>
      ${sectorTabs}
      <div class="pickerGrid">${solarCard}${damCard}</div>
      <div class="buildHint">${st.desc}<br>${damDef.label}: click <b>point A</b> then <b>point B</b> to lay a dam wall across a river.<br><b>Other plants below</b> — pick one, then click inside the highlighted region to place it.</div>
      ${pickerCardsHTML(placedEntries, cpSelectedBuildType)}
      <div id="cpBuildCostLine"></div>
    `;
    bindSectorTabs();
    area.querySelector("[data-solarzone]").addEventListener("click", () => startZoneDraw("solar", city.id, state.selectedMunicipalityId));
    area.querySelector("[data-dam]").addEventListener("click", () => startDamDraw(city.id, state.selectedMunicipalityId));
    area.querySelectorAll(".pickCard[data-key]").forEach(card => {
      card.addEventListener("click", () => {
        cpSelectedBuildType = card.dataset.key;
        area.querySelectorAll(".pickCard[data-key]").forEach(c => c.classList.toggle("pickCard-selected", c.dataset.key === cpSelectedBuildType));
        updateCityBuildCostLine();
        startPlacementMode(cpSelectedBuildType, city.id, state.selectedMunicipalityId);
      });
    });
    updateCityBuildCostLine();
    return;
  }

  const sectorEntries = Object.entries(BUILDING_TYPES).filter(([, def]) => def.sector === cpSelectedBuildSector);
  if (!cpSelectedBuildType || !sectorEntries.some(([k]) => k === cpSelectedBuildType)) {
    cpSelectedBuildType = sectorEntries[0][0];
  }

  area.innerHTML = `
    <div class="panelhead" style="margin-top:10px;">BUILD HERE</div>
    ${sectorTabs}
    ${pickerCardsHTML(sectorEntries, cpSelectedBuildType)}
    <div id="cpBuildCostLine"></div>
    <div class="buildHint">Pick a type, then <b>click inside the highlighted region</b> on the map to place it. Keep clicking to place more. ESC to stop.</div>
  `;
  bindSectorTabs();
  area.querySelectorAll(".pickCard").forEach(card => {
    card.addEventListener("click", () => {
      cpSelectedBuildType = card.dataset.key;
      document.querySelectorAll("#cpFormArea .pickCard").forEach(c => c.classList.toggle("pickCard-selected", c.dataset.key === cpSelectedBuildType));
      updateCityBuildCostLine();
      startPlacementMode(cpSelectedBuildType, city.id, state.selectedMunicipalityId);
    });
  });
  updateCityBuildCostLine();
  startPlacementMode(cpSelectedBuildType, city.id, state.selectedMunicipalityId);
}

// Called by map.js after a building is successfully placed, so the panel's
// cost line (which reflects live saturation) stays in sync.
function onBuildingPlaced() {
  if (cityPanelMode === "build") updateCityBuildCostLine();
}

function updateCityBuildCostLine() {
  const line = document.getElementById("cpBuildCostLine");
  if (!line || !cpSelectedBuildType) return;
  const type = cpSelectedBuildType;
  const def = BUILDING_TYPES[type];
  const ok = canAffordBuilding(type);
  const mult = computeBuildingEffectMultiplier(type, state.selectedCityId, state.selectedMunicipalityId);
  let saturationNote = "";
  if (mult < 0.3) saturationNote = `<div class="afford-no">⚠ ~${(mult * 100).toFixed(0)}% effective — ${def.sector === "social" ? "population here is already served" : "national demand for this sector is already met"}. Mostly wasted money.</div>`;
  else if (mult < 0.7) saturationNote = `<div class="saturation-warn">~${(mult * 100).toFixed(0)}% effective — approaching saturation.</div>`;
  line.innerHTML = `<b>${fmtEUR(buildCostFor(type))}</b> · ${buildDaysFor(type)} days<br>${def.effectLabel}${saturationNote}` + (ok ? "" : `<div class="afford-no">Insufficient treasury.</div>`);
  const btn = document.getElementById("cpBuildBtn");
  if (btn) btn.disabled = !ok;
}

function buildCityDeployForm() {
  if (typeof cancelPlacementMode === "function") cancelPlacementMode(); // leaving build mode
  const city = cityById(state.selectedCityId);
  cpSelectedUnitType = cpSelectedUnitType || Object.keys(UNIT_TYPES)[0];
  const airCapable = cityAirCapable(city.id);

  const groundEntries = Object.entries(UNIT_TYPES).filter(([, d]) => d.domain !== "air");
  const airEntries = Object.entries(UNIT_TYPES).filter(([, d]) => d.domain === "air");

  document.getElementById("cpFormArea").innerHTML = `
    <div class="panelhead" style="margin-top:10px;">GROUND UNITS</div>
    ${pickerCardsHTML(groundEntries, cpSelectedUnitType, true)}
    <div class="panelhead" style="margin-top:10px;">AIR UNITS ${airCapable ? "" : '<span class="reqTag">needs a Military Airbase here</span>'}</div>
    ${pickerCardsHTML(airEntries, cpSelectedUnitType, true)}
    <div id="cpUnitCostLine"></div>
    <button id="cpDeployBtn">DEPLOY</button>
  `;
  document.getElementById("cpFormArea").querySelectorAll(".pickCard").forEach(card => {
    card.addEventListener("click", () => {
      cpSelectedUnitType = card.dataset.key;
      document.querySelectorAll("#cpFormArea .pickCard").forEach(c => c.classList.toggle("pickCard-selected", c.dataset.key === cpSelectedUnitType));
      updateCityDeployCostLine();
    });
  });
  updateCityDeployCostLine();
  document.getElementById("cpDeployBtn").addEventListener("click", () => {
    const type = cpSelectedUnitType;
    const u = deployUnit(type, city.id);
    if (u) {
      logEvent(`Trained ${u.name} at ${city.name} for ${fmtEUR(UNIT_TYPES[type].cost)}.`);
      updateCityDeployCostLine();
    }
  });
}

function updateCityDeployCostLine() {
  const line = document.getElementById("cpUnitCostLine");
  if (!line || !cpSelectedUnitType) return;
  const type = cpSelectedUnitType;
  const city = cityById(state.selectedCityId);
  const def = UNIT_TYPES[type];
  const ok = canDeploy(type, city.id);
  const air = def.domain === "air" || def.requiresAirbase;
  let why = "";
  if (!ok) {
    if (air && !cityAirCapable(city.id)) why = "Needs a Military Airbase / airport in this region.";
    else if (!air && !cityHasBase(city.id)) why = "Needs a military base in this region.";
    else why = "Not enough treasury or manpower.";
  }
  line.innerHTML = `<b>${fmtEUR(unitDeployCost(type))}</b> · Manpower ${def.manpower} · ATK ${def.attack} DEF ${def.defense}${def.airAttack ? " AA " + def.airAttack : ""} · ${def.range}km${air ? " · needs airport to refuel" : ""}` + (ok ? "" : `<div class="afford-no">${why}</div>`);
  document.getElementById("cpDeployBtn").disabled = !ok;
}

function updateCityPanelStats() {
  const city = cityById(state.selectedCityId);
  const popEl = document.getElementById("cpPop");
  if (!popEl) return;
  const mun = MUNICIPALITIES.find(x => x.id === state.selectedMunicipalityId);
  // Every municipality gets its own local stats — gameplay cities use their
  // real figures, the rest get area/density-based estimates (see geo.js).
  const s = mun ? municipalityStats(mun) : Object.assign({ pop: city.pop, unemployment: state.econ.unemploymentRate }, state.cityStats[city.id] || { happiness: 0, avgSalary: 0 });
  popEl.textContent = fmtNum(s.pop);
  document.getElementById("cpHappy").textContent = s.happiness.toFixed(0) + "%";
  document.getElementById("cpSalary").textContent = fmtEUR(s.avgSalary) + "/mo";
  const unEl = document.getElementById("cpUnemp");
  if (unEl) unEl.textContent = s.unemployment.toFixed(1) + "%";
}

function renderCityPanel() {
  const panel = document.getElementById("cityPanel");
  if (panel.classList.contains("hidden") || !state.selectedCityId) return;
  updateCityPanelStats();
  if (cityPanelMode === "build") updateCityBuildCostLine();
  if (cityPanelMode === "deploy") updateCityDeployCostLine();
}

// ---- Dock stat color grading + trend arrows ----
// "absolute" mode grades a bounded value directly (e.g. stability 0-100).
// "trend" mode grades the day-over-day change instead — appropriate for
// unbounded values like GDP/population where the number itself has no
// inherent "good/bad", only its direction does (a falling population is
// bad regardless of whether it's 2.1M or 2.0M). Each stat has wildly
// different natural day-to-day volatility (population moves ~0.001%/day,
// treasury can swing several % ) so trend sensitivity is a per-stat
// reference scale, not a single global percentage.
const DOCK_TREND_SCALE = { gdp: 20e6, treasury: 5e6, research: 400, population: 400, manpower: 40, stability: 0.4 };

function dockGradientColor(score) {
  const hue = clamp(score, 0, 1) * 120; // 0=red, 60=yellow, 120=green
  return `hsl(${hue}, 65%, 58%)`;
}

function applyDockColor(valId, arrowId, value, trend, opts) {
  const valEl = document.getElementById(valId);
  const arrowEl = document.getElementById(arrowId);
  if (!valEl) return;

  const scale = DOCK_TREND_SCALE[opts.key] || 1;
  let score;
  if (opts.mode === "absolute") {
    score = (value - opts.min) / (opts.max - opts.min);
  } else {
    score = clamp(0.5 + (trend / scale) * 0.5, 0, 1);
  }
  valEl.style.color = dockGradientColor(score);

  if (!arrowEl) return;
  const relMagnitude = Math.abs(trend / scale);
  if (relMagnitude < 0.08) { arrowEl.textContent = ""; return; }
  arrowEl.style.fontSize = Math.min(19, 10 + relMagnitude * 9) + "px";
  arrowEl.style.color = trend > 0 ? "#7fe0a0" : "#e08f7f";
  arrowEl.textContent = trend > 0 ? "▲" : "▼";
}

// ---- Top bar clock + live refresh ----
function renderTopBar() {
  const econ = state.econ;
  document.getElementById("clockDate").textContent = state.date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  document.getElementById("clockTime").textContent = state.date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  document.getElementById("statStability").textContent = econ.stability.toFixed(0) + "%";
  document.getElementById("statHappiness").textContent = econ.overallHappiness.toFixed(0) + "%";
  document.getElementById("statGDP").textContent = fmtEUR(econ.gdp);
  document.getElementById("statTreasury").textContent = fmtEUR(econ.treasury);
  document.getElementById("statPopulation").textContent = fmtNum(econ.population);
  document.getElementById("statManpower").textContent = fmtNum(availableManpower());
  document.getElementById("alertCount").textContent = state.pendingDecisions.length;

  applyDockColor("statStability", "trendStability", econ.stability, state.statTrends.stability, { mode: "absolute", min: 0, max: 100, key: "stability" });
  applyDockColor("statHappiness", "trendHappiness", econ.overallHappiness, state.statTrends.happiness || 0, { mode: "absolute", min: 0, max: 100, key: "happiness" });
  applyDockColor("statGDP", "trendGdp", econ.gdp, state.statTrends.gdp, { mode: "trend", key: "gdp" });
  applyDockColor("statTreasury", "trendTreasury", econ.treasury, state.statTrends.treasury, { mode: "trend", key: "treasury" });
  applyDockColor("statPopulation", "trendPopulation", econ.population, state.statTrends.population, { mode: "trend", key: "population" });
  applyDockColor("statManpower", "trendManpower", availableManpower(), state.statTrends.manpower, { mode: "trend", key: "manpower" });

  // Nation-level stats now live directly in the dock.
  const hdiEl = document.getElementById("statHDI");
  if (hdiEl) { hdiEl.textContent = econ.hdi.toFixed(3); hdiEl.style.color = dockGradientColor((econ.hdi - 0.7) / 0.25); }
  const unEl = document.getElementById("statUnemployment");
  if (unEl) { unEl.textContent = econ.unemploymentRate.toFixed(1) + "%"; unEl.style.color = dockGradientColor(1 - (econ.unemploymentRate - 3) / 12); }

  const tradeMapOpen = !document.getElementById("tradeMapOverlay").classList.contains("hidden");
  if (tradeMapOpen && tradeBuilt) updateTradeNumbers();
  if (activeTab === "diplomacy" && atWarAny()) renderDiplomacyTab();
  if (researchOverlayOpen) updateResearchQueueBar();
  renderPoliciesDynamic();
  renderModifierBar();
  renderCityPanel();
  renderPendingTray();
  renderInsight();
}

// ---- NATION tab: each card pairs a live stat with the policies that
// actually move it, so cause and effect sit next to each other. ----
const NATION_CARDS = [
  {
    icon: "💰", title: "Economy & Growth",
    stats: () => [
      ["GDP", fmtEUR(state.econ.gdp)],
      ["Growth rate", (state.econ.gdpGrowth * 100).toFixed(2) + "%/yr"],
      ["GDP per Capita", fmtEUR(state.econ.gdp / state.econ.population) + "/yr"],
      ["Inflation", (state.econ.inflation * 100).toFixed(2) + "%"],
    ],
    controls: [
      { id: "polCorpTax", type: "slider", min: 10, max: 35, step: 1, label: "Corporate Tax Rate", get: () => state.policy.corpTax, set: v => state.policy.corpTax = v, fmt: v => v.toFixed(0) + "%",
        effect: () => { const d = (state.policy.corpTax - 19) * 0.0004; return `${d >= 0 ? "-" : "+"}${Math.abs(d * 100).toFixed(3)}%/yr growth drag`; } },
      { id: "polVAT", type: "slider", min: 10, max: 27, step: 1, label: "VAT Rate", get: () => state.policy.vat, set: v => state.policy.vat = v, fmt: v => v.toFixed(0) + "%",
        effect: () => { const d = (state.policy.vat - 22) * 0.0004; return `${d >= 0 ? "-" : "+"}${Math.abs(d * 100).toFixed(3)}%/yr growth drag`; } },
    ],
  },
  {
    icon: "🏦", title: "Treasury & Budget",
    stats: () => [
      ["Treasury", fmtEUR(state.econ.treasury)],
      ["Budget balance", fmtEUR(getIncomeBreakdown().total - getExpenseBreakdown().total) + "/mo"],
      ["Public Debt", fmtEUR(state.econ.debt) + ` (${(state.econ.debt / state.econ.gdp * 100).toFixed(0)}% of GDP)`],
      ["Adjust spending", "→ click TREASURY in the bottom bar"],
    ],
    controls: [],
  },
  {
    icon: "❤️", title: "Healthcare",
    stats: () => [
      ["Life Expectancy", state.econ.lifeExpectancy.toFixed(1) + " years"],
      ["Health spending", state.spending.healthcare.toFixed(1) + "% of GDP"],
    ],
    controls: [],
  },
  {
    icon: "🎓", title: "Education & Research",
    stats: () => [
      ["Research rate", "+" + fmtNum(state.econ.researchRate) + "/day"],
      ["Schools built", fmtNum(completedBuildingCount("school"))],
      ["Universities built", fmtNum(completedBuildingCount("university"))],
    ],
    controls: [],
  },
  {
    icon: "👶", title: "Family & Population",
    stats: () => [
      ["Fertility Rate", state.econ.fertilityRate.toFixed(2) + " births/woman"],
      ["Population", fmtNum(state.econ.population)],
      ["Emigration", state.econ.emigrationRate > 0 ? "-" + (state.econ.emigrationRate * 100).toFixed(2) + "%/day (crisis-driven)" : "None"],
    ],
    controls: [
      { id: "polFamilyExempt", type: "checkbox", label: "No income tax for families with 3+ children", get: () => state.policy.familyTaxExemption, set: v => state.policy.familyTaxExemption = v,
        effect: () => state.policy.familyTaxExemption ? `Costs ${fmtEUR(9e6)}/mo · +0.25 fertility target · +0.015/day stability` : "Fertility target unaffected" },
    ],
  },
  {
    icon: "😊", title: "Society & Labor",
    stats: () => [
      ["Overall Happiness", state.econ.overallHappiness.toFixed(0) + "%"],
      ["Political Stability", state.econ.stability.toFixed(0) + "%"],
      ["Unemployment", state.econ.unemploymentRate.toFixed(1) + "%"],
    ],
    controls: [
      { id: "polMinWage", type: "slider", min: 700, max: 2500, step: 25, label: "Minimum Wage (EUR/month)", get: () => state.policy.minimumWageEUR, set: v => state.policy.minimumWageEUR = v, fmt: v => "€" + v.toFixed(0),
        effect: () => {
          const gap = (state.policy.minimumWageEUR - 1250) / 1250;
          if (Math.abs(gap) < 0.01) return "At baseline — no distortion";
          const drag = Math.max(0, gap) * 0.35;
          const stab = gap * 0.03 * 365;
          return gap > 0
            ? `+${(gap * 3).toFixed(1)}% unemployment · -${drag.toFixed(2)}%/yr growth · +${stab.toFixed(1)}/yr stability trend`
            : `${(gap * 3).toFixed(1)}% unemployment · ${stab.toFixed(1)}/yr stability trend (workers worse off)`;
        } },
    ],
  },
  {
    icon: "🚓", title: "Public Safety",
    stats: () => [["Crime Index", state.econ.crimeRate.toFixed(0) + "/100"]],
    controls: [],
  },
  {
    icon: "🪖", title: "Defense & Manpower",
    stats: () => [
      ["Active Duty", fmtNum(state.econ.manpowerActive) + " / " + fmtNum(state.econ.manpowerActiveCap)],
      ["Reserves", fmtNum(state.econ.manpowerReserve) + " / " + fmtNum(state.econ.manpowerReserveCap) + (state.econ.reserveActivated ? " (activated)" : " (not activated)")],
    ],
    controls: [
      { id: "polConscription", type: "checkbox", label: "Enforce conscription (mandatory service)", get: () => state.policy.conscription, set: v => state.policy.conscription = v,
        effect: () => state.policy.conscription ? "Active-duty cap ×4 · -0.02/day stability · -0.06%/yr growth while active" : "Volunteer force only" },
      { id: "polReserveActivate", type: "checkbox", label: "Activate reserves for deployment", get: () => state.econ.reserveActivated, set: v => state.econ.reserveActivated = v,
        effect: () => state.econ.reserveActivated ? "Reserve pool deployable · -0.03/day stability · -0.04%/yr growth while active" : "Reserves held in reserve, not deployable" },
      { id: "polMartialLaw", type: "checkbox", label: "Declare martial law", get: () => state.policy.martialLaw, set: v => state.policy.martialLaw = v,
        effect: () => state.policy.martialLaw ? "Emergency powers in effect — -0.08/day stability · -0.15%/yr growth" : "Normal civil governance" },
    ],
  },
  {
    icon: "🌍", title: "Human Development",
    stats: () => [["HDI", state.econ.hdi.toFixed(3)]],
    controls: [],
  },
];

function buildNationTabUI() {
  const grid = document.getElementById("nationGrid");
  grid.innerHTML = NATION_CARDS.map((card, ci) => `
    <div class="nationCard">
      <div class="nationCardHead">${card.icon} ${card.title}</div>
      <div class="nationCardStats" id="nationStats-${ci}"></div>
      ${card.controls.map((c, pi) => `
        <div class="policyrow">
          <label>${c.label}</label>
          ${c.type === "slider"
            ? `<input type="range" id="${c.id}" min="${c.min}" max="${c.max}" step="${c.step}"><span class="policyVal" id="${c.id}Val"></span>`
            : `<label class="checkboxRow"><input type="checkbox" id="${c.id}"> enabled</label>`}
          <div class="policyEffect" id="${c.id}Effect"></div>
        </div>
      `).join("")}
    </div>
  `).join("");

  NATION_CARDS.forEach(card => {
    card.controls.forEach(c => {
      const input = document.getElementById(c.id);
      if (c.type === "slider") {
        input.value = c.get();
        input.addEventListener("input", () => { c.set(Number(input.value)); renderNationTab(); });
      } else {
        input.checked = c.get();
        input.addEventListener("change", () => { c.set(input.checked); renderNationTab(); });
      }
    });
  });
  renderNationTab();
}

function renderNationTab() {
  NATION_CARDS.forEach((card, ci) => {
    const statsEl = document.getElementById(`nationStats-${ci}`);
    if (statsEl) statsEl.innerHTML = card.stats().map(([l, v]) => `<div class="row"><span>${l}</span><b>${v}</b></div>`).join("");
    card.controls.forEach(c => {
      const input = document.getElementById(c.id);
      if (input && document.activeElement !== input) {
        if (c.type === "slider") input.value = c.get();
        else input.checked = c.get();
      }
      const valEl = document.getElementById(`${c.id}Val`);
      if (valEl && c.fmt) valEl.textContent = c.fmt(c.get());
      const effEl = document.getElementById(`${c.id}Effect`);
      if (effEl) effEl.textContent = c.effect();
    });
  });
}

// ---- Research overlay: a full-screen branching tech tree ----
let researchOverlayOpen = false;

function toggleResearchOverlay() { researchOverlayOpen ? closeResearchOverlay() : openResearchOverlay(); }
function openResearchOverlay() {
  researchOverlayOpen = true;
  document.getElementById("researchOverlay").classList.remove("hidden");
  const nav = document.querySelector('.navbtn[data-tab="research"]');
  if (nav) nav.classList.add("active");
  renderResearchTab();
}
function closeResearchOverlay() {
  researchOverlayOpen = false;
  document.getElementById("researchOverlay").classList.add("hidden");
  const nav = document.querySelector('.navbtn[data-tab="research"]');
  if (nav) nav.classList.remove("active");
}

function techNodeHTML(n) {
  const unlocked = !!state.techUnlocked[n.id];
  const researching = state.researchQueue.includes(n.id);
  const available = !unlocked && !researching && techPrereqMet(n.id);
  const cls = unlocked ? "tech-unlocked" : researching ? "tech-researching" : available ? "tech-available" : "tech-locked";
  let status;
  if (unlocked) status = "✓ Researched";
  else if (researching) status = `${Math.floor((state.researchProgress[n.id] || 0) / n.cost * 100)}% · ~${researchETA(n.id)}d`;
  else if (available) status = `${fmtNum(n.cost)} RP`;
  else status = `🔒 needs ${TECH_NODES[n.prereq].name}`;
  return `<div class="techNode ${cls}" data-id="${n.id}" style="--cat:${n.color}">
    <div class="tnName">${n.name}</div>
    <div class="tnEff">${techEffectLabel(n.effects)}</div>
    <div class="tnStatus">${status}</div>
  </div>`;
}

// Called on open, on any queue change, and on tech completion.
function renderResearchTab() {
  const area = document.getElementById("researchTreeArea");
  if (!area) return;
  area.innerHTML = TECH_TREE.map(cat => {
    const maxTier = Math.max.apply(null, cat.nodes.map(n => n.tier));
    let cols = "";
    for (let t = 0; t <= maxTier; t++) {
      const inTier = cat.nodes.filter(n => n.tier === t);
      cols += `<div class="techTierCol">${inTier.map(techNodeHTML).join("")}</div>`;
    }
    return `<div class="techCat">
      <div class="techCatLabel" style="color:${cat.color}">${cat.label}</div>
      <div class="techCatTree" data-cat="${cat.id}">
        <svg class="techConnSvg"></svg>
        <div class="techTierRow">${cols}</div>
      </div>
    </div>`;
  }).join("");
  area.querySelectorAll(".techNode").forEach(el => {
    el.addEventListener("click", () => {
      const id = el.dataset.id;
      if (state.techUnlocked[id]) return;
      if (!state.researchQueue.includes(id) && !canQueueTech(id)) {
        if (state.researchQueue.length >= MAX_RESEARCH_QUEUE) flashResearchFull();
        return;
      }
      toggleResearchQueue(id);
      renderResearchTab();
    });
  });
  updateResearchQueueBar();
  requestAnimationFrame(drawTechConnectors);
}

function flashResearchFull() {
  const bar = document.getElementById("researchQueueBar");
  if (!bar) return;
  bar.classList.add("queue-full-flash");
  setTimeout(() => bar.classList.remove("queue-full-flash"), 600);
}

// Light per-tick refresh of the header + in-progress node status text.
function updateResearchQueueBar() {
  const bar = document.getElementById("researchQueueBar");
  if (!bar) return;
  const rate = researchPointsPerDay();
  const q = state.researchQueue;
  const chips = q.length
    ? q.map(id => {
        const n = TECH_NODES[id];
        const prog = Math.floor((state.researchProgress[id] || 0) / n.cost * 100);
        return `<span class="qChip" style="border-color:${n.color}">${n.name} <b>${prog}%</b> · ${researchETA(id)}d</span>`;
      }).join("")
    : `<span class="qEmpty">No active research — click up to 3 techs below to queue them.</span>`;
  bar.innerHTML = `<span class="qRate">⚗ ${fmtNum(rate)} RP/day · ${q.length}/${MAX_RESEARCH_QUEUE} slots</span>${chips}`;
  q.forEach(id => {
    const el = document.querySelector(`.techNode[data-id="${id}"] .tnStatus`);
    if (el) { const n = TECH_NODES[id]; el.textContent = `${Math.floor((state.researchProgress[id] || 0) / n.cost * 100)}% · ~${researchETA(id)}d`; }
  });
}

function drawTechConnectors() {
  document.querySelectorAll(".techCatTree").forEach(tree => {
    const svg = tree.querySelector(".techConnSvg");
    if (!svg) return;
    const rect = tree.getBoundingClientRect();
    svg.setAttribute("width", rect.width);
    svg.setAttribute("height", rect.height);
    let paths = "";
    tree.querySelectorAll(".techNode").forEach(el => {
      const node = TECH_NODES[el.dataset.id];
      if (!node || !node.prereq) return;
      const pel = tree.querySelector(`.techNode[data-id="${node.prereq}"]`);
      if (!pel) return;
      const pr = pel.getBoundingClientRect(), cr = el.getBoundingClientRect();
      const x1 = pr.right - rect.left, y1 = pr.top - rect.top + pr.height / 2;
      const x2 = cr.left - rect.left, y2 = cr.top - rect.top + cr.height / 2;
      const mx = (x1 + x2) / 2;
      const done = state.techUnlocked[el.dataset.id];
      paths += `<path d="M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}" fill="none" stroke="${done ? node.color : "#2a3a44"}" stroke-width="2"/>`;
    });
    svg.innerHTML = paths;
  });
}

// ---- Trade & Resources tab (drawer) ----
function commodityMonthlyProduction(key) {
  let p = 0;
  for (const b of state.completedBuildings) {
    const pr = BUILDING_PRODUCTION[b.type];
    if (pr && pr.commodity === key) p += pr.perMonth;
  }
  return p;
}

let tradeBuilt = false;
function renderTradeTab() {
  const box = document.getElementById("tradeList");
  if (!box) return;
  updateEnergyStatus();
  const es = state.energyStatus;
  const deficit = es.balanceMWh < 0;
  const elecPartner = worldPartner(state.elecContractPartner);
  const exportPartner = worldPartner(state.elecExportPartner);

  // Prominent energy card — buy AND sell, treated as a first-class tradeable
  // resource. Click through to the map's electricity view to pick a partner.
  const elecSummary = `
    <div class="trCard trEnergy">
      <div class="trCardTop">
        <span class="trName">${svgIcon('energy')} Electricity</span>
        <span class="trBal ${deficit ? "neg" : "pos"}" id="elecBalance">${deficit ? "" : "+"}${fmtNum(Math.round(es.balanceMWh))} MWh/mo</span>
      </div>
      <div class="trFlow">Supply ${fmtNum(es.supplyMWh)} · Demand ${fmtNum(Math.round(es.demandMWh))} · net <span id="elecMoney" class="${deficit ? "neg" : "pos"}">${deficit ? "-" + fmtEUR(es.importCostMonthly) : "+" + fmtEUR(es.exportIncomeMonthly)}/mo</span></div>
      <div class="trEnergyGrid">
        <div class="trEnergyCell buy">
          <div class="trCellHead">↓ Buy${elecPartner ? " · " + elecPartner.flag : ""}</div>
          <b id="elecContract">${fmtNum(state.energyContractMWh)} MWh/mo · -${fmtEUR(es.contractCostMonthly)}/mo</b>
        </div>
        <div class="trEnergyCell sell">
          <div class="trCellHead">↑ Sell${exportPartner ? " · " + exportPartner.flag : ""}</div>
          <b id="elecExport" class="pos">${fmtNum(state.energyExportMWh)} MWh/mo · +${fmtEUR(es.exportContractIncomeMonthly)}/mo</b>
        </div>
      </div>
      <button class="trGoMap" data-openelec>Buy or sell energy on the map →</button>
    </div>`;

  const rows = Object.keys(COMMODITIES).map(key => {
    const c = COMMODITIES[key];
    const stock = Math.floor(state.commodityStock[key] || 0);
    const prod = commodityMonthlyProduction(key);
    const pct = state.sellPercent[key] || 0;
    const mb = state.monthlyBuy[key];
    const mbPartner = mb ? worldPartner(mb.partner) : null;
    return `<div class="trCard">
      <div class="trCardTop"><span class="trName">${c.label}</span><span class="trPrice">${fmtEUR(c.price)}/${c.unit}</span></div>
      <div class="trFlow" id="tradeStock-${key}">Stock <b>${fmtNum(stock)}</b> ${c.unit} · ${fmtEUR(stock * c.price)}</div>
      <div class="trFlow2">${prod ? '<span class="pos">▲ producing +' + fmtNum(prod) + "/mo</span>" : "<i>build a mine or zone to produce</i>"}${mb ? ` · <span class="monthlyTag" id="mbTag-${key}">▼ importing ${fmtNum(mb.qty)}/mo ${mbPartner ? mbPartner.flag : ""}</span>` : ""}</div>
      <div class="sellPctRow">
        <span>Auto-sell <b id="sellPctVal-${key}">${pct}%</b>/mo</span>
        <input type="range" class="sellPctSlider" min="0" max="100" step="5" value="${pct}" data-sellpct="${key}">
      </div>
      <div class="trActions">
        <button class="tradeSell" id="tradeSell-${key}" data-key="${key}" ${stock > 0 ? "" : "disabled"}>Sell all now</button>
        ${mb ? `<span class="buyControls">
          <input type="number" class="buyQty" min="0" step="1" value="10" data-buyqty="${key}" />
          <button class="tradeBuyMonthly" data-buymo="${key}" title="Raise the standing monthly import">+ mo</button>
          <button class="tradeBuyMonthlyMinus" data-buymominus="${key}" title="Lower the standing monthly import">− mo</button>
          <button class="tradeBuyClear" data-clearmo="${key}" title="Cancel monthly import">✕</button>
        </span>` : `<button class="trBuyLink" data-buyres="${key}">Buy on map →</button>`}
      </div>
    </div>`;
  }).join("");

  box.innerHTML = `
    <div class="panelhead">${svgIcon('package')} MY RESOURCES</div>
    <div class="tradeTip">Sell your surplus or set up imports. Click <b>Buy on map</b> (or a country on the map) to trade — each country exports a limited amount per month.</div>
    ${elecSummary}
    ${rows}`;

  const openElecBtn = box.querySelector("[data-openelec]");
  if (openElecBtn) openElecBtn.addEventListener("click", () => switchTradeMapRes("__elec"));
  box.querySelectorAll("[data-buyres]").forEach(b => b.addEventListener("click", () => switchTradeMapRes(b.dataset.buyres)));
  box.querySelectorAll(".tradeSell").forEach(b => b.addEventListener("click", () => { sellCommodity(b.dataset.key, true); renderTradeTab(); }));
  box.querySelectorAll(".tradeBuyMonthly").forEach(b => b.addEventListener("click", () => {
    const key = b.dataset.buymo;
    const qty = Number(box.querySelector(`.buyQty[data-buyqty="${key}"]`).value);
    adjustMonthlyBuy(key, qty); renderTradeTab();
  }));
  box.querySelectorAll(".tradeBuyMonthlyMinus").forEach(b => b.addEventListener("click", () => {
    const key = b.dataset.buymominus;
    const qty = Number(box.querySelector(`.buyQty[data-buyqty="${key}"]`).value);
    adjustMonthlyBuy(key, -qty); renderTradeTab();
  }));
  box.querySelectorAll(".tradeBuyClear").forEach(b => b.addEventListener("click", () => {
    adjustMonthlyBuy(b.dataset.clearmo, -1e9); renderTradeTab();
  }));
  box.querySelectorAll(".sellPctSlider").forEach(sl => sl.addEventListener("input", () => {
    state.sellPercent[sl.dataset.sellpct] = Number(sl.value);
    const lbl = document.getElementById(`sellPctVal-${sl.dataset.sellpct}`);
    if (lbl) lbl.textContent = sl.value + "%";
  }));
  tradeBuilt = true;
}

// ---- World trade map: countries colored by how much of a resource they can
// supply; click one to see relations / acceptance odds and trade with it. ----
let tradeMap = null, tradeMapRes = "electronics";

// Every country on the world map is tradeable. The 10 curated majors keep their
// hand-tuned stats; every other country in the Natural Earth set gets plausible
// stats generated deterministically from its name (so they're stable between
// sessions). Runs once, after WORLD_COUNTRIES has loaded.
let _worldMarketExpanded = false;
function _hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function _mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function _iso2ToFlag(iso) {
  if (!iso || iso.length !== 2 || iso === "-99") return "🏳️";
  const cc = iso.toUpperCase();
  if (!/^[A-Z]{2}$/.test(cc)) return "🏳️";
  return String.fromCodePoint(0x1F1E6 + cc.charCodeAt(0) - 65, 0x1F1E6 + cc.charCodeAt(1) - 65);
}
function ensureWorldMarketComplete() {
  if (_worldMarketExpanded) return;
  if (typeof WORLD_COUNTRIES === "undefined" || !WORLD_COUNTRIES) return;
  const have = new Set(WORLD_MARKET.map(w => w.geoName));
  const commodityKeys = Object.keys(COMMODITIES);
  WORLD_COUNTRIES.forEach(f => {
    const p = f.properties || {};
    const nm = p.ADMIN || p.NAME || p.name || p.SOVEREIGNT;
    if (!nm || nm === "Slovenia" || have.has(nm)) return;
    have.add(nm);
    const rng = _mulberry32(_hashStr(nm));
    const scale = 0.25 + rng() * 1.6; // some countries are big exporters, some tiny
    const res = {};
    commodityKeys.forEach(k => { res[k] = Math.round((20 + rng() * 260) * scale); });
    WORLD_MARKET.push({
      id: "X_" + nm.replace(/[^A-Za-z0-9]+/g, "").slice(0, 14),
      name: nm,
      flag: _iso2ToFlag(p.ISO_A2 || p.ISO_A2_EH || p.WB_A2),
      geoName: nm,
      elecPrice: Math.round(52 + rng() * 44),
      commodityMult: 0.82 + rng() * 0.4,
      reliability: 0.62 + rng() * 0.32,
      avail: Math.round(100 + rng() * 500),
      res,
      generated: true,
    });
  });
  _worldMarketExpanded = true;
}

function openTradeMap() {
  document.getElementById("tradeMapOverlay").classList.remove("hidden");
  const sel = document.getElementById("tradeMapResSel");
  if (!sel.options.length) {
    sel.innerHTML = `<option value="__elec" ${tradeMapRes === "__elec" ? "selected" : ""}>Electricity</option>` +
      Object.keys(COMMODITIES).map(k => `<option value="${k}" ${k === tradeMapRes ? "selected" : ""}>${COMMODITIES[k].label}</option>`).join("");
    sel.addEventListener("change", () => { tradeMapRes = sel.value; renderTradeMapCountries(); });
    document.getElementById("tradeMapClose").addEventListener("click", () => document.getElementById("tradeMapOverlay").classList.add("hidden"));
  }
  if (!tradeMap) {
    tradeMap = new TradeWorldMap(document.getElementById("tradeMapCanvas"), {
      lat: 48, lon: 15, zoom: 4,
      onPick: (id) => renderTradeMapSide(id),
    });
  }
  // Side panel defaults to your resource list; clicking a country swaps in
  // its trade panel (with a back button).
  showTradeList();
  renderTradeTab();
  setTimeout(() => { tradeMap.draw(); renderTradeMapCountries(); }, 50);
}

// The selected-unit panel and the city panel both live in the bottom-left
// corner. Rather than let them overlap, stack the unit panel directly above the
// city panel and shrink the city panel by however much room that needs. Both
// heights are content-driven, so this has to be measured rather than guessed.
const BL_PANEL_BOTTOM = 84;  // matches #cityPanel's bottom in style.css
const BL_PANEL_GAP = 10;
function layoutBottomLeftPanels() {
  const unit = document.getElementById("unitPanel");
  const city = document.getElementById("cityPanel");
  const tray = document.getElementById("pendingDecisions"); // events / decisions
  if (!unit || !city) return;
  const unitOpen = !unit.classList.contains("hidden");
  const cityOpen = !city.classList.contains("hidden");

  // Three things compete for this corner. The decisions tray sits lowest and
  // has a higher z-index, so it has to be measured too — otherwise it simply
  // covers the unit panel. When the city panel is open the tray moves aside
  // (.tray-shifted), so it stops competing for the column.
  let floor = BL_PANEL_BOTTOM;
  if (tray && !tray.classList.contains("hidden") && !tray.classList.contains("tray-shifted")) {
    const trayTop = 66 + tray.offsetHeight; // 66px = #pendingDecisions bottom
    floor = Math.max(floor, trayTop + BL_PANEL_GAP);
  }

  if (unitOpen && cityOpen) {
    const unitH = unit.offsetHeight;
    // Cap the city panel first so the unit panel is guaranteed to fit on screen.
    city.style.maxHeight = `calc(100% - ${160 + unitH + BL_PANEL_GAP}px)`;
    const desired = floor + city.offsetHeight + BL_PANEL_GAP;
    // Hard clamp: whatever the measurements say, never push the panel's top off
    // the viewport. Cheap insurance against a very tall city panel.
    const maxBottom = Math.max(floor, (window.innerHeight || 0) - unitH - 12);
    unit.style.bottom = Math.min(desired, maxBottom) + "px";
  } else {
    city.style.maxHeight = "";
    const maxBottom = Math.max(BL_PANEL_BOTTOM, (window.innerHeight || 0) - unit.offsetHeight - 12);
    unit.style.bottom = Math.min(floor, maxBottom) + "px";
  }
}
window.addEventListener("resize", layoutBottomLeftPanels);

function showTradeList() {
  const cp = document.getElementById("tradeCountryPanel");
  const lw = document.getElementById("tradeListWrap");
  if (cp) cp.classList.add("hidden");
  if (lw) lw.classList.remove("hidden");
}

// Switch the map to a given resource (or "__elec") and recolour it, so the
// resource-list "Buy on map" links jump straight to the right view.
function switchTradeMapRes(res) {
  tradeMapRes = res;
  const sel = document.getElementById("tradeMapResSel");
  if (sel) sel.value = res;
  showTradeList();
  renderTradeMapCountries();
}

function renderTradeMapCountries() {
  if (!tradeMap || typeof WORLD_COUNTRIES === "undefined" || !WORLD_COUNTRIES) return;
  ensureWorldMarketComplete();
  const isElec = tradeMapRes === "__elec";
  const maxAvail = Math.max(...WORLD_MARKET.map(w => (w.res && w.res[tradeMapRes]) || 0), 1);
  const shapes = [];
  WORLD_COUNTRIES.forEach(f => {
    const p = f.properties || {};
    const nm = p.ADMIN || p.NAME || p.name || p.SOVEREIGNT;
    const w = WORLD_MARKET.find(x => x.geoName === nm);
    // Electricity: color by cheapness (greener = cheaper €/MWh). Resources:
    // color by availability, sqrt scale so mid values still read.
    const avail = w ? ((w.res && w.res[tradeMapRes]) || 0) : 0;
    const t = !w ? 0 : isElec ? clamp((90 - w.elecPrice) / 40, 0.05, 1) : Math.pow(avail / maxAvail, 0.5);
    const rgb = w
      ? `rgba(${Math.round(30 + 20 * t)}, ${Math.round(60 + 140 * t)}, ${Math.round(50 + 60 * t)}, 0.75)`
      : "rgba(36, 43, 49, 0.5)";
    // Reuse the cached rings the main map already built for this feature.
    const rings = f._rings || (f._rings = geojsonToLatLngRings(f.geometry));
    shapes.push({
      id: w ? w.id : null,
      rings,
      fill: rgb,
      stroke: w ? "#7fe0c9" : "#39434b",
      lineWidth: w ? 1.2 : 0.5,
      interactive: !!w,
      label: w ? (isElec
        ? `${w.flag} ${w.name} — €${w.elecPrice}/MWh`
        : `${w.flag} ${w.name} — ${fmtNum(avail)} ${COMMODITIES[tradeMapRes].unit}/order · ${fmtNum(partnerRemainingCapacity(w, tradeMapRes))} left this month`) : null,
    });
  });
  tradeMap.setShapes(shapes);
}

let lastTradeVerdict = null; // { partnerId, msg, ok } shown inline in the side panel

function renderTradeMapSide(partnerId) {
  const w = worldPartner(partnerId);
  if (!w) return;
  const side = document.getElementById("tradeCountryPanel");
  side.classList.remove("hidden");
  document.getElementById("tradeListWrap").classList.add("hidden");
  const rel = Math.round(partnerReliability(w.id) * 100);
  const relations = w.natId && state.diplomacy.nations[w.natId] ? state.diplomacy.nations[w.natId].relation.toFixed(0) : "—";
  const verdict = lastTradeVerdict && lastTradeVerdict.partnerId === w.id
    ? `<div class="tmVerdict ${lastTradeVerdict.ok ? "pos" : "neg"}">${lastTradeVerdict.msg}</div>` : "";

  if (tradeMapRes === "__elec") {
    // Electricity contract panel for this country.
    const deal = w.natId && state.elecImportDeal === w.natId;
    const dealPossible = w.natId && state.diplomacy.nations[w.natId] && !state.diplomacy.nations[w.natId].atWar && state.diplomacy.nations[w.natId].relation >= 45;
    const price = deal ? w.elecPrice * 0.75 : w.elecPrice;
    const isContractHere = state.elecContractPartner === w.id && state.energyContractMWh > 0;
    const isExportHere = state.elecExportPartner === w.id && state.energyExportMWh > 0;
    side.innerHTML = `
      <button id="tmBack">← My resources</button>
      <div class="tmCountry"><span class="tmFlag">${w.flag}</span><b>${w.name.toUpperCase()}</b></div>
      <div class="row"><span>Relations</span><b>${relations}</b></div>
      <div class="row"><span>Electricity price</span><b>€${price.toFixed(0)}/MWh${deal ? " (−25% deal)" : ""}</b></div>

      <div class="tmElecBlock">
        <div class="tmElecHead">${svgIcon('energy')} Buy energy <span class="tmHint">import — adds to your supply</span></div>
        ${isContractHere ? `<div class="row"><span>Current import</span><b>${fmtNum(state.energyContractMWh)} MWh/mo</b></div>` : state.energyContractMWh > 0 ? `<div class="row"><span>Importing elsewhere</span><b>${fmtNum(state.energyContractMWh)} MWh/mo ${(worldPartner(state.elecContractPartner) || {}).flag || ""}</b></div>` : ""}
        <div class="tmBuyRow"><input type="number" id="tmQty" min="0" step="1000" value="${state.energyContractMWh || 10000}">
          <button id="tmElecSet">Set import</button>
          ${isContractHere ? `<button id="tmElecClear">✕</button>` : ""}
        </div>
        ${w.natId ? `<button id="tmElecDeal" ${dealPossible || deal ? "" : "disabled"} class="tmDealBtn ${deal ? "active" : ""}">${deal ? `${svgIcon('handshake')} −25% deal active — end it` : `${svgIcon('handshake')} Negotiate −25% price deal`}</button>
        <div class="tmHint">${dealPossible || deal ? "" : "Needs relations ≥ 45 and peace."}</div>` : ""}
      </div>

      <div class="tmElecBlock">
        <div class="tmElecHead">${svgIcon('energy')} Sell energy <span class="tmHint">export — pays €${w.elecPrice.toFixed(0)}/MWh</span></div>
        ${isExportHere ? `<div class="row"><span>Current export</span><b>${fmtNum(state.energyExportMWh)} MWh/mo</b></div>` : state.energyExportMWh > 0 ? `<div class="row"><span>Exporting elsewhere</span><b>${fmtNum(state.energyExportMWh)} MWh/mo ${(worldPartner(state.elecExportPartner) || {}).flag || ""}</b></div>` : ""}
        <div class="tmBuyRow"><input type="number" id="tmExpQty" min="0" step="1000" value="${state.energyExportMWh || 10000}">
          <button id="tmElecSell">Set export</button>
          ${isExportHere ? `<button id="tmElecSellClear">✕</button>` : ""}
        </div>
        <div class="tmHint">Only sell real surplus — export more than you generate spare and you'll buy the shortfall back at spot price.</div>
      </div>
      ${verdict}
      <div class="tmHint">Contracts are delivered and settled monthly; they show under Electricity in your budget.</div>`;
    document.getElementById("tmElecSet").addEventListener("click", () => {
      state.energyContractMWh = Math.max(0, Math.floor(Number(document.getElementById("tmQty").value) || 0));
      state.elecContractPartner = state.energyContractMWh > 0 ? w.id : null;
      lastTradeVerdict = { partnerId: w.id, ok: true, msg: `${svgIcon('check')} Import set: ${fmtNum(state.energyContractMWh)} MWh/mo from ${w.flag} ${w.name}.` };
      logEvent(lastTradeVerdict.msg);
      renderTradeMapSide(w.id); if (tradeBuilt) renderTradeTab();
    });
    const clearBtn = document.getElementById("tmElecClear");
    if (clearBtn) clearBtn.addEventListener("click", () => {
      state.energyContractMWh = 0; state.elecContractPartner = null;
      renderTradeMapSide(w.id); if (tradeBuilt) renderTradeTab();
    });
    document.getElementById("tmElecSell").addEventListener("click", () => {
      state.energyExportMWh = Math.max(0, Math.floor(Number(document.getElementById("tmExpQty").value) || 0));
      state.elecExportPartner = state.energyExportMWh > 0 ? w.id : null;
      lastTradeVerdict = { partnerId: w.id, ok: true, msg: `${svgIcon('check')} Export set: ${fmtNum(state.energyExportMWh)} MWh/mo to ${w.flag} ${w.name} (€${w.elecPrice.toFixed(0)}/MWh).` };
      logEvent(lastTradeVerdict.msg);
      renderTradeMapSide(w.id); if (tradeBuilt) renderTradeTab();
    });
    const sellClearBtn = document.getElementById("tmElecSellClear");
    if (sellClearBtn) sellClearBtn.addEventListener("click", () => {
      state.energyExportMWh = 0; state.elecExportPartner = null;
      renderTradeMapSide(w.id); if (tradeBuilt) renderTradeTab();
    });
    const dealBtn = document.getElementById("tmElecDeal");
    if (dealBtn) dealBtn.addEventListener("click", () => {
      state.elecImportDeal = deal ? null : w.natId;
      renderTradeMapSide(w.id);
    });
    document.getElementById("tmBack").addEventListener("click", () => { showTradeList(); renderTradeTab(); });
    return;
  }

  const key = tradeMapRes;
  const avail = partnerAvail(w, key);
  const capacity = partnerMonthlyCapacity(w, key);
  const remaining = partnerRemainingCapacity(w, key);
  const unit = COMMODITIES[key].price * w.commodityMult * 1.1;
  const mb = state.monthlyBuy[key];
  side.innerHTML = `
    <button id="tmBack">← My resources</button>
    <div class="tmCountry"><span class="tmFlag">${w.flag}</span><b>${w.name.toUpperCase()}</b></div>
    <div class="row"><span>Relations</span><b>${relations}</b></div>
    <div class="row"><span>Deal acceptance</span><b class="${rel >= 80 ? "pos" : rel >= 50 ? "" : "neg"}">${rel}%</b></div>
    <div class="row"><span>${COMMODITIES[key].label} per order</span><b>${fmtNum(avail)} ${COMMODITIES[key].unit}</b></div>
    <div class="row"><span>Export capacity left this month</span><b class="${remaining <= 0 ? "neg" : remaining < capacity * 0.3 ? "" : "pos"}">${fmtNum(remaining)} / ${fmtNum(capacity)} ${COMMODITIES[key].unit}</b></div>
    <div class="row"><span>Their price</span><b>${fmtEUR(unit)}/${COMMODITIES[key].unit}</b></div>
    ${mb ? `<div class="row"><span>Current monthly import</span><b>${fmtNum(mb.qty)}/mo ${(worldPartner(mb.partner) || {}).flag || ""}</b></div>` : ""}
    <div class="tmBuyRow"><input type="number" id="tmQty" min="1" step="1" value="10">
      <button id="tmBuyOnce" ${remaining <= 0 ? "disabled" : ""}>Buy once</button>
      <button id="tmBuyMonthly">+ Monthly</button>
      <button id="tmBuyMonthlyMinus" ${mb ? "" : "disabled"}>− Monthly</button>
    </div>
    ${verdict}
    <div class="tmHint">Buy once = bulk offer now (they answer immediately). ± Monthly adjusts a standing import delivered daily. Once their monthly export capacity runs out, every offer is declined until next month.</div>`;
  document.getElementById("tmBuyOnce").addEventListener("click", () => {
    const res = buyCommodity(key, Number(document.getElementById("tmQty").value), w.id);
    lastTradeVerdict = { partnerId: w.id, ok: res.ok, msg: res.msg };
    renderTradeMapSide(w.id); if (tradeBuilt) renderTradeTab();
    renderTradeMapCountries(); // capacity tooltip changed
  });
  document.getElementById("tmBuyMonthly").addEventListener("click", () => {
    adjustMonthlyBuy(key, Number(document.getElementById("tmQty").value), w.id);
    lastTradeVerdict = { partnerId: w.id, ok: true, msg: `${svgIcon('check')} Monthly import raised.` };
    renderTradeMapSide(w.id); if (tradeBuilt) renderTradeTab();
  });
  const minusBtn = document.getElementById("tmBuyMonthlyMinus");
  if (minusBtn) minusBtn.addEventListener("click", () => {
    adjustMonthlyBuy(key, -Number(document.getElementById("tmQty").value), w.id);
    lastTradeVerdict = { partnerId: w.id, ok: true, msg: `${svgIcon('check')} Monthly import lowered.` };
    renderTradeMapSide(w.id); if (tradeBuilt) renderTradeTab();
  });
  document.getElementById("tmBack").addEventListener("click", () => { showTradeList(); renderTradeTab(); });
}

// Light per-tick refresh so stock/value tick up without eating input focus/clicks.
function updateTradeNumbers() {
  if (!tradeBuilt) { renderTradeTab(); return; }
  updateEnergyStatus();
  const es = state.energyStatus;
  const deficit = es.balanceMWh < 0;
  const bal = document.getElementById("elecBalance");
  if (bal) { bal.textContent = `${deficit ? "" : "+"}${fmtNum(Math.round(es.balanceMWh))} MWh/mo`; bal.className = deficit ? "neg" : "pos"; }
  const money = document.getElementById("elecMoney");
  if (money) { money.textContent = `${deficit ? "-" + fmtEUR(es.importCostMonthly) : "+" + fmtEUR(es.exportIncomeMonthly)}/mo`; money.className = deficit ? "neg" : "pos"; }
  const contract = document.getElementById("elecContract");
  if (contract) contract.textContent = `${fmtNum(state.energyContractMWh)} MWh/mo · -${fmtEUR(es.contractCostMonthly)}/mo`;
  const exportEl = document.getElementById("elecExport");
  if (exportEl) exportEl.textContent = `${fmtNum(state.energyExportMWh)} MWh/mo · +${fmtEUR((state.energyExportMWh || 0) * partnerElecExportPrice())}/mo`;
  Object.keys(COMMODITIES).forEach(key => {
    const c = COMMODITIES[key];
    const stock = Math.floor(state.commodityStock[key] || 0);
    const el = document.getElementById(`tradeStock-${key}`);
    if (el) el.textContent = `Stock ${fmtNum(stock)} ${c.unit} · ${fmtEUR(stock * c.price)}`;
    const btn = document.getElementById(`tradeSell-${key}`);
    if (btn) btn.disabled = stock <= 0;
  });
}

// Click a zone on the map to inspect development, efficiency and its
// per-resource supply (color-coded by how badly each input is short).
function openZonePanel(id) {
  const z = state.zones.find(x => x.id === id);
  if (!z) return;
  const zt = ZONE_TYPES[z.kind];
  const eff = zoneEfficiency(z).eff;
  const dev = z.dev == null ? 0.05 : z.dev;

  const rows = zt.commodities.map(c => {
    const f = z._fulfill && z._fulfill[c] != null ? z._fulfill[c] : 0;
    const needFull = zoneMonthlyNeed(z, c);                       // at 100% build-out
    const needNow = Math.max(1, Math.ceil(needFull * dev));       // right now (never shows 0)
    const shortMo = Math.ceil(needNow * (1 - f));
    const color = f >= 0.9 ? "#7fe0a0" : f >= 0.5 ? "#e0c97f" : "#e08f7f";
    const status = f >= 0.9 ? "supplied" : `short ${fmtNum(shortMo)}/mo`;
    return `<div class="zRow"><span class="zDot" style="background:${color}"></span><span>${COMMODITIES[c].label}</span>` +
      `<span class="zNums" style="color:${color}">${Math.round(f * 100)}% · ${fmtNum(needNow)}/mo now, ${fmtNum(needFull)}/mo at 100% · ${status}</span></div>`;
  }).join("");

  const solarLine = zt.electricityPerKm2
    ? `<div class="zSupplyHead">Feeding <b>${fmtNum(Math.round(zt.electricityPerKm2 * z.areaKm2 * eff))} MWh/mo</b> into the grid (grows with build-out).</div>`
    : "";
  const html = `<div class="zonePopup"><b>${zt.icon} ${zt.label}</b><br>` +
    `Area ${z.areaKm2.toFixed(1)} km² · Built out <b>${Math.round(dev * 100)}%</b> · Efficiency <b class="${eff < 0.5 ? "neg" : "pos"}">${Math.round(eff * 100)}%</b>` +
    `<div class="zpDesc">${zt.desc} Lower corporate tax fills the zone with businesses faster.</div>${solarLine}` +
    `<div class="zSupplyHead">Resource supply (per month, at current build-out):</div>${rows}` +
    `<button class="bpDelete" onclick="refundZone(${z.id})">${svgIcon('trash')} Dissolve · refund 40%</button></div>`;
  const c = zoneCentroid(z);
  showMapPopup(c[0], c[1], html);
}

// Click a foreign country on the map to open diplomacy with it.
function openDiplomacyForPoint(lat, lon) {
  const id = typeof countryForPoint === "function" ? countryForPoint(lat, lon) : null;
  if (id && NEIGHBOR_NATIONS[id]) {
    openTab("diplomacy");
    const box = document.getElementById("diplomacyList");
    if (box) { const card = [...box.querySelectorAll(".diploCard")].find(c => c.innerText.toUpperCase().includes(NEIGHBOR_NATIONS[id].name.toUpperCase())); if (card) card.scrollIntoView({ block: "center" }); }
  } else {
    logEvent("No formal diplomatic relationship with that country yet — Slovenia only maintains active relations with its neighbors and major partners.");
  }
}

// ---- Foreign-territory transit request modal (Promise-based) ----
function requestTransit(neighborId) {
  return new Promise(resolve => {
    const def = NEIGHBOR_NATIONS[neighborId];
    const n = state.diplomacy.nations[neighborId];
    const p = clamp((n.relation - 20) / 80, 0.05, 0.95);
    const modal = document.getElementById("transitModal");
    document.getElementById("transitTitle").textContent = `Transit request — ${def.flag} ${def.name}`;
    document.getElementById("transitBody").innerHTML =
      `Your forces' route crosses <b>${def.name}</b>'s territory. Relations are <b>${n.relation.toFixed(0)}</b>, so there's about a <b>${Math.round(p * 100)}%</b> chance they grant passage. Asking costs a little goodwill; a refusal costs more.`;
    const choices = document.getElementById("transitChoices");
    choices.innerHTML = "";
    const mk = (label, cls, fn) => { const b = document.createElement("button"); b.textContent = label; if (cls) b.className = cls; b.onclick = fn; choices.appendChild(b); };
    mk(`Request passage (${Math.round(p * 100)}%)`, "", () => {
      const granted = Math.random() < p;
      changeRelation(neighborId, granted ? -1 : -3);
      modal.classList.add("hidden");
      logEvent(granted
        ? `<b>${def.name}</b> grants your forces transit through its territory.`
        : `<b style="color:#e06c60">${def.name} refuses</b> your transit request — orders cancelled.`);
      resolve(granted ? "granted" : "denied");
    });
    mk("Reroute / cancel orders", "secondary", () => { modal.classList.add("hidden"); resolve("cancel"); });
    modal.classList.remove("hidden");
  });
}

// ---- Click-to-open insight panels (was hover — hover tooltips near the
// dock got clipped by the viewport edge; a centered modal never can) ----
let openInsightKind = null;

function buildTooltipHandlers() {
  document.querySelectorAll(".dockitem.stat").forEach(el => {
    el.addEventListener("click", () => openInsight(el.dataset.tip, el.querySelector(".dlabel").textContent));
  });
  document.getElementById("insightClose").addEventListener("click", closeInsight);
  document.getElementById("insightModal").addEventListener("click", (e) => {
    if (e.target.id === "insightModal") closeInsight();
  });
}

let insightBuiltKind = null; // tracks whether the (stateful) spending panel is built

function openInsight(kind, title) {
  openInsightKind = kind;
  insightBuiltKind = null; // force a fresh build for the spending panel
  document.getElementById("insightTitle").textContent = title;
  renderInsight();
  document.getElementById("insightModal").classList.remove("hidden");
}

function closeInsight() {
  openInsightKind = null;
  insightBuiltKind = null;
  document.getElementById("insightModal").classList.add("hidden");
}

function renderInsight() {
  if (!openInsightKind) return;
  // The treasury/budget panel holds live range sliders — rebuilding its DOM
  // every tick would reset a slider mid-drag, so build it once then only
  // refresh the numbers in place.
  if (openInsightKind === "treasury" || openInsightKind === "budget") {
    if (insightBuiltKind !== openInsightKind) { buildSpendingPanel(); insightBuiltKind = openInsightKind; }
    else updateSpendingPanelNumbers();
    return;
  }
  insightBuiltKind = null;
  const html = buildBreakdownHTML(openInsightKind);
  document.getElementById("insightBody").innerHTML = html || "";
}

// ---- POLICIES overlay: RoN-style LAWS + IDEOLOGY political compass ----
// (moved from the bottom-dock insight panel to a top-bar overlay)
let policiesOverlayOpen = false;
let policiesActiveTab = "laws"; // laws | ideology

// Emergency measures + minimum wage keep their old toggle/slider form at the
// bottom of the LAWS tab (conscription is now a proper 5-stage law above).
const POLICY_TOGGLES = [
  { key: "familyTaxExemption", target: () => state.policy, label: svgIcon('family') + " No income tax for families with 3+ children",
    effect: on => on ? `Costs ${fmtEUR(9e6)}/mo · +0.25 fertility target · +0.015/day stability` : "Fertility target unaffected" },
  { key: "reserveActivated", target: () => state.econ, label: svgIcon('medal') + " Activate reserves for deployment",
    effect: on => on ? "Reserve pool deployable · -0.03/day stability · -0.04%/yr growth" : "Reserves not deployable" },
  { key: "martialLaw", target: () => state.policy, label: svgIcon('alert') + " Martial law",
    effect: on => on ? "Emergency powers — -0.08/day stability · -0.15%/yr growth" : "Normal civil governance" },
  { key: "fullRecruitment", target: () => state.policy, label: svgIcon('medal') + " Run recruiting facilities at full capacity",
    effect: on => on ? (state.policy.martialLaw ? "Full mobilisation — +300–500 personnel/day (martial law)" : "Recruiting drives at full capacity — +100–300 personnel/day (300–500 under martial law)") : "Recruiting facilities at normal pace" },
];

function togglePoliciesOverlay() { policiesOverlayOpen ? closePoliciesOverlay() : openPoliciesOverlay(); }
function openPoliciesOverlay() {
  policiesOverlayOpen = true;
  document.getElementById("policiesOverlay").classList.remove("hidden");
  const nav = document.querySelector('.navbtn[data-tab="policies"]');
  if (nav) nav.classList.add("active");
  buildPoliciesOverlay();
}
function closePoliciesOverlay() {
  policiesOverlayOpen = false;
  document.getElementById("policiesOverlay").classList.add("hidden");
  const nav = document.querySelector('.navbtn[data-tab="policies"]');
  if (nav) nav.classList.remove("active");
}

function switchPoliciesTab(tab) {
  policiesActiveTab = tab;
  document.getElementById("pTabLaws").classList.toggle("active", tab === "laws");
  document.getElementById("pTabIdeology").classList.toggle("active", tab === "ideology");
  document.getElementById("policiesLawsPane").classList.toggle("hidden", tab !== "laws");
  document.getElementById("policiesIdeologyPane").classList.toggle("hidden", tab !== "ideology");
}

function buildPoliciesOverlay() {
  buildLawsPane();
  buildIdeologyPane();
  switchPoliciesTab(policiesActiveTab);
}

// ---- LAWS tab ----
function buildLawsPane() {
  const pane = document.getElementById("policiesLawsPane");
  pane.innerHTML = `
    <div class="lawHint">Changing a law costs ${fmtEUR(LAW_CHANGE_COST)} and −${LAW_CHANGE_STABILITY} stability; parliament then won't revisit that law for ${LAW_CHANGE_COOLDOWN_DAYS} days. Options run left → right from most restrictive to most permissive.</div>
    ${LAW_GROUPS.map(g => {
      const active = activeLawOption(g);
      return `
      <div class="lawCard" data-law="${g.key}">
        <div class="lawHead">
          <span class="lawTitle">${g.icon} ${g.label}</span>
          <span class="lawBlurb">${g.blurb}</span>
          <span class="lawCd" id="lawCd-${g.key}"></span>
        </div>
        <div class="lawOpts">
          ${g.options.map(o => `
            <button class="lawOpt ${o.key === active.key ? "active" : ""}" data-law="${g.key}" data-opt="${o.key}" title="${lawFxSummary(o.fx).replace(/"/g, "&quot;")}">${o.label}</button>
          `).join("")}
        </div>
        <div class="lawFx" id="lawFx-${g.key}">${lawFxSummary(active.fx)}</div>
      </div>`;
    }).join("")}
    <h4 class="lawSectionTitle">SPECIAL MEASURES</h4>
    <div class="lawCard">
      <div class="spendRow">
        <div class="spendHead"><span>${svgIcon('euro')} Minimum wage</span><b id="polMinWageVal"></b></div>
        <input type="range" class="spendSlider" id="polMinWage" min="700" max="2500" step="25" value="${state.policy.minimumWageEUR}">
        <div class="spendMeta"><span id="polMinWageEffect"></span></div>
      </div>
      ${POLICY_TOGGLES.map((t, i) => `
        <div class="polRow">
          <label class="checkboxRow"><input type="checkbox" id="polTgl-${i}"> ${t.label}</label>
          <div class="taxConseq" id="polTglFx-${i}"></div>
        </div>`).join("")}
    </div>
    <h4 class="lawSectionTitle">GOVERNMENT BUDGET</h4>
    <div class="lawCard">${budgetControlsHTML()}</div>`;

  bindBudgetControls(pane);

  pane.querySelectorAll(".lawOpt").forEach(btn => {
    btn.addEventListener("click", () => {
      const err = enactLaw(btn.dataset.law, btn.dataset.opt);
      if (err) logEvent(err);
      buildLawsPane(); // re-render active states + cooldowns
      renderTopBar();
    });
  });
  const slider = document.getElementById("polMinWage");
  slider.addEventListener("input", () => { state.policy.minimumWageEUR = Number(slider.value); updateLawsPaneDynamic(); });
  POLICY_TOGGLES.forEach((t, i) => {
    const cb = document.getElementById(`polTgl-${i}`);
    cb.checked = !!t.target()[t.key];
    cb.addEventListener("change", () => { t.target()[t.key] = cb.checked; updateLawsPaneDynamic(); });
  });
  updateLawsPaneDynamic();
}

// Light refresh (cooldown countdowns, slider labels) — no DOM rebuild.
function updateLawsPaneDynamic() {
  updateBudgetNumbers();
  LAW_GROUPS.forEach(g => {
    const el = document.getElementById(`lawCd-${g.key}`);
    if (!el) return;
    const until = state.lawCooldowns[g.key] || 0;
    const daysLeft = Math.ceil((until - state.date.getTime()) / 86400000);
    el.innerHTML = daysLeft > 0 ? `${svgIcon('lock')} changeable in ${daysLeft}d` : "";
  });
  const v = document.getElementById("polMinWageVal");
  if (v) v.textContent = "€" + state.policy.minimumWageEUR;
  const fx = document.getElementById("polMinWageEffect");
  if (fx) {
    const gap = (state.policy.minimumWageEUR - 1250) / 1250;
    fx.textContent = Math.abs(gap) < 0.01 ? "At baseline — no distortion"
      : gap > 0 ? `+${(gap * 3).toFixed(1)}% unemployment · -${(gap * 0.35).toFixed(2)}%/yr growth · +${(gap * 0.03 * 365).toFixed(1)}/yr stability`
      : `${(gap * 3).toFixed(1)}% unemployment · workers worse off (${(gap * 0.03 * 365).toFixed(1)}/yr stability)`;
  }
  POLICY_TOGGLES.forEach((t, i) => {
    const cb = document.getElementById(`polTgl-${i}`);
    if (cb && document.activeElement !== cb) cb.checked = !!t.target()[t.key];
    const el = document.getElementById(`polTglFx-${i}`);
    if (el) el.textContent = t.effect(!!t.target()[t.key]);
  });
}

// ---- IDEOLOGY tab: political compass ----
const COMPASS_SIZE = 340;

function buildIdeologyPane() {
  const pane = document.getElementById("policiesIdeologyPane");
  pane.innerHTML = `
    <div class="ideoWrap">
      <div class="ideoLeft">
        <div class="ideoAxisLabel ideoTop">AUTHORITARIAN</div>
        <div id="compassBox" style="width:${COMPASS_SIZE}px;height:${COMPASS_SIZE}px;">
          <div class="ideoQuad q-al">State<br>Socialism</div>
          <div class="ideoQuad q-ar">Conservative<br>Nationalism</div>
          <div class="ideoQuad q-ll">Social<br>Democracy</div>
          <div class="ideoQuad q-lr">Liberal<br>Democracy</div>
          <div class="compassAxisH"></div>
          <div class="compassAxisV"></div>
          <div id="compassTarget" title="Target — the nation drifts here"></div>
          <div id="compassDot" title="Current national ideology"></div>
        </div>
        <div class="ideoAxisLabel ideoBottom">LIBERTARIAN</div>
        <div class="ideoAxisLabel ideoLeftLbl">PLANNED ⟵</div>
        <div class="ideoAxisLabel ideoRightLbl">⟶ FREE MARKET</div>
      </div>
      <div class="ideoRight">
        <div class="row"><span>Current ideology</span><b id="ideoName"></b></div>
        <div class="row"><span>Target</span><b id="ideoTargetName"></b></div>
        <div class="row"><span>Drift speed</span><b>${IDEOLOGY_DRIFT_PER_DAY} / day per axis</b></div>
        <div class="ideoHint">Click anywhere on the compass to set the nation's ideological target. Change is gradual — and the further from the center you sit, the stronger the effects below.</div>
        <h4>ACTIVE IDEOLOGY EFFECTS</h4>
        <div id="ideoFx"></div>
      </div>
    </div>`;

  const box = document.getElementById("compassBox");
  box.addEventListener("click", (e) => {
    const r = box.getBoundingClientRect();
    const x = clamp(((e.clientX - r.left) / r.width) * 2 - 1, -1, 1);
    const y = clamp(-(((e.clientY - r.top) / r.height) * 2 - 1), -1, 1);
    state.ideology.tx = Math.round(x * 100) / 100;
    state.ideology.ty = Math.round(y * 100) / 100;
    logEvent(`Ideological course set toward <b>${ideologyName(x, y)}</b>.`);
    updateIdeologyPaneDynamic();
  });
  updateIdeologyPaneDynamic();
}

function updateIdeologyPaneDynamic() {
  const id = state.ideology;
  const pos = (v, invert) => ((invert ? -v : v) + 1) / 2 * 100 + "%";
  const dot = document.getElementById("compassDot");
  const tgt = document.getElementById("compassTarget");
  if (!dot) return;
  dot.style.left = pos(id.x); dot.style.top = pos(id.y, true);
  tgt.style.left = pos(id.tx); tgt.style.top = pos(id.ty, true);
  const nameEl = document.getElementById("ideoName");
  if (nameEl) nameEl.textContent = ideologyName(id.x, id.y);
  const tgtEl = document.getElementById("ideoTargetName");
  if (tgtEl) tgtEl.textContent = ideologyName(id.tx, id.ty) + ` (${id.tx.toFixed(2)}, ${id.ty.toFixed(2)})`;
  const fxEl = document.getElementById("ideoFx");
  if (fxEl) {
    const fx = ideologyEffects(id.x, id.y);
    const summary = lawFxSummary(fx);
    fxEl.innerHTML = summary.split(" · ").map(s => `<div class="ideoFxRow">${s}</div>`).join("");
  }
}

// Called from renderTopBar (~10x/sec) — cheap text/position updates only.
function renderPoliciesDynamic() {
  if (!policiesOverlayOpen) return;
  if (policiesActiveTab === "laws") updateLawsPaneDynamic();
  else updateIdeologyPaneDynamic();
}

let gdpRange = "month"; // month | year | all

function gdpChartSVG() {
  const hist = state.gdpHistory || [];
  const days = gdpRange === "month" ? 30 : gdpRange === "year" ? 365 : hist.length;
  let series = hist.slice(-days).map(h => h.gdp);
  if (series.length < 2) return `<div class="chartEmpty">Collecting data… let a little time pass.</div>`;
  // downsample to ~80 points for a clean line
  if (series.length > 80) {
    const step = series.length / 80, ds = [];
    for (let i = 0; i < 80; i++) ds.push(series[Math.floor(i * step)]);
    ds.push(series[series.length - 1]); series = ds;
  }
  const W = 300, H = 90, min = Math.min(...series), max = Math.max(...series);
  const span = (max - min) || 1;
  const pts = series.map((v, i) => {
    const x = (i / (series.length - 1)) * W;
    const y = H - ((v - min) / span) * (H - 8) - 4;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  const first = series[0], last = series[series.length - 1];
  const chg = ((last - first) / first) * 100;
  const col = last >= first ? "#7fe0a0" : "#e08f7f";
  return `<svg viewBox="0 0 ${W} ${H}" class="gdpChart" preserveAspectRatio="none">
      <polyline points="${pts}" fill="none" stroke="${col}" stroke-width="2"/>
    </svg>
    <div class="chartFoot"><span>${fmtEUR(min)}</span><span class="${chg >= 0 ? "pos" : "neg"}">${chg >= 0 ? "+" : ""}${chg.toFixed(1)}% over ${gdpRange === "all" ? "all time" : "past " + gdpRange}</span><span>${fmtEUR(max)}</span></div>`;
}

function buildBreakdownHTML(kind) {
  const econ = state.econ;
  if (kind === "gdp") {
    const inf = inflationReasons();
    const gb = growthBreakdown();
    const gbRows = gb.items
      .sort((a, c) => Math.abs(c.value) - Math.abs(a.value))
      .map(i => `<div class="row"><span>${i.label}</span><span class="${i.value >= 0 ? "pos" : "neg"}">${i.value >= 0 ? "+" : ""}${(i.value * 100).toFixed(2)}%/yr</span></div>`).join("");
    return `<h4>GDP</h4>
      <div class="row"><span>Annual GDP</span><span>${fmtEUR(econ.gdp)}</span></div>
      <div class="row"><span>Growth rate</span><span class="${econ.gdpGrowth >= 0 ? "pos" : "neg"}">${(econ.gdpGrowth * 100).toFixed(2)}%/yr</span></div>
      <div class="row"><span>GDP per capita</span><span>${fmtEUR(econ.gdp / econ.population)}</span></div>
      <h4 style="margin-top:10px;">WHY — growth contributions</h4>
      ${gbRows}
      <div class="row total"><span>Net growth</span><span class="${gb.net >= 0 ? "pos" : "neg"}">${gb.net >= 0 ? "+" : ""}${(gb.net * 100).toFixed(2)}%/yr</span></div>
      <div class="gdpRangeBtns">
        ${["month", "year", "all"].map(r => `<button class="gdpRangeBtn ${gdpRange === r ? "active" : ""}" data-range="${r}">${r === "all" ? "All time" : "Past " + r}</button>`).join("")}
      </div>
      ${gdpChartSVG()}
      <h4 style="margin-top:10px;">INFLATION — ${(econ.inflation * 100).toFixed(2)}%</h4>
      <div class="row"><span>Target</span><span>~2.00%</span></div>
      <div class="row"><span>Budget</span><span class="${inf.deficit ? "neg" : "pos"}">${inf.deficit ? "Deficit" : "Balanced/Surplus"}</span></div>
      <div class="insightNote">${inf.deficit
        ? `Spending (${fmtEUR(inf.expense * 12)}/yr) exceeds income (${fmtEUR(inf.income * 12)}/yr) — deficit financing pushes prices up. Cut spending or raise taxes to cool it.`
        : `Income covers spending, so price pressure is easing back toward target.`}</div>`;
  }
  if (kind === "hdi") {
    return `<h4>HUMAN DEVELOPMENT INDEX — ${econ.hdi.toFixed(3)}</h4>
      <div class="row"><span>Life expectancy</span><span>${econ.lifeExpectancy.toFixed(1)} yrs</span></div>
      <div class="row"><span>GDP per capita</span><span>${fmtEUR(econ.gdp / econ.population)}</span></div>
      <div class="row"><span>Research (lifetime)</span><span>${fmtNum(econ.research)}</span></div>
      <div class="insightNote">HDI combines health (life expectancy), education (spending + research) and income (GDP per capita). Raise healthcare/education spending and grow the economy to push it up.</div>`;
  }
  if (kind === "unemployment") {
    return `<h4>UNEMPLOYMENT — ${econ.unemploymentRate.toFixed(1)}%</h4>
      <div class="row"><span>Crime index</span><span>${econ.crimeRate.toFixed(0)}/100</span></div>
      <div class="row"><span>Minimum wage</span><span>€${state.policy.minimumWageEUR}/mo</span></div>
      <div class="row"><span>Welfare spending</span><span>${state.spending.welfare.toFixed(1)}% GDP</span></div>
      <div class="insightNote">Driven by growth and stability; a high minimum wage adds to it, welfare spending cushions it. High unemployment feeds crime, which drags stability.</div>`;
  }
  if (kind === "happiness") {
    const cities = Object.entries(state.cityStats).map(([id, s]) => ({ name: (CITIES.find(c => c.id === id) || {}).name || id, h: s.happiness }))
      .sort((a, b) => b.h - a.h);
    const top = cities.slice(0, 4).map(c => `<div class="row"><span>${c.name}</span><span>${c.h.toFixed(0)}%</span></div>`).join("");
    const bottom = cities.slice(-3).reverse().map(c => `<div class="row"><span>${c.name}</span><span class="${c.h < 45 ? "neg" : ""}">${c.h.toFixed(0)}%</span></div>`).join("");
    return `<h4>OVERALL HAPPINESS — ${econ.overallHappiness.toFixed(1)}%</h4>
      <div class="insightNote">Happiness tracks political stability plus local factors (wages, roads/connectivity, services). Building roads and social services raises it; high taxes and unrest lower it.</div>
      <h4 style="margin-top:8px;">Happiest regions</h4>${top}
      <h4 style="margin-top:8px;">Least happy</h4>${bottom}`;
  }
  if (kind === "stability") {
    const b = stabilityBreakdown();
    const rows = b.items
      .sort((a, c) => Math.abs(c.value) - Math.abs(a.value))
      .map(i => `<div class="row"><span>${i.label}</span><span class="${i.value >= 0 ? "pos" : "neg"}">${i.value >= 0 ? "+" : ""}${i.value.toFixed(3)}/day</span></div>`)
      .join("") || `<div class="insightNote">No notable pressures — stability is holding steady.</div>`;
    return `<h4>POLITICAL STABILITY — ${econ.stability.toFixed(1)}%</h4>
      <div class="insightNote">Daily change is the sum of these pressures (plus small random noise). Positive raises stability, negative lowers it toward unrest.</div>
      ${rows}
      <div class="row total"><span>Net trend</span><span class="${b.net >= 0 ? "pos" : "neg"}">${b.net >= 0 ? "+" : ""}${b.net.toFixed(3)}/day</span></div>`;
  }
  if (kind === "research") {
    const fx = totalEffects();
    const schools = completedBuildingCount("school"), unis = completedBuildingCount("university"), parks = completedBuildingCount("tech_park");
    const tempBoost = (state.researchBoost && state.researchBoost.daysLeft > 0) ? state.researchBoost.mult : 0;
    return `<h4>RESEARCH</h4>
      <div class="row"><span>Accumulated points</span><span>${fmtNum(econ.research)}</span></div>
      <div class="row"><span>Rate</span><span>+${fmtNum(econ.researchRate)}/day</span></div>
      <h4 style="margin-top:10px;">WHY — rate contributions</h4>
      <div class="row"><span>Baseline institutes</span><span class="pos">+12/day</span></div>
      ${schools ? `<div class="row"><span>Schools ×${schools}</span><span class="pos">+${schools * 8}/day</span></div>` : ""}
      ${unis ? `<div class="row"><span>Universities ×${unis}</span><span class="pos">+${unis * 25}/day</span></div>` : ""}
      ${parks ? `<div class="row"><span>Tech parks ×${parks}</span><span class="pos">+${parks * 6}/day</span></div>` : ""}
      ${fx.researchRateFlat ? `<div class="row"><span>Technology (flat)</span><span class="pos">+${fmtNum(fx.researchRateFlat)}/day</span></div>` : ""}
      ${fx.researchRateMult ? `<div class="row"><span>Laws, ideology, tech & modifiers</span><span class="${fx.researchRateMult >= 0 ? "pos" : "neg"}">${fx.researchRateMult >= 0 ? "+" : ""}${Math.round(fx.researchRateMult * 100)}%</span></div>` : ""}
      ${tempBoost ? `<div class="row"><span>Temporary boost (event)</span><span class="pos">+${Math.round(tempBoost * 100)}% for ${state.researchBoost.daysLeft}d</span></div>` : ""}
      <div class="insightNote">Build schools, universities and tech parks to raise the base rate; Science Policy law, press freedom and ideology multiply it.</div>`;
  }
  if (kind === "population") {
    const births = econ.population * (econ.crudeBirthRate / 1000);
    const deaths = econ.population * (econ.crudeDeathRate / 1000);
    const emigration = econ.population * econ.emigrationRate * 365;
    const netGrowthRate = ((births - deaths - emigration) / econ.population) * 100;
    return `<h4>POPULATION</h4>
      <div class="row"><span>Total</span><span>${fmtNum(econ.population)}</span></div>
      <div class="row"><span>Births / year</span><span class="pos">+${fmtNum(births)}</span></div>
      <div class="row"><span>Deaths / year</span><span class="neg">-${fmtNum(deaths)}</span></div>
      ${emigration > 100 ? `<div class="row"><span>Emigration / year (crisis)</span><span class="neg">-${fmtNum(emigration)}</span></div>` : ""}
      ${Math.abs((lawEffects().migrationPerYear || 0)) > 0.0001 ? `<div class="row"><span>Net migration / year (laws & ideology)</span><span class="${(lawEffects().migrationPerYear || 0) >= 0 ? "pos" : "neg"}">${(lawEffects().migrationPerYear || 0) >= 0 ? "+" : ""}${fmtNum(econ.population * (lawEffects().migrationPerYear || 0))}</span></div>` : ""}
      <div class="row total"><span>Net growth rate</span><span class="${netGrowthRate >= 0 ? "pos" : "neg"}">${netGrowthRate >= 0 ? "+" : ""}${netGrowthRate.toFixed(2)}%/yr</span></div>
      <div class="row"><span>Crude birth rate</span><span>${econ.crudeBirthRate.toFixed(1)}/1000</span></div>
      <div class="row"><span>Crude death rate</span><span>${econ.crudeDeathRate.toFixed(1)}/1000</span></div>
      <div class="row total"><span>Fertility rate</span><span class="${econ.fertilityRate >= 2.1 ? "pos" : econ.fertilityRate < 1.5 ? "neg" : ""}">${econ.fertilityRate.toFixed(2)} births/woman</span></div>
      <div class="row"><span>Life expectancy</span><span>${econ.lifeExpectancy.toFixed(1)} yrs</span></div>
      <div class="insightNote">Replacement level is 2.10. Public housing, family tax exemption and higher happiness raise fertility.</div>`;
  }
  if (kind === "manpower") {
    const committed = state.units.reduce((s, u) => s + UNIT_TYPES[u.type].manpower, 0);
    const le = lawEffects();
    const capMult = Math.max(0.1, 1 + (le.manpowerCapMult || 0));
    const milFactor = clamp(state.spending.military / 2, 0.4, 3);
    const fx = totalEffects();
    return `<h4>MANPOWER</h4>
      <div class="row"><span>Active Duty</span><span>${fmtNum(econ.manpowerActive)} / ${fmtNum(econ.manpowerActiveCap)}</span></div>
      <div class="row"><span>Reserves ${econ.reserveActivated ? "(activated)" : "(not activated)"}</span><span>${fmtNum(econ.manpowerReserve)} / ${fmtNum(econ.manpowerReserveCap)}</span></div>
      <div class="row total"><span>Deployable Total</span><span>${fmtNum(availableManpower())}</span></div>
      <div class="row"><span>Committed to units</span><span>${fmtNum(committed)}</span></div>
      <h4 style="margin-top:10px;">WHY — active-duty cap</h4>
      <div class="row"><span>Base recruitable pool</span><span>${fmtNum(Math.round(econ.population * 0.0033))}</span></div>
      <div class="row"><span>Conscription law + ideology</span><span class="${capMult >= 1 ? "pos" : "neg"}">×${capMult.toFixed(2)} (${activeLawOption(lawGroup("conscription")).label})</span></div>
      <div class="row"><span>Military budget (${state.spending.military.toFixed(1)}% GDP)</span><span class="${milFactor >= 1 ? "pos" : "neg"}">×${milFactor.toFixed(2)}</span></div>
      ${fx.manpowerCapBonus ? `<div class="row"><span>Buildings & technology</span><span class="pos">+${fmtNum(fx.manpowerCapBonus)}</span></div>` : ""}
      <div class="row"><span>Daily intake</span><span>${econ.lastRecruitIntake != null ? "+" + fmtNum(econ.lastRecruitIntake) : "+" + fmtNum(Math.round(econ.population * 0.000002 * Math.max(0.1, 1 + (le.recruitRateMult || 0))))}/day${state.policy.fullRecruitment ? " (full capacity)" : ""}</span></div>
      <div class="row"><span>Recruiting facilities</span><span class="${state.policy.fullRecruitment ? "pos" : ""}">${state.policy.fullRecruitment ? (state.policy.martialLaw ? "Full capacity + martial law (300–500/day)" : "Full capacity (100–300/day)") : "Normal"}</span></div>
      <div class="row"><span>Martial Law</span><span>${state.policy.martialLaw ? "Declared" : "Not declared"}</span></div>`;
  }
  return null;
}

// Tax steppers shown in the treasury spending panel (income side).
const POLICY_ADJUSTERS = [
  { key: "corpTax", label: "Corporate Tax", step: 1, min: 10, max: 35, fmt: v => v.toFixed(0) + "%" },
  { key: "vat", label: "VAT Rate", step: 1, min: 10, max: 27, fmt: v => v.toFixed(0) + "%" },
];

function bindInsightAdjusters() {
  document.getElementById("insightBody").addEventListener("click", (e) => {
    const rangeBtn = e.target.closest(".gdpRangeBtn");
    if (rangeBtn) {
      gdpRange = rangeBtn.dataset.range;
      // GDP now lives inside the treasury panel — refresh just its section
      // there (a full renderInsight would only update slider numbers).
      const gdpSec = document.getElementById("gdpSection");
      if (gdpSec) { gdpSec.innerHTML = buildBreakdownHTML("gdp") || ""; return; }
      renderInsight();
      return;
    }
    const btn = e.target.closest(".adjBtn");
    if (!btn) return;
    const def = POLICY_ADJUSTERS.find(a => a.key === btn.dataset.key);
    if (!def) return;
    const next = clamp(state.policy[def.key] + Number(btn.dataset.step), def.min, def.max);
    state.policy[def.key] = Math.round(next * 100) / 100;
    if (openInsightKind === "treasury" || openInsightKind === "budget") updateSpendingPanelNumbers();
    else renderInsight();
  });
}

// ---- Treasury spending panel: one slider per department, each with a live
// consequence on the metric it funds. Built once per open; numbers refresh
// in place so a drag never gets interrupted. ----
function signed(x, suffix) {
  suffix = suffix || "";
  return (x >= 0 ? "+" : "") + x.toFixed(x % 1 === 0 ? 0 : 3) + suffix;
}

// What a tax change actually does — higher taxes raise revenue but cost
// happiness/stability (and mildly, growth). Shown live under each stepper.
function taxConsequence(key) {
  const base = key === "corpTax" ? 19 : 22;
  const d = state.policy[key] - base;
  const stabPerPt = key === "vat" ? 0.015 : 0.005;
  if (Math.abs(d) < 0.5) return `<span class="neutral">At baseline — neutral</span>`;
  const up = d > 0;
  const revenue = `<span class="${up ? "pos" : "neg"}">${up ? "+" : "−"} revenue</span>`;
  const stab = `<span class="${up ? "neg" : "pos"}">${signed(-d * stabPerPt)}/day stability${up ? " (↑ unrest, ↓ happiness)" : ""}</span>`;
  const growth = `<span class="${up ? "neg" : "pos"}">${signed(-d * 0.0004 * 100, "%")}/yr growth</span>`;
  return `${revenue} · ${stab} · ${growth}`;
}
const SPENDING_DEPTS = [
  { key: "military", label: svgIcon('military') + " Military", min: 0.5, max: 6, step: 0.1, base: 2.0,
    conseq: v => `Manpower cap ×${clamp(v / 2, 0.4, 3).toFixed(2)}${v > 3.5 ? " · overspend drags growth" : ""}` },
  { key: "healthcare", label: svgIcon('health') + " Healthcare", min: 2, max: 14, step: 0.1, base: 7.0,
    conseq: v => `Life expectancy → ${clamp(81.3 + (v - 7) * 0.45, 74, 87).toFixed(1)} yrs · ${signed((v - 7) * 0.010)}/day stability` },
  { key: "education", label: svgIcon('education') + " Education", min: 2, max: 12, step: 0.1, base: 5.0,
    conseq: v => `${signed((v - 5) * 0.006)}/day stability · lifts HDI` },
  { key: "pensions", label: svgIcon('pensions') + " Pensions", min: 5, max: 16, step: 0.1, base: 11.0,
    conseq: v => `${signed((v - 11) * 0.008)}/day stability (retirees)` },
  { key: "police", label: svgIcon('police') + " Police", min: 0.5, max: 5, step: 0.1, base: 1.7,
    conseq: v => `Crime ${signed((v - 1.7) * -5)} target · ${signed((v - 1.7) * 0.004)}/day stability` },
  { key: "infrastructure", label: svgIcon('infrastructure') + " Infrastructure", min: 1, max: 9, step: 0.1, base: 4.0,
    conseq: v => `${signed((v - 4) * 0.04, "%")}/yr GDP growth` },
  { key: "welfare", label: svgIcon('welfare') + " Social Welfare", min: 1, max: 10, step: 0.1, base: 5.0,
    conseq: v => `${signed((v - 5) * 0.008)}/day stability · ${signed((v - 5) * -0.25, "%")} unemployment` },
];

// ---- Treasury / GDP panel: now just the economy overview + a read-only
// budget summary. The editable tax steppers and department-spending sliders
// live in the POLICIES overlay (see budgetControlsHTML / buildLawsPane). ----
function buildSpendingPanel() {
  const body = document.getElementById("insightBody");
  body.innerHTML = `
    <div id="gdpSection">${buildBreakdownHTML("gdp") || ""}</div>
    <h4 style="margin-top:12px;">BUDGET</h4>
    <div id="spendSummary"></div>`;
  updateSpendingPanelNumbers();
}

// Itemized rows for an income/expense breakdown (monthly figures), largest
// first. Trade lines (imports/exports/commodity sales) are included.
function budgetRowsHTML(rows, cls) {
  return Object.entries(rows)
    .filter(([, v]) => Math.abs(v) > 1)
    .sort((a, b) => b[1] - a[1])
    .map(([label, v]) => `<div class="row"><span>${label}</span><span class="${cls}">${cls === "neg" ? "-" : "+"}${fmtEUR(v)}/mo</span></div>`)
    .join("");
}

function updateSpendingPanelNumbers() {
  const inc = getIncomeBreakdown();
  const exp = getExpenseBreakdown();
  const net = inc.total - exp.total;
  const summ = document.getElementById("spendSummary");
  if (summ) summ.innerHTML = `
    <div class="row"><span>Monthly Income</span><span class="pos">+${fmtEUR(inc.total)}</span></div>
    <div class="row"><span>Monthly Expenses</span><span class="neg">-${fmtEUR(exp.total)}</span></div>
    <div class="row total"><span>Net Balance</span><span class="${net >= 0 ? "pos" : "neg"}">${fmtEUR(net * 12)}/yr</span></div>
    <h4 style="margin-top:10px;">INCOME — what makes it up</h4>
    ${budgetRowsHTML(inc.rows, "pos")}
    <div class="row total"><span>Total income</span><span class="pos">+${fmtEUR(inc.total)}/mo</span></div>
    <h4 style="margin-top:10px;">EXPENSES — what makes them up</h4>
    ${budgetRowsHTML(exp.rows, "neg")}
    <div class="row total"><span>Total expenses</span><span class="neg">-${fmtEUR(exp.total)}/mo</span></div>
    <div class="insightNote">Trade lines (resource/electricity imports &amp; exports, commodity sales) are included above. Adjust taxes and department spending in the <b>POLICIES</b> panel.</div>`;
}

// ---- Reusable budget controls (taxes + department spending), rendered inside
// the POLICIES → Laws tab. ----
function budgetControlsHTML() {
  const taxRows = POLICY_ADJUSTERS.map(a => `
    <div class="spendRow">
      <div class="spendHead"><span>${a.label}</span><b id="taxVal-${a.key}">${a.fmt(state.policy[a.key])}</b></div>
      <input type="range" class="spendSlider" id="tax-${a.key}" min="${a.min}" max="${a.max}" step="${a.step}" value="${state.policy[a.key]}">
      <div class="spendMeta"><span class="taxConseq" id="taxConseq-${a.key}"></span></div>
    </div>`).join("");
  const deptRows = SPENDING_DEPTS.map(d => `
    <div class="spendRow">
      <div class="spendHead"><span>${d.label}</span><b id="spendPct-${d.key}"></b></div>
      <input type="range" class="spendSlider" id="spend-${d.key}" min="${d.min}" max="${d.max}" step="${d.step}" value="${state.spending[d.key]}">
      <div class="spendMeta"><span id="spendEur-${d.key}"></span><span class="spendConseq" id="spendConseq-${d.key}"></span></div>
    </div>`).join("");
  return `
    <div id="budgetSummary"></div>
    <h4 style="margin-top:8px;">TAXES (income)</h4>${taxRows}
    <h4 style="margin-top:10px;">DEPARTMENT SPENDING (% of GDP / yr)</h4>
    <div id="spendDepts">${deptRows}</div>`;
}

function bindBudgetControls(root) {
  SPENDING_DEPTS.forEach(d => {
    const sl = root.querySelector(`#spend-${d.key}`);
    if (sl) sl.addEventListener("input", () => {
      state.spending[d.key] = Math.round(Number(sl.value) * 10) / 10;
      updateBudgetNumbers();
    });
  });
  POLICY_ADJUSTERS.forEach(a => {
    const sl = root.querySelector(`#tax-${a.key}`);
    if (sl) sl.addEventListener("input", () => {
      state.policy[a.key] = Math.round(Number(sl.value));
      updateBudgetNumbers();
      renderTopBar();
    });
  });
  updateBudgetNumbers();
}

function updateBudgetNumbers() {
  const summ = document.getElementById("budgetSummary");
  if (summ) {
    const inc = getIncomeBreakdown(), exp = getExpenseBreakdown(), net = inc.total - exp.total;
    summ.innerHTML = `
      <div class="row"><span>Annual Income</span><span class="pos">+${fmtEUR(inc.total * 12)}</span></div>
      <div class="row"><span>Annual Expenses</span><span class="neg">-${fmtEUR(exp.total * 12)}</span></div>
      <div class="row total"><span>Net Balance</span><span class="${net >= 0 ? "pos" : "neg"}">${fmtEUR(net * 12)}/yr</span></div>`;
  }
  POLICY_ADJUSTERS.forEach(a => {
    const el = document.getElementById(`taxVal-${a.key}`);
    if (el) el.textContent = a.fmt(state.policy[a.key]);
    const cq = document.getElementById(`taxConseq-${a.key}`);
    if (cq) cq.innerHTML = taxConsequence(a.key);
    const sl = document.getElementById(`tax-${a.key}`);
    if (sl && document.activeElement !== sl && Number(sl.value) !== state.policy[a.key]) sl.value = state.policy[a.key];
  });
  const gdp = state.econ.gdp;
  SPENDING_DEPTS.forEach(d => {
    const v = state.spending[d.key];
    const pct = document.getElementById(`spendPct-${d.key}`);
    if (pct) pct.textContent = v.toFixed(1) + "%";
    const eur = document.getElementById(`spendEur-${d.key}`);
    if (eur) eur.textContent = fmtEUR(gdp * (v / 100) / 12) + "/mo";
    const cq = document.getElementById(`spendConseq-${d.key}`);
    if (cq) cq.textContent = d.conseq(v);
    const sl = document.getElementById(`spend-${d.key}`);
    if (sl && document.activeElement !== sl && Number(sl.value) !== v) sl.value = v;
  });
}

// ---- Event log ----
function renderEventLog() {
  const box = document.getElementById("eventLog");
  if (!state.eventLog.length) { box.innerHTML = `<div class="empty-msg">No events yet.</div>`; return; }
  box.innerHTML = state.eventLog.map(e =>
    `<div class="ev"><div class="t">${e.date.toLocaleDateString("en-GB")}</div>${e.text}</div>`
  ).join("");
}

// ---- Pending decisions tray ----
// renderTopBar calls this ~10x/sec. Rebuilding innerHTML every tick destroys
// the tray's DOM nodes mid-click, so a click on a pending item never lands
// (mousedown target gets removed before mouseup) — that was the "nothing pops
// up" bug. Guard: only rebuild when the visible content actually changes.
let pendingTraySig = null;
function renderPendingTray() {
  const tray = document.getElementById("pendingDecisions");
  if (!state.pendingDecisions.length) {
    if (pendingTraySig !== "") {
      tray.classList.add("hidden"); tray.innerHTML = ""; pendingTraySig = "";
      layoutBottomLeftPanels();
    }
    return;
  }
  const items = state.pendingDecisions.map((d) => {
    const daysLeft = Math.max(0, Math.ceil((d.deadlineDate - state.date) / 86400000));
    return { title: d.ev.title, daysLeft };
  });
  const sig = items.map(i => `${i.title}|${i.daysLeft}`).join("~");
  if (sig === pendingTraySig) return; // nothing changed — leave the DOM (and its click handlers) intact
  pendingTraySig = sig;
  tray.classList.remove("hidden");
  tray.innerHTML = `<div class="mailHeader">${svgIcon('mail')} ${items.length} decision${items.length > 1 ? "s" : ""} waiting</div>` +
    items.map((it, i) =>
      `<button class="mailItem" data-idx="${i}" title="${it.title.replace(/"/g, "&quot;")} — ${it.daysLeft}d left, click to decide">${svgIcon('envelope')} <span class="mailLabel">${it.title}</span><span class="mailBadge">${it.daysLeft}d</span></button>`
    ).join("");
  tray.querySelectorAll(".mailItem").forEach(el => {
    el.addEventListener("click", () => showDecision(state.pendingDecisions[Number(el.dataset.idx)]));
  });
  // The tray just changed height — restack the panels above it.
  layoutBottomLeftPanels();
}

// ---- Event modal ----
let prevSpeedBeforeEvent = null;
let currentDecision = null;

function maybeShowNextDecision() {
  // Decisions no longer force a centre-screen popup — they queue in the
  // bottom-left mail tray and open only when the player clicks one.
  renderPendingTray();
}

function showDecision(decision) {
  currentDecision = decision;
  prevSpeedBeforeEvent = { idx: state.speedIndex, paused: state.paused };
  state.paused = true;
  refreshSpeedButtons();

  const ev = decision.ev;
  const modal = document.getElementById("eventModal");
  document.getElementById("eventModalTitle").textContent = ev.title;
  document.getElementById("eventModalBody").textContent = ev.body;
  const daysLeft = Math.max(0, Math.ceil((decision.deadlineDate - state.date) / 86400000));
  document.getElementById("eventModalDeadline").textContent = `Decide within ${daysLeft} day(s), or it resolves itself with consequences.`;

  const expertsBtn = document.getElementById("eventModalExperts");
  if (ev.chance && ev.expertsCost) {
    expertsBtn.style.display = "";
    expertsBtn.textContent = decision.expertsRevealed ? "Expert insight purchased" : `Hire experts (${fmtEUR(ev.expertsCost)})`;
    expertsBtn.disabled = decision.expertsRevealed || state.econ.treasury < ev.expertsCost;
    expertsBtn.onclick = () => {
      // Co-op: the host pays for and reveals the expert insight.
      if (typeof mpRelayIfClient === "function" && mpRelayIfClient("hireExperts", { decisionId: decision.id })) return;
      state.econ.treasury -= ev.expertsCost;
      decision.expertsRevealed = true;
      logEvent(`Hired experts to assess: ${ev.title} (${fmtEUR(ev.expertsCost)}).`);
      showDecision(decision);
    };
  } else {
    expertsBtn.style.display = "none";
  }

  const choicesBox = document.getElementById("eventModalChoices");
  choicesBox.innerHTML = "";
  ev.choices.forEach(choice => {
    const btn = document.createElement("button");
    let previewHTML;
    if (choice.chance !== undefined) {
      const oddsText = decision.expertsRevealed ? `${Math.round(choice.chance * 100)}% success chance — ` : "Uncertain odds — ";
      previewHTML = oddsText + `success: ${deltaPreviewHTML(choice.successDelta)} &nbsp;|&nbsp; failure: ${deltaPreviewHTML(choice.failDelta)}`;
    } else {
      previewHTML = deltaPreviewHTML(choice.delta);
    }
    btn.innerHTML = `<span class="choice-label">${choice.label}</span><span class="choice-preview">${previewHTML}</span>`;
    btn.addEventListener("click", () => resolveChoice(decision, choice));
    choicesBox.appendChild(btn);
  });
  modal.classList.remove("hidden");
}

function resolveChoice(decision, choice) {
  // Co-op: a joined player's decision is resolved by the authoritative host.
  // Identify the decision + choice by stable id/index (object refs differ).
  if (typeof mpRelayIfClient === "function" && mpRole === "client") {
    const choiceIndex = decision.ev.choices.indexOf(choice);
    mpRelayIfClient("resolveChoice", { decisionId: decision.id, choiceIndex });
    closeEventModal();
    return;
  }
  const ev = decision.ev;
  let outcomeLog;
  if (choice.chance !== undefined) {
    // Risky choices don't pay off (or blow up) instantly — the outcome
    // resolves a few in-game days later and arrives as a mail-tray report
    // (see tickPendingOutcomes in events.js).
    const days = 2 + Math.random() * 5;
    state.pendingOutcomes.push({ ev, choice, resolveDate: new Date(state.date.getTime() + days * 86400000) });
    outcomeLog = `${choice.label} — <span style="color:#7c98a2">outcome uncertain, a report will arrive in a few days</span>`;
  } else {
    applyEventDelta(choice.delta);
    outcomeLog = `${choice.label} <span style="color:#7c98a2">(${deltaPreviewHTML(choice.delta)})</span>`;
  }
  logEvent(`<b>${ev.title}</b>: ${outcomeLog}`);

  state.pendingDecisions = state.pendingDecisions.filter(d => d !== decision);
  closeEventModal();
  renderPendingTray();
  maybeShowNextDecision();
}

function postponeCurrentDecision() {
  closeEventModal();
  renderPendingTray();
}

function closeEventModal() {
  document.getElementById("eventModal").classList.add("hidden");
  currentDecision = null;
  if (prevSpeedBeforeEvent) state.paused = prevSpeedBeforeEvent.paused;
  refreshSpeedButtons();
}

// Kept for compatibility if anything still calls the old name directly.
function showEventModal(ev) {
  triggerRandomEvent();
}
