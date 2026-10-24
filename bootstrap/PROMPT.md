# Agent prompt: bootstrap a project's roadmd board

You are writing the first roadmap board for a project, as a draft for its owner to correct. Follow
[PROCEDURE.md](PROCEDURE.md) (read it first) and roadmd's formats (its README and SPEC: *The format*).

You get:
- **The project's material**: its documents (files, or an Encyclist knowledge base's documents), its structured data,
  and its code and git history if it has any.
- **The process**: the project's roadmd config (`states`), or the owner's answers for one.
- **The owner's name** and who edits.
- **Where to write the draft**: a scratch folder (the folder format: `_board.md` + one `<ID>.md` per item).

Do:
1. Read every document in full. List them (title, date, size, one line on what it covers, current / superseded /
   duplicate) in `STUDY.md` next to the draft.
2. Write the draft board in the folder format: areas and milestones in `_board.md`, one file per item with its state,
   area, milestone, `after`/`with`, `docs` (exact document titles, a section in italics when only part applies) and a
   note citing the evidence for any state past the first.
3. Run `roadmd check` on it (a config whose storage is that folder) and fix every error.
4. Write `QUESTIONS.md`: every guess, duplicate, contradiction and missing decision, each with your recommendation.
5. Report briefly: how many areas, features, items and milestones, the questions' count, and anything surprising.

Never: mark an owner-only state; invent work the material doesn't describe; resolve a contradiction yourself; write
anywhere but the draft folder.
