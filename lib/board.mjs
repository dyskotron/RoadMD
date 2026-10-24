// Reads the board: the markdown line grammar (README, "The board's grammar"). Pure: text in, structure out.
//
//   # Title
//   ## Next                      a sentence only: the list is computed
//   ## Milestones
//   ### M1 Title — tag           its items by ID (ranges `X-1 … X-4`); `### Continuous tracks` may use `X-*`
//   ## The tree
//   ### CODE — Area title        then items:
//   - **ID Title** — state (qualifier) · after IDs · feeds IDs · with IDs · a document · free text
//     indented lines: the note
//   ## Renumbered / ## Dropped   (dropped items keep the item line's shape)

export function compilePatterns(cfg) {
  const id = cfg.ids.pattern, area = cfg.areas.pattern, ms = cfg.milestones.pattern;
  return {
    id: new RegExp(`\\b(?:${id})\\b`, "g"),
    idExact: new RegExp(`^(?:${id})$`),
    item: new RegExp(`^- \\*\\*(${id}) (.+?)\\*\\* — (.*)$`),
    area: new RegExp(`^### (${area}) — (.+)$`),
    milestone: new RegExp(`^### (${ms}) (.+?)(?: — (.*))?$`),
    wildcard: /\b([A-Z][A-Z0-9]*)-\*/g,
    range: /\b([A-Z][A-Z0-9]*-)(\d+)\s*(?:…|\.\.\.?|–)\s*\1(\d+)\b/g,
  };
}

export const splitId = (id) => { const i = id.lastIndexOf("-"); return { feature: id.slice(0, i), stage: +id.slice(i + 1) }; };

export function parseBoard(text, cfg, boardRel = "ROADMAP.md") {
  const P = compilePatterns(cfg);
  const stateIds = cfg.states.map((s) => s.id);
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const errors = [], warnings = [];
  const board = { title: "", intro: [], milestones: [], continuous: null, areas: [], items: {}, dropped: [], lines };
  const idsIn = (t) => [...t.matchAll(P.id)].map((m) => m[0]);
  let section = "", milestone = null, area = null, item = null;

  for (let n = 0; n < lines.length; n++) {
    const line = lines[n];
    const where = `${boardRel}:${n + 1}`;
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
        if (mm) { milestone = { id: mm[1], title: mm[2].trim(), tag: (mm[3] || "").trim(), body: [], ids: [], line: n + 1 }; board.milestones.push(milestone); }
        else if (/^### continuous/i.test(line)) milestone = board.continuous = { id: "C", title: "Continuous tracks", tag: "", body: [], ids: [], wildcards: [], line: n + 1 };
        else milestone = null;
        continue;
      }
      if (milestone && line.trim()) {
        milestone.body.push(line.trim());
        const expanded = line.replace(P.range, (_, pre, from, to) => {
          const r = [];
          for (let i = +from; i <= +to; i++) r.push(pre + i);
          return r.join(" ");
        });
        milestone.ids.push(...idsIn(expanded));
        if (milestone.wildcards) for (const m of line.matchAll(P.wildcard)) milestone.wildcards.push(m[1]);
      }
      continue;
    }
    if (section === "tree") {
      const am = line.match(P.area);
      if (am) { area = { id: am[1], title: am[2].trim(), intro: [], items: [], line: n + 1 }; board.areas.push(area); item = null; continue; }
      if (line.startsWith("### ")) { errors.push(`${where}: an area header is "### CODE — title": ${line}`); area = null; continue; }
      if (!area) continue;
      const im = line.match(P.item);
      if (im) {
        const [, id, title, rest] = im;
        if (board.items[id]) errors.push(`${where}: duplicate id ${id}`);
        item = parseItemRest(id, title, rest, where, stateIds, idsIn, errors, warnings);
        item.area = area.id;
        item.line = n + 1;
        item.lastLine = n + 1;
        board.items[id] = item;
        area.items.push(id);
        continue;
      }
      if (line.startsWith("- ")) { errors.push(`${where}: the item line doesn't match "- **ID Title** — state · …": ${line}`); item = null; continue; }
      if (item && line.startsWith("  ") && line.trim()) { item.note.push(line.trim()); item.lastLine = n + 1; continue; }
      if (!item && line.trim()) { area.intro.push(line.trim()); continue; }
      if (!line.trim()) item = null;
      continue;
    }
    if (section === "dropped") {
      const dm = line.match(P.item);
      if (dm) board.dropped.push({ id: dm[1], title: dm[2], text: [dm[3]], line: n + 1 });
      else if (line.startsWith("  ") && board.dropped.length) board.dropped.at(-1).text.push(line.trim());
      continue;
    }
    if (!section && line.trim()) board.intro.push(line);
  }
  return { board, errors, warnings };
}

function parseItemRest(id, title, rest, where, stateIds, idsIn, errors, warnings) {
  const { feature, stage } = splitId(id);
  const it = { id, feature, stage, title, state: "", stateNote: "", parts: [], after: [], feeds: [], with: [], note: [] };
  const parts = rest.split(" · ").map((s) => s.trim()).filter(Boolean);
  const first = parts.shift() || "";
  const sm = first.match(/^([a-z][a-z0-9-]*)(?:\s*\((.*)\))?$/);
  if (!sm || !stateIds.includes(sm[1])) errors.push(`${where}: ${id} has an unknown state "${first}" (one of ${stateIds.join(", ")})`);
  else { it.state = sm[1]; it.stateNote = sm[2] || ""; }
  for (const p of parts) {
    const m = p.match(/^(after|feeds|with)\s+(.*)$/);
    if (m) {
      const ids = idsIn(m[2]);
      if (!ids.length) (m[1] === "after" ? errors : warnings).push(`${where}: ${id} "${m[1]}" names no item: ${p}`);
      it[m[1]].push(...ids);
      continue;
    }
    it.parts.push(p); // a document or free text: resolved against the documents later
  }
  return it;
}
