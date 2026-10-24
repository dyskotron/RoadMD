// Loads everything for one run: config, review lines, documents, the board, the analysis.
import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "./config.mjs";
import { readReviews, writeReviewIndexes, loadDocs, makeRefResolver } from "./docs.mjs";
import { parseBoard } from "./board.mjs";
import { analyze } from "./analyze.mjs";

export function loadModel(configFile, { writeIndexes = false } = {}) {
  const cfg = loadConfig(configFile);
  const errors = [], warnings = [];
  const warn = (m) => warnings.push(m);
  const reviews = readReviews(cfg, warn);
  for (const w of writeReviewIndexes(cfg, reviews, { write: writeIndexes })) warn(w);
  const docs = loadDocs(cfg);
  const boardAbs = path.join(cfg.root, cfg.board);
  if (!fs.existsSync(boardAbs)) throw new Error(`the board ${cfg.board} doesn't exist (config: ${cfg.file})`);
  const boardText = fs.readFileSync(boardAbs, "utf8");
  const { board, errors: parseErrors, warnings: parseWarnings } = parseBoard(boardText, cfg, cfg.board);
  errors.push(...parseErrors); warnings.push(...parseWarnings);
  const resolveRef = makeRefResolver(cfg, docs, cfg.board, warn);
  const a = analyze(board, cfg, { docs, reviews, resolveRef, errors, warnings });
  return { cfg, board, boardText, docs, reviews, errors, warnings, ...a };
}

// What the page needs. Everything it shows is derived here, so the page holds no rules of its own.
export function pageData(m, generated) {
  const { cfg, board } = m;
  const idList = new RegExp(`^(?:(?:${cfg.ids.pattern})|[A-Z][A-Z0-9]*-\\*|[\\s·…,.–]+)+$`);
  const pageDir = path.posix.dirname(cfg.page);
  return {
    generated,
    title: cfg.title || board.title,
    boardPath: cfg.board,
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
    docKinds: cfg.docKinds.map((k) => ({ id: k.id, label: k.label, lead: k.lead || "", match: k.match, displayName: k.displayName || "path", perItem: k.perItem ? { label: k.perItem.label || k.label, missing: k.perItem.missing || "none" } : null, review: k.review ? { overview: k.review.overview || null, states: k.review.states.map((s) => ({ id: s.id, label: s.label || s.id, color: s.color || null, ok: !!s.ok })) } : null })),
    linkedDocsLabel: cfg.linkedDocsLabel,
    lists: m.lists,
    next: m.next,
    currentMilestone: m.currentMilestone,
    milestones: board.milestones.map((x) => ({ id: x.id, title: x.title, tag: x.tag, body: x.body.filter((l) => !idList.test(l)).join(" ") })),
    continuous: board.continuous ? { body: board.continuous.body.join(" ") } : null,
    areas: board.areas.map((a) => ({ id: a.id, title: a.title, intro: a.intro.join(" "), items: a.items })),
    items: Object.fromEntries(m.all.map((it) => [it.id, {
      id: it.id, feature: it.feature, stage: it.stage, title: it.title, state: it.state, stateNote: it.stateNote, area: it.area, milestone: it.milestone,
      spec: it.links, docs: it.itemDocs, after: it.after, with: it.with, unblocks: it.unblocks, immediate: it.immediate, total: it.total,
      work: it.work, waitingFor: it.waitingFor, text: it.text.join(" · "), note: it.note.join("\n"), line: it.line,
    }])),
    dropped: board.dropped.map((d) => ({ id: d.id, title: d.title, text: d.text })),
    reviews: m.reviews,
  };
}
