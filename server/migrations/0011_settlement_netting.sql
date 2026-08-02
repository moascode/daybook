-- Netting: settling when two people owe each other.
--
-- Only the difference needs to move; the rest is netted off. A netted debt is a
-- real settlement paid in kind, so it books like a cash one — it just moves no
-- money. Additive only; every existing row defaults to zero, which is what it is.

-- A real expense that moved no money — the mirror of is_balance_only, which is
-- money that moved but is not an expense.
--
-- Excluded from ACCOUNT BALANCES only. It stays in the transaction list, the
-- dashboard, reports and budgets, because it is real spending: you consumed the
-- goods, you just paid for them by giving up a receivable instead of cash.
-- Leaving it out of those would delete real household spending from the books —
-- RM30 of it, in the case this was built for.
ALTER TABLE transactions ADD COLUMN is_non_cash INTEGER NOT NULL DEFAULT 0;

-- How much of a claim was cleared by netting rather than by cash. Alongside
-- settled_amount, not instead of it: a netted claim is settled, and the group
-- balance is right to treat it that way. This says HOW, for the row hint and for
-- an exact reversal on undo.
ALTER TABLE transaction_splits     ADD COLUMN offset_amount REAL NOT NULL DEFAULT 0;
ALTER TABLE settlement_split_lines ADD COLUMN offset_amount REAL NOT NULL DEFAULT 0;

-- The netted half of a settlement, and the two expense legs it books — one per
-- person, because when debts run both ways both people discharge something.
ALTER TABLE settlements ADD COLUMN offset_total               REAL NOT NULL DEFAULT 0;
ALTER TABLE settlements ADD COLUMN offset_from_transaction_id TEXT DEFAULT NULL;
ALTER TABLE settlements ADD COLUMN offset_to_transaction_id   TEXT DEFAULT NULL;

-- The period the settlement covered, when it was scoped to one (YYYY-MM-DD).
-- NULL means all time, which is the default the dialog inherits.
ALTER TABLE settlements ADD COLUMN scope_from TEXT DEFAULT NULL;
ALTER TABLE settlements ADD COLUMN scope_to   TEXT DEFAULT NULL;
