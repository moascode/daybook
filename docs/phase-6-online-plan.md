# Phase 6 Analysis: Making Daybook Available Online

> Status: **Analysis only — no hosting path chosen yet.** Written 2026-07-26.
> Two sub-decisions are already locked by the owner (see [Locked decisions](#locked-decisions));
> the hosting path in [§2](#2-hosting-options-costed) is deliberately left open.

## Goal

Reach Daybook from outside the home LAN — a public hostname, over TLS, without
handing the open internet an unauthenticated door into a personal financial
ledger.

---

## 1. Grounding: current-state facts (verified in code)

The starting position is stronger than CLAUDE.md §14 implies. What already exists:

| Capability | Where | State |
|---|---|---|
| SPA + API on **one origin** | `server/index.ts:77-85` | Done. Express serves `dist/` with an SPA fallback alongside `/api`. No CORS layer needed, no split deploy. |
| Versioned release artifacts | `.github/workflows/release.yml` | Done. Tag → typecheck → build → full e2e gate → tarball + SHA-256 → GitHub Release. |
| Atomic deploy + rollback | `infra/daybook` | Done. Capistrano-style symlink releases, pre-deploy DB snapshot, `rollback` re-points the symlink. |
| Process supervision | `infra/daybook install-service` | Done. launchd with `RunAtLoad` + `KeepAlive`. |
| Production secret handling | `infra/daybook:170-176`, `server/index.ts:24-27` | Done. The plist sets `NODE_ENV=production` and a persisted `SESSION_SECRET`; the server **throws** rather than fall back to the dev default. The public dev-default secret is therefore not in play. |
| Session hardening basics | `server/routes/auth.ts:26-32` | Done. Session regenerated on auth (fixation defence), store errors surface as 500 rather than a phantom login. |
| Per-user data isolation | every route | Done. All queries scoped by `user_id`; Phase 5b e2e coverage asserts non-members can't read shared rows. |

**The gap is not architecture.** It is TLS, a closed front door, and abuse
controls. The app is a single Node process serving a SPA and a file-backed DB;
that shape deploys online as-is.

### The one structural constraint

`better-sqlite3` is **synchronous**. Every query blocks the event loop of a
single Node process. For a household this is a non-issue, and it is why the
current design is so simple. But it means:

- no horizontal scaling — one process, one DB file, forever;
- any slow or repeated CPU-bound operation is a whole-app stall. This is the
  reason unauthenticated `bcrypt` calls are a DoS vector and not just a
  brute-force one (see Blocker 3).

---

## 2. Hosting options, costed

### ⚠️ The documented Phase 6 plan (Supabase + Vercel) is the wrong plan

CLAUDE.md §14 specifies Supabase + Vercel + RLS. That path requires:

- rewriting **every route** from synchronous `better-sqlite3` to async Postgres;
- porting 8 shipped migrations to Postgres DDL;
- replacing bcrypt/express-session auth with Supabase Auth;
- re-expressing all per-user scoping as RLS policies, then re-proving the
  Phase 5b sharing isolation guarantees against them;
- rebuilding the group/split/settlement queries, which are the most intricate
  SQL in the project.

And **Vercel cannot host the current server at all** — serverless functions have
no persistent filesystem, so there is no SQLite file. Supabase isn't an optional
add-on in that plan; it's forced by the hosting choice.

None of this is required by the goal. Going online does not require abandoning
SQLite.

### The three paths

| | **A — Cloudflare Tunnel to the Mac** | **B — Fly.io / Render + volume** | **C — Supabase + Vercel** |
|---|---|---|---|
| Keeps current backend | Yes, unchanged | Yes, containerised | No — full rewrite |
| Keeps `infra/daybook` | Yes, entirely | No — replaced by a new deploy path | No |
| TLS | Free, automatic | Free, automatic | Free, automatic |
| Router / port forwarding | None needed | n/a | n/a |
| Origin IP exposed | No | n/a | n/a |
| Uptime | = your Mac's uptime | Real (hosted) | Real (hosted) |
| DB migration needed | None | One-time copy off the Mac | Full port to Postgres |
| New work | `cloudflared` install + DNS | Dockerfile, `better-sqlite3` rebuilt for linux-musl, volume mounted at `DAYBOOK_HOME`, new deploy tooling, DB move | Everything above |
| Rough effort | **~1h** + hardening | **~1 week** + hardening | **multiple weeks** |
| Scaling ceiling | Household | Household (volume pins to one instance) | Real, unused |

**Assessment.** For a single-household personal app, **A** is the proportionate
choice: it discards none of the infrastructure already built, and the entire
delta is a tunnel plus the hardening in §3 — which is required under *all three*
paths anyway. **B** is the answer if Mac uptime turns out to be the real
complaint after living with A for a while; the hardening work carries over
unchanged, so starting with A costs nothing if you later switch. **C** should be
struck from the roadmap unless the requirements change to genuinely need
multi-tenant cloud scale.

**Recommendation: A, with B as the documented upgrade path.** Not yet decided.

---

## 3. Blockers — must fix before any public hostname resolves

These apply to **every** hosting path. They are the actual Phase 6 work.

### 3.1 Session cookie is hardcoded insecure

`server/index.ts:52` — `secure: false`, with the comment *"home network is HTTP;
revisit when TLS lands"*. TLS is now landing. Over the internet, a cleartext
session cookie is a full account takeover on any hostile hop.

Fix is **two coupled changes**, and they must ship together:

```ts
app.set('trust proxy', 1)          // NEW — required
// ...
cookie: { secure: process.env.NODE_ENV === 'production', ... }
```

> **Failure mode to watch for.** Without `trust proxy`, Express evaluates the
> tunnel's internal HTTP hop, concludes the connection is insecure, and silently
> **refuses to send** a `secure` cookie. Login returns 200, no cookie is stored,
> and every subsequent request 401s. This is the single most common way this
> migration breaks, and the symptom points nowhere near the cause.

Consider also `sameSite: 'strict'` once on a stable hostname — `lax` is retained
today only because nothing cross-site exists.

### 3.2 Signup is open to the world

`server/routes/auth.ts:35` — `POST /api/auth/signup` has no gate whatsoever. The
moment a public URL exists, anyone can create an account. Their *data* is
isolated, but they become a real username in the instance namespace, and the
Phase 5b group-invite flow is **username-based** — a stranger squatting a
plausible username is an invite-misdirection risk, not just noise.

**Resolved — see [Locked decisions](#locked-decisions).** Cloudflare Access sits
in front, so unauthenticated traffic never reaches Express at all. An
`DAYBOOK_ALLOW_SIGNUP` env flag remains worth adding as defence in depth, since
it is ~5 lines and survives a future change of gate.

### 3.3 No rate limiting anywhere

No throttle on `/api/auth/login`. Two distinct problems:

1. **Brute force** — unlimited password guesses, with no lockout and a 6-char
   minimum (see 3.4).
2. **DoS** — `bcrypt.compareSync` at cost 10 blocks the event loop for ~100ms.
   Because the process is single-threaded and `better-sqlite3` is synchronous, a
   login flood stalls *the entire app for every user*, not just the attacker's
   requests. This is the structural constraint from §1 turning into a security
   property.

Apply `express-rate-limit` to `/api/auth/*` specifically (tight: ~10 attempts /
15 min / IP) and a looser global limiter. Behind a proxy this depends on
`trust proxy` from 3.1 being set, or every request appears to come from the
tunnel's IP and the limiter degrades into a global kill switch.

### 3.4 Password minimum is 6 characters

`server/routes/auth.ts:13` — `MIN_PASSWORD = 6`. Defensible on a LAN with a
handful of trusted devices; not defensible facing the internet. Raise to 10–12.
Note `MAX_PASSWORD = 72` is correct and should stay — bcrypt silently truncates
beyond 72 bytes, so the existing cap is a real protection, not an arbitrary one.

Existing accounts keep working (bcrypt hashes are unaffected); only new
passwords are validated against the new floor.

### 3.5 No security headers

`helmet` is not installed and no headers are set manually. Missing at minimum:
HSTS, CSP, `X-Content-Type-Options: nosniff`, `Referrer-Policy`.

CSP needs care — the SPA is Vite-built with hashed assets, so a reasonably
strict policy is achievable, but `style-src` will likely need `'unsafe-inline'`
for Recharts' inline styling. Verify against the Dashboard and Reports pages
before shipping; a CSP that breaks charts silently in production is worse than
a slightly loose one.

### 3.6 Backups are on the same disk as the database

`infra/daybook backup` snapshots to `DAYBOOK_HOME/backups/` — the same physical
disk as `shared/data/daybook.db`. Today the LAN boundary caps the blast radius.
A publicly reachable instance holding a real financial ledger needs **encrypted,
offsite** copies on a schedule.

This is the item least likely to be exploited and most likely to actually cost
something. Disk failure, not attackers, is the realistic threat to a personal
ledger.

Suggested shape: extend `infra/daybook backup` with an optional off-machine
target, run nightly via launchd, retain ~30 days. Use SQLite's `.backup` /
`VACUUM INTO` rather than copying the file — the DB runs in WAL mode (`db.ts:69`)
and a naive `cp` of a WAL-mode database can capture a torn state.

---

## 4. Assessed and deliberately not blocking

| Item | Assessment |
|---|---|
| **CSRF** | Adequately covered. `sameSite: 'lax'` blocks cookies on cross-site POST, and every state-changing route requires `Content-Type: application/json`, which an HTML form cannot forge. No token layer needed. |
| **`GET /transactions/export`** (`server/routes/wallet.ts:486`) | A state-changing GET would be a `lax` bypass, but this is a read that returns the user's own data to themselves. Low risk. |
| **Public repo** | Not a vulnerability — routes, validation, and defaults are all readable, which raises the bar on §3 rather than adding a new item. The `SESSION_SECRET` guard means the published dev default is unusable in production. |
| **`express.json({ limit: '5mb' })`** (`server/index.ts:41`) | Applies to unauthenticated routes too, so it is an unauth memory sink. Neutralised by 3.3's rate limiting; no separate fix. |
| **Log rotation** | `server.log` grows unbounded; launchd will not rotate it. Operational annoyance, not a blocker. Worth a `newsyslog.d` entry. |
| **Uptime monitoring** | Under path A, a sleeping Mac is indistinguishable from an outage. An external ping check is worth having before household members depend on it. |

---

## 5. Locked decisions

Owner-decided 2026-07-26:

- **Access gate: Cloudflare Access in front.** Email-OTP before any request
  reaches Express. Zero application code, and it removes the unauthenticated
  `/auth/*` surface from internet-wide traffic entirely — which substantially
  de-risks blockers 3.2 and 3.3. Note this implies path A or B; Access fronts an
  origin you control.
- **New dependencies approved: `helmet` + `express-rate-limit`.** Both must be
  added to the approved-stack table in CLAUDE.md §4 as part of the
  implementing PR (Rule 2).

Still open: **the hosting path** (§2).

---

## 6. Suggested sequencing, once a path is chosen

The hardening is path-independent, so it can land first and be verified on the
LAN before anything is exposed.

**PR 1 — `feat/production-hardening`** (path-independent, do this first)
- `trust proxy` + env-driven `secure` cookie (3.1)
- `helmet` with a CSP verified against Dashboard/Reports (3.5)
- `express-rate-limit` on `/api/auth/*` + global (3.3)
- `MIN_PASSWORD` → 10 (3.4)
- `DAYBOOK_ALLOW_SIGNUP` flag (3.2, defence in depth)
- CLAUDE.md §4 stack table updated with the two new packages
- New spec `52-production-hardening.spec.ts`: rate-limit 429 after N attempts,
  short-password rejection, signup-disabled path, security headers present

**PR 2 — `feat/offsite-backups`**
- `VACUUM INTO`-based snapshot + encrypted offsite target in `infra/daybook`
- Nightly launchd schedule, ~30-day retention
- Documented **restore** drill — an untested backup is not a backup

**PR 3 — hosting path** (contents depend entirely on §2)
- Path A: `cloudflared` config, DNS, Cloudflare Access policy, `docs/ci-cd.md` update
- Path B: Dockerfile, linux-musl `better-sqlite3`, volume config, DB migration,
  replacement deploy tooling

Cookie behaviour from 3.1 cannot be fully verified until PR 3 puts a real TLS
terminator in front — plan a smoke test of login/refresh/logout against the
public hostname as the final gate, not the e2e suite.

---

## Open question for the owner

Which hosting path (§2)? Everything in PR 1 and PR 2 is worth doing regardless
and can start immediately; only PR 3 is blocked on the answer.
