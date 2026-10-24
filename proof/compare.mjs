#!/usr/bin/env node
// Compares two roadmap pages built from the same docs: ShooterReborn's tools/roadmap/build.mjs or roadmd, either side.
//   node proof/compare.mjs <a roadmap.html> <b roadmap.html> [--same-order] [--brief]
// Prints every difference in the data both pages show (--brief: only what differs); exit 1 if any.
// A board moved to another folder rewrites its relative links, so board-wide text is compared without link targets;
// an area's items are compared as a set unless --same-order.
import fs from "node:fs";

const [a, b] = process.argv.slice(2).filter((x) => !x.startsWith("--"));
if (!a || !b) { console.error("usage: compare.mjs <a.html> <b.html> [--same-order] [--brief]"); process.exit(2); }
const sameOrder = process.argv.includes("--same-order"), brief = process.argv.includes("--brief");
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
const check = (what, x, y) => { if (!same(x, y)) diffs.push(brief ? what : `${what}\n    a: ${JSON.stringify(x)}\n    b: ${JSON.stringify(y)}`); };
const noHref = (t) => (t ?? "").replace(/\]\([^)]*\)/g, "]");

// items
const oi = O.R.items, ni = N.R.items;
check("item ids", Object.keys(oi).sort(), Object.keys(ni).sort());
for (const id of Object.keys(oi)) {
  const o = oi[id], n = ni[id];
  if (!n) continue;
  for (const f of ["title", "feature", "stage", "state", "stateNote", "area", "milestone", "after", "with", "immediate", "total", "text", "note"]) check(`${id}.${f}`, o[f], n[f]);
  check(`${id}.unblocks`, [...o.unblocks].sort(), [...n.unblocks].sort());
  check(`${id}.spec`, o.spec, n.spec);
  check(`${id}.tech`, o.tech ?? o.docs?.tech ?? null, n.tech ?? n.docs?.tech ?? null);
}
// structure
check("milestones (id, title, tag)", O.R.milestones.map((m) => [m.id, m.title, m.tag]), N.R.milestones.map((m) => [m.id, m.title, m.tag]));
for (const m of O.R.milestones) { const n = N.R.milestones.find((x) => x.id === m.id); if (n) check(`milestone ${m.id} body`, noHref(m.body), noHref(n.body)); }
check("continuous", noHref(O.R.continuous?.body), noHref(N.R.continuous?.body));
check("areas", O.R.areas.map((x) => [x.id, x.title, noHref(x.intro)]), N.R.areas.map((x) => [x.id, x.title, noHref(x.intro)]));
for (const x of O.R.areas) { const n = N.R.areas.find((y) => y.id === x.id); if (n) check(`area ${x.id} items`, sameOrder ? x.items : [...x.items].sort(), sameOrder ? n.items : [...n.items].sort()); }
const nextOf = (R) => R.now ? [R.now.build, R.now.tech, R.now.design] : ["build", "tech", "design"].map((w) => R.next.find((x) => x.work === w)?.ids);
check("next", nextOf(O.R), nextOf(N.R));
check("dropped ids", O.R.dropped.map((d) => d.id).sort(), N.R.dropped.map((d) => d.id).sort());
check("reviews", Object.fromEntries(Object.entries(O.R.reviews).map(([p, r]) => [p, [r.state, r.text]])), Object.fromEntries(Object.entries(N.R.reviews).map(([p, r]) => [p, [r.state, r.text]])));
// documents
check("document paths", Object.keys(O.D).sort(), Object.keys(N.D).sort());
for (const p of Object.keys(O.D)) if (N.D[p] !== undefined && N.D[p] !== O.D[p]) diffs.push(`document ${p} differs`);

console.log(`${Object.keys(oi).length} items, ${O.R.milestones.length} milestones, ${O.R.areas.length} areas, ${Object.keys(O.D).length} documents compared`);
if (!diffs.length) { console.log("identical"); process.exit(0); }
console.log(`${diffs.length} difference(s):\n  ` + diffs.join("\n  "));
process.exit(1);
