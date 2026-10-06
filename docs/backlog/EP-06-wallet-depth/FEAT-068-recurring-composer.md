> **Status:** Open · **Filed:** 2026-10-02 · **Epic:** [EP-06](README.md)

# FEAT-068 — Recurring: mount the transaction composer

**What.** Same gap as [FEAT-065](FEAT-065-accounts-composer.md), on
`RecurringPage.tsx`: no composer, no way to add a one-off transaction from
this page today (only recurring *rules*). `recurring.html`'s mockup carries
the identical composer markup directly under the page header. `Composer`,
`TransactionForm` and `ImportModal` already exist and are already wired
identically on `WalletPage.tsx` and `Dashboard.tsx` — this item ports that
wiring, unchanged, to Recurring.

**Why now.** See [FEAT-065](FEAT-065-accounts-composer.md)'s "Why now" —
same design.md R7 citation, same mockup evidence
(`grep -c 'Add a transaction' docs/reference/proposal-v2/recurring.html` → 1).

Note: this page's much larger gap — the "Locked in every month" summary
band, the month calendar, "Worth a look" anomalies — is
[FEAT-020](FEAT-020-recurring-calendar.md) and
[FEAT-021](FEAT-021-recurring-anomalies.md) (EP-06, still open, R9): that is
genuinely unbuilt computation, not a restyle, and is explicitly out of scope
here. So is the mockup's "Detect from history" button (pattern-detection
over past transactions — a separate, undesigned analysis feature). This
item is the composer only.

## Acceptance criteria

- [ ] `RecurringPage.tsx` mounts `<Composer>` directly under the page
      header, above the recurring-rules list, gated on
      `accounts.length > 0`.
- [ ] Wiring mirrors `Dashboard.tsx`'s pattern exactly: `composerDraft`
      state, `openComposerForm`/`handleComposerConfirm`, a `TransactionForm`
      modal, an `ImportModal` for the Import shortcut, and the `N`-anywhere
      focus shortcut.
- [ ] `accounts`/`categories` already come from this page's existing
      `useWallet()` call; `hasAnthropicKey` from
      `useAppStore((s) => s.hasAnthropicKey)`.
- [ ] Submitting the composer POSTs a one-off transaction (distinct from
      this page's own "Add Recurring" rule-creation flow) and refreshes
      whatever this page reads that a new transaction could affect.
- [ ] A failed submit surfaces a toast, same pattern as this page's existing
      recurring-rule CRUD failures.
- [ ] This page's own "Add Recurring" button/flow (a different entity — a
      repeating rule, not a one-off transaction) is untouched; both
      affordances coexist exactly as in the mockup.
- [ ] No computed money figure changes, no schema change.

## Out of scope

Everything in [FEAT-020](FEAT-020-recurring-calendar.md) and
[FEAT-021](FEAT-021-recurring-anomalies.md) — the summary band, month
calendar, annual cost, "Worth a look" anomalies. The mockup's "Detect from
history" button (undesigned pattern-detection feature). This item is the
composer only.

**Still needed?** Open.
