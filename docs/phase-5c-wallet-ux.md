# Phase 5c — Wallet UX & Feature Improvements

> **Status:** Ready to implement. Scoped from multi-expert reviews (2026-05-31) + backlog distillation.
>
> Phases A–D + opening balance have shipped (PR #6). This document tracks remaining UX wins, tech debt, and features that need owner sign-off.
>
> Each item includes: the problem, where in the code, a fix sketch, rough effort (S/M/L), risk, and acceptance criteria. Add a Playwright spec for every behaviour change (CLAUDE.md §16).

---

## Overview

The wallet module is feature-complete for Phase 4 (home network multi-user) but has gaps in UX polish, mobile responsiveness, and accessibility. Phase 5c addresses these with incremental, low-risk improvements ranked by user value.

---

## B — UX Wins (Highest User Value)

### B1. Transaction free-text search ★ top pick
- **Problem:** Filter bar has date/type/account/category/tag but **no merchant/description search**. Finding "that Grab ride" means manual narrowing.
- **Where:** `src/modules/wallet/WalletPage.tsx:~196` (filter bar); `server/routes/wallet.ts` GET `/transactions`; `src/stores/wallet.store.ts` `WalletFilters`; `src/hooks/useWallet.ts` `TransactionFilters`.
- **Fix:** Add a `q` filter → server `WHERE (merchant LIKE @q OR description LIKE @q)` (escape `%`/`_`); debounced search input in filter bar; thread `q` through store + `loadTransactions`.
- **Effort:** S–M. **Risk:** Low.
- **Acceptance:** Typing substring narrows list; clearing restores; combines with existing filters. New e2e spec.

### B2. "Save & add another" on transaction form ★ top pick
- **Problem:** Logging N expenses = N full open/submit/close cycles. Repetitive friction.
- **Where:** `src/modules/wallet/TransactionForm.tsx:~270` (footer actions); `WalletPage.tsx` add handler.
- **Fix:** Add third footer button: submit, keep modal open, reset amount/merchant/description/tag while preserving date/account/type, refocus Amount (`autoFocus`).
- **Effort:** S. **Risk:** Low.
- **Acceptance:** Click saves, modal stays open with date/account/type retained, amount cleared and focused. New e2e spec.

### B3. Mobile-safe modal (max-height + scroll) ★ likely real breakage
- **Problem:** Modal is vertically centred with fixed padding, **no max-height/scroll**. ~8-field transaction form clips its top (Type) and bottom (Save) on 390px viewport.
- **Where:** `src/components/ui/Modal.tsx:~27` (`top-1/2 -translate-y-1/2`, no `max-h`/`overflow`).
- **Fix:** Add `max-h-[90vh] overflow-y-auto` to content; consider bottom-sheet layout (`top-4 translate-y-0`) on small screens.
- **Effort:** S. **Risk:** Low (shared primitive — smoke-test other modals: confirm, delete dialogs).
- **Acceptance:** At 390×~600, form scrolls; Type and Save both reachable. New mobile e2e spec.

### B4. Keyboard / screen-reader accessible rows & cards
- **Problem:** Clickable `<div onClick>` rows/cards have **no `role`/`tabIndex`/key handlers** — unreachable by keyboard, invisible to screen readers as interactive.
- **Where:** `src/modules/wallet/TransactionList.tsx:~79` (row); `src/modules/wallet/AccountCard.tsx:~68` (card).
- **Fix:** Convert to real `<button>` or `role="button"` + `tabIndex={0}` + Enter/Space handler + focus ring. Keep nested action buttons as separate `stopPropagation` controls.
- **Effort:** S–M. **Risk:** Low.
- **Acceptance:** Tab reaches rows/cards; Enter opens editor; visible focus ring. Accessibility e2e spec.

### B5. Zero-account onboarding (first-run dead end)
- **Problem:** With zero accounts, "Add Transaction" button is live but form has empty account dropdown and **can't be submitted**. No guidance.
- **Where:** `WalletPage.tsx:~150` (header button); `TransactionForm.tsx:~95` (empty options).
- **Fix:** When `accounts.length === 0`, replace "Add Transaction" with "Create your first account" CTA (or show inline prompt).
- **Effort:** S. **Risk:** Low (updates `e2e/21-mobile-responsive.spec.ts:104`).
- **Acceptance:** Zero-account state offers clear path to Accounts; no dead-end form. New e2e spec.

### B6. Always-visible account card actions
- **Problem:** Transaction rows have always-visible edit/delete, but account cards still hide them behind `opacity-0 group-hover` — invisible on touch.
- **Where:** `src/modules/wallet/AccountCard.tsx:~108`.
- **Fix:** Mirror transaction-row pattern (always rendered, emphasised on hover).
- **Effort:** S. **Risk:** Low.
- **Acceptance:** Edit/delete reachable without hover (touch + keyboard).

### B7. Dashboard/Reports charts reflow on mobile
- **Problem:** Summary `grid-cols-3` and chart `grid-cols-2` have **no `sm:` breakpoint** → squashed/unreadable at 390px.
- **Where:** `src/modules/wallet/Dashboard.tsx:~255` (summary), `~338` (charts); `ReportsPage.tsx` YoY chart.
- **Fix:** `grid-cols-1 sm:grid-cols-2/3`; verify Recharts `ResponsiveContainer` min-heights.
- **Effort:** S. **Risk:** Low.
- **Acceptance:** No horizontal overflow / unreadable charts at 390px. Mobile e2e spec.

### B8. Label unification (Total Balance vs Total Net Worth)
- **Problem:** Same number labelled "Total Balance" (Transactions hero) vs "Total Net Worth" (Accounts banner). Confusing.
- **Where:** `WalletPage.tsx:~176`; `AccountsPage.tsx:~70`.
- **Fix:** Pick one label app-wide. Decide if both surfaces should show it (hero vs filtered-summary scope).
- **Effort:** Trivial. **Risk:** Low (update e2e assertions in specs 10 + 26).

### B9. Colour consistency (positive money green)
- **Problem:** Positive money is brand-teal in hero but green in Net summary; income green ≠ brand green on the same page.
- **Where:** `WalletPage.tsx:~174` (hero), `~252` (Net); `tailwind.config.js` tokens.
- **Fix:** Choose one "positive money" colour; align income/net/hero.
- **Effort:** S. **Risk:** Low.

### B10. Surface Type & Category on recurring rule cards
- **Problem:** Type/Category fields are editable but **not shown at rest** on rule card.
- **Where:** `src/modules/wallet/RecurringPage.tsx:~177-224`.
- **Fix:** Add small type badge + category chip to card row.
- **Effort:** S. **Risk:** Low.

### B11. Touch targets ≥ 40px (WCAG guideline)
- **Problem:** Sidebar chevron (`h-7 w-7`) and row icon-buttons (`ghost size="sm"`) are below 44px guideline.
- **Where:** `src/components/layout/Sidebar.tsx:~147`; `src/modules/wallet/TransactionList.tsx:~140`.
- **Fix:** Enlarge hit area (padding/min-size) on small screens.
- **Effort:** S. **Risk:** Low.

### B12. Opening-balance caption clarity (edit case)
- **Problem:** "Before recording any transactions" is misleading when editing an account with existing transactions.
- **Where:** `src/modules/wallet/AccountForm.tsx:~151`.
- **Fix:** Reword, e.g. "Starting balance — added to all transactions to compute the account's balance." Consider negative (credit cards).
- **Effort:** Trivial.

---

## C — Tech Debt / Performance / Robustness

### C1. Batched balances endpoint (kills the N+1) ★ top pick
- **Problem:** `WalletPage` + `AccountsPage` each do `Promise.all(accounts.map(getAccountBalance))` → one HTTP round-trip per account.
- **Where:** `WalletPage.tsx:~84`; `AccountsPage.tsx:~27`; balance route `server/routes/wallet.ts:~62`.
- **Fix:** Add `GET /api/accounts/balances` → `{id, balance}[]` from a single grouped query.
- **Effort:** M. **Risk:** Low.
- **Acceptance:** Hero/net-worth render with one request; values match old per-account sums.

### C2. Server-side input validation
- **Problem:** `POST /transactions` (budgets/goals) accept any `type`, negative/non-numeric `amount`, missing `date`. API is LAN-reachable beyond client.
- **Where:** `server/routes/wallet.ts` (`insertTransaction`, POST/PATCH handlers).
- **Fix:** Validate `type ∈ {income,expense,transfer}`, `amount` finite & > 0, ISO `date`, transfer requires distinct `destinationAccountId` → 400.
- **Effort:** M. **Risk:** Low.

### C3. Consistent error toasts across wallet CRUD
- **Problem:** Only `CsvImport` + `RecurringPage` use toasts. Other pages `await` mutations with no try/catch → failed add/delete silently fail.
- **Where:** Respective `handleAdd/Update/Delete` callbacks.
- **Fix:** Wrap in try/catch + `addToast` on failure. Consider small `useMutationWithToast` helper.
- **Effort:** M. **Risk:** Low.

### C4. Export respects active filters + use PapaParse
- **Problem:** `exportTransactions` always pulls **all** rows (ignores filters); CSV is hand-rolled despite PapaParse approved.
- **Where:** `src/hooks/useWallet.ts:~423`; `server/routes/wallet.ts` `/transactions/export`.
- **Fix:** Pass active filters to export query; build CSV with `Papa.unparse`.
- **Effort:** S. **Risk:** Low.

### C5. Extract `useCrudModal` + `<ConfirmDeleteModal>`
- **Problem:** Budgets/Goals/Recurring re-implement near-identical `formOpen`/`editingX`/`confirmDeleteId` state + delete modal.
- **Where:** `BudgetsPage.tsx`, `GoalsPage.tsx`, `RecurringPage.tsx`.
- **Fix:** Shared `useCrudModal<T>()` hook + `<ConfirmDeleteModal>`.
- **Effort:** M. **Risk:** Low (pure refactor; covered by e2e 13/14/16).

### C6. Remove dead code / wire up unused helpers
- **Problem:** `processRecurringTransactions` is exported but unused (App posts inline). `getMonthlySpending` exported but BudgetsPage reimplements.
- **Where:** `src/hooks/useWallet.ts`, `BudgetsPage.tsx:~36`.
- **Fix:** Route App's boot call through hook or delete; use `getMonthlySpending` in BudgetsPage or delete.
- **Effort:** S. **Risk:** None.

### C7. Replace hand-rolled export dropdown with Radix DropdownMenu
- **Problem:** Export menu is custom `div` with no Escape, outside-click, `role="menu"`, focus management.
- **Where:** `src/modules/wallet/WalletPage.tsx:~144`.
- **Fix:** Use `@radix-ui/react-dropdown-menu` (already approved, CLAUDE.md §4).
- **Effort:** S. **Risk:** Low.

### C8. BudgetsPage loads ALL transactions (unbounded)
- **Problem:** `loadTransactions({})` with no date filter just to sum current month.
- **Where:** `src/modules/wallet/BudgetsPage.tsx:~33`.
- **Fix:** Pass month range or use spending-summary endpoint (C9).
- **Effort:** S. **Risk:** Low.

### C9. DB-side aggregation for dashboards (defer until volume grows)
- **Problem:** Dashboard/Reports compute weekly/category/account/merchant rollups **in memory** over full period.
- **Where:** `Dashboard.tsx:~110-208`, `ReportsPage.tsx`.
- **Fix:** `GET /api/transactions/summary?dateFrom&dateTo` returning aggregates. **Defer** — fine for personal year-or-two of data.
- **Effort:** M. **Risk:** Low.

### C10. Chart axis currency formatting
- **Problem:** Axes hardcode `(v/1000).toFixed(0)+'k'` → "0k" for typical <1k personal amounts.
- **Where:** `Dashboard.tsx:~328,~375`; `ReportsPage.tsx`.
- **Fix:** `formatAxisMYR` helper (plain number <10k, `k` above).
- **Effort:** S. **Risk:** Low.

### C11. Sidebar/drawer height & long nav list
- **Problem:** On 390px drawer, auto-expanded wallet tree can push Settings below fold.
- **Where:** `src/components/layout/Sidebar.tsx`.
- **Effort:** S. **Risk:** Low.

### C12. Server request/error logging middleware
- **Problem:** Failures over LAN invisible; some handlers throw bare 500s with no body.
- **Where:** `server/index.ts`, `server/routes/*`.
- **Fix:** Error-handling middleware returning consistent `{error}` shape + minimal request logging.
- **Effort:** S. **Risk:** Low.

### C13. Chart text alternatives / colour-only status
- **Problem:** Recharts output inaccessible to screen readers; net positive/negative is colour-only.
- **Where:** `Dashboard.tsx`, `ReportsPage.tsx`, `WalletPage.tsx:~255`.
- **Fix:** Tabular fallback or `aria` summary; glyph/label to net.
- **Effort:** M. **Risk:** Low.

---

## D — Needs Owner Sign-Off (Product / Schema / Feature)

These require explicit approval before implementation (CLAUDE.md §2 Rule 3).

### D1. Account archiving / reordering
Accounts only sort by `created_at`. Closed accounts can't be hidden without deleting history. Needs `is_archived` and/or `sort_order` columns (**schema change**). Effort: M.

### D2. Budget rollover & per-month history
Budgets are single monthly limit with no carry-over and no past-month view. Needs schema (e.g. per-month budget rows or rollover column). Effort: M.

### D3. Richer recurrence
Only monthly/weekly today. No yearly/biweekly/custom interval, no end-date / occurrence count. Schema + `advanceDate` additions. Effort: M.

### D4. Bulk transaction actions
Multi-select to delete/recategorise/tag (pairs well with CSV imports). No schema; UI + batch endpoints. Effort: M.

### D5. Transfer-to-deleted-account guard
`destination_account_id` is `ON DELETE SET NULL`. After deleting destination, transfer becomes one-legged. Decide behaviour (block delete / convert / surface). Effort: M.

### D6. Keyboard shortcut to add a transaction
Mirror Tasks module shortcuts (quick-add hotkey / FAB). No schema. Effort: S.

---

## Suggested Implementation Order

1. **B1–B4**: Highest daily-use value, all low risk.
   - B1: Transaction search
   - B2: Save & add another
   - B3: Mobile-safe modal
   - B4: Accessible rows

2. **C1–C4**: Robustness/perf, low risk.
   - C1: Batched balances
   - C2: Server validation
   - C3: Error toasts
   - C4: Export filters

3. **C5–C7**: Refactors + cleanup.

4. **Polish**: B6–B12, C10/C13.

5. **Sign-off**: D1–D6 as scope approved.

---

## Notes

- Add Playwright e2e spec per behaviour change (CLAUDE.md §16).
- Run full test suite + lint + both typechecks before each commit.
- Pre-existing items requiring sign-off: do not edit schema without explicit approval (CLAUDE.md §2 Rule 3).
