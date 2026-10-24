# roadmd

A markdown task board for projects built with AI agents. One plain file is the board (`ROADMAP.md`), a generated
page shows it with every design document embedded, and agents read it, keep it true and pick their next work from
it. Git is the history. Node 18+, no dependencies. Design and plan: [SPEC.md](SPEC.md).

## Use

Put a `roadmd.config.json` at the project's root (start from
[examples/shooterreborn/roadmd.config.json](examples/shooterreborn/roadmd.config.json)), then from anywhere in it:

```bash
node path/to/roadmd.mjs check          # check the board, write nothing; exit 1 on an error
node path/to/roadmd.mjs build          # check, write the page (and any review index)
node path/to/roadmd.mjs next           # what can be worked on now, and Next
node path/to/roadmd.mjs next build     # one kind of work (the config's work ids), doing, or review
node path/to/roadmd.mjs show EVA-1     # one item
```

Add `--json` for machine-readable output, `--config <file>` to point at a config elsewhere.

## Files

- `roadmd.mjs` — the CLI.
- `lib/config.mjs` — loads and checks the config.
- `lib/board.mjs` — the board's grammar (pure).
- `lib/docs.mjs` — embedded documents, document references, review lines and indexes.
- `lib/analyze.mjs` — the checks, what can be worked on, the ranking (pure).
- `lib/model.mjs` — one run's model and the page's data.
- `page/page.html` — the page template; all rules come in as data.
- `proof/compare.mjs` — compares a page built by ShooterReborn's original script with roadmd's.

## Proof (ShooterReborn)

From a copy of ShooterReborn's `docs/`, `CLAUDE.md` and the two Assets readmes (`git archive dev …`), with
`examples/shooterreborn/roadmd.config.json` at its root:

```bash
node tools/roadmap/build.mjs && cp docs/roadmap.html ../original.html   # the original, in the copy
node /c/DATA/PROJECTS/roadmd/roadmd.mjs build
node /c/DATA/PROJECTS/roadmd/proof/compare.mjs ../original.html docs/roadmap.html
```

Result on `dev` of 2026-10-24: 216 items, 20 milestones, 17 areas, 151 documents; every item's fields (state,
dependencies, impact, documents, tech design), the Next lists, the review states and every document identical; `next`
prints the same items in the same order in every section. Two differences, both fixes of the original's narrow
patterns (2-5 letter prefixes): milestone captions no longer repeat ID lists with longer prefixes (`COLLIDE-1`), and
the dropped list includes the 7 items with longer prefixes it missed (`FINISH-2`, `SHIPAI-1`, …). One new warning:
GDD-6's `feeds FOOT-*` names no item (the original ignores it silently).
