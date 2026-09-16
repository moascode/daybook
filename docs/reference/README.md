> **Status:** Live · **Last verified:** 2026-09-16

# Reference

How Daybook is actually built — the material a session needs to *look up*
rather than to obey. The rules and the hard-won traps stay in
[`../../CLAUDE.md`](../../CLAUDE.md); this folder holds what is long, stable,
and only needed on demand.

| Doc | What's in it |
|---|---|
| [architecture.md](architecture.md) | How the app is wired, what each historical layer was replaced by, and the approved package list |
| [database-schema.md](database-schema.md) | Every table, its invariants, the TypeScript types, and environment variables |
| [project-structure.md](project-structure.md) | The annotated file map for `src/`, `worker/`, `server/` and the deployment layout |
| [feature-specs.md](feature-specs.md) | What each module is meant to do. Sections marked unbuilt are design intent, **not** behaviour |
| [testing.md](testing.md) | E2E conventions, how to run the suite, and the seven traps it has already fallen into |
| [theming.md](theming.md) | The two colour families and why there is not one `dark:` variant in the codebase |
| [decisions.md](decisions.md) | Choices made deliberately, with reasons, so they aren't relitigated by accident |

These were extracted from `CLAUDE.md` on 2026-09-16, which went from 1,958 lines
to ~530. The split is by *kind*, not by topic: a rule or a trap is something you
must carry into every session, so it stays in `CLAUDE.md`; a schema definition is
something you look up when you touch the schema, so it lives here.
