> **Status:** Shipped · **Filed:** 2026-09-16 · **Last verified:** 2026-10-04 · **Epic:** [EP-06](README.md)

# FEAT-018 — Budgets: suggestions engine

**What.** Suggestions that reallocate between budgets, right-size one that is consistently wrong, and create budgets for categories that have none.

**Why now.** The most-used judgement in budgeting is "this number is wrong" — the data to say so already exists.

**Design.** [design.md](design.md) — the design work is already done; this item tracks *whether* to build it, not how.

**Still needed?** No — shipped. This doc said "Still needed: Yes" while all
three of its own PRs were already merged — the exact stale-doc trap
`docs/backlog/README.md` warns about. Corrected 2026-10-04 while filing
[FEAT-066](FEAT-066-budgets-design-adoption.md), which restyles these rows
to the mockup's `.sug` pattern and adds a 4th suggestion type
(roll-forward) — the engine and its first 3 suggestion types below are
unaffected.

**Shipped, all 3 PRs:**
1. Engine + `GET /budgets/spending-history` (data layer only, no UI) — [PR #214](https://github.com/moascode/daybook/pull/214), merged
2. Suggestion rows + one-click actions on the Budgets page — [PR #215](https://github.com/moascode/daybook/pull/215), merged
3. 6-month budget-vs-actual chart — [PR #216](https://github.com/moascode/daybook/pull/216), merged
