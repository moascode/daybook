# D1 migrations

Applied with `wrangler d1 migrations apply daybook` (add `--local` for the
Miniflare database `wrangler dev` and the e2e suite use). Wrangler tracks what
has run in its own `d1_migrations` table, replacing the hand-rolled runner in
`server/db.ts`.

These files are ported from `server/migrations/`. **Every file is byte-identical
to its server counterpart except `0001_initial.sql`**, so drift between the two
backends stays auditable with a plain `diff` until the Phase 7 cutover retires
`server/`.

## Deviation 1 — renumbered

`server/migrations/` has two files numbered `0003`. The Node runner sorts
lexicographically, so `0003_fix_empty_tags.sql` applies before
`0003_sharing.sql`. Wrangler orders by the leading integer and will not accept a
duplicate, so everything from `sharing` onward shifts up by one. **The relative
order is unchanged**, which is what actually matters — `0006_partial_settlement`
alters tables that `0004_sharing` creates.

| server/migrations/ | worker/migrations/ |
|---|---|
| `0001_initial.sql` | `0001_initial.sql` |
| `0002_normalize_tags.sql` | `0002_normalize_tags.sql` |
| `0003_fix_empty_tags.sql` | `0003_fix_empty_tags.sql` |
| `0003_sharing.sql` | `0004_sharing.sql` |
| `0004_settlement_share_lines.sql` | `0005_settlement_share_lines.sql` |
| `0005_share_revamp.sql` | `0006_share_revamp.sql` |
| `0006_partial_settlement.sql` | `0007_partial_settlement.sql` |
| `0007_rename_transaction_shares.sql` | `0008_rename_transaction_shares.sql` |
| `0008_absorbed_import_hashes.sql` | `0009_absorbed_import_hashes.sql` |

Renumbering is safe precisely because D1 starts empty: no `d1_migrations` row
refers to the old names, so there is no history to invalidate. **That stops being
true after the first apply** — from then on these files are shipped and must
never be edited, exactly as CLAUDE.md §6 requires of the server set.

## Deviation 2 — no `schema_migrations` table

`0001_initial.sql` omits the `schema_migrations` DDL. That table is the Node
runner's ledger; `d1_migrations` replaces it.

## Data migrations are no-ops on a fresh database

`0002`, `0003`, and the backfill half of `0007` are `UPDATE` statements that
repair historical rows. Against an empty D1 they match nothing and do nothing.
They are kept anyway so the schema history stays a faithful record, and because
the Phase 7 import loads data from an already-migrated SQLite file — the rows
arrive in their final normalised shape.

## Adding a migration after cutover

Add `NNNN_description.sql` here with additive DDL only, same rules as CLAUDE.md
§6. Until Phase 7, a schema change needs the **same** change in both
`server/migrations/` and here, or the two backends diverge.
