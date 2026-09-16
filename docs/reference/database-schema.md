> **Status:** Live · **Last verified:** 2026-09-16

# Database schema

The source of truth for the schema, its invariants, and the traps D1 imposes on it.

> Extracted from `CLAUDE.md` on 2026-09-16. `CLAUDE.md` keeps the rules and the traps;
> this file holds the long-form reference they point at.

---

## 6. Database Schema (Source of Truth)

**NEVER modify this schema without explicit user instruction.**

> **Schema changes post-v1:** Add a new numbered file `server/migrations/NNNN_description.sql`
> with only `ALTER TABLE … ADD COLUMN` or `CREATE TABLE IF NOT EXISTS` statements.
> Never edit a migration file that has already shipped. Never drop a table or column.
> The migration runner in `server/db.ts` applies pending files automatically on first boot.
> The `schema_migrations` table records which files have run.

```sql
-- ─────────────────────────────────────────
-- TASKS MODULE
-- ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tasks (
  id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  parent_id     TEXT REFERENCES tasks(id) ON DELETE CASCADE,
  content       TEXT NOT NULL DEFAULT '',
  note          TEXT DEFAULT '',
  is_completed  INTEGER DEFAULT 0,   -- 0=false, 1=true (SQLite has no BOOLEAN)
  is_collapsed  INTEGER DEFAULT 0,
  sort_order    REAL NOT NULL DEFAULT 0,
  created_at    TEXT DEFAULT (datetime('now')),
  updated_at    TEXT DEFAULT (datetime('now'))
);

-- ─────────────────────────────────────────
-- WALLET MODULE
-- ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS accounts (
  id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  name        TEXT NOT NULL,
  description TEXT DEFAULT '',
  currency    TEXT NOT NULL DEFAULT 'MYR',
  type        TEXT NOT NULL DEFAULT 'cash',
  -- type values: 'cash' | 'card' | 'e-wallet' | 'bank' | 'investment' | 'other'
  color       TEXT DEFAULT '#1D9E75',
  icon        TEXT DEFAULT 'wallet',
  opening_balance REAL NOT NULL DEFAULT 0,
  -- starting balance before any transactions; included in the computed balance.
  -- Added post-v1 (server SCHEMA_VERSION 2). The app is single-currency (MYR):
  -- the per-account currency selector was removed; `currency` stays 'MYR'.
  created_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS categories (
  id    TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  name  TEXT NOT NULL,
  icon  TEXT DEFAULT 'tag',
  color TEXT DEFAULT '#378ADD',
  type  TEXT DEFAULT 'both'
  -- type values: 'income' | 'expense' | 'both'
);

CREATE TABLE IF NOT EXISTS transactions (
  id                    TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  account_id            TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  destination_account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  -- destination_account_id is only set when type = 'transfer'.
  -- A transfer moves money from account_id to destination_account_id.
  -- It does not count as income or expense; both accounts reflect the movement.
  date                  TEXT NOT NULL,          -- ISO date string: YYYY-MM-DD
  merchant              TEXT DEFAULT '',
  description           TEXT DEFAULT '',
  amount                REAL NOT NULL,          -- always positive; type field determines direction
  type                  TEXT NOT NULL DEFAULT 'expense',
  -- type values: 'income' | 'expense' | 'transfer'
  category_id           TEXT REFERENCES categories(id) ON DELETE SET NULL,
  tag                   TEXT DEFAULT '',
  -- Despite the singular column name, `tag` stores a JSON array of tag strings
  -- (e.g. '["groceries","reimbursable"]'); '' or '[]' means no tags. Transactions
  -- support MULTIPLE tags. Migrations 0002_normalize_tags / 0003_fix_empty_tags
  -- converted legacy plain-string values to JSON arrays so json_each() filtering
  -- works on every row. The client/API layer exposes this as `tags: string[]`;
  -- GET /api/tags returns the distinct tag values via json_each(t.tag).
  import_hash           TEXT DEFAULT '',
  -- import_hash: SHA-256 of (date + amount + merchant) used for CSV duplicate detection.
  -- Empty string for manually entered transactions.
  created_at            TEXT DEFAULT (datetime('now')),
  updated_at            TEXT DEFAULT (datetime('now'))
);

-- ─────────────────────────────────────────
-- SETTINGS (key-value store)
-- ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Known keys:
-- 'anthropic_api_key'   → user's API key (stored in DB, never in env vars at runtime)
-- 'default_currency'    → 'MYR'
-- 'theme'               → 'light' | 'dark' | 'system'  (all three shipped; default
--                          stays 'light'. Mirrored to localStorage 'daybook.theme'
--                          for the pre-paint script in index.html — see [`theming.md`](theming.md))
-- 'hide_completed'      → '0' | '1'
-- 'default_account_id'  → UUID of preferred account
```

### Default category seed data
Insert these for each new user on signup (Phase 4 — previously seeded globally):

```
Expenses: Food & Drink, Transport, Shopping, Bills & Utilities,
          Health, Entertainment, Travel, Education, Personal Care, Other

Income: Salary, Freelance, Investment, Gift, Other Income
```

### Phase 4 auth additions (server SQLite — implemented PR3)

```sql
CREATE TABLE users (
  id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,                 -- bcrypt
  created_at    TEXT DEFAULT (datetime('now'))
);

CREATE TABLE sessions (                        -- express-session store
  sid TEXT PRIMARY KEY, sess TEXT NOT NULL, expire INTEGER NOT NULL
);
```

- Every data table gains `user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE`
  (tasks, accounts, categories, transactions, budgets, recurring_transactions,
  goals, task_templates).
- `settings` is now per-user: primary key is `(user_id, key)`.
- `categories` and `settings` are seeded per user on signup, not globally.
- Every server query is scoped by `user_id`; one user can never read or write
  another's rows.
- Migration: a pre-auth DB (no `user_id`) has its data tables dropped+recreated
  on startup (pre-v1, no real data). Otherwise delete `server/data/*.db`.

### Phase 5b sharing additions (server SQLite — implemented PR #18)

Household groups, shared accounts, transaction splits, and settlement tracking.

```sql
-- Household groups
CREATE TABLE IF NOT EXISTS groups (
  id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  name        TEXT NOT NULL,
  created_by  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TEXT DEFAULT (datetime('now'))
);

-- Group membership (a user can belong to multiple groups)
CREATE TABLE IF NOT EXISTS group_members (
  group_id   TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'member',  -- 'owner' | 'member'
  joined_at  TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (group_id, user_id)
);

-- Pending username-based invites
CREATE TABLE IF NOT EXISTS group_invites (
  id         TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  group_id   TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  invitee_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invited_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status     TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'accepted' | 'declined' | 'revoked'
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE (group_id, invitee_id)
);

-- Per-account share grant (ownership stays with accounts.user_id)
CREATE TABLE IF NOT EXISTS account_shares (
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  group_id   TEXT NOT NULL REFERENCES groups(id)   ON DELETE CASCADE,
  can_write  INTEGER NOT NULL DEFAULT 0,  -- 0=read-only, 1=can add/edit transactions
  shared_at  TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (account_id, group_id)
);

-- Split lines (one row per participating user per split transaction; the payer
-- has a row only when they participate in the split — "Keep as-is" shares
-- write a single recipient-owes-100% row with no payer row)
CREATE TABLE IF NOT EXISTS transaction_shares (
  id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  transaction_id  TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  share_amount    REAL NOT NULL,
  note            TEXT DEFAULT '',
  settled_at      TEXT DEFAULT NULL,  -- NULL = outstanding; set when settled
  created_at      TEXT DEFAULT (datetime('now')),
  UNIQUE (transaction_id, user_id)
);

-- Settlement records linking two real ledger transfer transactions
CREATE TABLE IF NOT EXISTS settlements (
  id                   TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  group_id             TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  from_user            TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_user              TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount               REAL NOT NULL,
  currency             TEXT NOT NULL DEFAULT 'MYR',
  note                 TEXT DEFAULT '',
  from_transaction_id  TEXT REFERENCES transactions(id) ON DELETE SET NULL,
  to_transaction_id    TEXT REFERENCES transactions(id) ON DELETE SET NULL,
  settled_at           TEXT DEFAULT (datetime('now'))
);

-- Junction table linking settlements to the shares they cleared
CREATE TABLE IF NOT EXISTS settlement_share_lines (
  settlement_id TEXT NOT NULL REFERENCES settlements(id) ON DELETE CASCADE,
  share_id      TEXT NOT NULL REFERENCES transaction_shares(id) ON DELETE CASCADE,
  PRIMARY KEY (settlement_id, share_id)
);

-- Indexes for query performance
CREATE INDEX IF NOT EXISTS idx_group_members_user       ON group_members(user_id);
CREATE INDEX IF NOT EXISTS idx_account_shares_group     ON account_shares(group_id);
CREATE INDEX IF NOT EXISTS idx_txn_shares_user_settled  ON transaction_shares(user_id, settled_at);
CREATE INDEX IF NOT EXISTS idx_txn_shares_txn           ON transaction_shares(transaction_id);
CREATE INDEX IF NOT EXISTS idx_group_invites_invitee    ON group_invites(invitee_id, status);
CREATE INDEX IF NOT EXISTS idx_settlements_group        ON settlements(group_id);
```

**Key invariants**:
- Groups are opt-in; existing single-user data has no group visibility
- Account shares grant visibility + optional write access; ownership stays with the original user
- Transaction splits track who owes whom with `share_amount`; settling books two real ledger
  transactions — an expense on the payer's account and a matching income on the recipient's
  account (B-16: they are income/expense entries, not `transfer`-type rows)
- A payer row is written only when the payer participates in the split ("Keep as-is" writes just the recipient's row); group balances only count debtor rows, so both shapes settle correctly
- Non-members never see shared accounts or splits; visibility is scoped per user and group membership
- `settled_at` in `transaction_splits` marks when a split is cleared by a settlement

> **`POST /settlements` is the one route with a hand-built concurrency design.**
> D1 has no interactive transactions, so it hoists every read, computes the whole
> write set in JS, then issues ONE `batch()` whose split updates are
> compare-and-swap guarded on the exact `settled_amount` that was read
> (`WHERE id=? AND settled_at IS NULL AND settled_amount=?`).
> **`batch()` is atomic, but a CAS matching 0 rows is a SUCCESSFUL statement** —
> so `meta.changes` is inspected afterwards, and if any guard lost a race the
> settlement, its ledger legs and its split lines are removed by a compensating
> batch (restoring only splits still holding *our* value) and the caller gets
> 409. Verified by fault injection. Do not "simplify" this into a plain batch.

> **Paying implies agreeing (D-1).** Every post-settlement and rollback resting
> state is `approved`, which is why undo needs no memory of the prior status. The
> trap that cost a session: a debtor-side CAS probe wrote `status='pending'` as a
> supposed no-op — true only while `pending` was the sole payable state. Once
> `approved` became payable too, it silently demoted an agreed claim back into the
> review queue on every payment. It now assigns `settled_amount` to itself.

> **Lifecycle UI must group on a DERIVED claim state, never on `status`.** A
> claimed-but-unconfirmed split deliberately stays `pending`, so grouping on the
> raw column shows a paid claim as untouched and invites paying it twice.

> **CD-05⁺ rename (migration `0007_rename_transaction_shares.sql`):** the two
> tables above were renamed to complete the internal Share→Split vocabulary —
> `transaction_shares` → **`transaction_splits`** and `settlement_share_lines` →
> **`settlement_split_lines`** (a lossless `ALTER TABLE … RENAME TO`; column
> names such as `share_amount`/`share_id` and the `idx_txn_shares_*` indexes are
> unchanged). All current server code references the new names; the DDL blocks
> above are shown as originally shipped by 0003/0004/0006. The matching
> client/API contract also changed: routes `POST /transactions/:id/split`,
> `GET /transactions/:id/splits`, `POST /transactions/splits`,
> `POST /transactions/splits/status`, and the transaction response field
> `hasSplits`. (The separate `account_shares` table — account-level sharing — is
> unrelated and keeps its name.)

### CSV transfer linking additions (migration `0008_absorbed_import_hashes.sql`, PR #61)

Supports "Link as transfer" (docs/archive/csv-transfer-linking-plan.md): merging two
imported rows into one transfer deletes the money-in row, so its `import_hash`
is preserved here to keep duplicate detection working across statement
re-imports. Deleting the merged transfer cascades the hash away, letting a
re-import bring both legs back.

```sql
CREATE TABLE IF NOT EXISTS absorbed_import_hashes (
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  hash           TEXT NOT NULL,
  transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, hash)
);
CREATE INDEX IF NOT EXISTS idx_absorbed_hashes_txn ON absorbed_import_hashes(transaction_id);
```

- `POST /transactions/check-duplicates` matches hashes in **either** the
  `transactions` table or this side table.
- `POST /transactions/:id/link-transfer` `{twinId}` merges an expense and its
  matching income on another account into one transfer (write access on both
  accounts; opposite directions; amounts equal within 1 cent; no splits or
  settlement links; fee/FX legs rejected in v1).

### AI-assisted merchant name resolution (migration `0012_merchant_corrections.sql` / `0013_` on Workers, docs/archive/flow-plan.md)

Memoizes AI-derived merchant-name corrections per user, so Claude is only ever
asked about a given bank narrative template once.

```sql
CREATE TABLE IF NOT EXISTS merchant_corrections (
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  regex_guess    TEXT NOT NULL,
  corrected_name TEXT NOT NULL,
  created_at     TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, regex_guess)
);
```

- Resolution ladder, shared by both callers below (`resolveMerchantLadder` in
  `worker/routes/wallet.ts`): **regex guess** (`canonicalizeMerchantForDisplay`)
  → **`merchant_corrections` cache hit** (keyed on `correctionKey(guess)`, a
  trim/collapse/lower-case normalisation) → **the caller's own transaction
  history hit**, case-insensitive → **AI on the raw narrative**
  (`resolveMerchantsWithAI`, `worker/lib/anthropic.ts`, `claude-haiku-4-5`) →
  memoize the AI answer so the next occurrence of the same guess resolves free.
- `POST /merchants/resolve` `{items: [{raw, guess}]}` — called by CSV import
  (`CsvImport.tsx`) for every row whose merchant was split out of a narrative
  column, **before** category suggestion (suggestion groups by the final
  name, so this ordering is load-bearing). Returns
  `{resolutions: [{guess, name, source}], failedGuesses, failureReason?}`;
  always 200 — an unresolved guess keeps its regex value and is reported, never
  silently dropped (rule 13). `CsvReviewTable.tsx` marks an unresolved row with
  an icon; a manual merchant edit clears the marker.
- `POST /merchants/canonicalize` (bulk cleanup) runs the **same** ladder over
  every distinct stored merchant — the stored value is the raw input, its
  regex form is the first-stage guess — and the preview response gains
  `source` per row (`CanonicalizeMerchantsPage.tsx` shows it as a badge).
- Separate rate-limit bucket (`ai_rate_limit_merchant`, same 20/hour shape as
  category suggestion's `ai_rate_limit_suggest_categories`) so a large CSV
  import cannot exhaust the bulk-categorisation budget and the two AI features
  fail independently.
- Never affects `import_hash` (G11, [`feature-specs.md` §Wallet](feature-specs.md)): duplicate detection stays keyed on
  the raw narrative text captured before any resolution step runs.

---

## 7. TypeScript Types

```typescript
// ── tasks.types.ts ──────────────────────────────────
export interface Task {
  id: string
  parentId: string | null
  content: string
  note: string
  isCompleted: boolean
  isCollapsed: boolean
  sortOrder: number
  createdAt: string
  updatedAt: string
  children?: Task[]           // populated in-memory, not in DB
}

// ── wallet.types.ts ─────────────────────────────────
export interface Account {
  id: string
  name: string
  description: string
  currency: string
  type: 'cash' | 'card' | 'e-wallet' | 'bank' | 'investment' | 'other'
  color: string
  icon: string
  openingBalance: number                 // starting balance; included in the computed balance
  createdAt: string
  // Sharing (Phase 5b) — populated only on accounts shared in from another user:
  isShared?: boolean
  sharedByUserId?: string | null
  sharedByUsername?: string | null
  canWrite?: number                      // 0 | 1; only present on shared-in accounts
}

export type TransactionType = 'income' | 'expense' | 'transfer'

export interface Transaction {
  id: string
  accountId: string
  destinationAccountId: string | null   // only set when type === 'transfer'
  date: string                           // YYYY-MM-DD
  merchant: string
  description: string
  amount: number                         // always positive
  type: TransactionType
  categoryId: string | null
  tags: string[]                         // multiple free-text tags; stored in the DB `tag` column as a JSON array
  importHash: string                     // '' for manual entries; hash for CSV imports
  createdAt: string
  updatedAt: string
  hasSplits?: boolean                    // true when this transaction has been split with a group member
}

export interface Category {
  id: string
  name: string
  icon: string
  color: string
  type: 'income' | 'expense' | 'both'
}

export interface DailyGroup {
  date: string
  transactions: Transaction[]
  totalIncome: number
  totalExpense: number
  // Note: transfer transactions are excluded from totalIncome and totalExpense
}
```

---

## 8. Environment Variables

### `.env.example` (commit this file, not `.env.local`)
```
# Anthropic — get from console.anthropic.com
# Phase 1–3 (local): user enters key in the app UI; stored in the settings table.
# Phase 4 (cloud): move to a Vercel environment variable, called via Edge Function only.
VITE_ANTHROPIC_API_KEY=

# Supabase — Phase 4 only. Leave blank until Phase 4.
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
```

### `.env.local` (never commit — add to .gitignore)
```
VITE_ANTHROPIC_API_KEY=sk-ant-api03-...
```

**Security note:** In local phase, the API key lives in `.env.local` (Vite exposes it to the browser). This is acceptable for personal local use only. In Phase 4 (cloud hosting), the key moves to a Vercel environment variable and is called exclusively from a server-side Edge Function — it must never appear in the browser bundle. Enforce this before deploying.

---
