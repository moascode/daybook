> **Status:** Archived · **Last verified:** 2026-09-19 · **Filed:** 2026-09-16 · **Shipped:** 2026-09-19 · **Epic:** [EP-06](../../backlog/EP-06-wallet-depth/README.md)

# FEAT-017 — Budgets: summary band and pace marker

**What.** A summary band across the budgets page and a pace marker showing whether spend is ahead of the month.

**Why now.** A budget that only shows a total spent cannot tell you whether you are on track on the 12th.

**Shipped.** [PR #213](https://github.com/moascode/daybook/pull/213). The summary band (total spent/budgeted, progress bar, three stats) already existed before this item was filed; what shipped here is the actual pace marker — a day-of-month notch on each budget row's progress bar (`BudgetsPage.tsx`), reusing the Dashboard's existing `BudgetPace` math (`dashboard/BudgetPace.tsx`, `AHEAD_OF_PACE_THRESHOLD` exported for reuse), plus the summary band's corrective "RM34 a day instead of RM46" instruction line. Covered by `e2e/13-wallet-budgets.spec.ts`.
