#!/usr/bin/env node
// Assembles a deployable folder: roadmd's code + one project's site.
//   node deploy/stage.mjs <site dir> <out dir>
// The site dir holds the project's roadmd.config.json, its fly.toml and whatever documents the config embeds.
// Then: cd <out dir> && fly deploy   (secrets such as ROADMD_PASSWORD and the storage's keyEnv set with fly secrets)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const [site, out] = process.argv.slice(2).map((p) => p && path.resolve(p));
if (!site || !out) { console.error("usage: stage.mjs <site dir> <out dir>"); process.exit(2); }
for (const f of ["roadmd.config.json", "fly.toml"]) if (!fs.existsSync(path.join(site, f))) { console.error(`${site} has no ${f}`); process.exit(2); }
const cfg = JSON.parse(fs.readFileSync(path.join(site, "roadmd.config.json"), "utf8"));
if (cfg.storage?.envFile) { console.error("the site's config names an envFile: on a server the key comes from a secret (fly secrets set " + cfg.storage.keyEnv + "=…)"); process.exit(2); }
fs.rmSync(out, { recursive: true, force: true });
for (const p of ["roadmd.mjs", "package.json", "lib", "page", "bootstrap"]) fs.cpSync(path.join(repo, p), path.join(out, "app", p), { recursive: true });
fs.cpSync(site, path.join(out, "site"), { recursive: true, filter: (p) => !/(^|[\/])(\.env|\.dev\.env|\.git)$/.test(p) });
fs.copyFileSync(path.join(repo, "deploy", "Dockerfile"), path.join(out, "Dockerfile"));
fs.copyFileSync(path.join(site, "fly.toml"), path.join(out, "fly.toml"));
fs.writeFileSync(path.join(out, ".dockerignore"), "fly.toml\n");
console.log(`staged ${out}: app/ (roadmd), site/ (${path.basename(site)}), Dockerfile, fly.toml`);
