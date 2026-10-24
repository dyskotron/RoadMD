# roadmd

A markdown task board for projects built with AI agents. The board is plain markdown (one small file per item), a
generated page shows it with every design document embedded, and agents read it, keep it true and pick their next
work from it. Git is the history. Node 18+, no dependencies. Design and plan: [SPEC.md](SPEC.md).

## Use

Put a `roadmd.config.json` at the project's root (start from
[examples/shooterreborn/roadmd.config.json](examples/shooterreborn/roadmd.config.json)). Its `storage` says where
the board lives: `{ "type": "folder", "path": "docs/roadmap" }` (one markdown file per item, plus `_board.md`:
SPEC.md *The format*) or `{ "type": "file", "path": "docs/ROADMAP.md" }` (the older single file, read only). Then
from anywhere in the project:

```bash
node path/to/roadmd.mjs check          # check the board, write nothing; exit 1 on an error
node path/to/roadmd.mjs build          # check, write the page (and any review index)
node path/to/roadmd.mjs next           # what can be worked on now, and Next
node path/to/roadmd.mjs next build     # one kind of work (the config's work ids), doing, or review
node path/to/roadmd.mjs show EVA-1     # one item
node path/to/roadmd.mjs convert        # a single-file board into a folder (default: roadmap/ beside it)
```

Add `--json` for machine-readable output, `--config <file>` to point at a config elsewhere.

Tests: `npm test` (Node's own runner, no dependencies; a small board in `tests/fixture`).

## Files

- `roadmd.mjs` — the CLI.
- `lib/config.mjs` — loads and checks the config.
- `lib/ids.mjs` — the patterns every format shares, and the item model.
- `lib/storage.mjs` — where a board lives: `file` or `folder` (async: Encyclist comes next).
- `lib/single.mjs` — the single-file format, read into the model (pure).
- `lib/folder.mjs` — the folder format, read and written (pure).
- `lib/convert.mjs` — a board moved into the folder format.
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

Step 2, 2026-10-24: the folder gives exactly what the single file gives (page data and `next`); against the original
script only the step-1 fixes below and `---` rules no longer leaking into the last area's and the continuous track's
text.

Step 1, against the original (`dev` of 2026-10-24): 216 items, 20 milestones, 17 areas, 151 documents; every item's fields (state,
dependencies, impact, documents, tech design), the Next lists, the review states and every document identical; `next`
prints the same items in the same order in every section. Two differences, both fixes of the original's narrow
patterns (2-5 letter prefixes): milestone captions no longer repeat ID lists with longer prefixes (`COLLIDE-1`), and
the dropped list includes the 7 items with longer prefixes it missed (`FINISH-2`, `SHIPAI-1`, …). One new warning:
GDD-6's `feeds FOOT-*` names no item (the original ignores it silently).
