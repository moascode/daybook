-- FEAT-068 (docs/backlog/EP-06-wallet-depth/FEAT-068-recurring-design-adoption.md) —
-- recurring rules gain a pause flag and price-rise tracking. `paused` lets a
-- rule stop posting/notifying without deleting it; `previous_amount` +
-- `amount_changed_at` record an edit to `amount` so the "went up" nudge can
-- be computed without a transaction-to-rule link. All three additive, no
-- backfill needed — existing rows default to unpaused with no prior amount.
-- Mirrored in server/migrations/0026_recurring_pause_price.sql so
-- scripts/schema-diff.mjs parity holds.
ALTER TABLE recurring_transactions ADD COLUMN paused INTEGER NOT NULL DEFAULT 0;
ALTER TABLE recurring_transactions ADD COLUMN previous_amount REAL;
ALTER TABLE recurring_transactions ADD COLUMN amount_changed_at TEXT;
