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

// ---- the Encyclist adapter, against an in-memory stand-in (tests/fake-encyclist.mjs)
import { startFakeEncyclist } from "./fake-encyclist.mjs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const run = promisify(execFile);
const roadmdAsync = async (dir, ...args) => JSON.parse((await run("node", [cli, ...args, "--json"], { cwd: dir })).stdout);
// the failing run, async: a synchronous child would block this process, which hosts the fake server
const roadmdFailsAsync = async (dir, ...args) => {
  try { await run("node", [cli, ...args, "--json"], { cwd: dir }); return null; }
  catch (e) { return JSON.parse(e.stdout); }
};

async function encyclistCopy(fake) {
  const dir = copy();
  fs.writeFileSync(path.join(dir, ".test.env"), `FAKE_ENCYCLIST_KEY=${fake.key}\n`);
  const cfg = JSON.parse(fs.readFileSync(path.join(dir, "roadmd.config.json"), "utf8"));
  cfg.storage = { type: "encyclist", url: fake.url, keyEnv: "FAKE_ENCYCLIST_KEY", envFile: ".test.env", base: "docs/roadmap" };
  fs.writeFileSync(path.join(dir, "encyclist.config.json"), JSON.stringify(cfg));
  return dir;
}

for (const sse of [false, true]) test(`encyclist: convert, then the same answers as the file${sse ? " (answers as events)" : ""}`, async () => {
  const fake = await startFakeEncyclist({ sse });
  try {
    const dir = await encyclistCopy(fake);
    const before = await roadmdAsync(dir, "next");
    const c = await roadmdAsync(dir, "convert", "--to-config", "encyclist.config.json");
    assert.equal(c.items, 9);
    assert.equal([...fake.types.keys()].filter((t) => t.startsWith("roadmap_")).length, 4);
    assert.equal([...fake.entities.values()].filter((e) => e.type === "roadmap_item").length, 10);  // 9 + the dropped one
    const after = await roadmdAsync(dir, "next", "--config", "encyclist.config.json");
    assert.deepEqual(after, before);
    const show = await roadmdAsync(dir, "show", "UI-1", "--config", "encyclist.config.json");
    assert.deepEqual(show.after, ["CORE-2"]);
    assert.equal(show.docs.tech, "docs/tech/UI_TECH.md");             // the link, rewritten for base, still resolves
    await assert.rejects(roadmdAsync(dir, "convert", "--to-config", "encyclist.config.json"));  // it holds a board now
  } finally { await fake.close(); }
});

test("encyclist: an item written back changes only its own record", async () => {
  const fake = await startFakeEncyclist();
  try {
    const dir = await encyclistCopy(fake);
    await roadmdAsync(dir, "convert", "--to-config", "encyclist.config.json");
    const cfgFile = path.join(dir, "encyclist.config.json");
    const m = await loadModel(cfgFile);
    const before = JSON.stringify([...fake.entities.values()].filter((e) => e.data.key !== "MAP-1"));
    const it = m.board.items["MAP-1"];
    it.state = "design"; it.note = ["Being designed."];
    await m.storage.writeItem(it);
    const m2 = await loadModel(cfgFile);
    assert.equal(m2.board.items["MAP-1"].state, "design");
    assert.deepEqual(m2.board.items["MAP-1"].note, ["Being designed."]);
    assert.equal(JSON.stringify([...fake.entities.values()].filter((e) => e.data.key !== "MAP-1")), before);
  } finally { await fake.close(); }
});

test("encyclist: a wrong key and an empty knowledge base are clear errors", async () => {
  const fake = await startFakeEncyclist();
  try {
    const dir = await encyclistCopy(fake);
    const empty = await roadmdFailsAsync(dir, "check", "--config", "encyclist.config.json");
    assert.match(empty.errors.join("\n"), /no board here yet/);
    fs.writeFileSync(path.join(dir, ".test.env"), "FAKE_ENCYCLIST_KEY=wrong\n");
    const bad = await roadmdFailsAsync(dir, "check", "--config", "encyclist.config.json");
    assert.match(bad.error, /not authorised \(401\)/);
    const p = path.join(dir, "encyclist.config.json");
    const cfg = JSON.parse(fs.readFileSync(p, "utf8"));
    cfg.storage.key = "sk-in-the-config";
    fs.writeFileSync(p, JSON.stringify(cfg));
    assert.match((await roadmdFailsAsync(dir, "check", "--config", "encyclist.config.json")).error, /never put the API key in the config/);
  } finally { await fake.close(); }
});

// ---- edits
function folderCopy() {
  const dir = copy();
  execFileSync("node", [cli, "convert"], { cwd: dir });
  const p = path.join(dir, "roadmd.config.json");
  const cfg = JSON.parse(fs.readFileSync(p, "utf8"));
  cfg.storage = { type: "folder", path: "docs/roadmap" };
  fs.writeFileSync(p, JSON.stringify(cfg));
  return dir;
}
const file = (dir, id) => fs.readFileSync(path.join(dir, "docs", "roadmap", `${id}.md`), "utf8");

test("edits: the single file is read only", () => {
  const r = roadmdFails(copy(), "set", "MAP-1", "tech");
  assert.match(r.error, /roadmd only reads: roadmd convert/);
});

test("edits: set, owner-only, add, deps, move, edit", () => {
  const dir = folderCopy();
  const untouched = file(dir, "CORE-1");
  assert.equal(roadmd(dir, "set", "MAP-1", "tech").changed[0], "MAP-1");
  assert.match(file(dir, "MAP-1"), /^state: tech$/m);
  assert.match(roadmdFails(dir, "set", "UI-1", "done").error, /owner only/);
  roadmd(dir, "set", "UI-1", "done", "--owner");
  assert.match(file(dir, "UI-1"), /^state: done \(accepted by Owner \d{4}-\d\d-\d\d\)$/m);
  roadmd(dir, "add", "CORE-5", "Backups", "--area", "CORE", "--milestone", "M2", "--after", "CORE-3", "--docs", "CORE_SPEC", "--note", "Nightly.");
  assert.equal(file(dir, "CORE-5"), "# CORE-5 Backups\nstate: backlog\narea: CORE\nmilestone: M2\nafter: CORE-3\ndocs: CORE_SPEC\n\nNightly.\n");
  roadmd(dir, "after", "UI-2", "+CORE-5", "-MAP-1");
  assert.match(file(dir, "UI-2"), /^after: CORE-5$/m);
  roadmd(dir, "move", "TOOL-1", "--milestone", "none");
  assert.doesNotMatch(file(dir, "TOOL-1"), /milestone:/);
  roadmd(dir, "edit", "CORE-4", "--title", "Sync at last", "--note", "Line one.\nLine two.");
  assert.match(file(dir, "CORE-4"), /^# CORE-4 Sync at last\n[\s\S]*\n\nLine one\.\nLine two\.\n$/);
  assert.equal(file(dir, "CORE-1"), untouched);                       // nothing else written
  assert.equal(roadmd(dir, "check").ok, true);
});

test("edits: refused when they would break the board, and nothing is written", () => {
  const dir = folderCopy();
  const before = file(dir, "CORE-1");
  const r = roadmdFails(dir, "after", "CORE-1", "UI-2");
  assert.match(r.errors.join("\n"), /CORE-1 \(M1\) waits for UI-2, which is only in M2/);
  assert.equal(file(dir, "CORE-1"), before);
  assert.match(roadmdFails(dir, "after", "CORE-1", "NOPE-1").errors.join("\n"), /unknown item NOPE-1/);
  assert.match(roadmdFails(dir, "add", "CORE-1", "Again", "--area", "CORE").error, /already exists/);
  assert.match(roadmdFails(dir, "add", "OLD-1", "Back", "--area", "CORE").error, /dropped: an ID is never reused/);
  assert.match(roadmdFails(dir, "set", "CORE-4", "doing").errors.join("\n"), /CORE-4 is doing but CORE-3/);
  assert.match(roadmdFails(dir, "rename", "UI-1", "UI-5").errors.join("\n"), /UI-5 is test but UI-2, an earlier stage, is tech/); // n is the build order
  assert.match(roadmdFails(dir, "after", "UI-2", "-UI-1").error, /by its number, not by a line/);
});

test("edits: rename follows every reference; drop needs nothing waiting", () => {
  const dir = folderCopy();
  const r = roadmd(dir, "rename", "MAP-1", "MAP-2");
  assert.deepEqual(r.changed.sort(), ["MAP-2", "UI-2"]);
  assert.ok(!fs.existsSync(path.join(dir, "docs", "roadmap", "MAP-1.md")));
  assert.match(file(dir, "MAP-2"), /^was: MAP-1$/m);
  assert.match(file(dir, "UI-2"), /^after: MAP-2$/m);
  assert.match(roadmdFails(dir, "drop", "CORE-2", "no").error, /MAP-2, UI-1 still name CORE-2/);
  roadmd(dir, "drop", "CORE-4", "superseded by CORE-3");
  assert.match(file(dir, "CORE-4"), /^state: dropped\n\n\d{4}-\d\d-\d\d, dropped: superseded by CORE-3\n$/m);
  assert.equal(roadmd(dir, "check").ok, true);
});

test("edits: an ID is fixed from the config's fixedFrom state on", () => {
  const dir = folderCopy();
  const p = path.join(dir, "roadmd.config.json");
  const cfg = JSON.parse(fs.readFileSync(p, "utf8"));
  cfg.ids = { ...cfg.ids, fixedFrom: "doing" };
  fs.writeFileSync(p, JSON.stringify(cfg));
  assert.match(roadmdFails(dir, "rename", "UI-1", "UI-5").error, /from doing on an ID never changes/);
  assert.equal(roadmd(dir, "rename", "MAP-1", "MAP-2").ok, true);
});

test("edits: milestones and areas, and moving a feature's every stage", () => {
  const dir = folderCopy();
  roadmd(dir, "milestone", "add", "M3", "Third", "--tag", "later");
  roadmd(dir, "milestone", "move", "M3", "--before", "M2");
  roadmd(dir, "area", "add", "NET", "multiplayer");
  const b = fs.readFileSync(path.join(dir, "docs", "roadmap", "_board.md"), "utf8");
  assert.match(b, /### M1[\s\S]*### M3 Third — later[\s\S]*### M2[\s\S]*### Continuous tracks/);
  assert.match(b, /### NET — multiplayer/);
  assert.match(roadmdFails(dir, "milestone", "move", "C", "--before", "M1").error, /continuous track stays last/);
  const r = roadmd(dir, "move", "UI-2", "--area", "NET");
  assert.deepEqual(r.changed.sort(), ["UI-1", "UI-2"]);
  assert.equal(roadmd(dir, "check").ok, true);
});

test("edits on Encyclist: only the changed fields of the changed records", async () => {
  const fake = await startFakeEncyclist();
  try {
    const dir = await encyclistCopy(fake);
    await roadmdAsync(dir, "convert", "--to-config", "encyclist.config.json");
    const snapshot = () => JSON.stringify([...fake.entities.values()].filter((e) => !["MAP-1", "UI-2"].includes(e.data.key)).map((e) => e.data));
    const before = snapshot();
    await roadmdAsync(dir, "set", "MAP-1", "tech", "--config", "encyclist.config.json");
    await roadmdAsync(dir, "after", "UI-2", "-MAP-1", "--config", "encyclist.config.json");
    const rec = (k) => [...fake.entities.values()].find((e) => e.type === "roadmap_item" && e.data.key === k).data;
    assert.equal(rec("MAP-1").state, "tech");
    assert.equal(rec("UI-2").after, null);                            // cleared, not left behind
    assert.equal(snapshot(), before);
    await roadmdAsync(dir, "rename", "IDEA-1", "IDEA-2", "--config", "encyclist.config.json");
    assert.deepEqual(rec("IDEA-2").was, ["IDEA-1"]);
    assert.equal([...fake.entities.values()].filter((e) => e.data.key === "IDEA-1").length, 0);  // the same record, renamed
    await roadmdAsync(dir, "drop", "CORE-4", "gone", "--config", "encyclist.config.json");
    assert.equal(rec("CORE-4").state, "dropped");
    await roadmdAsync(dir, "milestone", "add", "M3", "Third", "--config", "encyclist.config.json");
    const ms = [...fake.entities.values()].filter((e) => e.type === "roadmap_milestone").sort((a, b) => a.data.order - b.data.order).map((e) => e.data.key);
    assert.deepEqual(ms, ["M1", "M2", "M3", "C"]);
    assert.equal((await roadmdAsync(dir, "check", "--config", "encyclist.config.json")).ok, true);
  } finally { await fake.close(); }
});

// ---- serve
import { startServer } from "../lib/server.mjs";
test("serve: the page and the API behind the password, /health open", async () => {
  const server = await startServer({ configFile: path.join(fixture, "roadmd.config.json"), port: 0, host: "127.0.0.1", password: "pw", log: () => {} });
  const base = `http://127.0.0.1:${server.address().port}`;
  const auth = { authorization: "Basic " + Buffer.from("anyone:pw").toString("base64") };
  try {
    assert.equal((await fetch(`${base}/health`)).status, 200);
    assert.equal((await fetch(`${base}/`)).status, 401);
    assert.equal((await fetch(`${base}/`, { headers: { authorization: "Basic " + Buffer.from("x:wrong").toString("base64") } })).status, 401);
    const page = await fetch(`${base}/`, { headers: auth });
    assert.equal(page.status, 200);
    assert.match(await page.text(), /<title>Fixture roadmap<\/title>/);
    const next = await (await fetch(`${base}/api/next`, { headers: auth })).json();
    assert.deepEqual(next.sections.find((s) => s.id === "build").items.map((i) => i.id), ["CORE-3"]);
    const board = await (await fetch(`${base}/api/board`, { headers: auth })).json();
    assert.equal(Object.keys(board.items).length, 9);
    assert.equal((await fetch(`${base}/api/board`, { method: "POST", headers: auth })).status, 405);
  } finally { server.close(); }
});

test("encyclist documents: the page's documents, and an item's references to them as relationships", async () => {
  const fake = await startFakeEncyclist({ docs: [
    { doc_id: "doc_000000a1", title: "Capture Mechanics v1.0", content: "# Capture\n\n## Scoring\n\nPoints.", tags: ["design"] },
    { doc_id: "doc_000000a2", title: "Audio System", content: "# Audio", tags: ["audio"] },
  ] });
  try {
    const dir = await encyclistCopy(fake);
    const p = path.join(dir, "encyclist.config.json");
    const cfg = JSON.parse(fs.readFileSync(p, "utf8"));
    cfg.docs = { source: "encyclist" };
    cfg.docKinds = [{ id: "design", label: "Design", tags: ["design"] }, { id: "other", label: "Other", match: "**" }];
    delete cfg.states.find((s) => s.id === "ready").requires;
    fs.writeFileSync(p, JSON.stringify(cfg));
    await roadmdAsync(dir, "convert", "--to-config", "encyclist.config.json");
    const c = ["--config", "encyclist.config.json"];
    await roadmdAsync(dir, "edit", "MAP-1", "--docs", "Capture Mechanics v1.0 *Scoring* · Audio System · Capture Mechanics v1.0 *Intro* · NOTES.md", ...c);
    const rels = [...fake.rels.values()];
    assert.equal(rels.length, 2);                                     // one per item and document
    const capture = rels.find((r) => r.to_id === "doc_000000a1");
    assert.deepEqual(capture.properties.refs.map((r) => r.text), ["Capture Mechanics v1.0 *Scoring*", "Capture Mechanics v1.0 *Intro*"]);
    const rec = [...fake.entities.values()].find((e) => e.data.key === "MAP-1");
    assert.deepEqual(rec.data.docs, ["NOTES.md"]);                    // only what isn't the knowledge base's own
    const show = await roadmdAsync(dir, "show", "MAP-1", ...c);
    assert.deepEqual(show.links.map((l) => [l.doc, l.anchor]), [["doc_000000a1", "Scoring"], ["doc_000000a2", null], ["doc_000000a1", "Intro"]]);
    const m = await loadModel(p);
    assert.equal(m.docMeta.doc_000000a1.title, "Capture Mechanics v1.0");
    assert.match(m.docs.doc_000000a1, /## Scoring/);
    await roadmdAsync(dir, "edit", "MAP-1", "--docs", "Audio System", ...c);
    assert.deepEqual([...fake.rels.values()].map((r) => r.to_id), ["doc_000000a2"]);
    await run("node", [cli, "build", ...c], { cwd: dir });            // async: this process hosts the fake server
    const html = fs.readFileSync(path.join(dir, "docs", "roadmap.html"), "utf8");
    assert.match(html, /"doc_000000a1":\{"title":"Capture Mechanics v1.0"/);
  } finally { await fake.close(); }
});
