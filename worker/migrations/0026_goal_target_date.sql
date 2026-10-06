-- FEAT-067 (docs/backlog/EP-06-wallet-depth/FEAT-067-goals-design-adoption.md) —
-- goals gain an optional target date (drives On track / Behind / Ahead
-- status and "needs $X/mo") and an optional note (card subtitle). Both
-- nullable, no default — a goal with neither keeps today's ETA-only
-- behaviour. Additive only, mirrored in server/migrations/0025_goal_target_date.sql
-- so scripts/schema-diff.mjs parity holds.
ALTER TABLE goals ADD COLUMN target_date TEXT;
ALTER TABLE goals ADD COLUMN note TEXT;
