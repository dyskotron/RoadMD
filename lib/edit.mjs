// Edits: each one is applied to a copy of the board, the whole board is checked again, and only when the edit adds no
// error is anything written, and then only what it changed (an item's file or record; _board.md for areas and
// milestones). A board that already had errors can still be edited, as long as the edit adds none.
//
// An edit: { op, ... } (the CLI builds them, roadmd.mjs; the server will too):
//   set     { id, state, note?, owner? }                 the state (an owner-only state needs owner: true)
//   add     { id, title, area, state?, milestone?, after?, with?, docs?, text?, note? }
//   edit    { id, title?, stateNote?, note?, docs?, text? }
//   deps    { id, list: "after" | "with", add?: [ids], remove?: [ids] }
//   move    { id, milestone?: id | null, area?: code }  an area move takes every stage of the feature along
//   rename  { id, to }                                   every reference follows; the item remembers its old ID (was)
//   drop    { id, reason }                               refused while anything waits for it or names it
//   milestone-add { id, title, tag?, body?, before? }  · milestone-set { id, title?, tag?, body? } · milestone-move { id, before? }
//   area-add { id, title, intro? } · area-set { id, title?, intro? }
import { analyze } from "./analyze.mjs";
import { newItem, splitId, DROPPED, compilePatterns } from "./ids.mjs";

export class EditError extends Error {
  constructor(message, errors = []) { super(message); this.errors = errors; }
}

export async function applyEdit(m, e, { today = new Date().toISOString().slice(0, 10), dryRun = false } = {}) {
  const { cfg, storage } = m;
  if (!storage.writable) throw new EditError(`this board is a ${storage.type} (${storage.path}), which roadmd only reads: roadmd convert moves it into a folder`);
  const P = compilePatterns(cfg);
  const b = structuredClone(m.board);
  const touched = new Set(), dropped = [], gone = [];
  let boardChanged = false;
  const item = (id) => { const it = b.items[id]; if (!it) throw new EditError(b.dropped.some((d) => d.id === id) ? `${id} is dropped` : `no item ${id}`); return it; };
  const state = (s) => { const st = cfg.states.find((x) => x.id === s); if (!st) throw new EditError(`unknown state "${s}" (one of ${cfg.states.map((x) => x.id).join(", ")})`); return st; };
  const validId = (id) => { if (!P.idExact.test(id)) throw new EditError(`"${id}" isn't an ID (${cfg.ids.pattern})`); };
  const freeId = (id) => { validId(id); if (b.items[id] || b.dropped.some((d) => d.id === id)) throw new EditError(`${id} already exists${b.dropped.some((d) => d.id === id) ? " (dropped: an ID is never reused)" : ""}`); };
  const milestone = (id) => { if (id && !b.milestones.some((x) => x.id === id)) throw new EditError(`no milestone ${id}`); return id || null; };
  const area = (id) => { if (!b.areas.some((x) => x.id === id)) throw new EditError(`no area ${id}`); return id; };
  const refs = (it) => (it.refs ||= { docs: [...it.parts], text: [] });
  const syncParts = (it) => { it.parts = [...it.refs.docs, ...it.refs.text]; };
  let summary = "";

  switch (e.op) {
    case "set": {
      const it = item(e.id), st = state(e.state);
      if (st.ownerOnly && !e.owner) throw new EditError(`${e.state} is ${cfg.owner}'s to set (owner only): with --owner, only when ${cfg.owner} says so`);
      it.state = e.state;
      it.stateNote = e.note ?? (st.ownerOnly && st.ownerNote ? st.ownerNote.replace("{owner}", cfg.owner).replace("{date}", today) : "");
      touched.add(it.id);
      summary = `${it.id}: ${e.state}${it.stateNote ? ` (${it.stateNote})` : ""}`;
      break;
    }
    case "add": {
      freeId(e.id);
      if (!e.title) throw new EditError("an item needs a title");
      const it = newItem(e.id, e.title);
      const st = state(e.state || cfg.states[0].id);
      if (st.ownerOnly && !e.owner) throw new EditError(`${st.id} is ${cfg.owner}'s to set (owner only)`);
      Object.assign(it, {
        state: st.id, area: area(e.area), milestone: milestone(e.milestone), after: [...(e.after || [])], with: [...(e.with || [])],
        refs: { docs: [...(e.docs || [])], text: [...(e.text || [])] }, note: e.note ? String(e.note).split("\n") : [],
        base: b.base ?? "", order: Object.keys(b.items).length,
      });
      for (const d of [...it.after, ...it.with]) validId(d);
      syncParts(it);
      b.items[it.id] = it;
      touched.add(it.id);
      summary = `added ${it.id} ${it.title} (${it.state}, ${it.area}${it.milestone ? ", " + it.milestone : ""})`;
      break;
    }
    case "edit": {
      const it = item(e.id);
      if (e.title !== undefined) { if (!e.title) throw new EditError("an item needs a title"); it.title = e.title; }
      if (e.stateNote !== undefined) it.stateNote = e.stateNote;
      if (e.note !== undefined) it.note = e.note ? String(e.note).split("\n") : [];
      if (e.docs !== undefined) refs(it).docs = [...e.docs];
      if (e.text !== undefined) refs(it).text = [...e.text];
      if (it.refs) syncParts(it);
      touched.add(it.id);
      summary = `${it.id} edited`;
      break;
    }
    case "deps": {
      const it = item(e.id);
      if (!["after", "with"].includes(e.list)) throw new EditError(`"${e.list}" isn't a dependency list (after, with)`);
      for (const d of e.add || []) { validId(d); if (d === it.id) throw new EditError(`${it.id} can't wait for itself`); if (!it[e.list].includes(d)) it[e.list].push(d); }
      for (const d of e.remove || []) {
        if (!it[e.list].includes(d)) throw new EditError(`${it.id}'s ${e.list} doesn't name ${d}${e.list === "after" && splitId(d).feature === it.feature && splitId(d).stage === it.stage - 1 ? " (it waits for its stage before by its number, not by a line)" : ""}`);
        it[e.list] = it[e.list].filter((x) => x !== d);
      }
      touched.add(it.id);
      summary = `${it.id} ${e.list}: ${it[e.list].join(" ") || "nothing"}`;
      break;
    }
    case "move": {
      const it = item(e.id);
      const parts = [];
      if (e.milestone !== undefined) { it.milestone = milestone(e.milestone); touched.add(it.id); parts.push(`milestone ${it.milestone || "none"}`); }
      if (e.area !== undefined) {
        area(e.area);
        const stages = Object.values(b.items).filter((x) => x.feature === it.feature);
        for (const x of stages) { x.area = e.area; touched.add(x.id); }
        parts.push(`area ${e.area}${stages.length > 1 ? ` (all ${stages.length} stages of ${it.feature})` : ""}`);
      }
      if (!parts.length) throw new EditError("move needs --milestone or --area");
      summary = `${it.id}: ${parts.join(", ")}`;
      break;
    }
    case "rename": {
      const it = item(e.id);
      freeId(e.to);
      const fixed = cfg.ids.fixedFrom && cfg.states.findIndex((s) => s.id === it.state) >= cfg.states.findIndex((s) => s.id === cfg.ids.fixedFrom);
      if (fixed) throw new EditError(`${it.id} is ${it.state}: from ${cfg.ids.fixedFrom} on an ID never changes`);
      delete b.items[it.id];
      gone.push(structuredClone(it));
      const old = it.id;
      Object.assign(it, { id: e.to, ...splitId(e.to) });
      if (!it.was.includes(old)) it.was.push(old);
      b.items[it.id] = it;
      touched.add(it.id);
      for (const x of Object.values(b.items)) for (const list of ["after", "with"]) {
        if (x[list].includes(old)) { x[list] = x[list].map((d) => (d === old ? it.id : d)); touched.add(x.id); }
      }
      summary = `${old} → ${it.id}${[...touched].length > 1 ? ` (references updated in ${[...touched].filter((x) => x !== it.id).join(", ")})` : ""}`;
      break;
    }
    case "drop": {
      const it = item(e.id);
      if (!e.reason) throw new EditError("dropping an item needs its reason");
      const waiting = Object.values(b.items).filter((x) => x.id !== it.id && (x.after.includes(it.id) || x.with.includes(it.id))).map((x) => x.id).sort();
      if (waiting.length) throw new EditError(`${waiting.join(", ")} still name${waiting.length === 1 ? "s" : ""} ${it.id} (after or with): change them first`);
      delete b.items[it.id];
      const d = { id: it.id, title: it.title, text: [`${today}, dropped: ${e.reason}`], source: it.source, line: 0, stamp: it.stamp };
      b.dropped.push(d);
      dropped.push(d);
      summary = `${it.id} dropped`;
      break;
    }
    case "milestone-add": case "milestone-move": case "milestone-set": {
      const exists = b.milestones.find((x) => x.id === e.id);
      if (e.op === "milestone-add") {
        if (exists) throw new EditError(`milestone ${e.id} already exists`);
        if (!new RegExp(`^(?:${cfg.milestones.pattern})$`).test(e.id)) throw new EditError(`"${e.id}" isn't a milestone ID (${cfg.milestones.pattern})`);
      } else if (!exists) throw new EditError(`no milestone ${e.id}`);
      if (exists?.continuous && e.op === "milestone-move") throw new EditError("the continuous track stays last");
      const ms = exists || { id: e.id, title: e.title || e.id, tag: "", body: [], continuous: false };
      if (e.title !== undefined) ms.title = e.title;
      if (e.tag !== undefined) ms.tag = e.tag;
      if (e.body !== undefined) ms.body = e.body ? String(e.body).split("\n") : [];
      if (e.op !== "milestone-set") {
        b.milestones = b.milestones.filter((x) => x.id !== ms.id);
        const track = b.milestones.findIndex((x) => x.continuous);
        let at = e.before ? b.milestones.findIndex((x) => x.id === e.before) : track >= 0 ? track : b.milestones.length;
        if (e.before && at < 0) throw new EditError(`no milestone ${e.before}`);
        b.milestones.splice(at, 0, ms);
      }
      boardChanged = true;
      summary = `milestone ${ms.id}${e.op === "milestone-add" ? " added" : e.op === "milestone-move" ? (e.before ? ` before ${e.before}` : " last") : " edited"}`;
      break;
    }
    case "area-add": case "area-set": {
      const exists = b.areas.find((x) => x.id === e.id);
      if (e.op === "area-add") {
        if (exists) throw new EditError(`area ${e.id} already exists`);
        if (!new RegExp(`^(?:${cfg.areas.pattern})$`).test(e.id)) throw new EditError(`"${e.id}" isn't an area code (${cfg.areas.pattern})`);
        b.areas.push({ id: e.id, title: e.title || e.id, intro: e.intro ? String(e.intro).split("\n") : [] });
      } else {
        if (!exists) throw new EditError(`no area ${e.id}`);
        if (e.title !== undefined) exists.title = e.title;
        if (e.intro !== undefined) exists.intro = e.intro ? String(e.intro).split("\n") : [];
      }
      boardChanged = true;
      summary = `area ${e.id}${e.op === "area-add" ? " added" : " edited"}`;
      break;
    }
    default: throw new EditError(`unknown edit "${e.op}"`);
  }

  // the whole board again: refuse what adds an error
  const errors = [], warnings = [];
  analyze(structuredClone(b), cfg, { docs: m.docs, reviews: m.reviews, resolveRef: m.resolveRef, errors, warnings });
  const before = new Set(m.errors);
  const added = errors.filter((x) => !before.has(x));
  if (added.length) throw new EditError(`refused: it would break the board`, added);
  if (dryRun) return { summary, changed: [...touched], dropped: dropped.map((d) => d.id), board: boardChanged, written: false };

  for (const old of gone) await storage.renameItem?.(old, b.items[e.to]);
  for (const id of touched) await storage.writeItem(b.items[id]);
  for (const d of dropped) await storage.writeDropped(d);
  if (boardChanged) await storage.writeBoard(b);
  return { summary, changed: [...touched], dropped: dropped.map((d) => d.id), board: boardChanged, written: true };
}
