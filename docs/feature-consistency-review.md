# Feature Consistency Review

**Date:** 2026-07-19 · **Scope:** full codebase (client + server) as of `main` after PR #34
**Type:** analysis only — no code was changed. Each finding lists the files involved so any item can be turned into a scoped fix PR.

The review confirms the suspicion: several core behaviours (delete confirmation, error surfacing, balance fetching, date-range math, split math, form validation) are each implemented 3–5 different ways. Most divergence is the residue of features landing in different waves (Phase 4 → 5b → 5c) without the older pages being migrated to the newer pattern.

**Legend:** 🔴 bug / behaviour defect · 🟠 inconsistency worth unifying · 🟡 polish / doc drift

---

## 1. Bugs found while comparing implementations (fix first)

### 1.1 🔴 Default transaction filter dates shift by one day (UTC bug)
`src/stores/wallet.store.ts:54-71` — `getDefaultFilters()` builds the default "this month" range with `date.toISOString().slice(0, 10)`. `toISOString()` converts to UTC, so in Malaysia (UTC+8) `new Date(2026, 6, 1)` serialises as `2026-06-30`. **The Wallet page's default filter starts on the last day of the previous month and ends one day before month-end** — day-one and month-end transactions are mis-scoped by default.
Ironically, `WalletPage.tsx:25-39` (`getMonthRange`) has a comment explaining exactly this trap and avoids it. The store predates that fix and was never updated. → Use one shared month-range helper (see §3.4).

### 1.2 🔴 Export can silently omit visible/selected transactions
`server/routes/wallet.ts:432-483` — `GET /transactions/export` hard-scopes to `t.user_id = @userId` and ignores the `view` param. But the list view (`GET /transactions`, "all" view) also shows other members' transactions on shared-in accounts, and the Export modal pre-selects **all listed rows** (`ExportModal.tsx:36`). Any selected shared-account rows are dropped server-side without a warning, so the exported file doesn't match the on-screen selection count shown on the buttons ("CSV (12)" can produce 9 rows).

### 1.3 🔴 Recurring-rule amount is never validated on the server
`server/routes/wallet.ts:998-1028` — `POST /recurring-transactions` validates `type` and `frequency` but not `amount` (no `positiveAmountError` call) and not `nextDueDate` format — unlike transactions (C2 validation), budgets, and goals. A rule with amount `0`, negative, or `NaN`, or a malformed date, is accepted and then **auto-posts corrupt transactions on every app boot** via `/recurring-transactions/process`. Same gap on PATCH. (Client-side the form guards `amount > 0`, but every other entity got server-side C2 validation precisely to not rely on that.)
Related smaller gaps: `POST /accounts` and `POST /goals` don't validate `name` (missing name → SQLite `NOT NULL` error → 500 instead of a clean 400; categories do validate).

### 1.4 🔴 GoalsPage still uses the N-request balance fan-out that C1 removed
`src/modules/wallet/GoalsPage.tsx:38-48` — `Promise.all(accs.map(a => getAccountBalance(a.id)))` is exactly the per-account fan-out Wave 3 (C1) replaced with the batched `GET /accounts/balances`. Also, `AccountCard.tsx:55-62` still self-fetches its own balance per card, so the **Accounts page issues N+1 balance requests** (N cards + 1 batched call for the net-worth banner) even though the batched result already contains every card's number. → Fetch once with `getAccountBalances()` on both pages and pass balances down as props; the per-account endpoint then only serves the UAT runner.

### 1.5 🔴 Dashboard / Reports / Budgets clobber the global transaction store
`useWallet.loadTransactions()` always writes its result into the shared Zustand store (`setTransactions`). Dashboard (`Dashboard.tsx:99`) and Reports (`ReportsPage.tsx:65,85` — which loads the **entire history**) call it for their own local data, and BudgetsPage loads a month-bounded slice into it (`BudgetsPage.tsx:40`). So visiting any of these pages replaces the transaction list every other consumer sees. WalletPage happens to refetch on mount, which masks it, but it's a divergence trap (and doubles queries). → Give the hook a read-only variant (`fetchTransactions`) that doesn't touch the store, and use it for page-local data.

### 1.6 🟠 Bulk delete is N sequential requests with broken partial-failure handling
`WalletPage.tsx:191-204` — deletes loop one `DELETE /transactions/:id` at a time; on a mid-loop error the earlier rows are already gone, yet the code clears the selection and closes the dialog as if it succeeded (only a generic toast is shown). There's a batch **import** endpoint but no batch delete. Same sequential-loop pattern in task undo (`useTasks.ts:202-226` re-POSTs the subtree row by row) and Settings save (`SettingsPage.tsx:47-49`, sequential PUTs, no error handling at all — a failed save still needs a toast).

---

## 2. Dead code and unreachable features

| # | Item | Location | Notes |
|---|------|----------|-------|
| 2.1 | **`SplitDialog.tsx` (280 lines) — dead** | `src/modules/wallet/SplitDialog.tsx` | Imported nowhere. PR #27 wired the row action to the new single-recipient `ShareDialog` and orphaned this multi-member dialog. Consequence (see 4.1): a multi-member split of a *single* transaction is no longer reachable from the row action. Decide: delete it, or re-wire it. |
| 2.2 | `getFilteredSummary` — unused | `src/hooks/useWallet.ts:562-578` | WalletPage computes the identical summary inline (`WalletPage.tsx:112-120`); Dashboard has a third copy (`Dashboard.tsx:102-110`). Keep one. Survived the C6 dead-code sweep. |
| 2.3 | `loadNetWorth` duplicated in the same file | `WalletPage.tsx:141-152` | A `useCallback` **and** an inline effect with the same body coexist; the effect is the one keyed on `dataVersion`. Merge them. |
| 2.4 | `POST /transactions/shares/status` — dead endpoint | `server/routes/wallet.ts:890-924` | No client caller (`has_shares` now comes on `GET /transactions`). Remove or mark intentionally kept. |

---

## 3. Same functionality, different implementations (the consistency backlog)

### 3.1 🟠 Delete confirmation — five patterns
Wave 5 (C5) introduced `ConfirmDeleteModal` but only migrated Budgets/Goals/Recurring:

| Pattern | Where |
|---|---|
| `ConfirmDeleteModal` (standard) | BudgetsPage, GoalsPage, RecurringPage |
| Hand-rolled `Modal` + `variant="danger"` button | AccountsPage:136, TransactionList:319, WalletPage bulk delete:582 |
| Hand-rolled `Modal` + primary button with **manual red classes** (`bg-red-600 hover:…`) instead of `variant="danger"` | HouseholdPage delete-group:649, SplitDialog remove-split:267 (dead) |
| Inline in-list confirm panel, no modal | CategoryManager:98-114 |
| `Modal` + plain primary button (not red at all) | HouseholdPage undo-settlement:176 |

Also inconsistent: titles ("Delete Account" vs "Delete budget?" vs "Delete Group?"), button sizes (md vs sm), and `ConfirmDeleteModal`'s default `confirmLabel` is the vague "Confirm". → Migrate all destructive confirms to `ConfirmDeleteModal`, standardise title style, default label "Delete".

### 3.2 🟠 CRUD modal state — `useCrudModal` only half-adopted
Budgets/Goals/Recurring use `useCrudModal`; **AccountsPage** (`formOpen`/`editingAccount`/`deleteTarget`) and **WalletPage** (`formOpen`/`editingTransaction`) hand-roll the identical state machine. Migrating them removes ~40 lines and aligns open/close semantics.

### 3.3 🟠 Error surfacing — four-plus patterns
The C3 standard (toast via `errorMessage()`) covers wallet CRUD pages only:

| Pattern | Where |
|---|---|
| Toast + `errorMessage()` (standard) | Budgets, Goals, Recurring, Accounts, WalletPage, CsvImport |
| Inline error text, persistent | ShareDialog, HouseholdPage settle dialog |
| Inline error, **auto-dismissed after 3 s** (`showTempError`) | BulkShareDialog (also SplitDialog, dead) |
| `window.alert()` | HouseholdPage delete-group:584 |
| **No handling at all** (silent failure / unhandled rejection) | Entire Tasks module (`useTasks`/`TasksPage` — every add/update/delete/indent), Household loads/create/remove/invite accept-decline, AccountForm sharing section (`catch(() => {})`), SettingsPage save, CategoryManager delete |

→ One rule: mutations toast on failure via `errorMessage()`; form-validation feedback stays inline. Tasks is the biggest gap — on a server hiccup, edits vanish silently on refresh.

### 3.4 🟠 Month/date-range math — four implementations
`WalletPage.getMonthRange` (TZ-safe manual), `wallet.store.getDefaultFilters` (**buggy UTC**, §1.1), `Dashboard` (date-fns `format`), `BudgetsPage.currentMonthYear` (manual). → One `monthRange(offset)` util in `lib/utils.ts`; all four call sites use it.

### 3.5 🟠 Date display — three formats
Standard is `format(parseISO(d), 'dd MMM yyyy')` (TransactionList, ExportModal, Recurring). Deviations: `BulkShareDialog.tsx:232` uses `new Date(date).toLocaleDateString()` (locale-dependent output *and* a UTC parsing hazard for `YYYY-MM-DD` strings); `ReportsPage.tsx:173` prints the raw ISO string. → Add `formatDisplayDate()` to `lib/utils.ts`.

### 3.6 🟠 Form controls — raw HTML elements where UI primitives exist
Raw `<select>` + hand-written `<label>` instead of `Select`: AccountForm sharing section (:240), ShareDialog (:115), HouseholdPage settle dialog (:210, :233). Raw `<input type="date">` instead of `DatePicker`: ReportsPage (:134, :144). Raw `<input type="number">` instead of `Input`: BulkShareDialog (:270). These skip the shared focus/error/label styling and a11y wiring.

### 3.7 🟠 Row/card action affordances — icons vs text
AccountCard and TransactionRow use ghost icon `Button`s with aria-labels and ≥40 px touch targets (B11); BudgetsPage uses raw `<button>` icons **without** the 40 px classes; Goals and Recurring use small *text* links ("Edit"/"Delete"). Same actions, three looks. → Pick the icon-button pattern (B4/B6/B11-compliant) everywhere.

### 3.8 🟠 Form validation & submit semantics
- **Feedback:** TransactionForm shows per-field errors; AccountForm shows a name error; Budgets/Goals/Recurring **silently do nothing** when invalid (button appears broken).
- **Submit:** AccountForm/TransactionForm/CategoryManager are real `<form onSubmit>` (Enter works); Budgets/Goals/Recurring are click-handlers only (Enter does nothing).
→ Standardise on `<form onSubmit>` + per-field `error` props.

### 3.9 🟠 Equal-split math — four copies, two rounding rules
The base/remainder cent-split is re-implemented in ShareDialog:66, BulkShareDialog:131+172, server quick-share `wallet.ts:747`, and (dead) SplitDialog:74. Worse, the beneficiary differs: quick-share gives the rounding remainder **to the owner**; bulk share gives it **to the last selected member**. Same feature, different cents. → One `splitEqually(amount, n): number[]` helper (client `lib/utils.ts` + server mirror), one documented remainder rule.

### 3.10 🟡 Server DELETE semantics differ per entity
Missing-row DELETE returns **404** for categories, an early **204** for transactions, and a blind **204** for accounts/budgets/goals/recurring/tasks. Harmless today, but pick one convention (blind 204 is fine for idempotent deletes) and note it.

### 3.11 🟡 Post-mutation refresh strategy differs per page
WalletPage refetches list + net worth + tags after every add/edit/delete *in addition to* the hook's optimistic store update; Budgets/Goals/Recurring trust the store update alone. Both work; document which is intended (refetch is justified on WalletPage because filters may exclude the new row — worth a comment, or a shared `afterMutation()` helper).

---

## 4. Feature-level misalignments

### 4.1 🟠 Sharing vs splitting — the row action lost multi-member splits
The transaction-row scissors button ("Share with household members") opens **ShareDialog**, which supports exactly **one** recipient. Since SplitDialog was orphaned (§2.1), splitting one expense across 3+ household members is only reachable via the unintuitive path *Select mode → tick one transaction → "Share 1"* (BulkShareDialog). Decide the intended model: either ShareDialog gains multi-recipient support, or SplitDialog comes back for the ≥3 case, or the bulk dialog becomes the single entry point. Also unify naming — the UI mixes "Share" and "Split" for the same concept (button aria-label "Share transaction", icon = scissors, dialog "Share Transaction", server routes `/share` + `/shares`).

### 4.2 🟠 BulkShareDialog UX defects
`BulkShareDialog.tsx` — (a) `shareMode` is one global state, but every transaction card renders its own "Split equally / Custom amounts" buttons; clicking either changes the mode for **all** cards. (b) It renders its own X close button while `Modal` already provides one — double X. (c) It's also the only dialog using `toLocaleDateString` (§3.5) and raw number inputs (§3.6).

### 4.3 🟠 Settings page is out of date with the product
- **Default Currency** select offers USD/EUR/SGD/GBP, but the app is deliberately single-currency (`formatMYR` hardcoded; the per-account currency selector was removed for this reason per CLAUDE.md §6). The setting stores a value nothing reads. → Remove or disable it.
- **API key copy** says "Stored only in your browser database — never sent to any third-party server" — false since Phase 4: it's stored in the server's SQLite via `/api/settings`. Reword.
- Save loops sequential PUTs with no error handling (§1.6).

### 4.4 🟡 Task templates only capture a single bullet
"Save as template" stores just the task's `content` string (`useTasks.ts:375`), and apply creates one bullet (`applyTemplate` → `addTask`). Users saving a checklist parent will expect the subtree. Either capture the subtree or rename the affordance ("Save title as template" is what it actually does).

### 4.5 🟡 Sort-order rebalance contradicts CLAUDE.md §9.1
Spec: "batch-update all affected rows in a single transaction". Implementation (`useTasks.ts:436-464`): one `PATCH /tasks/:id` per sibling, sequentially. With a big flat list a rebalance is dozens of round-trips mid-keystroke. → Add a batch endpoint (or accept and amend the spec).

### 4.6 🟡 Wallet search is server-side; task search is client-side
Fine at current scale (tasks are fully loaded anyway), but worth a line in CLAUDE.md so the asymmetry is a decision, not an accident.

---

## 5. Copy & visual consistency (quick wins)

- **Empty-state titles**, one per page, no shared voice: "No limits configured" / "Nothing here yet" / "No scheduled rules yet" / "No accounts yet" / "No transactions yet" / "No groups yet" / "No data yet". Pick a formula ("No X yet" + action).
- **Primary submit labels:** "Save Changes"/"Create Budget" (Budgets) vs "Save"/"Create" (Goals, Recurring) vs "Save Changes"/"Add Transaction" (Transaction) vs "Save Changes"/"Create Account" (Account).
- **Net-worth hero** markup duplicated in WalletPage:298-315 and AccountsPage:85-102 with subtly different captions ("across 3 accounts" vs "3 accounts"). Extract a `NetWorthBanner` component.
- Only AccountsPage/WalletPage/Tasks/Household empty states include an action button; Budgets/Goals/Recurring don't, though `EmptyState` supports it.

---

## 6. Documentation & convention drift

| # | Item | Detail |
|---|------|--------|
| 6.1 | 🟡 CLAUDE.md §6 schema is stale | Missing: `tasks.due_date`; the `budgets`, `recurring_transactions`, `goals`, `task_templates` tables (all in `0001_initial.sql`); `transactions.tag` is now a JSON array (migrations 0002/0003), not a plain string; `settlements.original_transaction_id` (0005). §6 is labelled "source of truth" — it currently isn't. |
| 6.2 | 🟡 CLAUDE.md §7 types are stale | `Transaction.tag: string` vs actual `tags: string[]`; `Account` lacks `openingBalance`, `isShared`, `sharedByUsername`, `canWrite`; `Task` lacks `dueDate`. |
| 6.3 | 🟠 Migration numbering collision | `0003_fix_empty_tags.sql` **and** `0003_sharing.sql` both exist. They both applied (runner sorts full filenames), but the NNNN convention is broken and the next collision might not be so lucky. Rename-forward is unsafe (shipped files are tracked by name); instead add a startup guard/lint that rejects duplicate numeric prefixes going forward. |
| 6.4 | 🟠 e2e spec numbering collisions | Duplicated prefixes: `23-` (household / wallet-navigation), `24-` (recurring-posting / shared-accounts), `25-` (splits / wallet-intuitiveness), `26-` (opening-balance / settlement). §16 mandates unique `NN-` prefixes; CLAUDE.md status notes even had to disambiguate ("25-splits, 25-wallet-intuitiveness"). Renumber the four newer files. |
| 6.5 | 🟡 CLAUDE.md §5 folder map is stale | Doesn't list `modules/household`, `modules/settings`, `modules/uat`, `components/auth`, `hooks/useCrudModal`, `stores/toast.store`, `server/lib/sharing.ts`; still lists Phase-5a files that don't exist (`lib/claude.ts`, `components/claude/*`, `db/`) without marking them as future. |

---

## 7. Suggested fix order

Grouped so each wave is one reviewable PR, mirroring the Phase 5c playbook:

1. **W1 — Correctness** (§1.1 store month-range bug + §3.4 shared helper, §1.2 export scope, §1.3 server validation gaps, §1.4 balance fan-outs) + regression e2e for the filter-date bug.
2. **W2 — Dead code & data flow** (§2.1–2.4 deletions, §1.5 non-store-mutating fetch variant, §1.6 bulk/sequential loops).
3. **W3 — Interaction consistency** (§3.1 ConfirmDeleteModal everywhere, §3.2 useCrudModal adoption, §3.3 error-toast rule incl. Tasks, §3.8 form semantics).
4. **W4 — Sharing model** (§4.1 decide split entry point, §3.9 shared split math, §4.2 BulkShareDialog fixes, naming).
5. **W5 — Copy, settings & docs** (§4.3, §5, §6 CLAUDE.md refresh, e2e renumbering, migration-prefix guard).

Every item above needs owner sign-off per CLAUDE.md §2 (rule 8) before implementation — nothing here has been changed yet.
