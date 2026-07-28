-- Split → settlement review flow (docs/split-settlement-plan.md §4).
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

-- ── The creditor's incoming leg is balance-only ──────
-- Set ONLY on the money-in leg (§3). The creditor's expense already fell by the
-- settled amount, so counting the arrival as income would correct the same money
-- twice. The debtor's outgoing payment is deliberately NOT flagged — it is a
-- normal expense and her only record of what she bore.
--
-- A column rather than a merchant-string or category match: both of those are
-- user-editable, and an edit would silently re-inflate the totals.
ALTER TABLE transactions ADD COLUMN is_balance_only INTEGER NOT NULL DEFAULT 0;

-- ── Backfill ─────────────────────────────────────────
UPDATE transaction_splits SET status = 'settled' WHERE settled_at IS NOT NULL;

-- to_transaction_id only — see above. On current live data this matches ZERO
-- rows: the single existing settlement has to_transaction_id = NULL because the
-- counterparty leg could never be written (the debtor had no shared account of
-- the creditor's to target). Zero is the expected result, not a failed step.
UPDATE transactions SET is_balance_only = 1
  WHERE id IN (
    SELECT to_transaction_id FROM settlements WHERE to_transaction_id IS NOT NULL
  );

CREATE INDEX IF NOT EXISTS idx_txn_splits_status ON transaction_splits(user_id, status);
