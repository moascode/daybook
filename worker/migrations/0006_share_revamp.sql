-- Add original_transaction_id to settlements table
-- Links settlements back to the original shared transaction that triggered them
ALTER TABLE settlements ADD COLUMN original_transaction_id TEXT REFERENCES transactions(id) ON DELETE SET NULL;

-- Index for query performance
CREATE INDEX IF NOT EXISTS idx_settlements_original_txn ON settlements(original_transaction_id);

-- Backward compatibility: existing settlements have NULL original_transaction_id
