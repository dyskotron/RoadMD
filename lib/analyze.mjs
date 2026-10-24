// Checks the board against the config and derives what can be worked on now. Pure: board + docs + config in.
import { matchesGlob } from "./glob.mjs";

export function analyze(board, cfg, { docs, reviews, resolveRef, errors, warnings }) {
  const err = (m) => errors.push(m), warn = (m) => warnings.push(m);
  const items = board.items;
  const all = Object.values(items);
  const state = Object.fromEntries(cfg.states.map((s, i) => [s.id, { ...s, rank: i }]));
  const rank = (id) => (items[id] && state[items[id].state] ? state[items[id].state].rank : -1);
  const isFinal = (id) => !!(items[id] && state[items[id].state]?.final);
  const reaches = (id, need) => rank(id) >= state[need].rank;
  const droppedIds = new Set(board.dropped.map((d) => d.id));
  const unordered = new Set(cfg.ids.unordered);
  const perItemKinds = cfg.docKinds.filter((k) => k.perItem);
  const kindMatch = (p, k) => matchesGlob(p, k.perItem?.match || k.match);

  // documents named on item lines
  for (const it of all) {
    it.spec = []; it.text = [];
    for (const p of it.parts) { const ref = resolveRef(p, it.base); if (ref) it.spec.push(ref); else it.text.push(p); }
    // one document per item of each per-item kind: the one its line links, else the kind's path for its feature
    it.itemDocs = {};
    for (const k of perItemKinds) {
      const own = it.spec.find((r) => r.doc && kindMatch(r.doc, k));
      const byFeature = k.perItem.path?.replace("{feature}", it.feature);
      const doc = own ? own.doc : byFeature && docs[byFeature] !== undefined ? byFeature : null;
      if (doc) it.itemDocs[k.id] = doc;
    }
    it.links = it.spec.filter((r) => !perItemKinds.some((k) => r.doc && kindMatch(r.doc, k)));
  }

  for (const it of all) for (const f of it.feeds) if (items[f] && !items[f].after.includes(it.id)) items[f].after.push(it.id);

  // n is the build order: stage n waits for stage n-1 and its state may require the earlier stages to have got far enough
  for (const it of all) {
    if (unordered.has(it.feature)) continue;
    const st = state[it.state];
    if (!st) continue;
    if (it.stage >= 2 && !st.final) {
      const prev = items[`${it.feature}-${it.stage - 1}`];
      if (prev && !it.after.includes(prev.id) && !it.with.includes(prev.id)) { it.after.push(prev.id); it.implicitAfter = prev.id; }
    }
    if (st.earlierStages)
      for (const other of all)
        if (other.feature === it.feature && other.stage < it.stage && !reaches(other.id, st.earlierStages))
          err(`${it.id} is ${it.state} but ${other.id}, an earlier stage, is ${other.state}: ${it.state} needs every earlier stage at least ${st.earlierStages}`);
  }
  for (const it of all)
    for (const list of ["after", "feeds", "with"])
      for (const d of it[list]) {
        if (!items[d]) err(droppedIds.has(d) ? `${it.id} ${list} ${d}, which is dropped` : `${it.id} ${list} unknown item ${d}`);
        if (d === it.id) err(`${it.id} depends on itself`);
      }

  // areas and milestones: each item names its own
  const areaIds = new Set(board.areas.map((a) => a.id));
  const msById = Object.fromEntries(board.milestones.map((m) => [m.id, m]));
  for (const it of all) {
    if (it.area && !areaIds.has(it.area)) err(`${it.id} is in unknown area ${it.area}`);
    if (it.milestone && !msById[it.milestone]) err(`${it.id} is in unknown milestone ${it.milestone}`);
  }
  for (const d of board.dropped) if (items[d.id]) err(`${d.id} is both an item and dropped`);
  {
    const featureAreas = {};
    for (const it of all) (featureAreas[it.feature] ||= new Set()).add(it.area);
    for (const [f, as] of Object.entries(featureAreas)) if (as.size > 1) err(`feature ${f} has stages in several areas: ${[...as].join(", ")}`);
  }
  for (const it of all) {
    const st = state[it.state];
    if (st && !it.milestone && !st.final && !st.milestoneOptional) warn(`${it.id} (${it.state}) is in no milestone`);
    for (const r of st?.requires || []) {
      const doc = it.itemDocs[r.docKind];
      const level = r.level === "error" ? err : warn;
      if (!doc) { if (r.missing && r.missing !== "ignore") (r.missing === "error" ? err : warn)(`${it.id} is ${it.state} but has no ${r.docKind} document`); continue; }
      if (r.review && reviews[doc] && reviews[doc].state !== r.review) level(`${it.id} is ${it.state} but ${doc} is ${reviews[doc].state}`);
    }
  }
  const msRank = Object.fromEntries(board.milestones.map((m, i) => [m.id, m.continuous ? 1000 : i]));
  const isTrack = (id) => !!msById[id]?.continuous;
  for (const it of all) {
    if (!it.milestone || isTrack(it.milestone)) continue;
    for (const d of it.after) {
      const dep = items[d];
      if (!dep || isFinal(d) || !dep.milestone || isTrack(dep.milestone)) continue;
      if (msRank[dep.milestone] > msRank[it.milestone]) err(`${it.id} (${it.milestone}) waits for ${d}, which is only in ${dep.milestone}`);
    }
  }

  // cycles
  {
    const color = {}, stack = [];
    const visit = (id) => {
      color[id] = 1; stack.push(id);
      for (const d of items[id].after) {
        if (!items[d]) continue;
        if (color[d] === 1) { err(`dependency cycle: ${stack.slice(stack.indexOf(d)).concat(d).join(" → ")}`); continue; }
        if (!color[d]) visit(d);
      }
      stack.pop(); color[id] = 2;
    };
    for (const it of all) if (!color[it.id]) visit(it.id);
  }

  // impact
  for (const it of all) it.unblocks = [];
  for (const it of all) for (const d of it.after) if (items[d]) items[d].unblocks.push(it.id);
  const downstream = (id, seen = new Set()) => { for (const d of items[id].unblocks) if (!seen.has(d)) { seen.add(d); downstream(d, seen); } return seen; };
  for (const it of all) {
    it.immediate = it.unblocks.filter((d) => !isFinal(d)).length;
    it.total = [...downstream(it.id)].filter((d) => !isFinal(d)).length;
  }

  // what kind of work each item is now. A state says what an item is by itself; whether it can be worked on
  // depends on how far what it waits for has got (its state's work.needs).
  for (const it of all) {
    const st = state[it.state];
    it.work = null; it.waitingFor = [];
    if (!st) continue;
    if (st.active) { it.work = "inProgress"; continue; }
    if (!st.work) continue;
    it.waitingFor = st.work.needs ? it.after.filter((d) => !items[d] || !reaches(d, st.work.needs)) : [];
    if (!it.waitingFor.length) it.work = st.work.id;
  }
  const open = all.filter((it) => !isFinal(it.id));
  const msOrder = (it) => (it.milestone ? msRank[it.milestone] : 1001);
  const rankNow = (a, b) => msOrder(a) - msOrder(b) || b.immediate - a.immediate || b.total - a.total || a.id.localeCompare(b.id);

  const works = cfg.states.filter((s) => s.work).map((s) => ({ ...s.work, state: s.id }));
  const lists = {};
  for (const w of works) {
    lists[w.id] = open.filter((it) => it.work === w.id).sort(rankNow).map((it) => it.id);
    if (w.waiting) lists[w.id + ":waiting"] = open.filter((it) => it.state === w.state && !it.work).sort(rankNow).map((it) => it.id);
  }
  lists.inProgress = open.filter((it) => it.work === "inProgress").sort(rankNow).map((it) => it.id);
  const next = cfg.next.map((w) => ({ work: w, ids: lists[w].slice(0, cfg.nextSize) }));
  const currentMilestone = board.milestones.find((m) => !m.continuous && all.some((i) => i.milestone === m.id && !isFinal(i.id)))?.id || null;

  return { items, all, open, state, works, lists, next, currentMilestone, msRank };
}
