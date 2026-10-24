// The page: page/page.html with the board's data and every document embedded. One self-contained file, the same for
// `roadmd build` (written to disk, works offline and as a published page) and `roadmd serve` (sent on each visit).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pageData } from "./model.mjs";

const template = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "page", "page.html");
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
// JSON inside a <script>: no "</", and the two line separators JavaScript strings can't hold raw in old engines
const scriptJson = (o) => JSON.stringify(o).split("</").join("<\\/").split("\u2028").join("\\u2028").split("\u2029").join("\\u2029");

export function renderPage(m, { generated = new Date().toISOString().slice(0, 10), live = null } = {}) {
  const data = pageData(m, generated);
  if (live) data.live = live; // served: what the server offers (the page shows it; editing comes with step 4b)
  return fs.readFileSync(template, "utf8")
    .replace("/*__DATA__*/", () => `window.ROADMAP = ${scriptJson(data)};\nwindow.DOCS = ${scriptJson(m.docs)};`)
    .replace(/__TITLE__/g, () => esc(data.title))
    .replace(/__BOARD__/g, () => esc(m.cfg.board))
    .replace(/__GENERATED__/g, generated);
}
