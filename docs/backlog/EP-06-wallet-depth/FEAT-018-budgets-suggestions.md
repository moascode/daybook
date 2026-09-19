> **Status:** Scheduled · **Filed:** 2026-09-16 · **Epic:** [EP-06](README.md)

# FEAT-018 — Budgets: suggestions engine

**What.** Suggestions that reallocate between budgets, right-size one that is consistently wrong, and create budgets for categories that have none.

**Why now.** The most-used judgement in budgeting is "this number is wrong" — the data to say so already exists.

**Design.** [design.md](design.md) — the design work is already done; this item tracks *whether* to build it, not how.

**Still needed?** Yes — R8. The largest single item in EP-06, split into 3 PRs per the note below.

**Split, in flight:**
1. Engine + `GET /budgets/spending-history` (data layer only, no UI) — [PR #214](https://github.com/moascode/daybook/pull/214), merged
2. Suggestion rows + one-click actions on the Budgets page — [PR #215](https://github.com/moascode/daybook/pull/215), merged
3. 6-month budget-vs-actual chart — [PR #216](https://github.com/moascode/daybook/pull/216)
