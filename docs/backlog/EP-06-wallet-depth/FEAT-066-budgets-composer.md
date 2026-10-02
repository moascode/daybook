> **Status:** Open · **Filed:** 2026-10-02 · **Epic:** [EP-06](README.md)

# FEAT-066 — Budgets: mount the transaction composer

**What.** Same gap as [FEAT-065](FEAT-065-accounts-composer.md), on
`BudgetsPage.tsx`: no composer, no way to add a transaction from this page
today. `budgets.html`'s mockup carries the identical composer markup
directly under the page header, above the month summary band. `Composer`,
`TransactionForm` and `ImportModal` already exist and are already wired
identically on `WalletPage.tsx` and `Dashboard.tsx` — this item ports that
wiring, unchanged, to Budgets.

**Why now.** See [FEAT-065](FEAT-065-accounts-composer.md)'s "Why now" —
same design.md R7 citation, same mockup evidence
(`grep -c 'Add a transaction' docs/reference/proposal-v2/budgets.html` → 1).

## Acceptance criteria

- [ ] `BudgetsPage.tsx` mounts `<Composer>` directly under the page header,
      above the `BudgetSuggestions` card and the month summary band, gated
      on `accounts.length > 0`.
- [ ] Wiring mirrors `Dashboard.tsx`'s pattern exactly: `composerDraft`
      state, `openComposerForm`/`handleComposerConfirm`, a `TransactionForm`
      modal, an `ImportModal` for the Import shortcut, and the `N`-anywhere
      focus shortcut.
- [ ] `accounts`/`categories` already come from this page's existing
      `useWallet()` call; `hasAnthropicKey` from
      `useAppStore((s) => s.hasAnthropicKey)`.
- [ ] Submitting the composer POSTs a transaction, then refreshes this
      page's own budget/spending figures (`getBudgetSpending` et al.) so a
      newly added expense is reflected in the pace bars without a manual
      reload — a budget row that doesn't move after a matching transaction
      is added is a correctness bug, not a cosmetic one.
- [ ] A failed submit surfaces a toast, same pattern as this page's existing
      budget CRUD failures.
- [ ] This page's own "Add Budget" button/flow (a different entity — a
      monthly limit, not a transaction) is untouched; both affordances
      coexist exactly as in the mockup.
- [ ] No change to the already-shipped summary band/pace-notch design
      (FEAT-017, archived — its stats are a deliberate, reviewed
      simplification of the mockup, not drift to "fix" here).
- [ ] No computed money figure changes, no schema change.

## Out of scope

Anything from FEAT-017's already-settled simplifications (the "Remaining /
Categories / Over budget" stats vs. the mockup's "Left to spend / Projected
finish / On track", or the lack of per-category Status chips) — those were a
reviewed, intentional decision, not something this item revisits. This item
is the composer only.

**Still needed?** Open.
