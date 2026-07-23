// Shared inline-SVG icon set — replaces the emoji used across the UI so the
// game renders crisp, consistent vector icons instead of platform emoji.
// Every icon is a 24x24 stroke glyph using currentColor, so it takes on the
// colour/size of whatever text it sits in. Use svgIcon("name") anywhere an
// emoji string used to go (the result is safe to drop into innerHTML).

const ICON_PATHS = {
  // ---- dock stats ----
  stability: '<path d="M4 21h16M6 21V10M10 21V10M14 21V10M18 21V10M3 10l9-6 9 6"/>',       // parliament
  happiness: '<circle cx="12" cy="12" r="9"/><path d="M8 14a4 4 0 0 0 8 0"/><circle cx="9" cy="10" r="0.6"/><circle cx="15" cy="10" r="0.6"/>',
  treasury:  '<ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6"/>',
  population:'<circle cx="8" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M2.5 20a5.5 5.5 0 0 1 11 0M14 20a5 5 0 0 1 7.5-4.3"/>',
  manpower:  '<path d="M5 12a7 7 0 0 1 14 0v1H5z M4 13h16v2a2 2 0 0 1-2 2h-3l-1 2h-4l-1-2H6a2 2 0 0 1-2-2z"/>', // helmet
  hdi:       '<path d="M4 20V10M10 20V4M16 20v-8M22 20H2"/>',
  unemployment:'<path d="M3 7l6 6 4-4 8 8M21 17v-5h-5"/>',
  // ---- building sectors ----
  social:    '<path d="M4 21V8l8-5 8 5v13M9 21v-6h6v6M12 8v4M10 10h4"/>',                   // hospital
  economy:   '<path d="M3 21V9l6 3V9l6 3V4l6 3v14z M7 17h0M11 17h0M15 17h0"/>',               // factory
  energy:    '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',                                        // bolt
  mines:     '<path d="M14 4l6 6M17 7L4 20M9 4h8v8"/>',                                       // pick
  military:  '<path d="M5 12a7 7 0 0 1 14 0v1H5z M4 13h16v2a2 2 0 0 1-2 2h-3l-1 2h-4l-1-2H6a2 2 0 0 1-2-2z"/>',
  // ---- laws ----
  bank:      '<path d="M4 21h16M4 10h16M5 21V10M9 21V10M15 21V10M19 21V10M3 10l9-6 9 6"/>',
  ship:      '<path d="M3 15l1.5 5a1 1 0 0 0 1 .8h11a1 1 0 0 0 1-.8L20 15M5 15V9h14v6M12 3v6M7 9V7a5 5 0 0 1 10 0v2"/>',
  press:     '<path d="M4 5h13v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z M17 8h3v10a2 2 0 0 1-2 2M7 9h7M7 13h7M7 17h4"/>',
  passport:  '<rect x="5" y="3" width="14" height="18" rx="1.5"/><circle cx="12" cy="10" r="2.5"/><path d="M9 15h6"/>',
  eye:       '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="2.5"/>',
  flask:     '<path d="M9 3h6M10 3v6L5 19a1.5 1.5 0 0 0 1.3 2.2h11.4A1.5 1.5 0 0 0 19 19l-5-10V3M8 15h8"/>',
  // ---- policy toggles / measures ----
  family:    '<circle cx="8" cy="6" r="2.4"/><circle cx="16" cy="7" r="2"/><path d="M4 20v-4a4 4 0 0 1 8 0v4M13 20v-3a3.5 3.5 0 0 1 7 0v3"/>',
  medal:     '<circle cx="12" cy="14" r="5"/><path d="M12 11v3l2 1M8 3l2 6M16 3l-2 6"/>',
  alert:     '<path d="M12 3l9 16H3z M12 10v4M12 17h0"/>',
  euro:      '<circle cx="12" cy="12" r="9"/><path d="M15 8.5a4 4 0 1 0 0 7M7 11h6M7 13.5h5"/>',
  // ---- spending departments ----
  health:    '<path d="M12 20S4 14.5 4 9.2A4.2 4.2 0 0 1 12 7a4.2 4.2 0 0 1 8 2.2C20 14.5 12 20 12 20z"/>',
  education: '<path d="M12 4L2 9l10 5 8-4v6M6 12v4c0 1.5 2.7 3 6 3s6-1.5 6-3v-4"/>',
  pensions:  '<circle cx="12" cy="6" r="2.5"/><path d="M8 21l1.5-8M16 21l-1.5-8M8 13h8M11 13l-1 8M13 13l1 8"/>',
  police:    '<path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z M9.5 12l2 2 3.5-4"/>',
  infrastructure:'<path d="M3 20l3-14M21 20l-3-14M12 6v14M6 11h12M5 16h14"/>',
  welfare:   '<path d="M12 20S4 14.5 4 9.2A4.2 4.2 0 0 1 12 7a4.2 4.2 0 0 1 8 2.2C20 14.5 12 20 12 20z M8 12l2.5 2.5L16 9"/>',
  // ---- zones ----
  office:    '<path d="M5 21V4h9v17M14 21V9h5v12M8 8h1M11 8h0M8 12h1M11 12h0M8 16h1M11 16h0"/>',
  anchor:    '<circle cx="12" cy="5" r="2"/><path d="M12 7v13M5 12a7 7 0 0 0 14 0M4 12h3M17 12h3"/>',
  // ---- resource deposits ----
  coal:      '<path d="M7 8l3-3 5 1 3 4-1 6-5 3-6-2-2-6z"/>',
  mercury:   '<path d="M12 3s6 7 6 11a6 6 0 0 1-12 0c0-4 6-11 6-11z"/>',
  gear:      '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
  oildrum:   '<rect x="6" y="4" width="12" height="16" rx="1.5"/><path d="M6 9h12M6 15h12"/>',
  salt:      '<path d="M8 8h8l-1 12H9z M9 8V5a3 3 0 0 1 6 0v3M11 12v4M13 12v4"/>',
  stone:     '<path d="M4 15l4-7 6-2 6 5-2 7-8 2z"/>',
  geothermal:'<path d="M6 20c0-3 3-3 3-6s-3-3-3-6M12 20c0-3 3-3 3-6s-3-3-3-6M18 20c0-3-3-3-3-6"/>',
  // ---- misc UI ----
  globe:     '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18"/>',
  package:   '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z M4 7.5l8 4.5 8-4.5M12 12v9"/>',
  handshake: '<path d="M8 11L4 7 2 9v5l4 4 3-2 3 2 3-2 4 2 2-4V9l-2-2-4 4M8 11l3 3M12 8l-2 2"/>',
  map:       '<path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2-6-2z M9 4v14M15 6v14"/>',
  mail:      '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
  envelope:  '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
  check:     '<path d="M4 12.5l5 5 11-11"/>',
  cross:     '<path d="M6 6l12 12M18 6L6 18"/>',
  lock:      '<rect x="5" y="11" width="14" height="9" rx="1.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  warning:   '<path d="M12 3l9 16H3z M12 9v5M12 17h0"/>',
  monument:  '<path d="M8 21h8M9 21l1-13h4l1 13M10 8L12 3l2 5"/>',
  compass:   '<circle cx="12" cy="12" r="9"/><path d="M15 9l-2 5-4 2 2-5z"/>',
  scales:    '<path d="M12 3v18M6 21h12M5 7h14M5 7l-3 6a3 3 0 0 0 6 0zM19 7l-3 6a3 3 0 0 0 6 0z"/>',
  research:  '<path d="M9 3h6M10 3v6L5 19a1.5 1.5 0 0 0 1.3 2.2h11.4A1.5 1.5 0 0 0 19 19l-5-10V3M8 15h8"/>',
  bell:      '<path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6M10 20a2 2 0 0 0 4 0"/>',
  moneyburn: '<rect x="3" y="8" width="18" height="10" rx="1.5"/><circle cx="12" cy="13" r="2.5"/><path d="M12 3c2 2 1 3 0 4M15 4c1 1.5 .5 2.5 0 3.5"/>',
  medic:     '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M12 9v7M8.5 12.5h7"/>',
  fist:      '<path d="M7 11V5a1.5 1.5 0 0 1 3 0M10 11V4a1.5 1.5 0 0 1 3 0v7M13 11V5a1.5 1.5 0 0 1 3 0v8a6 6 0 0 1-12 0v-2a1.5 1.5 0 0 1 3 0"/>',
  megaphone: '<path d="M3 11v2a1 1 0 0 0 1 1h2l9 5V5L6 10H4a1 1 0 0 0-1 1z M18 9a3 3 0 0 1 0 6"/>',
  house:     '<path d="M4 21V10l8-6 8 6v11z M9 21v-6h6v6"/>',
  star:      '<path d="M12 3l2.5 6 6.5.5-5 4.3 1.6 6.4L12 17l-5.6 3.2L8 13.8l-5-4.3 6.5-.5z"/>',
  wrench:    '<path d="M14 6a4 4 0 0 0 5 5l-8 8-3-3z M14 6l-3-3a4 4 0 0 0-5 5l3 3"/>',
  hole:      '<ellipse cx="12" cy="12" rx="9" ry="4.5"/><ellipse cx="12" cy="12" rx="4" ry="2"/>',
  toolbox:   '<rect x="3" y="8" width="18" height="11" rx="1.5"/><path d="M8 8V6a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 13h18"/>',
  trendup:   '<path d="M3 17l6-6 4 4 8-8M21 11V7h-4"/>',
  trenddown: '<path d="M3 7l6 6 4-4 8 8M21 13v4h-4"/>',
  wilt:      '<path d="M12 21V9M12 9a3 3 0 0 0-3-3 3 3 0 0 0 3 3zM12 9a3 3 0 0 1 3-3 3 3 0 0 1-3 3zM9 21h6"/>',
  gauge:     '<path d="M4 20a8 8 0 1 1 16 0 M12 20V10M12 14l4-3"/>',
  plane:     '<path d="M10 3.5a1.5 1.5 0 0 1 3 0V9l8 5v2l-8-2.5V19l2.5 2v1.5L11.5 22 8 23.5V22l2.5-3v-5.5L2 16v-2l8-5z"/>',
  trash:     '<path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13M10 11v6M14 11v6"/>',
};

function svgIcon(name, cls) {
  const p = ICON_PATHS[name];
  if (!p) return "";
  return `<svg class="gi${cls ? " " + cls : ""}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
}
