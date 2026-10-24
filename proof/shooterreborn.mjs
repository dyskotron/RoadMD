#!/usr/bin/env node
// The ShooterReborn proof, end to end:
//   node proof/shooterreborn.mjs <ShooterReborn repo> <scratch dir> [branch=dev]
// 1. copies the branch's docs/, CLAUDE.md, the two Assets readmes and tools/roadmap into <scratch>/single (git archive;
//    the repository is never changed)
// 2. builds the page with ShooterReborn's own tools/roadmap/build.mjs (the reference)
// 3. builds it with roadmd from the single file, with examples/shooterreborn/roadmd.config.json
// 4. copies that to <scratch>/folder, runs `roadmd convert`, switches the config to the folder and builds again
// 5. compares: original ↔ single file, single file ↔ folder (proof/compare.mjs), and `next` of both
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const roadmd = path.join(here, "..", "roadmd.mjs");
const compare = path.join(here, "compare.mjs");
const [repo, scratch, branch = "dev"] = process.argv.slice(2);
if (!repo || !scratch) { console.error("usage: shooterreborn.mjs <ShooterReborn repo> <scratch dir> [branch]"); process.exit(2); }

const run = (cmd, args, cwd, opts = {}) => execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts });
const single = path.join(scratch, "single"), folder = path.join(scratch, "folder");
fs.rmSync(scratch, { recursive: true, force: true });
fs.mkdirSync(single, { recursive: true });

const tar = run("git", ["-C", repo, "archive", branch, "docs", "CLAUDE.md", "Assets/Nebula/README.md", "Assets/Station/README.md", "tools/roadmap"], scratch, { encoding: "buffer", maxBuffer: 1 << 30 });
fs.writeFileSync(path.join(scratch, "docs.tar"), tar);
run("tar", ["-xf", "docs.tar", "-C", "single"], scratch); // relative: GNU tar reads "C:" as a host
fs.rmSync(path.join(scratch, "docs.tar"));
console.log(`copied ${branch}'s docs into ${single}`);

run("node", ["tools/roadmap/build.mjs"], single);
fs.copyFileSync(path.join(single, "docs", "roadmap.html"), path.join(scratch, "original.html"));
fs.rmSync(path.join(single, "tools"), { recursive: true });
console.log("1. the original script built original.html");

fs.copyFileSync(path.join(here, "..", "examples", "shooterreborn", "roadmd.config.json"), path.join(single, "roadmd.config.json"));
run("node", [roadmd, "build"], single);
const nextSingle = run("node", [roadmd, "next"], single);
console.log("2. roadmd built the page from the single file");

fs.cpSync(single, folder, { recursive: true });
console.log("3. " + run("node", [roadmd, "convert"], folder).split("\n")[0]);
const cfgPath = path.join(folder, "roadmd.config.json");
const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
cfg.storage = { type: "folder", path: "docs/roadmap" };
fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + "\n");
run("node", [roadmd, "build"], folder);
const nextFolder = run("node", [roadmd, "next"], folder);
console.log("   roadmd built the page from the folder");

let failed = false;
const cmp = (label, a, b) => {
  try { console.log(`\n${label}: ` + run("node", [compare, a, b, "--brief"], scratch).trim().split("\n").at(-1)); }
  catch (e) { failed = true; console.log(`\n${label}:\n` + (e.stdout || e.message).trim()); }
};
cmp("original ↔ roadmd (single file)", path.join(scratch, "original.html"), path.join(single, "docs", "roadmap.html"));
cmp("roadmd: single file ↔ folder", path.join(single, "docs", "roadmap.html"), path.join(folder, "docs", "roadmap.html"));
console.log(`\nnext, single file ↔ folder: ${nextSingle === nextFolder ? "identical" : "DIFFERENT"}`);
if (nextSingle !== nextFolder) failed = true;
process.exit(failed ? 1 : 0);
