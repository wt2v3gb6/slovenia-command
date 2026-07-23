const fs = require("fs");
const path = require("path");

function pointInPolygon(pt, ring) {
  const [y, x] = pt; // lat, lon
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [yi, xi] = ring[i], [yj, xj] = ring[j];
    const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

const border = JSON.parse(fs.readFileSync(path.join(__dirname, "border.json"), "utf8"));
const ring = border.rings[0];
const all = JSON.parse(fs.readFileSync(path.join(__dirname, "municipalities.json"), "utf8"));

const filtered = all.filter(m => pointInPolygon(m.centroid, ring));
fs.writeFileSync(path.join(__dirname, "municipalities.json"), JSON.stringify(filtered));
console.log(`Filtered ${all.length} -> ${filtered.length} municipalities inside Slovenia's border`);
