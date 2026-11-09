-- Two more transaction_rules conditions (worker/routes/rules.ts):
-- `match_description` is a case-insensitive "contains" on the transaction's
-- description (e.g. a card's last digits in a bank narrative), and
-- `match_tags` is a JSON array matched if the transaction carries ANY of them.
-- Both default to "no condition", so every existing rule behaves as before.
-- Mirrored byte-identically in worker/migrations/0035_rule_description_tags.sql.
ALTER TABLE transaction_rules ADD COLUMN match_description TEXT NOT NULL DEFAULT '';
ALTER TABLE transaction_rules ADD COLUMN match_tags TEXT NOT NULL DEFAULT '[]';
