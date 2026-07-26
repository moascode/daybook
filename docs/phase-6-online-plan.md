# Phase 6 Analysis: Making Daybook Available Online

> Status: **Analysed, recommendation made, not yet started.** Written 2026-07-26.
> Recommended path: **Tailscale private tailnet** ([§3.1](#31-a1--tailscale-private-tailnet--recommended)).
> Cloud upgrade path if the Mac dependency ever becomes the complaint:
> **Cloudflare Pages + Workers + D1** ([§3.6](#36--c1--cloudflare-pages--workers--d1)).
> All prices verified against vendor pricing pages on 2026-07-26 — re-check before committing.

## Goal

Reach Daybook from outside the home LAN, over TLS, without handing the open
internet an unauthenticated door into a personal financial ledger.

### Owner constraints (stated 2026-07-26)

- **Two active users.** Not a public product; no growth assumption.
- **Target cost: $0/month.** "A few dollars only if it's really really required."
- These two facts do most of the work in the analysis below. Several options that
  would be sensible for a larger user base are disqualified by them alone.

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

**The gap is not architecture.** The app is a single Node process serving a SPA
and a file-backed DB. That shape already runs correctly; what's missing is a
way to reach it from outside, plus the hardening in §4.

### Two structural constraints that drive everything below

**1. `better-sqlite3` is synchronous.** Every query blocks the event loop of a
single Node process. Fine for a household, and it's why the design is so simple.
But it means no horizontal scaling, and any CPU-bound work is a whole-app stall
— which is why unauthenticated bcrypt calls are a DoS vector and not merely a
brute-force one (§4.3).

**2. SQLite needs a real block device.** It must not live on SMB or NFS —
advisory file locking over network filesystems is unreliable and is a documented
corruption risk, and WAL mode (`db.ts:69`) is explicitly unsupported there. This
single fact disqualifies most "always free" cloud tiers, which offer only
ephemeral storage or network file shares. See §3.5.

---

## 2. Option comparison

| | Cost/mo | Setup | Code change | Ongoing ops | Public surface | Depends on Mac |
|---|---|---|---|---|---|---|
| **A1 Tailscale private** ⭐ | **$0** | ~1h | none | none | **none** | yes |
| **A2 Tailscale Funnel** | $0 | ~1h | none | low | yes | yes |
| **A3 CF Tunnel + domain** | ~$1 | ~2h | none | low | yes, Access-gated | yes |
| **B1 Fly.io** | ~$5–7 | ~1wk | packaging only | low | yes | no |
| **B2 Azure B1s / AWS Lightsail** | $0→$10–12 | ~1wk | packaging only | **high — you own a VM** | yes | no |
| **C1 CF Pages + Workers + D1** | **$0** | ~2–4wk | **rewrite**, SQL survives | none | yes | no |
| **C2 Supabase + Vercel** | ~$25 | ~4–6wk | **rewrite**, incl. all SQL | none | yes | no |

### The question that actually decides it

Not price — the spread between $0 and $7 is not a real consideration. It is:

> **Can every user install software on their devices?**

- Two users, known devices → **A1**, and the decision is over.
- Ever "someone wants to check something from a device I don't control" → **A2** or **A3**.
- Mac uptime becomes the actual complaint → **B1** (no rewrite) or **C1** (no cost).

---

## 3. Where each option shines

### 3.1 A1 — Tailscale private tailnet ⭐ RECOMMENDED

Free Personal plan: **up to 6 users, unlimited devices**. Install Tailscale on
the Mac and on each user's devices. The app becomes reachable from anywhere over
an encrypted WireGuard link, with **no public internet exposure at all**.

**Where it shines:** small, known, trusted user sets. Its superpower is that it
*deletes* threat surface rather than defending it. Every other option makes the
auth code internet-facing and then asks you to harden it; this one makes the
question moot. Best security-per-hour on the list.

- $0 permanently — not a trial, not a tier outgrown at 3 users.
- **Real HTTPS.** `tailscale serve` provisions a genuine Let's Encrypt cert on
  `<machine>.<tailnet>.ts.net`, retiring blocker 4.1 with a real certificate.
- **It shrinks §4 by roughly half.** Blockers 4.2 (open signup) and 4.3 (rate
  limiting) exist because a public URL exposes `/api/auth/*` to everyone. On a
  private tailnet nobody can reach it. They drop from "must fix before exposure"
  to ordinary hygiene.
- Nothing about the current setup changes — launchd, `infra/daybook`, SQLite and
  the release pipeline are untouched.

**Honest tradeoff:** it is not a URL that works on an arbitrary device. No
Tailscale client, no access. For two known people that's a five-minute setup
each and then invisible; for "send my mother-in-law a link" it is the wrong tool.

### 3.2 A2 — Tailscale Funnel

Same free plan, same Mac. Exposes a port publicly at `<machine>.<tailnet>.ts.net`
with automatic TLS.

**Where it shines:** the only $0 way to get a real public HTTPS URL with a valid
certificate and no domain purchase. Use when someone needs access from a device
you cannot install software on.

Constraints: ports 443/8443/10000 only, non-configurable bandwidth caps, DNS can
take ~10 minutes to propagate. And you are genuinely public, so **all of §4
becomes mandatory again**.

### 3.3 A3 — Cloudflare Tunnel + domain

**Where it shines:** a hostname you'd be happy to type, plus Cloudflare Access as
a managed identity gate you don't have to write. Best fit if the user count grows
past "people who'll install a VPN client" but the app stays on your hardware.

**Cost note that matters:** named Cloudflare Tunnels require a zone in your
Cloudflare account, so this needs a domain — roughly $10–12/year, about $1/month.
Quick tunnels (`trycloudflare.com`) are free but hand out a random URL that
changes on every restart, which is useless for a persistent app. This is the only
line item standing between this option and free.

### 3.4 B1 — Fly.io

~$4–6/mo (shared-cpu-1x 512 MB ≈ $3–4, 1 GB volume $0.15, snapshots free under
10 GB, egress ~$0.05). Budget ~$6–7 for Singapore, which carries a regional
markup over the Amsterdam list prices. **No free allowance for new accounts.**

**Where it shines — and nothing else here shares this:** your exact current
codebase, unmodified, running in a datacenter. Same Express, same
`better-sqlite3`, same SQLite file, same passing e2e suite. The lowest-risk way
to stop depending on the Mac.

*Build tip:* base the image on `node:22-slim`, **not** Alpine. `better-sqlite3`
compiles a native binding and musl is where that build reliably eats a day.

*Render is not a viable alternative here:* its free tier has no persistent disk
and spins down after 15 minutes of inactivity — structurally incompatible with a
SQLite file. Paid works out to ~$13/mo plus $0.25/GB/mo disk, roughly 2.5× Fly
for identical capability.

### 3.5 B2 — Azure / AWS VM

**Neither is free, and the free parts can't run this app.**

- **AWS** replaced the old 12-month tier with credits: $100 on signup plus up to
  $100 more, and the free account **closes 6 months after opening or when credits
  run out, whichever comes first**. A hard stop with a deadline.
- **Azure** is the better of the two: $200 credit for 30 days, plus a B1s VM free
  for **750 hours/month for 12 months** (a month is ~744 hours, so that covers
  one always-on small VM for a year). Then it bills.

Both clouds' genuinely-forever-free tiers are serverless (Lambda, Azure
Functions, Container Apps, App Service F1) with ephemeral or network-attached
storage — ruled out by constraint 2 in §1. Running Daybook requires a VM with a
real block device, which is the paid path on both.

Post-free: Azure B1s + disk + egress ≈ $10–12/mo; AWS Lightsail ≈ $5–7; EC2
t4g.small + EBS ≈ $12. At best you match Fly's price after a year of work.

**Where it shines:** employer/MSDN credits (Visual Studio subscriptions include a
recurring monthly Azure credit, which would make this genuinely free), or if
hands-on Azure/AWS experience has career value. Those are real reasons. Cost is
not one. Otherwise strictly dominated — and a VM means you own OS patching, SSH
hardening, firewall rules, cert renewal and monitoring on an internet-facing box
holding a financial ledger, for as long as the app exists.

### 3.6 C1 — Cloudflare Pages + Workers + D1

| Piece | Role | Free tier |
|---|---|---|
| Pages | Serves the `dist/` SPA | Free, generous bandwidth |
| Workers | Replaces the Express API | 100,000 req/day, **10ms CPU per invocation** |
| D1 | Replaces the SQLite file | 5 GB storage, 5M row-reads/day, 100k row-writes/day |

**$0/month, plausibly forever** — a standing free tier, not a trial window. The
DB is 1.2 MB against 5 GB; two users won't approach 100k req/day. Workers Paid is
$5/mo if ever needed.

> **No domain required** — unlike A3. You get `<worker>.<your-subdomain>.workers.dev`
> (or `<project>.pages.dev`) free, with TLS terminated automatically. The
> asymmetry: a *named tunnel* (A3) routes Cloudflare's edge to **your** origin via
> a DNS record in a zone you own, so it needs a purchased domain. C1 is hosted
> **on** Cloudflare, so Cloudflare supplies the hostname. C1 is therefore $0 end
> to end, with no line item at all.
>
> Two caveats on the free hostname: Cloudflare's docs describe `workers.dev` as
> "intended for personal or hobby projects" (which this is), and `*.workers.dev`
> is occasionally blocked by corporate DNS filters since the shared domain
> attracts abuse — irrelevant on home/mobile networks, and fixable later with a
> custom domain without redeploying.

**Single-origin is preserved.** Workers supports static assets in the same Worker
as the API, which maps almost 1:1 onto `server/index.ts:77-85`:

```toml
[assets]
not_found_handling = "single-page-application"
```

Matching paths serve the static file directly; everything else falls through to
the Worker script, and `run_worker_first` pins `/api/*`. That replaces
`express.static(DIST_DIR)` + the SPA fallback + `/api` routing. The SPA and API
stay on **one origin** exactly as today — no CORS layer, no `SameSite=None`
cross-site cookies, no split deploy. The migration is a port, not a
re-architecture.

**Where it shines:** free-forever cloud with no server to own. Its superpower is
that **D1 is SQLite** — the migrations and the intricate Phase 5b
split/settlement SQL port essentially verbatim. No dialect translation, no type
remapping, no re-expressing per-user scoping as RLS. That is the expensive and
dangerous part of a cloud migration, skipped. **If the app ever leaves the Mac
permanently, this is the destination.**

**What still has to be rewritten** (smaller than C2, but not small):

1. **Express → Hono.** Express doesn't run on Workers; the middleware stack is rebuilt.
2. **Every query sync → async.** `db.prepare().get()` → `await db.prepare().first()`.
   Mechanical, but woven through every route and `server/lib.ts`.
3. **bcrypt cannot come along** — it is a native C++ addon that does not exist on
   Workers. Move to PBKDF2 via Web Crypto; existing hashes are bcrypt, so the two
   accounts need password resets (trivial at this scale, but auth-critical).
4. **Sessions.** `express-session` + the SQLite store → D1/KV or signed cookies.
5. **Re-verify 50+ e2e specs** against the new runtime.

> **Sharp edge: 10ms CPU per invocation on the free plan.** bcrypt at cost 10
> burns ~100ms of pure CPU — 10× the entire budget. So the auth rewrite is forced
> by the platform, and you'd be tuning KDF iterations down against a CPU ceiling:
> a real security tradeoff, not a free win. Check the Reports aggregates and CSV
> import against that ceiling too.

### 3.7 C2 — Supabase + Vercel (the CLAUDE.md §14 plan)

~$25/mo realistic. Supabase Free is $0 but **pauses projects after 1 week of
inactivity** — precisely the wrong failure mode for a ledger you check
occasionally, so Pro ($25) is the honest number. Vercel Hobby is $0 and a private
household app fits its personal/non-commercial terms.

**Vercel cannot host the current server at all** — serverless has no persistent
filesystem, so there is nowhere for the SQLite file to live. Supabase is not an
optional add-on in this plan; it is forced by the hosting choice. The migration
means porting 8 migrations to Postgres DDL, rewriting every route to async
Postgres, replacing auth, and re-expressing all per-user scoping as RLS policies
— then re-proving the Phase 5b isolation guarantees against them. That is exactly
the code where an error either loses money or leaks one household member's ledger
to another, and it is currently proven by 50+ passing specs.

**Where it shines:** genuine multi-tenancy, managed Postgres with point-in-time
recovery, and third-party auth (Google sign-in, magic links) you'd otherwise
hand-roll. A different size of problem than this one.

**Recommendation: strike C2 from the roadmap** unless requirements change to need
real multi-tenant cloud scale. If the app must leave the Mac, C1 is free and
keeps the SQL.

---

## 4. Blockers — the hardening work

Scope depends on the chosen path. Under **A1 (private tailnet)** blockers 4.2 and
4.3 are largely neutralised, because the auth endpoints are not internet-facing.
Under every public option (A2, A3, B1, B2, C1, C2) **all six apply**.

### 4.1 Session cookie is hardcoded insecure

`server/index.ts:52` — `secure: false`, commented *"home network is HTTP; revisit
when TLS lands"*. TLS is now landing. Fix is **two coupled changes that must ship
together**:

```ts
app.set('trust proxy', 1)          // NEW — required
// ...
cookie: { secure: process.env.NODE_ENV === 'production', ... }
```

> **Failure mode to watch for.** Without `trust proxy`, Express evaluates the
> tunnel's internal HTTP hop, concludes the connection is insecure, and silently
> **refuses to send** a `secure` cookie. Login returns 200, no cookie is stored,
> every subsequent request 401s. This is the most common way this migration
> breaks, and the symptom points nowhere near the cause. The same flag governs
> whether rate limiting (4.3) sees real client IPs or just the tunnel's.

### 4.2 Signup is open to the world

`server/routes/auth.ts:35` — `POST /api/auth/signup` has no gate. On a public URL
anyone can register. Their data is isolated, but they become a real username in
the instance namespace, and the Phase 5b group-invite flow is **username-based**
— a stranger squatting a plausible username is an invite-misdirection risk.

Add a `DAYBOOK_ALLOW_SIGNUP` env flag (~5 lines) regardless of path: it is cheap
and survives a future change of front door.

### 4.3 No rate limiting anywhere

No throttle on `/api/auth/login`. Two distinct problems:

1. **Brute force** — unlimited guesses, no lockout, 6-char minimum (4.4).
2. **DoS** — `bcrypt.compareSync` at cost 10 blocks the event loop ~100ms. Single
   thread, synchronous driver: a login flood stalls *the whole app for every
   user*. The §1 constraint turning into a security property.

`express-rate-limit` on `/api/auth/*` (~10 attempts / 15 min / IP) plus a looser
global limiter. Depends on `trust proxy` from 4.1.

### 4.4 Password minimum is 6 characters

`server/routes/auth.ts:13`. Fine on a LAN, not on the internet. Raise to 10–12.
`MAX_PASSWORD = 72` is correct and must stay — bcrypt silently truncates beyond
72 bytes. Existing accounts are unaffected; only new passwords are validated.

### 4.5 No security headers

`helmet` not installed, no headers set manually. Missing HSTS, CSP,
`X-Content-Type-Options: nosniff`, `Referrer-Policy`.

CSP needs care: `style-src` will likely need `'unsafe-inline'` for Recharts.
Verify against Dashboard and Reports before shipping — a CSP that silently breaks
charts in production is worse than a slightly loose one.

### 4.6 Backups share a disk with the database

`infra/daybook backup` snapshots to `DAYBOOK_HOME/backups/` — the same physical
disk as `shared/data/daybook.db`. **Path-independent: this is worth fixing under
every option, including A1.**

Disk failure, not attackers, is the realistic threat to a personal ledger. This
is the item least likely to be exploited and most likely to actually cost
something.

**Solution — Cloudflare R2.** Free tier is **10 GB storage with zero egress
fees**; the DB is 1.2 MB. Nightly `VACUUM INTO` (**never** `cp` — WAL mode means
a naive copy can capture a torn state), encrypt, upload, retain ~30 days.

> R2 is not a hosting option and does not compete with §3. It is a **component
> that pairs with all seven paths**, including the ones that keep the Mac.

---

## 5. Assessed and deliberately not blocking

| Item | Assessment |
|---|---|
| **CSRF** | Adequately covered. `sameSite: 'lax'` blocks cookies on cross-site POST, and every state-changing route requires `Content-Type: application/json`, which an HTML form cannot forge. No token layer needed. |
| **`GET /transactions/export`** (`server/routes/wallet.ts:486`) | A state-changing GET would be a `lax` bypass, but this is a read returning the user's own data to themselves. Low risk. |
| **Public repo** | Not a vulnerability — it raises the bar on §4 rather than adding an item. The `SESSION_SECRET` guard makes the published dev default unusable in production. |
| **`express.json({ limit: '5mb' })`** (`server/index.ts:41`) | An unauth memory sink, neutralised by 4.3's rate limiting. No separate fix. |
| **Log rotation** | `server.log` grows unbounded; launchd won't rotate it. Operational annoyance. A `newsyslog.d` entry fixes it. |
| **Uptime monitoring** | Under any Mac-hosted path, a sleeping Mac is indistinguishable from an outage. Worth an external ping check before household members depend on it. |

---

## 6. Decisions

**Locked (owner, 2026-07-26):**

- **New dependencies approved: `helmet` + `express-rate-limit`.** Both must be
  added to the approved-stack table in CLAUDE.md §4 by the implementing PR
  (Rule 2).

**Superseded:**

- *"Cloudflare Access in front"* was locked before the $0 constraint and the
  Tailscale option were on the table. Access requires a named Cloudflare Tunnel,
  which requires a purchased domain (~$1/mo) — so it is no longer free. More
  importantly, under the recommended A1 it is **unnecessary**: its job was gating
  a public front door that A1 does not create. Retain this decision only if the
  chosen path is A3.

**Open:** final path confirmation. Recommendation is **A1**.

---

## 7. Sequencing

PR 1 and PR 2 are **path-independent** and carry over unchanged to every
destination in §3 — starting them costs nothing regardless of the final choice.

**PR 1 — `feat/production-hardening`**
- `trust proxy` + env-driven `secure` cookie (4.1)
- `helmet` with a CSP verified against Dashboard/Reports (4.5)
- `express-rate-limit` on `/api/auth/*` + global (4.3)
- `MIN_PASSWORD` → 10 (4.4)
- `DAYBOOK_ALLOW_SIGNUP` flag (4.2)
- CLAUDE.md §4 stack table updated with the two new packages
- New spec `52-production-hardening.spec.ts`: 429 after N attempts,
  short-password rejection, signup-disabled path, security headers present

> Under A1, items 4.2/4.3 are defence-in-depth rather than gating, so this PR can
> be scoped down to roughly half if the tailnet lands first.

**PR 2 — `feat/offsite-backups`** (highest value, fully unblocked)
- `VACUUM INTO` snapshot + encrypted upload to **Cloudflare R2** in `infra/daybook`
- Nightly launchd schedule, ~30-day retention
- Documented **restore drill** — an untested backup is not a backup

**PR 3 — access path**
- **A1:** `tailscale serve` config on the Mac, clients enrolled, `docs/ci-cd.md`
  updated. No application change.
- A2/A3/B1/C1: see the corresponding §3 entry for scope.

Cookie behaviour from 4.1 cannot be fully verified until a real TLS terminator is
in front — plan a manual login/refresh/logout smoke test against the final
hostname as the last gate, not the e2e suite.

---

## 8. Migration ladder

Nothing here is a dead end; the options compose:

```
A1 Tailscale ($0, ~1h)  ──►  + R2 backups ($0)  ──►  outgrown?
                                                       ├─► B1 Fly  ($5-7, zero rewrite)
                                                       └─► C1 Workers+D1 ($0, rewrite, SQL survives)
```

PR 1 and PR 2 apply to every rung. Starting at the free hour forfeits nothing.
