-- ─────────────────────────────────────────────────────────────────────────────
-- ONE-OFF: clear the wallet data from a database, keeping who you are.
--
--   npx wrangler d1 export  daybook --remote --output backup-pre-wipe.sql
--   npx wrangler d1 execute daybook --remote --file scripts/reset-prod-data.sql
--
-- Written for the 2026-08-03 reset: months of testing needed clearing before
-- real bank exports went in. Kept in the repo so the next reset is a reviewed
-- file rather than DELETEs typed at a prompt against production.
--
-- ⚠️  DESTRUCTIVE AND NOT REVERSIBLE from inside the app. Take the export
--     above first. D1 time-travel (~30 days) is the backstop, not the plan.
--
-- ── What this deliberately KEEPS ────────────────────────────────────────────
--
--   users, sessions        production has DAYBOOK_ALLOW_SIGNUP="false", so
--                          deleting a user is a lockout with no way back
--                          through the UI. Never add users to this file.
--   accounts               CSV import targets an account; dropping them means
--                          rebuilding every opening balance by hand first.
--   categories, settings   per-user and often customised; re-seeding would
--                          throw that away and rename nothing back.
--   groups, group_members,
--   group_invites,
--   account_shares         the household wiring. Rebuilding it means
--                          re-inviting and re-accepting, for no gain.
--   tasks, task_templates  a different module entirely. Not test data.
--
-- ── Order ───────────────────────────────────────────────────────────────────
--
-- Children before parents, and genuinely so: D1 does not expose
-- `PRAGMA foreign_keys = OFF` (see worker/routes/test.ts), so this cannot lean
-- on enforcement being switched off the way the old Node wipe did. Deleting
-- `transactions` first would strand settlement_split_lines rows whose split has
-- gone, and `settlements.from_transaction_id` is ON DELETE SET NULL rather than
-- CASCADE, so those rows survive their own ledger legs.
-- ─────────────────────────────────────────────────────────────────────────────

-- Settlement bookkeeping first: it references both settlements and the splits.
DELETE FROM settlement_split_lines;
DELETE FROM settlements;

-- Claims, then the duplicate-detection side table, then the ledger itself.
DELETE FROM transaction_splits;
DELETE FROM absorbed_import_hashes;
DELETE FROM transactions;

-- Planning data. Independent of the above, but all of it is test data too and
-- budgets carry a category_id that will no longer mean anything useful.
DELETE FROM budgets;
DELETE FROM recurring_transactions;
DELETE FROM goals;
