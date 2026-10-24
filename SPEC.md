# roadmd: spec

> Status: **draft 0.4** (2026-10-24). Matej moved it from a local file tool to a shared remote one: decisions 11-17.
> Steps 1-3 and 4a built (roadmd-dev.fly.dev, read only) (the folder form proved on ShooterReborn: README *Proof*; edits from the CLI); step 5's storage half built (the board as
> Encyclist entities, proved on the dev app encyclist-dev.fly.dev).
> Step 1 built (read-only tool on today's single-file board, proved on ShooterReborn); the plan below is the new one.

A very small Jira for working with AI agents. The board is a set of small markdown documents stored next to the
project's design documents; roadmd is the engine that reads them (checks, what can be worked on now, the ranking),
edits them safely, and shows them on a page anyone on the project can open. Agents use the same board: through the
documentation store they already have, and through roadmd's own tools for its rules. Everything about a project's
process lives in its config.

## Decisions

1. ~~The board is one markdown file with a line grammar~~ — superseded by 12. Markdown stays (answered).
2. ~~Page edits go through a tiny local server~~ — superseded by 13.
3. **The process is data, the grammar is code** (answered). Config: states, what each needs, document kinds, review
   lines, ID patterns, labels. Fixed: the format's skeleton, what dependencies mean, the checks, the ranking, the
   page's layout.
4. **Name and home** (answered): `roadmd`, https://github.com/dyskotron/RoadMD (`main`).
5. ~~How a project gets it: a copied folder~~ — superseded by 13 (it runs as a service; a local run stays possible).
6. **Edits and history** (open): the store's own history where it has one (git: one commit per edit); otherwise
   roadmd keeps a short log of board edits.
7. **Owner-only changes** (built as a convention, step 3): a state with `"ownerOnly": true` (ShooterReborn: `done`) is
   refused unless the edit says `owner` (the CLI's `--owner`, which the agent rules forbid unless the owner said so);
   `ownerNote` (`"accepted by {owner} {date}"`) becomes its note when none is given. With accounts (step 5) it is
   enforced.
8. **Rename** (default): roadmd's operation, never by hand: the item's document, every item that refers to it, and a
   `was:` line on the item; documents that mention the old ID are listed for the agent to fix.
9. **Stack** (default): Node 18+, no dependencies unless they earn their place, one HTML page.
10. **Owner's name** (default): `owner` in the config, used in texts and notes like `done (accepted by <owner> <date>)`.
11. **One source of truth** (Matej, 2026-10-24): the board lives in the project's documentation store, next to the
    documents it links to, never in a second store that would have to be kept in sync. roadmd keeps no data of its own.
12. **One document per item** (Matej, 2026-10-24): an item is its own small markdown document (a few labelled lines,
    then free text), so a bad edit breaks only that item and two people or agents editing different items never
    collide. Board-wide things (areas, milestones and their order) are one small board document. See *The format*.
13. **roadmd is a service** (Matej, 2026-10-24): the engine plus the page plus an API, deployable on Fly.io (or run
    locally), reading and writing through a storage adapter. No database of its own.
14. **Storage adapters**: one small interface (list items with their change stamps, read, write, rename, delete);
    adapters for a git folder (also the local and test form) and for the project's documentation server. The
    documentation server may be changed to give roadmd what it needs (Matej: "we can change it to support whatever we
    need").
15. **Agents first** (Matej, 2026-10-24: the tool must be usable by any agent, to reason over the documentation and
    turn it into items): an agent with only the documentation store can read and edit items as markdown; roadmd also
    offers its rules as agent tools (MCP over HTTP: check, next, show, set a state, add, move, rename, drop), and the
    page shows anything an agent left broken.

16. **Items are Encyclist entities** (Matej, 2026-10-24) where the project uses Encyclist (github.com/hex-clawd/encyclist,
    live at encyclist.fly.dev with real data): entity types `roadmap_item` (key, title, state, state_note, area,
    milestone, after, with, body), `roadmap_milestone` (key, title, tag, body, order) and `roadmap_area` (key, title,
    intro, order), defined by roadmd on first use; dependencies are fields of the item (one record, one write); links
    from an item to the documents describing it are graph relationships `documented_by` (item → doc), so a document
    shows its items. Changes go through `ec_entity_update` (only the fields named), so one item can't break another.
    The same model is markdown files in a git folder for projects without Encyclist (*The format*).
17. **Encyclist gets what roadmd needs** (Matej: changes made locally first; the live data backed up and the
    migration proven on a copy before anything is deployed): API key roles (an owner role for owner-only
    transitions), a conditional update (change only if unchanged since a given `updated_at`), and the audit log
    keeping an entity change's before and after.

## The format

For the git-folder adapter (the Encyclist adapter stores the same fields as entities, decision 16).

The board document (`_board.md` in the board's folder):

```markdown
# ShooterReborn roadmap

## Areas
- GDD — game design
- SIM — world simulation and data

## Milestones
### M4 Ships and stations
Fly to a station, ask to land, …
### Continuous tracks
…
```

An item document (`<ID>.md`):

```markdown
# EVA-1 EVA: suit flight
state: done (accepted by Matej 2026-10-24)
area: FOOT
milestone: M4
after: GDD-20 BOARDING-1
with:
docs: EVA_SPEC, EVA_TECH
was:

Leaving a ship in space puts the character in EVA: inertia and suit thrusters on the ships' flight model.
```

- The labelled lines are the only parsed part; the body is free text (description, notes, acceptance, discussion).
- IDs `FEATURE-n`, n the build order (stage n waits for n−1 unless the feature is `unordered` in the config).
- `after` waits for, `with` built together; `feeds` goes (it is the other item's `after`).
- A dropped item keeps its document with state `dropped` (a fixed final state outside the pipeline) and its reason, so
  links to it still mean something.
- *Next* is computed, never stored.
- `roadmd convert` turns a single-file board (today's ShooterReborn `ROADMAP.md`) into this format.

## The config

As built in step 1 (README; example `examples/shooterreborn/roadmd.config.json`): states in pipeline order with
`work` / `needs` / `waiting`, `earlierStages`, `requires`, `active`, `final`; `overview`, `next`, `boardOrder`; the
documents and their kinds, short names, anchors, review lines; ID patterns. Since: `storage` (the adapter and its
settings: `file`, `folder`, `encyclist`), a state's `ownerOnly` and `ownerNote` (decision 7), `ids.fixedFrom` (the
state from which an ID never changes).

## Steps

1. **Read-only tool and proof** — built (single-file board).
2. **The item format and the git-folder adapter** — built. The storage interface (`lib/storage.mjs`: `file`, read
   only, and `folder`, read and write), the model every adapter loads (`lib/ids.mjs` `newItem`), `roadmd convert`
   (`lib/convert.mjs`), the folder format (`lib/folder.mjs`); tests (`npm test`); proof: ShooterReborn converted gives
   the same `next` and page data as its single file (`proof/shooterreborn.mjs`).
   As built: `feeds` becomes the other item's `after`; the single file's `## Renumbered` pairs become `was:`; an item's
   parts are kept as `docs:` (those that resolve to a document) and `text:`; relative links are rewritten for the
   item's folder; items in an area are ordered by ID (feature, then stage), no longer by their place in one file;
   `---` rules between sections are never content.
3. **Edits** — built (`lib/edit.mjs`, the CLI's `set`, `add`, `edit`, `after`, `with`, `move`, `rename`, `drop`,
   `milestone add|set|move`, `area add|set`; `--dry-run`, `--json`). Each edit is applied to a copy of the board, the
   whole board is checked again, and it is refused (nothing written) when it adds an error; a board that already has
   errors can still be edited. Only what changed is written: the item's file or record (Encyclist: only the changed
   fields, an emptied one cleared), `_board.md` / the area and milestone records for board-wide edits. As built:
   moving an item to another area moves every stage of its feature (one feature, one area); a rename updates every
   `after`/`with` naming the item, keeps the old ID in `was`, and is refused from `ids.fixedFrom` on (ShooterReborn:
   `doing`); a drop is refused while any item names the item, and writes `<date>, dropped: <reason>`; an ID is never
   reused (an existing or dropped one is refused); the single file is read only (`convert` first). The engine works
   on a copy of the board, so what it derives (the stage before, `feeds`) is never written into items.
4. **The service**: HTTP server with the page (editing on), the JSON API and the agent tools (MCP over HTTP); deploy
   to Fly.io.
   - **4a — built:** `roadmd serve` (`lib/server.mjs`, node:http, no dependencies): the page built from the board on a
     visit (kept 5 s; `?fresh=1` reads again), `/api/board`, `/api/next`, `/api/check`, `/health`; gzip; HTTP Basic auth
     with `ROADMD_PASSWORD`, everything but `/health`; writes refused. Deployment kit in `deploy/` (Dockerfile,
     `stage.mjs`, `fly.example.toml`, README). Running: `roadmd-dev.fly.dev`, ShooterReborn's board from
     `encyclist-dev` with its documents in the image.
   - **4b — to do:** editing on the page (the edits of step 3 through a JSON API, refused when the board changed since
     the page loaded), then the agent tools over MCP.
5. **The Encyclist adapter** (decision 16) and accounts (who may edit, who is the owner).
   - **Built: the board as entities** (`lib/encyclist.mjs`, over `lib/mcp.mjs`, a dependency-free MCP client): entity
     types `<prefix>_board`, `_area`, `_milestone` (with `order`), `_item` (the folder file's fields; a dropped item
     keeps its record with state `dropped`); the board loads in four queries; `roadmd convert --to-config <file>` copies
     any board into it (refusing a store that already holds one); an item is written back by `ec_entity_update`, only
     its own record. The API key comes from `keyEnv` (the environment, or `envFile`), never from the config. Proof:
     ShooterReborn's board in the dev app (`encyclist-dev.fly.dev`, its own empty volume and keys, Matej 2026-10-24)
     gives exactly the folder's page data and `next`; tests against an in-memory stand-in (`tests/fake-encyclist.mjs`).
   - **To do:** Encyclist's documents as the page's documents, and item → document links as `documented_by`
     relationships (today an item's `docs` are reference strings, as in its file); `if_updated_at` on writes once
     Encyclist has it; roles (decision 7).
6. **Agent kit**: the rules snippet for a project's CLAUDE.md (who changes which state, when to check).
7. **Bootstrap**: procedure, agent prompt and skill to study a project and write its first board.

## Open questions

- Accounts: who signs in, through what, and who is the owner (7, 13).
- History where the store has none (6).
