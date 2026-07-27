-- Split → settlement review flow (docs/split-settlement-plan.md §4).
-- Mirrors worker/migrations/0010_split_review.sql — scripts/schema-diff.mjs
-- gates CI on the two staying identical.
--
-- Additive only. Defaults are chosen so every existing row keeps the meaning it
-- has today: the outstanding splits stay 'pending', and the one settlement that
-- predates the confirmation handshake stays 'confirmed' rather than being
-- retroactively stranded as unconfirmed.

-- ── Claim lifecycle on the split itself ──────────────
--   'pending' | 'awaiting_confirmation' | 'settled' | 'rejected'
ALTER TABLE transaction_splits ADD COLUMN status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE transaction_splits ADD COLUMN rejected_reason TEXT DEFAULT '';
ALTER TABLE transaction_splits ADD COLUMN rejected_at TEXT DEFAULT NULL;

-- ── Confirmation half of the settlement handshake ────
--   'awaiting_confirmation' | 'confirmed' | 'rejected'
ALTER TABLE settlements ADD COLUMN status TEXT NOT NULL DEFAULT 'confirmed';
ALTER TABLE settlements ADD COLUMN confirmed_at TEXT DEFAULT NULL;
ALTER TABLE settlements ADD COLUMN rejected_reason TEXT DEFAULT '';

-- ── Settlement ledger legs are balance-only ──────────
-- They move account balances but must never be summed into income or expense:
-- the payer's expense already drops by the settled amount, so counting the leg
-- as income too corrects the same money twice (§3).
--
-- A column, not a merchant-string or category match — both are user-editable,
-- and an edit would silently re-inflate the totals with no visible cause.
ALTER TABLE transactions ADD COLUMN is_reimbursement INTEGER NOT NULL DEFAULT 0;

-- ── Backfill ─────────────────────────────────────────
UPDATE transaction_splits SET status = 'settled' WHERE settled_at IS NOT NULL;

UPDATE transactions SET is_reimbursement = 1
  WHERE id IN (
    SELECT from_transaction_id FROM settlements WHERE from_transaction_id IS NOT NULL
    UNION
    SELECT to_transaction_id   FROM settlements WHERE to_transaction_id   IS NOT NULL
  );

CREATE INDEX IF NOT EXISTS idx_txn_splits_status ON transaction_splits(user_id, status);
