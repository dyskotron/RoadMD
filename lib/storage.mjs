// Where a board lives (the config's `storage`). Every adapter loads the whole board into the model, so the engine
// never knows where the items are. Async because a remote store (Encyclist) answers over the network.
//
//   { "type": "file",   "path": "docs/ROADMAP.md" }   one markdown file (read-only: `convert` moves it to a folder)
//   { "type": "folder", "path": "docs/roadmap" }      one file per item + _board.md (a git folder)
//   { "type": "encyclist", "url": "…/mcp", "keyEnv": "…" }   entities of an Encyclist knowledge base (lib/encyclist.mjs)
import fs from "node:fs";
import path from "node:path";
import { readSingleFile } from "./single.mjs";
import { readFolder, BOARD_FILE, boardFileText, itemFileText, droppedFileText, itemFileName } from "./folder.mjs";
import { encyclistStorage } from "./encyclist.mjs";

export function openStorage(cfg) {
  const s = cfg.storage;
  if (s.type === "file") return fileStorage(cfg, s.path);
  if (s.type === "folder") return folderStorage(cfg, s.path);
  if (s.type === "encyclist") return encyclistStorage(cfg, s);
  throw new Error(`storage type "${s.type}" is not supported (file, folder, encyclist)`);
}

function fileStorage(cfg, rel) {
  const abs = path.join(cfg.root, rel);
  return {
    type: "file", path: rel, writable: false,
    async load() {
      if (!fs.existsSync(abs)) throw new Error(`the board ${rel} doesn't exist (config: ${cfg.file})`);
      return readSingleFile(fs.readFileSync(abs, "utf8"), cfg, rel);
    },
  };
}

function folderStorage(cfg, rel) {
  const abs = path.join(cfg.root, rel);
  const write = (name, text) => fs.writeFileSync(path.join(abs, name), text, "utf8");
  return {
    type: "folder", path: rel, writable: true,
    async load() {
      if (!fs.existsSync(abs)) throw new Error(`the board folder ${rel} doesn't exist (config: ${cfg.file})`);
      const files = {};
      for (const f of fs.readdirSync(abs)) if (f.endsWith(".md")) files[f] = fs.readFileSync(path.join(abs, f), "utf8");
      return readFolder(files, cfg, rel);
    },
    // Writes a whole board (convert), into an empty folder unless `force`.
    async writeAll(board, { force = false } = {}) {
      if (fs.existsSync(abs) && fs.readdirSync(abs).length && !force) throw new Error(`${rel} isn't empty (--force writes into it anyway)`);
      fs.mkdirSync(abs, { recursive: true });
      write(BOARD_FILE, boardFileText(board));
      for (const it of Object.values(board.items)) write(itemFileName(it.id), itemFileText(it));
      for (const d of board.dropped) write(itemFileName(d.id), droppedFileText(d));
    },
    async writeItem(it) { write(itemFileName(it.id), itemFileText(it)); },
    async deleteItem(it) { fs.rmSync(path.join(abs, itemFileName(it.id)), { force: true }); },
  };
}
