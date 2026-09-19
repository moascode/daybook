> **Status:** Archived · **Last verified:** 2026-09-19 · **Filed:** 2026-09-16 · **Shipped:** 2026-09-19 · **Epic:** [EP-06](../../backlog/EP-06-wallet-depth/README.md)

# FEAT-018 — Budgets: suggestions engine

**What.** Suggestions that reallocate between budgets, right-size one that is consistently wrong, and create budgets for categories that have none.

**Why now.** The most-used judgement in budgeting is "this number is wrong" — the data to say so already exists.

**Shipped**, in 3 PRs (this was the largest single item in EP-06 and was split up-front):
1. [PR #214](https://github.com/moascode/daybook/pull/214) — `GET /budgets/spending-history`, and `generateBudgetSuggestions()` (`src/modules/wallet/budgets/insights.ts`), a pure engine for the three rules: reallocate slack from a consistently under-used budget to one over its limit, right-size a budget that's been over for most of the last 3 months, propose a new budget for a category with real spend and none set.
2. [PR #215](https://github.com/moascode/daybook/pull/215) — `BudgetSuggestions.tsx`, wiring the engine into the Budgets page as one-line rows with one-click actions that perform real mutations (reallocate, raise, create).
3. [PR #216](https://github.com/moascode/daybook/pull/216) — `BudgetVsActualChart.tsx`, the 6-month budget-vs-actual chart design.md calls for alongside the suggestions.

Covered by `e2e/88-budgets-spending-history.spec.ts`, `e2e/89-budgets-suggestions.spec.ts`, `e2e/90-budget-vs-actual-chart.spec.ts`.
