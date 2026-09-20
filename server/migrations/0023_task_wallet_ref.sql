-- FEAT-032 (docs/backlog/EP-07-tasks-depth/FEAT-032-tasks-wallet-chips.md) —
-- links a task to a Wallet object so its row can show related spend, e.g.
-- "Wallet · RM1,800 due tomorrow" or "Wallet goal · 88% funded". A nullable
-- `kind:id` string (e.g. 'recurring:<id>', 'goal:<id>') is narrower than a
-- join table for a feature that is one chip (design.md).
ALTER TABLE tasks ADD COLUMN wallet_ref TEXT DEFAULT NULL;
