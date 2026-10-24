#!/usr/bin/env node
// roadmd: a markdown task board for agentic projects. Node 18+, no dependencies.
//
//   roadmd check                 check the board, write nothing (exit 1 on an error)
//   roadmd build                 check, then write the page (and the review indexes)
//   roadmd next [work]           what can be worked on now; work = a work id from the config, doing, or review
//   roadmd show ID               one item: its state, documents, what it waits for and unblocks
//   roadmd convert [dir]         move a single-file board into a folder of item files (default: roadmap/ beside it)
//   roadmd convert --to-config <file>   copy this board into the storage another config names (e.g. an Encyclist)
//
// Edits (a folder or an Encyclist board; each is checked against the whole board and refused if it adds an error):
//   roadmd set ID state [note]                    roadmd add ID "Title" --area A [--state s] [--milestone M] [--after "X Y"]
//   roadmd edit ID [--title t] [--note n] [--state-note n] [--docs "a · b"] [--text "a · b"]
//   roadmd after ID X -Y   (+X or X adds, -Y removes; also: roadmd with ID …)
//   roadmd move ID [--milestone M|none] [--area A]     roadmd rename OLD NEW     roadmd drop ID "reason"
//   roadmd milestone add|set|move M [--title t] [--tag t] [--body b] [--before M2]     roadmd area add|set A [--title t] [--intro i]
//   --dry-run checks without writing; --owner for an owner-only state (only when the owner says so)
//
//   --config <file>   the project's roadmd.config.json (default: found from the current folder upward)
//   --json            machine-readable output
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findConfig, CONFIG_NAME } from "./lib/config.mjs";
import { loadModel, pageData } from "./lib/model.mjs";
import { toFolder } from "./lib/convert.mjs";
import { openStorage } from "./lib/storage.mjs";
import { loadConfig } from "./lib/config.mjs";
import { applyEdit, EditError } from "./lib/edit.mjs";
import { parseArgs } from "node:util";

const here = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flag = (name) => { const i = argv.indexOf(name); if (i < 0) return null; const v = argv[i + 1]; argv.splice(i, 2); return v; };
const configArg = flag("--config");
const toConfig = flag("--to-config");
const force = argv.includes("--force"); if (force) argv.splice(argv.indexOf("--force"), 1);
const json = argv.includes("--json"); if (json) argv.splice(argv.indexOf("--json"), 1);
if (argv.includes("--check")) { argv.splice(argv.indexOf("--check"), 1); argv.unshift("check"); }
const [cmd = "build", ...args] = argv;

const out = (o) => console.log(JSON.stringify(o, null, 2));
function fail(msg, code = 2) { if (json) out({ ok: false, error: msg }); else console.error(msg); process.exit(code); }

if (["help", "-h", "--help"].includes(cmd)) {
  console.log(fs.readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1, 21).map((l) => l.replace(/^\/\/ ?/, "")).join("\n"));
  process.exit(0);
}
const configFile = configArg ? path.resolve(configArg) : findConfig(process.cwd()) || findConfig(here);
if (!configFile) fail(`no ${CONFIG_NAME} found here or above (or pass --config)`);

let m;
try { m = await loadModel(configFile, { writeIndexes: cmd === "build" }); }
catch (e) { fail(e.message); }
const { cfg, items, errors, warnings } = m;
const counts = Object.fromEntries(cfg.states.map((s) => [s.id, m.all.filter((i) => i.state === s.id).length]));
const msName = (it) => (it.milestone === "C" ? "cont." : it.milestone || "none");

// ---- check / build
if (cmd === "check" || cmd === "build") {
  if (json && cmd === "check") { out({ ok: !errors.length, errors, warnings, items: m.all.length, areas: m.board.areas.length, milestones: m.board.milestones.filter((x) => !x.continuous).length, counts }); process.exit(errors.length ? 1 : 0); }
  for (const w of warnings) console.warn("warning: " + w);
  for (const e of errors) console.error("error: " + e);
  console.log(`${m.all.length} items in ${m.board.areas.length} areas, ${m.board.milestones.filter((x) => !x.continuous).length} milestones; ` + cfg.states.map((s) => `${s.id} ${counts[s.id]}`).join(", "));
  if (errors.length) { console.error(`${errors.length} error(s)`); process.exit(1); }
  if (cmd === "check") { console.log("check passed" + (warnings.length ? ` with ${warnings.length} warning(s)` : "")); process.exit(0); }
  const template = fs.readFileSync(path.join(here, "page", "page.html"), "utf8");
  const generated = new Date().toISOString().slice(0, 10);
  const data = pageData(m, generated);
  const BS = "\\", LS = " ", PS = " ";
  const enc = (o) => JSON.stringify(o).split("</").join("<" + BS + "/").split(LS).join(BS + "u2028").split(PS).join(BS + "u2029");
  const html = template
    .replace("/*__DATA__*/", () => `window.ROADMAP = ${enc(data)};\nwindow.DOCS = ${enc(m.docs)};`)
    .replace(/__TITLE__/g, () => data.title.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])))
    .replace(/__BOARD__/g, () => cfg.board)
    .replace(/__GENERATED__/g, generated);
  const outAbs = path.join(cfg.root, cfg.page);
  fs.mkdirSync(path.dirname(outAbs), { recursive: true });
  fs.writeFileSync(outAbs, html, "utf8");
  console.log(`wrote ${cfg.page} (${(html.length / 1024).toFixed(0)} KB, ${Object.keys(m.docs).length} documents embedded)`);
  process.exit(0);
}

// ---- edits (a board with errors can still be edited: an edit is refused only if it adds one)
const EDITS = ["set", "add", "edit", "after", "with", "move", "rename", "drop", "milestone", "area"];
if (EDITS.includes(cmd)) {
  let p;
  try {
    // after / with take their IDs as written: -X removes, which an option parser would read as an option
    if (cmd === "after" || cmd === "with") p = { values: { "dry-run": args.includes("--dry-run") }, positionals: args.filter((x) => x !== "--dry-run") };
    else p = parseArgs({ args, allowPositionals: true, strict: true, options: {
      title: { type: "string" }, note: { type: "string" }, "state-note": { type: "string" }, state: { type: "string" },
      area: { type: "string" }, milestone: { type: "string" }, after: { type: "string" }, with: { type: "string" },
      docs: { type: "string" }, text: { type: "string" }, tag: { type: "string" }, body: { type: "string" }, intro: { type: "string" },
      before: { type: "string" }, owner: { type: "boolean" }, "dry-run": { type: "boolean" },
    } });
  } catch (e) { fail(`${cmd}: ${e.message} (roadmd help)`); }
  const o = p.values, pos = p.positionals;
  const ids = (v) => (v ? v.split(/[\s,]+/).filter(Boolean) : undefined);
  const list = (v) => (v === undefined ? undefined : v.split(" · ").map((x) => x.trim()).filter(Boolean));
  const need = (n, usage) => { if (pos.length < n) fail(`usage: roadmd ${usage}`); };
  let e;
  if (cmd === "set") { need(2, "set ID state [note]"); e = { op: "set", id: pos[0], state: pos[1], note: pos.slice(2).join(" ") || o.note, owner: o.owner }; }
  else if (cmd === "add") { need(2, 'add ID "Title" --area A'); e = { op: "add", id: pos[0], title: pos.slice(1).join(" "), area: o.area, state: o.state, milestone: o.milestone, after: ids(o.after), with: ids(o.with), docs: list(o.docs), text: list(o.text), note: o.note, owner: o.owner }; }
  else if (cmd === "edit") { need(1, "edit ID [--title …] [--note …]"); e = { op: "edit", id: pos[0], title: o.title, note: o.note, stateNote: o["state-note"], docs: list(o.docs), text: list(o.text) }; }
  else if (cmd === "after" || cmd === "with") {
    need(2, `${cmd} ID X -Y`);
    const rest = pos.slice(1);
    e = { op: "deps", id: pos[0], list: cmd, add: rest.filter((x) => !x.startsWith("-")).map((x) => x.replace(/^\+/, "")), remove: rest.filter((x) => x.startsWith("-")).map((x) => x.slice(1)) };
  }
  else if (cmd === "move") { need(1, "move ID [--milestone M|none] [--area A]"); e = { op: "move", id: pos[0], milestone: o.milestone === undefined ? undefined : o.milestone === "none" ? null : o.milestone, area: o.area }; }
  else if (cmd === "rename") { need(2, "rename OLD NEW"); e = { op: "rename", id: pos[0], to: pos[1] }; }
  else if (cmd === "drop") { need(2, 'drop ID "reason"'); e = { op: "drop", id: pos[0], reason: pos.slice(1).join(" ") }; }
  else if (cmd === "milestone") { need(2, "milestone add|set|move M …"); if (!["add", "set", "move"].includes(pos[0])) fail("usage: roadmd milestone add|set|move M …"); e = { op: `milestone-${pos[0]}`, id: pos[1], title: o.title ?? (pos.length > 2 ? pos.slice(2).join(" ") : undefined), tag: o.tag, body: o.body, before: o.before }; }
  else if (cmd === "area") { need(2, "area add|set A …"); if (!["add", "set"].includes(pos[0])) fail("usage: roadmd area add|set A …"); e = { op: `area-${pos[0]}`, id: pos[1], title: o.title ?? (pos.length > 2 ? pos.slice(2).join(" ") : undefined), intro: o.intro }; }
  try {
    const r = await applyEdit(m, e, { dryRun: !!o["dry-run"] });
    if (json) out({ ok: true, ...r });
    else console.log((r.written ? "" : "would do (dry run): ") + r.summary);
    process.exit(0);
  } catch (err) {
    if (!(err instanceof EditError)) throw err;
    if (json) { out({ ok: false, error: err.message, errors: err.errors }); process.exit(1); }
    console.error(err.message);
    for (const x of err.errors) console.error("  error: " + x);
    process.exit(1);
  }
}

if (errors.length) {
  if (json) { out({ ok: false, errors, warnings }); process.exit(1); }
  for (const e of errors) console.error("error: " + e);
  console.error(`${errors.length} error(s): fix the board first (roadmd check)`);
  process.exit(1);
}

// ---- convert
if (cmd === "convert") {
  let target, where, linkDir;
  if (toConfig) {
    const tc = loadConfig(path.resolve(toConfig));
    target = openStorage(tc);
    where = target.path;
    linkDir = tc.storage.type === "folder" ? tc.storage.path : (tc.storage.base ?? m.board.base ?? "");
  } else {
    if (m.storage.type !== "file") fail(`convert [dir] moves a single-file board into a folder; this board is already a ${m.storage.type} (copy it elsewhere with --to-config)`);
    const given = args.find((a) => !a.startsWith("--"));
    linkDir = (given || path.posix.join(path.posix.dirname(cfg.storage.path), "roadmap")).replace(/\\/g, "/").replace(/\/$/, "");
    target = openStorage({ ...cfg, storage: { type: "folder", path: linkDir } });
    where = linkDir + "/";
  }
  const notes = [];
  const { board } = toFolder(m.board, cfg, m.resolveRef, linkDir, (w) => notes.push(w));
  try { await target.writeAll(board, { force }); } catch (e) { fail(e.message); }
  const n = Object.keys(board.items).length, d = board.dropped.length;
  if (json) { out({ ok: true, to: where, items: n, dropped: d, notes }); process.exit(0); }
  for (const w of notes) console.warn("note: " + w);
  console.log(`wrote ${where}: the board, ${n} items, ${d} dropped`);
  if (!toConfig) console.log(`next: set "storage": { "type": "folder", "path": "${linkDir}" } in ${path.relative(process.cwd(), cfg.file) || cfg.file}, run roadmd check, then remove ${cfg.storage.path}`);
  process.exit(0);
}

// ---- next
if (cmd === "next") {
  const mode = args[0] || "all";
  const works = m.works;
  const reviewKinds = cfg.docKinds.filter((k) => k.review);
  const toReview = Object.entries(m.reviews).filter(([p, r]) => !reviewKinds.find((k) => k.id === r.kind).review.states.find((s) => s.id === r.state)?.ok);
  const modes = ["all", "doing", "review", ...works.map((w) => w.id)];
  if (!modes.includes(mode)) fail(`unknown "${mode}": next [${modes.join("|")}]`);
  const row = (id) => { const it = items[id]; return { id, title: it.title, state: it.state, stateNote: it.stateNote, milestone: it.milestone, immediate: it.immediate, total: it.total, waitingFor: it.waitingFor }; };
  const sections = [];
  const add = (id, title, lead, ids) => sections.push({ id, title, lead: lead.replace(/{count}/g, ids.length).replace(/{open}/g, m.open.length), items: ids.map(row) });
  if (mode === "review") {
    if (json) { out({ ok: true, reviews: toReview.map(([p, r]) => ({ path: p, ...r })) }); process.exit(0); }
    for (const k of reviewKinds) {
      const list = toReview.filter(([, r]) => r.kind === k.id), total = Object.values(m.reviews).filter((r) => r.kind === k.id).length;
      console.log(`\n${(k.review.overview?.label || `${k.label} to review`).toUpperCase()} (${list.length} of ${total})`);
      if (!list.length) console.log("  (nothing)");
      for (const [p, r] of list) console.log(`  ${path.posix.basename(p, ".md").padEnd(24)} ${r.text}`);
    }
    process.exit(0);
  }
  for (const entry of cfg.overview) {
    if (entry === "reviews") continue;
    if (entry === "inProgress") { if (mode === "all" || mode === "doing") add("doing", cfg.inProgress.label, "", m.lists.inProgress); continue; }
    if (entry === "next") { if (mode === "all") for (const n of m.next) { const w = works.find((x) => x.id === n.work); add("next:" + w.id, w.next, `the ${cfg.nextSize} with the biggest impact`, n.ids); } continue; }
    if (mode !== "all" && mode !== entry) continue;
    const w = works.find((x) => x.id === entry);
    add(w.id, w.label, w.lead || "", m.lists[w.id]);
    if (w.waiting && m.lists[w.id + ":waiting"].length) add(w.id + ":waiting", w.waiting.label, w.waiting.lead || "", m.lists[w.id + ":waiting"]);
  }
  if (json) { out({ ok: true, sections, toReview: toReview.length, open: m.open.length, items: m.all.length }); process.exit(0); }
  const impact = (r) => `unblocks ${String(r.immediate).padStart(2)} now, ${String(r.total).padStart(2)} in all`;
  for (const s of sections) {
    console.log(s.lead ? `\n${s.title.toUpperCase()} — ${s.lead}` : `\n${s.title.toUpperCase()}`);
    if (!s.items.length) console.log("  (nothing)");
    for (const r of s.items) {
      const extra = s.id === "doing" ? r.state : s.id.endsWith(":waiting") ? "waits for " + r.waitingFor.join(", ") : "";
      console.log(`  ${r.id.padEnd(14)} ${r.title.padEnd(56).slice(0, 56)} ${msName(r).padEnd(5)} ${impact(r)}${extra ? "  " + extra : ""}`);
    }
  }
  if (mode === "all" && reviewKinds.length) console.log(`\nTO REVIEW — ${toReview.length} of ${Object.keys(m.reviews).length} not approved: \`roadmd next review\` lists them`);
  console.log(`\n${m.open.length} open of ${m.all.length}; "unblocks N now" counts the open items that wait for it directly, "M in all" every open item downstream.`);
  process.exit(0);
}

// ---- show
if (cmd === "show") {
  const it = items[args[0]];
  if (!it) fail(`no item ${args[0]}` + (m.board.dropped.some((d) => d.id === args[0]) ? " (it is dropped)" : ""));
  const final = (id) => m.state[items[id]?.state]?.final;
  const up = []; const seen = new Set();
  (function visit(x) { for (const d of items[x].after) { if (!items[d] || seen.has(d)) continue; seen.add(d); visit(d); up.push(d); } })(it.id);
  const o = {
    id: it.id, title: it.title, state: it.state, stateNote: it.stateNote, area: it.area, milestone: it.milestone, work: it.work,
    docs: it.itemDocs, links: it.links.map((r) => ({ text: r.text, doc: r.doc, anchor: r.anchor || null })), text: it.text, note: it.note,
    after: it.after, with: it.with, waitingFor: it.waitingFor, neededFirst: up.filter((d) => !final(d)), unblocks: it.unblocks,
    stages: m.all.filter((x) => x.feature === it.feature).sort((a, b) => a.stage - b.stage).map((x) => `${x.id} ${x.state}`),
    line: it.source ? `${it.source}:${it.line}` : null, was: it.was,
  };
  if (json) { out(o); process.exit(0); }
  const L = (k, v) => console.log(`${k.padEnd(13)}${Array.isArray(v) ? (v.length ? v.join(", ") : "-") : v || "-"}`);
  console.log(`${it.id} ${it.title}`);
  L("state", it.state + (it.stateNote ? ` (${it.stateNote})` : ""));
  L("can do now", it.work === "inProgress" ? "in progress" : it.work ? m.works.find((w) => w.id === it.work).label : it.waitingFor.length ? "waits for " + it.waitingFor.join(", ") : "-");
  L("area", it.area); L("milestone", it.milestone || "none");
  for (const [k, p] of Object.entries(it.itemDocs)) L(k, p + (m.reviews[p] ? ` [${m.reviews[p].text}]` : ""));
  L("documents", o.links.map((r) => r.doc ? `${r.doc}${r.anchor ? " #" + r.anchor : ""}` : r.text));
  if (it.text.length) L("text", it.text.join(" · "));
  L("waits for", it.after); if (it.with.length) L("with", it.with);
  if (it.was.length) L("was", it.was);
  L("needed first", o.neededFirst); L("unblocks", it.unblocks); L("stages", o.stages); L("line", o.line);
  if (it.note.length) console.log("\n" + it.note.join("\n"));
  process.exit(0);
}

fail(`unknown command "${cmd}" (roadmd help)`);
