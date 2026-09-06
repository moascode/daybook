-- R18 — pending captures (docs/v2/wallet/feature-capture-inbox.md §5, §6).
--
-- Every machine-written transaction lands here first and reaches `transactions`
-- only when a human accepts it. Rows are NEVER deleted: the UNIQUE
-- (user_id, idempotency_key) row IS the idempotency guarantee, so removing an
-- accepted or dismissed row would let a replayed request create a second
-- capture. Accepted and dismissed rows are history; the inbox lists
-- status='pending' only.
CREATE TABLE IF NOT EXISTS pending_captures (
  id                   TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id              TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_id             TEXT REFERENCES capture_tokens(id) ON DELETE SET NULL,
  source               TEXT NOT NULL DEFAULT 'api',
  idempotency_key      TEXT NOT NULL,
  raw_merchant         TEXT DEFAULT '',
  raw_card             TEXT DEFAULT '',
  raw_destination_card TEXT DEFAULT '',
  amount               REAL NOT NULL,
  type                 TEXT NOT NULL DEFAULT 'expense',
  occurred_at          TEXT NOT NULL,
  duplicate_key        TEXT NOT NULL DEFAULT '',
  status               TEXT NOT NULL DEFAULT 'pending',
  transaction_id       TEXT REFERENCES transactions(id) ON DELETE SET NULL,
  created_at           TEXT DEFAULT (datetime('now')),
  UNIQUE (user_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_pending_captures_status ON pending_captures(user_id, status);
CREATE INDEX IF NOT EXISTS idx_pending_captures_dupkey ON pending_captures(user_id, duplicate_key);
