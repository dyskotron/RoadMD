// A board moved from one form to the folder form: what the single-file format kept in other places moves onto the
// items, so the folder holds the same board and the engine gives the same answers.
//   - `feeds X` on A becomes `after A` on X (the folder has no feeds)
//   - milestones' item lists (lines that are only IDs) go: each item names its milestone
//   - parts split into documents and free text; relative links rewritten for the item's new folder
import path from "node:path";
import { compilePatterns } from "./ids.mjs";

export function toFolder(board, cfg, resolveRef, newDir, warn) {
  const P = compilePatterns(cfg);
  const items = board.items;
  const out = structuredClone(board);
  for (const it of Object.values(board.items)) {
    for (const f of it.feeds) {
      if (!items[f]) { warn(`${it.id} feeds unknown item ${f}: dropped in the conversion`); continue; }
      if (!out.items[f].after.includes(it.id)) out.items[f].after.push(it.id);
    }
  }
  for (const it of Object.values(out.items)) {
    const from = it.base;
    // an item that already says which parts are documents (read from a folder or Encyclist) keeps that; the single
    // file's parts are sorted by whether they resolve to a document
    const split = { docs: [], text: [] };
    if (it.refs) { split.docs = it.refs.docs.map((p) => rebase(p, from, newDir)); split.text = it.refs.text.map((p) => rebase(p, from, newDir)); }
    else for (const p of it.parts) (resolveRef(p, from) ? split.docs : split.text).push(rebase(p, from, newDir));
    it.refs = split;
    it.parts = [...split.docs, ...split.text];
    it.note = it.note.map((l) => rebase(l, from, newDir));
    it.feeds = [];
  }
  for (const d of out.dropped) d.text = d.text.map((l) => rebase(l, path.posix.dirname(d.source), newDir));
  // board-wide text was written next to the old board
  const boardDir = board.base ?? newDir;
  for (const m of out.milestones) m.body = m.body.filter((l) => !P.idList.test(l)).map((l) => rebase(l, boardDir, newDir));
  for (const a of out.areas) a.intro = a.intro.map((l) => rebase(l, boardDir, newDir));
  out.intro = out.intro.map((l) => rebase(l, boardDir, newDir));
  return { board: out };
}

// Relative markdown links in a line, from a document in `fromDir` to one in `toDir`.
export function rebase(line, fromDir, toDir) {
  if (fromDir === toDir) return line;
  return line.replace(/(!?\[[^\]]*\]\()([^)\s]+)(\))/g, (all, open, href, close) => {
    if (/^(?:[a-z]+:|#|\/)/i.test(href)) return all;
    const [file, hash] = href.split("#");
    const target = path.posix.normalize(path.posix.join(fromDir, file));
    const rel = path.posix.relative(toDir, target) || ".";
    return open + rel + (hash !== undefined ? "#" + hash : "") + close;
  });
}
