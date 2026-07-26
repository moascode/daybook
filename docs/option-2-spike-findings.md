# Option 2 — Phase 0 Spike Findings

> Status: **S1 complete. S2–S4 not yet run.** Measured 2026-07-26/27 against a
> throwaway Worker deployed to `daybook-spike-s1.moascode.workers.dev`, since
> deleted (verified 404). Companion to `docs/option-2-workers-d1-plan.md` §3.

## Summary

**S1 answered its question, and the answer is worse than the plan assumed.**
The free tier's CPU budget caps PBKDF2-HMAC-SHA256 at a hard, deterministic
ceiling between **100,000 and 105,000 iterations** — with no headroom left for
the rest of a login request. OWASP's current recommendation is 600,000.

This does not kill Option 2, but it changes its economics. See
[§5](#5-strategic-implication).

---

## S1 — PBKDF2 CPU budget

### Method

A ~40-line Worker calling `crypto.subtle.deriveBits` with a configurable
iteration count, measured two ways:

1. **Locally** via `wrangler dev` (workerd) — measures *cost*, enforces no limits
2. **Deployed** to `*.workers.dev` on the free plan — measures *enforcement*

Nine to fifteen samples per data point; median reported.

### Local cost curve (this Mac, baseline 1.3ms subtracted)

| Iterations | PBKDF2 cost |
|---|---|
| 10,000 | 0.4 ms |
| 25,000 | 1.3 ms |
| 50,000 | 2.7 ms |
| 100,000 | 5.7 ms |
| 200,000 | 11.7 ms |
| 300,000 | 17.5 ms |
| 600,000 | 34.5 ms |

Linear at ~0.057 ms per 1,000 iterations.

### Production enforcement (deployed, free plan)

| Iterations | Result |
|---|---|
| 0 – 100,000 | ✅ HTTP 200, **15/15** |
| **105,000** | ❌ HTTP 500, **0/15** |
| 110,000 – 5,000,000 | ❌ HTTP 500, 0/9 |

**The cliff is deterministic, not probabilistic** — 100k succeeded every single
time, 105k failed every single time. PBKDF2 is fixed work, so identical input
consumes identical CPU; the limit is a hard ceiling rather than a noisy budget.

### Findings

1. **Web Crypto time counts against the Worker CPU budget.** This was the open
   question local testing could not answer, and it is now settled. Native crypto
   is *not* exempt.
2. **The ceiling sits between 100,000 and 105,000 iterations.**
3. **Failure mode is a hard HTTP 500 with `error code: 1101`, returned fast.**
   Not a slow response, not a degraded one — an over-budget login simply breaks.
   Response times were indistinguishable between success (289 ms) and failure
   (233 ms); both are dominated by network RTT.
4. **Cloudflare's edge CPU is roughly 1.6× slower than this Mac** for this
   workload. Locally 100k cost 5.7 ms; if the enforced limit is the documented
   10 ms and the cliff is at ~102k, the edge runs 100k in ~9.8 ms.
5. **In production `Date.now()` is frozen during synchronous execution**
   (Spectre mitigation) — the Worker's own timing read 0 ms regardless of
   iteration count. Only external measurement is meaningful. Confirms the caveat
   written into the spike.

### Consequence for the real auth route

100,000 iterations consumes ~98% of the budget **doing nothing else**. A real
login additionally performs:

- a D1 lookup for the user row,
- a D1 insert for the session,
- HMAC cookie signing,
- JSON serialisation and Hono routing.

D1 calls are I/O and should not bill as CPU, but parsing their responses does.
**A realistic safe operating point is ~50,000 iterations** — half the budget for
hashing, half for everything else.

**50,000 is 1/12 of OWASP's recommended 600,000.**

### Is 50,000 acceptable?

Conditionally, and the condition is load-bearing.

OWASP calibrates 600k for the scenario where the hash database leaks and an
attacker cracks *human-chosen* passwords offline. At 50k an attacker gets ~12×
more guesses per unit cost.

With **two users and 24+ character password-manager-generated passwords** (~140
bits of entropy), no iteration count is reachable by brute force — the password
entropy dominates entirely. Under that assumption 50k is fine.

Under any other assumption it is not. If either account ever gets a
human-memorable password, this becomes a genuine weakness. **This must be a
documented, enforced precondition in the code, not a hope.**

---

## S2 — D1 batch limits · **NOT RUN**

**Priority raised to critical by S1's result.** If PBKDF2 alone nearly exhausts
the budget, CSV import is a bigger threat than auth: parsing a multi-MB payload
and constructing hundreds of D1 statements is real, unavoidable CPU inside a
single invocation, and `wallet.ts:596` currently does it in one transaction.

Run this before any further commitment to Option 2.

## S3 — Heavy read paths · **NOT RUN**

Reports/Dashboard aggregates and `GET /transactions/export`. Same concern: the
SQL executes in D1, but serialising large result sets is Worker CPU.

## S4 — e2e harness · **NOT RUN**

Can Playwright drive `wrangler dev --local` with a resettable D1, replacing
`DAYBOOK_TEST=1` + `POST /api/test/reset`?

---

## 5. Strategic implication

The case for Option 2 rested on **"$0/month *and* always-on."** Two things have
since changed that footing:

1. **The owner has an always-on Windows 11 machine.** "Always-on" is no longer
   something only the cloud provides — it is available for $0 on hardware already
   owned, with **no rewrite at all**.
2. **The free tier may not comfortably fit this app.** S1 forces either a
   12×-weakened KDF or Workers Paid at $5/mo.

If Option 2 requires $5/mo, its comparative position collapses:

| | Cost/mo | Rewrite |
|---|---|---|
| Option 1 — Funnel + Caddy on the Windows box | $0 | none |
| Option 3 — CF Tunnel + domain on the Windows box | ~$1 | none |
| **Option 2 — Workers + D1, free tier** | **$0** | **11–16 sessions**, KDF at 1/12 OWASP |
| **Option 2 — Workers + D1, Paid** | **$5** | **11–16 sessions**, KDF unconstrained |
| Fly.io (previously dropped on cost) | ~$5–7 | **none** |

At $5/mo, Option 2 costs the same as Fly.io while requiring a full server
rewrite that Fly does not. It would be the most expensive option in effort and
tied-most-expensive in money.

**Option 2 remains justified only on the free tier, and only if 50k iterations
plus enforced strong passwords is acceptable — and only if S2 and S3 also come
back clean.**

---

## 6. Recommendation

**Run S2 before deciding anything.** It is the cheapest remaining way to find out
whether this app fits the free tier at all, and S1 has made it the likeliest
failure point. If CSV import cannot complete within budget, Option 2 is finished
on the free tier and the M4 question answers itself.

If S2 and S3 pass, the decision is a genuine judgement call between a 12×-weaker
KDF at $0 and no rewrite at all on hardware already owned.
