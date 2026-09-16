> **Status:** Live · **Last verified:** 2026-09-16

# Project structure

The file map. `src/` on disk is always the real map — this is the annotated one.

> Extracted from `CLAUDE.md` on 2026-09-16. `CLAUDE.md` keeps the rules and the traps;
> this file holds the long-form reference they point at.

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

### Worker (`worker/`) — **this is production**; `server/` is the schema reference
```
wrangler.toml                        ← Worker entry, D1 binding, [assets] SPA config
worker/
├── index.ts                         ← Hono app: /api logging, route mounts, 404 + error handler
├── types.ts                         ← Env bindings (DB: D1Database, ASSETS: Fetcher) + AppEnv
├── tsconfig.json                    ← Worker typecheck config (@cloudflare/workers-types)
├── lib.ts                           ← async port of server/lib.ts (+ ownedIdSet, newId)
├── seed.ts                          ← async port of server/seed.ts (db.transaction → batch)
├── crypto.ts                        ← PBKDF2 via Web Crypto; self-describing hash format
├── session.ts                       ← D1-backed sessions + HMAC-signed cookie (not JWTs)
├── migrations/                      ← D1 migrations, ported from server/migrations/ (see its README)
├── lib/
│   ├── anthropic.ts                 ← ALL four Claude calls + the DAYBOOK_TEST mock branch ([`feature-specs.md` §AI](feature-specs.md))
│   ├── sharing.ts                   ← async port of server/lib/sharing.ts (+ writableAccountIds)
│   ├── capture-token.ts             ← capture-token hashing, scopes, rate-limit constants
│   ├── insert-transaction.ts        ← shared transaction-insert path
│   ├── merchant.ts                  ← canonicalisation + buildDuplicateKey
│   ├── merchant-map.ts              ← builtin cold-start merchant→category map
│   ├── notifications.ts             ← the six digests, shared by the bell and push
│   ├── rate-limit.ts                ← overRateLimit(), used by every metered route
│   └── webpush.ts                   ← VAPID signing + push delivery (v3 P4)
└── routes/
    ├── health.ts                    ← GET /api/health (public)
    ├── auth.ts                      ← signup/login/logout/me/change-password + requireAuth
    ├── tasks.ts                     ← /api/tasks, /api/task-templates (auth)
    ├── settings.ts                  ← GET /api/settings, PUT /api/settings/:key (auth)
    ├── groups.ts                    ← /api/groups, /api/invites, /api/users/search (auth)
    ├── settlements.ts               ← /api/settlements, /api/transaction-shares/:id/* (auth)
    ├── search.ts                    ← GET /api/search — transactions, tasks, accounts (R17 §1)
    ├── notifications.ts             ← /api/notifications/* + push subscriptions (R17 §3, P4)
    ├── capture.ts                   ← /api/capture/* — BEARER TOKEN ONLY, never the cookie (R18)
    ├── capture-tokens.ts            ← /api/capture-tokens — mint/revoke, cookie-auth (R18)
    ├── captures.ts                  ← /api/captures — the pending inbox, cookie-auth (R18)
    ├── test.ts                      ← /api/test/* — only when DAYBOOK_TEST=1
    └── wallet.ts                    ← /accounts, /accounts/:id/shares, /categories,
                                        /tags, /transactions (list, export, import,
                                        CRUD, link-transfer, splits), /budgets,
                                        /recurring-*, /goals, /merchants/*, and the
                                        AI routes (suggest-categories-ai, composer
                                        parse, photo import)

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
> The port is finished — every route above is live on the Worker, and several
> (`search`, `notifications`, `capture*`) have no `server/` counterpart at all
> because they were built after the cutover. `server/` is the schema reference
> only; never add a route there.
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
