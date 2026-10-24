// roadmd's MCP: the board's tools for agents, over Streamable HTTP (stateless JSON-RPC POSTs at /mcp), no SDK.
// lib/server.mjs mounts it. Each agent has a key (ROADMD_KEYS: [{ "name", "key", "role": "owner" | "editor" | "reader" }],
// sent as X-API-Key or "Authorization: Bearer"); without ROADMD_KEYS the MCP is closed. Readers read; editors edit;
// only owners set an owner-only state (the config's `ownerOnly`, e.g. done): decision 7, enforced.
//
// Every edit goes through lib/edit.mjs (applied to a copy, the whole board checked, refused when it adds an error), on
// a board read fresh for it; edits on one server run one at a time.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { applyEdit, EditError } from "./edit.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const PROTOCOL = "2025-03-26";

export function parseKeys(text) {
  if (!text) return [];
  let keys;
  try { keys = JSON.parse(text); } catch (e) { throw new Error(`ROADMD_KEYS isn't valid JSON: ${e.message}`); }
  if (!Array.isArray(keys)) throw new Error("ROADMD_KEYS is a list: [{ \"name\", \"key\", \"role\" }]");
  return keys.map((k) => {
    if (!k.name || !k.key) throw new Error("every ROADMD_KEYS entry needs a name and a key");
    if (!["owner", "editor", "reader"].includes(k.role || "editor")) throw new Error(`${k.name}: role is owner, editor or reader`);
    return { name: k.name, role: k.role || "editor", hash: crypto.createHash("sha256").update(k.key).digest() };
  });
}

export function mcpHandler({ model, invalidate, keys }) {
  let queue = Promise.resolve(); // edits one at a time
  const serial = (fn) => { const run = queue.then(fn, fn); queue = run.catch(() => {}); return run; };

  function who(req) {
    const h = req.headers;
    const given = h["x-api-key"] || (/^Bearer\s+(.+)$/i.exec(h.authorization || "") || [])[1];
    if (!given) return null;
    const hash = crypto.createHash("sha256").update(given).digest();
    return keys.find((k) => crypto.timingSafeEqual(k.hash, hash)) || null;
  }

  const tools = defineTools();

  return async function handle(req, res, body) {
    const reply = (status, obj) => { res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" }); res.end(obj === undefined ? "" : JSON.stringify(obj)); };
    if (!keys.length) return reply(401, { error: "roadmd's MCP is closed: the server has no ROADMD_KEYS" });
    const caller = who(req);
    if (!caller) return reply(401, { error: "unauthorised: send your roadmd key as X-API-Key (or Authorization: Bearer)" });
    if (req.method !== "POST") return reply(405, { error: "POST JSON-RPC to /mcp" });
    let msg;
    try { msg = JSON.parse(body); } catch { return reply(400, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } }); }
    const answer = async (m) => {
      if (m.id === undefined) return null; // a notification
      const ok = (result) => ({ jsonrpc: "2.0", id: m.id, result });
      const fail = (code, message) => ({ jsonrpc: "2.0", id: m.id, error: { code, message } });
      if (m.method === "initialize") return ok({ protocolVersion: PROTOCOL, capabilities: { tools: { listChanged: false } }, serverInfo: { name: "roadmd", version: "0.3" }, instructions: INSTRUCTIONS });
      if (m.method === "ping") return ok({});
      if (m.method === "tools/list") return ok({ tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
      if (m.method === "tools/call") {
        const t = tools.find((x) => x.name === m.params?.name);
        if (!t) return fail(-32602, `no tool ${m.params?.name}`);
        try {
          if (t.edits && caller.role === "reader") throw new EditError(`${caller.name} is a reader: roadmd keys with the editor or owner role edit`);
          const value = t.edits
            ? await serial(async () => { const r = await t.run(m.params.arguments || {}, { caller, m: await model(true) }); invalidate(); return r; })
            : await t.run(m.params.arguments || {}, { caller, m: await model(false) });
          return ok({ content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 1) }], ...(typeof value === "object" ? { structuredContent: value } : {}), isError: false });
        } catch (e) {
          const text = e instanceof EditError ? [e.message, ...e.errors.map((x) => "- " + x)].join("\n") : `error: ${e.message}`;
          return ok({ content: [{ type: "text", text }], isError: true });
        }
      }
      return fail(-32601, `no method ${m.method}`);
    };
    if (Array.isArray(msg)) { const out = (await Promise.all(msg.map(answer))).filter(Boolean); return out.length ? reply(200, out) : reply(202); }
    const out = await answer(msg);
    return out ? reply(200, out) : reply(202);
  };
}

const INSTRUCTIONS = `roadmd: this project's roadmap board. Call roadmap_guide first: it explains the project's process (its states and what each needs), the ID and milestone rules, and how to start a board from the project's documents. Read the documents with roadmap_docs_list and roadmap_doc_read. Every edit is checked against the whole board and refused, with the reasons, when it would break it; fix and try again. Never set an owner-only state unless your key's role is owner and the owner said so.`;

// ---- the tools
const S = (props, required = []) => ({ type: "object", properties: props, required, additionalProperties: false });
const str = (description) => ({ type: "string", description });
const strs = (description) => ({ type: "array", items: { type: "string" }, description });

function defineTools() {
  const edit = (name, description, inputSchema, toEdit) => ({ name, description, inputSchema, edits: true,
    async run(args, { caller, m }) {
      const r = await applyEdit(m, toEdit(args, caller), { dryRun: !!args.dry_run });
      return { ok: true, summary: (r.written ? "" : "would do (dry run): ") + r.summary, changed: r.changed, dropped: r.dropped, written: r.written };
    } });
  const dry = { dry_run: { type: "boolean", description: "check the edit without writing it" } };
  return [
    { name: "roadmap_guide", description: "How this board works: the project's process (states, what each needs, which are owner-only), the ID, milestone and dependency rules, the formats, and the procedure for starting a board from the project's documents. Read this first.",
      inputSchema: S({}), run: async (_, { m }) => guide(m) },
    { name: "roadmap_whoami", description: "Your key's name and role (owner, editor, reader).", inputSchema: S({}), run: async (_, { caller }) => ({ name: caller.name, role: caller.role }) },
    { name: "roadmap_check", description: "Check the board: its errors and warnings.", inputSchema: S({}), run: async (_, { m }) => ({ ok: !m.errors.length, errors: m.errors, warnings: m.warnings }) },
    { name: "roadmap_board", description: "The whole board: areas, milestones (in order), every item (id, title, state, area, milestone, after, with, documents, note) and what is dropped.",
      inputSchema: S({}), run: async (_, { m }) => boardJson(m) },
    { name: "roadmap_next", description: "What can be worked on now, ranked: in progress, Next per kind of work, and every list of the project's process (e.g. to design, to build) with what each waiting item waits for.",
      inputSchema: S({ work: str("one kind of work (a work id from roadmap_guide), or omit for all") }), run: async (a, { m }) => nextJson(m, a.work) },
    { name: "roadmap_show", description: "One item in full: state, area, milestone, documents, dependencies, what it waits for, what it unblocks, its feature's stages.",
      inputSchema: S({ id: str("the item's ID, e.g. CAPTURE-1") }, ["id"]), run: async (a, { m }) => showJson(m, a.id) },
    { name: "roadmap_docs_list", description: "The project's documents: id, title, tags (from the knowledge base or the files the config embeds).",
      inputSchema: S({}), run: async (_, { m }) => Object.keys(m.docs).map((id) => ({ id, title: m.docMeta?.[id]?.title || id, tags: m.docMeta?.[id]?.tags || [], size: m.docs[id].length })) },
    { name: "roadmap_doc_read", description: "One document's full text, by its id or exact title (from roadmap_docs_list).",
      inputSchema: S({ id: str("a document's id or exact title") }, ["id"]),
      run: async (a, { m }) => {
        const id = m.docs[a.id] !== undefined ? a.id : Object.keys(m.docMeta || {}).find((k) => m.docMeta[k].title === a.id);
        if (!id) throw new Error(`no document "${a.id}": roadmap_docs_list lists them`);
        return { id, title: m.docMeta?.[id]?.title || id, tags: m.docMeta?.[id]?.tags || [], content: m.docs[id] };
      } },
    { name: "roadmap_init", description: "Start an empty board where there is none yet (a new project): its title and an intro. Then add areas, milestones and items.",
      inputSchema: S({ title: str("the board's title, e.g. 'Creaturist roadmap'"), intro: str("one paragraph: what the board covers") }, ["title"]), edits: true,
      async run(a, { m }) {
        if (Object.keys(m.board.items).length || m.board.areas.length || m.board.milestones.length) throw new EditError("this board already exists");
        if (!m.storage.writable) throw new EditError(`the board is a ${m.storage.type}, which roadmd only reads`);
        await m.storage.writeAll({ title: a.title, intro: a.intro ? String(a.intro).split("\n") : [], areas: [], milestones: [], items: {}, dropped: [], base: m.board.base });
        return { ok: true, summary: `board "${a.title}" started: add areas (roadmap_area), milestones (roadmap_milestone), then items (roadmap_add_item)` };
      } },
    edit("roadmap_area", "Add an area (a row of the board: a big part of the project, a short code) or change its title or intro.",
      S({ action: { type: "string", enum: ["add", "set"] }, code: str("the area's code (the config's pattern, e.g. 2-5 capital letters)"), title: str("its title"), intro: str("a line on what it holds"), ...dry }, ["action", "code"]),
      (a) => ({ op: `area-${a.action}`, id: a.code, title: a.title, intro: a.intro })),
    edit("roadmap_milestone", "Add a milestone (a vertical slice someone can use or play; milestones are in order), change its title, tag or description, or move it before another.",
      S({ action: { type: "string", enum: ["add", "set", "move"] }, id: str("its ID (the config's pattern, e.g. M1)"), title: str("its title"), tag: str("a short tag, e.g. 'done'"), body: str("what the slice is"), before: str("place it before this milestone (add, move); omit: last, before the continuous track"), ...dry }, ["action", "id"]),
      (a) => ({ op: `milestone-${a.action}`, id: a.id, title: a.title, tag: a.tag, body: a.body, before: a.before })),
    edit("roadmap_add_item", "Add an item: one deliverable stage of a feature (ID FEATURE-n, n its build order).",
      S({ id: str("FEATURE-n"), title: str("short, in the project's words"), area: str("its area's code"), state: str("its state (default: the first state of the process)"), milestone: str("its milestone, if any"),
        after: strs("IDs it waits for (only what must exist first)"), with: strs("IDs built together with it"), docs: strs("documents describing it: exact titles or ids, optionally followed by a section in *italics*"), text: strs("other short facts"), note: str("its note: what it is, and the evidence for its state"), ...dry }, ["id", "title", "area"]),
      (a, caller) => ({ op: "add", id: a.id, title: a.title, area: a.area, state: a.state, milestone: a.milestone, after: a.after, with: a.with, docs: a.docs, text: a.text, note: a.note, owner: caller.role === "owner" })),
    edit("roadmap_edit_item", "Change an item's title, note, state note, documents or other facts (only the fields given).",
      S({ id: str("the item's ID"), title: str("new title"), note: str("new note (replaces it)"), state_note: str("new state qualifier"), docs: strs("its documents (replaces the list)"), text: strs("its other facts (replaces the list)"), ...dry }, ["id"]),
      (a) => ({ op: "edit", id: a.id, title: a.title, note: a.note, stateNote: a.state_note, docs: a.docs, text: a.text })),
    edit("roadmap_set_state", "Set an item's state (and an optional qualifier note). Owner-only states need an owner key and the owner's word.",
      S({ id: str("the item's ID"), state: str("the new state"), note: str("a short qualifier, e.g. 'parked: waiting for the audio tests'"), ...dry }, ["id", "state"]),
      (a, caller) => ({ op: "set", id: a.id, state: a.state, note: a.note, owner: caller.role === "owner" })),
    edit("roadmap_deps", "Add or remove what an item waits for (after) or is built with (with).",
      S({ id: str("the item's ID"), list: { type: "string", enum: ["after", "with"] }, add: strs("IDs to add"), remove: strs("IDs to remove"), ...dry }, ["id", "list"]),
      (a) => ({ op: "deps", id: a.id, list: a.list, add: a.add, remove: a.remove })),
    edit("roadmap_move", "Move an item to another milestone (or none) or area (every stage of its feature moves with it).",
      S({ id: str("the item's ID"), milestone: str("the milestone, or 'none'"), area: str("the area's code"), ...dry }, ["id"]),
      (a) => ({ op: "move", id: a.id, milestone: a.milestone === undefined ? undefined : a.milestone === "none" ? null : a.milestone, area: a.area })),
    edit("roadmap_rename", "Rename an item (e.g. to fix the build order of a feature's stages); every reference follows and it remembers its old ID.",
      S({ id: str("its ID now"), to: str("its new ID"), ...dry }, ["id", "to"]), (a) => ({ op: "rename", id: a.id, to: a.to })),
    edit("roadmap_drop", "Drop an item, with the reason (it keeps its record; its ID is never reused). Refused while anything still waits for it.",
      S({ id: str("the item's ID"), reason: str("why it is dropped"), ...dry }, ["id", "reason"]), (a) => ({ op: "drop", id: a.id, reason: a.reason })),
  ];
}

function guide(m) {
  const { cfg } = m;
  let procedure = "";
  try { procedure = fs.readFileSync(path.join(here, "..", "bootstrap", "PROCEDURE.md"), "utf8"); } catch {}
  return {
    project: cfg.title || m.board.title, owner: cfg.owner,
    process: cfg.states.map((s) => ({ state: s.id, meaning: s.meaning || "", ...(s.active ? { inProgress: true } : {}), ...(s.final ? { final: true } : {}), ...(s.ownerOnly ? { ownerOnly: true } : {}),
      ...(s.work ? { work: s.work.id, workLabel: s.work.label, canStartWhenDependenciesAreAtLeast: s.work.needs || null } : {}), ...(s.earlierStages ? { earlierStagesMustBeAtLeast: s.earlierStages } : {}) })),
    ids: { pattern: cfg.ids.pattern, rule: "FEATURE-n: one capitalised word per feature, n its build order (stage n waits for stage n-1 automatically); stage 1 is the smallest thing others can build on; an ID is never reused", fixedFrom: cfg.ids.fixedFrom || null, unordered: cfg.ids.unordered },
    areas: { pattern: cfg.areas.pattern, rule: "an area is a row of the board: a big part of the project; every stage of a feature sits in one area" },
    milestones: { pattern: cfg.milestones.pattern, rule: "vertical slices someone can use or play, in order; not dates; nothing may wait for something in a later milestone" },
    dependencies: "after = waits for (only what must exist first); with = built together; no cycles",
    documents: m.cfg.docs.source === "encyclist" ? "name a document by its exact title (or id), optionally followed by a section in *italics*; roadmd links the item to it in the knowledge base" : "name a document by its path or file name, optionally followed by a section in *italics*",
    startingABoard: procedure,
  };
}

function boardJson(m) {
  const items = Object.values(m.board.items).sort((a, b) => a.order - b.order).map((it) => ({
    id: it.id, title: it.title, state: it.state, ...(it.stateNote ? { stateNote: it.stateNote } : {}), area: it.area, milestone: it.milestone,
    after: it.after, with: it.with, docs: (it.refs || { docs: it.parts }).docs, text: (it.refs || { text: [] }).text, note: it.note.join("\n"), was: it.was,
  }));
  return { title: m.board.title, intro: m.board.intro.join("\n"), areas: m.board.areas.map((a) => ({ code: a.id, title: a.title, intro: a.intro.join("\n") })),
    milestones: m.board.milestones.map((x) => ({ id: x.id, title: x.title, tag: x.tag, body: x.body.join("\n"), continuous: !!x.continuous })),
    items, dropped: m.board.dropped.map((d) => ({ id: d.id, title: d.title, reason: d.text.join("\n") })), errors: m.errors };
}

function showJson(m, id) {
  const it = m.items[id];
  if (!it) throw new Error(m.board.dropped.some((d) => d.id === id) ? `${id} is dropped` : `no item ${id}`);
  const final = (x) => m.state[m.items[x]?.state]?.final;
  const up = [], seen = new Set();
  (function visit(x) { for (const d of m.items[x].after) { if (!m.items[d] || seen.has(d)) continue; seen.add(d); visit(d); up.push(d); } })(id);
  return { id, title: it.title, state: it.state, stateNote: it.stateNote, area: it.area, milestone: it.milestone, canBeWorkedOnAs: it.work, waitingFor: it.waitingFor,
    documents: it.links.map((r) => ({ text: r.text, doc: r.doc, section: r.anchor || null })), text: it.text, note: it.note.join("\n"), after: it.after, with: it.with,
    neededFirst: up.filter((d) => !final(d)), unblocks: it.unblocks, stages: m.all.filter((x) => x.feature === it.feature).sort((a, b) => a.stage - b.stage).map((x) => `${x.id} ${x.state}`), was: it.was };
}

export function nextJson(m, only) {
  const row = (id) => { const it = m.items[id]; return { id, title: it.title, state: it.state, milestone: it.milestone, unblocksNow: it.immediate, unblocksInAll: it.total, ...(it.waitingFor.length ? { waitingFor: it.waitingFor } : {}) }; };
  const sections = [];
  for (const entry of m.cfg.overview) {
    if (entry === "reviews") continue;
    if (entry === "inProgress") { if (!only || only === "doing") sections.push({ id: "doing", title: m.cfg.inProgress.label, items: m.lists.inProgress.map(row) }); continue; }
    if (entry === "next") { if (!only) for (const n of m.next) { const w = m.works.find((x) => x.id === n.work); sections.push({ id: "next:" + w.id, title: w.next, items: n.ids.map(row) }); } continue; }
    if (only && only !== entry) continue;
    const w = m.works.find((x) => x.id === entry);
    sections.push({ id: w.id, title: w.label, items: m.lists[w.id].map(row) });
    if (w.waiting && m.lists[w.id + ":waiting"].length) sections.push({ id: w.id + ":waiting", title: w.waiting.label, items: m.lists[w.id + ":waiting"].map(row) });
  }
  return { ok: !m.errors.length, sections, open: m.open.length, items: m.all.length };
}
