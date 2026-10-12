-- FEAT-024 PR C (docs/backlog/EP-06-wallet-depth/FEAT-024-design.md §3) —
-- three-party ("chain") settlement. A minimum-transfer plan routinely
-- proposes a payment between two people who share no splits; this lets that
-- transfer execute atomically across every party it passes through.
-- Additive only. Mirrored in worker/migrations/0028_settlement_chains.sql so
-- scripts/schema-diff.mjs parity holds.
CREATE TABLE settlement_chains (
  id          TEXT PRIMARY KEY,
  group_id    TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  created_by  TEXT NOT NULL REFERENCES users(id),
  payer_id    TEXT NOT NULL REFERENCES users(id),
  payee_id    TEXT NOT NULL REFERENCES users(id),
  amount      REAL NOT NULL,
  note        TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'awaiting_confirmation', -- | 'confirmed' | 'rejected'
  rejected_reason TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  confirmed_at TEXT
);
CREATE TABLE settlement_chain_parties (
  chain_id     TEXT NOT NULL REFERENCES settlement_chains(id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL REFERENCES users(id),
  account_id   TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  confirmed_at TEXT,
  PRIMARY KEY (chain_id, user_id)
);
ALTER TABLE settlements ADD COLUMN chain_id TEXT REFERENCES settlement_chains(id);
CREATE INDEX IF NOT EXISTS idx_settlements_chain ON settlements(chain_id);
