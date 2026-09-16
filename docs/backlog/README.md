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
| [EP-01](epics/EP-01-business-module.md) | Business module | 5 | **Needs decision** |
| [EP-02](epics/EP-02-wallet-ux-remainder.md) | Wallet UX remainder | 5 | Open |
| [EP-03](epics/EP-03-consistency-remainder.md) | Consistency remainder | 4 | Open |
| [EP-04](epics/EP-04-money-figure-correctness.md) | Money-figure correctness | 2 | Open |
| [EP-05](epics/EP-05-production-hardening.md) | Production hardening | 2 | Open |
| [EP-06](epics/EP-06-wallet-depth.md) | Wallet depth | 11 | Open |
| [EP-07](epics/EP-07-tasks-depth.md) | Tasks depth | 7 | Open |
| [EP-08](epics/EP-08-trips-module.md) | Trips module | 8 | **Needs decision** |
| [EP-09](epics/EP-09-day-module.md) | Day module | 6 | Open |
| [EP-10](epics/EP-10-cross-cutting.md) | Cross-cutting | 4 | Open |

## Items, by epic

Every item belongs to an epic. There are no standalone items — an item with no
epic has nowhere its continued relevance gets reviewed, which is the question
this backlog exists to answer.

### [EP-01](epics/EP-01-business-module.md) — Business module

| ID | Type | Title | Still needed? |
|---|---|---|---|
| [FEAT-001](items/FEAT-001-business-foundation.md) | Feature | Business schema + routes foundation | Only if EP-01 proceeds |
| [FEAT-002](items/FEAT-002-invoice-editor.md) | Feature | Invoice editor with live preview and print | **The high-value piece** — the only part Wallet cannot express today |
| [FEAT-003](items/FEAT-003-customers-products.md) | Feature | Customers and products CRUD | Only if EP-01 proceeds |
| [FEAT-004](items/FEAT-004-purchases-sales.md) | Feature | Purchases and sales ledgers | ⚠️ Question first — overlaps Wallet transactions |
| [FEAT-005](items/FEAT-005-business-dashboard.md) | Feature | Business summary dashboard | ⚠️ Question first — overlaps the Wallet dashboard |

### [EP-02](epics/EP-02-wallet-ux-remainder.md) — Wallet UX remainder

| ID | Type | Title | Still needed? |
|---|---|---|---|
| [FEAT-006](items/FEAT-006-responsive-grids.md) | Feature | Responsive grid breakpoints (B7) | Yes — it is a phone app now |
| [FEAT-007](items/FEAT-007-touch-targets.md) | Feature | 40px minimum touch targets (B11) | Yes — same reason |
| [FEAT-008](items/FEAT-008-recurring-card-badges.md) | Feature | Type and category badges on recurring cards (B10) | Probably — small |
| [FEAT-009](items/FEAT-009-error-toast-coverage.md) | Feature | Finish error-toast coverage (C3) | Yes — it is rule 10 |
| [FEAT-010](items/FEAT-010-dead-code-sweep.md) | Feature | Finish the dead-code sweep (C6) | Low value; verify it is not already done, else drop |

### [EP-03](epics/EP-03-consistency-remainder.md) — Consistency remainder

| ID | Type | Title | Still needed? |
|---|---|---|---|
| [FEAT-011](items/FEAT-011-non-mutating-fetch.md) | Feature | Non-mutating `fetchTransactions` variant | Yes |
| [FEAT-012](items/FEAT-012-batch-delete-transactions.md) | Feature | Batch `DELETE /transactions` endpoint | Yes |
| [FEAT-013](items/FEAT-013-centralise-date-formatting.md) | Feature | Centralise `formatDisplayDate` | Yes — 15+ inline copies |
| [FEAT-014](items/FEAT-014-fold-split-dialog.md) | Feature | Fold `SplitDialog` into the bulk split path | Question it — it may be earning its place |

### [EP-04](epics/EP-04-money-figure-correctness.md) — Money-figure correctness

| ID | Type | Title | Still needed? |
|---|---|---|---|
| [BUG-002](items/BUG-002-impossible-calendar-dates.md) | Bug | ISO date validation accepts impossible calendar dates | **Yes** — silently relocates a transaction |
| [BUG-003](items/BUG-003-day-header-split-totals.md) | Bug | Transaction-list day headers may double-count splits | **Yes** — first step is confirming it is real |

### [EP-05](epics/EP-05-production-hardening.md) — Production hardening

| ID | Type | Title | Still needed? |
|---|---|---|---|
| [BUG-001](items/BUG-001-no-rate-limiting.md) | Bug | No rate limiting on the public URL | **Yes** — highest severity in the backlog |
| [BUG-004](items/BUG-004-e2e-account-residue.md) | Bug | 273 `e2e_*` accounts pollute the retired Mac's database | Consider dropping — the live D1 database is clean |

### [EP-06](epics/EP-06-wallet-depth.md) — Wallet depth

| ID | Type | Title | Still needed? |
|---|---|---|---|
| [FEAT-015](items/FEAT-015-accounts-composition.md) | Feature | Accounts: composition breakdown and sparklines | Yes — R8, unstarted |
| [FEAT-016](items/FEAT-016-accounts-networth-chart.md) | Feature | Accounts: credit utilisation and 12-month net-worth chart | Yes — R8, unstarted |
| [FEAT-017](items/FEAT-017-budgets-summary-band.md) | Feature | Budgets: summary band and pace marker | Yes — R8, unstarted |
| [FEAT-018](items/FEAT-018-budgets-suggestions.md) | Feature | Budgets: suggestions engine | Yes — R8. The largest single item in EP-06; consider splitting. |
| [FEAT-019](items/FEAT-019-goals-trajectory.md) | Feature | Goals: rings, funding rate and honest ETA | Yes — R9, unstarted |
| [FEAT-020](items/FEAT-020-recurring-calendar.md) | Feature | Recurring: month calendar and annual cost | Yes — R9, unstarted |
| [FEAT-021](items/FEAT-021-recurring-anomalies.md) | Feature | Recurring: "Worth a look" anomalies | Yes — R9, unstarted |
| [FEAT-022](items/FEAT-022-reports-what-changed.md) | Feature | Reports: paired columns, savings gap and "What changed" | Yes — R9, unstarted |
| [FEAT-023](items/FEAT-023-reports-category-trends.md) | Feature | Reports: category sparkline trends | Yes — R9, unstarted |
| [FEAT-024](items/FEAT-024-shared-minimum-transfers.md) | Feature | Shared: group-wide minimum-transfer set | Yes — R9. Touches settlement maths — see the §3 CAS trap before starting. |
| [FEAT-025](items/FEAT-025-shared-split-rules.md) | Feature | Shared: split rules with staleness | Yes — R9, unstarted |

### [EP-07](epics/EP-07-tasks-depth.md) — Tasks depth

| ID | Type | Title | Still needed? |
|---|---|---|---|
| [FEAT-026](items/FEAT-026-tasks-upcoming-board.md) | Feature | Tasks: Upcoming week board | Yes — R10, unstarted |
| [FEAT-027](items/FEAT-027-tasks-assigned-to-me.md) | Feature | Tasks: Assigned to me and the delegation ledger | Yes — R10. The schema is already there. |
| [FEAT-028](items/FEAT-028-task-recurrence.md) | Feature | Tasks: recurrence | Yes — R10, unstarted |
| [FEAT-029](items/FEAT-029-tasks-habits.md) | Feature | Tasks: Habits | Yes — R11. Depends on FEAT-028. |
| [FEAT-030](items/FEAT-030-tasks-completed-analytics.md) | Feature | Tasks: Completed analytics | Yes — R11, unstarted |
| [FEAT-031](items/FEAT-031-tasks-worth-knowing.md) | Feature | Tasks: "Worth knowing" insight engine | Probably — question it after FEAT-021 ships and you see whether the pattern earns its keep |
| [FEAT-032](items/FEAT-032-tasks-wallet-chips.md) | Feature | Tasks: Wallet chips on task rows | Yes — R11, small |

### [EP-08](epics/EP-08-trips-module.md) — Trips module

| ID | Type | Title | Still needed? |
|---|---|---|---|
| [FEAT-033](items/FEAT-033-trips-schema.md) | Feature | Trips: schema and `trip_id` threading | Yes — R12, the foundation |
| [FEAT-034](items/FEAT-034-trip-chips.md) | Feature | Trips: trip chips in Wallet, Tasks and Day | Yes — R12. Depends on FEAT-033. |
| [FEAT-035](items/FEAT-035-trips-burndown.md) | Feature | Trips: list, trip page and burn-down | Yes — R12, unstarted |
| [FEAT-036](items/FEAT-036-trips-itinerary.md) | Feature | Trips: itinerary with estimate/actual grammar | Yes — R13, unstarted |
| [FEAT-037](items/FEAT-037-trips-prep.md) | Feature | Trips: phase-aware prep readiness | Yes — R13, unstarted |
| [FEAT-038](items/FEAT-038-trips-bookings-packing.md) | Feature | Trips: bookings, wishlist and packing | Yes — R13, unstarted |
| [FEAT-039](items/FEAT-039-trips-trip-mode.md) | Feature | Trips: trip mode | Yes — R14, unstarted |
| [FEAT-040](items/FEAT-040-trips-multi-currency.md) | Feature | Trips: multi-currency | Yes, but **a one-way door.** It touches every money surface in the app and the release plan flags it as likely to overrun. Split it before starting. |

### [EP-09](epics/EP-09-day-module.md) — Day module

| ID | Type | Title | Still needed? |
|---|---|---|---|
| [FEAT-041](items/FEAT-041-day-hour-ribbon.md) | Feature | Day: real time-of-day and the hour ribbon | Yes — R15, the foundation for EP-09 |
| [FEAT-042](items/FEAT-042-day-notes.md) | Feature | Day: notes as timeline entries | Yes — R15, unstarted |
| [FEAT-043](items/FEAT-043-day-composer.md) | Feature | Day: composer writing to either module | Yes — R15, unstarted |
| [FEAT-044](items/FEAT-044-day-close-the-day.md) | Feature | Day: Close the day | Yes — R16, the payoff |
| [FEAT-045](items/FEAT-045-day-usual-and-on-this-day.md) | Feature | Day: Against your usual, and On this day | Yes — R16, unstarted |
| [FEAT-046](items/FEAT-046-day-month-grid.md) | Feature | Day: month grid, This week, Calendar, Weekly review | Yes — R16, unstarted |

### [EP-10](epics/EP-10-cross-cutting.md) — Cross-cutting

| ID | Type | Title | Still needed? |
|---|---|---|---|
| [FEAT-047](items/FEAT-047-command-palette.md) | Feature | Command palette (⌘K) | Yes — and it is the most visible unfinished thing in the app |
| [FEAT-048](items/FEAT-048-page-states.md) | Feature | Empty, loading and error states for every page | Yes — rule 10 makes this non-optional |
| [FEAT-049](items/FEAT-049-density-toggle.md) | Feature | Density toggle | Question it — nobody has asked for it |
| [FEAT-050](items/FEAT-050-number-formatting-rules.md) | Feature | Number-formatting rules (D-9) | Yes — but resolve D-9 first |

---

## Conventions

**Every item belongs to an epic.** If nothing fits, create an epic first — even
a small one. An item floating on its own never gets the "is this still needed?"
question asked of it, and that question is the reason this backlog exists rather
than a list of wishes. `npm run check:backlog` enforces it.

**IDs never get reused and never get renumbered.** An ID means one thing
forever, including after the item ships and its file moves to `archive/`.

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
`/intake bug …`, `/intake brainstorm …`). It picks the epic, writes the item
file, allocates the next ID, and adds the row here. Filing by hand works too —
just do all three parts, because an item file with no index row is invisible and
an item with no epic never gets reviewed.

**An item is not a spec.** When one grows past roughly a page, it graduates: a
spec goes in `roadmap/`, and the item shrinks to a link. The backlog tracks
*whether* to do something; the roadmap tracks *how*.

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
- **`phase-5c-wallet-ux.md`'s five leftovers are more relevant now than when
  they were deferred**, because three of them are mobile and accessibility work
  on an app that has since become an installed PWA.

The bugs are lifted from `CLAUDE.md` §8's open-risks list so they live somewhere
they can be worked, rather than in a status section that gets skimmed.

**EP-06 to EP-10 are the design-adoption roadmap**, converted the same way.
`docs/roadmap/design-adoption/` keeps the specs — it is the *how* — and these
epics track the *whether*. They are grouped by module rather than by release
number on purpose: "do we still want Trips?" is a question worth asking, and
"do we still want R13?" is not.

Two of them carry a real open question rather than an estimate.
[EP-08 (Trips)](epics/EP-08-trips-module.md) is the largest unbuilt body of work
in the project and has a much cheaper alternative worth trying first.
[EP-09 (Day)](epics/EP-09-day-module.md) is almost entirely scaffolding for one
feature — if you would not close your day in this app, most of it can go.
