# Daybook documentation

Start here. Every document in this tree carries a status header; trust the
header, and when it says `Archived`, read it as history rather than as
instructions.

```
docs/
├── guides/     operating the live system — deploy, release, go-live, handoff
├── reference/  how the app is built — schema, architecture, conventions
├── roadmap/    what is planned and not yet built
│   └── design-adoption/   the redesign programme (R1–R18)
├── backlog/    features, bugs and brainstorms not yet scheduled
└── archive/    shipped or superseded. Kept for the reasoning, not the plan.
```

## Where things are

| You want… | Go to |
|---|---|
| To deploy, cut a release, or roll back | [guides/ci-cd.md](guides/ci-cd.md) |
| The database schema or architecture | [reference/](reference/) |
| What's being built next | [roadmap/design-adoption/README.md](roadmap/design-adoption/README.md) — the status board |
| To file a feature, bug or idea | [backlog/README.md](backlog/README.md) |
| Why a past decision was made | [archive/project-history.md](archive/project-history.md) |
| The rules Claude Code works under | [`../CLAUDE.md`](../CLAUDE.md) |

## Naming, and why it isn't `v1/v2/v3` any more

Until 2026-09 this tree was split into `docs/v1`, `docs/v2` and `docs/v3`. Those
were **not versions**, and reading them as versions cost real time:

- `docs/v2/` contained the plans for everything tagged `v3.0.0` through `v3.12.2`.
- `docs/v3/` was a PWA quality track unrelated to any `v3` tag.
- `docs/v1/` was 28 flat files mixing shipped history, live operational
  reference, and proposals that were never built.

Folders are now named for what they hold. A folder name should never imply a
version number, because tags move and folders don't.

## The status header

Every document opens with one:

```markdown
> **Status:** Live · **Last verified:** 2026-09-16
```

- **Live** — describes the system as it is. Safe to act on.
- **Plan** — describes work not yet done. Safe to build from, not to describe reality with.
- **Archived** — shipped or abandoned. Historical reasoning only; **do not act on it**.

`Last verified` is the date a human or an agent actually checked the claims
against the code — not the date the file was edited. A stale date is the point:
a `Live` doc verified six months ago should be read with suspicion, and that
suspicion should be visible without anyone having to audit it first.

## Rules

1. **Never create a doc at `docs/` top level.** It belongs in one of the five folders.
2. **Never duplicate a spec across folders** — link to it.
3. **Links are gated.** `npm run check:doc-links` runs in CI and resolves every
   Markdown link against `git ls-files`. The previous reorganisation broke 22
   links silently; this one cannot.
4. **Moving a doc to `archive/` is an edit, not just a move** — flip its status
   header to `Archived` and say in one line what shipped it.
