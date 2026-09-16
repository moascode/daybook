> **Status:** Live · **Last verified:** 2026-09-16

# Backlog

Everything wanted but not yet scheduled: features, bugs, and ideas still being
thought about. Work that *is* scheduled lives in [../roadmap/](../roadmap/);
work that shipped lives in [../archive/](../archive/).

**This file is the index.** One line per item. Detail lives in the item's own
file, so this table stays scannable and `CLAUDE.md` can point at one path
instead of carrying a backlog.

---

## Epics

An epic is a body of work too big to be one PR. It owns items; reviewing an
epic means asking two questions — *is the epic still worth doing?* and *is
every item under it still needed?* Both are answered in the epic's own file.

| ID | Epic | Items | Status |
|---|---|---|---|
| _(populated by the proposal conversion — see PR 3)_ | | | |

## Standalone items

Items small enough to need no epic.

| ID | Type | Title | Status |
|---|---|---|---|
| _(none yet)_ | | | |

---

## Conventions

**IDs never get reused and never get renumbered.** `FEAT-007` means one thing
forever, including after it ships and the file moves to `archive/`.

| Prefix | Means | Lives in |
|---|---|---|
| `EP-NN` | Epic | `epics/EP-NN-slug.md` |
| `FEAT-NNN` | Feature request | `items/FEAT-NNN-slug.md` |
| `BUG-NNN` | Defect in shipped behaviour | `items/BUG-NNN-slug.md` |
| `IDEA-NNN` | Brainstorm, not yet a commitment | `items/IDEA-NNN-slug.md` |

**Status values**

| Status | Means |
|---|---|
| `Open` | Wanted, not started |
| `Needs decision` | Blocked on an owner call — the question is stated in the item |
| `Scheduled` | Promoted into a `roadmap/` release; the item links to it |
| `Shipped` | Done. Item links to the PR or tag |
| `Dropped` | Deliberately not doing it. **The reason stays in the file** — a dropped item that keeps getting re-proposed is a sign the reason was never written down |

**Filing something new:** use the `intake` skill (`/intake feature …`,
`/intake bug …`, `/intake brainstorm …`). It writes the item file, allocates
the next ID, and adds the row here. Filing by hand works too — just do both
halves, because an item file with no index row is invisible.

**An item is not a spec.** When one grows past roughly a page, it graduates: a
spec goes in `roadmap/`, and the item shrinks to a link. The backlog tracks
*whether* to do something; the roadmap tracks *how*.
