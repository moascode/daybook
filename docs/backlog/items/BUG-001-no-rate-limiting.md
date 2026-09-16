> **Status:** Open · **Filed:** 2026-09-16 · **Epic:** — · **Severity:** high

# BUG-001 — No rate limiting on the public URL

**Expected.** A public endpoint on a live money app refuses abusive request rates.

**Actual.** There is none. The only limit anywhere is a per-user hourly cap on
the two AI endpoints (`ai_rate_limit_*` in `settings`), which exists to bound
Anthropic spend, not to protect the app.

**Repro.** Any unauthenticated client can hit
`https://daybook.moascode.workers.dev/api/*` as fast as it likes.

**Why it matters.** This is the oldest open risk on the project and it is
carried in `CLAUDE.md` §8. Two mitigations already reduce the blast radius:
signup is disabled in production, and every route behind `requireAuth` rejects
unauthenticated callers before routing. What remains exposed is login itself —
an unthrottled password-guessing surface — plus the cost of serving arbitrary
traffic.

**Where it would live.** Cloudflare offers this at the edge (WAF rate-limiting
rules, or the Workers Rate Limiting binding) — likely a `wrangler.toml` change
plus a middleware in `worker/index.ts`, not application logic.

**Out of scope.** Per-user quotas for normal use. This is abuse protection.
