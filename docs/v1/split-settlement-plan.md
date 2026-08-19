# Split → Settlement Review Flow

**Status:** approved by owner 2026-07-27. Not yet implemented.
**Supersedes:** the current fire-and-forget split model (splits become facts on the
recipient the moment the payer creates them, and settlement is the only exit).
**Closes:** B-16 (settlement legs typed income/expense) — not as a preference, but
because the money maths below forces it. See §3.

---

## 1. Why

Today a split is imposed, not offered. The recipient has no way to say "that
isn't mine" or "that amount is wrong", and the only lever is refusing to settle —
which is indistinguishable from not having got round to it. Meanwhile the payer's
expense total carries the full amount forever, because the counterparty ledger
leg can only be written if the payer has shared an *account* into the group
(`SettleUpDialog.tsx:50` filters to `a.isShared`). In the live data
`account_shares = 0`, so that leg has never once been written.

The result, on real data: kakon carries RM 776.65 of expense that is half
tumpa's, and no action either of them can take inside the app repairs it.

## 2. Model

A split is a **claim** against the recipient that they must resolve. Every state
transition belongs to exactly one person, and neither party can move the other's
books.

```
  kakon splits (any amount)
          │
          ▼
      ┌────────┐   tumpa rejects (+ optional reason)   ┌──────────┐
      │pending │ ────────────────────────────────────► │ rejected │
      └────────┘                                        └──────────┘
          │                                                   │
          │ tumpa marks paid (full or partial)                │ kakon re-splits
          │ → picks HER account → expense booked              │ → back to pending
          ▼                                                   │
   ┌──────────────┐  kakon rejects claim (+ reason)           │
   │   awaiting   │ ──────────────────────────────► pending ◄─┘
   │ confirmation │
   └──────────────┘
          │ kakon confirms received
          │ → picks HIS account → reimbursement booked
          ▼
      ┌────────┐
      │settled │   kakon's effective expense drops by the settled amount
      └────────┘
```

Deliberate properties:

- **Neither side picks the other's account.** tumpa chooses hers when paying,
  kakon chooses his when confirming. Account-level sharing stops being a
  precondition for recording that someone paid you. This is the fix for the
  never-written counterparty leg.
- **kakon's expense drops on *his* confirmation**, never on tumpa's claim alone.
  Otherwise she could reduce his books unilaterally.
- **Partial settlement loops.** Pay 30 now, 20 later — two passes through
  awaiting-confirmation, two confirmations. `settled_amount` already exists
  (migration `0007_partial_settlement.sql`) and is reused unchanged.
- **Rejection is the review step, not an accept gate.** The common case (an
  uncontested split) costs the recipient nothing. Only disagreement costs a
  click. An accept gate would have made every split cost one, and would have
  left the payer's balance reading zero until the recipient worked through a
  queue.

## 3. Money semantics — the constraint that drives the schema

Owner decision: kakon's expense is the **full amount until settled**, and drops
by the settled amount on confirmation. (Accrual — expense = own share from the
moment of the split — was considered and rejected.)

Accepted consequence, recorded so it is not rediscovered as a bug: **a settlement
changes a prior month's expense figure.** A May transaction settled in August
lowers May's expense, so closed months move. This is inherent to the rule above.

There are only two mechanisms that can return money, and using both double-counts:

| | kakon expense | kakon balance | verdict |
|---|---|---|---|
| (a) income leg only *(today)* | stays 100 | −100 +50 = −50 ✅ | expense never drops — fails the requirement |
| (b) effective expense only | **50** ✅ | −100; the RM50 he received is nowhere ❌ | cash wrong |
| (a)+(b) together | 50 | −50 +50 = **0** ❌ | double-counted |

kakon physically receives the money, so his account must reflect it — but if that
entry counts as income, the reduction happens twice. Therefore:

> **The creditor's incoming leg is balance-only: it moves the account balance and
> is excluded from income/expense totals. The debtor's outgoing payment is a
> normal expense.**

The asymmetry is not a wrinkle, it is the whole mechanism, and an earlier
revision of this document got it wrong by saying "both legs are balance-only".
That reading zeroes the debtor's expense — her payment is her *only* record of
what she bore, since §3 gives her 0 on the payer's transaction — and the
household total comes to 50 instead of 100. Corrected 2026-07-28 after the
owner re-confirmed the table below as normative.

- **Creditor (kakon receives):** excluded. His expense already fell by the
  settled amount; counting the arrival as income corrects the same money twice.
- **Debtor (tumpa pays):** counted as expense. Nothing else records her cost.

That is B-16, forced. With it, all four figures are right, before *and* after
settlement (RM100 expense, 50/50 split, RM50 settled):

| | expense | balance |
|---|---|---|
| kakon, before settlement | 100 | −100 |
| tumpa, before settlement | 0 | 0 |
| kakon, after | **50** ✅ | −100 +50 = **−50** ✅ |
| tumpa, after | **50** ✅ | **−50** ✅ |
| household total | **100** ✅ for a RM100 expense | |

### Effective amount

The payer's effective expense on a transaction is:

```
effective(txn, owner) = txn.amount − SUM(settled_amount of every OTHER user's split on txn)
```

Only **confirmed** settled amounts count. Pending and awaiting-confirmation
claims do not reduce anything.

For a non-owner viewing a transaction they hold a split on, their effective
amount is **0** on the transaction itself — their expense is the settlement entry
they booked, not a share of someone else's row. This avoids the household total
being counted twice.

⚠️ The existing `effectiveAmount()` in `worker/lib/sharing.ts` is **not** this
function and must not be reused as-is. For a transaction the caller does not own
and has no split on (e.g. on a shared-in account), it returns the *full* amount —
which would absorb all of the owner's spending into the viewer's totals the
moment `view=all` widens (§5.1). Write a new helper; leave the old one only where
group balances already depend on it, or retire it in the same pass.

## 4. Schema

New migration — `worker/migrations/0010_split_review.sql` and the mirrored
`server/migrations/0009_split_review.sql`. Additive only, per CLAUDE.md §6.

```sql
-- Claim lifecycle on the split itself.
ALTER TABLE transaction_splits ADD COLUMN status TEXT NOT NULL DEFAULT 'pending';
--   'pending' | 'awaiting_confirmation' | 'settled' | 'rejected'
ALTER TABLE transaction_splits ADD COLUMN rejected_reason TEXT DEFAULT '';
ALTER TABLE transaction_splits ADD COLUMN rejected_at TEXT DEFAULT NULL;

-- Confirmation half of the settlement handshake.
ALTER TABLE settlements ADD COLUMN status TEXT NOT NULL DEFAULT 'confirmed';
--   'awaiting_confirmation' | 'confirmed' | 'rejected'
ALTER TABLE settlements ADD COLUMN confirmed_at TEXT DEFAULT NULL;
ALTER TABLE settlements ADD COLUMN rejected_reason TEXT DEFAULT '';

-- Set on the CREDITOR's incoming leg only (see §3) — never on the debtor's
-- payment, which is a normal expense. A column, not a merchant-string or
-- category match: both are user-editable and an edit would silently
-- re-inflate the totals with no visible cause.
ALTER TABLE transactions ADD COLUMN is_balance_only INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_txn_splits_status ON transaction_splits(user_id, status);
```

Defaults are chosen so existing rows keep their current meaning:
`status='pending'` for the 15 outstanding splits, `settlements.status='confirmed'`
for the one already-settled row (it predates the handshake; retroactively marking
it unconfirmed would strand it).

### Backfill

```sql
UPDATE transaction_splits SET status = 'settled' WHERE settled_at IS NOT NULL;
UPDATE transactions SET is_balance_only = 1
  WHERE id IN (SELECT to_transaction_id FROM settlements WHERE to_transaction_id IS NOT NULL);
```

Only `to_transaction_id` — the creditor's incoming leg. The debtor's leg stays a
normal expense. On current live data this touches **0 rows**: the one existing
settlement has `to_transaction_id = NULL`, because the counterparty leg could
never be written (the recipient had no shared account of the payer's to target).
That zero is the expected result, not a failed migration.

## 5. API

All paths under `worker/routes/`. `server/routes/` is mirrored only if the Mac
rollback must stay feature-equivalent — **confirm before doing the double work**;
the Worker is production as of the Phase 6 cutover and `server/` is a rollback
target that has never seen this feature.

### 5.1 Visibility (do this first — it is independent and small)

`viewCondition('all')` gains a third branch so `all` genuinely means all:

```
own transactions
  OR transactions on accounts shared into my group   (existing)
  OR transactions where I hold a non-rejected split  (new)
```

Rejected splits drop out of the recipient's view entirely — that is the point of
rejecting.

### 5.2 New routes

| Route | Actor | Effect |
|---|---|---|
| `POST /transactions/splits/:id/reject` `{reason?}` | recipient | `status='rejected'`, records reason + timestamp. Payer's effective expense returns to full. |
| `POST /settlements` *(changed)* | debtor | `accountId` now **required**. Books the debtor's expense leg only, `is_reimbursement=1`. Creates the settlement with `status='awaiting_confirmation'`. Splits move to `awaiting_confirmation`. Does **not** touch `settled_amount` yet. |
| `POST /settlements/:id/confirm` `{accountId}` | creditor | Books the creditor's balance-only leg into **his** account, `is_reimbursement=1`. Applies `settled_amount` to the split lines under the existing compare-and-swap. `status='confirmed'`. |
| `POST /settlements/:id/reject` `{reason?}` | creditor | Claim of payment refused. Splits return to `pending`; the debtor's expense leg is reversed (delete the leg — it is same-session, no history value). |

`POST /settlements` keeps its existing CAS + compensating-rollback design
(`worker/routes/settlements.ts:104`, PR #72). The confirm step inherits it — that
is where `settled_amount` is actually written, so that is where the race lives now.

### 5.3 Changed reads

- Transaction list and export return `effective_amount` alongside `amount`.
- Every income/expense aggregate excludes `is_balance_only = 1`: transaction
  summary row, dashboard, reports, budgets, `getMonthlySpending`. Account
  balances still include the leg — that is the whole point of the flag.
- `GET /budgets/spending` (`worker/routes/wallet.ts:1464`) currently computes
  from `own.share_amount`, which is pure accrual and contradicts decision §9.1
  (full amount until settled). It moves to the §3 effective amount. Found after
  this document was first written; it is the one aggregate that already existed
  server-side.
- Group balances count only `status IN ('pending','awaiting_confirmation')`.

## 6. Client

- **Shared page becomes the review queue.** It currently shows balances and
  settlement history only. It gains the actual transactions behind each balance —
  with date/month filtering, per owner request — and the per-item **Settle** and
  **Reject** actions. This is the page tumpa lives in; the Transactions list stays
  a ledger.
- **SettleUpDialog**: account selection becomes required, and the counterparty
  account selector is deleted outright (with it, the `a.isShared` filter and the
  "No shared accounts from X. Only your side will be recorded." dead end).
- **New: ConfirmReceiptDialog** for the creditor — amount, who, which account it
  landed in, confirm or reject with reason.
- **Inbox affordance.** Splits awaiting tumpa and settlements awaiting kakon's
  confirmation both need a badge. Reuse the `InvitationsBadge` pattern
  (`src/modules/settings/InvitationsBadge.tsx`, polled in `Sidebar.tsx:86`) — the
  root cause of the original report was that tumpa had 15 splits she had never
  been told about.
- **TransactionList** shows both figures when they differ: `RM100 · your share
  RM50`. The ledger figure is never hidden.
- **Settlement category**: tumpa's expense leg inherits the original
  transaction's `category_id` (owner decision — so her food budget sees food).
  When one settlement clears several transactions with different categories,
  fall back to uncategorised rather than picking arbitrarily.

## 7. Waves

Each wave is one PR, green CI before the next starts.

| Wave | Content | Risk |
|---|---|---|
| **W1** | §5.1 visibility — `all` includes split-in rows. View-aware empty state on `/wallet` (today it blames the date filter when the *view* is the cause). No schema. | low |
| **W2** | Migration + backfill, `is_reimbursement`, effective-amount helper, all aggregates excluding reimbursements. No UI. Verify past-month figures move exactly as intended. | **high — money** |
| **W3** | Reject flow (route + Shared-page action + badge). | medium |
| **W4** | Two-step settlement: required account, confirm/reject receipt, ConfirmReceiptDialog. | **high — money** |
| **W5** | Shared page as full review queue: transactions behind each balance, date filters, split-amount display in the list. | low |

W2 and W4 each move real money figures on a live deployment with two real users.
Both want a DB snapshot first (`infra/daybook backup` for the Mac;
`wrangler d1 export` for D1) and a verified rollback before merge.

## 8. Tests

New spec `e2e/52-split-review.spec.ts`, plus additions to `35-splits`:

- Recipient rejects → payer's effective expense returns to full; row leaves the
  recipient's `all` view.
- Payer re-splits after rejection → back to pending, recipient sees it again.
- Partial settle → confirm → payer's effective expense drops by exactly the
  settled amount; second partial clears the rest.
- Creditor rejects a payment claim → splits return to pending, debtor's expense
  leg is gone.
- Reimbursement legs move balances but are absent from income/expense totals —
  assert on the summary row, dashboard, and budgets.
- The four-number table in §3 asserted end to end for both users.
- **A split dated in a prior month** — every pre-existing split spec dates its
  transaction today, which is exactly why the original bug shipped
  (`35-splits.spec.ts:106` even documents the workaround).

## 9. Decisions on record

| # | Decision | Date |
|---|---|---|
| 1 | Expense drops on settlement, not accrual from split. Closed months move; accepted. | 2026-07-27 |
| 2 | Two-step settlement — debtor marks paid, creditor confirms received. | 2026-07-27 |
| 3 | Partial settlement retained; it is the "pay some now" path, distinct from rejection. | 2026-07-27 |
| 4 | Rejection carries an optional reason. Creditor gets a symmetric reject on the payment claim. | 2026-07-27 |
| 5 | Each side selects **its own** account. Debtor's account is required. | 2026-07-27 |
| 6 | Settlement legs are balance-only, excluded from income/expense (B-16, forced by §3). | 2026-07-27 |
| 7 | tumpa's settlement expense inherits the original transaction's category. | 2026-07-27 |
| 8 | `all` includes split-in transactions; `mine` / `shared-with-me` / `shared-with-others` remain the narrowing filters. | 2026-07-27 |
