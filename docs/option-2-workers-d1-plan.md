# Option 2 Implementation Plan — Cloudflare Pages + Workers + D1

> **Version 2 — rewritten 2026-07-27 after Phase 0.** Supersedes the pre-spike
> draft, which estimated from reading code rather than measuring. Every number
> below is either measured (see `docs/option-2-spike-findings.md`) or derived
> from a counted property of the codebase.
>
> **Status: Phase 0 complete, no blocker found. Awaiting the go/no-go in [§10](#10-the-decision).**
> Phases 1–7 are not started. Nothing in the repo has been changed for this
> migration.

## 0. What this is

A step-by-step plan to move Daybook off the Mac and onto Cloudflare Workers + D1,
at $0/month, with no machine at home to maintain.

**Rollback anchor: `v1.0.0`** — tagged 2026-07-27, with branch
`release/v1.0.0`. That tag is the stable Mac-only local product. Everything below
happens after it and can be abandoned at any point without touching it.

---

## 1. What Phase 0 established

Four spikes ran against real infrastructure. Full detail in
`docs/option-2-spike-findings.md`; here is what each one changed about this plan.

| Spike | Result | Effect on this plan |
|---|---|---|
| **S1** PBKDF2 vs CPU budget | Hard cliff at **100k–105k iterations** (OWASP: 600k) | Fixes the KDF at **50,000** and makes password strength a **code-enforced precondition** (Phase 3) |
| **S2** CSV import via `batch()` | **5,000 rows in one batch**, ~10× headroom | Insert path is a non-issue. But surfaced an **N+1 query bug** that must be fixed (Phase 4) |
| **S4** Playwright + `wrangler dev` | **6/6 in 3 s**, harness *simplifies* | Phase 6 revised **down**; two web servers and a proxy collapse to one command |
| **S3** heavy read paths | not run — downgraded | Verify opportunistically in Phase 4; S2 showed I/O-interleaved work has headroom |

### Three findings that change the work

**1. Blocker 4.1 disappears.** `docs/phase-6-online-plan.md` §4.1 flags the
hardcoded `secure: false` cookie plus the `trust proxy` trap as the most likely
way to break the migration. **On Workers it does not exist** — TLS always
terminates at the edge and `CF-Connecting-IP` always carries the real client IP.
The single nastiest item on the blocker list is deleted by the platform.

**2. PR 1 from the analysis doc must be skipped.** It specifies `helmet` and
`express-rate-limit`, both Express middleware that cannot run on Workers.
Building it first would be wasted work. Its content is folded into Phases 3–4 in
Workers-native form ([§5](#5-hardening-mapping)).

**3. The import route has an N+1 bug that is invisible today.**
`wallet.ts:583-595` calls `canWriteAccount()` and `ownsAllRefs()` **per row**,
and `ownsAllRefs` → `userOwns` (`lib.ts:86-89`) issues a `SELECT` per call. Under
`better-sqlite3` these are in-process and free. Under D1 each is a network round
trip: a 500-row import becomes **1,000–1,500 sequential awaited queries**. Must
be hoisted before the route works at all.

---

## 2. Target architecture

```
Browser
   │  https://daybook.moascode.workers.dev
   ▼
Cloudflare edge
   │
   ├── static assets (dist/)        ← served directly, no Worker invocation
   │   not_found_handling = "single-page-application"
   │
   └── Worker (Hono)                ← run_worker_first = ["/api/*"]
         ├── session middleware (D1-backed, HMAC-signed cookie)
         ├── /api/* routes  (ported from server/routes/)
         └── D1 binding → daybook (production database)
```

```toml
# wrangler.toml — the shape proven by spike S4
name = "daybook"
main = "src/worker/index.ts"
compatibility_date = "2026-07-01"

[assets]
directory = "./dist"
not_found_handling = "single-page-application"
run_worker_first = ["/api/*"]

[[d1_databases]]
binding = "DB"
database_name = "daybook"
database_id = "<created in Phase 2>"
```

**Single origin is preserved** — the same property `server/index.ts:77-85` gives
today. No CORS, no `SameSite=None`, no split deploy. S4 confirmed this works
including SPA deep links.

**Retired at Phase 7:** the Mac, launchd, `infra/daybook` (884 lines),
`infra/port-forward.js`, `setup-lan`, the release tarball pipeline, and the
SQLite file.

---

## 3. Prerequisites — account state

| # | Step | Status |
|---|---|---|
| M1 | Cloudflare account + **2FA enabled** | ✅ done 2026-07-26 |
| M2 | `wrangler login` (OAuth, stored `~/Library/Preferences/.wrangler/`) | ✅ done |
| M9 | Register `workers.dev` subdomain → **`moascode`** | ✅ done (not in the v1 plan; found by Phase 0) |
| M3 | Approve the three dependencies in [§8](#8-dependencies) | ⬜ **blocks Phase 1** |
| M4 | Workers Free vs Paid | ✅ **answered by S1/S2: Free is sufficient** at 50k iterations |
| M6 | Choose new passwords for both accounts (24+ chars, password manager) | ⬜ blocks Phase 3 |
| M7 | Smoke-test on your own phone + laptop | ⬜ blocks Phase 7 |
| M8 | Final cutover approval | ⬜ blocks Phase 7 |
| M5 | Review + merge 7 PRs | ⬜ ongoing, ~2 h total |

**Remaining owner time: ~3 hours.**

> The OAuth token wrangler holds is broader than this project needs (it includes
> `email_sending`, `containers`, `connectivity:admin` — Cloudflare's fixed scope
> list, not a choice). Swapping to a Workers+D1-scoped API token is a reasonable
> hardening step at any point; not blocking.

---

## 4. Division of labour

**I handle:** every line of code, `wrangler.toml`, migrations, data export/import
scripts, the e2e port, CI changes, all PRs and commit messages, and the CLAUDE.md
updates (§3/§4/§5/§13).

**Only you can:** approve dependencies, choose passwords, smoke-test on your own
devices, approve cutover, and review/merge. I cannot create accounts, enter
credentials, or authenticate as you.

---

## 5. Hardening mapping

The public-exposure blockers from `docs/phase-6-online-plan.md` §4, translated:

| Blocker | Express plan | Workers form | Lands in |
|---|---|---|---|
| 4.1 secure cookie + `trust proxy` | `app.set('trust proxy', N)` | **N/A — eliminated** | — |
| 4.2 open signup | `DAYBOOK_ALLOW_SIGNUP` | same flag as a Worker `[vars]` entry | Phase 3 |
| 4.3 rate limiting | `express-rate-limit` | **Cloudflare Rate Limiting Rules** at the edge | Phase 4 |
| 4.4 password minimum | raise to 12 | raise to 12 **+ S1 precondition** | Phase 3 |
| 4.5 security headers | `helmet` | Hono `secureHeaders()` | Phase 3 |
| 4.6 offsite backups | `VACUUM INTO` → R2 | **Cron Trigger** → D1 export → R2 | Phase 7 |

---

## 6. The phases

Each is one PR, branched from the previous, reviewed and merged before the next.
**The Mac serves the live app untouched through Phases 1–6.** There is no partial
cutover and no dual-write.

### Phase 1 — Scaffold

**Branch:** `feat/workers-scaffold` · **1 session** · blocks on M3

1. Add `hono`, `wrangler`, `@cloudflare/workers-types` (§8).
2. `wrangler.toml` per §2 — assets, SPA fallback, `run_worker_first`.
3. `src/worker/index.ts`: Hono app, port `routes/health.ts` (14 lines) as proof of life.
4. Scripts: `dev:worker`, `build:worker`; CI job running `wrangler deploy --dry-run`.
5. Update CLAUDE.md §4 stack table.

**Verify:** SPA loads at `daybook.moascode.workers.dev`, a deep link resolves,
`GET /api/health` returns 200. (S4 proved all three work.)

### Phase 2 — Data layer

**Branch:** `feat/d1-migrations-and-data` · **1–2 sessions**

1. Create the production D1 database; record `database_id`.
2. Port all **9 migrations** to `wrangler d1 migrations`. SQL is compatible —
   including `0007`'s `ALTER TABLE … RENAME TO`. Drop `journal_mode = WAL` and
   the custom runner in `db.ts:78-119`; D1 owns both.
3. Port `lib.ts` `updateRow()` (dynamic SQL builder) and `seed.ts` to async.
4. Write the export/import script: SQLite → SQL dump → `wrangler d1 execute --file`.

**Verify:** `sqlite_master` in D1 matches the Mac; a full import round-trips with
matching row counts per table.

### Phase 3 — Auth and sessions

**Branch:** `feat/workers-auth` · **1–2 sessions** · blocks on M6

1. **PBKDF2-HMAC-SHA256 at 50,000 iterations** via Web Crypto — half of S1's
   measured 100k ceiling, leaving budget for D1 calls and serialisation.
2. **Write the S1 precondition into the code**, not just the docs: a comment at
   the hashing call stating that 50k is only sound because both accounts use
   24+ character random passwords, plus `MIN_PASSWORD` raised to 12.
3. Port `session-store.ts` (89 lines) → D1-backed sessions with an HMAC-signed
   cookie via `hono/cookie`. **Server-side session rows, not JWTs** — logout and
   revocation must stay instant, as they are today.
4. Preserve session regeneration on login (`auth.ts:26-32`, fixation defence).
5. `DAYBOOK_ALLOW_SIGNUP` flag (4.2) — this also closes the **409
   user-enumeration oracle** at `auth.ts:50`.
6. Hono `secureHeaders()` (4.5). CSP needs `style-src 'unsafe-inline'` for
   Recharts — verify against Dashboard and Reports.

**Verify:** signup → login → session persists across reload → logout invalidates.
Auth specs pass.

> **M6 lands here.** bcrypt hashes cannot be verified by PBKDF2, so both accounts
> need new passwords. With two users that is a two-minute task — and it is what
> makes the 50k iteration count defensible in the first place.

### Phase 4 — Route port

**Branch:** `feat/workers-routes` (likely split in two — wallet is half the code)
· **3–4 sessions**

Ported in ascending order of risk so the pattern is proven on small files first:

| File | Lines | `.prepare()` sites |
|---|---|---|
| `settings.ts` | 21 | 2 |
| `tasks.ts` | 94 | 6 |
| `settlements.ts` | 299 | 21 |
| `groups.ts` | 382 | 31 |
| `wallet.ts` | **1,461** | **68** |

1. **156 `.prepare()` sites** converted to `await` + `.first()/.all()/.run()`.
   Mechanical but pervasive.
2. **Fix the N+1 in the import route** (`wallet.ts:583-595`): replace the per-row
   `canWriteAccount` / `ownsAllRefs` calls with **one** query for writable
   account IDs and **one** for owned category IDs, checked against a `Set`. The
   codebase already uses this exact pattern at `wallet.ts:1061-1065`, so it is
   idiomatic here rather than novel.
3. **Audit every remaining `.prepare()` inside a loop** for the same pattern. The
   Phase 0 sweep found most other loops already build a single batched query
   (e.g. `wallet.ts:556` chunks hash lookups 500 at a time), so this is expected
   to be contained — but it must be checked, not assumed.
4. Configure **Cloudflare Rate Limiting Rules** on `/api/auth/*` (4.3).
5. **Opportunistic S3:** measure Reports/Dashboard aggregates and
   `GET /transactions/export` against real data as those routes land.

### Phase 5 — Atomicity

**Branch:** `feat/d1-atomicity` · **1–2 sessions**

D1 has **no interactive transactions** — `batch()` is atomic but cannot branch on
an intermediate read. All 11 `db.transaction()` sites were read and classified;
two are irrelevant (`db.ts` migrations, `seed.ts`, both handled in Phase 2). The
remaining seven:

| Site | What it does | Strategy | Difficulty |
|---|---|---|---|
| `wallet.ts:596` | CSV batch insert | `batch()` | easy — **S2 proved 5,000 rows work** |
| `wallet.ts:796` | link-transfer merge | `batch()` — validation already hoisted | easy |
| `wallet.ts:922` | replace splits (DELETE + INSERT) | `batch()` | easy |
| `wallet.ts:1030` | bulk splits | `batch()` — sum validation already outside (`:1009`) | easy |
| `settlements.ts:247` | undo settlement (DELETE by known IDs) | `batch()` | easy |
| `wallet.ts:1313` | recurring-rule advancement | JS computes all writes from a pre-read set → one `batch()`; **confirm no intra-loop reads** | medium |
| `settlements.ts:104` | create settlement: reads usernames + outstanding shares, books two ledger transactions, marks shares settled | Hoist reads; guard with `UPDATE … WHERE settled_at IS NULL` and check `meta.changes` for lost races | **hard — the one needing care** |

Only `settlements.ts:104` is a genuine read-then-conditionally-write. With two
users a collision is vanishingly unlikely — **but this is money**, so it gets an
explicit optimistic-concurrency guard and a regression spec, not a shrug. Any
TOCTOU window we accept is documented in the code.

### Phase 6 — e2e suite green

**Branch:** `test/workers-e2e-harness` · **1–2 sessions** *(revised down — S4)*

S4 proved this is easier than feared:

1. Replace the **two** `webServer` entries (tsx on :3099, Vite on :5173) and the
   `DAYBOOK_API_TARGET` proxy with **one** `wrangler dev` command. Assets and API
   already share an origin.
2. Drop startup timeouts from 30 s — measured cold start is ~3 s.
3. Port `POST /api/test/reset` to `batch()`, gated on a `[vars]` flag rather than
   `process.env`.
4. Run all **51 specs**.

**The isolation model ports unchanged.** `e2e/helpers.ts` isolates by signing up
a fresh user per page, not by resetting the database — that needs only `INSERT`
and per-user `WHERE`, both of which D1 provides. S4 verified this end to end.

**Caveat:** e2e will run against built assets, so the loop needs `npm run build`
first and loses Vite HMR. Whether *development* keeps Vite with a proxy or moves
fully to `wrangler dev` is an open design question to settle here.

**This phase is the gate.** If the 51 specs cannot be made green, we do not cut
over.

### Phase 7 — Cutover

**Branch:** `chore/workers-cutover` · **1 session** · blocks on M7, M8

1. Final export from the Mac → import to production D1 (app briefly read-only).
2. Both users log in with new passwords and verify their own data (**M7**).
3. Cron Trigger → D1 export → **R2 offsite backups** (4.6). R2 free tier is 10 GB
   with zero egress; the database is 1.2 MB.
4. Stop the launchd service. **Keep the SQLite file untouched** as the rollback
   artifact.
5. Rewrite CLAUDE.md §3/§4/§5/§13 for the new architecture.
6. Archive `infra/daybook`, `port-forward.js`, and the launchd tooling.

---

## 7. Effort

| Phase | Sessions | Your time |
|---|---|---|
| 0 Spikes | ✅ done | ✅ done |
| 1 Scaffold | 1 | 15 min |
| 2 Data layer | 1–2 | 15 min |
| 3 Auth | 1–2 | 25 min |
| 4 Routes (incl. N+1 fix) | 3–4 | 30 min |
| 5 Atomicity | 1–2 | 20 min |
| 6 e2e | 1–2 | 20 min |
| 7 Cutover | 1 | 45 min |
| **Total** | **9–14 sessions** | **~3 h** |

Revised down from the v1 plan's 11–16: S4 cut Phase 6, and reading the
transaction sites cut Phase 5 from the original 3–5 days. The N+1 fix added back
about a session.

**Calendar time is set by your review cadence, not my throughput.** Seven PRs at
one per evening is roughly a week and a half; at one per weekend, two months.

---

## 8. Dependencies

CLAUDE.md Rule 2 requires sign-off (**M3**).

**Add:** `hono` (dep — Workers router), `wrangler` (dev — CLI/deploy/migrations),
`@cloudflare/workers-types` (dev — types).

**Remove at Phase 7:** `express`, `express-session`, `better-sqlite3`, `bcrypt`,
`tsx`, and their `@types/*`.

**No dependency for password hashing** — PBKDF2 comes from the Workers runtime.

---

## 9. Rollback and safety

- **`v1.0.0` is the anchor.** Tagged, released, and branch-preserved as
  `release/v1.0.0`. It is the stable Mac-only product and is unaffected by
  everything above.
- **The Mac runs untouched through Phases 1–6.** No dual-write, no split-brain.
- **The SQLite file is never deleted.** Post-cutover it is the rollback artifact;
  restarting launchd restores the old world in minutes.
- **Phase 6 is the gate.** Failing there costs effort and loses nothing.
- The only irreversible moment is Phase 7's final export, and only for
  transactions written after it. With two users and a scheduled cutover, that
  window is minutes.

---

## 10. The decision

**Phase 0 found no technical blocker.** The app fits the free tier. What remains
is a judgement call that measurement cannot settle.

**For.** $0/month forever, no domain, no machine to maintain, no OS patching, no
launchd, no port forwarding. Blocker 4.1 eliminated. A *simpler* test harness
than today's. D1 being SQLite means the schema and most query text survive.

**Against.** The always-on Windows 11 machine reaches the same place via Options
1 or 3 for **$0–1/month with no rewrite at all**. This costs 9–14 sessions and
ships a KDF at 1/12 of the recommended strength. Option 2's distinctive
advantage — independence from home hardware — was worth a great deal before that
machine existed and much less now.

### Accepted if we proceed

1. **Cloudflare holds the database and its keys.** D1 is AES-256 encrypted at
   rest, Cloudflare-managed. Whoever holds the Cloudflare account holds the
   ledger — **2FA is the real perimeter**, not the encryption.
2. **Field-level encryption is unavailable.** The app filters and aggregates in
   SQL over `amount`, `date`, `merchant`, `category_id`; encrypting them breaks
   Dashboard, Reports, filters and budgets.
3. **A KDF at 50k iterations**, sound only while both passwords stay long and random.
4. **Vendor shape.** The data exports cleanly (it is SQLite), but runtime, auth,
   sessions and deploy all become Cloudflare-specific. Leaving later is another
   migration.
5. **`*.workers.dev` is occasionally blocked by corporate DNS filters.**
   Irrelevant at home; fixable later with a domain.
6. **~884 lines of working, tested deploy tooling retired.**

**Next step if yes:** approve §8 (M3) and I start Phase 1.
**Next step if no:** `docs/phase-6-online-plan.md` §3 has Options 1 and 3 costed
and ready, both about a day's work on the Windows box.
