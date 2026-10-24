// The folder board: one small markdown document per item, plus `_board.md` for what is board-wide.
//
// _board.md:
//   # Title
//   intro lines
//   ## Areas
//   ### CODE — Area title        then its intro lines
//   ## Milestones                in order
//   ### M1 Title — tag           then its description
//   ### Continuous tracks         (optional, always last)
//
// <ID>.md:
//   # ID Title
//   state: ready (qualifier)
//   area: CODE
//   milestone: M1
//   after: A-1 B-2
//   with: C-3
//   docs: a document · another     (links relative to this file)
//   text: free text · more
//   was: OLD-1
//                                  a blank line, then the body: free text (the note)
//
// A dropped item keeps its file: `state: dropped`, the reason in its body.
// Pure: file texts in, { board, errors, warnings } out; and the board out as file texts.
import path from "node:path";
import { compilePatterns, idsIn, parseState, newItem, byId, DROPPED } from "./ids.mjs";

export const BOARD_FILE = "_board.md";
const FIELDS = ["state", "area", "milestone", "after", "with", "docs", "text", "was"];

// files: { "<name>.md": text } of the folder; dir: the folder, repo-relative (for messages, sources and links)
export function readFolder(files, cfg, dir) {
  const P = compilePatterns(cfg);
  const stateIds = cfg.states.map((s) => s.id);
  const errors = [], warnings = [];
  const board = { title: "", intro: [], areas: [], milestones: [], items: {}, dropped: [], base: dir };
  const boardText = files[BOARD_FILE];
  if (boardText === undefined) errors.push(`${dir}/${BOARD_FILE} is missing`);
  else readBoardFile(boardText, `${dir}/${BOARD_FILE}`, P, board, errors, warnings);

  const names = Object.keys(files).filter((f) => f !== BOARD_FILE && f.endsWith(".md")).map((f) => f.slice(0, -3)).sort(byId);
  names.forEach((stem, order) => {
    const rel = `${dir}/${stem}.md`;
    const lines = files[`${stem}.md`].replace(/\r\n/g, "\n").split("\n");
    const head = lines[0].match(P.itemHeader);
    if (!head) { errors.push(`${rel}:1: the first line is "# ID Title" (an ID matching ${cfg.ids.pattern})`); return; }
    if (head[1] !== stem) { errors.push(`${rel}:1: the file holds ${head[1]}; an item's file is named after its ID`); return; }
    const it = newItem(head[1], head[2].trim());
    Object.assign(it, { order, source: rel, line: 1, base: dir });
    let n = 1;
    for (; n < lines.length && lines[n].trim(); n++) {
      const m = lines[n].match(/^([a-z]+):\s?(.*)$/);
      if (!m || !FIELDS.includes(m[1])) { errors.push(`${rel}:${n + 1}: expected "field: value" (one of ${FIELDS.join(", ")}), then a blank line before the body`); continue; }
      const v = m[2].trim();
      if (m[1] === "state") {
        const st = parseState(v);
        if (!st || (st.state !== DROPPED && !stateIds.includes(st.state))) errors.push(`${rel}:${n + 1}: ${it.id} has an unknown state "${v}" (one of ${stateIds.join(", ")}, or ${DROPPED})`);
        else { it.state = st.state; it.stateNote = st.note; }
      } else if (m[1] === "area" || m[1] === "milestone") it[m[1]] = v || null;
      else if (m[1] === "after" || m[1] === "with" || m[1] === "was") {
        const ids = idsIn(P, v);
        if (v && !ids.length) errors.push(`${rel}:${n + 1}: "${m[1]}" names no item: ${v}`);
        it[m[1]].push(...ids);
      } else if (v) {
        const list = v.split(" · ").map((s) => s.trim()).filter(Boolean);
        (it.refs ||= { docs: [], text: [] })[m[1]].push(...list);
        it.parts.push(...list);
      }
    }
    if (!it.state) errors.push(`${rel}: ${it.id} has no state`);
    const body = lines.slice(n).map((l) => l.trim());
    while (body.length && !body[0]) body.shift();
    while (body.length && !body.at(-1)) body.pop();
    if (it.state === DROPPED) { board.dropped.push({ id: it.id, title: it.title, text: body, source: rel, line: 1 }); return; }
    if (!it.area) errors.push(`${rel}: ${it.id} has no area`);
    it.note = body;
    board.items[it.id] = it;
  });
  return { board, errors, warnings };
}

function readBoardFile(text, rel, P, board, errors, warnings) {
  let section = "", cur = null;
  text.replace(/\r\n/g, "\n").split("\n").forEach((line, n) => {
    const where = `${rel}:${n + 1}`;
    if (line.startsWith("# ") && !board.title) { board.title = line.slice(2).trim(); return; }
    if (line.startsWith("## ")) {
      const h = line.slice(3).trim().toLowerCase();
      section = h === "areas" ? "areas" : h === "milestones" ? "milestones" : "other";
      if (section === "other") warnings.push(`${where}: unknown section "${line.slice(3).trim()}" (expected Areas or Milestones)`);
      cur = null;
      return;
    }
    if (section === "areas") {
      if (line.startsWith("### ")) {
        const am = line.match(P.area);
        if (!am) { errors.push(`${where}: an area header is "### CODE — title": ${line}`); cur = null; return; }
        cur = { id: am[1], title: am[2].trim(), intro: [] };
        board.areas.push(cur);
      } else if (cur && line.trim()) cur.intro.push(line.trim());
      return;
    }
    if (section === "milestones") {
      if (line.startsWith("### ")) {
        const mm = line.match(P.milestone);
        if (mm) cur = { id: mm[1], title: mm[2].trim(), tag: (mm[3] || "").trim(), body: [], continuous: false };
        else if (/^### continuous/i.test(line)) cur = { id: "C", title: "Continuous tracks", tag: "", body: [], continuous: true };
        else { errors.push(`${where}: a milestone header is "### M1 Title — tag" or "### Continuous tracks": ${line}`); cur = null; return; }
        if (board.milestones.some((m) => m.id === cur.id)) errors.push(`${where}: milestone ${cur.id} twice`);
        board.milestones.push(cur);
      } else if (cur && line.trim()) cur.body.push(line.trim());
      return;
    }
    if (!section && line.trim()) board.intro.push(line);
  });
  const c = board.milestones.findIndex((m) => m.continuous);
  if (c >= 0 && c !== board.milestones.length - 1) errors.push(`${rel}: Continuous tracks must be the last milestone`);
}

// ---- writing

export function boardFileText(board) {
  const out = [`# ${board.title}`, ""];
  if (board.intro.length) out.push(...board.intro, "");
  out.push("## Areas", "");
  for (const a of board.areas) out.push(`### ${a.id} — ${a.title}`, ...a.intro, "");
  out.push("## Milestones", "");
  for (const m of board.milestones) {
    out.push(m.continuous ? "### Continuous tracks" : `### ${m.id} ${m.title}${m.tag ? " — " + m.tag : ""}`, ...m.body, "");
  }
  return out.join("\n");
}

// it: an item of the model. Its documents and free text are `it.refs` (as read from its file, or split by convert);
// without them every part counts as a document. The order of the lines is fixed.
export function itemFileText(it) {
  const { docs, text } = it.refs || { docs: it.parts, text: [] };
  const out = [`# ${it.id} ${it.title}`, `state: ${it.state}${it.stateNote ? ` (${it.stateNote})` : ""}`];
  if (it.area) out.push(`area: ${it.area}`);
  if (it.milestone) out.push(`milestone: ${it.milestone}`);
  if (it.after.length) out.push(`after: ${it.after.join(" ")}`);
  if (it.with.length) out.push(`with: ${it.with.join(" ")}`);
  if (docs.length) out.push(`docs: ${docs.join(" · ")}`);
  if (text.length) out.push(`text: ${text.join(" · ")}`);
  if (it.was.length) out.push(`was: ${it.was.join(" ")}`);
  if (it.note.length) out.push("", ...it.note);
  return out.join("\n") + "\n";
}

export function droppedFileText(d) {
  return [`# ${d.id} ${d.title}`, `state: ${DROPPED}`, "", ...d.text].join("\n") + "\n";
}

export const itemFileName = (id) => `${id}.md`;
export const dirOf = (rel) => path.posix.dirname(rel);
