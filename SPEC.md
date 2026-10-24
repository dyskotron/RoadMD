# roadmd: spec

> Status: **draft 0.2** (2026-10-24). Decisions 1-4 answered by Matej; 5-10 are the proposed defaults, open until he
> says otherwise. Steps: 1 built (read-only tool + proof), 2-5 to do.

A very small Jira for working with AI agents. One markdown file is the task board; a generated page shows it with
every design document embedded; agents read the board, keep it true and pick their next work from it with a CLI.
Git is the history: no database, no accounts, no changelog. Born as ShooterReborn's `tools/roadmap/`, made universal:
everything about a project's process lives in its config.

## Decisions

1. **The board is markdown with a line grammar** (answered). One line per item; the existing ShooterReborn board
   reads unchanged. See *The board*.
2. **Page edits go through a tiny local server** (answered): `roadmd serve` shows the page with editing on and
   writes through the same code as the CLI. The published static page stays read-only.
3. **The process is data, the grammar is code** (answered). Config: states, what each needs, document kinds, review
   lines, ID patterns, paths, labels. Fixed: the grammar's skeleton, what dependencies mean, the checks, the ranking,
   the page's layout.
4. **Name and home** (answered): `roadmd`, repository `C:\DATA\PROJECTS\roadmd`.
5. **How a project gets it** (default): a copied folder (`tools/roadmd/`), refreshed by a `roadmd update` command from
   the repository. Works offline and in every worktree; no submodule, no npm.
6. **Page edits and git** (default): the server only writes the file; the person or the roadmap thread commits.
7. **Owner-only changes** (default): the config marks transitions only the owner makes (`test → done`); the page can
   make them, the CLI only with `--owner`, which the agent rules forbid. A convention, not security.
8. **Rename** (default): rewrites every reference on the board, adds a line under *Renumbered*, and lists the
   documents that mention the old ID for the agent to fix.
9. **Stack** (default): Node 18+, no dependencies, one HTML template.
10. **Owner's name** (default): `owner` in the config, used in texts and in notes like `done (accepted by <owner> <date>)`.

## The board

```
# Title
## Next                       a sentence: the list is computed, a bullet here is an error
## Milestones
### M1 Title — tag            then prose, then the items by ID (ranges X-1 … X-4)
### Continuous tracks          may use FEATURE-* or AREA-*
## The tree
### CODE — Area title          intro lines, then items:
- **ID Title** — state (qualifier) · after IDs · feeds IDs · with IDs · a document · free text
  indented lines: the note
## Renumbered                 renames of items not started yet
## Dropped                    retired items, same line shape, with the date and reason
```

- IDs are `FEATURE-n` (pattern in the config); **n is the build order**: stage n waits for stage n−1 unless the
  feature is listed as `unordered`.
- `after` = waits for, `feeds` = the other waits for this, `with` = built together.
- A document part is a markdown link relative to the board, a path in backticks, a configured short name, or a
  document's file name (minus configured suffixes), optionally followed by a section (configured anchor patterns,
  `*Italics*` by default).

## The config (`roadmd.config.json`, at the project's root)

- `board`, `page`, `title`, `owner`, `nextSize`.
- `ids.pattern`, `ids.unordered`, `areas.pattern`, `milestones.pattern`.
- `states`, in pipeline order. Each: `id`, `color` (+ `darkColor`), `meaning`, and any of
  - `active`: being worked on now (listed *In progress*);
  - `work`: the work an item in this state is waiting for (`id`, `label`, `next`, `lead`), with `needs`: the state
    every item it waits for must have reached before this work can start, and `waiting` (label, lead) to list the
    ones that can't yet;
  - `earlierStages`: the state every earlier stage of the feature must have reached (an error otherwise);
  - `requires`: documents the item needs in this state (`docKind`, `review`, `level` warning/error);
  - `final`: the end (done items are history); `milestoneOptional`.
- `overview` (the page's and `next`'s order), `next` (the work kinds with a computed Next list), `boardOrder`.
- `docs`: `include` (globs of embedded documents), `names` (short names), `stemSuffixes`, `anchors`.
- `docKinds`: groups of documents by glob (`label`, `lead`, `match`, `displayName`), optionally `perItem` (one per
  item: linked on its line, else `path` with `{feature}`) and `review` (`files`, `line` regex, `states` with match,
  label, colour and `ok`, an `overview` label, an `index` table written between markers in a file).

Example: [examples/shooterreborn/roadmd.config.json](examples/shooterreborn/roadmd.config.json) (today's rules).

## Commands (built: step 1)

`roadmd check` · `roadmd build` · `roadmd next [work|doing|review]` · `roadmd show ID`; `--json` on each,
`--config <file>` (default: found upward from the current folder). Exit 1 on board errors.

## Steps

1. **Read-only tool and proof** — built. Config-driven check, next, show, build; the page from the config. Proof:
   ShooterReborn's board from a copy of its `docs/` gives the same `next` lists and the same page data
   (`proof/compare.mjs`), apart from two fixes of the original's narrow patterns (README *Proof*).
2. **Editing from the CLI**: `set ID state [note]`, `add`, `title`, `note`, `after`/`with` changes, `move` (milestone,
   area), `rename`, `drop`, milestone reorder; surgical line edits that keep everything else byte for byte, re-check
   before writing, refuse what breaks the board; owner-only transitions (decision 7).
3. **`roadmd serve`**: the page with edit controls calling those operations; refuses an edit when the file changed
   since the page loaded; reloads when the file changes on disk.
4. **Agent kit**: the CLAUDE.md snippet (how threads use the board, who changes which state, when to check) and
   `update` (decision 5).
5. **Bootstrap**: the procedure, an agent prompt and a Claude Code skill: study a project's documents, code and git
   history, write its config and first board with each state's evidence, present it for correction.

## Open questions

- Decisions 5-10 above (defaults until answered).
