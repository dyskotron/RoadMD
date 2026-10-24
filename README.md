# roadmd

A markdown task board for projects built with AI agents. The board is plain markdown (one small file per item), a
generated page shows it with every design document embedded, and agents read it, keep it true and pick their next
work from it. Git is the history. Node 18+, no dependencies. Design and plan: [SPEC.md](SPEC.md).

## Use

Put a `roadmd.config.json` at the project's root (start from
[examples/shooterreborn/roadmd.config.json](examples/shooterreborn/roadmd.config.json)). Its `storage` says where
the board lives: `{ "type": "folder", "path": "docs/roadmap" }` (one markdown file per item, plus `_board.md`:
SPEC.md *The format*), `{ "type": "encyclist", "url": "…/mcp", "keyEnv": "…" }` (entities of an Encyclist knowledge
base: [examples/encyclist.config.json](examples/encyclist.config.json); the API key from that environment variable or
an `envFile`, never from the config) or `{ "type": "file", "path": "docs/ROADMAP.md" }` (the older single file, read
only). Then from anywhere in the project:

```bash
node path/to/roadmd.mjs check          # check the board, write nothing; exit 1 on an error
node path/to/roadmd.mjs build          # check, write the page (and any review index)
node path/to/roadmd.mjs next           # what can be worked on now, and Next
node path/to/roadmd.mjs next build     # one kind of work (the config's work ids), doing, or review
node path/to/roadmd.mjs show EVA-1     # one item
node path/to/roadmd.mjs convert        # a single-file board into a folder (default: roadmap/ beside it)
node path/to/roadmd.mjs convert --to-config other.json   # copy the board into another config's storage (e.g. Encyclist)
node path/to/roadmd.mjs serve --port 8080   # the page and /api/board, /api/next, /api/check over HTTP (ROADMD_PASSWORD)
```

Deploying the server (Fly.io): [deploy/README.md](deploy/README.md).

**Agents** connect to the server's MCP, `https://<server>/mcp` (Streamable HTTP), with a roadmd key in the
`X-API-Key` header (the server's `ROADMD_KEYS`: `[{ "name", "key", "role": "owner" | "editor" | "reader" }]`).
Claude Code: `claude mcp add --transport http roadmd https://<server>/mcp --header "X-API-Key: <key>"`. The agent
calls `roadmap_guide` first: it explains the project's process and rules and how to start a board; the documents are
read through `roadmap_docs_list` / `roadmap_doc_read`; every edit is checked and refused with its reasons when it
would break the board; only an owner key sets an owner-only state.

With an Encyclist board, `"docs": { "source": "encyclist" }` makes the knowledge base's own documents the page's
documents: an item names one by its exact title (or `doc_…` ID), optionally with a section after it, and roadmd keeps
that link as a `documented_by` relationship, so the document shows its items in Encyclist too.

Starting a project's first board: [bootstrap/PROCEDURE.md](bootstrap/PROCEDURE.md) (and the agent prompt beside it).

Edits (a folder or Encyclist board; each is checked against the whole board and refused if it would add an error,
and only what it changes is written):

```bash
roadmd set MAP-1 tech                       # a state (and an optional note: roadmd set X done "accepted by …")
roadmd add MAP-2 "The big map" --area UI --milestone M5 --after "MAP-1 HUD-5" --docs "MAP_SPEC" --note "…"
roadmd edit MAP-2 --title "…" --note "…" --state-note "…" --docs "a · b" --text "a · b"
roadmd after MAP-2 +NAV-1 -HUD-5            # add / remove what it waits for (also: roadmd with …)
roadmd move MAP-2 --milestone M6            # or --milestone none, or --area CODE (every stage of the feature moves)
roadmd rename MAP-2 MAP-3                   # every reference follows; the item keeps was: MAP-2
roadmd drop MAP-3 "folded into MAP-1"
roadmd milestone add M7 "Title" --tag … --before M6     roadmd milestone set|move M7 …
roadmd area add NET "multiplayer"                       roadmd area set NET --title …
```

`--dry-run` checks an edit without writing it; `--owner` sets an owner-only state (the config's `ownerOnly`), only when
the owner says so.

Add `--json` for machine-readable output, `--config <file>` to point at a config elsewhere.

Tests: `npm test` (Node's own runner, no dependencies; a small board in `tests/fixture`, an in-memory Encyclist in
`tests/fake-encyclist.mjs`).

## Files

- `roadmd.mjs` — the CLI.
- `lib/config.mjs` — loads and checks the config.
- `lib/ids.mjs` — the patterns every format shares, and the item model.
- `lib/storage.mjs` — where a board lives: `file`, `folder` or `encyclist` (async).
- `lib/encyclist.mjs` — the board as Encyclist entities; `lib/mcp.mjs` — the MCP client it talks through.
- `lib/single.mjs` — the single-file format, read into the model (pure).
- `lib/folder.mjs` — the folder format, read and written (pure).
- `lib/convert.mjs` — a board moved into the folder format.
- `lib/edit.mjs` — edits: applied to a copy, the board checked again, only the changes written.
- `lib/server.mjs` — `roadmd serve`; `lib/page.mjs` — the page, for build and serve alike.
- `lib/mcpserver.mjs` — the agents' MCP: the tools, keys and roles.
- `deploy/` — the Dockerfile, `stage.mjs` and an example `fly.toml` for running it on Fly.
- `lib/docs.mjs` — embedded documents, document references, review lines and indexes.
- `lib/analyze.mjs` — the checks, what can be worked on, the ranking (pure).
- `lib/model.mjs` — one run's model and the page's data.
- `page/page.html` — the page template; all rules come in as data.
- `proof/shooterreborn.mjs` — the ShooterReborn proof end to end; `proof/compare.mjs` compares two pages' data.

## Proof (ShooterReborn)

```bash
node proof/shooterreborn.mjs C:/DATA/PROJECTS/ShooterReborn <scratch dir>
```

It copies ShooterReborn's `docs/`, `CLAUDE.md`, the two Assets readmes and its `tools/roadmap` from `dev` (`git
archive`: the repository is never changed), builds the page with ShooterReborn's own script, then with roadmd from the
single file, then converts it to a folder and builds again, and compares the three.

Encyclist (2026-10-24): the same board copied into the dev app (`roadmd convert --to-config` with a config whose
storage is `encyclist-dev.fly.dev`) and read back gives exactly the folder's page data and `next`, in the same order;
the board loads from it in about half a second.

Step 2, 2026-10-24: the folder gives exactly what the single file gives (page data and `next`); against the original
script only the step-1 fixes below and `---` rules no longer leaking into the last area's and the continuous track's
text.

Step 1, against the original (`dev` of 2026-10-24): 216 items, 20 milestones, 17 areas, 151 documents; every item's fields (state,
dependencies, impact, documents, tech design), the Next lists, the review states and every document identical; `next`
prints the same items in the same order in every section. Two differences, both fixes of the original's narrow
patterns (2-5 letter prefixes): milestone captions no longer repeat ID lists with longer prefixes (`COLLIDE-1`), and
the dropped list includes the 7 items with longer prefixes it missed (`FINISH-2`, `SHIPAI-1`, …). One new warning:
GDD-6's `feeds FOOT-*` names no item (the original ignores it silently).
