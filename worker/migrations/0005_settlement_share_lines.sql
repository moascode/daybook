-- Track exactly which transaction_shares rows each settlement cleared.
-- Used for precise undo (S-2: replace broad date-based undo with exact reversal).
CREATE TABLE IF NOT EXISTS settlement_share_lines (
  settlement_id TEXT NOT NULL REFERENCES settlements(id) ON DELETE CASCADE,
  share_id      TEXT NOT NULL REFERENCES transaction_shares(id) ON DELETE CASCADE,
  PRIMARY KEY (settlement_id, share_id)
);
