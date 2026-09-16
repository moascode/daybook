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
| [EP-01](epics/EP-01-business-module.md) | Business module — invoicing and a trading ledger | FEAT-001 – FEAT-005 | **Needs decision** |
| [EP-02](epics/EP-02-wallet-ux-remainder.md) | Wallet UX remainder from Phase 5c | FEAT-006 – FEAT-010 | Open |
| [EP-03](epics/EP-03-consistency-remainder.md) | Consistency remainder (most of its source plans already shipped) | FEAT-011 – FEAT-014 | Open |

## All items


| ID | Type | Title | Epic | Status |
|---|---|---|---|---|
| [FEAT-001](items/FEAT-001-business-foundation.md) | Feature | Business schema + routes foundation | EP-01 | Needs decision |
| [FEAT-002](items/FEAT-002-invoice-editor.md) | Feature | Invoice editor with live preview and print | EP-01 | Needs decision |
| [FEAT-003](items/FEAT-003-customers-products.md) | Feature | Customers and products CRUD | EP-01 | Needs decision |
| [FEAT-004](items/FEAT-004-purchases-sales.md) | Feature | Purchases and sales ledgers | EP-01 | Needs decision |
| [FEAT-005](items/FEAT-005-business-dashboard.md) | Feature | Business summary dashboard | EP-01 | Needs decision |
| [FEAT-006](items/FEAT-006-responsive-grids.md) | Feature | Responsive grid breakpoints (B7) | EP-02 | Open |
| [FEAT-007](items/FEAT-007-touch-targets.md) | Feature | 40px minimum touch targets (B11) | EP-02 | Open |
| [FEAT-008](items/FEAT-008-recurring-card-badges.md) | Feature | Type/category badges on recurring cards (B10) | EP-02 | Open |
| [FEAT-009](items/FEAT-009-error-toast-coverage.md) | Feature | Finish error-toast coverage (C3) | EP-02 | Open |
| [FEAT-010](items/FEAT-010-dead-code-sweep.md) | Feature | Finish the dead-code sweep (C6) | EP-02 | Open |
| [FEAT-011](items/FEAT-011-non-mutating-fetch.md) | Feature | Non-mutating `fetchTransactions` variant | EP-03 | Open |
| [FEAT-012](items/FEAT-012-batch-delete-transactions.md) | Feature | Batch `DELETE /transactions` endpoint | EP-03 | Open |
| [FEAT-013](items/FEAT-013-centralise-date-formatting.md) | Feature | Centralise `formatDisplayDate` | EP-03 | Open |
| [FEAT-014](items/FEAT-014-fold-split-dialog.md) | Feature | Fold `SplitDialog` into the bulk path | EP-03 | Open |
| [BUG-001](items/BUG-001-no-rate-limiting.md) | Bug | No rate limiting on the public URL | — | Open · **high** |
| [BUG-002](items/BUG-002-impossible-calendar-dates.md) | Bug | ISO validation accepts Feb 30 / Apr 31 | — | Open · medium |
| [BUG-003](items/BUG-003-day-header-split-totals.md) | Bug | Day headers may double-count splits | — | Open · medium |
| [BUG-004](items/BUG-004-e2e-account-residue.md) | Bug | 273 `e2e_*` accounts on the retired Mac | — | Open · low |

---

## Conventions

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
`/intake bug …`, `/intake brainstorm …`). It writes the item file, allocates
the next ID, and adds the row here. Filing by hand works too — just do both
halves, because an item file with no index row is invisible.

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
