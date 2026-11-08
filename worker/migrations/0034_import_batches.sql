-- Import history: one row per committed import, so a statement brought in
-- against the wrong account can be found and moved (or undone) as a batch.
-- Mirrored byte-identically in server/migrations/0033_import_batches.sql.
--
-- account_id is where the batch's rows currently live; POST /imports/:id/move
-- rewrites it and stamps moved_at. Row count and totals are NOT stored — they
-- are read from transactions.import_batch_id, so editing or deleting a row
-- afterwards can never leave the history disagreeing with the ledger.
--
-- transactions.import_batch_id has no FK, like transaction_rules' references:
-- deleting a batch row must never cascade into deleting money.
CREATE TABLE IF NOT EXISTS import_batches (
  id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id  TEXT NOT NULL,
  source_name TEXT NOT NULL DEFAULT '',
  kind        TEXT NOT NULL DEFAULT 'csv',
  moved_at    TEXT DEFAULT NULL,
  created_at  TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_import_batches_user ON import_batches(user_id, created_at);

ALTER TABLE transactions ADD COLUMN import_batch_id TEXT DEFAULT NULL;
CREATE INDEX IF NOT EXISTS idx_transactions_import_batch ON transactions(import_batch_id);
