# Cross-source duplicate detection

**Status: implemented (2026-09-06).** No AI involved — pure deterministic
matching, RULES-ONLY per `docs/v2/cross-cutting/ai-usage.md` §2.3.

## 1. The gap

Photo import (P2) and CSV import can both bring the same real-world
transaction into the ledger, but they don't produce the same merchant text:
CSV hashes the raw bank narrative ("GRABFOOD MY SDN BHD 041225"), photo import
hashes the AI-extracted clean name ("Grab Food"). The original single-layer
`import_hash` (`SHA-256(date|amount|merchant)`) never matched across the two,
so importing a bank statement CSV and later photographing the paper receipt
for the same charge silently double-counted it.

## 2. Three layers, cheapest and safest first

1. **Exact `import_hash`** (unchanged). Catches re-importing the identical
   source again — same CSV row, same photo. Zero false-positive risk.
2. **Exact `duplicate_key`** (new). A normalized fingerprint —
   `${date}|${amountCents}|${type}|${canonicalMerchant}` — computed
   **server-side only**, at every transaction insert
   (`worker/routes/wallet.ts`'s `insertTransactionStmt`, the single write path
   shared by manual create, CSV import, and photo import), using
   `buildDuplicateKey` (`worker/lib/merchant.ts`), which reuses the existing
   `canonicalMerchant()` normalizer the merchant-resolution ladder already
   relies on. "Grab Food" and "GRABFOOD MY SDN BHD 041225" both fold to the
   same key, so a CSV import and a photo import of the same transaction are
   now caught. One function, one place — every future import source gets this
   for free.
3. **Soft "possible duplicate"** (new, never auto-excludes). For rows layers
   1–2 don't catch: same date + exact amount as an existing transaction, but
   a merchant that canonicalizes differently (e.g. "Village Grocer" vs "VG
   RETAIL SDN BHD" — no automatic transform bridges that). This is
   deliberately **not** treated as a duplicate — two genuine same-day,
   same-amount transactions (two RM12 Grab rides) must never be silently
   merged. It surfaces as a dismissible amber hint in the review table
   (`CsvReviewTable.tsx`, `data-testid="csv-possible-duplicate"`); the row
   stays `included` by default and the human decides.

## 3. `POST /transactions/check-duplicates` contract

Request: `{ items: [{ hash, date, amount, merchant, type }] }` — the caller's
own `date`/`amount`/`merchant`/`type` per candidate row (needed so the server
can compute each row's `duplicateKey` the same way it would at insert time).

Response: `{ duplicateHashes: string[], possibleDuplicates: Record<hash, {id, merchant, date, amount}[]> }`.

Batched the same way the original hash-only check was (D1's 100-bound-param
cap per query), plus one query per distinct `(date, amount)` pair for layer 3
— still one `db.batch()` round trip regardless of import size (imports run
50–500 rows typically; S2 already proved 5,000-row batches are fine).

## 4. Known limitation — no backfill

`duplicate_key` is computed only at insert time. Transactions created before
this migration (`server/migrations/0016_duplicate_key.sql` /
`worker/migrations/0017_duplicate_key.sql`) have `duplicate_key = ''` (the
migration's default) and never participate in layer 2 for themselves — they
fall back to layer 3's soft candidate check instead, which still surfaces
them, just without the auto-exclude. Editing a transaction's merchant/date/
amount/type does not recompute `duplicate_key` either, matching the existing
`import_hash` precedent (also never recomputed on edit).
