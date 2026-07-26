-- 0007_rename_transaction_shares.sql
-- CD-05⁺: internal Split identifier rename. The user-facing Share→Split rename
-- shipped in Wave E3; this completes the internal tidy-up by renaming the two
-- tables that still carried the old "share" name to match the split vocabulary.
--
-- SQLite ≥ 3.25 (better-sqlite3 v12 bundles a newer build) rewrites foreign-key
-- references in child tables and moves indexes/constraints automatically on
-- ALTER TABLE … RENAME TO, so this is a lossless in-place rename — no
-- create-copy-drop needed. Column names (share_amount, share_id, …) are left
-- as-is; only the table identifiers change.
--
-- Order matters: rename the referenced table first so the child FK gets
-- rewritten to the new name, then rename the child table itself.

ALTER TABLE transaction_shares RENAME TO transaction_splits;
ALTER TABLE settlement_share_lines RENAME TO settlement_split_lines;
