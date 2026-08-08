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
| **Live URL** | <https://daybook.moascode.workers.dev> (free `workers.dev`, no paid domain) |

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
13. **Never fail silently.** Every failed operation must say something the user
    can act on — a toast, an inline message, an error state. This applies to
    *every* feature, not just the obviously critical ones, and it explicitly
    overrides the tempting "degrade quietly so nothing breaks" pattern.
    Degrading the feature is right; degrading it invisibly is not, because a
    broken service and a service with nothing to return render identically and
    the user is given no reason to retry. A `catch {}` that returns `[]`, `null`
    or a no-op is a bug unless the caller surfaces the failure. If a helper must
    stay total, it returns the failure as *data* the caller reports (see
    `suggestCategoriesAI`'s `failedMerchants`) — it does not swallow it.
    Applies to buttons above all: a click that changes nothing on screen and
    explains nothing is the single worst outcome any handler can produce.

---

## 3. Architecture Overview

> **CURRENT (as shipped, v1.0+).** Phase 4 landed as a **local Node + SQLite
> backend on home hardware**, not Supabase (Supabase/Vercel remain the *Phase 6*
> cloud plan). The browser no longer stores data; it calls the server over `/api`.

```
Browser (React 18 + Vite)                    Home-network server (Node + Express)
├── React Router (client routes)      ──►    ├── /api/* REST routes (routes/*.ts)
├── Zustand stores (in-memory UI state)      ├── express-session + bcrypt auth
└── src/lib/api.ts (fetch, cookie)    ◄──    └── better-sqlite3 → daybook.db
                                                 (file-based migrations, per-user rows)
```

- **Persistence:** one SQLite file owned by the server (`DAYBOOK_HOME/shared/data/daybook.db`).
- **Auth:** session cookie + bcrypt; every query scoped by `user_id`.
- **AI:** not wired up yet — see §9.3 (Phase 5a, deferred). No Anthropic calls happen today.

<details><summary>Original Phase 0–3 plan (historical — superseded)</summary>

```
Browser (React + Vite)
├── SQLite (PGlite — runs in-browser, persists in IndexedDB)   ← removed in Phase 4
├── Zustand stores (in-memory state)
├── Anthropic API (called from browser during local phase)     ← never shipped (5a deferred)
│
└── [Phase 4 additions — actually built as local Node+SQLite, NOT Supabase]
    ├── Supabase Postgres (replaces SQLite for cloud sync)      ← Phase 6, not done
    ├── Supabase Auth (email/password)                          ← Phase 6, not done
    └── Vercel Edge Function (proxies Anthropic API key)        ← Phase 6, not done
```

The original **local-first principle** (Phases 1–3: PGlite in IndexedDB, fully
offline, browser-side Claude calls) applied before Phase 4. It has been replaced
by the home-network server above. IndexedDB storage-quota concerns no longer
apply. When the app reaches public cloud hosting (Phase 6), the browser-exposed
`VITE_` API-key security note still stands: the key must move behind a server-side
function before any public deploy.
</details>

---

## 4. Approved Tech Stack

### ONLY use packages from this list. No substitutions without user approval.

#### Core
| Package | Version | Purpose |
|---|---|---|
| `react` | ^18.3 | UI framework |
| `react-dom` | ^18.3 | DOM rendering |
| `typescript` | ~6.0 | Type safety (bumped from ^5.4 during Phase 4/5; `@types/react`/`@types/react-dom` track v19 even though the React runtime stays on 18.3) |
| `vite` | ^8.0 | Build tool + dev server (bumped from ^5.2 during Phase 4/5) |

> **Version note:** the pins above reflect what is actually installed
> (`package.json` is the source of truth). Toolchain versions have advanced past
> the original Phase-1 pins — keep this table and `package.json` in sync when
> upgrading, and still ask before adding any *new* package not listed here.

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
| `@tanstack/react-query` | ^5.40 | Async state — **not installed.** Was planned for Phase 4; the client instead talks to the server through `src/lib/api.ts`. Do not add without approval. |

#### Database — ⚠️ SUPERSEDED (was: Phase 1–3 in-browser store)
> **Phase 4 replaced the in-browser database with the Node + SQLite backend.**
> `@electric-sql/pglite`, `drizzle-orm`, and `drizzle-kit` are **no longer
> installed** and there is no `src/db/` in the browser. The server owns the
> database file (`better-sqlite3`) and applies plain-SQL migrations from
> `server/migrations/`. The rows below are kept only as historical record of the
> pre-v1 local-first architecture — do not reintroduce these packages.

| Package | Version | Status |
|---|---|---|
| `@electric-sql/pglite` | ^0.2 | Removed in Phase 4 (was: SQLite in browser) |
| `drizzle-orm` | ^0.31 | Removed in Phase 4 (was: type-safe query builder) |
| `drizzle-kit` | ^0.22 | Removed in Phase 4 (was: schema migrations) |

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
| `@anthropic-ai/sdk` | — | **REMOVED (PR #112).** Never imported in three years of the project. Do not add it back. |

> **Call Claude with plain `fetch`, not the SDK.** The only Claude call in the
> app runs *in the Worker* (`worker/lib/anthropic.ts`), and the SDK targets Node
> — it has never been proven to bundle for the Workers runtime, and pulling it
> in to find out costs 24 transitive packages. The API is one POST to
> `https://api.anthropic.com/v1/messages` with `x-api-key` and
> `anthropic-version` headers. If a future feature genuinely needs streaming or
> tool use, re-evaluate then; until then the dependency was dead weight and a
> trap for whoever assumed it was the sanctioned path.

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

#### Backend (Phase 6 — Cloudflare Workers + D1) — **in progress**
| Package | Version | Purpose |
|---|---|---|
| `hono` | ^4.12 | Workers-native router; replaces `express` in the Worker |
| `wrangler` | ^4.114 | Cloudflare CLI — build, local dev, D1 migrations, deploy (dev) |
| `@cloudflare/workers-types` | ^5 | Workers runtime type definitions (dev) |

> Approved per `docs/option-2-workers-d1-plan.md` §7 and installed in Phase 1.
> **Both backends coexist during the migration** — `server/` (Express + SQLite)
> keeps serving production untouched until Phase 7's cutover, and `worker/` is
> built alongside it. Nothing is removed before Phase 7.
>
> No new dependency for password hashing: PBKDF2 comes from the Workers runtime's
> Web Crypto. Phase 7 removes `express`, `express-session`, `better-sqlite3`,
> `bcrypt`, `tsx` and their `@types/*`.
>
> **`compatibility_date` in `wrangler.toml` must not exceed the bundled
> `workerd` version's date** (check `node_modules/workerd/package.json`) — a
> future date is a hard `wrangler dev` startup failure, not a warning.

#### Cloud (Phase 6 only — do not install before Phase 6)
> ⛔ **Superseded.** Phase 6 is being built on Cloudflare Workers + D1 (the table
> above), not Supabase + Vercel. See `docs/phase-6-online-plan.md` for the options
> analysis. Do not install these.

| Package | Version | Purpose |
|---|---|---|
| `@supabase/supabase-js` | ^2.43 | Supabase client |
| `@supabase/auth-ui-react` | ^0.4 | Auth UI components |

---

## 5. Folder Structure

> **Heads-up:** this tree is the *original* Phase-1 layout and is now partly
> historical. Lines tagged **⛔ removed** no longer exist (replaced by the Phase 4
> server) and lines tagged **🔮 not built** are deferred Phase 5a (AI) files that
> were never created. The app has since grown many more real files not shown here
> (e.g. `modules/wallet/{BudgetsPage,GoalsPage,RecurringPage,ReportsPage,SharedPage,
> SplitDialog,SettleUpDialog,…}`, `modules/settings/*`, `components/auth/AuthPage.tsx`,
> `stores/household.store.ts`, `lib/api.ts`). Treat `src/` on disk as the real map.

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
├── drizzle.config.ts                ← ⛔ removed (Drizzle gone since Phase 4)
│
└── src/
    ├── main.tsx                     ← App entry point
    ├── App.tsx                      ← Root component + providers (auth gate)
    ├── router.tsx                   ← All routes defined here
    │
    ├── db/                          ← ⛔ removed — server owns the DB (server/db.ts)
    │   ├── index.ts                 ← ⛔ was: PGlite instance (singleton)
    │   ├── schema.ts                ← ⛔ was: Drizzle schema
    │   └── seed.ts                  ← ⛔ was: default categories seed (now server/seed.ts)
    │
    ├── stores/
    │   ├── tasks.store.ts           ← Zustand: task state + actions
    │   ├── wallet.store.ts          ← Zustand: wallet state + actions
    │   ├── household.store.ts       ← Zustand: groups + pending invites
    │   ├── toast.store.ts           ← Zustand: undo/error toasts
    │   └── app.store.ts             ← Zustand: global app state (auth user, settings, theme)
    │
    ├── hooks/
    │   ├── useTasks.ts              ← Task CRUD + sort order rebalance utility
    │   ├── useWallet.ts             ← Wallet CRUD operations
    │   ├── useClaude.ts             ← 🔮 not built (Phase 5a AI — deferred)
    │   └── useSettings.ts          ← App settings (currency, theme)
    │
    ├── lib/
    │   ├── api.ts                   ← fetch wrapper for /api (session cookie, {error} parsing)
    │   ├── claude.ts                ← 🔮 not built (Phase 5a AI — deferred)
    │   ├── claude-prompts.ts        ← 🔮 not built (Phase 5a AI — deferred)
    │   ├── csv.ts                   ← CSV parsing + bank format detection + duplicate hash
    │   └── utils.ts                 ← Shared helpers (cn, formatMYR, todayISO, etc.)
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
    │   └── claude/                  ← 🔮 not built (Phase 5a AI — deferred; none of these exist yet)
    │       ├── ClaudePanel.tsx      ← 🔮 planned: slide-in AI chat panel
    │       ├── DailyBriefing.tsx    ← 🔮 planned: one-click briefing button + display
    │       └── ApiKeySetup.tsx      ← 🔮 planned: first-time API key entry screen
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

### Phase 6 Worker (`worker/`) — in progress, coexists with `server/`
```
wrangler.toml                        ← Worker entry, D1 binding, [assets] SPA config
worker/
├── index.ts                         ← Hono app: /api logging, route mounts, 404 + error handler
├── types.ts                         ← Env bindings (DB: D1Database, ASSETS: Fetcher) + AppEnv
├── tsconfig.json                    ← Worker typecheck config (@cloudflare/workers-types)
├── lib.ts                           ← async port of server/lib.ts (+ ownedIdSet, newId)
├── lib/sharing.ts                   ← async port of server/lib/sharing.ts (+ writableAccountIds)
├── seed.ts                          ← async port of server/seed.ts (db.transaction → batch)
├── crypto.ts                        ← PBKDF2 via Web Crypto; self-describing hash format
├── session.ts                       ← D1-backed sessions + HMAC-signed cookie (not JWTs)
├── migrations/                      ← D1 migrations, ported from server/migrations/ (see its README)
└── routes/
    ├── health.ts                    ← GET /api/health (Phase 1 proof of life)
    ├── auth.ts                      ← signup/login/logout/me + requireAuth middleware
    ├── tasks.ts                     ← /api/tasks, /api/task-templates (auth)
    ├── settings.ts                  ← GET /api/settings, PUT /api/settings/:key (auth)
    ├── groups.ts                    ← /api/groups, /api/invites, /api/users/search (auth)
    ├── settlements.ts               ← /api/settlements, /api/transaction-shares/:id/* (auth)
    └── wallet.ts                    ← COMPLETE: /accounts, /accounts/:id/shares,
                                        /categories, /tags, /transactions (list,
                                        export, import, CRUD, link-transfer,
                                        splits), /budgets, /recurring-*, /goals

scripts/
├── schema-diff.mjs                  ← D1 schema vs server/migrations; CI-gated, exits non-zero on drift
├── export-to-d1.mjs                 ← SQLite → SQL files for `wrangler d1 execute --file` (--users allowlist)
├── verify-import.mjs                ← per-table row counts, D1 vs the export manifest
├── analyse-users.mjs                ← read-only census: real accounts vs e2e residue
└── set-password.mjs                 ← M6: prompts (echo off) → PBKDF2 hash → UPDATE SQL
```
> **Auth on Workers (Phase 3).** `SESSION_SECRET` is a **secret**, not a var —
> `wrangler secret put SESSION_SECRET` (e.g. piped from `openssl rand -base64 32`
> so the value is never displayed). `session.ts` throws if it is missing rather
> than falling back to a default, so a misconfigured deploy returns 500 instead
> of issuing forgeable sessions. `[env.dev]` in wrangler.toml supplies a dev
> secret plus `DAYBOOK_ALLOW_SIGNUP=true` for the e2e suite; **production keeps
> signup off**, which also makes the 409 user-enumeration oracle unreachable.
>
> **Change password**: `POST /api/auth/change-password` (Settings → Change
> password) requires the current password, enforces MIN_PASSWORD, and DELETES
> every session for that user before issuing a fresh one — so a stolen cookie
> dies with the password change. `scripts/set-password.mjs` remains only for the
> bootstrap case: setting the FIRST password on a new backend — needed at cutover because migrated
> bcrypt hashes cannot be verified by PBKDF2 (different algorithms, by design).
> It reads the password from a hidden prompt and emits `UPDATE` SQL; the password
> is never an argv value and never written to disk.
> **D1 gotchas found the hard way in Phase 2** — all three are silent-wrong or
> confusing-error traps, not documented limits:
> - **No named parameters.** better-sqlite3 binds `@key` from an object; D1's
>   `.bind()` is positional only. This is why `worker/lib.ts` `updateRow()` builds
>   an ordered argument list rather than a params object.
> - **D1 strips SQL comments** from the DDL stored in `sqlite_master`; SQLite keeps
>   them. Any schema comparison must strip comments or every commented table
>   reports as drift.
> - **Low `SQLITE_MAX_COMPOUND_SELECT`.** An 18-term `UNION ALL` is rejected with
>   "too many terms in compound SELECT". Use scalar subqueries to project many
>   aggregates in one query.
>
> The export/analysis scripts open the source database **read-only and snapshot it
> with `VACUUM INTO`** before reading, so they cannot disturb a running server or
> produce a torn read from an active WAL. Never point them at the live file any
> other way.
> Route modules are ported from `server/routes/` one phase at a time — auth in
> Phase 3, the rest in Phase 4. `server/` stays authoritative and untouched until
> the Phase 7 cutover, so both trees are live in the repo meanwhile.
>
> Static assets are served by Cloudflare's asset pipeline without invoking the
> Worker; `run_worker_first = ["/api/*"]` means only API paths run code. Single
> origin is preserved, exactly as `server/index.ts:77-85` does today.
>
> Scripts: `npm run dev:worker` (build + apply local D1 migrations + `wrangler
> dev` on **:8788**), `npm run typecheck:worker`, `npm run deploy:worker`.
> `wrangler dev` serves built `dist/`, not Vite — rebuild to see client changes.
> `.claude/launch.json` runs `dev:worker`, so the Browser pane gets `/api` too;
> `npm run dev` (plain Vite) has served no API since the Phase 6 migration.
>
> **:8788, deliberately not :5173.** The e2e harness owns 5173 and sets
> `reuseExistingServer`, so a hand-started dev server on that port is silently
> adopted by `playwright test` — and because the harness build sets `VITE_E2E=1`
> and this one does not, every spec relying on the `window.__test*` hooks
> (sidebar nav, CSV import, task search/undo) fails with no hint that the wrong
> server is answering. Keep the two on separate ports.

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
--                          for the pre-paint script in index.html — see §18)
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

Supports "Link as transfer" (docs/csv-transfer-linking-plan.md): merging two
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

> **A TOTAL is yours alone. `GET /api/accounts` is not.** That route returns
> own **plus shared-in** accounts, so any figure that sums the whole array counts
> other people's money as the viewer's. This shipped: RM100 of own money
> displayed as RM10,099 across "2 accounts" (fixed in PR #101, two independent
> call sites). Sum `ownAccounts` for totals; shared cards still render their real
> individual balance, and an "across N accounts" caption must count the same set
> the figure was summed over.

> **Never read `t.amount` for anything a user compares.** A split transaction's
> effective figure is not its gross. Tiles once used `countableAmount` while the
> cash-flow chart, pie, account chart and merchant list used raw `t.amount`, so a
> split RM100 expense read RM50 in a tile and RM100 in the chart directly beneath
> it (fixed across the dashboard in PR #106, which routed everything through one
> pure module). `TransactionList.tsx` day headers are **still unaudited** for
> this — see §13.

#### Transactions
- Add transaction: date (default today), merchant, description, amount, type (income/expense/transfer), category, tags (multiple, free-text)
- For **transfer** type: show a second account selector for `destinationAccountId`; hide category and tags fields (transfers are not categorised)
- Edit transaction: same form, pre-filled
- Delete transaction: undo-toast (single deletes are reversible; no confirm dialog)
- List view: grouped by day, shows date header with day total
- Filter bar: date range | type (all/income/expense/transfer) | category | account | tag(s) | free-text search (active filters shown as removable chips)
- Summary row: total income, total expense, net for selected period (transfers excluded from totals)

#### CSV Import flow
1. User uploads CSV file → PapaParse reads it
2. Auto-detect columns (date, amount, description/merchant)
3. For each row, compute `import_hash = SHA-256(date + '|' + amount + '|' + merchant)`
4. **Duplicate check:** query DB for existing `import_hash` values; mark matching rows as "already imported" and skip them by default
5. Show review table: all rows, each row editable, checkbox to exclude (duplicates pre-unchecked)
6. 🔮 *(Phase 5a — deferred, NOT implemented)* Claude was planned to auto-suggest a
   category per non-duplicate row. Today categorisation in the review step is **manual**.
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

> 🟡 **STATUS: MOSTLY NOT IMPLEMENTED — one slice shipped (PR #112).**
> **What exists:** the API-key infrastructure below, and exactly one Claude
> feature — the "Ask AI" fallback in the bulk edit dialog, which categorises
> only the merchants the rule-based pass missed
> (`docs/ai-bulk-categorize-feature.md`, `worker/lib/anthropic.ts`,
> `POST /api/transactions/suggest-categories-ai`).
> **What does not exist:** everything else here — no Claude panel, daily
> briefing, natural-language task/transaction entry, CSV auto-categorisation, or
> model routing. `src/components/claude/*`, `src/hooks/useClaude.ts`,
> `src/lib/claude.ts` and `src/lib/claude-prompts.ts` still do **not exist**;
> the one shipped feature needed none of them. Treat the rest of this
> subsection as design intent, not current behaviour, and get owner sign-off
> per rule 10 before building any more of it.

#### API setup
> **Shipped in PR #112, with one deviation.** There is no `ApiKeySetup`
> first-run screen: the key lives in an "AI categorisation" section on the
> Settings page (enter / replace / clear), which states plainly that it is
> stored as plain text. A first-run gate would have been wrong for a feature
> that is optional — the app must stay fully usable with no key, and every AI
> entry point is hidden or linked to Settings when none is set.
> `GET /api/settings` masks the value to `'set'`/`''` so the key never
> round-trips to the browser; `app.store`'s `hasAnthropicKey` is that presence
> flag, never the key itself.

- ~~On first launch (or if no key set): show ApiKeySetup component~~ → Settings page section
- User enters their Anthropic API key → stored in `settings` table under key `anthropic_api_key`
- Key is read at runtime from the DB, not from env vars (env var is a fallback for dev convenience only)
- Per-user, per-hour rate limit on any route that spends the key
  (`ai_rate_limit_*` in `settings`; one unit per request, not per Claude call)

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

### Zustand ↔ server sync pattern
> **Updated for Phase 4.** Persistence now lives on the Node + SQLite backend,
> reached through `src/lib/api.ts` (not the removed in-browser PGlite). The
> principle is unchanged: **server write first, then update the store on success.**

Zustand is the source of truth for UI rendering. The server (SQLite) is the source
of truth for persistence. Always write to the server (`api.post`/`api.put`/…) first,
then update the Zustand store on success. Never update the store optimistically
without a server write, as this creates divergence on refresh.

```typescript
// Pattern: server write first, then store update
async function addTask(content: string) {
  const newTask = await api.post<Task>('/tasks', { content })
  useTasksStore.getState().setTasks([...currentTasks, newTask])
}
```

### Delete confirmation policy
Two patterns, chosen by consequence:
- **Undo-toast** (no confirm dialog): single/low-consequence deletes — a task, a
  single transaction. Delete immediately, then offer a 5-second "Undo" toast.
- **`ConfirmDeleteModal`** (`src/components/ui/ConfirmDeleteModal.tsx`): high-consequence,
  bulk, or cascading deletes — deleting an account (cascades to all its
  transactions), bulk-deleting selected transactions, budgets, goals, recurring
  rules. Never hand-roll a `Modal` + `variant="danger"` confirm dialog for these;
  use `ConfirmDeleteModal` and, if a stable test hook is needed, its optional
  `confirmTestId` prop.

> **Tasks are the deliberate exception (CD-20).** Both single and bulk task
> deletes use the **undo-toast**, not `ConfirmDeleteModal` — the outliner is
> keyboard-first and every delete is instantly and fully reversible (the bulk
> path snapshots each selected subtree and restores it on Undo). Wallet's
> multi-select uses the confirm modal; Tasks' multi-select intentionally does
> not.

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

- [x] Anthropic API key — **now needed, per user.** Each user enters their own on
      the Settings page (§9.3). Optional: with no key the app is fully usable and
      every AI entry point is hidden. Get one at console.anthropic.com.
- [ ] ~~Vercel account~~ — **not needed.** Phase 6 shipped on Cloudflare Workers,
      not Vercel.
- [ ] ~~Supabase account~~ — **not needed.** Phase 6 shipped on D1, not Supabase.

---

## 13. Project Status

**Update this section at the end of every Claude Code session.** Keep it to
*current state* — what is live, what is blocked, what is next. The
session-by-session narrative lives in
[`docs/project-history.md`](docs/project-history.md); append there rather than
growing this section back to the 871 lines it reached before 2026-08-08.

### Where the app runs

**LIVE on Cloudflare Workers + D1** — <https://daybook.moascode.workers.dev>.
Two real users (kakon, tumpa). The Mac (Express + SQLite) is retired as a
deployment target but still running: it is the rollback of last resort.
`server/` remains in the repo only as the schema reference that
`scripts/schema-diff.mjs` gates CI against — it gets no feature work.

### Released

**Latest tag: `v2.9.0`** (2026-08-09). The full table with dates and contents
is in [`docs/project-history.md`](docs/project-history.md#release-record).

> **The release list is derived from `git tag`, not from memory.** It drifted
> three times by being updated only by whichever PR happened to touch this
> section — most recently sitting at "v2.4.0 PENDING" while v2.4.0, v2.5.0 and
> v2.6.0 were all tagged and deployed. When you cut a release, reconcile the
> history doc's table against:
>
> ```
> git for-each-ref --sort=-creatordate --format='%(refname:short) %(creatordate:short)' refs/tags
> ```

**`main` is fully released.** `v2.7.0`–`v2.9.0` were tagged and deployed on
2026-08-08/09; `v2.9.0` points at the same commit as `main`, so production is
not lagging. The earlier **HTTP 403 on tag refs** from a container agent proxy no
longer reproduces — tags push normally. If it returns, the symptom is that
branch pushes succeed and only tag refs are rejected, and `release.yml` has no
`workflow_dispatch`, so the tag must be pushed from a machine with direct git
access.

**The tag is the deploy** — `release.yml` holds the Cloudflare credentials and
runs end to end: full suite → D1 migrations → Worker deploy → smoke test →
GitHub Release.

```
git checkout main && git pull
git tag -a vX.Y.Z -m "vX.Y.Z — summary"
git push origin vX.Y.Z
```

### Phase status

| Phase | State |
|---|---|
| 0–4 (scaffold → home network) | ✅ shipped, v1.0 |
| 5a (AI) | 🟡 partially started — one slice shipped (PR #112). See §9.3 and §14. |
| 5b (sharing), 5c (wallet UX) | ✅ shipped, v1.0.1 |
| 6 (Workers + D1) | ✅ COMPLETE — 455/455 specs green against the Worker |
| 7 (advanced) | ongoing; recurring rules, budgets, goals already shipped |

### Blockers

**None blocking work.** Production is live and serving.

### Open risks and known bugs

1. **No rate limiting on the public URL** (the general case). The one paid
   endpoint has a per-user hourly cap (§9.3), but the URL is public and this is
   the oldest open risk on a live money app.
2. **ISO date validation accepts impossible calendar dates.** `Date.parse`
   rolls Feb 30 / Apr 31 over instead of returning `NaN`, so both
   `transactionInputError` and `isoDateError` pass them; only an out-of-range
   *month* is caught. Present in **both** backends. Pre-existing, not introduced
   by the Workers port.
3. **`TransactionList.tsx` day-header totals are unaudited.** PR #106 fixed the
   same class of bug (splits counted at gross instead of the effective figure)
   across the whole dashboard but did not touch the transaction list. Check
   whether the day headers double-count splits.
4. **PWA splash is white for dark-theme users** — `manifest.json`
   `background_color` cannot follow the theme (see §18).
5. **273 `e2e_*` accounts** still pollute the retired Mac's production DB. Not
   migrated to D1 (only kakon/tumpa were), so this is Mac-local cleanup.

### Next, in rough order of value

1. **Rate limiting** for the public URL (risk 1).
2. **Audit the day-header totals** (risk 3) — small, and the bug class is known
   to be real.
3. **Watch the netting paths with real use.** Every new column defaults to 0 and
   one-directional debt takes the old code path exactly, so nothing changes
   until two users genuinely owe each other both ways.
4. **Ready-to-build backlog, no sign-off needed:** waves F1–F3 in
   `docs/deferred-items-plan.md`; §4.4 the per-claim timeline (every timestamp
   already exists).
5. **Needs owner sign-off:** each remaining §9.3 AI item; D-5 auto-approve as a
   per-group "we trust each other" setting; the parked D-items/C9 in
   `docs/phase-5c-wallet-ux.md` §D.

### Standing notes

- Releases are tag-triggered; `release.yml` gates on the full suite, applies D1
  migrations **before** deploying, smoke-tests, then publishes the Release.
- **`release.yml` gates on a green *CI run for the tagged commit*, not on its
  own test run.** So the `wrangler dev` broken-pipe flake (documented in
  `playwright.config.ts`) fails the release indirectly: the shard dies, CI on
  the merge commit goes red, and the release exits with "CI concluded
  'failure'". Retries do not save it — once the server is dead every retry in
  that shard also fails on `ECONNREFUSED ::1:5173`. The fix is
  `gh run rerun <ci-run-id> --failed`, wait for green, **then**
  `gh run rerun <release-run-id>`. Re-tagging is not needed. Confirm it is the
  flake and not a real break by running the failing shard locally
  (`npx playwright test --shard=N/6`) before re-running anything.
- A local `wrangler … --remote` still fails from the owner's Mac (account not
  authorised). Only CI holds a token — verify remote D1 from the release log.
- D1 migrations are additive-only; rename via `ALTER TABLE … RENAME TO` is
  lossless and allowed with owner sign-off. Applied in lexicographic order.
- e2e uses a fresh DB per context; CI shards across 6 jobs.
- Pre-existing lint: 38 warnings (react-hooks, test-only shims).

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
| 5a | AI Features | AI | Claude integration, NL input, briefing, insights | 🟡 Partially started |
| 5b | Household Sharing | Feature | Groups, shared accounts, transaction splits, settlement | ✅ v1.0.1 |
| 5c | Wallet UX Improvements | UX/Features | Free-text search, accessibility, mobile fixes, polish | ✅ v1.0.1 |
| 6 | Cloud Migration | Cloud | Cloudflare Workers + D1 + PBKDF2 auth (**not** Supabase/Vercel — see `docs/option-2-workers-d1-plan.md`) | ✅ v2 |
| 7 | Advanced Features | v2+ | Recurring rules, budgets, goals, new modules | Planned |

**Note**: Phase 5 has been split into three subtasks:
- **Phase 5a (AI)** — no longer wholly deferred. Owner approved one slice on
  2026-08-08 (PR #112, AI fallback for bulk categorisation), which brought the
  API-key infrastructure §9.3 always assumed: per-user `anthropic_api_key` in
  `settings`, a Settings UI, masked reads, per-user rate limiting, and the first
  outbound Worker call (`worker/lib/anthropic.ts`).
  **Any later 5a item reuses that foundation — do not rebuild it.** What is
  still deferred is everything else in §9.3: the Claude panel, daily briefing,
  natural-language task/transaction entry, CSV auto-categorisation, prompt
  caching, and the `ApiKeySetup` first-run screen (Settings now covers the key).
  Each remaining item still needs its own owner sign-off under rule 10.
- **Phase 5b (Sharing)** shipped v1.0.1 — household groups, shared accounts, splits, settlements
- **Phase 5c (Wallet UX)** shipped v1.0.1 — all 5 wave PRs (#29–#33) merged, see docs/phase-5c-implementation-plan.md

### Delivery Milestones

| Milestone | After phase | What it means |
|---|---|---|
| **Alpha** | 3 | Core app fully working on your machine. Single user. Data in browser IndexedDB (since replaced — see §3). |
| **v1.0** | 4 | Multi-user on home network. Any device on your WiFi can log in. Data on your hardware. |
| **v1.0.1** | 5b | Household sharing added. Family members can share accounts and settle expenses. |
| **v2** | 6 | Cloud-hosted on Cloudflare Workers + D1, reachable from any device, session auth via PBKDF2. Shipped. AI is a separate, partially-started track (5a). |
| **v3+** | 7+ | Power features — ship whatever matters most, one at a time. |

> **Tracker:** Open `tracker.html` in a browser to see the interactive task-level breakdown with progress tracking.

---

## 15. Known Decisions & Rationale

| Decision | Choice | Why |
|---|---|---|
| App name | Daybook | Historical accounting term for a daily record — captures both tasks (what to do today) and finances (what you spent today) in one word |
| Local DB | ~~PGlite~~ → **D1** | PGlite (Phase 1–3) was per-browser; replaced by server SQLite in Phase 4 and by Cloudflare D1 in Phase 6. Do not reintroduce it. |
| State manager | Zustand | Lighter than Redux, simpler than Jotai for this complexity level |
| DnD | @dnd-kit | Most accessible, supports nested trees, actively maintained |
| Charts | Recharts | React-native, sufficient for cash flow + pie, no D3 complexity |
| AI model routing | Haiku + Sonnet | Haiku for parsing/categorisation, Sonnet for reasoning. ~60% cost saving. Only the Haiku half is built (`claude-haiku-4-5`, §9.3). |
| Domain | `daybook.moascode.workers.dev` | Free `workers.dev` subdomain. The vercel.app plan was dropped with Vercel itself. ⚠️ Publicly reachable. |
| Auth | ~~Supabase Auth~~ → **PBKDF2 + D1 sessions** | Phase 4 shipped bcrypt + express-session; Phase 6 replaced it with PBKDF2-HMAC-SHA256 (50k iterations) via Web Crypto and D1-backed sessions behind an HMAC-signed cookie. **Not JWTs** — logout must stay instant. |
| Transfer schema | `destination_account_id` on transactions | Transfers have two legs; without this column balances are incorrect |
| CSV dedup | `import_hash` column | SHA-256 of date+amount+merchant prevents double-importing the same CSV |
| Data export | Phase 5 feature | Browser storage can be cleared accidentally; JSON/CSV export is the safety net before cloud sync exists |
| Anthropic SDK | **None — plain `fetch`** | Removed in PR #112 after three years unimported. It targets Node and is unproven on the Workers runtime; see §4. |
| Sonnet model ID | `claude-sonnet-4-6` | Correct current model ID — `claude-sonnet-4-20250514` does not exist and will return 404 |
| Phase 4 architecture | Local Node.js backend + SQLite file | Home network multi-user requires a real server — PGlite is per-browser only. SQLite file keeps it simple before committing to Postgres |
| AI key location | Per user, in `settings`, read server-side only | The key never reaches the browser: `GET /api/settings` masks it to `'set'`/`''`. One user's spend can never land on the other's bill. |
| Cloud (Phase 6) ordering | Shipped **before** AI | Reversed in practice: Phase 6 landed first and AI began afterwards on top of it, so the one AI feature is Worker-native and `server/` never needed touching. |

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

### Traps this suite has already fallen into

Each of these cost a debugging session and none is guessable from the symptom.

1. **The suite runs on ONE clock — never call `toISOString()` for a date.**
   `todayStr()` is pinned to Asia/Kuala_Lumpur (B-11), so for the eight hours a
   day when the UTC date and the Malaysian date differ, rows the Worker stamps
   "today" land outside the month the client is showing. Specs were once split
   between `toISOString()` (UTC) and local date parts (host), so there was **no
   timezone at which the whole suite was green** inside that window — fixing one
   convention broke the other. `playwright.config.ts` now pins the browser *and*
   the test process to the business timezone (the `TZ` assignment must precede
   the imports — Node caches the zone on first use). Use
   `businessToday()` / `businessDatePlus()` from `e2e/helpers.ts`.
2. **Never hardcode a future date.** `32-wallet-error-toasts` pinned
   `nextDueDate: '2026-08-01'` and began failing when that day arrived. A spec
   that fails on a *schedule* rather than on a change is the worst kind to debug.
3. **`getByLabel()` matches SUBSTRINGS**, so a new control's accessible name can
   silently capture unrelated specs' lookups anywhere in the suite. A theme
   toggle shipped as "Switch to dark theme" made `getByLabel('To')` (date-range
   inputs, spec 03) and `getByLabel('Theme')` (spec 11) resolve to three
   elements. **Fix it in the app, not by patching specs** — name new controls
   after what they control, not as a sentence — then grep every `getByLabel`
   string in `e2e/` before shipping the name.
4. **`AppShell` renders both the mobile and desktop bars**, so chrome controls
   are in the DOM twice. Match `visible=true`, not `.first()`.
5. **The harness runs a PRODUCTION build**, so anything gated on
   `import.meta.env.DEV` vanishes. Test hooks are gated on `TEST_HOOKS_ENABLED`
   (`src/lib/utils.ts`), true when DEV **or** `VITE_E2E=1`, which only the
   Playwright build sets.
6. **Playwright cannot intercept a Worker→third-party fetch.** It intercepts
   requests the *browser* makes; `wrangler dev` runs an outbound Worker call from
   a separate process the test has no route into. The pattern to reuse:
   branch on `DAYBOOK_TEST` (already the flag gating `worker/routes/test.ts`) and
   read a canned response from a `settings` row, stashed by a test-only route —
   see `worker/lib/anthropic.ts` and `POST /test/mock-ai-response`. Production
   never sets `DAYBOOK_TEST`, so the branch is unreachable there.
7. **Don't hand-start a dev server on 5173.** The harness owns that port and
   sets `reuseExistingServer`, so it silently adopts yours — and without
   `VITE_E2E=1` every spec relying on `window.__test*` fails with no hint that
   the wrong server answered. `npm run dev:worker` uses **:8788** for this
   reason.

### Development workflow

**Default:** Branch → Plan (for non-trivial changes) → Implement → Test → PR →
wait for merge.

**Full 12-step workflow** (branch → plan → implement → test → review → PR → CI →
merge) is available on demand via the `dev-workflow` skill — use it for
significant changes where you want the whole process enforced.

**Small tasks** (typos, one-line fixes): skip the full workflow. Still branch
first, still test, still PR.

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

---

## 18. Theming & Colour Tokens

**Never write a literal grey or `white` in a component again.** Both themes are
defined in one place and everything else resolves through it.

### Where the colours live

| File | Role |
|---|---|
| `scripts/gen-theme-tokens.mjs` | **Source of truth.** Hand-authored neutrals + generated accent ramps. Edit this. |
| `src/index.css` | **Generated — do not hand-edit.** Regenerate with `npm run gen:tokens`. |
| `tailwind.config.js` | Maps the CSS variables onto Tailwind colour names. |
| `src/lib/theme.ts` | Resolves `'system'` → light/dark; the only place that touches the `dark` class. |

### Two families, handled differently

**1. Neutrals are semantic — use these, not `gray-*`/`white`:**

| Token | Replaces | Use for |
|---|---|---|
| `bg-canvas` | `bg-gray-50` | page background |
| `bg-surface` | `bg-white` | cards, panels, bars |
| `bg-surface-raised` | — | modals, dropdowns (floats above `surface` in dark) |
| `bg-surface-sunken` | `bg-gray-50` | wells, table headers |
| `bg-surface-hover` | `bg-gray-100` | hover states and static fills |
| `bg-surface-inverted` + `text-fg-inverted` | `bg-gray-900` + `text-white` | toasts, tooltips (inverted in **both** themes) |
| `text-fg` | `text-gray-900/800` | primary text |
| `text-fg-muted` | `text-gray-700/600` | secondary text |
| `text-fg-subtle` | `text-gray-500` | labels, captions |
| `text-fg-faint` | `text-gray-400/300` | icons, disabled |
| `text-fg-on-accent` | `text-white` | text on a solid brand/danger fill |
| `border-line` / `-subtle` / `-strong` | `border-gray-200/100/300` | borders, dividers |

A literal grey step is meaningless once the scale inverts — `gray-900` text is
the darkest thing on screen in light and nearly the lightest in dark. Using the
semantic token means a new component gets dark mode **for free**, with no
`dark:` variants to remember.

**2. Accents keep Tailwind's numeric scale** — `bg-red-50`, `text-brand-600`,
`bg-amber-100` all still work and need no `dark:` variant. Light values are
Tailwind's own hexes; the dark theme serves the same ramp **mirrored**
(50↔950, 100↔900, … 500↔500), so a `-50` tint chip becomes a `-950` tint chip,
`-600`/`-700` accent text becomes `-400`/`-300` and stays legible, and solid
`-500` fills are identical in both themes.

### Rules

1. **Adding a colour to a component**: reach for a semantic neutral or an accent
   scale. If neither fits, add a token to `scripts/gen-theme-tokens.mjs` and
   regenerate — do not hand-edit `src/index.css`, and **never add a `dark:`
   variant** (there are none in the codebase; one would be the first).

   > **`dark:` variants DOUBLE-INVERT.** The token layer already mirrors the
   > accent ramps (50↔950), so `bg-amber-50` *already* resolves to a dark tint in
   > dark mode; pairing it with `dark:bg-amber-950` inverts a second time and
   > lands on near-white. Eight of these shipped into review during the dashboard
   > rebuild before being caught by *looking at the rendered page* — the type
   > checker cannot see it, and neither can a reviewer reading the diff.
2. **Colours passed as props, not classes** — Recharts grids/axes/tooltips —
   come from `useChartTheme()`, which reads `resolvedTheme` from the store.
   Series colours are deliberately excluded: income/expense keep their money
   semantics (B9) and category colours are user data.
3. **`theme` vs `resolvedTheme`** in `app.store`: `theme` is the tri-state
   preference (`'light' | 'dark' | 'system'`); `resolvedTheme` is what is
   actually on screen. Branch on `resolvedTheme` in JS, never on `theme`.
4. **Changing the theme** goes through `useThemePreference().changeTheme`,
   shared by the Settings select and the TopBar toggle so they cannot drift.
5. **The pre-paint script in `index.html` is load-bearing.** The preference
   lives on the server and is not readable until after auth, so without the
   localStorage mirror every load of a dark-themed app flashes white. If you
   change the storage key or the class name, change it in **both**
   `src/lib/theme.ts` and the inline script. Spec 58 blocks the JS bundle to
   prove it — asserting after hydration would pass on the store's localStorage
   seed alone, which lands a frame too late, after the white paint.
6. **`manifest.json` `background_color` STAYS `#ffffff`.** Decided 2026-08-05;
   do not "fix" it again. The manifest spec gives it a single colour with no
   media-query form, and the OS caches the manifest at install time, so unlike
   `<meta name="theme-color">` (which `index.html` already swaps pre-paint) it
   **cannot** follow the theme. The only choice is which single colour to commit
   to, and `#ffffff` matches the default Light theme both users are on. A
   dark-theme user gets a brief white splash; the alternative is a dark splash in
   front of a white app for everyone else.
