#!/usr/bin/env node
// Compares a page built by ShooterReborn's tools/roadmap/build.mjs with one built by roadmd from the same docs.
//   node proof/compare.mjs <original roadmap.html> <roadmd roadmap.html>
// Prints every difference in the data both pages show; exit 1 if any.
import fs from "node:fs";

const [a, b] = process.argv.slice(2);
if (!a || !b) { console.error("usage: compare.mjs <original.html> <roadmd.html>"); process.exit(2); }
function extract(file) {
  const html = fs.readFileSync(file, "utf8");
  const grab = (name) => {
    const start = html.indexOf(`window.${name} = `) + `window.${name} = `.length;
    const end = html.indexOf(";\n", start);
    return JSON.parse(html.slice(start, end));
  };
  return { R: grab("ROADMAP"), D: grab("DOCS") };
}
const O = extract(a), N = extract(b);
const diffs = [];
const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);
const check = (what, x, y) => { if (!same(x, y)) diffs.push(`${what}\n    original: ${JSON.stringify(x)}\n    roadmd:   ${JSON.stringify(y)}`); };

// items
const oi = O.R.items, ni = N.R.items;
check("item ids", Object.keys(oi).sort(), Object.keys(ni).sort());
for (const id of Object.keys(oi)) {
  const o = oi[id], n = ni[id];
  if (!n) continue;
  for (const f of ["title", "feature", "stage", "state", "stateNote", "area", "milestone", "after", "with", "unblocks", "immediate", "total", "text", "note", "line"]) check(`${id}.${f}`, o[f], n[f]);
  check(`${id}.spec`, o.spec, n.spec);
  check(`${id}.tech`, o.tech, n.docs?.tech || null);
}
// structure
check("milestones (id, title, tag)", O.R.milestones.map((m) => [m.id, m.title, m.tag]), N.R.milestones.map((m) => [m.id, m.title, m.tag]));
for (const m of O.R.milestones) { const n = N.R.milestones.find((x) => x.id === m.id); if (n) check(`milestone ${m.id} body`, m.body, n.body); }
check("continuous", O.R.continuous, N.R.continuous);
check("areas", O.R.areas, N.R.areas);
check("next", [O.R.now.build, O.R.now.tech, O.R.now.design], ["build", "tech", "design"].map((w) => N.R.next.find((x) => x.work === w)?.ids));
check("dropped ids", O.R.dropped.map((d) => d.id), N.R.dropped.map((d) => d.id));
check("reviews", Object.fromEntries(Object.entries(O.R.reviews).map(([p, r]) => [p, [r.state, r.text]])), Object.fromEntries(Object.entries(N.R.reviews).map(([p, r]) => [p, [r.state, r.text]])));
// documents
check("document paths", Object.keys(O.D).sort(), Object.keys(N.D).sort());
for (const p of Object.keys(O.D)) if (N.D[p] !== undefined && N.D[p] !== O.D[p]) diffs.push(`document ${p} differs`);

console.log(`${Object.keys(oi).length} items, ${O.R.milestones.length} milestones, ${O.R.areas.length} areas, ${Object.keys(O.D).length} documents compared`);
if (!diffs.length) { console.log("identical"); process.exit(0); }
console.log(`${diffs.length} difference(s):\n  ` + diffs.join("\n  "));
process.exit(1);
