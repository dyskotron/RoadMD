// The single-file board (step 1's format, ShooterReborn's docs/ROADMAP.md), read into the model.
//
//   # Title
//   ## Next                      a sentence only: the list is computed
//   ## Milestones
//   ### M1 Title — tag           prose, then its items by ID (ranges `X-1 … X-4`)
//   ### Continuous tracks         may use `FEATURE-*` or `AREA-*`
//   ## The tree
//   ### CODE — Area title        then items:
//   - **ID Title** — state (qualifier) · after IDs · feeds IDs · with IDs · a document · free text
//     indented lines: the note
//   ## Renumbered                `OLD → NEW` pairs become the new item's `was`
//   ## Dropped                   retired items, same line shape
//
// Pure: text in, { board, errors, warnings } out.
import path from "node:path";
import { compilePatterns, idsIn, parseState, newItem } from "./ids.mjs";

export function readSingleFile(text, cfg, rel) {
  const P = compilePatterns(cfg);
  const stateIds = cfg.states.map((s) => s.id);
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const errors = [], warnings = [];
  const base = path.posix.dirname(rel);
  const board = { title: "", intro: [], areas: [], milestones: [], items: {}, dropped: [], base };
  const listed = []; // { milestone, ids, wildcards }
  const renames = []; // [old, new]
  let section = "", milestone = null, area = null, item = null, order = 0;

  for (let n = 0; n < lines.length; n++) {
    const line = lines[n];
    if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) continue; // a rule between sections, never content
    const where = `${rel}:${n + 1}`;
    if (line.startsWith("# ") && !board.title) { board.title = line.slice(2).trim(); continue; }
    if (line.startsWith("## ")) {
      const h = line.slice(3).trim().toLowerCase();
      section = { next: "next", milestones: "milestones", "the tree": "tree", dropped: "dropped", renumbered: "renumbered" }[h] || "other";
      milestone = area = item = null;
      continue;
    }
    if (section === "next") {
      if (line.startsWith("- ")) errors.push(`${where}: "## Next" is computed, not written: remove the bullet "${line.slice(2).trim()}"`);
      continue;
    }
    if (section === "milestones") {
      if (line.startsWith("### ")) {
        const mm = line.match(P.milestone);
        if (mm) milestone = { id: mm[1], title: mm[2].trim(), tag: (mm[3] || "").trim(), body: [], continuous: false };
        else if (/^### continuous/i.test(line)) milestone = { id: "C", title: "Continuous tracks", tag: "", body: [], continuous: true };
        else { milestone = null; continue; }
        board.milestones.push(milestone);
        listed.push({ milestone, ids: [], wildcards: [] });
        continue;
      }
      if (milestone && line.trim()) {
        milestone.body.push(line.trim());
        const expanded = line.replace(P.range, (_, pre, from, to) => {
          const r = [];
          for (let i = +from; i <= +to; i++) r.push(pre + i);
          return r.join(" ");
        });
        listed.at(-1).ids.push(...idsIn(P, expanded));
        if (milestone.continuous) for (const m of line.matchAll(P.wildcard)) listed.at(-1).wildcards.push(m[1]);
      }
      continue;
    }
    if (section === "tree") {
      const am = line.match(P.area);
      if (am) { area = { id: am[1], title: am[2].trim(), intro: [] }; board.areas.push(area); item = null; continue; }
      if (line.startsWith("### ")) { errors.push(`${where}: an area header is "### CODE — title": ${line}`); area = null; continue; }
      if (!area) continue;
      const im = line.match(P.item);
      if (im) {
        const [, id, title, rest] = im;
        if (board.items[id]) errors.push(`${where}: duplicate id ${id}`);
        item = newItem(id, title);
        Object.assign(item, { area: area.id, order: order++, source: rel, line: n + 1, base });
        parseItemRest(item, rest, where, stateIds, P, errors, warnings);
        board.items[id] = item;
        continue;
      }
      if (line.startsWith("- ")) { errors.push(`${where}: the item line doesn't match "- **ID Title** — state · …": ${line}`); item = null; continue; }
      if (item && line.startsWith("  ") && line.trim()) { item.note.push(line.trim()); continue; }
      if (!item && line.trim()) { area.intro.push(line.trim()); continue; }
      if (!line.trim()) item = null;
      continue;
    }
    if (section === "renumbered") {
      for (const m of line.matchAll(new RegExp(`\\b(${cfg.ids.pattern})\\s*→\\s*(${cfg.ids.pattern})\\b`, "g"))) renames.push([m[1], m[2]]);
      continue;
    }
    if (section === "dropped") {
      const dm = line.match(P.item);
      if (dm) board.dropped.push({ id: dm[1], title: dm[2], text: [dm[3]], source: rel, line: n + 1 });
      else if (line.startsWith("  ") && board.dropped.length) board.dropped.at(-1).text.push(line.trim());
      continue;
    }
    if (!section && line.trim()) board.intro.push(line);
  }

  // Milestones list their items here; the model keeps the milestone on the item.
  const droppedIds = new Set(board.dropped.map((d) => d.id));
  for (const { milestone: m, ids } of listed) {
    if (m.continuous) continue;
    for (const id of ids) {
      const it = board.items[id];
      if (!it) { errors.push(droppedIds.has(id) ? `${m.id} lists ${id}, which is dropped` : `${m.id} lists unknown item ${id}`); continue; }
      if (it.milestone && it.milestone !== m.id) errors.push(`${id} is listed in both ${it.milestone} and ${m.id}`);
      it.milestone = m.id;
    }
  }
  for (const { milestone: m, ids, wildcards } of listed) {
    if (!m.continuous) continue;
    for (const id of ids) if (board.items[id] && !board.items[id].milestone) board.items[id].milestone = m.id;
    for (const w of wildcards) for (const it of Object.values(board.items)) if ((it.feature === w || it.area === w) && !it.milestone) it.milestone = m.id;
  }
  for (const [from, to] of renames) if (board.items[to] && !board.items[to].was.includes(from)) board.items[to].was.push(from);
  return { board, errors, warnings };
}

function parseItemRest(it, rest, where, stateIds, P, errors, warnings) {
  const parts = rest.split(" · ").map((s) => s.trim()).filter(Boolean);
  const first = parts.shift() || "";
  const st = parseState(first);
  if (!st || !stateIds.includes(st.state)) errors.push(`${where}: ${it.id} has an unknown state "${first}" (one of ${stateIds.join(", ")})`);
  else { it.state = st.state; it.stateNote = st.note; }
  for (const p of parts) {
    const m = p.match(/^(after|feeds|with)\s+(.*)$/);
    if (m) {
      const ids = idsIn(P, m[2]);
      if (!ids.length) (m[1] === "after" ? errors : warnings).push(`${where}: ${it.id} "${m[1]}" names no item: ${p}`);
      it[m[1]].push(...ids);
      continue;
    }
    it.parts.push(p); // a document or free text: resolved against the documents later
  }
}
