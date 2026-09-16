> **Status:** Live · **Last verified:** 2026-09-16

# Architecture

How the app is wired, and what each historical layer was replaced by.

> Extracted from `CLAUDE.md` on 2026-09-16. `CLAUDE.md` keeps the rules and the traps;
> this file holds the long-form reference they point at.

---

## 3. Architecture Overview

> **CURRENT — Cloudflare Workers + D1.** This is what serves
> <https://daybook.moascode.workers.dev> and has since Phase 6 (v2). Anything
> below describing Express, `better-sqlite3` or the Mac is history, not
> architecture: `server/` still exists in the repo but is a **schema reference
> only** (`scripts/schema-diff.mjs` gates CI against it) and receives no feature
> work.

```
Browser (React 18 + Vite)                    Cloudflare Worker (Hono)
├── React Router (client routes)      ──►    ├── /api/* routes (worker/routes/*.ts)
├── Zustand stores (in-memory UI state)      ├── PBKDF2 + D1-backed sessions
└── src/lib/api.ts (fetch, cookie)    ◄──    ├── outbound Claude calls (worker/lib/anthropic.ts)
                                             └── D1 (SQLite at the edge)
                                                 (worker/migrations/, per-user rows)
```

- **Persistence:** Cloudflare D1. Migrations live in `worker/migrations/`, applied
  by `release.yml` **before** each deploy.
- **Auth:** PBKDF2-HMAC-SHA256 via Web Crypto + D1-backed sessions behind an
  HMAC-signed cookie — **not JWTs**, so logout is instant (§15).
- **Static assets** are served by Cloudflare's asset pipeline without invoking
  the Worker; `run_worker_first = ["/api/*"]` means only API paths run code.
- **AI: live, and the Worker makes real Anthropic calls.** Four features ship
  today (`worker/lib/anthropic.ts`): AI bulk categorisation, merchant-name
  resolution, the composer's free-text parse, and photo-statement import. Each
  has its own per-user hourly `ai_rate_limit_*` bucket. The key is per user in
  `settings`, read server-side only and masked on read. See [`feature-specs.md` §AI](feature-specs.md) — and do not
  rebuild this plumbing, it exists.

<details><summary>Phase 4 home-network server (historical — retired as a deployment target 2026-07-29)</summary>

```
Browser (React 18 + Vite)                    Home-network server (Node + Express)
├── React Router (client routes)      ──►    ├── /api/* REST routes (routes/*.ts)
├── Zustand stores (in-memory UI state)      ├── express-session + bcrypt auth
└── src/lib/api.ts (fetch, cookie)    ◄──    └── better-sqlite3 → daybook.db
                                                 (file-based migrations, per-user rows)
```

Phase 4 landed as a local Node + SQLite backend on home hardware, not Supabase.
The Mac still runs as the rollback of last resort, but nothing deploys to it.
</details>

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
> stage. See `docs/archive/phase-4-plan.md`.

#### Backend (Phase 6 — Cloudflare Workers + D1) — ✅ **live; this is production**
| Package | Version | Purpose |
|---|---|---|
| `hono` | ^4.12 | Workers-native router; replaces `express` in the Worker |
| `wrangler` | ^4.114 | Cloudflare CLI — build, local dev, D1 migrations, deploy (dev) |
| `@cloudflare/workers-types` | ^5 | Workers runtime type definitions (dev) |

> Approved per `docs/archive/option-2-workers-d1-plan.md` §7. **The cutover happened**
> — the Worker serves production and `server/` serves nothing. Both trees are
> still in the repo, but that is deliberate and permanent, not a migration in
> flight: `scripts/schema-diff.mjs` gates CI on D1 matching `server/migrations/`,
> so `server/` is the schema reference. It gets no feature work.
>
> No new dependency for password hashing: PBKDF2 comes from the Workers runtime's
> Web Crypto.
>
> **`express`, `express-session`, `better-sqlite3`, `bcrypt` and `tsx` are NOT
> being removed.** An earlier note here promised Phase 7 would delete them; that
> is not happening while `server/` is the schema reference CI depends on. Do not
> "finish the cutover" by uninstalling them — you would break `schema-diff`.
>
> **`compatibility_date` in `wrangler.toml` must not exceed the bundled
> `workerd` version's date** (check `node_modules/workerd/package.json`) — a
> future date is a hard `wrangler dev` startup failure, not a warning.

#### Cloud (Phase 6 only — do not install before Phase 6)
> ⛔ **Superseded.** Phase 6 is being built on Cloudflare Workers + D1 (the table
> above), not Supabase + Vercel. See `docs/archive/phase-6-online-plan.md` for the options
> analysis. Do not install these.

| Package | Version | Purpose |
|---|---|---|
| `@supabase/supabase-js` | ^2.43 | Supabase client |
| `@supabase/auth-ui-react` | ^0.4 | Auth UI components |

---
