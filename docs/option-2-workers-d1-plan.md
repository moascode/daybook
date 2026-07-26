# Option 2 Implementation Plan — Cloudflare Pages + Workers + D1

> Status: **Proposed. Not started. Needs owner sign-off on [§7 new dependencies](#7-new-dependencies--needs-approval)
> and the [§3 spike outcomes](#3-phase-0--spikes-settle-these-before-committing) before Phase 1 begins.**
> Written 2026-07-26. Companion to `docs/phase-6-online-plan.md` (options analysis).
> Effort figures assume **Claude Code performs the implementation**; owner effort is
> costed separately and explicitly.

## 0. Why this document

`docs/phase-6-online-plan.md` compares three ways to put Daybook online and
recommends Option 3. The owner is inclined toward **Option 2** — Cloudflare
Pages + Workers + D1 — because it is the only path that is **$0/month forever,
needs no domain, and has no dependency on a machine at home staying awake.**

This document plans that migration in full. It is deliberately honest about what
gets worse as well as what gets better.

### One correction to the analysis doc

`phase-6-online-plan.md` §2.2 flags D1's lack of interactive transactions as
"the single biggest reason Option 2 is weeks rather than days," estimating 3–5
days of redesign across 11 `db.transaction()` sites.

**Having read all of them, that was pessimistic.** The breakdown is in
[§5.5](#phase-5--atomicity--the-only-real-design-work). Five of seven relevant
sites are straight `batch()` conversions, because the existing code already
hoists validation *outside* the transaction — `wallet.ts:1009` literally carries
the comment *"Sum validation BEFORE opening db.transaction()"*. Only two need
design work. The revised estimate is **1–2 sessions, not 3–5 days**.

The rest of the migration is unchanged in scope.

---

## 1. Target architecture

```
Browser
   │  https://daybook.<subdomain>.workers.dev
   ▼
Cloudflare edge
   │
   ├── static assets (dist/)         ← served directly, no Worker invocation
   │   not_found_handling = "single-page-application"
   │
   └── Worker (Hono)                 ← run_worker_first = ["/api/*"]
         ├── session middleware (D1-backed, signed cookie)
         ├── /api/* route modules  (ported 1:1 from server/routes/)
         └── D1 binding → daybook database
```

**Single origin is preserved.** One Worker serves both the SPA and the API, the
same property `server/index.ts:77-85` gives today. No CORS, no `SameSite=None`
cookies, no split deploy.

**What goes away:** the Mac, launchd, `infra/daybook`, the port-80 forwarder,
`setup-lan`, the release tarball pipeline, and the SQLite file. Deployment
becomes `wrangler deploy` from CI.

---

## 2. Division of labour

### 2.1 What I handle

Everything code-shaped, end to end:

- All porting: Express → Hono, sync → async, bcrypt → Web Crypto, session store
- `wrangler.toml`, D1 bindings, static-asset config, CI workflow changes
- Porting all 9 migrations to D1's migration system
- Writing the data-export/import scripts
- Re-pointing the 51-spec e2e suite at `wrangler dev` and getting it green
- All spikes in Phase 0, with written findings
- Every PR, branch, commit message, and doc update (CLAUDE.md §3/§4/§5/§13)

### 2.2 What only you can do

I cannot create accounts, enter credentials, or authenticate on your behalf.
These are yours, and each one **blocks** the phase it sits in:

| # | Manual step | Phase | Your time |
|---|---|---|---|
| M1 | Create/confirm a Cloudflare account, **enable 2FA** | 0 | 15 min |
| M2 | `wrangler login` (browser OAuth) on this machine | 1 | 5 min |
| M3 | Approve the new dependencies in §7 | 0 | 5 min |
| M4 | Decide Workers **Free vs Paid ($5/mo)** once the M-CPU spike reports | 0 | 10 min |
| M5 | Review + merge each PR (8 of them) | all | ~2 h total |
| M6 | Choose new passwords for both accounts post-auth-cutover | 3 | 10 min |
| M7 | Smoke-test on your own phone + laptop before cutover | 7 | 30 min |
| M8 | Final cutover approval | 7 | 5 min |

**Total owner time: ~3.5–4 hours**, spread across the project.

> On M2: `wrangler login` runs an OAuth flow in your browser. I can run the
> command, but you complete the authorisation. Alternatively you create a scoped
> API token and put it in `.env.local` — I'll take whichever you prefer, but I
> won't handle the token value beyond referencing the env var.

### 2.3 What we do together

Phase 0's spike results may change the plan. If the CPU spike (S1) fails on the
free tier, the choice is yours: pay $5/mo, or accept weaker password hashing on
the strength of long random passwords. I'll present numbers, not a fait accompli.

---

## 3. Phase 0 — spikes (settle these before committing)

**Do not start Phase 1 until these four report.** Each one can invalidate or
reshape the plan, and all are cheap to run. This is the whole point of doing them
first.

| # | Spike | Question it answers | Kills/changes the plan if… |
|---|---|---|---|
| **S1** | **PBKDF2 CPU budget** | How many PBKDF2-HMAC-SHA256 iterations fit in the free tier's **10ms CPU per invocation**? | If even ~100k doesn't fit, auth on the free tier is untenable → Workers Paid ($5/mo) or a documented weaker KDF. **Highest-risk unknown.** |
| **S2** | **D1 batch limits** | Max statements and total query size per `batch()`. Does a realistic CSV import (a few hundred rows) fit in one batch and one invocation? | If not, CSV import needs chunking + a partial-failure story. Affects `wallet.ts:596`. |
| **S3** | **Heavy read paths** | Do the Reports/Dashboard aggregates and `GET /transactions/export` complete within CPU limits against a seeded D1? | If not, those endpoints need pagination or precomputation. |
| **S4** | **e2e harness** | Can Playwright drive `wrangler dev --local` with a resettable D1, replacing `DAYBOOK_TEST=1` + `POST /api/test/reset`? | If the reset story is unworkable, the 51-spec suite needs rethinking — that would be the largest hidden cost in the project. |

**Deliverable:** `docs/option-2-spike-findings.md` with measured numbers and a
go/no-go recommendation. **Effort: 1 session. Blocks on M1 + M2.**

> If S1 and S4 both come back clean, the rest of this plan is mechanical and
> low-drama. If either fails, we reconvene before writing migration code.

---

## 4. Important: this replaces PR 1, it does not follow it

`phase-6-online-plan.md` §7 specifies **PR 1 — `feat/production-hardening`**
using `helmet` and `express-rate-limit`. **Both are Express middleware and do not
run on Workers.** If you commit to Option 2, building PR 1 first is wasted work.

The hardening still happens — it moves into Phases 3 and 4 in Workers-native form:

| Blocker (from the analysis doc §4) | Express plan | Workers equivalent |
|---|---|---|
| 4.1 secure cookie + `trust proxy` | `app.set('trust proxy', N)` | **Not needed.** Workers always sees real client IP via `CF-Connecting-IP`; TLS is always terminated at the edge. Cookie is simply `Secure`. |
| 4.2 open signup | `DAYBOOK_ALLOW_SIGNUP` env flag | Same flag, as a Worker env var |
| 4.3 rate limiting | `express-rate-limit` | Cloudflare **Rate Limiting Rules** at the edge (free tier includes basic rules), or a Durable Object counter |
| 4.4 password minimum | raise to 12 | same, in the ported auth route |
| 4.5 security headers | `helmet` | Hono's `secureHeaders()` middleware, or a hand-written header middleware |
| 4.6 offsite backups | `VACUUM INTO` → R2 | **Cron Trigger** in the Worker → `wrangler d1 export` equivalent → R2 bucket |

**Net effect: option 2 makes blocker 4.1 disappear entirely** (the `trust proxy`
trap that I flagged as the most likely way to break this migration simply doesn't
exist on Workers), and turns 4.3 into edge configuration rather than application
code. That's a genuine simplification, and it partly offsets the porting cost.

**Recommendation: skip PR 1 as written.** Its content is folded into Phases 3–4
below.

---

## 5. Phased plan

Each phase is one PR, branched from the previous, reviewed and merged before the
next begins. The Mac keeps serving the current app untouched throughout — there
is no partial cutover.

### Phase 1 — Scaffold

**PR:** `feat/workers-scaffold`

- `wrangler.toml`: Worker entry, D1 binding, `[assets]` with SPA fallback,
  `run_worker_first = ["/api/*"]`
- Hono app skeleton; port `routes/health.ts` (14 lines) as the proof of life
- Vite build output wired as the assets directory
- `npm run dev:worker` script; CI job that runs `wrangler deploy --dry-run`
- **Verification:** deployed Worker serves the SPA, deep links resolve,
  `GET /api/health` returns 200

**My effort: 1 session.** Blocks on M2.

### Phase 2 — Data layer

**PR:** `feat/d1-migrations-and-data`

- All 9 migrations ported to `wrangler d1 migrations` (SQL is compatible;
  `0007`'s `ALTER TABLE … RENAME TO` works as-is). Drop the `journal_mode = WAL`
  and custom runner from `db.ts` — D1 manages both.
- Port `lib.ts` `updateRow()` (dynamic SQL builder, 99 lines) and `seed.ts` to async
- Export/import scripts: SQLite → SQL dump → `wrangler d1 execute --file`
- **Verification:** schema in D1 matches the Mac byte-for-byte (compare
  `sqlite_master`); a full data import round-trips with matching row counts per table

**My effort: 1–2 sessions.**

### Phase 3 — Auth and sessions

**PR:** `feat/workers-auth`

- bcrypt → **PBKDF2-HMAC-SHA256 via Web Crypto**, iteration count set by S1
- `session-store.ts` (89 lines) → D1-backed sessions with an HMAC-signed cookie
  (`hono/cookie` signed helpers). Keeps today's semantics: server-side session
  rows, real logout, real revocation. **Not** JWTs — logout must stay instant.
- Session regeneration on login preserved (`auth.ts:26-32` — fixation defence)
- Blockers 4.2 (`DAYBOOK_ALLOW_SIGNUP`), 4.4 (min length 12), 4.5 (secure headers)
- **The 409 user-enumeration oracle at `auth.ts:50` is closed** by the signup flag
- **Verification:** signup → login → session persists → logout invalidates; specs
  covering auth pass

> **M6 lands here.** Existing hashes are bcrypt and cannot be verified by PBKDF2,
> so both accounts need new passwords. With two users this is a feature, not a
> migration problem — use a password manager and generate 24+ characters. That
> also makes S1's iteration count largely academic: a random 24-char password is
> not brute-forced at any iteration count.

**My effort: 1–2 sessions.** Blocks on S1, M6.

### Phase 4 — Route port

**PR:** `feat/workers-routes` (may split into two — wallet is half the codebase)

Ported in ascending order of risk, so the pattern is proven on small files first:

| File | Lines | `.prepare()` sites |
|---|---|---|
| `settings.ts` | 21 | 2 |
| `tasks.ts` | 94 | 6 |
| `settlements.ts` | 299 | 21 |
| `groups.ts` | 382 | 31 |
| `wallet.ts` | **1,461** | **68** |

156 `.prepare()` sites total, converted `.get()/.all()/.run()` →
`.first()/.all()/.run()` with `await`. Mechanical but pervasive — this is the
bulk of the raw work and the least interesting part of it.

Blocker 4.3 (rate limiting) configured as edge rules here.

**My effort: 3–4 sessions.**

### Phase 5 — Atomicity — the only real design work

**PR:** `feat/d1-atomicity`

The 11 `db.transaction()` sites, classified by reading each one. Two are
irrelevant (`db.ts` migrations, `seed.ts` — both handled in Phase 2). The
remaining seven:

| Site | What it does | Strategy | Difficulty |
|---|---|---|---|
| `wallet.ts:596` | CSV batch insert (N rows) | `batch()` | **easy** (chunk per S2) |
| `wallet.ts:796` | link-transfer merge | `batch()` — validation already hoisted | **easy** |
| `wallet.ts:922` | replace splits (DELETE + INSERT loop) | `batch()` | **easy** |
| `wallet.ts:1030` | bulk splits | `batch()` — **sum validation already outside** (`:1009`) | **easy** |
| `settlements.ts:247` | undo settlement (DELETE by known IDs) | `batch()` | **easy** |
| `wallet.ts:1313` | recurring-rule advancement loop | JS computes all writes from a pre-read set, then one `batch()` — **must confirm no intra-loop reads** | **medium** |
| `settlements.ts:104` | create settlement: reads usernames + outstanding shares, then books two ledger transactions and marks shares settled | Hoist reads; guard with conditional `UPDATE … WHERE settled_at IS NULL` and check `meta.changes` for lost races (optimistic concurrency) | **hard — the one that needs care** |

Only `settlements.ts:104` involves a genuine read-then-conditionally-write that
must not race. With two users the practical collision probability is negligible,
but *negligible is not zero and this is money* — so it gets an explicit guard and
a regression spec rather than a shrug.

**Any TOCTOU window we accept gets documented in the code**, not silently
tolerated.

**My effort: 1–2 sessions.**

### Phase 6 — e2e suite green

**PR:** `test/workers-e2e-harness`

- Playwright re-pointed at `wrangler dev --local` (Miniflare, local D1)
- `POST /api/test/reset` ported; `DAYBOOK_TEST=1` gating preserved
- All **51 specs** run and pass
- CI updated: replace the tarball/release job with `wrangler deploy`

This is the phase that proves Phase 5b's isolation guarantees survived the move.
Expect iteration — the specs are the safety net and they will find things.

**My effort: 2–3 sessions.**

### Phase 7 — Cutover

**PR:** `chore/workers-cutover`

- Final data export from the Mac → import to production D1 (app briefly read-only)
- Both users log in with new passwords, verify their own data (**M7**)
- Cron Trigger + R2 backups live (blocker 4.6)
- Mac service stopped, **DB retained untouched** as the rollback artifact
- CLAUDE.md §3/§4/§5/§13 rewritten for the new architecture
- `infra/daybook`, `port-forward.js`, launchd tooling deleted or archived

**My effort: 1 session.** Blocks on M7, M8.

---

## 6. Effort summary

| Phase | My sessions | Your time | Blocks on |
|---|---|---|---|
| 0 Spikes | 1 | 30 min | M1, M2, M3 |
| 1 Scaffold | 1 | 15 min | M2 |
| 2 Data layer | 1–2 | 15 min | — |
| 3 Auth | 1–2 | 25 min | S1, M6 |
| 4 Routes | 3–4 | 30 min | — |
| 5 Atomicity | 1–2 | 20 min | — |
| 6 e2e | 2–3 | 20 min | S4 |
| 7 Cutover | 1 | 45 min | M7, M8 |
| **Total** | **11–16 sessions** | **~3.5–4 h** | |

**Calendar time is set by your review cadence, not by my throughput.** Eight PRs
reviewed at one per evening is roughly two weeks; at one per weekend, two months.
Phases 1–6 are all reversible — nothing touches production until Phase 7.

---

## 7. New dependencies — needs approval

CLAUDE.md Rule 2 requires sign-off before any package is added.

**Add:**

| Package | Type | Purpose |
|---|---|---|
| `hono` | dep | Workers-native router; replaces `express` |
| `wrangler` | dev | Cloudflare CLI — build, dev server, D1 migrations, deploy |
| `@cloudflare/workers-types` | dev | Runtime type definitions |

**Remove at Phase 7:** `express`, `express-session`, `better-sqlite3`, `bcrypt`,
`@types/express`, `@types/express-session`, `@types/better-sqlite3`,
`@types/bcrypt`, `tsx`.

**No new dependency for password hashing** — PBKDF2 comes from the Workers
runtime's Web Crypto.

CLAUDE.md §4's stack table is updated in Phase 1 and again in Phase 7.

---

## 8. Rollback and safety

- **The Mac runs untouched through Phases 0–6.** No dual-write, no partial
  cutover, no split-brain.
- **The SQLite file is never deleted.** After Phase 7 it is the rollback artifact;
  restarting the launchd service restores the old world in minutes.
- **Every phase is behind a PR** you review before it merges.
- **Phase 6 is the gate.** If the 51 specs cannot be made green, we do not cut
  over — and we will have spent effort but lost nothing.
- The only irreversible moment is Phase 7's final export, and only for
  transactions written after it. With two users and a scheduled cutover, that
  window is minutes.

---

## 9. What we accept by choosing this

Stated plainly so it isn't a surprise later:

1. **Cloudflare holds the database and its encryption keys.** D1 is AES-256
   encrypted at rest, but Cloudflare-managed — they can technically read it, and
   so can anyone who compromises your Cloudflare account. **2FA on that account
   (M1) is the real perimeter**, not the encryption. Today the data sits on
   hardware you physically control.
2. **Field-level encryption is not available to us.** The app filters and
   aggregates in SQL over `amount`, `date`, `merchant`, and `category_id` —
   encrypting those columns would break Dashboard, Reports, filters and budgets.
3. **A hard dependency on one vendor.** SQLite-compatible SQL means the data can
   be exported and moved, but the runtime, auth, sessions, and deploy pipeline all
   become Cloudflare-shaped. Leaving later is another migration.
4. **`*.workers.dev` is occasionally blocked by corporate DNS filters.**
   Irrelevant on home/mobile networks; fixable later with a domain.
5. **A 10ms CPU ceiling on the free tier**, which we design against rather than
   discover in production — hence S1–S3.
6. **`infra/daybook` and the release pipeline are retired.** ~884 lines of working,
   tested tooling deleted. That's the right call if we commit, but it is a real loss.

### What we gain

Always-on, $0/month, no domain, no machine at home to maintain, no OS patching,
no launchd, no port forwarding, blocker 4.1 eliminated entirely, and edge-level
rate limiting instead of application code.

---

## 10. Recommended first step

Approve §7's three dependencies (**M3**), enable 2FA on Cloudflare (**M1**), and
run `wrangler login` (**M2**). I'll then execute Phase 0 and come back with
measured numbers and a go/no-go.

**Phase 0 costs one session and is the cheapest possible way to find out whether
this plan survives contact with the platform.** If S1 or S4 fails, we will have
learned it for one session's work instead of six.
