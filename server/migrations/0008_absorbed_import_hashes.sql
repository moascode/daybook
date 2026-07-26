-- Item 4 of docs/csv-transfer-linking-plan.md: when two imported rows merge
-- into one transfer (link-as-transfer), the absorbed row is deleted and its
-- import_hash would vanish — letting a re-import of the same statement slip
-- past duplicate detection. This side table preserves absorbed hashes for the
-- lifetime of the merged transfer; deleting the transfer cascades here, so a
-- re-import then correctly brings both sides back.
CREATE TABLE IF NOT EXISTS absorbed_import_hashes (
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  hash           TEXT NOT NULL,
  transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, hash)
);

CREATE INDEX IF NOT EXISTS idx_absorbed_hashes_txn ON absorbed_import_hashes(transaction_id);
