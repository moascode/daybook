# Implementation Plan: CSV Transfer Import + Twin-Linking

> Status: **Approved, not yet implemented.** Owner-approved 2026-07-26.
> Delivers as a 2-PR sequence (see *Sequencing*). This document is the spec;
> code lands in follow-up PRs.

## Goal

Let inter-account movements (e.g. paying a credit card from a bank account) be
recorded as a **single transfer** instead of two double-counted income/expense
rows — both at import time and after the fact — and keep duplicate detection
working across **re-imports** of the same statement.

### Why this matters

A transfer between the user's own accounts is a single logical event, but a bank
export represents it as two lines: a money-out line on the source statement and a
money-in line on the destination statement. Imported naively, Daybook creates two
independent rows typed income/expense, which:

- **double-counts** the movement in spending and income totals (transfers are
  supposed to be excluded from both), and
- leaves two unlinked rows for what is really one transfer.

The transfer data model itself is already correct (a single row carrying both
`account_id` and `destination_account_id`, excluded from income/expense) — the gap
is purely in the **import** and **post-hoc reconciliation** paths.

## Grounding: current-state facts (verified in code)

- `ImportRow` (`src/lib/csv.ts`) only has `type: 'income' | 'expense'`, assigned by
  amount sign in `buildImportRows`. Every row imports into one `selectedAccountId`.
- The server import route (`POST /transactions/import`) and `insertTransaction`
  (`server/routes/wallet.ts`) **already accept** `type:'transfer'` +
  `destinationAccountId`, with destination write-permission checks (B-07). So the
  import-side transfer support is largely a **client** change.
- `PATCH /transactions/:id` already supports changing a row's type to `transfer`.
  So "set a transaction as a transfer independently" already works today — it only
  lacks discoverability.
- Duplicate detection: the client hashes rows and calls
  `POST /transactions/check-duplicates`, which matches `transactions.import_hash IN
  (...)`. A hash only dedups **while its row exists** — which is why merging (which
  deletes a row) requires the absorbed-hash table in Item 4.

---

## Item 1 — Transfer option in the CSV Review step

**Files:** `src/lib/csv.ts`, `src/modules/wallet/CsvReviewTable.tsx`,
`src/modules/wallet/CsvImport.tsx`

1. Extend `ImportRow`: `type: 'income' | 'expense' | 'transfer'` and
   `destinationAccountId: string | null`.
2. In `CsvReviewTable`, add a per-row **Type** control; when `transfer` is chosen,
   show a **destination account** dropdown (accounts excluding the import target),
   and hide the category control (transfers are uncategorised).
3. In `CsvImport.handleImport`, thread `type` and `destinationAccountId` into the
   `TransactionInput` payload.
4. Client-side validation before submit: a transfer row must have a destination
   distinct from the import account (mirrors `transactionInputError`).

**Server:** no change — the import route already handles transfer rows and checks
destination write-permission.

**Effort:** ~0.5 day. **Risk:** low.

---

## Item 3 — Discoverability on edit

**Files:** `src/modules/wallet/TransactionForm.tsx`

Add a one-line hint near the Type selector when editing an imported income/expense:
*"Moved money between your own accounts? Switch Type to Transfer, or use 'Link as
transfer' to pair it with the other side."* No logic change.

**Effort:** ~1 hr. **Risk:** none.

---

## Item 4 — Dedup preservation across re-imports (foundation for merge)

**Files:** new `server/migrations/0008_absorbed_import_hashes.sql`,
`server/routes/wallet.ts`

When two rows merge into one transfer (Item 2), the absorbed row is deleted and its
`import_hash` disappears — so a **re-import** of that statement would slip through
undetected. Fix with a side table:

```sql
CREATE TABLE IF NOT EXISTS absorbed_import_hashes (
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  hash           TEXT NOT NULL,
  transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, hash)
);
```

- `POST /transactions/check-duplicates` additionally selects from
  `absorbed_import_hashes`; a hash is a duplicate if present in **either** table.
- `ON DELETE CASCADE` on `transaction_id`: deleting the merged transfer clears its
  absorbed hashes automatically, so re-importing correctly brings **both** sides
  back.

**Effort:** ~0.5 day. **Risk:** low (additive migration; one query touched).

---

## Item 2 — "Link as transfer" (merge two existing rows → one transfer)

**Files:** `server/routes/wallet.ts` (new endpoint), a small picker component +
`src/modules/wallet/TransactionForm.tsx`, `src/hooks/useWallet.ts`

**New endpoint:** `POST /transactions/:id/link-transfer`, body `{ twinId }`.

Server logic, in a single `db.transaction`:

1. Load both rows; verify the caller can write **both** accounts.
2. **Guards** (reject 4xx with a clear message):
   - different accounts,
   - opposite directions (one money-out, one money-in),
   - amounts equal within 1 cent,
   - neither row already a `transfer`,
   - neither row has splits (`transaction_splits`) or a settlement link,
   - neither row already linked.
3. Convert the **money-out** row into the transfer: `type='transfer'`,
   `destination_account_id =` the money-in row's account; clear `category_id` and
   `tag`.
4. Record the money-in row's `import_hash` in `absorbed_import_hashes` (Item 4),
   then **delete** the money-in row.
5. Return the surviving transfer row.

**Client UX:** the edit form gains a **"Link as transfer"** action that opens a
picker of **candidate** transactions — opposite direction, matching amount, in
other accounts, within ±N days — ranked best-match first. Selecting one calls the
endpoint; the two rows collapse into a single transfer line.

**Scope decision — fee/FX transfers (v1):** when the two legs differ (a fee or FX
spread), they can't be represented as one single-row transfer. v1 **rejects** the
link with a clear message rather than guessing. Splitting the fee out is a possible
future enhancement, deliberately deferred.

**Effort:** ~1.5–2 days. **Risk:** medium — it deletes a row and mutates money
math, so it carries the most test coverage. It reuses the existing single-row
transfer model, so balance / totals / display need no changes.

---

## Testing (CLAUDE.md Rule 11 — e2e required)

- **`49-csv-transfer-import.spec.ts`** — import a statement, mark a row
  Transfer→another account; assert one transfer row, excluded from income/expense
  totals, balances move on both accounts.
- **`50-transfer-linking.spec.ts`** — create an expense in A and an income in B,
  link them; assert a single transfer and both totals drop; assert guard cases
  (same account, mismatched amount, already-split) are rejected.
- **`51-reimport-dedup.spec.ts`** — merge a pair, re-run `check-duplicates` with the
  absorbed hash → reported duplicate; delete the transfer → hash no longer a
  duplicate.
- Regression: `04-wallet-csv`, `03-wallet-transactions`,
  `42-wallet-data-integrity`, `02-wallet-accounts`.

---

## Sequencing (2 PRs)

- **PR 1 — `feat/csv-transfer-import`:** Items **1 + 3**. No schema change,
  self-contained, immediately useful.
- **PR 2 — `feat/transfer-linking`:** Items **4 + 2** (migration 0008 + merge
  endpoint + picker UI). Item 4 ships with Item 2 because it exists to serve it.

## Total effort & impact

- **Effort:** ~3–4 focused days across 2 PRs.
- **Impact:** high — closes the last correctness gap in the transfer model and
  directly fixes the dual-statement import workflow. Because the owner re-imports
  statements, Item 4 is load-bearing, not optional.

## Docs

Add a **"Credit cards & transfers"** section to the in-app `/help` guide covering
purchase-as-expense / pay-as-transfer, plus the new import-as-transfer and
link-as-transfer options, so other users don't hit the same confusion.

## Open decisions (defaults chosen; revisit if needed)

1. **Fee/FX transfers:** v1 rejects mismatched-amount links with a clear message.
2. **Candidate window (±N days):** start at ±5 days; tune after real use.
