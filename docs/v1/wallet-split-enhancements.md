# Wallet Split Enhancements — Percentage Auto-Adjust + Uniform Bulk Split

Status: implemented on `feat/wallet-split-percent-uniform`.

## Problem

1. Percentage split with 3+ people (`BulkSplitDialog`) required hand-typing every
   participant's box to make the total land on 100%. `SplitDialog` (2-party, single
   transaction) already auto-completed its two boxes; the multi-recipient bulk dialog did
   not.
2. Bulk-splitting was strictly per-transaction: selecting 10 transactions meant configuring
   10 separate cards even when they all needed the same recipients and split rule.

## What changed

Both features are client-only — no schema or API change. The bulk endpoint
(`POST /transactions/splits`, `worker/routes/wallet.ts:2198`) already accepted a fully
general per-transaction `shares[]` array, and the split math already lived in
`src/lib/utils.ts` (`splitEqually`, `splitByPercents`, `equalPercents`, `formatPercent`).

### 1. Percentage auto-adjust

New helper in `src/lib/utils.ts`:

```ts
export function redistributePercents(count: number, editedIndex: number, value: number): string[]
```

Editing any participant's percentage box clamps that value to 0–100 and splits the
remainder `(100 − value)` equally across everyone else. Example: payer sets themself to
70% with two recipients selected → both recipients become 15%.

`BulkSplitDialog.tsx` wires this into every percent `<Input onChange>` (per-card mode and
the new uniform mode) via a shared `editPercent(participants, editedId, rawValue)` closure.
`SplitDialog.tsx` (the 2-party single-transaction dialog) already auto-completed its two
boxes to the complement — that behaviour is the `n = 2` case of the same rule and was left
as-is.

### 2. Uniform bulk split ("Same split for all")

`BulkSplitDialog.tsx` gained a top-level mode switch, shown whenever more than one
transaction is selected:

- **Configure each** — the original per-card flow, unchanged. This stays the default so no
  existing behaviour or e2e coverage shifted under anyone.
- **Same split for all** — one recipient/mode configuration (`UniformState`) applied across
  every selected transaction. On save, each transaction's shares are computed from *its
  own* amount and posted through the same `/transactions/splits` batch call.

Supported uniform modes: Keep as-is (single recipient, full amount), Split equally, By %
(rebalancing per above), and Fixed amounts.

**Fixed amounts is recipient-only.** A typed RM figure can't mean the same thing across
transactions with different totals, so uniform fixed-amount mode is defined as: each
recipient owes that fixed amount on every transaction, and the payer absorbs the
per-transaction remainder (`payer = t.amount − Σ recipient fixed`) — mirroring the
owner-absorbs-rounding rule used everywhere else in the split system.

**Per-transaction feasibility.** A transaction is skipped (excluded from the save, not
blocked) when its resolved shares include a non-positive amount — chiefly a fixed amount
exceeding a small transaction's total. The dialog shows a live count ("N of M selected
transactions are too small … and will be skipped") and the Save button label reflects the
actual count that will be split, so a partial result is never a silent one (CLAUDE.md rule
13).

## Files touched

- `src/lib/utils.ts` — added `redistributePercents`.
- `src/modules/wallet/BulkSplitDialog.tsx` — uniform mode, mode switch, `editPercent`
  wired into both per-card and uniform percent inputs.
- `e2e/27-wallet-bulk-share.spec.ts` — updated the percent-mode assertion for the new
  auto-adjust behaviour (filling one box now auto-fills the other to 100%, rather than
  requiring both to be typed).

## Non-goals

- `SplitDialog` stays 2-party (one recipient per transaction); no multi-recipient support
  was added there.
- No change to the split claim/settlement lifecycle (`useSplits.ts`, settlements,
  approval flow).
- No server or migration changes.
