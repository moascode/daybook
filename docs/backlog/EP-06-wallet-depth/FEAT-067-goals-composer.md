> **Status:** Open · **Filed:** 2026-10-02 · **Epic:** [EP-06](README.md)

# FEAT-067 — Goals: mount the transaction composer

**What.** Same gap as [FEAT-065](FEAT-065-accounts-composer.md), on
`GoalsPage.tsx`: no composer, no way to add a transaction from this page
today. `goals.html`'s mockup carries the identical composer markup directly
under the page header. `Composer`, `TransactionForm` and `ImportModal`
already exist and are already wired identically on `WalletPage.tsx` and
`Dashboard.tsx` — this item ports that wiring, unchanged, to Goals.

**Why now.** See [FEAT-065](FEAT-065-accounts-composer.md)'s "Why now" —
same design.md R7 citation, same mockup evidence
(`grep -c 'Add a transaction' docs/reference/proposal-v2/goals.html` → 1).

Note: this page's much larger gap — rings instead of the current linear bars,
funding rate, honest ETA, "Next milestones" — is
[FEAT-019](FEAT-019-goals-trajectory.md) (EP-06, still open, R9): that is
genuinely unbuilt computation (funding-rate math, projected completion
dates), not a restyle, and is explicitly out of scope here. This item is the
composer only.

## Acceptance criteria

- [ ] `GoalsPage.tsx` mounts `<Composer>` directly under the page header,
      above the goals summary/list, gated on `accounts.length > 0`.
- [ ] Wiring mirrors `Dashboard.tsx`'s pattern exactly: `composerDraft`
      state, `openComposerForm`/`handleComposerConfirm`, a `TransactionForm`
      modal, an `ImportModal` for the Import shortcut, and the `N`-anywhere
      focus shortcut.
- [ ] `accounts` already comes from this page's existing `useWallet()` call;
      add `categories` to that destructure (not currently pulled in this
      file); `hasAnthropicKey` from `useAppStore((s) => s.hasAnthropicKey)`.
- [ ] Submitting the composer POSTs a transaction, then refreshes this
      page's own goal-progress figures (a goal's "saved" amount reads off its
      linked account's balance) so progress moves without a manual reload.
- [ ] A failed submit surfaces a toast, same pattern as this page's existing
      goal CRUD failures.
- [ ] This page's own "New goal" button/flow (a different entity) is
      untouched; both affordances coexist exactly as in the mockup.
- [ ] No computed money figure changes, no schema change.

## Out of scope

Everything in [FEAT-019](FEAT-019-goals-trajectory.md) — rings, funding
rate, honest ETA, "Next milestones," "Add money" quick-contribution. This
item is the composer only.

**Still needed?** Open.
