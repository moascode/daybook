# Apple Wallet → Daybook transaction capture

**Status:** brainstorm / analysis. **Nothing here is approved to build.**
Under CLAUDE.md §2 rule 10 this is Phase 7 work and needs owner sign-off before
a line of it is written.

**Date:** 2026-08-11
**Question this answers:** when a payment happens in Apple Wallet, how does a
transaction appear in Daybook — and how does that request authenticate?

---

## 1. TL;DR

1. **There is no webhook.** Apple does not call your server. The only mechanism
   is a *device-local* Shortcuts automation on the iPhone that makes an outbound
   HTTPS request. The "hook" is the phone. §2.
2. **The trigger is real but low-trust.** iOS 17+ has a `Transaction` personal
   automation (renamed **Wallet** in iOS 26). It fires on Apple Pay payments and
   hands you Merchant, Amount and Card. It also fires on **declined**
   transactions, and is documented by users to sometimes deliver an empty
   merchant or `0.0` amount. §3.
3. **Therefore: do not insert straight into `transactions`.** A signal that lies
   this often does not belong in a ledger unreviewed. Land it in a
   **`pending_captures` inbox** and confirm with one tap in Daybook. §6.
4. **Auth: a dedicated scoped bearer token**, not username/password, not the
   session cookie. Random 256-bit, stored SHA-256-hashed, sent as
   `Authorization: Bearer`, revocable per device, and authorised for *exactly
   one* capability: create a pending capture. §5.
5. **The hardest unsolved problem is not auth — it is double-counting** against
   the CSV bank import that will later contain the same payment. §8.
6. **Before building anything, run the 10-minute on-device probe in §4.** The
   feature's viability in Malaysia, on the owner's actual issuer, is unverified
   and unverifiable from here.

---

## 2. How the "hook" actually works (and what it is not)

The mental model in the request — "trigger create transaction in daybook" — is
right, but the direction of control matters:

```
   ┌──────────────────────────┐
   │ iPhone                   │
   │                          │
   │  Apple Pay tap ─┐        │
   │                 ▼        │
   │  Wallet ── OS event ──►  │  Shortcuts automation ("Wallet" trigger)
   │                          │        │
   └──────────────────────────┘        │  Get Contents of URL (POST, JSON)
                                       │  Authorization: Bearer dbk_…
                                       ▼
                         https://daybook.moascode.workers.dev
                              POST /api/capture/transaction
                                       │
                                       ▼
                              D1: pending_captures
```

Consequences of this shape, all of which drive the design:

| Property | Consequence |
|---|---|
| **No server-side event.** Apple never contacts you. | No backfill, no replay, no reconciliation endpoint. If the phone misses it, it is gone. |
| **Runs only on the device, only if online.** | A payment made in a basement car park fails the HTTP call. That transaction is lost **silently** unless the shortcut says so — see §9, this is a rule-13 issue. |
| **The client is untrusted and user-editable.** | The shortcut is exportable and shareable as an iCloud link. Whatever credential is in it must be assumed leakable. §5. |
| **Delivery is at-most-once, but retries are at-least-once.** | Manual re-runs and Shortcuts' own retry behaviour mean the endpoint **must** be idempotent. §7. |

There is no PassKit, no Wallet server API, and no Apple-hosted webhook for
consumer payments. Options that sound like one (merchant-side Apple Pay
webhooks, Apple Card transaction feeds) are for merchants or US-only.

---

## 3. What the trigger actually gives you

Verified against Apple's Shortcuts user guide and community/developer reports
(sources at the bottom).

**Setup path:** Shortcuts → Automation → New → **Transaction** (iOS 17–18) /
**Wallet** (iOS 26) → pick which card(s) → **Run Immediately** (no confirmation
tap; essential for hands-off capture) → optionally "Notify When Run".

**Fields exposed to the shortcut:** `Transaction` with `Merchant`, `Amount`,
`Card`, `Name`. That is the whole surface.

### 3.1 What you do NOT get — and what to do about it

| Missing | Impact | Mitigation |
|---|---|---|
| **Transaction ID** | No natural idempotency key. | Client-generated key, §7. |
| **Date/time** | Only "now", at automation run time. | Stamp server-side; accept that a delayed automation can land on the wrong day near midnight. Business-timezone rule from CLAUDE.md §16 trap 1 applies — stamp in Asia/Kuala_Lumpur, never UTC. |
| **Currency** | Amount is a bare number. | App is single-currency MYR (§6 schema note). Assume MYR; flag a review item if the owner ever travels. |
| **Authorised vs settled** | Tip adjustments, FX, holds and partial captures never reach you. | Only the review step or the later bank CSV has the true figure. Another reason for the inbox. |
| **Declined status** | **The trigger fires on declined payments too.** | Hard blocker for direct insert. |
| **Category** | Never provided. | Reuse the existing rule-based categoriser, §6.3. |

### 3.2 Known reliability defects (this is the crux)

Community and Apple Developer Forums reports, iOS 17→18:

- Fires on **declined** transactions.
- `Merchant` occasionally arrives **empty or whitespace-only**; `Amount`
  occasionally arrives **`0.0`**.
- Trigger **timeouts** when the issuer's push to Wallet is slow — the automation
  gives up rather than waiting, as the Wallet app itself does.
- iOS 18 regressions where the automation stopped firing entirely for some users.
- Open radars: FB14035016, FB16379100.

**Design conclusion.** This is a *hint stream*, not a ledger feed. The correct
posture is the same one the CSV importer already takes: capture, then review,
then commit. Daybook is a money app with real balances and a settlement engine;
letting a declined RM0.00 "" transaction into `transactions` corrupts balances,
dashboard tiles, budgets, and potentially a split.

---

## 4. Probe this BEFORE building (10 minutes, owner's phone)

Everything above is documented behaviour in mostly US/EU contexts. The owner is
in Malaysia on a local issuer. **Unknown until tested:** whether the trigger is
offered at all, whether it fires for the owner's specific bank cards, and
whether `Merchant` is usable or issuer garbage.

1. Shortcuts → Automation → New Automation. **Is `Transaction` / `Wallet` in the
   list?** If not, stop — nothing in this doc is buildable.
2. Create it: all cards, **Run Immediately**, **Notify When Run**.
3. Actions: `Text` containing the `Merchant`, `Amount` and `Card` variables →
   `Show Notification`. (No server needed for the probe.)
4. Make **three** real Apple Pay payments: one in-store NFC, one in-app/web, and
   — if it can be provoked safely — one that declines.
5. Record for each: did it fire, how long after the tap, and what exactly did
   Merchant/Amount/Card contain?

**Decision gate.** If merchant strings are unusable (issuer codes, blanks) or it
fires under half the time, the Apple path is not the right primary ingestion
route and §10's email-alert path becomes the better bet.

---

## 5. Authentication — the analysis

The request asked: token, or username/password? Each candidate, judged against
the real constraint — *the credential sits in an exportable shortcut on a phone.*

### Option A — username + password in the shortcut, call `/api/auth/login`

**Reject.**

- Puts the **account password in plaintext** in a shortcut that can be exported
  or shared as an iCloud link. That password also unlocks the web app, and via
  `POST /api/auth/change-password` (`worker/routes/auth.ts:147`) the account
  itself.
- Login runs **PBKDF2 at 50,000 iterations** (`worker/crypto.ts`) *per payment*.
  That is a deliberate CPU burn, sized for the free tier's budget, being paid on
  a hot path it was never meant for.
- Every login writes a new `sessions` row (`worker/session.ts:99-125`). A login
  per payment slowly fills the session table with rows nothing will ever revisit.
- No revocation short of changing the password — which, by design, kills every
  session on every device (`worker/routes/auth.ts:183-190`).

### Option B — reuse the browser session cookie

**Reject.** `daybook_sid` is `httpOnly` and signed (`worker/session.ts:51-56`).
Shortcuts has no durable cookie jar to carry it, and the same 30-day expiry would
silently break capture with no signal to the user.

### Option C — dedicated scoped capture token ✅ **recommended**

A second, parallel credential type. Deliberately *not* an account credential.

```
dbk_cap_<43 chars base64url>       # 256 bits from crypto.getRandomValues
```

- **Sent as** `Authorization: Bearer dbk_cap_…` — a header, never a query
  string. A token in a URL leaks into Cloudflare's request logs; the Worker's
  own logger only prints the pathname (`worker/index.ts:31-37`), but Cloudflare's
  does not.
- **Stored SHA-256-hashed**, and looked up *by that hash*.
- **PBKDF2 is deliberately NOT used here**, and this is the one place it would be
  cargo-culting to reuse `worker/crypto.ts`. PBKDF2's iteration count exists to
  make dictionary attacks on *low-entropy human passwords* expensive. A 256-bit
  random token has no dictionary. A single SHA-256 is correct, is ~free on the
  CPU budget, and — because lookup is an indexed match on the digest — needs no
  constant-time compare either.
- **Shown once** at creation, in Settings, next to the existing AI-key section.
- **Per-device rows** with a label ("Ali's iPhone"), `created_at`, `last_used_at`
  and one-tap revoke. Losing a phone = revoke one row, everything else keeps
  working.
- **Scoped to one capability**: create a pending capture. Nothing else. Store the
  scope as a column now even though there is one value — retrofitting scope onto
  an unscoped token later means either a breaking change or a permanently
  over-privileged credential.

**What a stolen capture token can do:** write junk rows into the thief's…
no — into the *owner's* pending inbox. Annoying, visible, and reversible by
revoking. **What it cannot do:** read balances, read transactions, read tasks,
delete anything, touch settlements, spend the Anthropic key, or log in.
That asymmetry is the entire justification for a second credential type.

### Option D — HMAC-signed requests with a nonce

**Reject on feasibility.** It is the better protocol on paper — replay
protection without server state — but iOS Shortcuts has **no HMAC or SHA action**
and no arbitrary-JavaScript action (the "Run JavaScript" action is macOS/JXA
only). It cannot compute the signature. Revisit only if capture ever moves into a
native app.

### Option E — Cloudflare Access / mTLS in front of `/api/capture/*`

**Reject for now.** Correct at the network layer, but Access service tokens are a
paid/Zero-Trust-tier concern, and it would put a second identity system in front
of a one-endpoint feature. Note it as the upgrade path if capture ever expands.

### 5.1 Keep the two auth paths disjoint

Non-negotiable if this is built:

- `/api/capture/*` accepts **only** the bearer token. It must **not** fall back
  to the session cookie — a cookie-authenticated POST endpoint that a third-party
  page can reach is a CSRF hole, and `sameSite: 'Lax'` does not block top-level
  form POSTs.
- Every existing `/api/*` route continues to accept **only** the cookie. A
  capture token must never be accepted by `protectedApi`.
- Structurally, that means a **third sub-app** in `worker/index.ts` beside
  `app.route('/api', auth)` and `protectedApi` — mirroring the reasoning already
  written at `worker/index.ts:70-83` about making the guarantee structural rather
  than positional.

### 5.2 Rate limiting

Per-token hourly cap. Reuse the proven atomic single-statement pattern from
`overAiRateLimit` (`worker/routes/wallet.ts:1002-1025`) — the
`INSERT … ON CONFLICT … RETURNING` with a `json_valid()`-guarded window. No new
primitive needed. A cap of ~60/hour is far above real spending and far below
abuse. This also chips at open risk #1 in CLAUDE.md §13: it would be the first
rate-limited *unauthenticated-by-cookie* surface on the public URL.

---

## 6. Proposed shape: an inbox, not a direct insert

### 6.1 Why not straight into `transactions`

Given §3.2, direct insert means declined payments become real expenses, `0.0`
amounts become real rows, and blank merchants become uncategorisable noise —
each of which silently corrupts balances, the dashboard, and budgets. The CSV
importer already established the right pattern for untrusted input: **review,
then commit**.

### 6.2 Migration `0013_capture.sql` (sketch — additive only)

```sql
CREATE TABLE IF NOT EXISTS capture_tokens (
  id           TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label        TEXT NOT NULL DEFAULT '',        -- "Ali's iPhone"
  token_hash   TEXT NOT NULL UNIQUE,            -- SHA-256 hex of the token
  scope        TEXT NOT NULL DEFAULT 'capture:write',
  created_at   TEXT DEFAULT (datetime('now')),
  last_used_at TEXT DEFAULT NULL,
  revoked_at   TEXT DEFAULT NULL
);
CREATE INDEX IF NOT EXISTS idx_capture_tokens_user ON capture_tokens(user_id);

CREATE TABLE IF NOT EXISTS pending_captures (
  id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source          TEXT NOT NULL DEFAULT 'apple_wallet',
  idempotency_key TEXT NOT NULL,
  raw_merchant    TEXT DEFAULT '',
  raw_card        TEXT DEFAULT '',
  amount          REAL NOT NULL,
  occurred_at     TEXT NOT NULL,                -- ISO, business timezone
  suggested_account_id  TEXT REFERENCES accounts(id)   ON DELETE SET NULL,
  suggested_category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
  status          TEXT NOT NULL DEFAULT 'pending',  -- pending|accepted|dismissed
  transaction_id  TEXT REFERENCES transactions(id) ON DELETE SET NULL,
  created_at      TEXT DEFAULT (datetime('now')),
  UNIQUE (user_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_pending_captures_status ON pending_captures(user_id, status);
```

`UNIQUE (user_id, idempotency_key)` is the idempotency guarantee — enforced by
the database, not by a check-then-insert race.

### 6.3 Field mapping

| Apple | → Daybook | Notes |
|---|---|---|
| `Amount` | `amount` | Reject `<= 0` at the endpoint with a real error. |
| `Merchant` | `merchant` | Empty is *accepted* but flagged for review — dropping it would lose a real payment. |
| `Card` | `account_id` | Via a user-maintained **card-name → account** map in `settings`. Unmapped card → fall back to `default_account_id`, and say so in the inbox row. |
| — | `date` | Server-stamped in Asia/Kuala_Lumpur. |
| — | `category_id` | **Reuse the existing rule engine.** `canonicalMerchant` + the history-majority logic (`docs/auto-categorisation-plan.md`, `worker/routes/wallet.ts:801+`, `src/lib/merchantSuggestions.ts`) already infers a category from the user's own history. Do not build a second one, and do not reach for the AI path — this is one merchant, and the rule engine is free. |
| — | `type` | Always `expense`. Apple Pay refunds are not distinguishable here; handle at review. |
| — | `import_hash` | Set on accept, see §8. |

### 6.4 The endpoint

```
POST /api/capture/transaction
Authorization: Bearer dbk_cap_…
Content-Type: application/json

{ "merchant": "Starbucks", "amount": 18.9, "card": "Visa •••• 1234",
  "idempotencyKey": "20260811T143002-189-8471medium", "source": "apple_wallet" }

→ 201 {"status":"pending","message":"Starbucks RM18.90 — 3 to review"}
→ 200 {"status":"duplicate","message":"already captured"}      # same key
→ 400 {"error":"amount must be greater than zero"}
→ 401 {"error":"invalid capture token"}
→ 429 {"error":"capture rate limit reached, try again later"}
```

The `message` is short and human-readable **on purpose**: the shortcut pipes it
straight into a notification, which is how the user learns it worked. Errors
carry the same `{error}` shape everything else does (`worker/index.ts:98-106`),
so `src/lib/api.ts` needs no special case.

### 6.5 The review UI

A badge on Wallet ("3 to capture") opening a list of pending rows, each with
merchant / amount / suggested account / suggested category, and **Accept** /
**Edit & accept** / **Dismiss**. Accept creates the real transaction through the
existing insert path — no second write path into the ledger.

**Escape hatch, off by default:** once the owner has watched it for a few weeks,
a per-card "auto-accept above/below confidence" setting could skip review for
clean captures. Ship it only after the data justifies it, never before.

---

## 7. Idempotency

Apple gives no transaction ID (§3.1) and a "Get Contents of URL" that times out
after the server already committed is indistinguishable, on the phone, from one
that never arrived.

**Key construction using only built-in Shortcuts actions** (no UUID action
exists):

```
Format Date  →  yyyyMMdd'T'HHmmss        (business timezone)
Random Number 100000–999999
Text: {formattedDate}-{amount×100}-{random}
```

Sent as `idempotencyKey`. The `UNIQUE (user_id, idempotency_key)` constraint
makes a replayed request return `200 duplicate` rather than creating a second
row. The random component prevents two genuinely distinct same-second,
same-amount payments from colliding into one.

---

## 8. The double-counting problem (unsolved, and the real risk)

**Every Apple Pay capture will appear again in the bank's CSV statement.** If
both are committed, the ledger double-counts and every balance, budget and
dashboard tile is wrong.

The existing defence is `import_hash` = `SHA-256(date | amount | merchant)`, and
`POST /transactions/check-duplicates` (`worker/routes/wallet.ts:768-799`) already
checks both `transactions` and `absorbed_import_hashes`. So the mechanism exists.

**Why it will not just work:** the merchant strings differ. Apple Wallet says
`Starbucks`; the bank statement says `STARBUCKS MY KLCC*1234` or similar. Same
payment, different hash, no match — and the CSV importer happily imports a
duplicate.

**Options, none free:**

1. **Hash on `date|amount` only for capture-sourced rows.** Catches the pair, but
   false-positives on two identical-amount payments the same day (two RM5 coffees
   — realistic).
2. **Fuzzy match at CSV review time.** When importing, flag any row whose amount
   matches a capture-sourced transaction within ±2 days and surface it in the
   review table as "possible Apple Pay duplicate", pre-unchecked. Uses the review
   step that already exists, keeps the human in the loop, and never silently
   drops a real row. **Preferred.**
3. **Canonical-merchant match.** `canonicalMerchant()` already normalises merchant
   strings for the categoriser; reuse it as a *secondary* signal to raise
   confidence on option 2's amount+date match. Not sufficient alone.
4. **Treat capture as the only source and stop importing CSVs for that card.**
   Cleanest, but loses every non-Apple-Pay transaction on that card and depends
   entirely on a trigger §3.2 says is flaky. Reject.

**Recommendation: option 2, reinforced by option 3.** It should be scoped into
the same delivery as capture itself, not deferred — shipping capture without it
means knowingly shipping a balance-corruption path.

---

## 9. Failure modes, and rule 13

CLAUDE.md §2 rule 13 says a failed operation must say something the user can act
on. Capture has a failure surface **on the phone**, outside the app entirely, and
this is where the design most easily goes wrong.

| Failure | Without handling | Required handling |
|---|---|---|
| No network at payment time | Transaction lost, user never knows | Shortcut catches the failure → `Show Notification` "Daybook capture failed — add manually" |
| Token revoked / 401 | Every future payment silently lost | Same, with the 401 message shown verbatim |
| 429 rate limited | Silent loss | Same |
| Automation stops firing (iOS 18 class of bug) | Weeks of missing data, discovered at reconciliation | Daybook-side: surface "last capture received N days ago" in Settings. **Only the app can detect absence** — the phone cannot report an event that never happened. |
| Declined payment captured | Phantom expense | Caught at review (§6) |

That last row is the one worth designing for deliberately: a silence-detector in
Settings is cheap and is the only thing standing between a broken automation and
a month of missing transactions.

---

## 10. Other ingestion routes (not limited to the shortcut)

Ranked by expected value for this project.

1. **Shortcuts Wallet trigger** — this doc. Best coverage *if* §4 passes.
2. **Bank alert email → Cloudflare Email Routing → Email Worker** ⭐ Genuinely
   strong, and architecturally native to where Daybook already lives. Most
   Malaysian banks send a transaction alert email per payment. Cloudflare Email
   Routing can forward to an **Email Worker**, which parses it and writes the
   same `pending_captures` row. Advantages over Apple: covers **all** cards and
   non-Apple-Pay payments, carries the **settled** amount, is server-side (no
   device, no offline loss, replayable), and needs **no credential on a phone**.
   Disadvantages: per-bank parsing, format drift breaks it silently, and an
   inbound email address is spoofable so it needs strict sender/DKIM validation.
   **Worth its own probe alongside §4.**
3. **Manual quick-add shortcut** (share sheet / home screen / "Hey Siri, log
   RM20 lunch") — same endpoint, same token, no trigger dependency. Nearly free
   once §5–6 exist and works today regardless of how §4 goes. Good first slice.
4. **NFC-tag shortcut for cash** — tag in the wallet, tap after a cash payment.
   Niche but cash is exactly what every automated feed misses.
5. **Bank SMS → Shortcuts** — iOS gives automations no SMS-body trigger. Not
   viable without a jailbreak-class workaround. Reject.
6. **Open Banking APIs (Malaysia)** — no realistic consumer/personal access.
   Reject for now.
7. **Apple Card export** — US-only, and the owner has no Apple Card. N/A.
8. **Native iOS app with App Intents** — the "correct" solution, and wildly out of
   proportion to a personal web app. Reject.
9. **Notification/screenshot scraping** — no supported API. Reject.

---

## 11. If approved: suggested delivery order

Each wave is independently useful and independently shippable, and every one
needs its own Playwright spec per rule 11.

| Wave | Contents | Why this order |
|---|---|---|
| **0** | §4 on-device probe + a parallel probe of one bank's alert email | Costs an hour, and can invalidate waves 1–3 |
| **1** | `capture_tokens` + Settings UI (create / label / show-once / revoke / last-used) + bearer guard sub-app + rate limit | The auth foundation; nothing else can start |
| **2** | `POST /api/capture/transaction` + `pending_captures` + the manual quick-add shortcut (§10.3) | Proves the whole pipe end-to-end **without** depending on Apple's flaky trigger |
| **3** | Wallet-trigger shortcut + published setup guide + failure notifications (§9) | The actual ask |
| **4** | Review inbox UI + accept/dismiss + auto-categorisation on capture | Makes it usable daily |
| **5** | CSV duplicate reconciliation (§8) + "last capture received" silence detector | **Must not ship after wave 3 reaches real use** — this is the balance-correctness wave |

Suggested e2e specs: `NN-capture-tokens.spec.ts` (create/revoke/scope
isolation — including *cookie must not authenticate `/api/capture`* and *token
must not authenticate `/api/transactions`*), `NN-capture-endpoint.spec.ts`
(idempotency, validation, 401/429), `NN-capture-review.spec.ts` (accept/dismiss,
duplicate reconciliation).

---

## 12. Open questions for the owner

1. **Does §4 pass on your phone and your issuer?** Everything downstream depends
   on it.
2. **Inbox-with-review, or direct insert?** This doc argues hard for review given
   §3.2. Direct insert is faster to build and genuinely nicer day-to-day — but it
   accepts declined and `0.0` transactions into a ledger with real balances and
   settlements. Your call, and it is the biggest fork here.
3. **Is the email-alert route (§10.2) worth probing in parallel?** It may be
   strictly better than the Apple path on every axis that matters.
4. **Do you want capture at all for shared/household accounts**, or own accounts
   only? Shared accounts drag in `canWriteAccount` and split semantics — the
   simplest v1 is own accounts only.
5. **How many devices?** One token or several changes nothing structurally, but
   confirms per-device labelling is worth the UI.

---

## Sources

- [Transaction triggers in Shortcuts on iPhone or iPad — Apple Support](https://support.apple.com/guide/shortcuts/transaction-trigger-apd65c67538a/ios)
- [Apple Pay automation — Graham Haley](https://grahamhaley.co.uk/2024/11/19/apple-pay-automation/)
- [Harness the features of New Wallet Automations — RoutineHub blog](https://blog.routinehub.co/harness-the-features-of-new-wallet-automations-with-this-shortcut/)
- [Retrieve all Wallet transaction data in Apple Shortcuts — Apple Discussions](https://discussions.apple.com/thread/256252606)
- [Shortcuts | Transaction Automation | iOS 18 — Apple Developer Forums](https://developer.apple.com/forums/thread/758053)
- [Shortcuts Automation Trigger Transaction Timeouts — Apple Developer Forums](https://developer.apple.com/forums/thread/765516)
- [Transaction Shortcuts + AppIntent is flaky occasionally — Apple Developer Forums](https://developer.apple.com/forums/thread/797233)
- [Troubleshooting Common Issues with Shortcut Automations for Apple Pay Transaction Import — MoneyCoach](https://moneycoach.ai/blog/troubleshooting-common-issues-with-shortcut-automations-for-apple-pay-transaction-import)
- [Add Transactions Instantly with iOS Shortcuts — Skwad](https://skwad.app/blog/creating-skwad-transactions-using-ios-shortcuts)

Internal references: `worker/session.ts`, `worker/routes/auth.ts`,
`worker/crypto.ts`, `worker/index.ts:70-83`, `worker/routes/wallet.ts:768-799`
(duplicate check), `worker/routes/wallet.ts:1002-1025` (rate-limit pattern),
`docs/auto-categorisation-plan.md`, `docs/csv-transfer-linking-plan.md`.
