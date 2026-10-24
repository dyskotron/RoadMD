// Loads everything for one run: config, review lines, documents, the board (from its storage), the analysis.
import path from "node:path";
import { loadConfig } from "./config.mjs";
import { readReviews, writeReviewIndexes, loadDocs, makeRefResolver } from "./docs.mjs";
import { openStorage } from "./storage.mjs";
import { analyze } from "./analyze.mjs";
import { compilePatterns } from "./ids.mjs";

export async function loadModel(configFile, { writeIndexes = false } = {}) {
  const cfg = loadConfig(configFile);
  const errors = [], warnings = [];
  const warn = (m) => warnings.push(m);
  const reviews = readReviews(cfg, warn);
  for (const w of writeReviewIndexes(cfg, reviews, { write: writeIndexes })) warn(w);
  const storage = openStorage(cfg);
  // the documents: the config's files, or the board's Encyclist's own (named by their titles: docMeta)
  const [{ docs, meta: docMeta }, { board, errors: loadErrors, warnings: loadWarnings }] = await Promise.all([
    cfg.docs.source === "encyclist" ? storage.loadDocs() : { docs: loadDocs(cfg), meta: {} },
    storage.load(),
  ]);
  errors.push(...loadErrors); warnings.push(...loadWarnings);
  const resolveRef = makeRefResolver(cfg, docs, warn, docMeta);
  // the engine adds what it derives (the stage before, feeds) to the items: give it a copy, keep the board as stored
  const a = analyze(structuredClone(board), cfg, { docs, docMeta, reviews, resolveRef, errors, warnings });
  return { cfg, storage, board, docs, docMeta, reviews, resolveRef, errors, warnings, ...a };
}

// What the page needs. Everything it shows is derived here, so the page holds no rules of its own.
export function pageData(m, generated) {
  const { cfg, board } = m;
  const P = compilePatterns(cfg);
  const pageDir = path.posix.dirname(cfg.page);
  const track = board.milestones.find((x) => x.continuous);
  return {
    generated,
    title: cfg.title || board.title,
    boardPath: m.storage.path,
    storageType: m.storage.type,
    pageDir: pageDir === "." ? "" : pageDir,
    toRoot: pageDir === "." ? "" : pageDir.split("/").map(() => "..").join("/") + "/",
    idPattern: cfg.ids.pattern,
    owner: cfg.owner,
    states: cfg.states.map((s) => s.id),
    stateDefs: cfg.states.map((s) => ({ id: s.id, color: s.color, darkColor: s.darkColor, final: !!s.final, active: !!s.active, meaning: s.meaning || "" })),
    works: m.works.map((w) => ({ id: w.id, state: w.state, label: w.label, next: w.next, lead: w.lead || "", waiting: w.waiting || null })),
    inProgress: cfg.inProgress,
    overview: cfg.overview,
    boardOrder: cfg.boardOrder,
    docMeta: m.docMeta || {},
    docKinds: cfg.docKinds.map((k) => ({ id: k.id, label: k.label, lead: k.lead || "", match: k.match, tags: k.tags || null, displayName: k.displayName || "path", perItem: k.perItem ? { label: k.perItem.label || k.label, missing: k.perItem.missing || "none" } : null, review: k.review ? { overview: k.review.overview || null, states: k.review.states.map((s) => ({ id: s.id, label: s.label || s.id, color: s.color || null, ok: !!s.ok })) } : null })),
    linkedDocsLabel: cfg.linkedDocsLabel,
    lists: m.lists,
    next: m.next,
    currentMilestone: m.currentMilestone,
    milestones: board.milestones.filter((x) => !x.continuous).map((x) => ({ id: x.id, title: x.title, tag: x.tag, body: x.body.filter((l) => !P.idList.test(l)).join(" ") })),
    continuous: track ? { id: track.id, body: track.body.join(" ") } : null,
    areas: board.areas.map((a) => ({ id: a.id, title: a.title, intro: a.intro.join(" "), items: m.all.filter((it) => it.area === a.id).sort((x, y) => x.order - y.order).map((it) => it.id) })),
    items: Object.fromEntries(m.all.map((it) => [it.id, {
      id: it.id, feature: it.feature, stage: it.stage, title: it.title, state: it.state, stateNote: it.stateNote, area: it.area, milestone: it.milestone,
      spec: it.links, docs: it.itemDocs, after: it.after, with: it.with, unblocks: it.unblocks, immediate: it.immediate, total: it.total,
      work: it.work, waitingFor: it.waitingFor, text: it.text.join(" · "), note: it.note.join("\n"), was: it.was, source: it.source, line: it.line, base: it.base,
    }])),
    dropped: board.dropped.map((d) => ({ id: d.id, title: d.title, text: d.text })),
    reviews: m.reviews,
  };
}
