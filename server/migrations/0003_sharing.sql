-- 0003_sharing.sql
-- Phase 5b: Household groups, shared accounts, transaction splits, settlements.
-- Additive only — no changes to existing tables.

CREATE TABLE IF NOT EXISTS groups (
  id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  name        TEXT NOT NULL,
  created_by  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TEXT DEFAULT (datetime('now'))
);

-- A user can belong to multiple groups simultaneously.
CREATE TABLE IF NOT EXISTS group_members (
  group_id   TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'member',  -- 'owner' | 'member'
  joined_at  TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (group_id, user_id)
);

-- Pending username-based invites (no email infra needed).
CREATE TABLE IF NOT EXISTS group_invites (
  id         TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  group_id   TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  invitee_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invited_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status     TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'accepted' | 'declined' | 'revoked'
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE (group_id, invitee_id)
);

-- Per-account share grant. Ownership stays with accounts.user_id;
-- this adds visibility (and optionally write) for group members.
CREATE TABLE IF NOT EXISTS account_shares (
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  group_id   TEXT NOT NULL REFERENCES groups(id)   ON DELETE CASCADE,
  can_write  INTEGER NOT NULL DEFAULT 0,  -- 0=read-only, 1=can add/edit transactions
  shared_at  TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (account_id, group_id)
);

-- Split lines. One row per user per split transaction.
-- The payer has a row too (their portion). SUM(share_amount) = transactions.amount.
CREATE TABLE IF NOT EXISTS transaction_shares (
  id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  transaction_id  TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  share_amount    REAL NOT NULL,
  note            TEXT DEFAULT '',
  settled_at      TEXT DEFAULT NULL,  -- NULL = outstanding
  created_at      TEXT DEFAULT (datetime('now')),
  UNIQUE (transaction_id, user_id)
);

-- Settlement records linking two real ledger transfer transactions.
CREATE TABLE IF NOT EXISTS settlements (
  id                   TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  group_id             TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  from_user            TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_user              TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount               REAL NOT NULL,
  currency             TEXT NOT NULL DEFAULT 'MYR',
  note                 TEXT DEFAULT '',
  from_transaction_id  TEXT REFERENCES transactions(id) ON DELETE SET NULL,
  to_transaction_id    TEXT REFERENCES transactions(id) ON DELETE SET NULL,
  settled_at           TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_group_members_user       ON group_members(user_id);
CREATE INDEX IF NOT EXISTS idx_account_shares_group     ON account_shares(group_id);
CREATE INDEX IF NOT EXISTS idx_txn_shares_user_settled  ON transaction_shares(user_id, settled_at);
CREATE INDEX IF NOT EXISTS idx_txn_shares_txn           ON transaction_shares(transaction_id);
CREATE INDEX IF NOT EXISTS idx_group_invites_invitee    ON group_invites(invitee_id, status);
CREATE INDEX IF NOT EXISTS idx_settlements_group        ON settlements(group_id);

-- Junction table linking settlements to the shares they cleared
CREATE TABLE IF NOT EXISTS settlement_share_lines (
  settlement_id TEXT NOT NULL REFERENCES settlements(id) ON DELETE CASCADE,
  share_id      TEXT NOT NULL REFERENCES transaction_shares(id) ON DELETE CASCADE,
  PRIMARY KEY (settlement_id, share_id)
);
