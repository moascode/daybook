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

### Branch strategy (simple — solo developer)
- `main` — always working, always deployable
- `feature/phase-1-scaffold` — current work
- Merge to main when phase is complete and tested

### Commit format
```
feat(tasks): add bullet collapse toggle
fix(wallet): correct balance calculation for transfers
chore: update CLAUDE.md with Phase 2 status
```

### What to commit
- ✅ All source files
- ✅ `.env.example`
- ✅ `CLAUDE.md`
- ❌ `.env.local` (gitignored)
- ❌ `node_modules/`
- ❌ `.DS_Store`

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
Current phase:  4 — Home Network + Multi-User (v1) — COMPLETE (pending review/merge)
Phase status:   PR1 (scaffold) + PR2 (data-layer migration) + PR3 (auth +
                per-user) all done on branch. v1 milestone reached.
                See docs/phase-4-plan.md.
Last session:   2026-05-31
Last completed: - Release management + CI/CD (branch
                  claude/release-management-cicd-dMkPq). See docs/ci-cd.md.
                    • CI: .github/workflows/ci.yml — typecheck (client+server),
                      lint, build, full Playwright e2e on every PR/push to main;
                      uploads the HTML report; cancels superseded runs. Replaced
                      the standalone playwright.yml (folded in).
                    • Release: .github/workflows/release.yml — on a vX.Y.Z tag,
                      builds + e2e-gates, packages a versioned artifact, and
                      publishes a GitHub Release (tarball + .sha256, auto notes).
                    • scripts/package-release.sh: assembles a self-contained
                      artifact (built dist/ + server TS + manifests + infra tool +
                      VERSION manifest); excludes server/data; emits sha256.
                      Verified locally end-to-end (build → tar → checksum OK).
                    • Deploy tool: new `deploy [tag]` + `rollback` commands in
                      infra/daybook — pulls the release artifact from the GitHub
                      API (anonymous; optional GITHUB_TOKEN), verifies checksum, backs up
                      (.daybook/backups, keeps 5), swaps dist/+server/, npm ci
                      (rebuilds native modules), restarts the launchd service.
                      Refactored cmd_reload to share restart_service().
                    • Docs: docs/ci-cd.md (CI, versioning, cutting a release,
                      artifact layout, deploy/rollback, secrets, troubleshooting).
                    • .gitignore: dist-release/. bash -n clean on both scripts.
                - Phase 4 full adversarial review (4 agents) round 2 — fixes:
                    • CsvImport: wrap importTransactions in try/catch/finally +
                      error toast (was a stuck spinner + unhandled rejection on
                      atomic-import failure). api.ts: 401 on a non-/auth request
                      now re-gates to login (App registers the handler) — graceful
                      session-expiry instead of silent failure.
                    • auth.ts establishSession: surface regenerate/save errors as
                      500 (was a "logged in" response with no usable session).
                    • db.ts: schema-version guard via SQLite user_version (rebuilds
                      data tables on any DDL change pre-v1) — replaces the
                      column-sniff; covers the budgets-uniqueness change too.
                    • session-store: corrupt sess JSON → treat as no session (drop
                      it) instead of 500-ing every request for that sid.
                    • useTasks.addTask: null-guard the POST response.
                    • dev:all kills the API server on exit (trap); 22-auth uses a
                      monotonic username counter (no random collision).
                    • New e2e: session-survives-reload; isolation test extended to
                      transactions + asserts B has its own 15 seeded categories.
                    • Verified: build green, typecheck:server green, 272/272 e2e
                      pass, lint 38 pre-existing (no new). Correctness review
                      confirmed data-layer parity (booleans/nullables/timestamps/
                      balance/filters/sort/restore/settings all clean).
                - Phase 4 review hardening (adversarial security review + fixes):
                    • IDOR-write fix: inserts/PATCH now verify referenced
                      accountId/destinationAccountId/categoryId belong to the
                      caller (server/lib.ts ownsAllRefs) across transactions,
                      import, budgets, recurring, goals → 400 on cross-user refs.
                      Closes a cross-tenant cascade-delete vector.
                    • budgets UNIQUE(category_id) → UNIQUE(user_id, category_id).
                    • check-duplicates batched (500/query) — param-limit safe.
                    • Auth: usernames case-insensitive (lowercased), password
                      length bounds (6–72), session.regenerate() on login/signup
                      (anti-fixation), startup throws if prod & no SESSION_SECRET.
                    • New e2e: 22-auth "two users have fully isolated data" drives
                      the UI to prove user B sees none of user A's accounts/tasks.
                    • Verified: build green, typecheck:server green, 271/271 e2e
                      pass, lint 38 pre-existing (no new).
                - Phase 4 PR3 — auth + per-user data (v1 milestone):
                    • Schema: users + sessions tables; user_id NOT NULL FK on all
                      8 data tables; settings PK now (user_id, key). Startup guard
                      drops+recreates pre-auth data tables (pre-v1, no real data).
                    • Auth (session cookies): server/routes/auth.ts —
                      signup/login/logout/me + requireAuth guard. bcrypt hashes.
                      express-session with a SQLite-backed store (server/
                      session-store.ts) — no extra session-store package.
                    • Every server query scoped by user_id (updateRow takes userId;
                      all GET/POST/PATCH/DELETE filter/set user_id). Verified one
                      user cannot read/write another's rows.
                    • Per-user seeding: seedUserDefaults() seeds 15 categories +
                      default settings on signup.
                    • Client: app.store gains user/setUser; App.tsx checks
                      /auth/me on boot and gates the app behind AuthPage
                      (src/components/auth/AuthPage.tsx, login/signup). Sign-out
                      added to Settings. api.ts already sent credentials.
                    • Packages added: bcrypt ^6, express-session ^1 (+ @types) —
                      already approved in CLAUDE.md §4.
                    • e2e: newAppPage signs up a fresh user per page (per-user
                      isolation = old fresh-DB-per-context); signUpOnPage helper
                      for custom-context specs (mobile). New e2e/22-auth.spec.ts
                      (signup/login/logout/gate/wrong-password).
                    • Verified: client build green, typecheck:server green,
                      270/270 e2e pass. Lint: 38 pre-existing errors only (no new).
                - Phase 4 PR2 — data-layer migration (full REST swap, PGlite removed):
                    • REST endpoints for every entity: server/routes/tasks.ts
                      (tasks + templates), wallet.ts (accounts incl. balance,
                      transactions incl. filters/import/export/check-duplicates,
                      categories, budgets, recurring, goals), settings.ts.
                    • server/lib.ts: updateRow() dynamic-UPDATE helper.
                    • src/lib/api.ts: typed fetch client (credentials:'include'
                      ready for PR3 cookies). Reads = snake_case rows (client
                      mappers unchanged); writes = camelCase.
                    • Rewrote useTasks + useWallet to call the API (store-update
                      logic + tree/sort/balance helpers unchanged). Migrated
                      csv.ts checkDuplicates, App.tsx boot, SettingsPage, and the
                      /uat page's direct-DB checks to the API.
                    • Removed in-browser PGlite: deleted src/db/, uninstalled
                      @electric-sql/pglite + unused drizzle-orm/drizzle-kit.
                    • e2e: test-only POST /api/test/reset (DAYBOOK_TEST=1);
                      newAppPage resets the server DB per page = old fresh-state-
                      per-context. Playwright now boots both servers (API on a
                      throwaway server/data/e2e.db). Fixed a latent config bug —
                      executablePath must live under launchOptions, not use.
                    • Fixed fragile 05-dashboard locator (getByText('Dashboard')
                      matched the "Dashboard Bank" chart label once charts render).
                    • Verified: client build green, typecheck:server green,
                      266/266 e2e pass. Lint: 38 pre-existing errors only (no new).
                - Phase 4 PR1 — Node + SQLite server scaffold:
                    • server/ : Express app (createApp + listen), better-sqlite3
                      instance with SQLite-native schema (all 9 data tables),
                      seed.ts (mirrors src/db/seed.ts), GET /api/health
                    • Vite dev-proxies /api → localhost:3001
                    • Scripts: server (watch), dev:all, typecheck:server
                    • SQLite DB file under server/data/ (gitignored)
                    • Packages added (CLAUDE.md §4 updated): express ^5,
                      better-sqlite3 ^12, tsx ^4 (+ @types). bcrypt/express-session
                      deferred to PR3 (auth). Fixed §4 Cloud label (Supabase = Phase 6).
                    • Verified: better-sqlite3 native build OK, health returns
                      {status:ok,db:true}, 15 categories + 3 settings seeded,
                      client `npm run build` still green, eslint clean on server/.
                - Decisions (owner sign-off): full REST swap (drop PGlite),
                  Express + better-sqlite3, session-cookie auth, staged delivery.
                - Earlier (2026-05-28) — Phase 3+ Tier 3 features shipped (e2e 16–21):
                    • Wallet goals (/wallet/goals): savings target linked to an account,
                      progress bar vs live account balance, full CRUD
                    • Bill reminders on Dashboard: recurring bills due within 7 days,
                      "due soon"/days-left badge, dismissible (persists via localStorage)
                    • Advanced reports (/wallet/reports): year-on-year comparison chart
                      (recharts) + fully custom date-range transaction view
                    • Task templates: "Save as template" in BulletNode menu, "Templates"
                      browser dialog to apply/delete; persisted in task_templates table
                    • PWA: public/manifest.json + public/sw.js, manifest/theme-color/
                      apple meta tags in index.html, SW registration in main.tsx
                    • Mobile-responsive layout: hamburger drawer Sidebar + mobile top bar
                      in AppShell; no horizontal overflow at 390px
                - Schema additions: `goals`, `task_templates`
                - New components: GoalsPage, ReportsPage; Goals/Reports tabs in WalletTabNav
                - useWallet goal CRUD + useTasks template CRUD; wallet.store goals state
                - Fixed e2e/16 strict-mode locator (saved-amount + percent both matched);
                  helpers.waitForApp now checks <main> (aside is hidden on mobile)
                - Full suite green: 266 Playwright tests pass (213 prior + 53 Tier 3)
Last completed  - Stable deployment architecture (2026-05-31):
(continued):        • infra/daybook fully rewritten: Capistrano-style releases at
                      DAYBOOK_HOME (default ~/daybook). Deploy downloads artifact
                      from GitHub, installs under releases/vX.Y.Z/, flips current
                      symlink atomically, backs up DB, restarts service.
                    • Rollback is instant symlink flip to previous release — no
                      re-download. DB is never auto-rolled back (keeps user data).
                    • `infra/daybook install` — one command first-time setup:
                      creates DAYBOOK_HOME structure, deploys latest, installs
                      launchd service.
                    • `infra/daybook backup` — manual DB snapshot to backups/.
                    • server/db.ts: replaced monolithic schema + drop+recreate
                      guard with a file-based migration runner. Reads
                      server/migrations/*.sql in lexicographic order, applies
                      pending ones inside a transaction, records each in
                      schema_migrations. Safe for post-v1 real data.
                    • server/migrations/0001_initial.sql — baseline v1 schema.
                      Future schema changes: add 0002_*.sql etc. (additive only).
                    • DB path: DAYBOOK_HOME env var → shared/data/daybook.db.
                      Dev fallback: server/data/daybook.db. e2e: DAYBOOK_DB_PATH.
                    • scripts/package-release.sh: now includes infra/port-forward.js
                      and server/migrations/ in the artifact.
                    • Verified: typecheck:server green, client build green.
Next task:      Phase 5 — AI Features (v2): Claude integration, NL task/transaction
                entry, daily briefing, financial insights. Route the Anthropic key
                through the backend (no key in the browser bundle). See §9.3.
Blockers:       None. Deployment is now stable: versioned releases, DB safe from
                deploys, file-based migrations for future schema changes.
                Reminder: SESSION_SECRET is read from DAYBOOK_HOME/shared/session-secret
                (generated on first install); no manual env var needed in production.
                Note: pre-existing eslint warnings (react-hooks/set-state-in-effect,
                test-only `window as any` shims) remain; not introduced this session.
```

---

## 14. Phase Definitions & Delivery Milestones

The roadmap is structured around real deliverables, not arbitrary versions. Each delivery milestone is a usable, stable product — not a work-in-progress.

```
Phase 0  →  Phase 1  →  Phase 2  →  Phase 3
                                        ↓
                                   ★ ALPHA
                                   Core app on your machine

Phase 4  →  ★ v1  Home network, multi-user
Phase 5  →  ★ v2  AI-powered Daybook
Phase 6  →  ★ v3  Cloud-hosted, anywhere access
Phase 7  →  ★ v4+ Advanced features, ongoing
```

### Phases

| Phase | Name | Type | Goal | Est. time |
|---|---|---|---|---|
| 0 | Foundation Setup | **Your actions** | Accounts, tools, repo cloned | 1–2 days |
| 1 | Core Scaffold | Dev | Vite + PGlite + layout shell + UI primitives | 1 week |
| 2 | Tasks Module | Dev | Full Workflowy-style bullet tree | 2 weeks |
| 3 | Wallet Module | Dev | Accounts + transactions + CSV + dashboard | 2 weeks |
| 4 | Home Network + Multi-User | Architecture | Node backend, SQLite file, auth, per-user data | 1.5 weeks |
| 5 | AI Features | AI | Claude integration, NL input, briefing, insights | 1.5 weeks |
| 6 | Cloud Migration | Cloud | Supabase + Vercel + RLS + Edge Function for AI key | 1 week |
| 7 | Advanced Features | v4+ | Budgets, goals, PWA, new modules — pick and choose | Ongoing |

### Delivery Milestones

| Milestone | After phase | What it means |
|---|---|---|
| **Alpha** | 3 | Core app fully working on your machine. Single user. Data in browser IndexedDB. |
| **v1** | 4 | Multi-user on home network. Any device on your WiFi can log in. Data on your hardware. |
| **v2** | 5 | AI-powered. Natural language input. Daily briefings. Financial insights. |
| **v3** | 6 | Cloud-hosted. Accessible from anywhere. Supabase auth + RLS. |
| **v4+** | 7 | Power features — ship whatever matters most, one at a time. |

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
npx playwright show-report       # View last HTML report
```
