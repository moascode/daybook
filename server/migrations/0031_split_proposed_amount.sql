-- Reject-with-counter-offer on a split (split review improvements).
-- Mirrored byte-identically in server/migrations/0031_split_proposed_amount.sql.
--
-- The debtor's counter-offer to a claim they are rejecting: "I don't owe the
-- full amount, but I do owe this much." Set only on a rejected split, by
-- POST /transactions/splits/:id/reject; cleared again by
-- POST /transactions/splits/:id/accept-proposal, which is the payer agreeing
-- to it. NULL on every other row and on every pre-existing one.
ALTER TABLE transaction_splits ADD COLUMN proposed_amount REAL DEFAULT NULL;
