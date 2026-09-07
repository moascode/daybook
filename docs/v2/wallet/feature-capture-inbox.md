# R18 — Machine capture: token auth + pending inbox

**Release:** R18 · `v3.6.0` · runs **next**, before R8.
**Status:** planned. Six product decisions locked by the owner 2026-09-06 (§1).
Governed by [../execution-playbook.md](../execution-playbook.md) per CLAUDE.md
§2 rule 14 — Gate 1 (plan + criteria) and Gate 2 (review verdict) both apply.

**What it is.** A way for a non-browser client to add a transaction, and a
credential for it to authenticate with. The first client is an iOS Shortcuts
automation on Apple Pay; the same endpoint and the same token serve a manual
quick-add shortcut, Claude, and any future service identically. Nothing a
machine writes reaches the ledger unreviewed.

Background analysis: [../../apple-wallet-capture-plan.md](../../apple-wallet-capture-plan.md)
(PR #123 — still the reference for everything Apple-specific; §2.3 below lists
what in it is now stale).

---

## 1. Locked decisions

| # | Question | Decision | Why |
|---|---|---|---|
| D-A | Where does a machine write land? | **Pending inbox, always** | Three independent untrusted inputs — a flaky signal (Apple fires on declines, sends `0.0` amounts and blank merchants), AI-derived extraction, and agent-read text that may carry instructions. A ledger row moves balances, budgets, safe-to-spend, reports, and can be split and settled against on a shared account before anyone notices. |
| D-B | What can the token do? | **`capture:write` only** | A leaked token writes junk into the owner's own inbox and nothing else. No balances, no history, no deletes, no settlements, no AI spend, no login. Read scopes are explicitly **out of scope** and are a separate future decision. |
| D-C | What does the endpoint accept? | **Structured fields only** | The Apple trigger emits structured fields anyway, and Claude constructs JSON natively — it *is* the parser. Avoids porting the composer's rules parser into the Worker (§7 B-4). |
| D-D | How is it governed? | **A v2 release, R18** | One roadmap, one process. The playbook's subagent split, two gates, and "I don't merge to `main`" all apply. |
| D-E | When? | **Next, before R8** | Small, self-contained, touches no designed page, and the Apple probe's answer expires as iOS drifts. |
| D-F | Where does the inbox live? | **The generalised review page**, plus a count badge | Inherits the AI buttons, duplicate hints, account control and inline edit that `CsvReviewTable` already has. A separate inbox UI converges on this having paid twice. |
| D-G | Bank posting-date drift? | **In scope** (§5.3) | Capture can only ever *overlay* CSV import, never replace it, so every captured payment reappears in the statement. Date-exact matching misses it. |

**Tag choice.** `v3.6.0` — the next tag after `v3.5.0` (shipped 2026-09-07).
Note the roadmap's tag column is **stale fiction**: it still assigns `v3.2.0` to
R8, but `v3.2.0`–`v3.5.0` are already real tags on other work. Tags are cut from
`git tag` at release time, never from that table — CLAUDE.md §13's standing
warning. R18 is the only row here with a tag that matches reality.

---

## 2. Why this shape

### 2.1 The inbox is the general answer for every non-human writer

One rule covers all three risks in D-A: **a non-human writer never writes to
`transactions`.** It writes a pending row; a human accepts it through the
existing insert path. That keeps `insertTransactionStmt`
(`worker/routes/wallet.ts:486`) the single write path into the ledger, which is
also what keeps `duplicate_key` universal.

### 2.2 AI at ingestion is not a flag — it is forbidden

The request that started this asked for "a flag to not use AI, or use AI on
demand later at review". [../cross-cutting/ai-usage.md](../cross-cutting/ai-usage.md)
§3 guardrail 2 already forces the stronger version: *a call fires on submit or
on a button, never on keystroke, focus, page load, or a poll.* An inbound POST
from a shortcut is a poll-class event — nobody is watching it. A `useAI: true`
option would let any caller spend the owner's Anthropic key, unattended, at
whatever rate it liked.

The precedent is A5: an automatic AI merchant-resolution pass had slipped into
CSV import against that rule and was demoted to an explicit button on
2026-09-06. This feature must not reintroduce it.

So: **ingest is rules-only and free**; AI is the buttons that already exist on
the review page. §5.2 lists exactly what the free path gets you.

### 2.3 What PR #123 got right, and what is now stale

Still correct: everything about Apple (no webhook, device-local trigger, fires
on declines, empty merchant, `0.0` amounts), and its auth analysis — password,
cookie, HMAC and Cloudflare Access are all still rejected for the same reasons,
and Shortcuts still has no HMAC action.

Now stale:

- **§8 (double-counting) is largely solved.** Cross-source duplicate detection
  shipped 2026-09-06 — a server-computed `duplicate_key`
  (`date|amountCents|type|canonicalMerchant`) matched by
  `POST /transactions/check-duplicates` (`worker/routes/wallet.ts:877`). Its
  proposed fuzzy amount+date match is superseded. Two narrower gaps remain (§5.3).
- **Its "wave 5" mostly evaporates**; the residue is PR-5 here.
- **§6.5's review UI is under-scoped** — it assumed a small new list; it is
  really a generalisation of `CsvReviewTable` (PR-1).
- **§11's ordering is re-cut** as §6: the review surface lands *before* the
  endpoint, not after.
- **§10.2's bank-alert-email route is dead.** The owner confirmed 2026-09-06
  that their banks send no email alert for Apple Wallet transactions. Capture
  therefore has no fallback ingestion route, which is why Gate 0 matters more,
  not less (§3).

---

## 3. Gate 0 — the one blocker, and what it does *not* block

**Nothing Apple-specific here is verifiable from CI.** Whether the trigger is
even offered on the owner's Malaysian issuer, whether it fires, and whether
`Merchant` is a usable string or issuer garbage are all unknown.

**The probe** (10 minutes, owner's phone, no code):

1. Shortcuts → Automation → New. **Is `Transaction` (iOS 17–18) / `Wallet`
   (iOS 26) in the list?** If not, PR-6 is dead.
2. Create it: all cards, **Run Immediately**, **Notify When Run**.
3. Actions: `Text` containing the `Merchant`, `Amount`, `Card` variables →
   `Show Notification`. No server needed.
4. Three real Apple Pay payments: one in-store NFC, one in-app/web, one declined
   if it can be provoked safely.
5. Record per payment: did it fire, how long after the tap, and exactly what
   `Merchant`/`Amount`/`Card` contained.

**Pass** = fires reliably with a usable merchant string.

**What Gate 0 blocks: PR-6 only.** PR-1 through PR-5 are unblocked and useful
regardless, because the token, endpoint and inbox serve **manual quick-add**
(Siri, share sheet, home-screen button) and **Claude** identically. If the probe
fails, the automatic half is lost and everything else still ships. This is the
deliberate hedge in the ordering.

---

## 4. Authentication

### 4.1 The credential

```
dbk_cap_<43 chars base64url>        # 32 random bytes from crypto.getRandomValues
```

- **Sent as** `Authorization: Bearer dbk_cap_…`. Never a query string — a token
  in a URL leaks into Cloudflare's request logs. The Worker's own logger prints
  the pathname only (`worker/index.ts`), which stays correct.
- **Stored SHA-256-hashed**, looked up *by that hash* on a unique index.
- **PBKDF2 is deliberately NOT used**, and this is the one place reusing
  `worker/crypto.ts` would be cargo-culting. PBKDF2's iteration count exists to
  make dictionary attacks on low-entropy *human passwords* expensive. A 256-bit
  random token has no dictionary. A single SHA-256 is correct, ~free on the CPU
  budget, and — because lookup is an indexed match on the digest — needs no
  constant-time compare either.
- **Shown once** at creation. Per-device label ("Ali's iPhone"), `created_at`,
  `last_used_at`, one-tap revoke. Losing a phone = revoking one row.
- **No expiry.** Write-only scope, revocable, and an expiry the owner forgets
  would silently break capture — the failure mode §8 exists to prevent.

### 4.2 Scope enforcement is default-deny

`scope TEXT NOT NULL DEFAULT 'capture:write'` exists from day one even though
there is one value. Every route under the capture sub-app **declares the scope
it requires**; a route that declares none is unreachable by token, full stop.
Retrofitting scope onto an unscoped token later means either a breaking change
or a permanently over-privileged credential.

**No scope maps to**: any AI-spending route (`suggest-categories-ai`,
`parse-composer-ai`, `import-photo`, `merchants/resolve`), any delete, any
settlement or split-status route, or `PUT /settings/:key` — which would
otherwise let a token overwrite `anthropic_api_key`. This is what makes §2.2
enforceable at the auth layer rather than by convention.

### 4.3 The two auth paths stay disjoint

A **third sub-app** in `worker/index.ts`, beside `app.route('/api', auth)` and
`protectedApi`, mounted at `/api/capture`. This mirrors the reasoning already
written there about making the guarantee structural rather than positional.

Two hard rules, both asserted in e2e (§9):

- The capture guard **must not** fall back to the session cookie. A
  cookie-authenticated POST that a third-party page can reach is CSRF, and
  `sameSite: 'Lax'` does not block top-level form POSTs.
- `protectedApi` **must not** accept a bearer token. Two credential types, two
  surfaces, no overlap — anything else makes the scope list decorative.

### 4.4 Rate limiting

Per **token**, 60/hour — far above real spending, far below abuse. Reuses the
proven atomic `INSERT … ON CONFLICT … RETURNING` shape from `overAiRateLimit`
(`worker/routes/wallet.ts:1210`), which must first be generalised out of
`wallet.ts` into `worker/lib/rate-limit.ts` with `max` and `windowMs` as
parameters (§7 B-2).

Counter key: `capture_rate_limit_<tokenId>` in `settings`. **`capture_rate_limit_`
must be added to `INTERNAL_KEY_PREFIXES` in `worker/routes/settings.ts`** —
otherwise a user could reset their own token's counter through the generic
settings PUT (§7 B-3).

This is the first rate-limited surface on the public URL and chips at CLAUDE.md
§13 open risk 1.

### 4.5 `last_used_at`

Updated via `c.executionCtx.waitUntil()` so the write never delays the
response the shortcut is waiting on.

---

## 5. Ingestion

### 5.1 The endpoint

```
POST /api/capture/transaction
Authorization: Bearer dbk_cap_…
Idempotency-Key: 20260906T143002-1890-847163
Content-Type: application/json

{ "merchant": "Starbucks", "amount": 18.9,
  "card": "Visa •••• 1234", "occurredAt": "2026-09-06T14:30:02+08:00",
  "source": "apple_wallet" }

→ 201 {"status":"pending","message":"Starbucks RM18.90 — 3 to review"}
→ 200 {"status":"duplicate","message":"already captured"}
→ 400 {"error":"amount must be greater than zero"}
→ 401 {"error":"invalid capture token"}
→ 429 {"error":"capture limit reached, try again later"}
```

- `message` is short and human-readable **on purpose** — the shortcut pipes it
  straight into a notification, which is how the user learns it worked.
- Errors use the same `{error}` shape everything else does, so `src/lib/api.ts`
  needs no special case.
- **`amount` must be a finite number > 0** → 400 otherwise. This is the
  declined-payment and `0.0` filter at the door.
- **`merchant` may be empty** — accepted and flagged for review. Dropping it
  would lose a real payment.
- **`occurredAt` is optional.** Absent → server-stamps in **Asia/Kuala_Lumpur**,
  never UTC (CLAUDE.md §16 trap 1). A supplied value is trusted but must parse.
- `source` defaults to `'api'`. `type` is optional (`expense` | `income` |
  `transfer`), defaulting to `expense`; an unrecognised value → 400.
  `destinationCard` is optional and only meaningful for a transfer.
- **Idempotency** is the `Idempotency-Key` header **or an `idempotencyKey` body
  field** — header wins when both are present. Enforced by
  `UNIQUE (user_id, idempotency_key)` on the table: a database guarantee, not a
  check-then-insert race.

  The body field is not a convenience. **iOS Shortcuts does not send a header
  whose value is a variable** — a typed literal arrives, a magic variable
  arrives empty, confirmed on-device 2026-09-07 when the identical automation
  started working the moment the value was typed by hand. Variables in the JSON
  body serialise fine, which is where `merchant`/`amount`/`card` already come
  from. Since a *constant* key would mean the first payment lands and every one
  after it is silently absorbed as a duplicate, the header-only design made the
  primary client's only correct option unreachable. Shortcuts has no
  UUID action, so the client builds one from actions that exist: `Format Date`
  (`yyyyMMdd'T'HHmmss`, business timezone) + amount in cents + `Random Number`
  100000–999999. The random component stops two genuinely distinct same-second,
  same-amount payments collapsing into one.

### 5.2 Enrichment runs at review load, not at ingest

The endpoint stores the raw fields and returns. Merchant cleanup, category
suggestion and account mapping all happen when the review page loads the pending
rows — exactly as CSV import already works.

Why: ingest is unattended and the shortcut is waiting on the response, so it
stays one INSERT. Enrichment needs several D1 reads and would put them on that
hot path for no benefit.

All of it is **free and deterministic** — no key, no AI, no register entry:

| Step | Reuse | Cost |
|---|---|---|
| Merchant cleanup | `POST /merchants/resolve` with `useAI` omitted (`wallet.ts:3372`) → ladder Stages 1–2 + own history | free |
| Category | `POST /transactions/suggest-categories` (`wallet.ts:1020`) — history majority + builtin cold-start map. A *different route* from the `-ai` one; never touches the key. | free |
| Account | card→account map (§5.4) | free |
| Duplicate flag | `duplicate_key` (§5.3) | free |

The AI buttons already on the review page (**A4** "Ask AI to suggest"
categories, **A5** "Ask AI to clean up" merchant names) then serve capture rows
unchanged — same chunking, same rate-limit buckets, same "no key → button
hidden" gating. **Approved by the owner 2026-09-07** — it is the same call and the same button,
but a third surface, and rule 2 says warn before wiring rather than assume.

### 5.3 Duplicate detection — the two gaps

Free already: a capture accepted into the ledger gets a `duplicate_key`, so a
later CSV or photo import of the same charge is caught by layer 2 and
pre-excluded.

**Gap 1 — pending rows are invisible to `check-duplicates`.** The route reads
`transactions` and `absorbed_import_hashes` only. A capture sitting unaccepted
does not exist to a CSV import running that afternoon: the CSV row imports
clean, the user later accepts the capture too, and it is **double-counted via
the very inbox meant to prevent it.**

Fix, both directions:

- `check-duplicates` gains a fourth read — pending captures' `duplicate_key`.
  A match surfaces as a **soft hint**, never an auto-exclude: the ledger
  genuinely does not have that row yet, so excluding it could lose the
  transaction entirely if the capture is never accepted.
- The inbox flags any pending row whose `duplicate_key` now exists in
  `transactions` as "already in your ledger". No extra state — a live check at
  render time.

**Gap 2 — matching is date-exact.** `duplicate_key` starts with the date and
layer 3's soft candidates key on `(date, amount)`. A capture is stamped at
*payment* time; the statement carries the *posting* date, often 1–3 days later,
and a weekend charge routinely posts on Monday. Neither layer fires.

Fix: layer 3 gains a **±3-day window, restricted to transactions that were
created from a capture**. That restriction is what keeps it quiet — ordinary
CSV-vs-CSV comparisons keep today's exact-date behaviour, so two RM12 Grab rides
on consecutive days are not suddenly flagged for everyone. No new column is
needed: "was this transaction created from a capture" is
`EXISTS (SELECT 1 FROM pending_captures WHERE transaction_id = t.id)`.

Still never an auto-exclude, and the hint shows the date difference so the human
can judge.

### 5.4 Card → account mapping

`Card` arrives as an issuer string ("Visa •••• 1234"). Stored raw at ingest,
mapped at review load through `settings` key `capture_card_map`, a JSON object
`{"Visa •••• 1234": "<accountId>"}` maintained in the Settings UI beside the
tokens.

The map may point at **any account the user can write to**, own or shared-in
(§13.1) — the picker is populated from `writableAccountIds`, the same set manual
add and CSV import use.

Unmapped card → fall back to `default_account_id`, **and say so on the row**
("unmapped card — check the account"). Silently guessing an account is exactly
the rule-13 failure this app keeps having to fix. A `transfer` whose
`destinationCard` does not resolve is flagged the same way and **cannot be
accepted** until a destination is chosen.

### 5.5 Accept and dismiss

- `POST /api/captures/accept` `{rows}` — cookie-authenticated, on `protectedApi`.
  Creates the transactions through `insertTransactionStmt` and marks the pending
  rows `accepted` with their `transaction_id`, in **one `db.batch()`** so a
  partial accept cannot leave a row both in the ledger and in the queue.
  **Re-checks `writableAccountIds` here**, not only at capture time — a share
  revoked in between must block the accept (§13.1) — and refuses a `transfer`
  with no destination account.
- `POST /api/captures/dismiss` `{ids}` — marks them `dismissed`.
- **Rows are never deleted.** Accepted and dismissed rows are retained, because
  the `UNIQUE (user_id, idempotency_key)` row *is* the idempotency guarantee — a
  deleted row means a replayed request creates a second capture. It also means
  no auto-expiry job and no "what happens to a 60-day-old row" question: the
  inbox lists `status = 'pending'` only, and the rest is history.

---

## 6. Migration `0018_capture.sql` — additive only

```sql
CREATE TABLE IF NOT EXISTS capture_tokens (
  id           TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label        TEXT NOT NULL DEFAULT '',
  token_hash   TEXT NOT NULL UNIQUE,               -- SHA-256 hex
  scope        TEXT NOT NULL DEFAULT 'capture:write',
  created_at   TEXT DEFAULT (datetime('now')),
  last_used_at TEXT DEFAULT NULL,
  revoked_at   TEXT DEFAULT NULL
);
CREATE INDEX IF NOT EXISTS idx_capture_tokens_user ON capture_tokens(user_id);

CREATE TABLE IF NOT EXISTS pending_captures (
  id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_id        TEXT REFERENCES capture_tokens(id) ON DELETE SET NULL,
  source          TEXT NOT NULL DEFAULT 'api',
  idempotency_key TEXT NOT NULL,
  raw_merchant    TEXT DEFAULT '',
  raw_card        TEXT DEFAULT '',
  amount          REAL NOT NULL,
  occurred_at     TEXT NOT NULL,                   -- ISO, business timezone
  duplicate_key   TEXT NOT NULL DEFAULT '',
  status          TEXT NOT NULL DEFAULT 'pending', -- pending|accepted|dismissed
  transaction_id  TEXT REFERENCES transactions(id) ON DELETE SET NULL,
  created_at      TEXT DEFAULT (datetime('now')),
  UNIQUE (user_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_pending_captures_status ON pending_captures(user_id, status);
CREATE INDEX IF NOT EXISTS idx_pending_captures_dupkey ON pending_captures(user_id, duplicate_key);
```

Ported to `server/migrations/` as well, or `scripts/schema-diff.mjs` fails CI
(CLAUDE.md §13 — `server/` is the schema reference the diff gates against, even
though it gets no feature work).

---

## 7. Blockers and known traps

| # | Blocker | Resolution | Blocks |
|---|---|---|---|
| **B-1** | Apple trigger unverified on the owner's issuer | Gate 0 probe (§3) | **PR-6 only** |
| **B-2** | `overAiRateLimit` is AI-specific and lives in `wallet.ts:1210` | Generalise into `worker/lib/rate-limit.ts` with `max`/`windowMs` params; AI callers pass their existing values | PR-2 |
| **B-3** | `capture_rate_limit_*` writable through `PUT /settings/:key` | Add the prefix to `INTERNAL_KEY_PREFIXES` (`worker/routes/settings.ts`) | PR-2 |
| **B-4** | Composer's rules parser is client-side; the Worker has none, so a text endpoint would be AI-first — the inverse of guardrail 1 | **Avoided by D-C** (structured fields only). If free-text capture is ever wanted, `parseComposerInput.ts` must be ported into `worker/` first, shared, one grammar | — |
| **B-5** | Review handoff is router `location.state` (`CsvImport.tsx:39`) — in-memory, same tab, same second. A server-sourced queue breaks all three assumptions | PR-1 generalises the surface before anything writes to it | PR-4 |
| **B-6** | e2e needs a capture token, and the suite cannot mint one through the UI without a real flow | Test-only route behind `DAYBOOK_TEST` (`worker/routes/test.ts`), same gate the mock-AI route already uses; production never sets it | PR-2 |
| **B-7** | No `source` column on `transactions` to scope gap 2's widened window | Join through `pending_captures.transaction_id` — no schema growth | PR-5 |
| **B-8** | A capture is unattended, so rule 13 has no user in front of it | Shortcut shows the response message on failure; app shows a silence detector (§8) | PR-4, PR-6 |

---

## 8. Rule 13 — failures with nobody watching

| Failure | Handling |
|---|---|
| No network at payment time | Shortcut catches the failure → `Show Notification` "Daybook capture failed — add manually" |
| Token revoked (401) / rate limited (429) | Same, showing the server's message verbatim — which is why §5.1's messages are human-readable |
| Automation silently stops firing (the iOS 18 bug class) | **Only the app can detect absence** — the phone cannot report an event that never happened. Settings shows "Last capture received: N days ago" from `MAX(created_at)`. Cheap, and the only thing standing between a broken automation and a month of missing data. |
| Declined payment captured | `amount > 0` at the door, then review |
| Unmapped card | Row is flagged, never silently filed to the default account (§5.4) |
| Inbox left to rot | Count badge in the Wallet nav; the queue is visible, not silent |

---

## 9. PR breakdown

Each row is one `feature-flow` run: Triage → Explore → Plan → Implement →
Verify → Review → PR, with both gates.

| PR | Ships | Depends on |
|---|---|---|
| **PR-1** | **Source-agnostic review surface.** `CsvReviewTable`/`CsvImport` take rows from either an in-memory batch (CSV, photo — unchanged) or a loader. No new endpoints, no schema, **zero behaviour change** for the two existing sources. | — |
| **PR-2** | **Token layer.** `capture_tokens`, Settings UI (create / label / show-once / list / revoke / last-used), the bearer sub-app + scope guard, rate limiting, B-2/B-3/B-6. Testable end-to-end with `curl` alone. | — |
| **PR-3** | **The endpoint.** `pending_captures`, `POST /api/capture/transaction`, validation, idempotency, business-timezone stamping. | PR-2 |
| **PR-4** | **The inbox.** Review surface loads pending rows, enrichment at load (§5.2), accept/dismiss, count badge, card→account map UI, silence detector. | PR-1, PR-3 |
| **PR-5** | **Duplicate correctness.** Gap 1 (pending rows in `check-duplicates`, both directions) + gap 2 (±3-day capture-scoped soft hint). | PR-3 |
| **PR-6** | **Clients + docs.** Quick-add shortcut, the Wallet-trigger shortcut, failure notifications, and the setup guide on the Help page. | **Gate 0**, PR-4 |

**PR-5 must land before PR-6 reaches real use** — that is the
balance-correctness PR, and shipping capture without it means knowingly shipping
a path where a Friday coffee appears twice.

PR-1 and PR-2 are independent and can run in either order; everything else is a
chain.

---

## 10. Acceptance criteria

**PR-1** — CSV and photo import behave identically to today (existing specs green
with no edits beyond the seam), and the surface renders a row set supplied by a
loader.

**PR-2** — A token can be created, shown once, listed, and revoked. A revoked
token 401s. `last_used_at` advances without delaying the response. 61 requests in
an hour → 429 on the 61st. **A session cookie cannot authenticate `/api/capture/*`.
A bearer token cannot authenticate any `protectedApi` route.** `capture_rate_limit_*`
is rejected by `PUT /settings/:key`.

**PR-3** — 201 on a valid capture; a replayed `Idempotency-Key` returns 200
`duplicate` and creates no second row; `amount <= 0` → 400; empty merchant → 201
and flagged; a missing `occurredAt` stamps today in Asia/Kuala_Lumpur.

**PR-4** — Pending rows appear in the review surface with merchant, category and
account resolved by rules only, with **zero** Anthropic requests made. A row on a
shared-in writable account accepts normally; the same row after the share is
revoked is refused. A `transfer` with no destination cannot be accepted and says
why. Accept
creates the transaction through the existing insert path and marks the row
`accepted` in one batch. Dismiss marks it `dismissed`. Badge count matches
`status='pending'`. An unmapped card is visibly flagged. Settings shows the
last-capture age. A4/A5 buttons are hidden with no API key.

**PR-5** — A CSV row matching a pending capture surfaces as a soft hint and stays
included. A pending row whose key is already in the ledger is flagged in the
inbox. A capture accepted on the 4th and the same charge posted in a CSV dated
the 6th surfaces as a candidate; two ordinary CSV rows three days apart do not.

**PR-6** — The published shortcut posts successfully, shows the server's message
on success, and shows an actionable notification on 401/429/network failure.

---

## 11. e2e specs (rule 11)

- `NN-capture-tokens.spec.ts` — create/label/show-once/revoke, rate limit, and
  **both auth negatives** from PR-2's criteria. The negatives are the point of
  the spec, not an extra.
- `NN-capture-endpoint.spec.ts` — 201, idempotent replay, `amount<=0`, empty
  merchant, 401, 429, timezone stamping.
- `NN-capture-inbox.spec.ts` — pending list, rules-only enrichment, accept,
  dismiss, badge count, duplicate flag, unmapped-card flag, AI buttons hidden
  with no key.
- Extend the existing duplicate-detection spec for gap 1 and the capture-scoped
  ±3-day window.

Conventions per CLAUDE.md §16: `businessToday()`/`businessDatePlus()`, never
`toISOString()`, never a hardcoded future date, `visible=true` not `.first()`,
and any test hook gated on `TEST_HOOKS_ENABLED`.

---

## 12. AI register position

Add to [../cross-cutting/ai-usage.md](../cross-cutting/ai-usage.md):

- **§2.3 RULES-ONLY** — "Capture ingestion enrichment (merchant, category,
  account)". Listed precisely so no future release quietly turns it into an API
  call without hitting rule 2.
- **§2.1** — a note that A4 and A5 now serve a third surface (capture rows in the
  review page). Same call, same buckets, same explicit button. **Approved by the
  owner 2026-09-07** in chat, ahead of implementation, per rule 2.
- **§4 approval log** — R18's entry, dated.

No new outbound Claude call is added by this release.

---

## 13. Assumptions taken (push back at Gate 1)

1. **Shared accounts are allowed** (owner, 2026-09-07 — overrides the original
   own-accounts-only assumption). A capture may target any account the user can
   write to, resolved through `writableAccountIds` exactly as manual add and CSV
   import already do. Write permission is re-checked **at accept time**, not just
   at capture time, so a share revoked between capture and review cannot slip a
   row into an account the user no longer writes to.
2. **60 requests/hour per token.**
3. **±3 days** for gap 2's window.
4. **No token expiry** (§4.1).
5. **Pending rows are retained forever**, never auto-expired (§5.5).
6. **Tokens live in Settings**, in a "Connected devices" section beside the
   existing AI-key section.
7. **Income and transfers are allowed** (owner, 2026-09-07 — overrides the
   original expense-only assumption). `type` is an optional payload field
   (`expense` | `income` | `transfer`), defaulting to `expense`. Apple's trigger
   carries no direction signal so it always sends the default; the manual
   quick-add and Claude paths can state it. **A `transfer` needs a destination**,
   which the payload cannot always supply — an optional `destinationCard` is
   mapped the same way `card` is, and a transfer whose destination does not
   resolve is **flagged and unacceptable until the user picks one at review**,
   never silently downgraded to an expense (rule 13). Splits remain out of
   scope — a captured row can be split after it is accepted, through the
   existing dialog.
