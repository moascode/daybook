# Machine ingestion & token auth — analysis

**Status:** analysis. **Nothing here is approved to build.**
CLAUDE.md §2 rule 10 (phase discipline) and `docs/v2/cross-cutting/ai-usage.md`
rule 2 (warn before wiring) both apply.

**Date:** 2026-09-06
**Supersedes the scope of** [`docs/apple-wallet-capture-plan.md`](../apple-wallet-capture-plan.md)
(PR #123, 2026-08-11), which is still accurate about Apple but was written
against a codebase four weeks and ~50 commits behind this one.

**Question this answers.** Apple Wallet was only ever one client. The two things
it actually needs — *a way for a non-browser client to add a transaction*, and
*a way for that client to authenticate* — are generic. Any service wants them:
an iOS shortcut, a bank-alert email worker, a cron job, **or Claude**. This doc
analyses those two as first-class features and asks what they cost the review
and AI machinery that has been built since.

---

## 1. TL;DR

1. **The hardest problem in PR #123 is now solved.** §8 of that doc called
   CSV↔capture double-counting "unsolved, and the real risk" and proposed a
   fuzzy amount+date match. Cross-source duplicate detection shipped on
   2026-09-06 instead: a server-computed `duplicate_key`
   (`date|amountCents|type|canonicalMerchant`) written by the single insert path
   `insertTransactionStmt` (`worker/routes/wallet.ts:486`), matched by
   `POST /transactions/check-duplicates` (`worker/routes/wallet.ts:877`). **Any
   new write source inherits it for free.** §5 below covers the two gaps that
   remain, both narrower than what PR #123 faced.
2. **"A flag to not use AI" is not a design choice — it is the only compliant
   behaviour.** `ai-usage.md` guardrail 2 forbids a call that fires on anything
   but an explicit human action, and A5's retroactive approval on 2026-09-06
   exists precisely because an automatic AI pass on import had slipped in
   against that rule. An inbound API write is *never* a human action. Ingestion
   must be rules-only; AI must be a button on the review surface. §3.
3. **That button already exists, twice.** A4 ("Ask AI to suggest" categories)
   and A5 ("Ask AI to clean up" merchant names) are exactly the on-demand shape
   the request describes, already built in `CsvReviewTable.tsx`, already
   rate-limited per bucket, already key-gated. The work is not building AI-on-
   demand; it is making the review surface reachable from a third source. §4.
4. **There is one real architectural gap in the way**: the composer's rules
   parser is **client-side only** (`src/modules/wallet/composer/parseComposerInput.ts`)
   while its AI fallback is server-side (`POST /transactions/parse-composer-ai`,
   `worker/routes/wallet.ts:1358`). A headless caller posting free text can
   therefore reach the *AI* path but not the *rules* path — the exact inversion
   of guardrail 1. Any text-accepting API endpoint must port the rules parser
   into the Worker first. §6.
5. **Tokens: PR #123's Option C still stands, but "I may also use it from
   Claude" changes its shape.** A capture-only write token has a trivial blast
   radius. An agent token that can *read* balances, transactions and tasks does
   not, and it is being handed to a system that consumes untrusted text. Scopes
   stop being a forward-compat placeholder and become the feature. §7–§8.
6. **The unifying rule that falls out of both halves: a non-human writer never
   writes to the ledger.** Shortcut, email worker, and Claude alike land in a
   pending inbox a human accepts. That single rule answers the declined-payment
   problem, the AI-hallucination problem, and the prompt-injection problem at
   once. §4.1.

---

## 2. What changed under PR #123 (2026-08-11 → 2026-09-06)

Everything in this table postdates that doc and changes at least one of its
conclusions.

| Shipped | Where | Effect on the capture plan |
|---|---|---|
| **Cross-source duplicate detection** — `duplicate_key` + 3-layer check | `worker/migrations/0017_duplicate_key.sql`, `worker/lib/merchant.ts`, `docs/v2/wallet/duplicate-detection.md` | Retires most of PR #123 §8 and its whole "wave 5". A capture row inserted through the normal path is deduped against the bank CSV automatically. |
| **Photo import (P2)** — image → AI extraction → the CSV review table | `POST /transactions/import-photo` (`wallet.ts:1452`), `import/ImportModal.tsx` | Proves the review table takes a **second** source. Establishes per-source rate-limit buckets and the always-200 `{rows, failureReason}` shape. |
| **Wallet composer (R7/A1)** — free text → rules → Haiku fallback → preview | `composer/`, `POST /transactions/parse-composer-ai` | PR #123 §10.3's "manual quick-add shortcut, good first slice" now has a UI twin. Also exposes the rules/AI split described in §6 below. |
| **A4 + A5 explicit-AI split** | `CsvReviewTable.tsx`, `ai-usage.md` §2.1 | The governing precedent for §3: automatic AI on import was found to violate rule 3 and was demoted to a button. |
| **The AI register itself** | `docs/v2/cross-cutting/ai-usage.md` (2026-08-21) | Haiku-only, warn-before-wiring, rules-first. Did not exist when PR #123 was written; PR #123's §6.3 advice ("do not reach for the AI path") happens to already comply. |
| **v2 shell, `/day`, unified `ImportModal`** | R2/R6/R7 | Gives an inbox a natural home (`/day` is a merged timeline; a badge already exists as a pattern in `PendingClaimsBadge.tsx`). |

Unchanged and still correct in PR #123: everything about **Apple** (§2–§4,
§9–§10) — no webhook, device-local trigger, fires on declines, empty merchant,
`0.0` amounts, and the on-device probe gate. None of that is verifiable from
here and none of it has been probed yet.

---

## 3. AI at ingestion time: the answer is no, and it is not a flag

The request asks for "a flag to not use AI, or use AI on demand later when
reviewing". The register already forces the stronger version of that.

`ai-usage.md` §3 guardrail 2: *"A call fires on submit or on a button, never on
keystroke, focus, page load, or a poll."* An inbound `POST` from a shortcut, an
email worker or an agent is a poll-class event — nobody is watching it. Adding a
`useAI: true` option to an ingestion endpoint would let any caller spend the
owner's Anthropic key from a phone in a car park, unattended, at whatever rate
the caller likes.

So there is no flag on the write path. The shape is:

```
ingest (rules only, free, deterministic)   →   pending row   →   human opens review   →   explicit AI button
```

**What "rules only" gets you at ingest, at zero cost**, all of it already built:

| Step | Reuse | Cost |
|---|---|---|
| Merchant cleanup | `POST /merchants/resolve` with `useAI` omitted (`wallet.ts:3372`) → `resolveMerchantLadder(..., { useAI: false })` — Stage 1 regex + Stage 2 `merchant_corrections` cache + Stage 3 own history. This is exactly what `ImportModal.tsx` now does after A5. | free |
| Category | `POST /transactions/suggest-categories` (`wallet.ts:1020`) — history majority + builtin cold-start map. Note this is a *different route* from the `-ai` one; it never touches the key. | free |
| Account | card-name → account map, falling back to `default_account_id` | free |
| Duplicate check | `buildDuplicateKey` at insert; `check-duplicates` at review | free |

**What the AI buttons on the review surface then add**, unchanged from today:
A4 for rows the category rules missed, A5 for merchant names the ladder could
not improve. Same chunking, same buckets (`ai_rate_limit_suggest_categories`,
`ai_rate_limit_merchant`), same "no key → button hidden" gating.

**Register consequence.** A rules-only ingestion endpoint needs **no new entry**
in `ai-usage.md` §2 — it spends nothing. It should still be *listed* under §2.3
RULES-ONLY, for the same reason the insight cards are: so nobody later "improves"
it into an API call without hitting rule 2.

---

## 4. Where an API-written transaction lands

### 4.1 Inbox, not ledger — and now for three independent reasons

PR #123 argued this from Apple's defects alone (declined payments, `0.0`
amounts, blank merchants). Two more reasons have since appeared, and together
they generalise past Apple entirely:

1. **Untrusted signal** (Apple's flakiness) — PR #123 §3.2.
2. **Untrusted extraction** — anything AI-derived upstream (a receipt photo, an
   agent parsing a message) can be confidently wrong. Photo import already
   refuses to write silently and lands in review; an API source has strictly
   less oversight than a user who just took the photo.
3. **Untrusted instruction** — an agent client reads text written by other
   people. A transaction it was talked into creating must be visible and
   reversible before it touches a balance. §8.3.

A ledger row is not cheap to be wrong about here: it moves account balances,
dashboard tiles, budget spend, safe-to-spend, reports, and — if the account is
shared — can be split and settled against by another user before anyone notices.

**Rule: a non-human writer never writes to `transactions`. It writes a pending
row; a human accepts it through the existing insert path.** One write path into
the ledger stays one write path (`insertTransactionStmt`), which is also what
keeps `duplicate_key` universal.

### 4.2 The cost nobody has priced: the review surface is not source-agnostic yet

Today's review flow is **ephemeral and client-side**: `ImportModal` parses,
hands rows to `/wallet/import` through **router `location.state`**
(`CsvImport.tsx:39`), and `CsvReviewTable` renders them. Nothing is persisted
until Confirm. Both current sources (CSV, photo) are *in the same browser tab,
in the same second, started by the same click*.

An API source breaks all three assumptions: the rows arrive hours earlier, from
another device, with nobody watching. That needs server-side pending rows and a
review surface that loads them — not `location.state`.

This is the honest bulk of the work, and it is bigger than it was in August
because `CsvReviewTable.tsx` has grown to ~20KB carrying the account badge
dropdown, the possible-duplicate hints, and both AI buttons. Two options:

- **(a) Generalise `CsvReviewTable` into a source-agnostic review queue** fed by
  either an in-memory batch (CSV/photo, unchanged) or a fetched set of pending
  rows. Three customers is the point at which generalising is justified rather
  than speculative, and it means the AI buttons, the duplicate hints and the
  account control are inherited, not re-implemented.
- **(b) A separate inbox UI.** Faster to a first version, but it will
  immediately want A4, A5, duplicate hints and inline edit — i.e. it converges
  on (a) having paid twice.

**(a) is the recommendation**, and it should be scoped as its own slice *before*
any ingestion endpoint ships, not discovered during it.

### 4.3 Blast radius on existing features

| Feature | If captures land in an inbox | If they went straight to the ledger |
|---|---|---|
| Balances / dashboard / safe-to-spend | untouched until accepted | declined + `0.0` rows corrupt every tile |
| Budgets | untouched | phantom spend against a budget |
| Duplicate detection | see §5 — needs pending rows added as a source | works, but the CSV row is now the second copy |
| Splits / settlements (shared accounts) | untouched | another user can split against a phantom row; unwinding crosses the settlement CAS logic (CLAUDE.md §6) |
| Recurring / goals | untouched | noise in matching |
| AI spend | zero at ingest | zero at ingest either way (§3) |

### 4.4 Shared accounts

PR #123 §12 Q4 asked whether capture should reach shared accounts. With splits
and settlements now mature, the answer is clearer: **own accounts only for v1**.
A pending row targeting a shared account, accepted, becomes something another
user can split and settle against — and `writableAccountIds` was designed for
interactive callers, not unattended ones.

---

## 5. Duplicate detection: what is free now, and the two gaps left

Free: a capture accepted into the ledger gets a `duplicate_key`, and a later CSV
or photo import of the same charge is caught by layer 2 and pre-excluded. That
was PR #123's biggest open risk and it is gone.

**Gap 1 — pending rows are invisible to `check-duplicates`.** The route reads
`transactions` and `absorbed_import_hashes` only (`wallet.ts:877`). A capture
sitting unaccepted in the inbox does not exist to a CSV import running that
afternoon; the CSV row imports clean, and the user later accepts the capture too
— **double-counted, via the very inbox that was supposed to prevent it.** Fix:
a pending source must be a fourth read in that batch, and symmetrically an
arriving capture whose key already exists should land pre-flagged as "already in
your ledger". Cheap, but it is not automatic and must be scoped with the inbox,
not after it.

**Gap 2 — matching is date-exact.** `duplicate_key` starts with the date, and
layer 3's soft candidates key on `(date, amount)`. A capture is stamped at
*payment* time; a bank statement carries the *posting* date, often one to three
days later, and a weekend charge routinely posts on Monday. Neither layer fires.
This is narrower than PR #123 §8 (which had no merchant bridge at all) but it is
the residue of the same problem, and it is the one place a ±N-day window is
genuinely warranted — surfaced as a layer-3-style soft hint, never an
auto-exclude, since two identical amounts days apart are ordinary.

Note `duplicate_key` is never recomputed on edit (`duplicate-detection.md` §4),
so editing a merchant in the inbox before accepting is fine — the key is
computed at insert, after the edit.

---

## 6. The rules/AI inversion — fix before any text endpoint

The composer is rules-first *in the browser*: `parseComposerInput` runs
client-side (`Composer.tsx:136`) and only its failure calls
`POST /transactions/parse-composer-ai`. The Worker has **no rules parser**.

So a headless caller posting `"coffee 4.20 cash"` today can only reach the AI
route. Guardrail 1 says rules first; the server-side reality is AI-only. Two
consequences:

1. Any API endpoint that accepts **free text** (a Siri/Claude quick-add) must
   wait on porting `parseComposerInput` into `worker/` — shared, one
   implementation, exactly as `buildDuplicateKey` was done for the insert path.
   The browser can keep calling the local copy or the route; what must not
   happen is two divergent grammars.
2. Until then, an ingestion endpoint should take **structured fields**
   (`merchant`, `amount`, `card`, `occurredAt`), not prose. The Apple trigger
   emits structured fields anyway (§3 of PR #123), so this costs that client
   nothing and defers the whole question.

---

## 7. Token authentication, generalised

### 7.1 What exists

Nothing. `requireAuth` (`worker/routes/auth.ts:201`) reads the signed
`daybook_sid` cookie and that is the only credential the app understands. Every
protected route hangs off one `protectedApi` sub-app (`worker/index.ts`), whose
comment already argues that auth guarantees should be *structural, not
positional* — that reasoning applies directly here.

PR #123 §5's analysis of the five options (password / cookie / bearer token /
HMAC / Cloudflare Access) is unaffected by anything since and stands: **a
dedicated bearer token**, 256-bit random, stored SHA-256-hashed (not PBKDF2 —
there is no dictionary to defend against), sent in an `Authorization` header
(never a query string), per-device labelled, revocable, `last_used_at` tracked.
Shortcuts still has no HMAC action, so Option D is still infeasible.

### 7.2 What "…and from Claude" changes

PR #123 scoped the token to exactly one capability, `capture:write`, and its
safety argument was explicit: *a stolen token can write junk into the owner's
inbox and nothing else.* An agent token breaks that argument, because the whole
point of an agent is that it can **read**.

That is a genuinely different credential and should be treated as one:

| | Capture token | Agent token |
|---|---|---|
| Scopes | `capture:write` | `wallet:read`, `tasks:read`, `capture:write`, … |
| Blast radius if leaked | junk pending rows | **full financial history disclosure** |
| Lives | on a phone, in an exportable shortcut | in an MCP config / env var |
| Expiry | long-lived is defensible | should expire (90d) and be re-issued |
| Rate limit | ~60/hour is far above real spending | needs a much higher, separate ceiling |

Design consequences:

- **Scopes are load-bearing from day one**, not a forward-compat column. Enforce
  per-route, and default-deny: a route that names no scope is unreachable by
  token, full stop.
- **Read scopes are the dangerous half.** A write-only token is a nuisance when
  stolen; a `wallet:read` token is a data breach. If both are wanted, they are
  separate rows with separate labels, so revoking one does not kill capture.
- **Never grant a token the AI-spending routes.** `suggest-categories-ai`,
  `parse-composer-ai`, `import-photo` and `merchants/resolve` spend the owner's
  key. They stay cookie-only, no scope maps to them. (This is also what keeps §3
  enforceable at the auth layer rather than by convention.)
- **Never grant destructive or settlement scopes.** No delete, no
  `POST /settlements`, no split status changes, no `PUT /settings/:key` (which
  would let a token overwrite `anthropic_api_key`).

### 7.3 Structure

PR #123 §5.1 is right and gets stronger with scopes: `/api/capture/*` (or
`/api/v1/*` for a general machine API) is a **third sub-app** beside `auth` and
`protectedApi` in `worker/index.ts`, accepting bearer only. Two hard rules:

- The token guard **must not** fall back to the cookie — a cookie-authenticated
  POST any page can reach is CSRF, and `sameSite: 'Lax'` does not block
  top-level form POSTs.
- `protectedApi` **must not** accept a token. Two credential types, two
  surfaces, no overlap. Anything else and the scope list becomes decorative.

Rate limiting reuses `overAiRateLimit`'s proven atomic
`INSERT … ON CONFLICT … RETURNING` shape (`wallet.ts:1210`) with a per-token
key. As PR #123 noted, this would be the first rate-limited surface on the
public URL and chips at CLAUDE.md §13 open risk 1.

Idempotency: use a standard `Idempotency-Key` **header** rather than PR #123's
body field, since it now serves many clients; the DB-enforced
`UNIQUE (user_id, idempotency_key)` remains the mechanism.

### 7.4 How Claude would actually talk to it

Two shapes, and they are not equivalent:

- **Plain HTTPS + bearer token.** Works today with no new surface beyond §7.3.
  Fine for write-only capture.
- **An MCP server wrapping the API.** The idiomatic path for read+write agent
  use, and it puts a place to enforce scopes, redact, and shape responses
  outside the Worker. It is also strictly more code and a second deployable.

Recommendation: **start with bearer + `capture:write` only**, which serves the
shortcut, the email worker, and "Claude, log RM20 lunch" identically. Read
access is a separate decision with a separate risk profile — do not smuggle it
in as "the same feature".

---

## 8. Risks this introduces that do not exist today

1. **First non-cookie credential.** Every auth bug class the app has never had
   (leaked bearer, scope confusion, missing revocation check) becomes possible.
   Mitigation: one guard, default-deny scopes, e2e specs asserting *both*
   negatives — cookie must not authenticate `/api/capture`, token must not
   authenticate `/api/transactions`.
2. **First unattended write path.** Rule 13 has no user in front of it. Failures
   must be surfaced *in the app*: a "last capture received N days ago" line in
   Settings is the only thing that can detect an automation that silently
   stopped — the phone cannot report an event that never happened
   (PR #123 §9, still correct).
3. **Prompt injection, if Claude ever writes.** Text an agent reads may contain
   instructions. The inbox is the mitigation: a talked-into transaction is
   pending, visible, and dismissable, and it never moved a balance.
4. **Inbox rot.** A pending queue nobody empties is worse than no capture — it
   becomes a second, invisible ledger. Needs a badge with a count, and an
   opinion about what happens to a 60-day-old pending row.

---

## 9. Suggested delivery order (if approved)

Each slice is independently useful; the ordering is chosen so nothing depends on
the unprobed Apple trigger.

| # | Slice | Why here |
|---|---|---|
| 0 | **Probe** — PR #123 §4 on the owner's phone, *and* one bank alert email | An hour; can invalidate everything Apple-specific. The email route (PR #123 §10.2) may simply be better: server-side, all cards, settled amounts, no credential on a phone. |
| 1 | **Source-agnostic review surface** (§4.2a) — no new endpoints, no auth work | De-risks the biggest unknown first, and is worth doing on its own merits. |
| 2 | **Pending rows in `check-duplicates`** (§5 gap 1) | Must exist before anything can sit in a queue. |
| 3 | **Tokens** — table, Settings UI (create / label / show-once / revoke / last-used), bearer sub-app, scopes, rate limit | The foundation; independently testable with `curl`. |
| 4 | **`POST /api/capture/transaction`** (structured fields, rules-only enrichment, idempotency) + the inbox badge | Proves the pipe end-to-end without Apple. |
| 5 | **Clients**: quick-add shortcut, then the Wallet-trigger shortcut, then (if slice 0 favours it) the email worker | Each is configuration, not architecture. |
| 6 | **±N-day soft duplicate hint** (§5 gap 2) + silence detector (§8.2) | The correctness tail; must not lag real use. |
| — | *Deferred, separate decision:* read scopes / MCP (§7.4) | Different risk profile; do not bundle. |

e2e per rule 11: `NN-capture-tokens.spec.ts` (create/revoke, and both auth
negatives), `NN-capture-endpoint.spec.ts` (idempotency, validation, 401/429,
scope denial), `NN-capture-inbox.spec.ts` (accept/dismiss, duplicate pre-flag,
AI buttons hidden with no key).

---

## 10. Open questions for the owner

1. **Does the Apple probe pass** on your phone and issuer? (PR #123 §4, still
   unanswered — everything Apple-specific rides on it.)
2. **Inbox, or direct insert?** This doc argues inbox harder than PR #123 did,
   now for three reasons rather than one. Still the biggest fork.
3. **Read scopes for Claude — yes or no?** Write-only capture is a small,
   well-bounded feature. `wallet:read` means a leaked string discloses your
   entire financial history. If yes, it should be a separate token type with
   expiry, not a checkbox on the capture token.
4. **Is the bank-alert-email route worth probing alongside Apple?** It may
   dominate it on every axis, and it needs no phone credential at all.
5. **Should slice 1 (source-agnostic review) be pulled forward regardless?**
   It has standalone value for CSV and photo import even if capture is never
   built.
6. **What happens to a pending row nobody touches for 60 days?**

---

## 11. Where PR #123 now stands

Keep it — it remains the reference for everything Apple-specific, and its auth
analysis (§5) is the basis of §7 here. What it says that is now out of date:

- **§8 (double-counting) is largely solved**; its "option 2 fuzzy match,
  preferred" was superseded by canonical-key matching. Only §5's two gaps remain.
- **Its wave 5 mostly evaporates**; the residue moves to slice 6.
- **§6.3's field mapping stands**, and its "do not reach for the AI path"
  instinct is now formal policy (`ai-usage.md` guardrail 2).
- **§6.5's review UI is under-scoped** — it assumed a small new list; §4.2 shows
  it is really a generalisation of `CsvReviewTable`.
- **§11's wave 1→2 ordering should be re-cut** as §9 above, so the review
  surface lands before the endpoint rather than after it.
