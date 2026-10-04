-- FEAT-066 (docs/backlog/EP-06-wallet-depth/FEAT-066-budgets-design-adoption.md) —
-- a budget can roll last month's unused limit into this month's effective
-- limit (src/modules/wallet/budgets/insights.ts effectiveLimit()). Additive
-- only: no accumulating multi-month "bank" column — the effective limit only
-- ever folds in ONE prior month, never a running balance, to avoid
-- compounding logic that could silently drift.
ALTER TABLE budgets ADD COLUMN rollover_enabled INTEGER NOT NULL DEFAULT 0;
