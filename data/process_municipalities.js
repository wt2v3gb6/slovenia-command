const fs = require("fs");
const path = require("path");
const { loadElements, relationToRings, simplify } = require("./process_boundary.js");

const { nodeLL, wayNodeIds, relations } = loadElements(path.join(__dirname, "municipalities_raw.json"));
console.log(`Loaded ${relations.length} relations`);

const out = [];
relations.forEach((rel, i) => {
  const name = (rel.tags && rel.tags.name) || `Municipality ${i}`;
  let rings;
  try {
    rings = relationToRings({ nodeLL, wayNodeIds }, rel).map(r => simplify(r, 0.0003));
  } catch (e) {
    console.log(`skip ${name}: ${e.message}`);
    return;
  }
  rings = rings.filter(r => r.length >= 4);
  if (!rings.length) { console.log(`no rings for ${name}`); return; }

  // centroid of the largest ring (simple average, fine for label placement)
  const biggest = rings.reduce((a, b) => a.length > b.length ? a : b);
  let sumLat = 0, sumLon = 0;
  biggest.forEach(p => { sumLat += p[0]; sumLon += p[1]; });
  const centroid = [sumLat / biggest.length, sumLon / biggest.length];

  out.push({ id: rel.id, name, centroid, rings });
});

fs.writeFileSync(path.join(__dirname, "municipalities.json"), JSON.stringify(out));
console.log(`Wrote ${out.length} municipalities`);
