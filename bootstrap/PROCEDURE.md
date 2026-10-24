# Bootstrapping a project's board

How an agent writes a project's first roadmd board: it studies everything the project has (documents, code, git
history, a knowledge base), proposes the board, and the owner corrects it. The board is a draft until the owner says it
is right; nothing is written into the project's real storage before that.

The agent prompt is [PROMPT.md](PROMPT.md): give it to an agent with this file, the project's config (or the owner's
answers for one) and access to the project.

## What the owner decides first

- **The process**: the states in pipeline order and what each needs (roadmd's config, `states`). Offer ShooterReborn's
  (`examples/shooterreborn/roadmd.config.json`: backlog → design → tech → ready → doing → test → done, with tech
  designs and reviews) or a simpler one (idea → design → doing → done), or let the study propose one.
- **Who** owns the board (who accepts work: owner-only states) and who edits.
- **Where** the board lives (a folder in the repo, or the project's Encyclist) and where the documents are.

## The steps

1. **Read everything, list it.** Every document (title, date, size, what it covers, whether it is current, superseded
   or a duplicate), the code's main parts if there is code, the git history's shape (what was built when), any
   structured data (an Encyclist's entity types and counts). Note contradictions and duplicates: they go to the owner,
   never silently resolved.
2. **Areas.** The project's big parts, 5 to 15, each a short code (`[A-Z]{2,5}`) and a title. An area is a row of the
   board; it holds features, not tasks.
3. **Features and stages.** Each feature gets one capitalised word (`CAPTURE`, `AUDIO`) and its stages `FEATURE-1`,
   `FEATURE-2`, … in build order: stage 1 is the smallest thing other work can build on. A stage is one deliverable,
   not a task list. A list of independent ideas that are not stages gets its prefix marked `unordered`.
4. **States, from evidence.** Each item's state is what is true now: written design → design; built and shipped →
   done (or the state before the owner's acceptance, when acceptance is owner-only: the agent never marks owner-only
   states); only mentioned → the first state. Every state other than the first one cites its evidence in the item's
   note ("design: <document>, sections X–Y"). When unsure, the earlier state, and a question.
5. **Dependencies.** `after` only where one stage really needs another to exist first (not "related to"); `with` for
   two built together. No cycles; nothing waits for something in a later milestone.
6. **Milestones.** Vertical slices, each one a thing a person can use or play, in order (M1, M2, …); a design item sits
   in the milestone whose build needs it. Not dates. A continuous track for work that never ends (housekeeping, tools).
7. **Documents.** Each item links the documents that describe it (`docs`): by exact title (Encyclist) or path (files),
   with a section in italics when only part of a document is about it. An item without a document says so in its note.
8. **Check and present.** `roadmd check` must pass. Then present to the owner: the areas, the milestones with their
   items, each feature's stages, the states with their evidence, and the list of questions (duplicates, contradictions,
   guesses). The owner corrects; the agent applies the corrections with roadmd's edit commands and checks again.

## Rules

- Never invent work the project doesn't describe or imply; an idea from the agent goes to the questions, not the board.
- Never resolve a contradiction between documents by choosing one: ask.
- Keep titles short and in the project's own words; the detail stays in the documents.
- The draft is written somewhere the owner can look at (a scratch folder, a dev copy of the knowledge base), never into
  the real storage before the owner approves it.
