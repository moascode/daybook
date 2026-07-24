-- Partial settlement support (B-02).
--
-- Previously a transaction_share was binary: settled_at NULL (fully owed) or set
-- (fully cleared). A payment smaller than a share either cleared it whole via
-- FIFO or was booked as real money that never reduced the debt. These columns
-- let a single share be cleared incrementally.
--
--   transaction_shares.settled_amount   how much of share_amount is already paid
--   settlement_share_lines.amount       how much THIS settlement applied to the share
--
-- A share is fully settled when settled_amount >= share_amount, at which point
-- settled_at is also set (kept for backward compatibility and history sorting).

ALTER TABLE transaction_shares ADD COLUMN settled_amount REAL NOT NULL DEFAULT 0;
ALTER TABLE settlement_share_lines ADD COLUMN amount REAL NOT NULL DEFAULT 0;

-- Backfill existing fully-settled shares so outstanding = share_amount - settled_amount
-- reads 0 for them, and so undo of a legacy settlement reverses the full amount.
UPDATE transaction_shares
SET settled_amount = share_amount
WHERE settled_at IS NOT NULL;

UPDATE settlement_share_lines
SET amount = (
  SELECT ts.share_amount
  FROM transaction_shares ts
  WHERE ts.id = settlement_share_lines.share_id
)
WHERE amount = 0;
