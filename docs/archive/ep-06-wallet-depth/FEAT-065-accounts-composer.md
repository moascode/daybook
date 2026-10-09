> **Status:** Archived · **Last verified:** 2026-10-10 · **Filed:** 2026-10-02 · **Shipped:** 2026-10-09 (PR #252) · **Epic:** [EP-06](../../backlog/EP-06-wallet-depth/README.md)

# FEAT-065 — Accounts: mount the transaction composer

**What.** `AccountsPage.tsx` has no way to add a transaction at all today —
no composer, no "Add transaction" button, nothing. The mockup's
`accounts.html` carries the same composer markup as every other
transaction-bearing Wallet page: avatar, full-width field
(`Add a transaction — try "coffee 4.20 cash"`), and the Expense / Income /
Transfer / Split / Import CSV shortcut row, directly under the page header.
This is not a new feature — `Composer` (`composer/Composer.tsx`),
`TransactionForm` and `ImportModal` already exist and are already wired up
identically on `WalletPage.tsx` (`/wallet`) and `Dashboard.tsx`
(`/wallet/dashboard`). This item ports that exact, working wiring to
Accounts; it invents nothing.

**Why now.** `docs/backlog/EP-06-wallet-depth/design.md`'s R7 section (the
spec this design was built from) states the composer's placement in explicit,
general terms, not "Transactions-only": *"The primary action stops being a
button in the corner and becomes the first and largest interactive element
on the page … Absent from read-only pages (Reports) — there is nothing to
add there."* Accounts is not read-only — every mockup copy of it carries
the composer identically. Confirmed directly in the mockup's rendered DOM
(`grep -c 'Add a transaction' docs/reference/proposal-v2/*.html`): present
on `accounts.html`, `budgets.html`, `goals.html`, `recurring.html`,
`shared.html`, `transactions.html`, `dashboard.html` — **absent only** from
`reports.html`, exactly matching the design note above.

## Acceptance criteria

- [ ] `AccountsPage.tsx` mounts `<Composer>` directly under the page header
      (same position as `WalletPage.tsx`/`Dashboard.tsx`), gated on
      `accounts.length > 0` (same guard `Dashboard.tsx:450` uses).
- [ ] Wiring mirrors `Dashboard.tsx`'s pattern exactly: `composerDraft`
      state, `openComposerForm`/`handleComposerConfirm` callbacks, a
      `TransactionForm` modal instance pre-filled from `composerDraft`, an
      `ImportModal` instance for the Import shortcut, and the `N`-anywhere
      keyboard shortcut that focuses the composer field.
- [ ] `accounts`/`categories` come from the page's existing `useWallet()`
      call (add `categories` to the destructure — not currently pulled in
      this file); `hasAnthropicKey` from `useAppStore((s) => s.hasAnthropicKey)`,
      same as `WalletPage.tsx`/`Dashboard.tsx`.
- [ ] Submitting the composer POSTs via the same transaction-creation path
      the other two pages use, then refreshes this page's own account list
      (`loadAccounts`/balances) so a new transaction's effect on balances is
      visible without a manual reload — a stale balance after a successful
      add is a bug (CLAUDE.md §2 rule 10: a click that changes nothing on
      screen is the worst outcome a handler can produce).
- [ ] A failed submit surfaces a toast (`useToastStore`), same pattern as
      every other mutation on this page already uses — never a silent
      failure.
- [ ] This page's own "Add Account" button/flow is untouched — the composer
      adds *transactions*, not accounts; both affordances coexist exactly as
      they do in the mockup (composer above, "Add account" in the header).
- [ ] No computed balance/money figure changes, no schema change.

## Out of scope

Any change to the composer's own parsing, shortcuts, or styling — this item
only mounts the existing component on a page that doesn't have it yet.

**Still needed?** No — shipped 2026-10-09 (PR #252).
