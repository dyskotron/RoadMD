// Minimal globs over repo-relative POSIX paths: `**` any depth, `*` and `?` within one segment.
import fs from "node:fs";
import path from "node:path";

export function globToRegExp(pattern) {
  let re = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "*" && pattern[i + 1] === "*") {
      i++;
      if (pattern[i + 1] === "/") { i++; re += "(?:.*/)?"; } else re += ".*";
    } else if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp("^" + re + "$");
}

export const matchesGlob = (p, patterns) => [].concat(patterns).some((g) => globToRegExp(g).test(p));

const SKIP = new Set([".git", "node_modules", "Library", "Temp", "obj"]);

// Files under root matching the patterns, in pattern order, each directory walked in sorted order, no duplicates.
export function listFiles(root, patterns) {
  const out = [], seen = new Set();
  for (const g of [].concat(patterns)) {
    const segs = g.split("/");
    const firstWild = segs.findIndex((s) => /[*?]/.test(s));
    if (firstWild < 0) {
      if (fs.existsSync(path.join(root, g)) && !seen.has(g)) { seen.add(g); out.push(g); }
      continue;
    }
    const base = segs.slice(0, firstWild).join("/");
    const re = globToRegExp(g);
    const walk = (rel) => {
      const abs = path.join(root, rel);
      if (!fs.existsSync(abs)) return;
      for (const e of fs.readdirSync(abs, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
        const p = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) { if (!SKIP.has(e.name)) walk(p); }
        else if (re.test(p) && !seen.has(p)) { seen.add(p); out.push(p); }
      }
    };
    walk(base);
  }
  return out;
}
