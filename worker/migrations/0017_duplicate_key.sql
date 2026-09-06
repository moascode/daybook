ALTER TABLE transactions ADD COLUMN duplicate_key TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_transactions_duplicate_key ON transactions(user_id, duplicate_key);
CREATE INDEX IF NOT EXISTS idx_transactions_date_amount ON transactions(user_id, date, amount);
