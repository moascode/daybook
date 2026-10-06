> **Status:** Open · **Filed:** 2026-10-02 · **Epic:** [EP-06](README.md)

# FEAT-069 — Shared: mount the transaction composer; category-coloured activity icons

**What.** Two independent, verified gaps on `SharedPage.tsx`:

**1. No composer.** Same gap as [FEAT-065](FEAT-065-accounts-composer.md):
`shared.html`'s mockup carries the identical composer markup directly under
the page header, above the Balances/Settle-up card. `Composer`,
`TransactionForm` and `ImportModal` already exist and are already wired
identically on `WalletPage.tsx` and `Dashboard.tsx` — this item ports that
wiring, unchanged, to Shared. See
[FEAT-065](FEAT-065-accounts-composer.md)'s "Why now" for the design.md R7
citation; mockup evidence:
`grep -c 'Add a transaction' docs/reference/proposal-v2/shared.html` → 1.

**2. `SharedActivity.tsx`'s row avatar is a generic `Receipt` icon for every
row**, regardless of category — the same kind of gap as
[FEAT-063](FEAT-063-transactions-category-avatar.md), but a **separate
component with its own, independent `.tavatar` implementation**
(`SharedActivity.tsx:331`), not the one `TransactionList.tsx` uses, so
fixing FEAT-063 does not fix this file. The mockup's `shared.html` activity
rows each carry a distinct, category-matched icon (confirmed in its
rendered DOM: a grocery-bag icon for "Weekly groceries," a scissors icon for
"Internet — August," a play icon for "Netflix — family plan," a home icon
for "Rent — August" — `docs/reference/proposal-v2/shared.html:367-415`).
The real row currently renders the same `Receipt` SVG for all four, varying
only the background palette colour (`SharedActivity.tsx:331`,
`style={{ background: rgb(${palette.bg}) }}`).

## Acceptance criteria

**Composer**
- [ ] `SharedPage.tsx` mounts `<Composer>` directly under the page header,
      above the Balances/Settle-up card, gated on `accounts.length > 0`.
- [ ] Wiring mirrors `Dashboard.tsx`'s pattern exactly: `composerDraft`
      state, `openComposerForm`/`handleComposerConfirm`, a `TransactionForm`
      modal, an `ImportModal` for the Import shortcut, the `N`-anywhere
      focus shortcut.
- [ ] `accounts`/`categories` already come from this page's existing
      `useWallet()` call; `hasAnthropicKey` from
      `useAppStore((s) => s.hasAnthropicKey)`.
- [ ] A failed submit surfaces a toast, same as this page's existing
      mutation failures.
- [ ] No change to the already-merged Balances+Settle-up card
      (`SharedBalances.tsx` — an explicit, documented owner decision to
      combine the mockup's two separate cards; not drift to "fix").
      No change to the absence of a header "Record a payment" button for the
      same reason.

**Activity icons**
- [ ] `SharedActivity.tsx`'s row avatar renders the underlying transaction's
      category icon/colour, same lookup approach as
      [FEAT-063](FEAT-063-transactions-category-avatar.md) (share the same
      icon-name → component table rather than inventing a second one — if
      FEAT-063 lands first, import its lookup; if this item lands first,
      extract the lookup somewhere both files can use).
- [ ] Uncategorised/transfer rows keep a sane fallback (the current
      `Receipt` icon is a reasonable fallback for "no category" — never a
      blank avatar).
- [ ] No change to the row's palette-based background when no category
      icon/colour is resolvable.
- [ ] No computed money figure changes, no schema change.

## Out of scope

Everything in [FEAT-024](FEAT-024-shared-minimum-transfers.md) (group-wide
minimum-transfer set) and [FEAT-025](FEAT-025-shared-split-rules.md)
(editable split rules) — both already tracked, both genuinely unbuilt
computation, not restyle.

**Still needed?** Open.
