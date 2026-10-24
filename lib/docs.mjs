// The documents the page embeds, how a part of an item line names one, and the review lines of reviewed kinds.
import fs from "node:fs";
import path from "node:path";
import { listFiles, matchesGlob } from "./glob.mjs";

const read = (abs) => fs.readFileSync(abs, "utf8").replace(/\r\n/g, "\n");

// Review states of every document of a kind that has a review line: { "docs/tech/X.md": { state, text, kind } }.
export function readReviews(cfg, warn) {
  const reviews = {};
  for (const k of cfg.docKinds) {
    if (!k.review) continue;
    const lineRe = new RegExp(k.review.line, "m");
    const fallback = k.review.states.find((s) => s.default) || k.review.states.at(-1);
    for (const p of listFiles(cfg.root, k.review.files)) {
      const m = read(path.join(cfg.root, p)).match(lineRe);
      const text = m ? m[1].trim() : "";
      if (!m) warn(`${p} has no review line`);
      const st = k.review.states.find((s) => s.match && new RegExp(s.match).test(text)) || fallback;
      reviews[p] = { state: st.id, text: text || fallback.label || fallback.id, kind: k.id };
    }
  }
  return reviews;
}

// A kind's review index: a table written between two markers in one file. Returns true when it was out of date.
export function writeReviewIndexes(cfg, reviews, { write }) {
  const stale = [];
  for (const k of cfg.docKinds) {
    const ix = k.review?.index;
    if (!ix) continue;
    const abs = path.join(cfg.root, ix.file);
    if (!fs.existsSync(abs)) continue;
    const raw = fs.readFileSync(abs, "utf8");
    const eol = raw.includes("\r\n") ? "\r\n" : "\n";
    const a = raw.indexOf(ix.start), b = raw.indexOf(ix.end);
    if (a < 0 || b < a) { stale.push(`${ix.file} has no review index markers`); continue; }
    const dir = path.posix.dirname(ix.file);
    const rows = Object.entries(reviews).filter(([, r]) => r.kind === k.id)
      .map(([p, r]) => `| [${path.posix.basename(p, ".md")}](${path.posix.relative(dir, p)}) | ${r.text} |`);
    const head = ix.header || ["Document", "Review"];
    const table = [`| ${head.join(" | ")} |`, `|${head.map(() => "---").join("|")}|`, ...rows].join(eol);
    const next = raw.slice(0, a + ix.start.length) + eol + table + eol + raw.slice(b);
    if (next === raw) continue;
    if (write) fs.writeFileSync(abs, next, "utf8");
    else stale.push(`${ix.file}'s review index is out of date: run roadmd build`);
  }
  return stale;
}

export function loadDocs(cfg) {
  const docs = {};
  for (const p of listFiles(cfg.root, cfg.docs.include)) docs[p] = read(path.join(cfg.root, p));
  return docs;
}

const kindOfDoc = (cfg, p) => cfg.docKinds.find((k) => matchesGlob(p, k.match)) || null;
export { kindOfDoc };

// Resolves the parts of item lines that name documents.
export function makeRefResolver(cfg, docs, boardRel, warn) {
  const boardDir = path.posix.dirname(boardRel);
  const suffixRe = cfg.docs.stemSuffixes.length ? new RegExp(`_(${cfg.docs.stemSuffixes.join("|")})$`) : null;
  const stems = Object.keys(docs).map((p) => {
    const stem = path.posix.basename(p, ".md");
    return { p, stem, short: suffixRe ? stem.replace(suffixRe, "") : stem };
  }).sort((a, b) => b.stem.length - a.stem.length);
  const names = Object.keys(cfg.docs.names).sort((a, b) => b.length - a.length);
  const anchors = cfg.docs.anchors.map((a) => ({ re: new RegExp(a.pattern), to: a.anchor }));
  const minStem = cfg.docs.minStemLength;

  function sectionOf(tail) {
    if (!tail) return null;
    for (const a of anchors) { const m = tail.match(a.re); if (m) return a.to.replace(/\$(\d)/g, (_, i) => m[+i]); }
    return null;
  }
  const starts = (part, key) => part === key || part.startsWith(key + " ") || part.startsWith(key + "'");

  return function resolve(part) {
    let m;
    if ((m = part.match(/^\[([^\]]+)\]\(([^)]+)\)\s*(.*)$/))) {
      const [file, hash] = m[2].split("#");
      const rel = path.posix.normalize(path.posix.join(boardDir, file));
      if (!docs[rel]) { warn(`spec link not found: ${m[2]}`); return { text: part, doc: null }; }
      return { text: m[1] + (m[3] ? " " + m[3] : ""), doc: rel, anchor: hash ? decodeURIComponent(hash) : sectionOf(m[3]) };
    }
    if ((m = part.match(/^`([^`]+)`\s*(.*)$/)) && docs[m[1]]) return { text: part, doc: m[1], anchor: sectionOf(m[2]) };
    for (const name of names) if (starts(part, name)) return { text: part, doc: cfg.docs.names[name], anchor: sectionOf(part.slice(name.length).trim()) };
    for (const s of stems) for (const key of [s.stem, s.short]) {
      if (key.length < minStem) continue;
      if (starts(part, key)) return { text: part, doc: s.p, anchor: sectionOf(part.slice(key.length).trim()) };
    }
    if (/^[A-Z][A-Z0-9_]{5,}/.test(part)) warn(`spec reference "${part}" matches no document`);
    return null;
  };
}
