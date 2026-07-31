# Shared page — review → approved → settled

**Status:** proposal, not approved. Brainstorm in response to the owner's note that
"To review" and "Show the N transactions behind this" are two transaction lists
that could be better, and that the lifecycle wants to read
**to review → approved → settled**.

**Builds on:** `docs/split-settlement-plan.md` (W1–W6, shipped 2026-07-28). Nothing
here contradicts its money semantics (§3) — see §4 below, which is the point that
needs the owner's ruling.

---

## 1. What is on the page today

`SharedPage.tsx` renders five stacked things, three of which are lists of splits
drawn three different ways:

| # | Section | Source | Row shape | Actions |
|---|---|---|---|---|
| 1 | Headline "Owed to you / You owe" | summed balances | — | — |
| 2 | "Payments to confirm" | `settlements` awaiting me | who + amount | Review |
| 3 | **"To review"** (`ClaimsToReview`) | `splits/mine?status=pending` | merchant, date, from, total | **Reject only** |
| 4 | Balance card → **"Show the N transactions behind this"** (`BalanceBreakdown`) | `splits/mine` ± `role=creditor` | merchant, date, total, paid | none |
| 5 | "Recent settlements" | `settlements` | from → to, amount | Undo |

Sections 3 and 4 are the same rows from the same endpoint, rendered by two
components with different columns, different empty states, and different testids.
Section 3 is not date-filtered; section 4 is, and starts at All time.

## 2. Observations

Ordered by how much they cost the user, most first.

**O-1 — "To review" has no approve, so it never empties.**
`ClaimsToReview.tsx:100` offers exactly one action: Reject. The header says
"Settle them below" — meaning the user must leave the queue, scroll to the balance
card, and settle the *whole balance*. There is no way to work the queue item by
item, and no way to record "I looked at this and it's fine". A claim leaves the
queue only when money moves.

**O-2 — The nav badge is therefore permanently lit.**
`PendingClaimsBadge` counts `status='pending'`. With 15 outstanding claims it reads
"9+" until someone pays. A badge that cannot be cleared by acknowledging it is a
badge people stop looking at — which is the exact failure (`ClaimsToReview.tsx:23`)
this whole workstream was built to fix.

**O-3 — A partially paid split goes back to `pending` and reappears as untouched.**
`settlements.ts:277` and `:468` set
`status = CASE WHEN ? >= share_amount THEN 'settled' ELSE 'pending' END`. Pay RM30
of RM50, get it confirmed, and the claim returns to the review queue looking
identical to one nobody has ever touched. The `RM30 paid` note exists only in
`BalanceBreakdown` (`:102`), not in the queue.

**O-4 — The rejection reason is written and never read.**
`ClaimsToReview` collects a free-text reason and `POST .../reject` stores it in
`rejected_reason`. Nothing in `src/` renders it — grep finds `rejectedReason` only
in `household.mappers.ts:58` and the type. The payer sees their balance silently
drop, with no notice, no reason, and no prompt to re-split. Same for
`settlements.rejected_reason`. The feedback half of the review loop is missing.

**O-5 — No per-item settle.** "I'll pay you for the Tesco one now" is not
expressible. Settlement is balance-level with a free-text amount and FIFO
allocation (`settlements.ts:158`). The user types a number and hopes; nothing shows
which claims that number will clear.

**O-6 — Rows are dead ends.** Neither list links to the underlying transaction, and
neither shows the per-split `note` — which is the payer's own explanation of the
claim and the single most useful field for judging it. `splits/mine` already
selects `ts.note` (`wallet.ts:1210`); the client drops it.

**O-7 — Grouping is group → direction → person.** With one household and two
people, that is three levels of nesting to say "you owe tumpa RM388". Claims from
different people are mixed in one flat "To review" list, distinguished only by
grey 11px text.

**O-8 — No bulk anything.** 15 claims, 15 individual decisions.

**O-9 — `BalanceBreakdown` fetches wide and filters narrow.** `:52` pulls every
split for the role, then `.filter()`s to the counterparty in the browser. Fine at
15 rows, wrong shape at 500. The toggle label also reads
`Show the {rows.length || ''} transactions` — the count is empty until the panel
has been opened once, so the first render is missing the number.

**O-10 — No timeline.** Who split it, when, when it was approved, when paid, when
confirmed. Every one of those timestamps exists or nearly exists; none is shown.

## 3. Proposal: make agreement a first-class state

Add one split status between `pending` and settlement.

```
        payer splits
             │
             ▼
     ┌───────────────┐   reject (+reason)   ┌──────────┐
     │ pending       │ ───────────────────► │ rejected │
     │ "to review"   │ ◄─────────────────── └──────────┘
     └───────────────┘     payer re-splits
             │
             │ recipient approves  ← NEW, free, reversible
             ▼
     ┌───────────────┐   reject (+reason)
     │  approved     │ ─────────────────────► rejected
     │ "you owe"     │
     └───────────────┘
             │ recipient marks paid → picks own account
             ▼
     ┌──────────────────────┐  creditor rejects   ┌──────────┐
     │ awaiting_confirmation│ ──────────────────► │ approved │
     └──────────────────────┘                     └──────────┘
             │ creditor confirms → picks own account
             ▼
        ┌─────────┐
        │ settled │
        └─────────┘
```

**The three words the owner asked for map onto three questions:**

| State | Question it answers | Whose move |
|---|---|---|
| to review | "Do I agree I owe this?" | recipient |
| approved | "Have I paid it?" | recipient |
| settled | "Did it arrive?" | payer (already built) |

### 4. Reconciling with the plan's explicit rejection of an accept gate

`split-settlement-plan.md` §2 rules this out on purpose:

> Rejection is deliberately the only *free* action here… An accept gate would have
> made every split cost one [click], and would have left the payer's balance
> reading zero until the recipient worked through a queue.

That objection is answered by making approval **an acknowledgement, not a gate**:

- **Balances are unchanged.** `pending + approved + awaiting_confirmation` all count
  toward the debt, exactly as `pending` alone does today. The payer's balance never
  reads zero waiting on the recipient. The plan's §3 money table is untouched, and
  no aggregate, effective-amount rule, or ledger leg changes.
- **The uncontested case can still cost zero clicks**, via one of the escape hatches
  in §7 (auto-approve after N days / trusted-group setting / settling implies
  approval). Approval buys information; it should not be able to block money.
- **What approval changes is only which bucket a claim is in** — and therefore what
  the badge means. The badge stops meaning "you have debts" (never clearable) and
  starts meaning "someone is claiming something you have not looked at"
  (clearable in one click, and worth looking at every time it appears).

This also gives the creditor something they cannot get today: **a balance split
into agreed and unreviewed.** "tumpa owes you RM776.65, of which RM400 agreed and
RM376 not yet reviewed" tells kakon whether he is waiting on money or on a
conversation. Today those two situations are the same number.

And it fixes O-3 for free: a partially paid claim returns to `approved`, not
`pending`, so it never re-enters the review queue.

## 5. Proposed UI

One list component, one row shape, status as a filter — replacing `ClaimsToReview`,
`BalanceBreakdown`, and the awaiting-confirmation list with a single `SplitList`
parameterised by `{ role, status, counterparty }`.

```
Shared                                            [View split transactions ↗]
┌────────────────────────────────────────────────────────────────┐
│  Owed to you  RM 776.65        You owe  RM 0.00                │
│  RM 400 agreed · RM 376 awaiting their review                  │
└────────────────────────────────────────────────────────────────┘

  ⚠ 3 things need you                        ⏳ 2 waiting on someone else

  ▸ tumpa                                        owes you RM 776.65
    ┌ To review 4 ┬ Agreed 9 ┬ Paid, unconfirmed 1 ┬ Settled ┬ Rejected ┐
    │ ☐ 12 Jun  Tesco Extra          RM 45.20  · RM90.40 total       │
    │      "half the weekly shop"                            [✓][✗]  │
    │ ☐ 09 Jun  Shell                RM 30.00                [✓][✗]  │
    └────────────────────────────────────────────────────────────────┘
    [Approve selected] [Reject selected]          [Settle up RM 776.65 ▸]
```

Changes packed into that sketch:

1. **Person first, status second.** Group name becomes a subtitle unless there is
   more than one group. (O-7)
2. **Status tabs with live counts** on one list, instead of three lists in three
   places. (§1, O-9)
3. **A "needs you" / "waiting on them" summary line** at the top — the only two
   states a user actually cares about on arrival.
4. **Inline ✓ / ✗ per row** plus checkbox multi-select with bulk approve / reject /
   settle. (O-1, O-8)
5. **The split note on the row.** (O-6)
6. **Row click → the transaction**, deep-linked as `/wallet?txn=<id>&range=all`.
   (O-6)
7. **Partial progress on the row**: `RM 50.00 · RM 30.00 paid` with a thin progress
   bar. (O-3)
8. **A rejected tab, with the reason and a `Re-split` action for the payer** —
   closing O-4's loop. The payer also gets an inbox entry: "tumpa rejected RM45.20
   for Tesco Extra — 'this one was mine'".
9. **Settle Up gains an allocation preview**: "RM 100 clears Tesco RM45.20, Shell
   RM30.00, and RM24.80 of Grab", defaulting to approved claims only, with an
   explicit "include unreviewed" toggle. (O-5)
10. **Per-claim timeline** in an expandable row: split by kakon 12 Jun → approved by
    tumpa 14 Jun → paid 01 Jul → confirmed 02 Jul. (O-10)

## 6. What it costs

Small, and — importantly — **not on the money path**. W2 and W4 were the
"high risk — money" waves; this is not one of them.

**Schema** (additive, one migration; `status` is already a free TEXT column):
```sql
ALTER TABLE transaction_splits ADD COLUMN approved_at TEXT DEFAULT NULL;
```
No new status column — `'approved'` is a new value in the existing one.

**API:**
- `POST /transactions/splits/:id/approve` and bulk `POST /transactions/splits/approve {ids}`
- `POST /transactions/splits/:id/unapprove` (approval must be reversible, or it is a trap)
- `GET /transactions/splits/mine` — accept `status` as a comma list, add `counterparty`
  and `groupId` filters so `BalanceBreakdown` stops filtering client-side (O-9)
- balances gain `agreedAmount` / `unreviewedAmount` alongside `amount`

**The one real code risk** — every settlement guard is written against the literal
`'pending'` and must become `IN ('pending','approved')`, or approving a claim
silently makes it unsettleable:
`settlements.ts:109`, `:167`, `:270`, `:277`, `:364`, `:370`, `:468`, `:470`, `:682`.
The CAS guards at `:270` and `:470` are the sharp ones — they are the compare-and-swap
that makes concurrent settlement safe (PR #72), and widening their status predicate
needs the same care the original design got.

**Tests:** `e2e/53-split-review.spec.ts` extends; new cases for approve → settle,
approve → reject, partial → approved (not pending), bulk approve, and the payer
seeing a rejection reason.

**Sequencing** — three PRs, green CI between:

| | Content | Risk |
|---|---|---|
| **R1** | `SplitList` unification + note + txn deep-link + row states. Pure refactor of the three existing lists, no schema, no new status. | low |
| **R2** | `approved` state: migration, approve/unapprove routes, widened settlement guards, badge semantics, agreed-vs-unreviewed on balances. | medium |
| **R3** | Bulk actions, allocation preview in Settle Up, rejection feedback to the payer, timeline. | low |

R1 is worth doing whether or not §3 is approved — it is where the duplication is.

## 7. Open questions for the owner

1. **Auto-approve?** Options: (a) never — the queue is worked by hand; (b) after N
   days of silence; (c) a per-group "we trust each other" setting that starts claims
   in `approved` and keeps the reject lever. (b) and (c) preserve the plan's
   zero-click property for uncontested splits. Recommend **(c)**, defaulting off.
2. **Does settling imply approving?** Recommend yes — paying is agreement, and it
   avoids "you must approve before you can pay".
3. **Is approval reversible?** Recommend yes, until money moves.
4. **Should the badge count approved-but-unpaid too?** Recommend no — approved means
   the user has seen it. A separate, quieter "you owe" figure already exists.
5. **Does the payer see approval?** Recommend yes; it is the reassurance that makes
   the state worth having for both sides.
6. **Sections 2 + 5 too** (payments to confirm / recent settlements) — fold into the
   same person-first layout, or leave standing? Recommend folding, in R3.
