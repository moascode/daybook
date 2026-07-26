# Option 2 — Phase 0 Spike Findings

> Status: **S1 and S2 complete. S3–S4 not yet run.** Measured 2026-07-26/27
> against throwaway Workers and a real D1 database on the owner's account, all
> since deleted (verified 404 / empty `d1 list`). Companion to
> `docs/option-2-workers-d1-plan.md` §3.

## Summary

| Spike | Question | Verdict |
|---|---|---|
| **S1** | Does PBKDF2 fit the free CPU budget? | ⚠️ **Constrained** — hard cliff at ~100k iterations vs OWASP's 600k |
| **S2** | Does a realistic CSV import fit? | ✅ **Passes** — 5,000 rows in one batch, ~10× real-world headroom |
| S3 | Heavy read paths | not run |
| S4 | e2e harness | not run |

**S1 was worse than the plan assumed; S2 was better.** The free tier caps
PBKDF2-HMAC-SHA256 at a deterministic ceiling between **100,000 and 105,000
iterations** with nothing left over for the rest of a login — against OWASP's
recommended 600,000. But the import path, which S1 made me expect to fail,
handled 5,000 rows in a single `batch()` with room to spare.

**The most consequential finding is not a limit at all.** S2 surfaced an N+1
query pattern in the import route that is free under `better-sqlite3` and
expensive under D1 — 2–3 network round trips *per row*. It is a contained,
well-understood fix, but it is real work not currently in the plan's estimate.
See [S2's caveat](#-the-real-problem-s2-uncovered--and-did-not-test).

Neither result kills Option 2. Together they change its economics — see
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

## S2 — CSV import through D1 `batch()` · **PASSES, with a caveat**

### Method

A Worker mirroring `POST /api/transactions/import` (`wallet.ts:572-599`): parse a
JSON array body, validate every row, build one prepared statement per row, insert
them all through a single `env.DB.batch()`, and return the created rows
(`RETURNING *`, as the real route does). Backed by a real D1 database in APAC,
seeded with a mirror of the production `transactions` schema.

Payloads were realistic Malaysian statement rows (merchant, description, amount,
tags, SHA-256 import hash) from 50 to 5,000 rows — 14 KB to 1.3 MB.

### Result

| Rows | Payload | Result |
|---|---|---|
| 200 | 54 KB | ✅ 5/5 |
| 500 | 136 KB | ✅ 5/5 |
| 1,000 | 272 KB | ✅ 5/5 |
| 2,000 | 546 KB | ✅ 5/5 |
| **5,000** | **1.3 MB** | ✅ **5/5** (~1.4 s) |

**51,850 rows verified present in D1 afterwards** — the batches genuinely
executed, no silent no-op.

**A realistic bank statement is 50–500 rows. 5,000 in a single batch and a single
invocation leaves roughly 10× headroom.** The insert path is not a constraint.

### Notes

1. **One transient failure.** The first 500-row attempt returned `error code:
   1104`, and was not reproducible — 5/5 on re-run, while 5,000 rows succeeded in
   the same sweep. A platform-side blip, not a limit. Worth knowing the platform
   occasionally 500s, so the import path needs a retry story regardless.
2. **Free-tier write quota is real.** This spike consumed ~52,000 of D1's
   **100,000 writes/day**. Not a concern for two users at normal volume, but a
   heavy import session could plausibly approach it.
3. **Why this passed when S1 failed is not fully explained.** Parsing 1.3 MB of
   JSON and building 5,000 statements is not obviously cheaper than 105,000
   PBKDF2 iterations. The likeliest explanation is that CPU accounting treats an
   I/O-interleaved request differently from a single synchronous burn — but I did
   not establish that, and this writeup should not pretend otherwise. The
   empirical result stands on its own.

### ⚠️ The real problem S2 uncovered — and did not test

The spike modelled the *insert*. The production route does something worse
**before** it inserts (`wallet.ts:583-595`):

```js
for (let i = 0; i < items.length; i++) {
  if (!canWriteAccount(db, userId, accountId))            // → DB query
  if (!ownsAllRefs(db, userId, [['categories', ...]]))    // → DB query
  if (b.destinationAccountId && !canWriteAccount(...))    // → DB query
}
```

`ownsAllRefs` → `userOwns` (`lib.ts:86-89`) runs
`SELECT 1 FROM <table> WHERE id = ? AND user_id = ?` **per call**. So the route
issues **2–3 database queries per row.**

Under `better-sqlite3` these are in-process and effectively free — which is why
the code is written this way and why it has never been a problem. **Under D1 each
one is a network round trip.** A 500-row import becomes **1,000–1,500 sequential
awaited queries**; a 5,000-row import, 10,000–15,000.

**This must be hoisted before the import route can work on D1**: one query for
all writable account IDs, one for owned category IDs, then check in memory
against a `Set`. That is a bounded, well-understood refactor — and the codebase
already uses exactly this pattern elsewhere (`wallet.ts:1061-1065`), so it is
consistent with the existing style rather than a foreign idiom.

### The generalisable lesson

**The synchronous driver made N+1 queries free; D1 makes them expensive.** An
audit of loops across the route files found the import route to be the clear
offender — most other loops already build a single batched query with
placeholders (e.g. `wallet.ts:556` chunks hash lookups 500 at a time). So this is
a contained fix, not a systemic rewrite. But every `.prepare()` inside a loop
needs review during the port, and that review is not captured in the §5 effort
estimate of `docs/option-2-workers-d1-plan.md`.

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

**Option 2 is technically viable on the free tier.** Two of the four spikes are
done and neither found a blocker. What remains is a judgement call, not a
feasibility question:

**The case for continuing.** The app fits. Imports work with 10× headroom. The
KDF constraint is real but neutralised by two users with password-manager
passwords. It is $0/month, forever, always-on, with no machine to maintain.

**The case against.** The always-on Windows box makes Options 1 and 3 achievable
for $0–1/month with **no rewrite at all**. Option 2 costs 11–16 sessions plus the
N+1 refactor S2 uncovered, and ships a KDF at 1/12 of the recommended strength,
to reach a place those options already reach. Its distinctive advantage —
independence from home hardware — was worth a great deal before that machine
existed and is worth much less now.

**Suggested next step: run S4 before S3.** S3 (heavy reads) is now low-risk —
S2 demonstrated that I/O-interleaved work has ample headroom, and the Reports
aggregates execute inside D1 rather than in the Worker. **S4 is the real
remaining unknown**, and it is the largest single line in the effort estimate:
if Playwright cannot drive `wrangler dev --local` with a resettable D1, the
51-spec suite becomes the most expensive part of the migration by a wide margin,
and that suite is the only evidence that Phase 5b's isolation guarantees survived
the port.

If S4 comes back clean, Option 2 is fully de-risked and the decision is purely
about whether the rewrite is worth it.
