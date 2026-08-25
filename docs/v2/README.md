# Daybook v2 — design adoption

This folder holds every planning document for adopting the redesign in
`~/Documents/dev/repo/claude/doc/daybook-design/proposal-v2` (referred to
throughout as **the proposal**) and completing the functionality it implies.

The proposal is 24 mockups + one 2,185-line `theme.css` + a `REVIEW.md` that
records fifteen design iterations (v2 → v15) and the reasoning behind each. Read
`REVIEW.md` before touching any page — it explains *why* a card looks the way it
does, and several of its rules (v10's "don't pair cards whose natural heights
differ", v14's solid/hollow grammar) are load-bearing across modules.

---

## How these docs are organised

```
docs/v2/
├── README.md               ← you are here: index, conventions, status
├── release-plan.md         ← THE ROADMAP. 17 releases, dependencies, tags
├── execution-playbook.md   ← HOW it gets built: feature-flow agents + model tiers
├── gap-analysis.md         ← design ↔ codebase, page by page
├── open-decisions.md       ← D-numbered items (all six sign-offs resolved 2026-08-21)
│
├── foundation/             ← cross-module, must land before any module work
│   ├── 01-design-tokens.md
│   ├── 02-component-layer.md
│   ├── 03-app-shell.md
│   └── 04-e2e-and-migration.md
│
├── wallet/   ← module folders, one per app-bar tab, in adoption order
├── tasks/
├── trips/
├── day/
│   └── each: README.md (module plan) · 01-data-model.md · 02-design-adoption.md · 03-feature-waves.md
│
└── cross-cutting/          ← things no single module owns
    └── README.md
```

**Convention for new v2 docs.** A document belongs to exactly one folder:

| If it is about… | Put it in | Name it |
|---|---|---|
| tokens, shared components, the shell, testing strategy | `foundation/` | `NN-topic.md` |
| one module's pages, schema or features | that module's folder | `NN-topic.md` |
| search, notifications, composer, states, density | `cross-cutting/` | `NN-topic.md` |
| a single feature big enough to need its own spec | its module folder | `feature-<slug>.md` |
| a decision that changes more than one module | `open-decisions.md` | a new `D-NN` entry |

Never create a v2 doc at `docs/` top level. Never duplicate a spec across
modules — link to it.

---

## Status board

Update the row when a release merges. `—` means not started. **This board
tracks releases, not tags** — none of R1–R3 has actually been tagged/deployed
yet even though the code is merged to `main`; see the warning below.

| Release | Tag | Scope | Status |
|---|---|---|---|
| R1 | v2.10.0 | Foundation — tokens, component layer, AA gate | ✅ merged [PR 125](https://github.com/moascode/daybook/pull/125) — **not tagged** |
| R2 | v2.11.0 | Foundation — app shell | ✅ merged [PR 130](https://github.com/moascode/daybook/pull/130) — **not tagged** |
| R3 | v2.12.0 | Wallet — design adoption (8 pages) | ✅ merged [PR 132](https://github.com/moascode/daybook/pull/132)–[135](https://github.com/moascode/daybook/pull/135) (4 PRs) — **not tagged** |
| R4 | v2.13.0 | Tasks — minimum schema for the designed rows | ✅ merged [PR 138](https://github.com/moascode/daybook/pull/138) — **not tagged** |
| R5 | v2.14.0 | Tasks — design adoption (4 pages) | — |
| R6 | **v3.0.0** | Trips + Day — routes, nav, designed first-run states | — |
| R7 | v3.1.0 | Wallet W1 — composer, Overview insight cards | — |
| R8 | v3.2.0 | Wallet W2 — Accounts depth, Budgets suggestions | — |
| R9 | v3.3.0 | Wallet W3 — Goals, Recurring, Reports, Shared depth | — |
| R10 | v3.4.0 | Tasks T1 — Upcoming board, Assigned to me, recurrence | — |
| R11 | v3.5.0 | Tasks T2 — Habits, Completed analytics, Worth knowing | — |
| R12 | v3.6.0 | Trips P1 — trips, trip page, burn-down, `trip_id` thread | — |
| R13 | v3.7.0 | Trips P2 — itinerary, prep, bookings, wishlist, packing | — |
| R14 | v3.8.0 | Trips P3 — trip mode, multi-currency | — |
| R15 | v3.9.0 | Day D1 — timeline, hour ribbon, day figures | — |
| R16 | v3.10.0 | Day D2 — Close the day, usual, on-this-day, month grid | — |
| R17 | **v4.0.0** | Cross-cutting — search results, ⌘K, notifications, states | — |

> ⚠️ **"R4" name collision, unrelated to this roadmap.** A same-named but
> unrelated session shipped PR #136 ("AI-assisted merchant name resolution")
> labeled "R4" — that work is on the older `docs/v1/flow-plan.md` track (PR
> #112's follow-up), has nothing to do with the Tasks schema bump this table's
> R4 row means, and did not advance this roadmap. See
> `docs/v1/project-history.md`'s entry on PR #136 for detail. R4 in *this*
> table (PR #138, merged 2026-08-25) is the Tasks schema bump — unrelated to
> PR #136.
>
> **Next tag due is `v2.10.0`**, covering R1 (already merged). Verify current
> state before trusting this table — `git log --oneline v2.9.2..main` on
> 2026-08-25 showed R1–R4 merged and unreleased.

---

## The two tracks, and why the order is what it is

The owner's instruction was *adopt the design first, then build features one by
one, module by module: Wallet, Tasks, Trips, Day.*

**Track A (R1–R6) adopts the design.** Nothing new is computed; existing
functionality is re-expressed in the new system. Two honest exceptions:

- **Tasks cannot be adopted without a schema bump.** The designed task row
  carries a list, a priority, a due *time*, an assignee and a subtask count.
  The current `tasks` table has none of them, so R4 exists purely to make R5
  renderable. It is adoption cost, not feature scope.
- **Trips and Day have nothing to adopt.** Neither module exists. R6 gives them
  real routes, real navigation and their designed empty/first-run states, so the
  four-tab app bar is not advertising two tabs that go nowhere. Their real pages
  are Track B.

**Track B (R7–R17) completes the functionality**, in the owner's module order,
smallest-blast-radius first inside each module.

**v3.0 is declared at R6** and means: *Wallet and Tasks are fully on the new
design; Day and Trips exist as designed first-run states.* It does not mean the
product is feature-complete — that is v4.0.

---

## Ground rules for every v2 release

1. **Rule 12 still applies.** Branch, PR, no direct commits to `main`.
2. **Rule 11 still applies.** Every release ships its e2e specs. See
   [foundation/04-e2e-and-migration.md](foundation/04-e2e-and-migration.md) —
   the reskin will break selectors, and the mitigation has to land *before* the
   reskin, not after.
3. **No `dark:` variants, ever.** The token layer already inverts. CLAUDE.md §18
   documents the double-inversion trap; the v2 token model has the same
   property.
4. **Look at the rendered page.** Eight double-inverted colours shipped into
   review during the last dashboard rebuild and neither the type checker nor a
   diff reviewer caught them. Use the Browser pane on both themes.
5. **The proposal is a mockup, not a spec of record.** Its figures are `$`, its
   dates are August/September 2026, and its data is invented. Currency stays
   **MYR** (see `open-decisions.md` D-12).
6. **Never fail silently** (CLAUDE.md rule 13) — the new insight cards compute a
   lot, and a card that renders blank because a query threw is exactly the
   failure that rule exists to prevent.
