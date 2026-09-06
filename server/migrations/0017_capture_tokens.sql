-- R18 — capture tokens (docs/v2/wallet/feature-capture-inbox.md §4).
-- The credential a non-browser client uses to create a pending capture.
-- token_hash is SHA-256 hex; the plaintext token is never stored.
CREATE TABLE IF NOT EXISTS capture_tokens (
  id           TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label        TEXT NOT NULL DEFAULT '',
  token_hash   TEXT NOT NULL UNIQUE,
  scope        TEXT NOT NULL DEFAULT 'capture:write',
  created_at   TEXT DEFAULT (datetime('now')),
  last_used_at TEXT DEFAULT NULL,
  revoked_at   TEXT DEFAULT NULL
);
CREATE INDEX IF NOT EXISTS idx_capture_tokens_user ON capture_tokens(user_id);
