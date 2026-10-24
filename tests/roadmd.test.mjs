// roadmd's tests: node --test tests/   (Node 18+, no dependencies)
// They run the CLI and the library on tests/fixture (a small single-file board) and on copies of it in a temp folder.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadModel } from "../lib/model.mjs";
import { readFolder, itemFileText, boardFileText, BOARD_FILE } from "../lib/folder.mjs";
import { rebase } from "../lib/convert.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.join(here, "..", "roadmd.mjs");
const fixture = path.join(here, "fixture");

// a fresh copy of the fixture in a temp folder; edit(cfg, root) may change it
function copy(edit) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "roadmd-"));
  fs.cpSync(fixture, dir, { recursive: true });
  if (edit) {
    const p = path.join(dir, "roadmd.config.json");
    const cfg = JSON.parse(fs.readFileSync(p, "utf8"));
    edit(cfg, dir);
    fs.writeFileSync(p, JSON.stringify(cfg, null, 2));
  }
  return dir;
}
const roadmd = (dir, ...args) => JSON.parse(execFileSync("node", [cli, ...args, "--json"], { cwd: dir, encoding: "utf8" }));
const roadmdFails = (dir, ...args) => {
  try { execFileSync("node", [cli, ...args, "--json"], { cwd: dir, encoding: "utf8", stdio: "pipe" }); return null; }
  catch (e) { return JSON.parse(e.stdout); }
};
const setBoard = (dir, text) => fs.writeFileSync(path.join(dir, "docs", "ROADMAP.md"), text);
const board = () => fs.readFileSync(path.join(fixture, "docs", "ROADMAP.md"), "utf8");

test("the fixture checks clean", () => {
  const r = roadmd(fixture, "check");
  assert.equal(r.ok, true);
  assert.deepEqual(r.errors, []);
  assert.equal(r.items, 9);
});

test("stage n waits for stage n-1, and feeds becomes the other item's after", async () => {
  const m = await loadModel(path.join(fixture, "roadmd.config.json"));
  assert.deepEqual(m.items["UI-2"].after, ["MAP-1", "UI-1"]);      // its own, then the implicit stage before
  assert.ok(m.items["UI-1"].after.includes("CORE-2"));               // CORE-2 feeds UI-1
  assert.equal(m.items["UI-2"].implicitAfter, "UI-1");
});

test("what can be worked on follows each state's needs", async () => {
  const m = await loadModel(path.join(fixture, "roadmd.config.json"));
  assert.equal(m.items["UI-1"].work, "test");
  assert.equal(m.items["CORE-3"].work, "build");                     // UI-1 is test: built
  assert.equal(m.items["UI-2"].work, null);                          // MAP-1 has no tech design yet
  assert.deepEqual(m.items["UI-2"].waitingFor, ["MAP-1"]);            // UI-1 (test) has its tech design
  assert.equal(m.items["MAP-1"].work, "design");                     // CORE-2 is done
  assert.deepEqual(m.lists["tech:waiting"], ["UI-2"]);
});

test("milestones: listed items, the continuous track's IDs and wildcards", async () => {
  const m = await loadModel(path.join(fixture, "roadmd.config.json"));
  assert.equal(m.items["UI-1"].milestone, "M1");
  assert.equal(m.items["MAP-1"].milestone, "M2");
  assert.equal(m.items["TOOL-1"].milestone, "C");
  assert.equal(m.items["IDEA-1"].milestone, "C");
  assert.equal(m.items["CORE-4"].milestone, null);
  assert.equal(m.currentMilestone, "M1");                            // UI-1 isn't done
  assert.deepEqual(m.items["UI-2"].was, ["UI-3"]);
});

test("a stage can't be doing while an earlier one isn't built", () => {
  const dir = copy();
  setBoard(dir, board().replace("**UI-2 Menus** — tech", "**UI-2 Menus** — doing").replace("**UI-1 HUD** — test", "**UI-1 HUD** — ready"));
  const r = roadmdFails(dir, "check");
  assert.ok(r.errors.some((e) => e.includes("UI-2 is doing but UI-1")), r.errors.join("\n"));
});

test("cycles, unknown and dropped references are errors", () => {
  const dir = copy();
  setBoard(dir, board().replace("**CORE-4 Sync** — backlog · Matej's idea", "**CORE-4 Sync** — backlog · after TOOL-1 NOPE-9 OLD-1")
    .replace("**TOOL-1 Builds** — backlog", "**TOOL-1 Builds** — backlog · after CORE-4"));
  const r = roadmdFails(dir, "check");
  const all = r.errors.join("\n");
  assert.match(all, /dependency cycle: (CORE-4 → TOOL-1 → CORE-4|TOOL-1 → CORE-4 → TOOL-1)/);
  assert.match(all, /CORE-4 after unknown item NOPE-9/);
  assert.match(all, /CORE-4 after OLD-1, which is dropped/);
});

test("waiting for something in a later milestone is an error", () => {
  const dir = copy();
  setBoard(dir, board().replace("**UI-1 HUD** — test · [UI tech](tech/UI_TECH.md)", "**UI-1 HUD** — test · [UI tech](tech/UI_TECH.md) · after MAP-1"));
  assert.match(roadmdFails(dir, "check").errors.join("\n"), /UI-1 \(M1\) waits for MAP-1, which is only in M2/);
});

test("a control character in a config pattern is refused", () => {
  const dir = copy((cfg) => { cfg.docKinds[0].review.states[0].match = "^approved\b"; });
  const r = roadmdFails(dir, "check");
  assert.match(r.error, /control character/);
});

test("convert: the folder gives the same answers as the single file", () => {
  const dir = copy();
  const before = roadmd(dir, "next");
  const c = roadmd(dir, "convert");
  assert.equal(c.items, 9);
  assert.equal(c.dropped, 1);
  const p = path.join(dir, "roadmd.config.json");
  const cfg = JSON.parse(fs.readFileSync(p, "utf8"));
  cfg.storage = { type: "folder", path: "docs/roadmap" };
  fs.writeFileSync(p, JSON.stringify(cfg));
  assert.equal(roadmd(dir, "check").ok, true);
  assert.deepEqual(roadmd(dir, "next"), before);
  const item = fs.readFileSync(path.join(dir, "docs", "roadmap", "UI-1.md"), "utf8");
  assert.match(item, /^after: CORE-2$/m);                            // feeds moved onto the item it fed
  assert.match(item, /^docs: \[UI tech\]\(\.\.\/tech\/UI_TECH\.md\)$/m); // the link rewritten for the new folder
  const core3 = fs.readFileSync(path.join(dir, "docs", "roadmap", "CORE-3.md"), "utf8");
  assert.match(core3, /\[link\]\(\.\.\/CORE_SPEC\.md#saving\)/);
  assert.match(fs.readFileSync(path.join(dir, "docs", "roadmap", "CORE-4.md"), "utf8"), /^text: Matej's idea$/m);
  assert.match(fs.readFileSync(path.join(dir, "docs", "roadmap", "OLD-1.md"), "utf8"), /^state: dropped\n\n2026-10-02, dropped: no longer needed\.\nIts reason goes on\.\n$/m);
  const b = fs.readFileSync(path.join(dir, "docs", "roadmap", BOARD_FILE), "utf8");
  assert.doesNotMatch(b, /CORE-1 CORE-2 · UI-1/);                    // milestones keep their prose, not their item lists
  assert.match(b, /\[CORE_SPEC\.md\]\(\.\.\/CORE_SPEC\.md\)/);
});

test("a folder's files read and written back are byte for byte the same", () => {
  const dir = copy();
  roadmd(dir, "convert");
  const folder = path.join(dir, "docs", "roadmap");
  const files = Object.fromEntries(fs.readdirSync(folder).map((f) => [f, fs.readFileSync(path.join(folder, f), "utf8")]));
  const cfg = JSON.parse(fs.readFileSync(path.join(fixture, "roadmd.config.json"), "utf8"));
  const { board: b, errors } = readFolder(files, { ...cfg, ids: { pattern: "[A-Z]{2,12}-\\d+" }, areas: { pattern: "[A-Z]{2,5}" }, milestones: { pattern: "M\\d+" } }, "docs/roadmap");
  assert.deepEqual(errors, []);
  assert.equal(boardFileText(b), files[BOARD_FILE]);
  for (const it of Object.values(b.items)) assert.equal(itemFileText(it), files[`${it.id}.md`], it.id);
});

test("a folder's mistakes are errors with their file and line", () => {
  const dir = copy();
  roadmd(dir, "convert");
  const p = path.join(dir, "roadmd.config.json");
  const cfg = JSON.parse(fs.readFileSync(p, "utf8"));
  cfg.storage = { type: "folder", path: "docs/roadmap" };
  fs.writeFileSync(p, JSON.stringify(cfg));
  const f = path.join(dir, "docs", "roadmap");
  fs.writeFileSync(path.join(f, "CORE-4.md"), "# CORE-4 Sync\nstate: someday\narea: NOPE\ncolour: red\n");
  fs.writeFileSync(path.join(f, "UI-9.md"), "# UI-8 Misnamed\nstate: backlog\narea: UI\n");
  const all = roadmdFails(dir, "check").errors.join("\n");
  assert.match(all, /docs\/roadmap\/CORE-4\.md:2: CORE-4 has an unknown state "someday"/);
  assert.match(all, /docs\/roadmap\/CORE-4\.md:4: expected "field: value"/);
  assert.match(all, /CORE-4 is in unknown area NOPE/);
  assert.match(all, /docs\/roadmap\/UI-9\.md:1: the file holds UI-8/);
});

test("rebase keeps absolute links, anchors and other folders' paths right", () => {
  assert.equal(rebase("[a](X.md) [b](https://x.y/z) [c](#here) [d](sub/Y.md#s)", "docs", "docs/roadmap"), "[a](../X.md) [b](https://x.y/z) [c](#here) [d](../sub/Y.md#s)");
  assert.equal(rebase("[a](X.md)", "docs", "docs"), "[a](X.md)");
});

test("build writes the page with the board and the documents embedded", () => {
  const dir = copy();
  execFileSync("node", [cli, "build"], { cwd: dir, encoding: "utf8" });
  const html = fs.readFileSync(path.join(dir, "docs", "roadmap.html"), "utf8");
  assert.match(html, /<title>Fixture roadmap<\/title>/);
  assert.match(html, /"UI-2":\{"id":"UI-2"/);
  assert.match(html, /"docs\/CORE_SPEC\.md":"# Core spec/);
});
