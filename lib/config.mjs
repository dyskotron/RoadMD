// roadmd.config.json: everything about a project's process. Paths in it are relative to the file's folder (the root).
import fs from "node:fs";
import path from "node:path";

export const CONFIG_NAME = "roadmd.config.json";

// The config next to the given path or in a folder above it.
export function findConfig(start) {
  let dir = path.resolve(start);
  for (;;) {
    const p = path.join(dir, CONFIG_NAME);
    if (fs.existsSync(p)) return p;
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

const STATE_ID = /^[a-z][a-z0-9-]*$/;

export function loadConfig(file) {
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  const root = path.dirname(path.resolve(file));
  const problems = [];
  const c = {
    root,
    file: path.resolve(file),
    title: raw.title || "",
    owner: raw.owner || "the owner",
    storage: raw.storage || { type: "file", path: raw.board || "ROADMAP.md" },
    page: raw.page || "roadmap.html",
    nextSize: raw.nextSize ?? 5,
    ids: { pattern: "[A-Z]{2,12}-\\d+", unordered: [], ...raw.ids },
    areas: { pattern: "[A-Z]{2,5}", ...raw.areas },
    milestones: { pattern: "M\\d+", ...raw.milestones },
    docs: { include: ["**/*.md"], names: {}, stemSuffixes: [], minStemLength: 6, anchors: [{ pattern: "\\*([^*]+)\\*", anchor: "$1" }], ...raw.docs },
    docKinds: raw.docKinds || [{ id: "docs", label: "Documents", lead: "", match: ["**"] }],
    linkedDocsLabel: raw.linkedDocsLabel || "Documents",
    states: raw.states,
    inProgress: { label: "In progress", ...raw.inProgress },
    overview: raw.overview,
    next: raw.next,
    boardOrder: raw.boardOrder,
  };

  const st = c.storage;
  if (st.type === "encyclist") { if (!st.url || !st.keyEnv) problems.push(`storage: an Encyclist board needs "url" (its MCP endpoint) and "keyEnv" (the variable holding its API key)`); }
  else if (!["file", "folder"].includes(st.type) || !st.path) problems.push(`storage: { "type": "file" | "folder", "path": "..." } or { "type": "encyclist", "url": "...", "keyEnv": "..." } (got ${JSON.stringify(st)})`);
  if (st.key || st.apiKey) problems.push(`storage: never put the API key in the config: name its environment variable in "keyEnv"`);
  c.board = st.path || st.url; // where the board is, for messages
  if (!Array.isArray(c.states) || !c.states.length) problems.push("states: a list of states in pipeline order is required");
  const ids = new Set();
  for (const s of c.states || []) {
    if (!STATE_ID.test(s.id || "")) problems.push(`states: "${s.id}" is not a valid state id (lower case, digits, dashes)`);
    if (s.id === "dropped") problems.push(`states: "dropped" is reserved for dropped items`);
    if (ids.has(s.id)) problems.push(`states: "${s.id}" twice`);
    ids.add(s.id);
  }
  const works = new Map();
  for (const s of c.states || []) {
    for (const key of ["earlierStages"]) if (s[key] && !ids.has(s[key])) problems.push(`states.${s.id}.${key}: unknown state "${s[key]}"`);
    if (s.work) {
      if (!s.work.id) problems.push(`states.${s.id}.work: needs an id`);
      if (works.has(s.work.id)) problems.push(`states.${s.id}.work: id "${s.work.id}" is used by ${works.get(s.work.id)} too`);
      works.set(s.work.id, s.id);
      if (s.work.needs && !ids.has(s.work.needs)) problems.push(`states.${s.id}.work.needs: unknown state "${s.work.needs}"`);
      s.work.label ||= s.work.id;
      s.work.next ||= `Next: ${s.work.label}`;
    }
    for (const r of s.requires || []) if (!c.docKinds.some((k) => k.id === r.docKind)) problems.push(`states.${s.id}.requires: unknown doc kind "${r.docKind}"`);
  }
  if (!c.states?.some((s) => s.final)) problems.push("states: one state must be final (\"final\": true)");
  const workIds = [...works.keys()];
  c.next ||= workIds.filter((w) => c.states.find((s) => s.work?.id === w)?.work.needs).reverse();
  c.overview ||= [...workIds.filter((w) => !c.next.includes(w)), "inProgress", "next", ...c.next, "reviews"];
  c.boardOrder ||= [...c.states.filter((s) => !s.final).map((s) => s.id).reverse(), ...c.states.filter((s) => s.final).map((s) => s.id)];
  for (const w of [...c.next, ...c.overview]) if (!["inProgress", "next", "reviews", ...workIds].includes(w)) problems.push(`overview/next: unknown entry "${w}"`);
  for (const s of c.boardOrder) if (!ids.has(s)) problems.push(`boardOrder: unknown state "${s}"`);
  // a pattern holding a control character: JSON read "\b" (meant "\\b", a word boundary) as a backspace
  const pattern = (where, p) => { if (p && /[\x00-\x1f]/.test(p)) problems.push(`${where}: the pattern holds a control character: write a regex backslash as "\\\\" in JSON (e.g. "\\\\b")`); };
  for (const a of c.docs.anchors) pattern("docs.anchors", a.pattern);
  for (const k of c.docKinds) {
    if (k.review) { pattern(`docKinds.${k.id}.review.line`, k.review.line); for (const s of k.review.states || []) pattern(`docKinds.${k.id}.review.states.${s.id}`, s.match); }
  }
  for (const k of c.docKinds) {
    if (!k.id || !k.match) problems.push(`docKinds: every kind needs an id and match`);
    k.match = [].concat(k.match);
    if (k.review) k.review.files = [].concat(k.review.files || k.match);
  }
  if (problems.length) throw new Error(`${path.relative(process.cwd(), file) || file}:\n  ` + problems.join("\n  "));
  return c;
}
