// The Encyclist adapter: the board as entities of an Encyclist knowledge base (github.com/hex-clawd/encyclist), talked
// to over MCP (lib/mcp.mjs). SPEC.md decision 16.
//
//   storage: { "type": "encyclist", "url": "https://…/mcp", "keyEnv": "ENCYCLIST_KEY",
//              "envFile": ".env" (optional: where keyEnv may be set), "typePrefix": "roadmap" (optional),
//              "base": "docs/roadmap" (optional: the folder items' relative links are relative to) }
//
// Entity types (defined on the first write, `<prefix>_…`):
//   _board      key "board", title, intro
//   _area       key, title, intro, order
//   _milestone  key, title, tag, body, order, continuous
//   _item       key, title, state, state_note, area, milestone, after, with, docs, text, was, body
// One record per item: an edit changes only that record (ec_entity_update names the fields it changes), so two people
// or agents editing different items never collide. A dropped item keeps its record with state "dropped".
import fs from "node:fs";
import path from "node:path";
import { mcpClient } from "./mcp.mjs";
import { newItem, byId, DROPPED } from "./ids.mjs";

const TYPES = {
  board: { key: ["string", true], title: ["string", false], intro: ["text", false] },
  area: { key: ["string", true], title: ["string", false], intro: ["text", false], order: ["int", true] },
  milestone: { key: ["string", true], title: ["string", false], tag: ["string", false], body: ["text", false], order: ["int", true], continuous: ["bool", false] },
  item: {
    key: ["string", true], title: ["string", true], state: ["string", true], state_note: ["string", false],
    area: ["string", false], milestone: ["string", false], after: ["json", false], with: ["json", false],
    docs: ["json", false], text: ["json", false], was: ["json", false], body: ["text", false],
  },
};
const PAGE = 500, PARALLEL = 6;

export function encyclistStorage(cfg, s) {
  const prefix = s.typePrefix || "roadmap";
  const type = (k) => `${prefix}_${k}`;
  const base = s.base || "";
  let client = null;
  const mcp = () => (client ||= mcpClient({ url: s.url, headers: { "X-API-Key": apiKey(cfg, s) } }));
  const where = `${s.url} (${prefix}_*)`;

  async function all(kind) {
    const out = [];
    for (let offset = 0; ; offset += PAGE) {
      const r = await mcp().call("ec_entity_query", { type: type(kind), limit: PAGE, offset });
      out.push(...r.entities);
      if (out.length >= r.total || !r.entities.length) return out;
    }
  }
  async function defined() {
    const names = new Set((await mcp().call("ec_entity_type_list")).map((t) => t.name));
    return Object.keys(TYPES).filter((k) => names.has(type(k)));
  }

  return {
    type: "encyclist", path: where, writable: true,
    async load() {
      const errors = [], warnings = [];
      const board = { title: "", intro: [], areas: [], milestones: [], items: {}, dropped: [], base };
      const have = await defined();
      if (have.length < Object.keys(TYPES).length) {
        errors.push(`${where}: no board here yet (missing entity types ${Object.keys(TYPES).filter((k) => !have.includes(k)).map(type).join(", ")}): roadmd convert --to-config writes one`);
        return { board, errors, warnings };
      }
      const [boards, areas, milestones, items] = await Promise.all(["board", "area", "milestone", "item"].map(all));
      const b = boards.find((e) => e.data.key === "board");
      if (b) { board.title = b.data.title || ""; board.intro = lines(b.data.intro); }
      const byOrder = (x, y) => (x.data.order ?? 0) - (y.data.order ?? 0);
      for (const e of areas.sort(byOrder)) board.areas.push({ id: e.data.key, title: e.data.title || "", intro: lines(e.data.intro) });
      for (const e of milestones.sort(byOrder)) board.milestones.push({ id: e.data.key, title: e.data.title || "", tag: e.data.tag || "", body: lines(e.data.body), continuous: !!e.data.continuous });
      const seen = new Set();
      items.sort((x, y) => byId(x.data.key, y.data.key)).forEach((e, order) => {
        const d = e.data, src = `${where} ${e.entity_id}`;
        if (seen.has(d.key)) { errors.push(`${src}: ${d.key} has two records`); return; }
        seen.add(d.key);
        if (d.state === DROPPED) { board.dropped.push({ id: d.key, title: d.title, text: lines(d.body), source: src, line: 0, stamp: { entity: e.entity_id, updatedAt: e.updated_at, data: e.data } }); return; }
        const it = newItem(d.key, d.title);
        Object.assign(it, {
          state: d.state, stateNote: d.state_note || "", area: d.area || null, milestone: d.milestone || null,
          after: d.after || [], with: d.with || [], was: d.was || [], note: lines(d.body),
          refs: { docs: d.docs || [], text: d.text || [] }, order, source: src, line: 0, base,
          stamp: { entity: e.entity_id, updatedAt: e.updated_at, data: e.data },
        });
        it.parts = [...it.refs.docs, ...it.refs.text];
        if (!cfg.states.some((x) => x.id === it.state)) errors.push(`${src}: ${it.id} has an unknown state "${it.state}"`);
        board.items[it.id] = it;
      });
      return { board, errors, warnings };
    },

    // Writes a whole board into an Encyclist that has none yet (convert).
    async writeAll(board) {
      const have = await defined();
      if (have.length) {
        const counts = await Promise.all(have.map(async (k) => (await mcp().call("ec_entity_query", { type: type(k), limit: 1 })).total));
        if (counts.some((n) => n > 0) && !s.force) throw new Error(`${where} already holds a board: remove it first (or "force": true in the target's storage)`);
      }
      for (const [k, fields] of Object.entries(TYPES)) {
        await mcp().call("ec_entity_type_define", {
          name: type(k), description: `roadmd: the roadmap's ${k === "board" ? "board-wide record" : k + "s"}`,
          fields: Object.fromEntries(Object.entries(fields).map(([f, [t, required]]) => [f, { type: t, required, description: f }])),
        });
      }
      const jobs = [
        () => create("board", { key: "board", title: board.title, intro: board.intro.join("\n") }),
        ...board.areas.map((a, i) => () => create("area", { key: a.id, title: a.title, intro: a.intro.join("\n"), order: i })),
        ...board.milestones.map((m, i) => () => create("milestone", { key: m.id, title: m.title, tag: m.tag, body: m.body.join("\n"), order: i, continuous: !!m.continuous })),
        ...Object.values(board.items).map((it) => () => create("item", itemData(it))),
        ...board.dropped.map((d) => () => create("item", { key: d.id, title: d.title, state: DROPPED, body: d.text.join("\n") })),
      ];
      await inParallel(jobs, PARALLEL);
    },

    // An item's record: created, or updated with only the fields that changed since it was read (null clears one).
    async writeItem(it) { await writeRecord(it, itemData(it)); },
    async writeDropped(d) {
      await writeRecord(d, { key: d.id, title: d.title, state: DROPPED, body: d.text.join("\n"), state_note: "", area: "", milestone: "", after: [], with: [], docs: [], text: [], was: [] });
    },
    async deleteItem(it) { if (it.stamp) await mcp().call("ec_entity_delete", { entity_id: it.stamp.entity }); },
    // The board-wide records: areas and milestones updated by key, new ones created, removed ones deleted.
    async writeBoard(board) {
      const sync = async (kind, wanted) => {
        const have = new Map((await all(kind)).map((e) => [e.data.key, e]));
        const jobs = wanted.map((data) => async () => {
          const e = have.get(data.key);
          have.delete(data.key);
          if (!e) return create(kind, data);
          const patch = changed(e.data, data);
          if (Object.keys(patch).length) await mcp().call("ec_entity_update", { entity_id: e.entity_id, data: patch });
        });
        await inParallel(jobs, PARALLEL);
        await inParallel([...have.values()].map((e) => () => mcp().call("ec_entity_delete", { entity_id: e.entity_id })), PARALLEL);
      };
      await sync("board", [{ key: "board", title: board.title, intro: board.intro.join("\n") }]);
      await sync("area", board.areas.map((a, i) => ({ key: a.id, title: a.title, intro: a.intro.join("\n"), order: i })));
      await sync("milestone", board.milestones.map((m, i) => ({ key: m.id, title: m.title, tag: m.tag, body: m.body.join("\n"), order: i, continuous: !!m.continuous })));
    },
  };

  function create(kind, data) { return mcp().call("ec_entity_create", { type: type(kind), data: clean(data) }); }

  async function writeRecord(x, data) {
    if (!x.stamp) { const r = await create("item", data); x.stamp = { entity: r.entity_id, updatedAt: null, data: clean(data) }; return; }
    const patch = changed(x.stamp.data, data);
    if (!Object.keys(patch).length) return;
    await mcp().call("ec_entity_update", { entity_id: x.stamp.entity, data: patch });
    x.stamp.data = { ...x.stamp.data, ...patch };
  }
}

function itemData(it) {
  const refs = it.refs || { docs: it.parts, text: [] };
  return {
    key: it.id, title: it.title, state: it.state, state_note: it.stateNote, area: it.area, milestone: it.milestone,
    after: it.after, with: it.with, docs: refs.docs, text: refs.text, was: it.was, body: it.note.join("\n"),
  };
}

// The fields of `data` that differ from `old`; an empty value clears the field (null).
function changed(old = {}, data) {
  const out = {};
  for (const [k, v] of Object.entries(data)) {
    const empty = v === null || v === undefined || v === "" || (Array.isArray(v) && !v.length);
    const was = old[k];
    const wasEmpty = was === null || was === undefined || was === "" || (Array.isArray(was) && !was.length);
    if (empty ? !wasEmpty : JSON.stringify(v) !== JSON.stringify(was)) out[k] = empty ? null : v;
  }
  return out;
}

// Encyclist validates types: leave out what is empty rather than sending nulls.
const clean = (d) => Object.fromEntries(Object.entries(d).filter(([, v]) => v !== null && v !== undefined && v !== "" && !(Array.isArray(v) && !v.length)));
const lines = (t) => (t ? String(t).split("\n") : []);

async function inParallel(jobs, n) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, jobs.length) }, async () => { while (next < jobs.length) await jobs[next++](); }));
}

// The API key: from the environment, or from the storage's envFile (KEY=value lines), never from the config itself.
function apiKey(cfg, s) {
  if (!s.keyEnv) throw new Error(`storage: "keyEnv" names the environment variable holding the Encyclist API key`);
  if (process.env[s.keyEnv]) return process.env[s.keyEnv];
  if (s.envFile) {
    const p = path.resolve(cfg.root, s.envFile);
    if (fs.existsSync(p)) for (const l of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
      const m = l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (m && m[1] === s.keyEnv) return m[2].trim().replace(/^["']|["']$/g, "");
    }
  }
  throw new Error(`the Encyclist API key isn't set: put it in the environment variable ${s.keyEnv}${s.envFile ? ` or in ${s.envFile}` : ""}`);
}
