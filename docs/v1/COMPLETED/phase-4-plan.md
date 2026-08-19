# Phase 4 — Home Network + Multi-User (v1 milestone)

> Plan of record. Branch: `claude/next-phase-plan-oBtpK`.
> Per CLAUDE.md §14/§15, Phase 4 = **local Node.js backend + SQLite file + auth + per-user
> data**. (Supabase/cloud is Phase 6, not here. Section 3's diagram conflicts with this;
> we trust the more detailed §14/§15 roadmap.)

## Decisions (signed off by owner)

| Decision | Choice |
|---|---|
| Data layer | **Full REST swap** — drop in-browser PGlite; browser calls Node server over HTTP; server owns one SQLite file. Offline returns in Phase 6. |
| Backend stack | **Express + better-sqlite3** (+ bcrypt for password hashing, express-session for sessions) |
| Auth model | **Session cookies** — server-side sessions, httpOnly + sameSite=lax cookie, bcrypt hashes |
| Delivery | **Staged PRs** (3 draft PRs, see below) |

## Target architecture

```
Browser (React + Vite)                 Node server (new)
├── src/lib/api.ts  ──HTTP /api──▶      ├── Express routes
├── hooks call fetch, not PGlite        ├── express-session (httpOnly cookie)
└── auth gate in App.tsx                ├── bcrypt password hashing
                                        └── better-sqlite3 ──▶ server/data/daybook.db
```

PGlite (`src/db/`) is removed from the client. Vite dev-proxies `/api` → Node server.

## Packages to add (update CLAUDE.md §4)

`express`, `better-sqlite3`, `bcrypt`, `express-session` + matching `@types/*`.
Lightweight dev runner for booting both servers (no heavy dep).
Note: better-sqlite3 is a native module — verify it builds on the Linux container in PR 1.

## Schema changes (Rule 3 — authorized by Phase 4 go-ahead; mirror into CLAUDE.md §6)

- New `users` (id, username, password_hash, created_at) + session store table.
- Add `user_id` FK to every data table: tasks, accounts, categories, transactions,
  budgets, recurring_transactions, goals, task_templates, settings.
- `settings` becomes per-user (composite key `user_id + key`).
- Categories seed **per user on signup** instead of globally.
- Convert schema SQL from PGlite/Postgres dialect back to SQLite-native
  (`datetime('now')`, etc.) — matches the original CLAUDE.md §6 syntax.

## E2E strategy

- Per-user data ⇒ test isolation becomes **a fresh throwaway user per test** instead of
  fresh IndexedDB. `newAppPage` registers + logs in a new user.
- Playwright `webServer` boots both Vite and the API server.
- Goal: keep all 266 tests green (Rule 11).

## Delivery — 3 staged draft PRs

| PR | Scope | Done when |
|----|-------|-----------|
| **1 — Server scaffold** | `/server` Express app, better-sqlite3 + SQLite schema (native dialect), health route, Vite `/api` proxy, dev runner, CLAUDE.md §4 update. No client rewiring yet. | Server boots, `/api/health` responds, app still runs. |
| **2 — Data-layer migration** | REST endpoints for all entities, `src/lib/api.ts` client, rewrite `useTasks`/`useWallet` to fetch, delete PGlite. Single implicit user for now. e2e runs both servers. | All CRUD works over HTTP; suite green. |
| **3 — Auth + per-user** | `users`/sessions, signup/login pages, session middleware, `user_id` scoping on every query, per-user category seed, auth gate in `App.tsx`, e2e helpers register-per-test. | Two users see isolated data; full suite green; CLAUDE.md §6 + §13 updated. |

## Risks

- Hooks rewrite is the bulk of the work: `useWallet.ts` (~29 KB) and `useTasks.ts`
  (~16 KB) move from PGlite calls to async fetch. DB-first-then-store pattern (§10) stays.
- Offline goes away until Phase 6 — expected per roadmap.
- Security basics: bcrypt, httpOnly + sameSite=lax cookies, session secret from env,
  no secrets in the bundle. Lays groundwork for the Phase 5 Anthropic-key proxy.
