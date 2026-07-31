# Shared review flow — implementation plan (R1 / R2 / R3)

**Status:** planned 2026-07-31. Owner approved the direction in
`docs/shared-review-improvements.md` and asked for the tabbed list explicitly.
**Scope:** the seven items the owner named — SplitList unification with status
tabs, person-first grouping, inline ✓/✗ plus multi-select bulk approve, the split
note, rows linking to the transaction, a Settle Up allocation preview, and a
Rejected tab with the reason and a Re-split action.

Three PRs, green CI between each. **R1 is a pure refactor with no schema and no
new status** — it can merge on its own and is worth having regardless of R2.

---

## 0. Two findings that change the shape of the work

Both were found while reading the code for this plan; neither is in the proposal
doc, and each one moves work between waves.

### 0.1 The split note is never written

`splitInsert` (`worker/routes/wallet.ts:1287`) accepts a note, but
`POST /transactions/:id/split` passes `''` unconditionally (`:1341, :1346, :1364`),
and neither `SplitDialog.tsx` nor `BulkSplitDialog.tsx` has a note input — grep for
`note` in both files returns nothing. `GET /transactions/splits/mine` selects
`ts.note` (`:1210`) and the client drops it.

So "show the note" is **capture, then show**. Displaying it alone renders an empty
string on every row in production. Capture lands in R1 with the display.

### 0.2 A claimed split stays `'pending'`, so the tabs cannot filter on `ts.status`

`settlements.ts:262-271` is explicit about it:

> A claim moves no money and must NOT move the split's status: a partial payment
> leaves the rest of that split owed, and flipping the whole row to
> awaiting_confirmation would strand the remainder as unclaimable.

"Paid, awaiting confirmation" is therefore only derivable by joining
`settlement_split_lines` → `settlements.status = 'awaiting_confirmation'` — which
is exactly what the two `NOT IN` subqueries at `settlements.ts:113` and `:171`
already do.

**Consequence:** `GET /transactions/splits/mine` returns a derived `claim_state`
alongside the raw `status`, and every tab filters on that. The DB semantics stay
exactly as they are.

```
claim_state =
  'rejected'              when ts.status = 'rejected'
  'settled'               when ts.status = 'settled'
  'awaiting_confirmation' when the split has a line in a settlement
                          whose status = 'awaiting_confirmation'
  'approved'              when ts.status = 'approved'      ← R2
  'pending'               otherwise
```

Ordering matters: the `awaiting_confirmation` test must come before `approved`,
or a partially-paid approved claim reports as merely approved and the user is
invited to pay it twice.

A knock-on cleanup while we are here: `settlements.ts:364` rolls a split back with
`WHERE ... AND status = 'awaiting_confirmation'`, a status the forward path never
sets. It matches zero rows — dead, and harmlessly so, but it reads as if the
forward path did something it does not. Delete it in R2.

---

## 1. Decisions locked for this plan

From §7 of the proposal, with the owner's direction. Any of these can be reopened,
but the plan below assumes them.

| # | Decision | Consequence |
|---|---|---|
| D-1 | **Settling implies approval.** | Every post-settlement and rollback resting state is `approved`, never `pending`. This is what fixes O-3 and it removes the need to record a prior status anywhere. |
| D-2 | **Approval is reversible until money moves.** | `POST .../unapprove`, allowed from `approved` only. |
| D-3 | **Approval never gates the balance.** | `pending + approved + awaiting_confirmation` all count. `groups.ts:398` gains one value, and no money figure moves. |
| D-4 | **The badge counts `pending` only.** | Approving clears the badge; the debt stays visible as a balance. |
| D-5 | **Auto-approve is out of scope for R1–R3.** | Ships as a per-group setting later if the queue proves tedious. Nothing here forecloses it. |
| D-6 | **No `server/` mirror.** | Per `split-settlement-plan.md` §5: the Worker is production, `server/` is a schema reference gated by `scripts/schema-diff.mjs`. **The migration must still be mirrored to `server/migrations/` or CI fails on drift** — DDL only, no route work. |

---

## 2. R1 — SplitList unification (no schema, no new status)

**Branch:** `refactor/shared-split-list`
**Risk:** low. Deletes two renderers, adds one. No money path touched.

### 2.1 What it replaces

| Removed | Lines | Replaced by |
|---|---|---|
| `ClaimsToReview.tsx` | 162 | `SplitsSection` + `SplitList` |
| `BalanceBreakdown.tsx` | 118 | same |

**Correction (review, 2026-07-31): "Payments to confirm" stays.** The first draft
folded `SharedPage.tsx:171-199` into the `awaiting_confirmation` tab. That is
wrong on two counts:

- It is **settlement-shaped, not split-shaped.** One settlement can clear several
  splits (`settlement_split_lines` is a junction table), so the fold renders N
  rows each carrying a Confirm button that would confirm the same whole
  settlement — the same action offered several times, each labelled with one
  slice of what it does.
- `ConfirmReceiptDialog` takes a `Settlement` (`ConfirmReceiptDialog.tsx:33`), and
  `GET /transactions/splits/mine` returns no settlement id, so a split row cannot
  drive it at all.

The block keeps its place above the sections. The `awaiting_confirmation` tab is
**informational on both sides** — it answers "where did this claim go?", and the
action stays where the object is whole.

### 2.2 New files

```
src/modules/wallet/SplitList.tsx        ← one row renderer, all states
src/modules/wallet/SplitsSection.tsx    ← one counterparty: header, tabs, list, actions
src/hooks/useSplits.ts                  ← fetch + approve/reject/unapprove mutations
src/lib/split.mappers.ts                ← snake_case rows → SplitClaim
```

`SplitClaim` goes in `src/types/household.types.ts`, replacing the two ad-hoc
row interfaces (`ClaimsToReview.tsx:10` and `BalanceBreakdown.tsx:7`) that
currently pass raw snake_case through the component tree:

```ts
export type ClaimState = 'pending' | 'approved' | 'awaiting_confirmation' | 'settled' | 'rejected'

export interface SplitClaim {
  id: string
  transactionId: string
  shareAmount: number
  settledAt: string | null
  settledAmount: number
  outstanding: number          // shareAmount − settledAmount, computed in the mapper
  note: string                 // the payer's explanation — see §0.1
  state: ClaimState
  rejectedReason: string
  rejectedAt: string | null
  date: string
  merchant: string
  description: string
  transactionAmount: number
  categoryId: string | null
  ownerId: string              // the payer / creditor
  ownerUsername: string
  debtorId: string
  debtorUsername: string
}
```

### 2.3 Layout

```
Shared                                            [View split transactions ↗]
┌──────────────────────────────────────────────────────────────────┐
│  Owed to you  RM 776.65          You owe  RM 0.00                │
└──────────────────────────────────────────────────────────────────┘

  ▸ tumpa                                          owes you RM 776.65
    ┌ To review 4 │ Paid, unconfirmed 1 │ Settled │ Rejected ┐
    │ ☐ 12 Jun  Tesco Extra           RM 45.20  of RM 90.40  │
    │      "half the weekly shop"                     [✓][✗] │
    │ ☐ 09 Jun  Shell                 RM 30.00        [✓][✗] │
    └────────────────────────────────────────────────────────┘
                                          [Settle up RM 776.65 ▸]
```

- **Person first.** One `SplitsSection` per **(group, counterparty) pair**, not per
  group per direction. The group name is a subtitle, rendered only when the user is
  in more than one group (`groups.length > 1`) — with one household it is noise.
  The pair, not the counterparty alone: balances and settlements are per-group in
  the data model and `SettleUpDialog` requires a `groupId`
  (`SettleUpDialog.tsx:31`), so a section spanning two groups could not settle.
  Person-first is how it *reads*; the group is still how it keys.
- Tabs are `SplitList` filtered by `claim_state`, with counts from the same fetch.
  The **Agreed** tab appears in R2; R1 ships To review / Paid, unconfirmed /
  Settled / Rejected.
- **Direction is a property of the section, not a heading.** The same component
  renders both "tumpa owes you" and "you owe tumpa"; only the action set differs
  (a creditor cannot approve their own claim).
- Sections sort by outstanding amount descending, and a section with no
  outstanding balance and no history is not rendered — as today
  (`SharedPage.tsx:217`).

### 2.4 Row states

| `claim_state` | Debtor sees | Creditor sees |
|---|---|---|
| pending | ✓ Approve · ✗ Reject | "awaiting their review" |
| approved *(R2)* | ✗ Reject · Pay this one *(R3)* | "agreed" |
| awaiting_confirmation | "waiting on {creditor} to confirm" | "you marked this received" — the Confirm/Reject action stays on the settlement block above (§2.1) |
| settled | date settled | date settled |
| rejected | reason | reason · **Re-split** *(R3)* |

Partial progress renders on any row with `settledAmount > 0.005`:
`RM 50.00 · RM 30.00 paid` with a 2px progress bar. That figure exists today only
inside `BalanceBreakdown:102` and is invisible in the review queue — O-3.

### 2.5 Server changes (R1)

All in `worker/routes/wallet.ts`:

1. `GET /transactions/splits/mine` returns `claim_state` (§0.2) plus
   `settlement_id` — the open claim covering this split, `NULL` unless
   `claim_state = 'awaiting_confirmation'`. It comes from the same
   `settlement_split_lines` join that derives the state, so it is free, and
   without it an awaiting row cannot name the payment it is waiting on. Accepts:
   - `state=` as a comma list, replacing the single-value `status=` (keep `status=`
     working — `Sidebar.tsx:96` and the e2e suite both pass it)
   - `counterparty=<userId>` so `SplitsSection` stops fetching wide and filtering in
     the browser (O-9, `BalanceBreakdown.tsx:54`)
   - `groupId=`
2. `POST /transactions/:id/split` accepts an optional `note` per share and passes it
   to `splitInsert` instead of `''` (§0.1). Cap at 500 chars, matching the reject
   reason (`:1238`).
3. `POST /transactions/splits` (bulk) — same note plumbing.

### 2.6 Client changes (R1)

- `SplitDialog.tsx` — optional "Note for {recipient}" input, placeholder
  *"e.g. half the weekly shop"*. `BulkSplitDialog.tsx` gets one note applied to the
  whole batch.
- `WalletPage.tsx` — accept `?txn=<id>`, pass it to `TransactionList` as
  `highlightId`; the row gets a ring and `scrollIntoView({ block: 'center' })` on
  mount. Rows link to `/wallet?txn=<id>&view=all&range=all` — all three params, or
  the target lands outside the default month filter and the link appears broken,
  which is the bug this workstream exists to fix (`SharedPage.tsx:147`). The list
  renders every matching row with no pagination or windowing (checked), so a
  highlight is always reachable once the filters admit it.
- `SharedPage.tsx` drops to a shell: headline, payments-to-confirm, sections,
  dialogs. Target ~150 lines from 331.

### 2.7 Tests (R1)

Extend `e2e/53-split-review.spec.ts`; the four tests that assert on the old
components need retargeting, not deleting:

| Existing test | Change |
|---|---|
| `:390` badge counts claims and clears on rejection | testids move to the new list |
| `:565` a balance opens into the transactions behind it | becomes the tab assertion |
| `:589` breakdown starts at all time and can be narrowed | date control moves into `SplitsSection` |
| `:606` a split row shows both ledger amount and your share | unchanged (`TransactionList`) |

New: tabs filter and counts are right; a note entered at split time appears on the
recipient's row; a row link lands on the transaction with it highlighted and no
empty-list state; a partially-paid row shows the paid figure in the queue.

---

## 3. R2 — the `approved` state

**Branch:** `feat/split-approved-state`
**Risk:** medium. No money figure changes, but it edits the settlement guards,
including the two compare-and-swap sites from PR #72.

### 3.1 Migration

`worker/migrations/0011_split_approved.sql`, mirrored to
`server/migrations/0010_split_approved.sql` for `scripts/schema-diff.mjs` (D-6):

```sql
-- 'approved' is a new value in the existing transaction_splits.status TEXT
-- column, so there is no status column to add. approved_at records when the
-- recipient agreed, for the per-claim timeline.
ALTER TABLE transaction_splits ADD COLUMN approved_at TEXT DEFAULT NULL;
```

No backfill. Every existing claim stays `pending` — unreviewed is the honest state
for a claim nobody has approved, and D-4 means the badge correctly lights for them.

### 3.2 Routes

| Route | Actor | Guard |
|---|---|---|
| `POST /transactions/splits/:id/approve` | debtor (`ts.user_id`) | from `pending` only; 404 for someone else's split, matching the reject route's non-disclosure rule (`wallet.ts:1245`) |
| `POST /transactions/splits/:id/unapprove` | debtor | from `approved` only; 409 if `settled_amount > 0.005` or a settlement claim is open |
| `POST /transactions/splits/approve` `{ids[]}` | debtor | bulk; one `batch()`, cap 500 like `splits/status` (`:1524`) |

### 3.3 The guard sites — all twelve

Each is a `'pending'` literal that must widen or retarget. Missing one does not
throw; it silently makes an approved claim unsettleable or downgrades it back into
the review queue. This table is the checklist.

| Site | Now | Becomes | Why |
|---|---|---|---|
| `groups.ts:398` | `IN ('pending','awaiting_confirmation')` | `+ 'approved'` | D-3 — balances must not move |
| `settlements.ts:109` | `= 'pending'` | `IN ('pending','approved')` | outstanding-owed total |
| `settlements.ts:167` | `= 'pending'` | `IN ('pending','approved')` | FIFO allocation list |
| `settlements.ts:270` | CAS `SET status='pending' WHERE status='pending'` | `SET settled_amount = settled_amount WHERE ... status IN ('pending','approved')` | **the trap** — the current SET would downgrade an approved claim on every debtor-side claim. The write is only a no-op probe to keep `meta.changes` meaningful (`:266`), so make it visibly a no-op |
| `settlements.ts:277` | `CASE … ELSE 'pending'` | `ELSE 'approved'` | D-1 |
| `settlements.ts:364` | rollback to `'pending'` from `'awaiting_confirmation'` | **delete** | dead statement, §0.2 |
| `settlements.ts:370` | rollback `SET status='pending'` | `'approved'` | D-1 |
| `settlements.ts:468` | `CASE … ELSE 'pending'` | `ELSE 'approved'` | D-1 |
| `settlements.ts:470` | CAS `WHERE status='pending'` | `IN ('pending','approved')` | confirm must work on approved claims |
| `settlements.ts:519` | confirm rollback to `'pending'` | `'approved'` | D-1 |
| `settlements.ts:682` | undo settlement → `'pending'` | `'approved'` | D-1; undo must not re-queue a claim the user already agreed to |
| `wallet.ts:1273` | reject `WHERE status='pending'` | `IN ('pending','approved')` | D-2 — approval is reversible, so rejection must be reachable from it |

`wallet.ts:1252-1266` (the reject preflight) already rejects `settled`,
`awaiting_confirmation` and partially-paid claims; it needs no change.

D-1 is what makes this tractable: because every resting state after a settlement
is `approved`, no path needs to remember what the status was beforehand. Without
it, `:682` (undo, possibly weeks later, in another session) would need a
`prior_status` column.

### 3.4 Client

- **Agreed tab** in `SplitsSection`, between To review and Paid.
- **Balance line splits**: `owes you RM 776.65` gains
  `RM 400.00 agreed · RM 376.65 awaiting their review`. `GET /groups/:id/balances`
  returns `agreedAmount` and `unreviewedAmount` alongside `amount` — same query,
  two more conditional sums, no extra round trip (the pattern
  `wallet.ts:226` already uses).
- **Badge**: `Sidebar.tsx:96` polls `?status=pending`; that keeps working unchanged
  under D-4 and now actually clears.
- Inline ✓ on a pending row; the row moves to Agreed with an undo toast
  (`toast.store.ts`), which is the D-2 unapprove path — no separate button needed.

### 3.5 Tests (R2)

- Approve → the claim leaves To review, the badge drops, **the balance does not
  move** (the D-3 assertion — this is the one that would catch a bad
  `groups.ts:398`).
- Approve → settle → confirm end to end, asserting the §3 four-number table again
  from the approved path. This is the regression net for the twelve guard sites.
- Approve → reject (D-2 reachability).
- Settle a `pending` claim without approving → lands in `approved`, not `pending`
  (D-1), and does not reappear in To review.
- Partial settle → confirm → the remainder sits in Agreed, not To review (O-3).
- Undo a settlement → claims return to `approved` (`:682`).
- Concurrent settle against an approved claim still returns 409, not a silent
  overwrite — fault-injected as in PR #72.

---

## 4. R3 — bulk actions, allocation preview, rejection loop

**Branch:** `feat/shared-bulk-and-preview`
**Risk:** low. Additive UI over R1/R2 primitives.

### 4.1 Multi-select and bulk

Checkbox per row, select-all per tab, a sticky action bar:
`3 selected · RM 105.20` → `[Approve] [Reject] [Settle these]`.
Approve is the bulk route from §3.2; Reject loops the existing single route with
one shared reason; Settle passes the selected ids into Settle Up.

Follows the Wallet multi-select convention, not Tasks' — bulk reject is a
`ConfirmDeleteModal`-class action per CLAUDE.md §10 (Tasks' undo-toast exception
is explicitly Tasks-only).

### 4.2 Allocation preview

`POST /settlements/preview` `{groupId, counterpartyId, amount}` → the FIFO
allocation, no writes:

```json
{ "capped": false, "outstanding": 776.65,
  "lines": [ { "splitId": "…", "merchant": "Tesco Extra", "date": "2026-06-12", "applied": 45.20 } ],
  "unallocated": 0 }
```

**It must share one SQL helper with the commit path.** Extract the query at
`settlements.ts:158-180` into `outstandingSplitsFor(db, groupId, debtorId,
creditorId)` and call it from both, or the preview drifts from what actually
happens and becomes a lie the user has been taught to trust. The preview renders
live under the amount field in `SettleUpDialog`, and the existing capped-amount
notice (`SettleUpDialog.tsx:74`, B-18) becomes a pre-submit warning instead of a
post-hoc one.

Under D-1 the FIFO order is unchanged: `ORDER BY ts.created_at ASC` over both
pending and approved.

Register `/settlements/preview` **before** any `/settlements/:id` route, or the
param route swallows it — the same trap `worker/routes/groups.ts` documents for
the literal `/groups/members` against `/groups/:id`.

### 4.3 Rejection feedback

The creditor currently learns nothing when a claim is rejected — the reason is
written by `wallet.ts:1268` and rendered nowhere (O-4).

- **Rejected tab, creditor side**: reason, when, who, and **Re-split**, which opens
  `SplitDialog` on the transaction. The path already works —
  `POST /transactions/:id/split` deletes and reinserts the whole share set
  (`:1370`), so a rejected row is replaced by a fresh `pending` one; `e2e:324`
  covers it.
- **A "recently rejected" strip** on the Shared page for rejections in the last 30
  days, using `rejected_at`. No seen-state column, deliberately: a `dismissed_at`
  is a schema change to solve a problem two users may not have. If the strip proves
  noisy, add it then.

### 4.4 Per-claim timeline

Expandable row: split {date} → approved {date} → paid {date} → confirmed {date}.
Every timestamp already exists after R2 (`created_at`, `approved_at`,
`settlements.settled_at`, `confirmed_at`, `rejected_at`). Read-only, no new
storage.

---

## 5. Risks

| Risk | Mitigation |
|---|---|
| A missed `'pending'` literal silently strands approved claims | §3.3 is a complete grep-verified inventory (`grep -n "'pending'" worker/routes/*.ts worker/lib/sharing.ts`), and the approve→settle→confirm e2e exercises every one |
| `settlements.ts:270` downgrading approved claims | Called out as the trap; the fix makes the no-op probe visibly a no-op instead of a status write |
| The CAS sites at `:270`/`:470` are the PR #72 concurrency design | Widen the status predicate only. Do not touch the `settled_amount` comparison, the positional `meta.changes` indexing, or the compensating batch |
| Preview drifting from commit | One shared helper (§4.2), enforced by both callers using it |
| e2e churn — 20 tests in spec 53 | R1 retargets four; the rest assert server behaviour and are untouched |
| Live data: 15 outstanding claims, 2 real users | R2 has no backfill and no money-figure change. `wrangler d1 export` before the deploy regardless |

## 6. Out of scope

Auto-approve (D-5), reminders/nudges from the creditor, claim-level comments,
notifications outside the badge, aging reports, and folding "Recent settlements"
into the person-first layout (proposal §7 Q6 — revisit once R1 is real and the
page's actual shape is visible).
