> **Status:** Needs decision · **Filed:** 2026-09-16 · **Source:** [business-module-plan.md](../../archive/business-module-plan.md)

# EP-01 — Business module

**What.** Invoicing and a small trading ledger — customers, products, purchases,
sales, invoices with a printable PDF, and a summary dashboard. A 604-line plan
exists and is unusually complete: nine `business_*` tables, a session-by-session
build order, and a real invoice as a reference document.

**Status: nothing was ever built.** No `worker/routes/business.ts`, no
`src/modules/business/`, no `business_*` migration. Verified 2026-09-16.

---

## The decision this epic is waiting on

The plan is not obsolete on technical grounds — it already targets Workers + D1.
It is waiting on a product question the owner has never actually been asked:

> **Is Daybook a personal finance app, or a personal finance app that also does
> invoicing?**

Daybook has since grown four modules (Wallet, Tasks, Trips, Day) and a redesign
programme that assumes exactly those four in its app bar. A fifth module is not
a small addition — it changes the shape of the product and the navigation.

Three honest options:

| | |
|---|---|
| **Build it** | Schedule as its own roadmap track. Realistically 6+ PRs before it is usable |
| **Drop it** | Mark `Dropped`, keep the plan in `archive/`. Costs nothing and stops it resurfacing |
| **Shrink it** | Invoices only, no purchases/sales/inventory. The plan's own Session 1 is nearly standalone, and invoicing is the part with no substitute elsewhere |

**Recommendation: shrink or drop.** The dashboard, purchases and sales
substantially duplicate what Wallet already does with accounts and transactions;
invoicing is the only piece Wallet cannot express today.

## Items

| ID | Title | Still needed? |
|---|---|---|
| [FEAT-001](../items/FEAT-001-business-foundation.md) | Business schema + routes foundation | Only if the epic proceeds |
| [FEAT-002](../items/FEAT-002-invoice-editor.md) | Invoice editor with live preview and print | **The high-value piece** |
| [FEAT-003](../items/FEAT-003-customers-products.md) | Customers and products CRUD | Only if the epic proceeds |
| [FEAT-004](../items/FEAT-004-purchases-sales.md) | Purchases and sales ledgers | ⚠️ Overlaps Wallet transactions — question this one first |
| [FEAT-005](../items/FEAT-005-business-dashboard.md) | Business summary dashboard | ⚠️ Overlaps the Wallet dashboard |
