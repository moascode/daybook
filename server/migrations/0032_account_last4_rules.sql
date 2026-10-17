-- Account last-4-digits + transaction rules.
-- Mirrored byte-identically in worker/migrations/0033_account_last4_rules.sql.
--
-- `last4` lets the UI (and rule matching below) disambiguate two cards on the
-- same issuer without storing a full card number. '' means "not set" — the
-- API (worker/routes/wallet.ts) rejects anything else that isn't exactly 4
-- digits, and rejects a value another of the caller's OWN accounts already
-- uses (cross-user collisions are fine; two of your own cards sharing a
-- last4 is the confusing case this blocks).
ALTER TABLE accounts ADD COLUMN last4 TEXT NOT NULL DEFAULT '';

-- transaction_rules — a user's own ordered list of auto-categorise/auto-tag/
-- auto-split rules (worker/routes/rules.ts), evaluated against new
-- transactions.
--
-- Deliberately NO FK on match_account_id / match_category_id / set_category_id
-- to accounts/categories: those tables cascade-delete their own children (a
-- deleted account drops its transactions), and a rule is not a child of the
-- account or category it merely references. An FK here would silently delete
-- the rule the moment its matched account/category is removed; instead a
-- dangling id is treated as "this condition/action no longer matches/applies"
-- by the API, and the rule survives for the caller to fix or remove by hand.
CREATE TABLE IF NOT EXISTS transaction_rules (
  id                TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  position          INTEGER NOT NULL DEFAULT 0,
  enabled           INTEGER NOT NULL DEFAULT 1,
  match_account_id  TEXT DEFAULT NULL,
  match_category_id TEXT DEFAULT NULL,
  match_merchant    TEXT NOT NULL DEFAULT '',
  set_category_id   TEXT DEFAULT NULL,
  add_tags          TEXT NOT NULL DEFAULT '[]',
  split_user_id     TEXT DEFAULT NULL,
  split_percent     REAL DEFAULT NULL,
  created_at        TEXT DEFAULT (datetime('now')),
  updated_at        TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_transaction_rules_user ON transaction_rules(user_id, position);
