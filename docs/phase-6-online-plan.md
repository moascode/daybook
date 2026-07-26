# Phase 6 Plan: Making Daybook Available Online

> Status: **Three candidate paths, costed and sized. Awaiting owner selection.**
> Written 2026-07-26. Prices verified against vendor pricing pages on that date —
> re-check before committing. Effort figures are grounded in measured codebase
> size (see [§2.2](#22-option-2--cloudflare-pages--workers--d1)).

## Goal

Reach Daybook from outside the home LAN, over TLS, from **any device** —
including devices we cannot install software on — without handing the open
internet an unauthenticated door into a personal financial ledger.

### Owner constraints

- **Two active users.** Not a public product; no growth assumption.
- **Target cost: $0/month**, "a few dollars only if it's really really required."
- **Any-device access is required.** This rules out a private VPN-style tailnet
  (see [§6](#6-considered-and-dropped)) and means **all three surviving options
  are publicly reachable**. Consequence: the full blocker list in [§4](#4-blockers--apply-to-all-three-options)
  applies to every option here. There is no path below where hardening is optional.

---

## 1. Grounding: current state

### What already works

| Capability | Where | State |
|---|---|---|
| SPA + API on **one origin** | `server/index.ts:77-85` | Express serves `dist/` with SPA fallback alongside `/api`. No CORS, no split deploy. |
| Versioned release artifacts | `.github/workflows/release.yml` | Tag → typecheck → build → e2e gate → tarball + SHA-256 → GitHub Release. |
| Atomic deploy + rollback | `infra/daybook` | Symlink releases, pre-deploy DB snapshot, instant rollback. |
| Process supervision | `infra/daybook install-service` | launchd, `RunAtLoad` + `KeepAlive`. |
| Production secret handling | `infra/daybook:170-176`, `server/index.ts:24-27` | Plist sets `NODE_ENV=production` + persisted `SESSION_SECRET`; server throws rather than use the dev default. |
| Session fixation defence | `server/routes/auth.ts:26-32` | Session regenerated on auth; store errors become 500, never a phantom login. |
| Per-user data isolation | every route | All queries scoped by `user_id`; Phase 5b e2e asserts non-members can't read shared rows. |

### Measured size (drives the §2.2 estimate)

```
server/                      2,905 lines TypeScript
  routes/wallet.ts             1,461      68 .prepare() sites
  routes/groups.ts               382      31
  routes/settlements.ts          299      21
  routes/tasks.ts                 94       6
  routes/auth.ts                 111       4
  (+ health, settings, test, lib, seed, session-store)
                             ─────────────────────────
  total                                   156 .prepare() sites
  db.transaction() blocks                  11 (wallet 6, settlements 3, db 1, seed 1)
e2e/                            51 spec files
server/migrations/               9 files
```

### Two structural constraints

**1. `better-sqlite3` is synchronous.** Every query blocks the event loop of a
single Node process. Fine for a household — it's why the design is simple. But
any CPU-bound work is a whole-app stall, which is why unauthenticated bcrypt
calls are a DoS vector and not merely a brute-force one (§4.3).

**2. SQLite needs a real block device.** It must not live on SMB or NFS —
advisory locking over network filesystems is unreliable, and WAL mode
(`db.ts:69`) is explicitly unsupported there. This disqualifies most "always
free" cloud tiers, which offer only ephemeral or network-attached storage.

---

## 2. The three options

### 2.1 Option 1 — Tailscale Funnel + Caddy

```
Internet → Tailscale relay → tailscaled on Mac (terminates TLS) → :8080 Caddy
                                                                      │
                                          no credential ─────────────┴─► 401
                                          valid credential ────────────► :3001 Daybook
```

Funnel exposes the Mac publicly at `<machine>.<tailnet>.ts.net` with an automatic
Let's Encrypt certificate. Caddy sits in front doing HTTP Basic Auth so
unauthenticated traffic is rejected before it reaches Node.

**Cost: $0/month, $0/year.** Tailscale Personal is free (up to 6 users,
unlimited devices); Funnel is included on the free plan. Caddy is free. **No
domain required.**

**Effort: ~1–1.5 days.**

| Task | Hours |
|---|---|
| Tailscale install + sign in on Mac | 0.25 |
| `tailscale funnel --bg 8080` + verify | 0.25 |
| Caddy install, Caddyfile, `caddy hash-password` | 1 |
| Verify real client IP reaches the app (see risk below) | 0.5 |
| PR 1 hardening — all six blockers | 4–6 |
| PR 2 R2 offsite backups | 2 |
| **Total** | **8–10** |

**No application code changes** beyond the path-independent §4 hardening. The
existing launchd service, `infra/daybook`, SQLite file and release pipeline are
untouched.

**Where it shines:** the fastest route to any-device public access at zero cost,
with no rewrite and no recurring bill. Everything you already built keeps working.

**Risks and gotchas:**

- **Ports 443, 8443, 10000 only**, plus non-configurable bandwidth caps.
- ⚠️ **Client IP may not survive the proxy chain.** Tailscale offers an opt-in
  `--proxy-protocol` flag specifically to preserve source IPs, which strongly
  implies the default does not. Their docs don't state the default. **If Express
  sees `127.0.0.1` for all traffic, IP-keyed rate limiting puts every user in one
  bucket** — an attacker's failures would lock out both real users. Verify
  empirically before trusting §4.3, and key the limiter on username if needed.
- **Two proxies in front of Express** (tailscaled + Caddy) means
  `app.set('trust proxy', 2)`, not `1`. Getting this wrong makes `req.ip` either
  a proxy address or client-spoofable — and it's exactly what the rate limiter keys on.
- **Basic Auth is a static shared secret.** No MFA, no per-user revocation,
  rotation means telling both users, and browsers cache it so aggressively that
  logging out is awkward.
- **Caddy protects the app, not the pipe.** It rejects floods after they've
  crossed your home connection, not before.
- Uptime equals the Mac's uptime.

### 2.2 Option 2 — Cloudflare Pages + Workers + D1

```
Internet → Cloudflare edge → Worker (static assets + /api routes) → D1
```

| Piece | Role | Free tier |
|---|---|---|
| Workers | Replaces the Express API | 100,000 req/day, **10ms CPU per invocation** |
| Static assets | Serves the built SPA from the same Worker | included |
| D1 | Replaces the SQLite file | 5 GB, 5M row-reads/day, 100k row-writes/day |

**Cost: $0/month, $0/year.** A standing free tier, not a trial window. The DB is
1.2 MB against a 5 GB allowance; two users won't approach 100k req/day. Workers
Paid is $5/mo if ever needed. **No domain required** —
`<worker>.<subdomain>.workers.dev` comes free with automatic TLS.

**Single-origin is preserved.** Workers serves static assets and API routes from
one Worker, mapping almost 1:1 onto `server/index.ts:77-85`:

```toml
[assets]
not_found_handling = "single-page-application"
```

Matching paths serve the file directly, everything else falls through to the
script, and `run_worker_first` pins `/api/*`. No CORS layer, no `SameSite=None`
cookies, no split deploy.

**Effort: ~3–5 weeks.**

| Task | Estimate |
|---|---|
| Express → Hono port (7 route files, 2,905 lines) | 4–6 days |
| **156 `.prepare()` sites** converted sync → async | 3–5 days |
| **11 `db.transaction()` blocks redesigned** — see risk below | 3–5 days |
| bcrypt → Web Crypto PBKDF2 + password reset for both accounts | 1 day |
| `express-session` + SQLite store → D1/KV or signed cookies | 1–2 days |
| 9 migrations ported to D1 (SQL is compatible — mostly mechanical) | 0.5 day |
| Data migration: export SQLite → import D1 | 0.5 day |
| e2e suite re-pointed at `wrangler dev`; **51 specs** re-verified | 3–5 days |
| Contingency on the money-path rewrite | 3–5 days |

> ⚠️ **The estimate rose after measuring. D1 does not support interactive
> transactions.** It offers `batch()` for atomic statement sequences, but you
> cannot read, branch on the result, and conditionally write inside one
> transaction. The codebase relies on `db.transaction()` in **11 places —
> 6 in `wallet.ts` and 3 in `settlements.ts`**, which are precisely the
> money-correctness paths: booking a settlement writes two ledger transactions
> *and* updates share rows atomically. Re-expressing that against `batch()` is
> **design work, not mechanical porting**, and it is the highest-risk part of
> this option by a wide margin. This is the single biggest reason Option 2 is
> weeks rather than days.

> ⚠️ **10ms CPU per invocation on the free plan.** bcrypt at cost 10 burns
> ~100ms — 10× the whole budget. The auth rewrite is *forced by the platform*,
> and you'd be tuning KDF iterations down against a CPU ceiling: a real security
> tradeoff, not a free win. Check the Reports aggregates and CSV import against
> that ceiling too.

**Where it shines:** the only option with **no Mac dependency at $0**. Real
uptime, no server to own, no patching, no recurring bill. And because **D1 is
SQLite**, the schema and most query text survive the move — no Postgres dialect
port, no RLS rewrite.

**Other risks:**

- Cloudflare's docs describe `workers.dev` as "intended for personal or hobby
  projects" (which this is).
- `*.workers.dev` is occasionally blocked by corporate DNS filters, since the
  shared domain attracts abuse. Irrelevant on home/mobile networks; fixable later
  with a custom domain without redeploying.
- Every one of the 51 e2e specs must be re-verified against a new runtime. The
  suite is the main evidence that Phase 5b isolation still holds.

### 2.3 Option 3 — Cloudflare Tunnel + domain

```
Internet → Cloudflare edge → [Access: email OTP] → tunnel → :3001 Daybook on Mac
```

`cloudflared` opens an outbound tunnel from the Mac to Cloudflare's edge — no
port forwarding, no inbound firewall rule, origin IP never exposed. Cloudflare
Access enforces an identity check **at the edge**, before traffic reaches your
house.

**Cost: ~$1/month (~$10–15/year).** The only line item is a domain, which is
required: named tunnels route via a DNS record in a zone you own. Quick tunnels
(`trycloudflare.com`) are free but hand out a random URL that changes on every
restart — useless for a persistent app. Cloudflare Tunnel itself is free, and
**Zero Trust Access is free up to 50 users** ($3/user beyond).

**Effort: ~1–1.5 days.**

| Task | Hours |
|---|---|
| Buy domain, add zone to Cloudflare | 0.5 |
| `cloudflared` install, tunnel config, DNS record | 1 |
| Cloudflare Access policy (email OTP for two addresses) | 0.5 |
| PR 1 hardening — all six blockers | 4–6 |
| PR 2 R2 offsite backups | 2 |
| **Total** | **8–10** |

**No application code changes** beyond the §4 hardening.

**Where it shines:** the strongest security posture of the three, and a hostname
you'd be happy to type. Access is a genuine identity gate rather than a shared
password:

| | Option 1 (Caddy Basic Auth) | Option 3 (CF Access) |
|---|---|---|
| Rejects unauthenticated traffic at | your Mac | Cloudflare's edge |
| Protects the app | yes | yes |
| Protects your home bandwidth | **no** | **yes** |
| MFA / email OTP | no | yes |
| Per-user revocation | no | yes |
| Credential model | one shared static secret | per-user identity |

For roughly $12/year this replaces the Caddy layer, the shared password, and the
`trust proxy 2` complexity with a managed gate — and it absorbs floods before
they reach your connection.

**Risks and gotchas:**

- Recurring cost, small but non-zero — the only option that isn't free.
- Two login steps (Access, then Daybook's own login). Mild friction; arguably a
  feature.
- Domain renewal is a thing you must not forget; expiry takes the app offline.
- Uptime still equals the Mac's uptime.

---

## 3. Side-by-side

| | **1. Funnel + Caddy** | **2. Workers + D1** | **3. Tunnel + domain** |
|---|---|---|---|
| **Cost/month** | **$0** | **$0** | ~$1 |
| **Cost/year** | **$0** | **$0** | ~$10–15 |
| **Effort** | **~8–10 h** | **~3–5 weeks** | **~8–10 h** |
| **App code changes** | none | **full server rewrite** | none |
| Domain needed | no | no | **yes** |
| Depends on the Mac | yes | **no** | yes |
| Ongoing ops burden | low | **none** | low |
| Gate before your app | Basic Auth (shared) | app auth only | **Access (per-user, MFA)** |
| Protects home bandwidth | no | **n/a — not hosted at home** | **yes** |
| Rejects floods at | your Mac | Cloudflare edge | **Cloudflare edge** |
| Hostname | `*.ts.net` | `*.workers.dev` | **your own domain** |
| Risk of the migration itself | none | **high — money-path rewrite** | none |

---

## 4. Blockers — apply to all three options

All three are publicly reachable, so **every item below is mandatory**, not
optional. Options 1 and 3 add a gate in front, which reduces exposure but does
not remove the need for these.

### 4.1 Session cookie is hardcoded insecure

`server/index.ts:52` — `secure: false`. Fix is **two coupled changes that must
ship together**:

```ts
app.set('trust proxy', 1)   // Option 3; use 2 for Option 1 (tailscaled + Caddy)
cookie: { secure: process.env.NODE_ENV === 'production', ... }
```

> **Failure mode.** Without `trust proxy`, Express evaluates the tunnel's
> internal HTTP hop, concludes the connection is insecure, and silently **refuses
> to send** a `secure` cookie. Login returns 200, no cookie is stored, every
> subsequent request 401s. The symptom points nowhere near the cause. The same
> setting governs whether 4.3 sees real client IPs.

### 4.2 Signup is open to the world

`server/routes/auth.ts:35` — no gate. On a public URL anyone can register, and
the Phase 5b group-invite flow is **username-based**, so a stranger squatting a
plausible username is an invite-misdirection risk.

Also note `server/routes/auth.ts:50` returns `409 "username already taken"` — a
**user-enumeration oracle**. Disabling signup makes it unreachable, which is
cleaner than trying to make the response ambiguous.

**Fix:** create both accounts, then set `DAYBOOK_ALLOW_SIGNUP=0` permanently.
With two fixed users, signup is never needed again.

### 4.3 No rate limiting anywhere

No throttle on `/api/auth/login`. Two problems:

1. **Brute force** — unlimited guesses, no lockout, 6-char minimum (4.4).
2. **DoS** — `bcrypt.compareSync` at cost 10 blocks the event loop ~100ms.
   Single thread, synchronous driver: a login flood stalls the whole app for
   every user.

`express-rate-limit` on `/api/auth/*` (~10 attempts / 15 min) plus a looser
global limiter. **Depends on 4.1 being correct** — and under Option 1, verify the
client IP actually survives the proxy chain first.

### 4.4 Password minimum is 6 characters

`server/routes/auth.ts:13`. Raise to 10–12. `MAX_PASSWORD = 72` is correct and
must stay — bcrypt silently truncates beyond 72 bytes.

With only two accounts, the highest-value version of this is simply generating
24+ character random passwords in a password manager, which makes online guessing
hopeless regardless of the floor.

### 4.5 No security headers

No `helmet`. Missing HSTS, CSP, `X-Content-Type-Options: nosniff`,
`Referrer-Policy`. CSP needs care: `style-src` will likely need `'unsafe-inline'`
for Recharts — verify against Dashboard and Reports before shipping.

### 4.6 Backups share a disk with the database

`infra/daybook backup` snapshots to `DAYBOOK_HOME/backups/` — the same physical
disk as the DB. **Disk failure, not attackers, is the realistic threat to a
personal ledger.**

**Fix — Cloudflare R2.** Free tier is 10 GB storage with **zero egress fees**;
the DB is 1.2 MB. Nightly `VACUUM INTO` (**never** `cp` — WAL mode means a naive
copy can capture a torn state), encrypt, upload, retain ~30 days.

> R2 pairs with all three options, including the two that keep the Mac. Under
> Option 2 the equivalent is D1's own export/backup, plus R2 if you want a copy
> outside Cloudflare.

### 4.7 Assessed, not blocking

| Item | Assessment |
|---|---|
| **CSRF** | Covered. `sameSite: 'lax'` blocks cookies on cross-site POST, and state-changing routes require `Content-Type: application/json`, which an HTML form can't forge. |
| **`GET /transactions/export`** | A `lax` GET, but it returns the user's own data to themselves. Low risk. |
| **Public repo** | Raises the bar on §4 rather than adding an item. The `SESSION_SECRET` guard makes the published dev default unusable in production. |
| **`express.json({ limit: '5mb' })`** | An unauth memory sink, neutralised by 4.3. |
| **Log rotation** | `server.log` grows unbounded; launchd won't rotate it. A `newsyslog.d` entry fixes it. |
| **Uptime monitoring** | Under Options 1 and 3, a sleeping Mac is indistinguishable from an outage. Worth an external ping check. |
| **CT logs** | Every Let's Encrypt cert is published to public Certificate Transparency logs by design. Bots probe new hostnames within minutes. **An obscure hostname is not a security property** under any option — which is why §4 is mandatory. |

---

## 5. Recommendation

**Option 3 (Cloudflare Tunnel + domain), with Option 1 as the $0 fallback.**

The three-way comparison collapses quickly:

- **Option 2 is disqualified by effort, not by merit.** It is architecturally the
  best destination — free forever, no Mac dependency, no server to own — but the
  D1 interactive-transaction gap turns the settlement and wallet money paths into
  a redesign rather than a port. That is 3–5 weeks of the highest-risk work in the
  codebase, to serve two users. **Revisit it only if Mac uptime becomes the actual
  complaint.**
- **Options 1 and 3 are the same effort** (~8–10 hours, no app rewrite). They
  differ by about $12/year and a meaningful security gap.
- For that $12/year, Option 3 replaces a shared static password with per-user
  email OTP, adds per-user revocation, drops the Caddy layer and the
  `trust proxy 2` complexity, rejects floods at Cloudflare's edge instead of after
  they cross your home connection, and gives you a hostname you'd actually type.

Given the ledger being protected, ~$1/month is the right call — this is squarely
the "really really required" case. **If the answer is a hard $0, take Option 1**;
it is genuinely fine, and the §4 hardening carries over identically.

Either way the app stays on the Mac, unchanged, and Option 2 remains available
later without anything done now being wasted.

---

## 6. Considered and dropped

| Option | Why dropped |
|---|---|
| **Tailscale private tailnet** (`tailscale serve`) | $0, ~1h, and the strongest posture of anything evaluated — no public surface at all, which would have made 4.2 and 4.3 non-gating. **Dropped because it requires a Tailscale client on every device**, and any-device access is a stated requirement. |
| **Fly.io** (~$5–7/mo) | Runs the current codebase unmodified in a datacenter — the zero-rewrite way off the Mac. Dropped on recurring cost; **Option 2 achieves the same independence for $0**, at the price of the rewrite. |
| **Azure / AWS VM** | Neither is free. AWS free accounts now **close after 6 months** or when credits run out; Azure's B1s is free for 12 months then bills (~$10–12/mo). Both clouds' always-free tiers are serverless with network-attached storage, ruled out by §1 constraint 2. You'd also own patching, SSH hardening, firewall and cert renewal on an internet-facing box. Only sensible with employer/MSDN credits. |
| **Render** | Free tier has **no persistent disk** and spins down after 15 min — structurally incompatible with a SQLite file. Paid is ~$13/mo, ~2.5× Fly for identical capability. |
| **Supabase + Vercel** (the CLAUDE.md §14 plan) | ~$25/mo and the largest rewrite of all — full Postgres port, auth replacement, and re-expressing per-user scoping as RLS, then re-proving Phase 5b isolation against it. **Vercel cannot host the current server at all** (no persistent disk for SQLite). Shines only at genuine multi-tenant scale. **Recommend striking from CLAUDE.md §14.** |

---

## 7. Sequencing

PR 1 and PR 2 are **path-independent** — identical under all three options, and
they carry over to Option 2 later. Start them before the path decision.

**PR 1 — `feat/production-hardening`**
- `trust proxy` + env-driven `secure` cookie (4.1)
- `helmet` with a CSP verified against Dashboard/Reports (4.5)
- `express-rate-limit` on `/api/auth/*` + global (4.3)
- `MIN_PASSWORD` → 12 (4.4)
- `DAYBOOK_ALLOW_SIGNUP` flag (4.2)
- CLAUDE.md §4 stack table updated with `helmet` + `express-rate-limit`
  (owner-approved 2026-07-26)
- New spec `52-production-hardening.spec.ts`: 429 after N attempts,
  short-password rejection, signup-disabled path, security headers present

**PR 2 — `feat/offsite-backups`** — highest value, fully unblocked
- `VACUUM INTO` snapshot + encrypted upload to Cloudflare R2 in `infra/daybook`
- Nightly launchd schedule, ~30-day retention
- Documented **restore drill** — an untested backup is not a backup

**PR 3 — access path** (blocked on the §5 decision)
- *Option 3:* `cloudflared` install + tunnel config, DNS, Access policy for two
  addresses, `docs/ci-cd.md` updated. `trust proxy 1`.
- *Option 1:* Tailscale + Funnel, Caddy + Basic Auth, `trust proxy 2`, and the
  client-IP verification from §2.1 **before** trusting the rate limiter.

Cookie behaviour from 4.1 cannot be fully verified until a real TLS terminator is
in front — plan a manual login/refresh/logout smoke test against the final
hostname as the last gate, not the e2e suite.
