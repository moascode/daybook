# Wallet Module — Improvement Backlog

> Pick-up-ready backlog distilled from the second multi-expert review round
> (code correctness, UX-changes, end-to-end UX, and further-improvements agents),
> 2026-05-31. Companion to `docs/wallet-ux-review.md` (the original review).
>
> Each item lists: the problem, where it lives (`file:line`, approximate — verify
> before editing), a fix sketch, rough effort (S/M/L), risk, and acceptance
> criteria. Add a Playwright spec for every behaviour change (CLAUDE.md §16).
> Flags marked **⚑ sign-off** need owner approval (schema change / new package /
> phase jump) per CLAUDE.md §2.

---

## Already shipped (context — do NOT redo)

On branch `claude/wallet-design-ux-review-cTMY1` / PR #6:

- **Phase A** — wallet nav moved to a grouped, collapsible left-panel section.
- **Phase B (features)** — recurring rules actually post (boot catch-up + "Post
  now") with Type/Category fields; dead Budget "Period" stub removed.
- **Phase C** — Dashboard/Reports de-duplicated (Dashboard dropped Custom range).
- **Phase D** — Total Balance hero, default account in the form, always-visible
  row edit/delete, empty-state clutter hidden, Net-colour consistency, Dashboard
  CTA.
- **Opening balance** — `accounts.opening_balance` (schema v2).
- **Section A remediation** — UTC→local server dates; boot auto-post toast +
  `dataVersion` refresh; "Post now" only advances when due + in-flight disable;
  server validates recurring type/frequency; net-worth effect no longer refetches
  on filter change; sidebar collapse resets on leaving `/wallet`; single-currency
  lock (per-account currency selector removed).

The items below are everything the reviews raised that is **not yet done**.

---

## B — UX wins (highest user value)

### B1. Transaction free-text search ★ top pick
- **Problem:** the filter bar has date/type/account/category/tag but **no
  merchant/description search** — finding "that Grab ride" means manual narrowing.
- **Where:** filter bar `src/modules/wallet/WalletPage.tsx:~196`; server list query
  `server/routes/wallet.ts` (`GET /transactions`); filters type in
  `src/stores/wallet.store.ts` (`WalletFilters`) + `useWallet.ts` (`TransactionFilters`).
- **Fix:** add a `q` filter → server `WHERE (merchant LIKE @q OR description LIKE @q)`
  (escape `%`/`_`); add a debounced search input to the filter bar; thread `q`
  through the store filters + `loadTransactions`.
- **Effort:** S–M. **Risk:** low.
- **Acceptance:** typing a merchant substring narrows the list; clearing restores it;
  combines with existing filters. New spec.

### B2. "Save & add another" on the transaction form ★ top pick
- **Problem:** logging N expenses = N full open/submit/close cycles.
- **Where:** `src/modules/wallet/TransactionForm.tsx:~270` (footer actions);
  `WalletPage.tsx` add handler.
- **Fix:** add a third footer button that submits, keeps the modal open, resets
  amount/merchant/description/tag while **preserving** date+account+type, and
  refocuses Amount (`autoFocus` / a ref).
- **Effort:** S. **Risk:** low.
- **Acceptance:** clicking it saves the row, keeps the modal open with date/account/
  type retained and amount cleared/focused. New spec.

### B3. Mobile-safe modal (max-height + scroll) ★ likely real breakage
- **Problem:** `Modal` is vertically centred with fixed padding and **no
  max-height/scroll**, so the ~8-field transaction form can clip its top (Type) and
  bottom (Save) on a short/390px viewport.
- **Where:** `src/components/ui/Modal.tsx:~27` (`top-1/2 -translate-y-1/2`, no
  `max-h`/`overflow`).
- **Fix:** add `max-h-[90vh] overflow-y-auto` to the content; consider a
  bottom-sheet / `top-4 translate-y-0` layout on small screens.
- **Effort:** S. **Risk:** low (shared primitive — smoke-test other modals).
- **Acceptance:** at 390×~600 the transaction form scrolls; Type and Save are both
  reachable. New mobile spec.

### B4. Keyboard / screen-reader accessible rows & cards
- **Problem:** clickable `<div onClick>` rows/cards have **no `role`/`tabIndex`/key
  handler** — unreachable by keyboard, invisible to SR as interactive.
- **Where:** `src/modules/wallet/TransactionList.tsx:~79` (row),
  `src/modules/wallet/AccountCard.tsx:~68` (card).
- **Fix:** convert to a real `<button>`/`role="button"` + `tabIndex={0}` + Enter/Space
  handler + focus ring; keep nested action buttons as separate stop-propagation
  controls.
- **Effort:** S–M. **Risk:** low.
- **Acceptance:** Tab reaches a row/card; Enter opens its editor; visible focus ring.

### B5. First-run dead end on the transactions page
- **Problem:** with zero accounts the header "Add Transaction" is live but the form
  has an empty account dropdown and **can't be submitted** — no guidance.
- **Where:** `WalletPage.tsx:~150` (header button), `TransactionForm.tsx:~95`
  (empty options). (Note: a mobile e2e currently expects the button to open the
  dialog with no accounts — update it alongside.)
- **Fix:** when `accounts.length === 0`, replace/disable "Add Transaction" with a
  "Create your first account" CTA (or open an inline prompt).
- **Effort:** S. **Risk:** low (touches `e2e/21-mobile-responsive.spec.ts:104`).
- **Acceptance:** zero-account state offers a clear path to Accounts; no dead-end form.

### B6. Account-card actions are still hover-only
- **Problem:** transaction rows were fixed to always-visible actions, but account
  cards still hide edit/delete behind `opacity-0 group-hover` — invisible on touch.
- **Where:** `src/modules/wallet/AccountCard.tsx:~108`.
- **Fix:** mirror the transaction-row pattern (always rendered, emphasised on hover).
- **Effort:** S. **Risk:** low.
- **Acceptance:** edit/delete reachable without hover (touch/keyboard).

### B7. Dashboard / Reports charts don't reflow on mobile
- **Problem:** summary `grid-cols-3` and chart `grid-cols-2` have no `sm:`
  breakpoint → squashed/unreadable at 390px.
- **Where:** `src/modules/wallet/Dashboard.tsx:~255` (summary), `~338` (charts);
  `ReportsPage.tsx` YoY chart.
- **Fix:** `grid-cols-1 sm:grid-cols-2/3`; verify Recharts `ResponsiveContainer`
  min-heights.
- **Effort:** S. **Risk:** low.
- **Acceptance:** no horizontal overflow / unreadable charts at 390px.

### B8. Unify "Total Balance" vs "Total Net Worth" naming
- **Problem:** the same number is labelled "Total Balance" (Transactions hero) and
  "Total Net Worth" (Accounts banner).
- **Where:** `WalletPage.tsx:~176`, `AccountsPage.tsx:~70`.
- **Fix:** pick one label app-wide (and decide whether the two surfaces should both
  show it; see the reviewer note about hero-vs-filtered-summary scope clarity).
- **Effort:** trivial. **Risk:** low (update `e2e/10` / `e2e/26` text assertions).

### B9. Colour-consistency pass (two greens / hero brand vs green Net)
- **Problem:** positive money is brand-teal in the hero but green in the Net summary;
  income green ≠ brand green sit side by side.
- **Where:** `WalletPage.tsx:~174` (hero), `~252` (Net); `tailwind.config.js` tokens.
- **Fix:** choose one "positive money" colour; align income/net/hero.
- **Effort:** S. **Risk:** low.

### B10. Surface Type & Category on the recurring rule card
- **Problem:** the new Type/Category fields are editable but **not shown at rest** on
  the rule card.
- **Where:** `src/modules/wallet/RecurringPage.tsx:~177-224`.
- **Fix:** add a small type badge + category chip to the card row.
- **Effort:** S. **Risk:** low.

### B11. Touch targets ≥ ~40px
- **Problem:** sidebar chevron (`h-7 w-7`) and row icon-buttons (`ghost size="sm"`)
  are below the 44px guideline.
- **Where:** `src/components/layout/Sidebar.tsx:~147`,
  `src/modules/wallet/TransactionList.tsx:~140`.
- **Fix:** enlarge hit area (padding/min-size) on small screens.
- **Effort:** S. **Risk:** low.

### B12. Opening-balance caption wording for the edit case
- **Problem:** "before recording any transactions" is misleading when editing an
  account that already has transactions.
- **Where:** `src/modules/wallet/AccountForm.tsx:~151`.
- **Fix:** reword, e.g. "Starting balance — added to all transactions to compute the
  account's balance." Consider whether negative is allowed (credit cards).
- **Effort:** trivial.

---

## C — Tech debt / performance / robustness

### C1. Batched balances endpoint (kills the N+1) ★ top pick
- **Problem:** `WalletPage` and `AccountsPage` each do
  `Promise.all(accounts.map(getAccountBalance))` → one HTTP round-trip per account,
  each running 4 `SUM` scans server-side.
- **Where:** `WalletPage.tsx:~84`, `AccountsPage.tsx:~27`; balance route
  `server/routes/wallet.ts:~62`.
- **Fix:** add `GET /api/accounts/balances` → `{id, balance}[]` from a single grouped
  query (`SELECT account_id, type, SUM(amount) … GROUP BY` + a transfers-in pass +
  opening_balance). Keep the per-account endpoint for single use. Update the two
  callers + `useWallet`.
- **Effort:** M. **Risk:** low (additive endpoint; mirror the existing formula incl.
  opening_balance and transfers, both legs).
- **Acceptance:** hero/net-worth render with one request; values match the old
  per-account sums (regression test).

### C2. Server-side input validation
- **Problem:** `POST /transactions` (and budgets/goals) accept any `type`, negative/
  non-numeric `amount`, missing `date`, etc. — the API is LAN-reachable beyond the
  client. (Recurring is already guarded as of Section A.)
- **Where:** `server/routes/wallet.ts` (`insertTransaction`, transaction/budget/goal
  POST/PATCH).
- **Fix:** validate `type ∈ {income,expense,transfer}`, `amount` finite & > 0, ISO
  `date`, transfer requires a distinct `destinationAccountId`; return 400. A tiny
  shared validator keeps it DRY.
- **Effort:** M. **Risk:** low. **Acceptance:** bad payloads → 400; good ones
  unaffected. API-level spec.

### C3. Consistent error toasts across wallet CRUD
- **Problem:** only `CsvImport`/`RecurringPage` use toasts; `WalletPage`/
  `AccountsPage`/`BudgetsPage`/`GoalsPage` `await` mutations with no try/catch → a
  failed add/delete rejects silently (modal may hang).
- **Where:** the respective `handleAdd/Update/Delete` callbacks.
- **Fix:** wrap mutations in try/catch + `addToast` on failure (+ keep modal state
  sane). Consider a small `useMutationWithToast` helper.
- **Effort:** M. **Risk:** low.

### C4. Export respects active filters + use PapaParse
- **Problem:** `exportTransactions` always pulls **all** rows (ignores filters);
  CSV is hand-rolled despite PapaParse being approved.
- **Where:** `src/hooks/useWallet.ts:~423`; `server/routes/wallet.ts` (`/transactions/export`).
- **Fix:** pass the active filters to the export query; build CSV with `Papa.unparse`.
- **Effort:** S. **Risk:** low. **Acceptance:** export matches the on-screen filtered
  set; quoting handles commas/quotes.

### C5. Extract `useCrudModal` + `<ConfirmDeleteModal>`
- **Problem:** Budgets/Goals/Recurring re-implement near-identical
  `formOpen`/`editingX`/`confirmDeleteId` state and a byte-near-identical delete
  modal.
- **Where:** `BudgetsPage.tsx`, `GoalsPage.tsx`, `RecurringPage.tsx`.
- **Fix:** a `useCrudModal<T>()` hook + a shared `<ConfirmDeleteModal>`.
- **Effort:** M. **Risk:** low (pure refactor; covered by e2e 13/14/16).

### C6. Remove dead code / wire up unused helpers
- **Problem:** `processRecurringTransactions` is exported from `useWallet` but unused
  (App posts inline); `getMonthlySpending` is exported but `BudgetsPage` reimplements
  the same loop inline.
- **Where:** `src/hooks/useWallet.ts` (`~378`, `~340`), `BudgetsPage.tsx:~36`.
- **Fix:** route App's boot call through the hook (or delete the method); use
  `getMonthlySpending` in BudgetsPage (or delete it).
- **Effort:** S. **Risk:** none.

### C7. Replace the hand-rolled export dropdown with Radix `DropdownMenu`
- **Problem:** the export menu is a custom `div` with no Escape, no outside-click, no
  `role="menu"`, no focus management.
- **Where:** `src/modules/wallet/WalletPage.tsx:~144`.
- **Fix:** use `@radix-ui/react-dropdown-menu` (already approved, CLAUDE.md §4).
- **Effort:** S. **Risk:** low.

### C8. BudgetsPage loads ALL transactions
- **Problem:** `loadTransactions({})` with no date filter just to sum the current
  month — unbounded over time.
- **Where:** `src/modules/wallet/BudgetsPage.tsx:~33`.
- **Fix:** pass the month range, or use a spending-summary endpoint (see C9).
- **Effort:** S. **Risk:** low.

### C9. DB-side aggregation for dashboards (defer until volume grows)
- **Problem:** Dashboard/Reports compute weekly/category/account/merchant rollups
  **in memory** over the full period; CLAUDE.md §9.2 says these should be a DB
  `GROUP BY` "at scale."
- **Where:** `Dashboard.tsx:~110-208`, `ReportsPage.tsx`.
- **Fix:** `GET /api/transactions/summary?dateFrom&dateTo` returning category/account/
  weekly aggregates. **Defer** — fine for a personal year-or-two of data; flagged so
  it's on the radar.
- **Effort:** M. **Risk:** low.

### C10. Chart axis currency formatting
- **Problem:** axes hardcode `(v/1000).toFixed(0)+'k'` → "0k" for typical sub-1k
  personal amounts.
- **Where:** `Dashboard.tsx:~328,~375`; `ReportsPage.tsx`.
- **Fix:** a `formatAxisMYR` helper (plain number under ~10k, `k` above).
- **Effort:** S. **Risk:** low.

### C11. Sidebar/drawer height & long nav list
- **Problem:** on a 390px drawer the auto-expanded wallet tree can push Settings
  below the fold (mitigated by `overflow-y-auto`, but worth a look).
- **Where:** `src/components/layout/Sidebar.tsx`.
- **Effort:** S. **Risk:** low.

### C12. Server request/error logging middleware
- **Problem:** failures over the LAN are invisible; some handlers throw bare 500s
  with no body.
- **Where:** `server/index.ts`, `server/routes/*`.
- **Fix:** a small error-handling middleware returning a consistent `{error}` shape +
  minimal request logging.
- **Effort:** S. **Risk:** low.

### C13. Chart text alternatives / colour-only status
- **Problem:** Recharts output is inaccessible to SR; net positive/negative is
  colour-only (over-budget already has an icon+label).
- **Where:** `Dashboard.tsx`, `ReportsPage.tsx`, `WalletPage.tsx:~255`.
- **Fix:** add a tabular fallback or `aria` summary; add a glyph/label to net.
- **Effort:** M. **Risk:** low.

---

## D — Needs owner sign-off (product / schema / package)

> Multi-currency was already resolved this round (single-currency lock). The rest:

### D1. ⚑ Account archiving / reordering
- Accounts only sort by `created_at`; a closed account can't be hidden without
  deleting its history. Needs `is_archived` and/or `sort_order` columns
  (**schema change**). Effort: M.

### D2. ⚑ Budget rollover & per-month history
- Budgets are a single monthly limit with no carry-over and no past-month view.
  Needs schema (e.g. per-month budget rows or a rollover column). Effort: M.

### D3. ⚑ Richer recurrence
- Only monthly/weekly today; no yearly/biweekly/custom interval, no end-date /
  occurrence count. `advanceDate` + schema additions. Effort: M.

### D4. Bulk transaction actions
- Multi-select to delete/recategorise/tag (pairs well with CSV-imported rows).
  No schema; UI + batch endpoints. Effort: M.

### D5. Transfer-to-deleted-account guard
- `destination_account_id` is `ON DELETE SET NULL`; after deleting the destination a
  transfer becomes a one-legged row that still debits the source. Decide intended
  behaviour (block delete / convert / surface). May imply behaviour/schema change.
  Effort: M.

### D6. Keyboard shortcut to add a transaction
- Mirror the Tasks module's shortcuts (e.g. a quick-add hotkey / FAB). No schema.
  Effort: S.

---

## Suggested "do next" order

1. **B1** transaction search · **B2** save & add another · **B3** mobile-safe modal
   · **B4** accessible rows — the highest daily-use value, all low risk.
2. **C1** batched balances · **C2** server validation · **C3** error toasts · **C4**
   export-respects-filters — robustness/perf, low risk.
3. **C5/C6/C7** refactors + dead-code + Radix dropdown — cleanup.
4. Polish: **B6–B12**, **C10/C13**.
5. Sign-off items **D1–D6** as you decide scope.

Add a Playwright spec per behaviour change; run the full suite + lint + both
typechecks before each commit (CLAUDE.md §16). Note pre-existing items requiring
sign-off before touching the schema (CLAUDE.md §2 rule 3).
