> **Status:** Live · **Last verified:** 2026-09-16

# Backlog

Everything wanted but not yet built: features, bugs, and ideas still being
thought about — together with the design thinking behind them. Work that
shipped lives in [../archive/](../archive/); once something ships, its e2e spec
and its code describe it better than any document here could.

**One folder per epic, and the folder owns its items.**

```
docs/backlog/
├── README.md                          ← this index
├── EP-06-wallet-depth/
│   ├── README.md                      ← the epic
│   ├── FEAT-015-accounts-composition.md
│   ├── FEAT-018-budgets-suggestions.md
│   └── …
└── EP-08-trips-module/
    ├── README.md
    └── …
```

The folder *is* the epic membership — an item cannot drift away from its epic
the way a metadata field can, and opening an epic folder on GitHub renders its
`README.md` with every item sitting underneath. This file stays the index so
`CLAUDE.md` can point at one path instead of carrying a backlog.

---

## Epics

An epic is a body of work too big to be one PR. It owns items; reviewing an
epic means asking two questions — *is the epic still worth doing?* and *is
every item under it still needed?* Both are answered in the epic's own file.

| ID | Epic | Items | Status |
|---|---|---|---|
| [EP-01](EP-01-business-module/README.md) | Business module | 5 | **Needs decision** |
| [EP-03](EP-03-consistency-remainder/README.md) | Consistency remainder | 4 | Open |
| [EP-04](EP-04-money-figure-correctness/README.md) | Money-figure correctness | 2 | Open |
| [EP-05](EP-05-production-hardening/README.md) | Production hardening | 2 | Open |
| [EP-06](EP-06-wallet-depth/README.md) | Wallet depth | 8 | Open |
| [EP-07](EP-07-tasks-depth/README.md) | Tasks depth | 18 | Open |
| [EP-08](EP-08-trips-module/README.md) | Trips module | 8 | **Needs decision** |
| [EP-09](EP-09-day-module/README.md) | Day module | 6 | Open |
| [EP-10](EP-10-cross-cutting/README.md) | Cross-cutting | 4 | Open |

## Items, by epic

Every item belongs to an epic. There are no standalone items — an item with no
epic has nowhere its continued relevance gets reviewed, which is the question
this backlog exists to answer.

### [EP-01](EP-01-business-module/README.md) — Business module

| ID | Type | Title | Still needed? |
|---|---|---|---|
| [FEAT-001](EP-01-business-module/FEAT-001-business-foundation.md) | Feature | Business schema + routes foundation | Only if EP-01 proceeds |
| [FEAT-002](EP-01-business-module/FEAT-002-invoice-editor.md) | Feature | Invoice editor with live preview and print | **The high-value piece** — the only part Wallet cannot express today |
| [FEAT-003](EP-01-business-module/FEAT-003-customers-products.md) | Feature | Customers and products CRUD | Only if EP-01 proceeds |
| [FEAT-004](EP-01-business-module/FEAT-004-purchases-sales.md) | Feature | Purchases and sales ledgers | ⚠️ Question first — overlaps Wallet transactions |
| [FEAT-005](EP-01-business-module/FEAT-005-business-dashboard.md) | Feature | Business summary dashboard | ⚠️ Question first — overlaps the Wallet dashboard |

### [EP-03](EP-03-consistency-remainder/README.md) — Consistency remainder

| ID | Type | Title | Still needed? |
|---|---|---|---|
| [FEAT-011](EP-03-consistency-remainder/FEAT-011-non-mutating-fetch.md) | Feature | Non-mutating `fetchTransactions` variant | Yes |
| [FEAT-012](EP-03-consistency-remainder/FEAT-012-batch-delete-transactions.md) | Feature | Batch `DELETE /transactions` endpoint | Yes |
| [FEAT-013](EP-03-consistency-remainder/FEAT-013-centralise-date-formatting.md) | Feature | Centralise `formatDisplayDate` | Yes — 15+ inline copies |
| [FEAT-014](EP-03-consistency-remainder/FEAT-014-fold-split-dialog.md) | Feature | Fold `SplitDialog` into the bulk split path | Question it — it may be earning its place |

### [EP-04](EP-04-money-figure-correctness/README.md) — Money-figure correctness

| ID | Type | Title | Still needed? |
|---|---|---|---|
| [BUG-002](EP-04-money-figure-correctness/BUG-002-impossible-calendar-dates.md) | Bug | ISO date validation accepts impossible calendar dates | **Yes** — silently relocates a transaction |
| [BUG-003](EP-04-money-figure-correctness/BUG-003-day-header-split-totals.md) | Bug | Transaction-list day headers may double-count splits | **Yes** — first step is confirming it is real |

### [EP-05](EP-05-production-hardening/README.md) — Production hardening

| ID | Type | Title | Still needed? |
|---|---|---|---|
| [BUG-001](EP-05-production-hardening/BUG-001-no-rate-limiting.md) | Bug | No rate limiting on the public URL | **Yes** — highest severity in the backlog |
| [BUG-004](EP-05-production-hardening/BUG-004-e2e-account-residue.md) | Bug | 273 `e2e_*` accounts pollute the retired Mac's database | Consider dropping — the live D1 database is clean |

### [EP-06](EP-06-wallet-depth/README.md) — Wallet depth

FEAT-015 and FEAT-016 shipped before this backlog was even filed, and FEAT-017
has since shipped too — see the epic's own
[Shipped table](EP-06-wallet-depth/README.md#shipped) and their archived item
files.

| ID | Type | Title | Still needed? |
|---|---|---|---|
| [FEAT-018](EP-06-wallet-depth/FEAT-018-budgets-suggestions.md) | Feature | Budgets: suggestions engine | Scheduled — split into 3 PRs, 1/3 and 2/3 merged, [PR #216](https://github.com/moascode/daybook/pull/216) is 3/3 |
| [FEAT-019](EP-06-wallet-depth/FEAT-019-goals-trajectory.md) | Feature | Goals: rings, funding rate and honest ETA | Yes — R9, unstarted |
| [FEAT-020](EP-06-wallet-depth/FEAT-020-recurring-calendar.md) | Feature | Recurring: month calendar and annual cost | Yes — R9, unstarted |
| [FEAT-021](EP-06-wallet-depth/FEAT-021-recurring-anomalies.md) | Feature | Recurring: "Worth a look" anomalies | Yes — R9, unstarted |
| [FEAT-022](EP-06-wallet-depth/FEAT-022-reports-what-changed.md) | Feature | Reports: paired columns, savings gap and "What changed" | Yes — R9, unstarted |
| [FEAT-023](EP-06-wallet-depth/FEAT-023-reports-category-trends.md) | Feature | Reports: category sparkline trends | Yes — R9, unstarted |
| [FEAT-024](EP-06-wallet-depth/FEAT-024-shared-minimum-transfers.md) | Feature | Shared: group-wide minimum-transfer set | Yes — R9. Touches settlement maths — see the §3 CAS trap before starting. |
| [FEAT-025](EP-06-wallet-depth/FEAT-025-shared-split-rules.md) | Feature | Shared: split rules with staleness | Yes — R9, unstarted |

### [EP-07](EP-07-tasks-depth/README.md) — Tasks depth

| ID | Type | Title | Still needed? |
|---|---|---|---|
| [FEAT-026](EP-07-tasks-depth/FEAT-026-tasks-upcoming-board.md) | Feature | Tasks: Upcoming week board | Shipped — PR #219 |
| [FEAT-027](EP-07-tasks-depth/FEAT-027-tasks-assigned-to-me.md) | Feature | Tasks: Assigned to me and the delegation ledger | Shipped — PR #221 |
| [FEAT-028](EP-07-tasks-depth/FEAT-028-task-recurrence.md) | Feature | Tasks: recurrence | Shipped |
| [FEAT-029](EP-07-tasks-depth/FEAT-029-tasks-habits.md) | Feature | Tasks: Habits | Shipped |
| [FEAT-030](EP-07-tasks-depth/FEAT-030-tasks-completed-analytics.md) | Feature | Tasks: Completed analytics | Shipped |
| [FEAT-031](EP-07-tasks-depth/FEAT-031-tasks-worth-knowing.md) | Feature | Tasks: "Worth knowing" insight engine | Probably — question it after FEAT-021 ships and you see whether the pattern earns its keep |
| [FEAT-032](EP-07-tasks-depth/FEAT-032-tasks-wallet-chips.md) | Feature | Tasks: Wallet chips on task rows | Shipped (outliner only) |
| [FEAT-051](EP-07-tasks-depth/FEAT-051-task-list-picker.md) | Feature | Assign a task's list (category) from the task row | Shipped |
| [BUG-005](EP-07-tasks-depth/BUG-005-quick-add-task-noop.md) | Bug | Quick-add "Task" does nothing | Fixed |
| [BUG-006](EP-07-tasks-depth/BUG-006-no-due-date-change-in-list-view.md) | Bug | No way to change a task's due date from a list view | Fixed |
| [FEAT-052](EP-07-tasks-depth/FEAT-052-edit-task-from-row.md) | Feature | Edit a task's text from any list-style view | Shipped |
| [FEAT-053](EP-07-tasks-depth/FEAT-053-create-task-list.md) | Feature | A way to create a task list | Shipped |
| [BUG-007](EP-07-tasks-depth/BUG-007-today-row-not-editable.md) | Bug | Today page rows can't be edited at all | **Yes** — least editable view in the module |
| [BUG-008](EP-07-tasks-depth/BUG-008-today-row-name-truncated.md) | Bug | Today rows truncate long names with no way to read them | Yes |
| [BUG-009](EP-07-tasks-depth/BUG-009-composer-no-list-or-date.md) | Bug | No way to pick a list or date while creating a task | Yes |
| [BUG-010](EP-07-tasks-depth/BUG-010-all-tasks-row-layout-squeezes-name.md) | Bug | All tasks row layout squeezes/hides the task name | Yes |
| [BUG-011](EP-07-tasks-depth/BUG-011-no-way-to-set-priority.md) | Bug | No UI anywhere to set or change a task's priority | Yes |
| [BUG-012](EP-07-tasks-depth/BUG-012-upcoming-card-no-detail-modal.md) | Bug | Upcoming board cards don't open a detail/edit view | Yes |

### [EP-08](EP-08-trips-module/README.md) — Trips module

| ID | Type | Title | Still needed? |
|---|---|---|---|
| [FEAT-033](EP-08-trips-module/FEAT-033-trips-schema.md) | Feature | Trips: schema and `trip_id` threading | Yes — R12, the foundation |
| [FEAT-034](EP-08-trips-module/FEAT-034-trip-chips.md) | Feature | Trips: trip chips in Wallet, Tasks and Day | Yes — R12. Depends on FEAT-033. |
| [FEAT-035](EP-08-trips-module/FEAT-035-trips-burndown.md) | Feature | Trips: list, trip page and burn-down | Yes — R12, unstarted |
| [FEAT-036](EP-08-trips-module/FEAT-036-trips-itinerary.md) | Feature | Trips: itinerary with estimate/actual grammar | Yes — R13, unstarted |
| [FEAT-037](EP-08-trips-module/FEAT-037-trips-prep.md) | Feature | Trips: phase-aware prep readiness | Yes — R13, unstarted |
| [FEAT-038](EP-08-trips-module/FEAT-038-trips-bookings-packing.md) | Feature | Trips: bookings, wishlist and packing | Yes — R13, unstarted |
| [FEAT-039](EP-08-trips-module/FEAT-039-trips-trip-mode.md) | Feature | Trips: trip mode | Yes — R14, unstarted |
| [FEAT-040](EP-08-trips-module/FEAT-040-trips-multi-currency.md) | Feature | Trips: multi-currency | Yes, but **a one-way door.** It touches every money surface in the app and the release plan flags it as likely to overrun. Split it before starting. |

### [EP-09](EP-09-day-module/README.md) — Day module

| ID | Type | Title | Still needed? |
|---|---|---|---|
| [FEAT-041](EP-09-day-module/FEAT-041-day-hour-ribbon.md) | Feature | Day: real time-of-day and the hour ribbon | Yes — R15, the foundation for EP-09 |
| [FEAT-042](EP-09-day-module/FEAT-042-day-notes.md) | Feature | Day: notes as timeline entries | Yes — R15, unstarted |
| [FEAT-043](EP-09-day-module/FEAT-043-day-composer.md) | Feature | Day: composer writing to either module | Yes — R15, unstarted |
| [FEAT-044](EP-09-day-module/FEAT-044-day-close-the-day.md) | Feature | Day: Close the day | Yes — R16, the payoff |
| [FEAT-045](EP-09-day-module/FEAT-045-day-usual-and-on-this-day.md) | Feature | Day: Against your usual, and On this day | Yes — R16, unstarted |
| [FEAT-046](EP-09-day-module/FEAT-046-day-month-grid.md) | Feature | Day: month grid, This week, Calendar, Weekly review | Yes — R16, unstarted |

### [EP-10](EP-10-cross-cutting/README.md) — Cross-cutting

| ID | Type | Title | Still needed? |
|---|---|---|---|
| [FEAT-047](EP-10-cross-cutting/FEAT-047-command-palette.md) | Feature | Command palette (⌘K) | Yes — and it is the most visible unfinished thing in the app |
| [FEAT-048](EP-10-cross-cutting/FEAT-048-page-states.md) | Feature | Empty, loading and error states for every page | Yes — rule 10 makes this non-optional |
| [FEAT-049](EP-10-cross-cutting/FEAT-049-density-toggle.md) | Feature | Density toggle | Question it — nobody has asked for it |
| [FEAT-050](EP-10-cross-cutting/FEAT-050-number-formatting-rules.md) | Feature | Number-formatting rules (D-9) | Yes — but resolve D-9 first |

---

## Conventions

**Every item belongs to an epic** — there is nowhere else to put one. If nothing
fits, create the epic folder first, even for a small one. An item floating on its own never gets the "is this still needed?"
question asked of it, and that question is the reason this backlog exists rather
than a list of wishes. `npm run check:backlog` enforces it.

**IDs never get reused and never get renumbered.** An ID means one thing
forever, including after the item ships and its file moves to `archive/`.

| Prefix | Means | Lives in |
|---|---|---|
| `EP-NN` | Epic | `EP-NN-slug/README.md` |
| `FEAT-NNN` | Feature request | `EP-NN-slug/FEAT-NNN-slug.md` |
| `BUG-NNN` | Defect in shipped behaviour | `EP-NN-slug/BUG-NNN-slug.md` |
| `IDEA-NNN` | Brainstorm, not yet a commitment | `EP-NN-slug/IDEA-NNN-slug.md` |

An item's `**Epic:**` header must name the folder it sits in. `check:backlog`
rejects a mismatch, so the two can't disagree silently.

**Status values**

| Status | Means |
|---|---|
| `Open` | Wanted, not started |
| `Needs decision` | Blocked on an owner call — the question is stated in the item |
| `Scheduled` | Committed to and in flight; the item links to the branch or PR |
| `Shipped` | Done. Item links to the PR or tag |
| `Dropped` | Deliberately not doing it. **The reason stays in the file** — a dropped item that keeps getting re-proposed is a sign the reason was never written down |

**Filing something new:** use the `intake` skill (`/intake feature …`,
`/intake bug …`, `/intake brainstorm …`). It picks the epic, writes the item
file, allocates the next ID, and adds the row here. Filing by hand works too —
just do all three parts, because an item file with no index row is invisible and
an item with no epic never gets reviewed.

**An item is not a design.** When the thinking outgrows a page, it moves into
the epic's `design.md` (or `FEAT-NNN-design.md` for one item), and the item
shrinks to a link. The item tracks *whether*; the design tracks *how*.

**Design docs die when the work ships.** Once a feature is live, its behaviour
is described by `e2e/NN-*.spec.ts` — which CI enforces and which therefore
cannot rot — and by the code. The design doc goes to `archive/`. Only what code
and tests *cannot* say survives into [`../reference/`](../reference/): why a
decision went the way it did, and traps that aren't visible in a diff.

---

## What the conversion found

These items came from converting four old proposal documents on 2026-09-16.
Each was verified against the code first, and the verification mattered more
than the conversion:

- **`feature-consistency-plan.md` and `deferred-items-plan.md` propose ~45 items
  across 11 waves. Almost all of them had already shipped.** Filing them
  unverified would have produced a backlog that was 90% noise. What survived is
  four items in EP-03, and the epic carries the table showing what shipped so
  nobody re-derives it.
- **`business-module-plan.md` (604 lines) was never started** and is the one
  genuine open question — it needs a product decision, not an estimate.
- **`phase-5c-wallet-ux.md`'s five leftovers became EP-02**, and shipped or were
  dropped the same week (2026-09-18) — see
  [`docs/archive/ep-02-wallet-ux-remainder/`](../archive/ep-02-wallet-ux-remainder/README.md).

The bugs are lifted from `CLAUDE.md` §8's open-risks list so they live somewhere
they can be worked, rather than in a status section that gets skimmed.

**EP-06 to EP-10 are the old design-adoption roadmap**, converted the same way
and grouped by module rather than release number: "do we still want Trips?" is a
question worth asking, and "do we still want R13?" is not. Each of those epics
carries the module's design doc in its own folder, so an epic can be judged
without leaving it. `docs/roadmap/` no longer exists — what described shipped
work moved to `archive/`, and what tracked forward work is this file.

Two of them carry a real open question rather than an estimate.
[EP-08 (Trips)](EP-08-trips-module/README.md) is the largest unbuilt body of work
in the project and has a much cheaper alternative worth trying first.
[EP-09 (Day)](EP-09-day-module/README.md) is almost entirely scaffolding for one
feature — if you would not close your day in this app, most of it can go.
