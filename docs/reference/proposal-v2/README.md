> **Status:** Frozen mirror · **Copied:** 2026-10-03

# The v2 design proposal (mirror)

This is a verbatim copy of the design-adoption mockup, mirrored into the repo
so any session — including a subagent running in its own worktree — can view
the real rendered pages without needing access to the sibling checkout at
`~/Documents/dev/repo/claude/doc/daybook-design/proposal-v2`.

**24 static HTML pages + one `theme.css` + `REVIEW.md`** (the design-review log
across fifteen iterations, v2 → v15 — read it before touching any page; several
of its rules are load-bearing, e.g. v10's "don't pair cards whose natural
heights differ" and v14's solid/hollow grammar). Everything here is self
contained: pages link to each other by relative `href`, and all of them pull
in the one `theme.css`.

## Viewing it

Don't read the HTML source and guess what it looks like — render it.

**In this Claude Code session:** `preview_start` with `{"name": "design-mockup"}`
starts a static file server over this folder (`.claude/launch.json`) and opens
it in the Browser pane. Navigate to any page, e.g. `dashboard.html`,
`tasks-completed.html`.

**From a terminal:**
```bash
python3 -m http.server 4873 --directory docs/reference/proposal-v2
```
then open `http://localhost:4873/dashboard.html` (or any other page).

## This is a mockup, not a spec of record

Its figures are placeholder `$` amounts, its dates are invented, and its data
is fabricated. Currency in the real app stays **MYR**. Treat it as the visual
and structural source of truth (markup, classes, layout) — not as a source of
real content or behaviour.

## Keeping it in sync

This folder is a point-in-time copy, not a live link. If the source proposal
at `~/Documents/dev/repo/claude/doc/daybook-design/proposal-v2` is revised,
re-copy it here (excluding `.DS_Store`) and note the new copy date above.
