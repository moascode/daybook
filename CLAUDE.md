# DAYBOOK — Project Brain (CLAUDE.md)

> **CLAUDE CODE: Read this entire file before writing a single line of code.**
> This is the authoritative source of truth for every decision in this project.
> Never guess. Never assume. If something contradicts this file, ask the user.

---

## 1. Project Identity

| Field | Value |
|---|---|
| **App name** | Daybook |
| **Owner** | Personal use — single user |
| **Purpose** | Unified productivity + finance app |
| **Modules** | Tasks (Workflowy-style) + Wallet (BudgetBakers-style) |
| **Architecture** | Local-first → Cloud sync (Supabase, Phase 4) |
| **Primary currency** | MYR (Malaysian Ringgit) |
| **Target platform** | Web browser (desktop-first) |
| **Free subdomain** | daybook.vercel.app (no paid domain) |

---

## 2. Critical Rules for Claude Code

1. **Read this file first.** Every session. No exceptions.
2. **Never install unlisted packages.** The approved stack is in Section 4. If you think you need something new, ask first.
3. **Never modify the database schema** without explicit user instruction. Schema is in Section 6.
4. **Never create a file** without checking Section 5 (folder structure) first.
5. **No `any` types.** Use `unknown` if the type is genuinely unknown, then narrow it.
6. **Check before creating.** If a component, hook, or utility might already exist, check `/src` first.
7. **One concern per file.** No 500-line god components.
8. **Ask, don't assume.** If a feature spec is ambiguous, ask the user. Don't invent behaviour.
9. **Keep `.env.local` out of git.** It is in `.gitignore`. Never log or expose API keys.
10. **Phase discipline.** Only build features in the current phase (see Section 9). Don't jump ahead.
11. **E2E tests required.** Every new feature or behaviour change must have a corresponding Playwright test in `/e2e/`. Before marking any feature complete, run `npx playwright test` to confirm no regressions. New spec files follow the naming pattern `NN-description.spec.ts`. See Section 16 for conventions.
12. **Branch before you touch anything.** Never commit directly to `main`. Every task — no matter how small — starts with `git checkout -b <branch>`. When done, open a PR. See Section 11 for naming and PR conventions.

---

## 3. Architecture Overview

```
Browser (React + Vite)
├── SQLite (PGlite — runs in-browser, persists in IndexedDB)
├── Zustand stores (in-memory state)
├── Anthropic API (called from browser during local phase)
│
└── [Phase 4 additions]
    ├── Supabase Postgres (replaces SQLite for cloud sync)
    ├── Supabase Auth (email/password)
    └── Vercel Edge Function (proxies Anthropic API key)
```

**Local-first principle:** The app works 100% offline in Phases 1–3. PGlite stores all data in the browser's IndexedDB. No server required. Claude API calls go directly from the browser using the user's API key stored in the settings table (never sent to any server the user doesn't control).

**Security note — Phase 4 requirement:** `VITE_` prefixed env vars are compiled into the browser bundle and readable in devtools. The API key must move behind a Vercel Edge Function before Phase 4 deploys to a public URL. This is non-negotiable.

**PGlite storage note:** IndexedDB quotas vary by browser (Chrome ~60% of disk, Safari can be more aggressive). Test storage behaviour under realistic data volumes before Phase 4. For a personal finance app accumulating years of data, this matters.

---

## 4. Approved Tech Stack

### ONLY use packages from this list. No substitutions without user approval.

#### Core
| Package | Version | Purpose |
|---|---|---|
| `react` | ^18.3 | UI framework |
| `react-dom` | ^18.3 | DOM rendering |
| `typescript` | ^5.4 | Type safety |
| `vite` | ^5.2 | Build tool + dev server |

#### Styling
| Package | Version | Purpose |
|---|---|---|
| `tailwindcss` | ^3.4 | Utility CSS |
| `autoprefixer` | ^10.4 | CSS vendor prefixes |
| `postcss` | ^8.4 | CSS processing |
| `clsx` | ^2.1 | Conditional classnames |
| `tailwind-merge` | ^2.3 | Merge Tailwind classes safely |

#### State & Data
| Package | Version | Purpose |
|---|---|---|
| `zustand` | ^4.5 | Global client state |
| `@tanstack/react-query` | ^5.40 | Async state (Phase 4 only — do not use before Phase 4) |

#### Database (Local)
| Package | Version | Purpose |
|---|---|---|
| `@electric-sql/pglite` | ^0.2 | SQLite running in browser |
| `drizzle-orm` | ^0.31 | Type-safe SQL query builder |
| `drizzle-kit` | ^0.22 | Schema migrations (dev tool) |

#### Routing
| Package | Version | Purpose |
|---|---|---|
| `react-router-dom` | ^6.23 | Client-side routing |

#### UI Primitives
| Package | Version | Purpose |
|---|---|---|
| `@radix-ui/react-dialog` | latest | Modal/dialog |
| `@radix-ui/react-dropdown-menu` | latest | Dropdowns |
| `@radix-ui/react-tooltip` | latest | Tooltips |
| `@radix-ui/react-popover` | latest | Popovers |
| `lucide-react` | ^0.390 | Icons |

#### Tasks Module
| Package | Version | Purpose |
|---|---|---|
| `@dnd-kit/core` | ^6.1 | Drag-and-drop core |
| `@dnd-kit/sortable` | ^8.0 | Sortable lists |
| `@dnd-kit/utilities` | ^3.2 | DnD utilities |

#### Wallet Module
| Package | Version | Purpose |
|---|---|---|
| `recharts` | ^2.12 | Charts (cash flow, pie) |
| `papaparse` | ^5.4 | CSV parsing |
| `@types/papaparse` | ^5.3 | Types for PapaParse |
| `date-fns` | ^3.6 | Date formatting/manipulation — note: v3 has breaking changes from v2, do not copy v2 examples verbatim |

#### AI
| Package | Version | Purpose |
|---|---|---|
| `@anthropic-ai/sdk` | ^0.39 | Anthropic API client |

#### Backend (Phase 4 — Home Network + Multi-User)
| Package | Version | Purpose |
|---|---|---|
| `express` | ^5 | HTTP API server (Node) |
| `better-sqlite3` | ^12 | Synchronous SQLite driver (server owns the DB file) |
| `bcrypt` | ^6 | Password hashing (auth stage) |
| `express-session` | ^1 | Session cookies (auth stage) |
| `tsx` | ^4 | Run/typecheck the TypeScript server (dev tool) |

> Phase 4 replaces the in-browser PGlite store with a Node + SQLite backend the
> browser calls over `/api`. `bcrypt` and `express-session` land in the auth
> stage. See `docs/phase-4-plan.md`.

#### Cloud (Phase 6 only — do not install before Phase 6)
| Package | Version | Purpose |
|---|---|---|
| `@supabase/supabase-js` | ^2.43 | Supabase client |
| `@supabase/auth-ui-react` | ^0.4 | Auth UI components |

---

## 5. Folder Structure

```
daybook/
├── CLAUDE.md                        ← YOU ARE HERE — read every session
├── .env.local                       ← API keys (gitignored, never commit)
├── .env.example                     ← Template for env vars (commit this)
├── .gitignore
├── index.html
├── package.json
├── tailwind.config.js
├── tsconfig.json
├── tsconfig.node.json
├── vite.config.ts
├── drizzle.config.ts                ← Drizzle ORM config
│
└── src/
    ├── main.tsx                     ← App entry point
    ├── App.tsx                      ← Root component + providers
    ├── router.tsx                   ← All routes defined here
    │
    ├── db/
    │   ├── index.ts                 ← PGlite instance (singleton)
    │   ├── schema.ts                ← Drizzle schema = source of truth
    │   └── seed.ts                  ← Default categories seed data
    │
    ├── stores/
    │   ├── tasks.store.ts           ← Zustand: task state + actions
    │   ├── wallet.store.ts          ← Zustand: wallet state + actions
    │   └── app.store.ts             ← Zustand: global app state (settings, theme)
    │
    ├── hooks/
    │   ├── useTasks.ts              ← Task CRUD + sort order rebalance utility
    │   ├── useWallet.ts             ← Wallet CRUD operations
    │   ├── useClaude.ts             ← Claude API calls + streaming
    │   └── useSettings.ts          ← App settings (API key, currency)
    │
    ├── lib/
    │   ├── claude.ts                ← Anthropic client + prompt builders
    │   ├── claude-prompts.ts        ← All system prompts in one place
    │   ├── csv.ts                   ← CSV parsing + bank format detection + duplicate hash
    │   └── utils.ts                 ← Shared helpers (cn, formatCurrency, etc.)
    │
    ├── modules/
    │   ├── tasks/
    │   │   ├── TasksPage.tsx        ← Route: /tasks
    │   │   ├── BulletTree.tsx       ← Recursive bullet list container
    │   │   ├── BulletNode.tsx       ← Single bullet (with children)
    │   │   ├── BulletEditor.tsx     ← Inline contenteditable editor
    │   │   └── BulletNote.tsx       ← Expandable note field
    │   │
    │   └── wallet/
    │       ├── WalletPage.tsx       ← Route: /wallet (transaction list)
    │       ├── AccountsPage.tsx     ← Route: /wallet/accounts
    │       ├── AccountCard.tsx      ← Single account display
    │       ├── AccountForm.tsx      ← Create/edit account modal
    │       ├── TransactionList.tsx  ← Grouped transaction list
    │       ├── TransactionForm.tsx  ← Create/edit transaction modal
    │       ├── CsvImport.tsx        ← Route: /wallet/import
    │       ├── CsvReviewTable.tsx   ← Review rows before confirming import
    │       └── Dashboard.tsx        ← Route: /wallet/dashboard
    │
    ├── components/
    │   ├── layout/
    │   │   ├── AppShell.tsx         ← Outer layout (sidebar + content)
    │   │   ├── Sidebar.tsx          ← Left navigation
    │   │   └── TopBar.tsx           ← Top bar with breadcrumb + actions
    │   │
    │   ├── ui/                      ← Reusable primitives (build these first)
    │   │   ├── Button.tsx
    │   │   ├── Input.tsx
    │   │   ├── Textarea.tsx
    │   │   ├── Select.tsx
    │   │   ├── Modal.tsx
    │   │   ├── Badge.tsx
    │   │   ├── DatePicker.tsx
    │   │   └── EmptyState.tsx
    │   │
    │   └── claude/
    │       ├── ClaudePanel.tsx      ← Slide-in AI chat panel
    │       ├── DailyBriefing.tsx    ← One-click briefing button + display
    │       └── ApiKeySetup.tsx      ← First-time API key entry screen
    │
    └── types/
        ├── tasks.types.ts           ← Task, BulletNode interfaces
        └── wallet.types.ts          ← Account, Transaction, Category interfaces
```

### Phase 4 backend (`server/`)
```
server/
├── index.ts                         ← Express app + session middleware + createApp() + listen
├── db.ts                            ← DB singleton + file-based migration runner
├── seed.ts                          ← seedUserDefaults(): per-user categories + settings
├── lib.ts                           ← updateRow() (user-scoped) + bind coercion
├── session-store.ts                 ← SQLite-backed express-session Store
├── tsconfig.json                    ← Server typecheck config (run via tsx)
├── migrations/                      ← SQL migration files, applied in lexicographic order
│   └── 0001_initial.sql             ← Baseline schema (all tables for v1)
│   (add 0002_….sql for future changes — never edit shipped files)
├── routes/
│   ├── health.ts                    ← GET /api/health (public)
│   ├── auth.ts                      ← /api/auth/signup|login|logout|me + requireAuth (public)
│   ├── tasks.ts                     ← /api/tasks, /api/task-templates (auth)
│   ├── wallet.ts                    ← /api/accounts, /transactions, /categories,
│   │                                   /budgets, /recurring-transactions, /goals (auth)
│   ├── settings.ts                  ← GET /api/settings, PUT /api/settings/:key (auth)
│   └── test.ts                      ← POST /api/test/reset (only when DAYBOOK_TEST=1)
└── data/                            ← e2e test DB only (gitignored); prod DB is in DAYBOOK_HOME
```
> The browser reaches the server through Vite's `/api` dev proxy → `localhost:3001`.
> The client talks to it via `src/lib/api.ts` (credentials:'include' for the
> session cookie). Reads return snake_case rows (existing client mappers convert
> them); writes accept camelCase. No PGlite in the browser — `npm run dev` needs
> the server too (use `dev:all`). Auth: session cookie + bcrypt; `App.tsx` gates
> the app behind `src/components/auth/AuthPage.tsx`.
> Scripts: `npm run server` (watch), `npm run dev:all` (server + Vite),
> `npm run typecheck:server`.
>
> **DB location in production:** `DAYBOOK_HOME/shared/data/daybook.db` (set via
> `DAYBOOK_HOME` env var). Dev fallback: `server/data/daybook.db`. e2e tests:
> `DAYBOOK_DB_PATH=server/data/e2e.db`.

### Production deployment layout (`~/daybook/` by default)
```
~/daybook/                           ← DAYBOOK_HOME (set DAYBOOK_HOME env var to override)
├── releases/
│   ├── v1.3.0/                      ← immutable extracted artifact (dist/ + server/ + infra/)
│   └── v1.2.0/                      ← previous release kept for instant rollback
├── current -> releases/v1.3.0/      ← symlink; the service always runs from here
├── shared/
│   ├── data/
│   │   └── daybook.db               ← THE database — survives every deploy
│   └── session-secret               ← persistent session signing key
├── backups/
│   └── pre-deploy-1.3.0-20260601/
│       └── daybook.db               ← timestamped snapshot before each deploy
└── logs/
    └── server.log
```
> First-time setup: `infra/daybook install` (creates dirs, deploys latest, installs launchd).
> Deploy new release: `infra/daybook deploy [tag]` — downloads artifact, snaps DB, flips symlink.
> Rollback: `infra/daybook rollback` — re-points symlink to previous release (instant, no download).
> Manual DB snapshot: `infra/daybook backup`.
> The dev repo and DAYBOOK_HOME are completely separate — never deploy by copying the repo.

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
-- 'theme'               → 'light' | 'dark' | 'system'
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

-- Split lines (one row per user per split transaction; includes the payer)
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
- Transaction splits track who owes whom with `share_amount`; settlements create two real transfer transactions
- Non-members never see shared accounts or splits; visibility is scoped per user and group membership
- `settled_at` in `transaction_shares` marks when a share is cleared by a settlement

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
  createdAt: string
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
  tag: string
  importHash: string                     // '' for manual entries; hash for CSV imports
  createdAt: string
  updatedAt: string
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

## 9. Feature Specifications

### 9.1 Tasks Module

#### BulletNode behaviour
- Each task renders as a line with: collapse toggle (▶/▼) | bullet dot | content | options menu
- Clicking the bullet dot zooms in: that task becomes root, breadcrumb shows path back
- Pressing Enter at end of line creates a sibling below
- Pressing Tab indents (makes child of bullet above); Shift+Tab outdents
- Pressing Backspace on empty line deletes it and moves cursor up
- Clicking the content makes it editable inline (contenteditable div, not an input)
- Completed tasks show strikethrough; "hide completed" toggle removes them from view
- Dragging a bullet onto another makes it a child (DnD kit)
- Notes: click the note icon to expand/collapse a textarea below the bullet

#### contenteditable implementation note
React does not manage `contenteditable` cursor position across re-renders. Use a `ref` with `useLayoutEffect` to save and restore the caret position after every state update. Failing to do this causes cursor jumps on every keystroke.

#### Keyboard shortcuts
| Key | Action |
|---|---|
| Enter | New sibling below |
| Tab | Indent (make child) |
| Shift+Tab | Outdent |
| Backspace (empty) | Delete + move up |
| Cmd/Ctrl+Enter | Complete/uncomplete |
| Cmd/Ctrl+. | Collapse/expand |
| Cmd/Ctrl+K | Open Claude panel |

#### Sort order
- Use floating point sort order (1.0, 2.0, 3.0…)
- When inserting between two items, use midpoint: `(a.sortOrder + b.sortOrder) / 2`
- Rebalance when any gap falls below 0.001 — batch-update all affected rows in a single transaction from `useTasks.ts`

#### DnD implementation note
Nested tree DnD (Task → child → grandchild + reorder within level) requires custom collision detection with `@dnd-kit`. Use `useSortable` with a `data` payload that includes `depth` and `parentId`. Plan extra development time for this; it is the most complex part of the tasks module.

---

### 9.2 Wallet Module

#### Accounts
- Create, edit, delete accounts
- Each account shows: name, type badge, currency, current balance (calculated from transactions)
- **Balance formula:**
  - `balance = SUM(income transactions) − SUM(expense transactions)`
  - Transfer transactions do NOT count toward income or expense; they only move money between accounts
- Deleting an account deletes all its transactions (CASCADE)

#### Transactions
- Add transaction: date (default today), merchant, description, amount, type (income/expense/transfer), category, tag
- For **transfer** type: show a second account selector for `destinationAccountId`; hide category field (transfers are not categorised)
- Edit transaction: same form, pre-filled
- Delete transaction: confirm dialog
- List view: grouped by day, shows date header with day total
- Filter bar: date range | type (all/income/expense/transfer) | category | account | tag
- Summary row: total income, total expense, net for selected period (transfers excluded from totals)

#### CSV Import flow
1. User uploads CSV file → PapaParse reads it
2. Auto-detect columns (date, amount, description/merchant)
3. For each row, compute `import_hash = SHA-256(date + '|' + amount + '|' + merchant)`
4. **Duplicate check:** query DB for existing `import_hash` values; mark matching rows as "already imported" and skip them by default
5. Show review table: all rows, each row editable, checkbox to exclude (duplicates pre-unchecked)
6. Claude auto-suggests category for each non-duplicate row based on merchant name (one batch call)
7. User reviews + confirms → batch insert transactions with `import_hash` set
8. Show success summary: X imported, Y skipped (duplicates), Z excluded by user

#### Dashboard
- Date range selector (this month / last month / custom)
- Cash flow bar chart: income vs expense by week (Recharts)
- Spending by category: pie chart (Recharts)
- Spending by account: bar chart (Recharts)
- Top merchants list
- `DailyGroup` totals are computed from a DB `GROUP BY date` query, not in-memory — use this approach at scale

---

### 9.3 Claude AI Layer

#### API setup
- On first launch (or if no key set): show ApiKeySetup component
- User enters their Anthropic API key → stored in `settings` table under key `anthropic_api_key`
- Key is read at runtime from the DB, not from env vars (env var is a fallback for dev convenience only)

#### Model routing (cost optimisation)
```typescript
// Simple tasks → Haiku (cheap, fast)
// Complex reasoning → Sonnet (quality)
type TaskComplexity = 'simple' | 'complex'

const MODEL = {
  simple: 'claude-haiku-4-5-20251001',  // categorisation, parsing, short queries
  complex: 'claude-sonnet-4-6',          // daily briefing, financial insights, chat
}
```

#### Prompt caching
- System prompt + task/wallet context must use `cache_control: { type: "ephemeral" }`
- Cache TTL: 5 minutes (resets on each hit)
- Always put the static system prompt first (gets cached), dynamic context second
- **Do not include timestamps or any volatile data in the cached context block.** Cache hits only occur when the block is byte-for-byte identical between calls.
- Await all PGlite queries before building the prompt — context must be ready before the API call is made

#### System prompt structure (in `claude-prompts.ts`)
```
SYSTEM (cached):
  You are the AI assistant for Daybook, a personal productivity and finance app.
  You have access to the user's tasks and wallet data below.
  Rules: respond concisely, use MYR currency, dates in DD/MM/YYYY format.

USER CONTEXT (cached if unchanged):
  TASKS: [serialised task tree — top 3 levels only]
  WALLET: [last 30 days of transactions + account balances]

USER MESSAGE:
  [the actual user input]
```

#### Claude features
| Feature | Model | Max output tokens |
|---|---|---|
| Natural language task creation | Haiku | 300 |
| Natural language transaction entry | Haiku | 200 |
| CSV batch categorisation | Haiku | 500 |
| Ask about tasks | Sonnet | 600 |
| Ask about finances | Sonnet | 600 |
| Daily briefing | Sonnet | 800 |
| Financial insights | Sonnet | 800 |

#### Natural language → task (expected JSON output)
```json
{
  "tasks": [
    { "content": "Book flight", "parentContent": "Penang Trip", "note": "" },
    { "content": "Book hotel", "parentContent": "Penang Trip", "note": "" }
  ]
}
```

#### Natural language → transaction (expected JSON output)
```json
{
  "date": "2024-01-15",
  "merchant": "Uncle Din's",
  "description": "Nasi lemak breakfast",
  "amount": 9.50,
  "type": "expense",
  "category": "Food & Drink",
  "tag": ""
}
```

---

## 10. Coding Conventions

### Component structure
```tsx
// Always in this order:
// 1. Imports
// 2. Types/interfaces (local to this file)
// 3. Component function
// 4. Subcomponents (if small and only used here)
// 5. Default export

import { useState } from 'react'
import type { Task } from '@/types/tasks.types'

interface BulletNodeProps {
  task: Task
  depth: number
  onUpdate: (id: string, content: string) => void
}

export function BulletNode({ task, depth, onUpdate }: BulletNodeProps) {
  // ...
}
```

### Path aliases (configured in vite.config.ts + tsconfig.json)
```
@/            → src/
@/types/      → src/types/
@/lib/        → src/lib/
@/hooks/      → src/hooks/
@/stores/     → src/stores/
@/modules/    → src/modules/
@/components/ → src/components/
```

### Utility function
```typescript
// Always use this for className merging
import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: Parameters<typeof clsx>) {
  return twMerge(clsx(inputs))
}
```

### Currency formatting
```typescript
// Always use this — never raw toFixed()
export function formatMYR(amount: number): string {
  return new Intl.NumberFormat('ms-MY', {
    style: 'currency',
    currency: 'MYR',
    minimumFractionDigits: 2,
  }).format(amount)
}
```

### Date handling
```typescript
// Store as YYYY-MM-DD strings in DB
// Display using date-fns v3
import { format, parseISO } from 'date-fns'

const display = format(parseISO(transaction.date), 'dd MMM yyyy')
const today = format(new Date(), 'yyyy-MM-dd')
```

### Zustand ↔ PGlite sync pattern
Zustand is the source of truth for UI rendering. PGlite is the source of truth for persistence. Always write to PGlite first, then update the Zustand store on success. Never update the store optimistically without a DB write, as this creates divergence on refresh.

```typescript
// Pattern: DB write first, then store update
async function addTask(content: string) {
  const newTask = await db.insert(tasks).values({ content }).returning()
  useTasksStore.getState().setTasks([...currentTasks, newTask[0]])
}
```

---

## 11. Git Conventions

### The non-negotiable rule
**Never commit directly to `main`.** Every task starts on a branch and ends with a PR.
This applies to everything — a one-line fix, a doc update, a new feature.

### Workflow for every task

```
1. BRANCH   git checkout -b <type>/<short-description>
2. BUILD    make changes, commit incrementally
3. VERIFY   run tsc + affected e2e tests (Haiku agent — see §17)
4. PR       gh pr create … (see template below)
5. MERGE    owner reviews + merges; delete branch
```

### Branch naming
```
feat/wallet-quick-filters        ← new feature
fix/csv-header-toggle-reparse    ← bug fix
chore/update-claude-md           ← docs / config / tooling
refactor/transaction-list-props  ← no behaviour change
test/add-csv-e2e-coverage        ← tests only
```

### Commit format (Conventional Commits)
```
feat(tasks): add bullet collapse toggle
fix(wallet): correct balance calculation for transfers
chore: update CLAUDE.md with Phase 2 status
test(csv): add header-toggle and no-account e2e tests
```
- Subject ≤ 50 chars, imperative mood
- Body only when the *why* isn't obvious from the subject
- Always include `Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>`

### PR template (use `gh pr create`)
```
gh pr create \
  --title "<type>(<scope>): short description" \
  --body "$(cat <<'EOF'
## What
- Bullet summary of changes

## Why
One sentence on the motivation.

## Test plan
- [ ] tsc clean
- [ ] Affected e2e specs pass
- [ ] Manual smoke (if UI change)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

### What to commit
- ✅ All source files
- ✅ `.env.example`
- ✅ `CLAUDE.md`
- ✅ `.agents/skills/` (skill files)
- ❌ `.env.local` (gitignored)
- ❌ `node_modules/`
- ❌ `.DS_Store`
- ❌ `server/data/*.db` (gitignored)

---

## 12. Accounts & Services Checklist

### Needed before Phase 1 (coding starts)

- [x] Anthropic account created + payment method added + $10 spend limit set
      → Only used in Phase 5 (AI features). Account is confirmed active.
- [x] Git installed (v2.50.0 confirmed)
- [x] Claude Code CLI installed — confirmed active
      → Cannot install itself; must exist before any Claude Code session can run
- [x] GitHub account + private repo `daybook` created (github.com/moascode/daybook confirmed)
- [x] Repo cloned to local machine — confirmed (current working directory)
- [x] Node.js 20+ installed — confirmed by user
      → Required to run `npm create vite`, install packages, and start the dev server.

### Needed later (do not set up early)

- [ ] Anthropic API key: copy from console.anthropic.com → enter in the app on first launch — **Phase 5 only**
      → You already have the account. Just copy the key when you reach Phase 5.
- [ ] Vercel account: https://vercel.com → sign up with GitHub — **Phase 6 only**
- [ ] Supabase account: https://supabase.com → sign up with GitHub — **Phase 6 only**

---

## 13. Project Status

**Update this section at the end of every Claude Code session.**

```
Current phase:  5b — Household Sharing & Multi-User (v1.0) — COMPLETE
Phase status:   Phase 4 (home network backend) shipped v1.0.
                Phase 5b (household sharing) shipped v1.0.1.
                Phase 5c (wallet UX improvements) — IN PROGRESS (backlog not started).
                See docs/phase-5c-wallet-ux.md.
                Phase 5b extension: transaction quick-share (PR #27) adds a
                one-click single-recipient share alongside the existing split
                flow. Separate from the Phase 5c UX backlog below.
Last session:   2026-06-03
Last completed: - Phase 5b fully implemented and merged (PR #18 + follow-ups):
                    • Household groups: users can create groups and invite members
                      by username with optional role assignment.
                    • Shared accounts: accounts visible to group members with
                      optional write access per group (read-only by default).
                    • Transaction splits: divide expenses across group members with
                      automatic share tracking, proportional rescaling on amount edits,
                      and optional notes per share.
                    • Settlements: create real ledger transfers to settle balances
                      between two users, with undo capability via settlement history.
                    • Data isolation: non-members cannot see shared accounts or splits;
                      members have visibility scoped to their group memberships only.
                    • Wave 1 & 2 fixes: accessibility improvements, UI consistency,
                      corner cases (over-settlement, balance precision, etc.).
                    • e2e: 30 Playwright test files covering all sharing features
                      (households, shared accounts, splits, settlements); all pass.
                    • Migrations: 0003_sharing.sql + 0004_settlement_share_lines.sql
                      applied; schema_migrations table tracks applied files.
                    • Verified: client build green, typecheck:server green, 30/30 e2e pass.

Phase 4 summary: - Node.js backend (Express) + SQLite file on home hardware
                  - Session-based multi-user auth (bcrypt + express-session)
                  - Per-user data isolation (all queries scoped by user_id)
                  - REST API for all entities (tasks, accounts, transactions, settings, etc.)
                  - Capistrano-style releases with versioned artifacts + rollback
                  - File-based migrations (additive only, applied in order)
                  - 22 merged PRs from initial Phase 4 scaffold to Phase 5b completion
Next task:      Phase 5c — Wallet UX & Feature Improvements (backlog):
                - B1: Free-text search on transactions (merchant/description)
                - B2: "Save & add another" on transaction form
                - B3: Mobile-safe modal scrolling (max-height + scroll)
                - B4: Keyboard/screen-reader accessible rows & cards
                - B5: Zero-account onboarding path ("Create account" CTA)
                - B6: Always-visible account card actions (not hover-only)
                - B7: Dashboard/Reports charts reflow on mobile
                - B8: Label unification (Total Balance vs Total Net Worth)
                - B9: Colour consistency (positive money green)
                - B10: Surface Type & Category on recurring rule cards
                - B11: Touch targets ≥ 40px (sidebar, row buttons)
                - B12: Opening-balance caption clarity (editing case)
                See docs/phase-5c-wallet-ux.md for full scope, effort, acceptance criteria.

Blockers:       None. Phase 4 stable. Phase 5b stable. Phase 5c is scoped and ready.

Notes:          - Session secret persists at DAYBOOK_HOME/shared/session-secret.
                - Releases versioned via infra/daybook deploy [tag].
                - DB migrations are additive-only; applied in lexicographic order.
                - e2e tests use fresh DB per context; CI shards tests across jobs.
                - Pre-existing lint: 38 warnings (react-hooks, test-only shims).
```

---

## 14. Phase Definitions & Delivery Milestones

The roadmap is structured around real deliverables, not arbitrary versions. Each delivery milestone is a usable, stable product — not a work-in-progress.

```
Phase 0  →  Phase 1  →  Phase 2  →  Phase 3
                                        ↓
                                   ★ ALPHA
                                   Core app on your machine

Phase 4  →  ★ v1.0  Home network, multi-user
Phase 5  →  Phase 5b (5c subtask)
             ★ v1.0+ Household sharing, wallet UX polish
Phase 6  →  ★ v2    Cloud-hosted, anywhere access
Phase 7  →  ★ v3+   Advanced features, ongoing
```

### Phases

| Phase | Name | Type | Goal | Status |
|---|---|---|---|---|
| 0 | Foundation Setup | **Your actions** | Accounts, tools, repo cloned | ✅ Done |
| 1 | Core Scaffold | Dev | Vite + layout shell + UI primitives | ✅ v1.0 |
| 2 | Tasks Module | Dev | Full Workflowy-style bullet tree | ✅ v1.0 |
| 3 | Wallet Module | Dev | Accounts + transactions + CSV + dashboard | ✅ v1.0 |
| 4 | Home Network + Multi-User | Architecture | Node backend, SQLite file, auth, per-user data | ✅ v1.0 |
| 5a | AI Features | AI | Claude integration, NL input, briefing, insights | 🔄 Deferred |
| 5b | Household Sharing | Feature | Groups, shared accounts, transaction splits, settlement | ✅ v1.0.1 |
| 5c | Wallet UX Improvements | UX/Features | Free-text search, accessibility, mobile fixes, polish | 🔄 In Progress |
| 6 | Cloud Migration | Cloud | Supabase + Vercel + RLS + Edge Function for AI key | Planned |
| 7 | Advanced Features | v2+ | Recurring rules, budgets, goals, new modules | Planned |

**Note**: Phase 5 has been split into three subtasks:
- **Phase 5a (AI)** is deferred — requires API key proxying + model routing
- **Phase 5b (Sharing)** shipped v1.0.1 — household groups, shared accounts, splits, settlements
- **Phase 5c (Wallet UX)** in progress — backlog of UX/feature improvements

### Delivery Milestones

| Milestone | After phase | What it means |
|---|---|---|
| **Alpha** | 3 | Core app fully working on your machine. Single user. Data in browser IndexedDB. |
| **v1.0** | 4 | Multi-user on home network. Any device on your WiFi can log in. Data on your hardware. |
| **v1.0.1** | 5b | Household sharing added. Family members can share accounts and settle expenses. |
| **v2** | 5a+6 | AI-powered + cloud-hosted. Accessible from anywhere. Natural language input. Supabase auth + RLS. |
| **v3+** | 7+ | Power features — ship whatever matters most, one at a time. |

> **Tracker:** Open `tracker.html` in a browser to see the interactive task-level breakdown with progress tracking.

---

## 15. Known Decisions & Rationale

| Decision | Choice | Why |
|---|---|---|
| App name | Daybook | Historical accounting term for a daily record — captures both tasks (what to do today) and finances (what you spent today) in one word |
| Local DB | PGlite (SQLite) | Works offline, no server, schema maps 1:1 to Postgres for Phase 4 migration |
| State manager | Zustand | Lighter than Redux, simpler than Jotai for this complexity level |
| DnD | @dnd-kit | Most accessible, supports nested trees, actively maintained |
| Charts | Recharts | React-native, sufficient for cash flow + pie, no D3 complexity |
| AI model routing | Haiku + Sonnet | Haiku for parsing/categorisation, Sonnet for reasoning. ~60% cost saving |
| Domain | vercel.app subdomain | Free forever, no action needed, sufficient for personal use |
| Auth (Phase 4) | Supabase Auth | Built-in, row-level security, free tier covers personal use |
| Transfer schema | `destination_account_id` on transactions | Transfers have two legs; without this column balances are incorrect |
| CSV dedup | `import_hash` column | SHA-256 of date+amount+merchant prevents double-importing the same CSV |
| Data export | Phase 5 feature | Browser storage can be cleared accidentally; JSON/CSV export is the safety net before cloud sync exists |
| Anthropic SDK version | ^0.39 | Streaming API signatures changed significantly from 0.24; use current version |
| Sonnet model ID | `claude-sonnet-4-6` | Correct current model ID — `claude-sonnet-4-20250514` does not exist and will return 404 |
| Phase 4 architecture | Local Node.js backend + SQLite file | Home network multi-user requires a real server — PGlite is per-browser only. SQLite file keeps it simple before committing to Postgres |
| AI key in Phase 4 | Proxied through local backend | Backend is already running for auth; routing AI calls through it costs nothing extra and removes browser key exposure |
| Cloud (Phase 6) ordering | After AI (Phase 5) | Moving to Supabase while still adding features creates churn. Better to stabilise features on the home server first, then migrate once |

---

## 16. E2E Testing Conventions

### Rule (from Section 2, Rule 11)
Every new feature or behaviour change **must** have a Playwright test. Run `npx playwright test` before marking any feature complete.

### File naming
```
e2e/
  01-tasks.spec.ts          ← Tasks module tests
  02-wallet-accounts.spec.ts
  03-wallet-transactions.spec.ts
  04-wallet-csv.spec.ts
  05-wallet-dashboard.spec.ts
  06-uat-runner.spec.ts      ← Full UAT smoke test
  NN-description.spec.ts     ← New specs follow this pattern (two-digit prefix)
  helpers.ts                 ← Shared test utilities (newAppPage, etc.)
  fixtures/                  ← Test CSV files and other test data
```

### Conventions
- Each spec file gets an isolated browser context (fresh IndexedDB) via `newAppPage()`.
- Use `test.describe.configure({ mode: 'serial' })` when tests build state sequentially.
- Prefer assertions on visible UI text (`getByText`, `getByRole`) over CSS selectors.
- For async DB operations, `await page.waitForTimeout(500)` is acceptable only when no reliable DOM signal exists; prefer `waitForSelector` or `waitForResponse`.
- Do not skip (`test.skip`) a failing test to make CI green — fix it or file it as a known issue with a comment explaining why.

### When to add tests
| Scenario | Action |
|---|---|
| New page or route | New spec file `NN-feature.spec.ts` |
| New form or user interaction | New `test()` block in the relevant spec |
| Bug fix | Add a regression test that would have caught the bug |
| Refactor (no behaviour change) | Run existing suite; no new tests needed unless coverage gaps are found |

### Running tests
```bash
npx playwright test              # Full suite (headless)
npx playwright test e2e/01-tasks # Single file
npx playwright test --headed     # Watch mode (headed)

### Development Workflow

**Default behavior:** Branch → Plan (for non-trivial changes) → Implement → Test → PR → Wait for merge.

**Full 12-step workflow** (branch → plan → implement → test → review → PR → CI → merge): Available on-demand via `/use dev-workflow` skill. Use this for significant changes where you want the complete process enforced.

**Small tasks** (typos, one-line fixes): Skip the full workflow. Still branch first, still test, still PR.

---
npx playwright show-report       # View last HTML report
```

---

## 17. Model Routing for Claude Code Operations

**These rules apply every session. Consult them before every Agent spawn and before every inline action.**

The goal: use the cheapest model capable of the task. Haiku for mechanical work, Sonnet for judgment work.

### Routing quick-reference

| Task | Model | Location |
|------|-------|----------|
| Run tests / parse failures | **haiku** | Agent |
| TypeScript typecheck (`tsc --noEmit`) | **haiku** | Agent |
| Build check (`npm run build`) | **haiku** | Agent |
| Git: status, diff, log, add, commit, push | **haiku** | Agent |
| Read a known file / grep a known symbol | — | Inline Bash/Read |
| Explore unknown code region | **haiku** | Agent (Explore) |
| Small ≤2-file bug fix, cause already clear | — | Inline Edit |
| New feature, 3–6 files | **sonnet** | Main thread, medium effort |
| Architecture / planning pass | **sonnet** | Main thread, high effort |
| Cross-cutting refactor, 6+ files | **sonnet** | Agent |
| Security / adversarial review | **sonnet** | Agent, high effort |
| Final verification after any delivery | **haiku** | Agent (always) |

### Mandatory four-phase workflow for every task

```
BRANCH → Haiku agent  — git checkout -b <type>/<desc>  ← NEVER skip, even for tiny fixes
PLAN   → Sonnet (main thread) — read files, design solution, identify all changes needed
BUILD  → Sonnet (main thread) — implement; spawn Haiku agents for mechanical sub-tasks
VERIFY → Haiku agent  — tsc + affected e2e spec; report pass/fail; loop back to BUILD if failures
PR     → Haiku agent  — gh pr create; return PR URL   ← work is not done until PR exists
```

### Hard rules

1. **Never work on main** — always branch first.
2. **Never run tests inline** — always `Agent({ model: "haiku", ... })`.
3. **Never do git inline** — always `Agent({ model: "haiku", ... })`.
4. **Every session must end with a Haiku verification agent + PR** before reporting work done.
5. **Haiku prompts must be tight** — exact commands + exact file paths. Haiku doesn't explore.
6. **Independent verifications run in parallel** — spawn typecheck + e2e in one message.

See `.agents/skills/smart-delegate/SKILL.md` for full routing table, cost intuition, and spawn templates.
