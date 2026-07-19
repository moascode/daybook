# Feature Consistency Review

**Date:** 2026-07-19 (updated same day: behavioural-divergence pass; sharing information-architecture direction) · **Scope:** full codebase (client + server) as of `main` after PR #34
**Type:** analysis only — no code was changed. Each finding lists the files involved so any item can be turned into a scoped fix PR.

The review confirms the suspicion: several core behaviours (delete confirmation, error surfacing, balance fetching, date-range math, split math, form validation) are each implemented 3–5 different ways, and — beyond code style — **several pairs of flows that do the same job behave differently for the user** (§2). Most divergence is the residue of features landing in different waves (Phase 4 → 5b → 5c) without the older paths being migrated to the newer pattern. §3 records the owner's direction for where sharing features should live.

**Legend:** 🔴 bug / behaviour defect · 🟠 inconsistency worth unifying · 🟡 polish / doc drift

---

## 1. Bugs found while comparing implementations (fix first)

### 1.1 🔴 Default transaction filter dates shift by one day (UTC bug)
`src/stores/wallet.store.ts:54-71` — `getDefaultFilters()` builds the default "this month" range with `date.toISOString().slice(0, 10)`. `toISOString()` converts to UTC, so in Malaysia (UTC+8) `new Date(2026, 6, 1)` serialises as `2026-06-30`. **The Wallet page's default filter starts on the last day of the previous month and ends one day before month-end** — day-one and month-end transactions are mis-scoped by default.
Ironically, `WalletPage.tsx:25-39` (`getMonthRange`) has a comment explaining exactly this trap and avoids it. The store predates that fix and was never updated. → Use one shared month-range helper (see §5.4).

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

## 2. Same feature, different behaviour (user-visible divergences)

These are pairs of flows that accomplish the same user goal but behave differently — the core of the owner's concern.

### 2.1 🔴 Individual share vs bulk share — two different products
> **Owner decision (2026-07-19): the individual quick-share flow (`ShareDialog`) is the preferred model. Bulk share (and any future split UI) should be aligned to its interaction pattern, modes, and rounding rule — not the other way round.**

`ShareDialog.tsx` + `POST /transactions/:id/share` vs `BulkShareDialog.tsx` + `POST /transactions/shares`:

| Aspect | Individual share (preferred) | Bulk share |
|---|---|---|
| Recipients | Exactly **one** co-member | Any number, but **must include yourself and ≥2 total** |
| Modes | **"Keep as-is"** (recipient owes 100%), "Split equally", "Custom" | Only "equal" / "custom" — *recipient-owes-everything is impossible* (each share must be > 0 and self must be included) |
| Mode selection UI | One clean button row, appears after picking a recipient | One **global** `shareMode`, but mode buttons are rendered **inside every transaction card** — clicking any card's button silently changes the mode for *all* cards (`BulkShareDialog.tsx:235-248`) |
| Rounding remainder (equal) | **Owner/payer absorbs** the extra cent (`wallet.ts:747-752`) | **Last selected member** absorbs it (`BulkShareDialog.tsx:172-178`) — same expense split via the two paths can produce different cents |
| Share rows written | "Keep as-is" writes **one row (recipient only, no payer row)** | Always includes a payer row |
| After save | `onSaved` **reloads the transaction list** → "Shared" badge appears immediately (`WalletPage.tsx:560`) | `onSave` only closes and clears selection — **no refetch, "Shared" badges stay stale** and select-mode stays on (`WalletPage.tsx:604-607`) |
| Error display | Persistent inline error | Inline error that **auto-dismisses after 3 s** (`showTempError`) |
| Date display | n/a | `toLocaleDateString()` — the only place not using `dd MMM yyyy` |
| Dialog chrome | Standard Modal | Renders its **own X button** next to Modal's built-in one — double close |
| Validation copy | "Please select a recipient" | "Select at least 2 recipients (including yourself)" |

Alignment work implied by the owner decision: give bulk share the same three modes (incl. "Keep as-is" per recipient), one mode control (per transaction, not global-but-rendered-per-card), owner-absorbs-remainder rounding, a list refetch on save, persistent inline errors, standard date format, single close button.

Note on the payer-row difference: CLAUDE.md §6 documents the invariant "one row per user per split transaction; **includes the payer**" — individual "Keep as-is" breaks the letter of it. Group balances still compute correctly (the balance query only counts debtor rows where `ts.user_id != t.user_id`, `groups.ts:334-345`), so this is a doc/invariant decision, not a maths bug: either amend §6 or make "Keep as-is" also write a 0-value payer row (currently impossible — the server rejects share amounts ≤ 0).

### 2.2 🔴 An existing share can be viewed nowhere and is silently overwritten
Neither ShareDialog nor BulkShareDialog loads existing share rows. Re-opening the scissors action on an already-shared transaction shows a **blank form**, and saving `DELETE`s the previous rows and replaces them without warning (`wallet.ts:774-782`). The only component that displayed and edited an existing split was `SplitDialog` — which PR #27 orphaned (§4.1). So today the "Shared" badge is a dead end: you can't see who owes what on that transaction, only overwrite it. → When aligning on the individual-share model (§2.1), it should load and display existing shares the way SplitDialog did, and warn before replacing.

### 2.3 🟠 Three share endpoints, two permission models
- `POST /transactions/:id/share` (individual) — **owner only** (`wallet.ts:722`).
- `POST /transactions/shares` (bulk) — **owner only** (`wallet.ts:843`).
- `POST /transactions/:id/shares` (legacy split endpoint, still live) — allows **owner OR account co-writer** (`wallet.ts:658`), while its own 403 message claims "only the transaction owner can set splits". `DELETE /:id/shares` is owner-only again — so via the legacy route a co-writer could create a split they cannot remove.
No UI currently calls the legacy route (its only caller was the dead SplitDialog), so either remove it or make its permission rule and message match the other two.

### 2.4 🟠 Adding transactions: manual entry vs CSV import vs recurring behave differently on shared accounts
- **Manual add** (`POST /transactions`) permits posting to a shared-in account when the group grant has `can_write` (`wallet.ts:535`).
- **CSV import** (`POST /transactions/import`) checks `ownsAllRefs` instead (`wallet.ts:515`) — importing into that *same writable shared account* is rejected with "invalid account or category reference". The CsvImport account dropdown happily lists shared-in accounts (`CsvImport.tsx` uses the same `accounts` store), so the user can pick one and only find out at the end.
- **Recurring rules** are own-accounts-only too (`wallet.ts:1000`) — defensible (auto-posting into someone else's account is spooky), but undocumented; the form also offers shared-in accounts in its dropdown (`RecurringPage.tsx:296-302`).
→ Decide one rule (suggest: manual behaviour is correct; import should match it; recurring stays own-only **and** filters its dropdown), then make the dropdowns only offer accounts the flow will actually accept.

### 2.5 🟠 Category choice is type-filtered in one entry path, unfiltered in the other
`TransactionForm.tsx:96-100` and `RecurringPage.tsx:67-73` filter the category list to the transaction's direction (income/expense/both). The CSV review table (`CsvReviewTable.tsx:22-25`) offers **every** category for every row regardless of the row's type — an income category can be attached to an expense row, which the other paths make impossible. (Server accepts it in all cases; the constraint is client-side only — itself worth noting.)
Also vs spec: CLAUDE.md §9.2 says every review row is editable, but merchant/description are read-only in the table (only date/amount/type/category are editable).

### 2.6 🟠 Read-only shared accounts: the UI offers actions the server will always refuse
`TransactionList.tsx:200-239` renders edit/delete/share buttons on **every** row, and the row-click opens the edit form. For a member with read-only access to a shared account, edit/delete requests always 403 (`wallet.ts:566,619`) — the user just gets an error toast after filling the form. The data needed to hide/disable the actions is already on the client (`account.isShared && !account.canWrite`, mapped in `useWallet.ts:86-89`). Same for AccountCard: shared-in accounts still show the delete button, which can never succeed.

### 2.7 🟠 Undo exists for some destructive actions, not others — with no pattern
- Task delete → **5-second undo toast** (`TasksPage.tsx:138-151`).
- Settlement → explicit **Undo button + confirm modal** (`HouseholdPage.tsx:176`).
- Transaction / bulk / account / budget / goal / recurring / group / category deletes → confirm-then-permanent, no undo (bulk delete's copy even says "This cannot be undone").
Not everything needs undo, but the current split is historical accident, not design. Cheap wins: transaction delete could reuse the task-style undo toast (the row data is still in memory), and the rest standardise on the confirm dialog (§5.1).

### 2.8 🟠 "New record" forms start with different amounts of friction
- TransactionForm: account pre-selected (active filter, else first account), date defaults to today (`TransactionForm.tsx:46-50`).
- GoalsPage: account pre-selected (first) (`GoalsPage.tsx:51`).
- RecurringPage: account **empty**, next-due date **empty** — two mandatory picks the sibling forms don't demand (`RecurringPage.tsx:75-84`).
- CsvImport: account pre-selected (first) (`CsvImport.tsx:69-71`).
→ Adopt the TransactionForm defaults everywhere (first/filtered account, today where a date is needed).

### 2.9 🟡 Wallet search vs task search
Wallet: 300 ms-debounced server query on merchant+description, no match highlighting (`WalletPage.tsx:99-108`). Tasks: instant client-side search on content+note with `<mark>` highlighting and a 50-result cap (`TasksPage.tsx:125-135`). Both fine at current scale, but the differing feel (delay vs instant, highlight vs none) reads as inconsistency; worth a CLAUDE.md note that this is intentional, and highlighting could be added to the wallet list cheaply.

### 2.10 🟡 Two different "share" concepts, same icon, different entry patterns
Account sharing uses the `Share2` icon and lives **inside the Edit Account modal** (the card's share button just opens the edit form — `AccountsPage.tsx:123`); transaction sharing uses a scissors icon labelled "Share" with a dedicated dialog. Terminology mixes "Share" and "Split" throughout (aria-label "Share transaction", icon = scissors, dialog "Share Transaction", server routes `/share` and `/shares`, CLAUDE.md calls it "splits"). → Pick words: e.g. accounts are *shared*, expenses are *split*; give account sharing its own small dialog or a dedicated section title inside the form. The naming decision should land together with the relocation in §3.

---

## 3. Information architecture: where sharing lives (owner direction)

> **Owner decision (2026-07-19): group management (the "Household" page) belongs in Settings as a "Sharing" feature. The money outcomes of sharing — balances, settle up, settlement history — belong under Wallet. Tasks may later be shared through the same mechanism, so the group layer must stay module-agnostic.**

### 3.1 What's wrong with the current placement

- **"Household" is a top-level nav destination** (`Sidebar.tsx:142-148`, `router.tsx:38`), ranked equal with Tasks and Wallet — but most of the page is one-time configuration: create a group, invite members, manage roles (`HouseholdPage.tsx:269-343, 540-662`). Nobody visits it daily for that.
- **The daily-use part is buried.** Who-owes-whom, Settle Up, settlement history, and undo live in a "Balances" *tab* that only appears after expanding a group card (`HouseholdPage.tsx:453-481`) — two interactions deep. The U-8 balance pill on the card surface exists precisely because the important number was buried.
- **Money actions and their effects live in different modules.** Recording a settlement creates real transfer transactions in Wallet accounts, and split badges/"Shared with me" views live on the Wallet transaction list — but the balance overview and the Settle Up button are in Household. The user acts in one module and sees the consequence in another.
- **The server already has the boundary this proposal draws.** Config endpoints (`/groups`, `/groups/:id/members`, `/groups/:id/invites`, `/invites/:id/accept|decline` — `groups.ts`) are cleanly separate from money endpoints (`/groups/:id/balances` — `groups.ts:325`, `/settlements` — `settlements.ts`). **The relocation is a client-only change; zero server work.**
- **The group layer is already module-agnostic.** `groups`, `group_members`, `group_invites` carry no wallet columns; all wallet coupling lives in `account_shares`, `transaction_shares`, `settlements`. Moving group admin to Settings therefore doesn't entangle it further with Wallet — it *disentangles* it, which is exactly what future task sharing needs (§3.4).

### 3.2 Proposed mapping

| Feature | Today | Proposed home |
|---|---|---|
| Create / delete group | Household page | **Settings → Sharing** |
| Members list, roles, remove, leave | Household → group card → Members tab | **Settings → Sharing** |
| Send invite (`InviteDialog`) | Household → Members tab | **Settings → Sharing** |
| Accept / decline invites (`PendingInvites`) | Household page top | **Settings → Sharing** (plus a global banner/toast on login while invites are pending, so they aren't missed) |
| Pending-invite red badge | Sidebar "Household" item (`Sidebar.tsx:147`) | Sidebar **"Settings"** item (polling logic in `Sidebar.tsx:86-97` moves with it) |
| Balances — "Owed to you" / "You owe" | Household → group card → Balances tab | **Wallet → new "Shared" page** (`/wallet/shared`), in the sidebar's Wallet section (suggest under "Daily") |
| Settle Up dialog (record settlement) | Balances tab | Wallet → Shared page |
| Settlement history + Undo | Balances tab | Wallet → Shared page |
| U-8 balance summary pill on group cards | Household card surface | Superseded — the Shared page's headline is the summary; optionally a small amount badge on the "Shared" nav item |
| Account share grants (share account with group, read-only/write toggle) | Edit Account modal (`AccountForm.tsx:196-281`) | **Stays in Wallet** (it's per-account config); optionally mirrored as a read-only "What I'm sharing" overview in Settings → Sharing |
| Transaction split/share dialogs, "Shared" badges, view pills | Wallet | Stays |

Net effect on navigation: the top-level "Household" item disappears; Wallet gains one sub-item ("Shared"); Settings gains a "Sharing" section and inherits the invite badge. `/household` should 301-style redirect (client `Navigate`) for one release — to `/settings` (config was the page's face) — before being removed.

### 3.3 Design decisions to make before building

1. **Per-group vs netted balances on the Shared page.** `GET /groups/:id/balances` and settlements are *per group* (`settlements.group_id`); netting one figure per person across groups would need a new endpoint and muddies settlement attribution. Recommend the Shared page lists balances **sectioned by group** (matches the data model, no server change), with an "all groups" headline total as a purely visual sum.
2. **Linking Shared ↔ Transactions.** The Shared page should deep-link into pre-filtered transaction views (`/wallet?view=shared-with-me`) instead of re-listing transactions — the view pills already exist on WalletPage.
3. **Settings layout.** Settings is currently one scroll page with four sections (`SettingsPage.tsx`); adding Sharing (groups + members + invites) makes it the largest section. Acceptable initially; if it grows, promote Settings to sub-routes (`/settings/sharing`) — worth choosing the route shape now so bookmarks survive.
4. **Naming.** With the page split, "Household" as a brand name loses its anchor. Suggest: Settings section = **"Sharing"** (module-agnostic, matches the owner's framing), groups still called "household groups" in copy where warmth helps; Wallet page = **"Shared"** or "Shared expenses". This is the same decision as §2.10 — settle both at once.

### 3.4 Future: task sharing fits this shape

The generalisable pattern the move establishes:

- **Settings → Sharing owns *who*** — groups, members, invites. One place, module-agnostic, already true of the schema.
- **Each module owns *what* is shared and shows the shared state** — Wallet has `account_shares` (grant), `transaction_shares` (splits), and the Shared page (outcomes). Tasks would add its own grant table (e.g. `task_shares(task_id, group_id, can_write)` sharing a subtree root to a group, mirroring `account_shares`), shared-indicator badges in the bullet tree, and — if there's an "outcome" surface at all — a shared-tasks filter rather than a new page.
- **No new group UI is ever needed per module.** Under the current IA, task sharing would have had to either squat on the wallet-flavoured Household page or grow a second group-management surface; after the move, it plugs into Settings → Sharing for free.

One server-side prerequisite to note for that future: `visibleAccountIds` / `canWriteAccount` (`server/lib/sharing.ts`) are wallet-specific by name but the grant-checking shape (`*_shares` join `group_members`) is generic — worth extracting a generic helper when the first non-wallet share lands, not before.

### 3.5 Implementation impact (when scheduled)

- **Server:** none — routes unchanged.
- **Client:** split `HouseholdPage.tsx` (662 lines — already flagged as oversized vs the one-concern-per-file rule): `GroupCard` minus its Balances tab + `PendingInvites` + create/delete → `modules/settings/` (rendered inside SettingsPage or a `/settings/sharing` route); `BalancesTab` promoted from tab to `modules/wallet/SharedPage.tsx`; `household.store` reusable as-is; router + Sidebar edits; `InvitationsBadge` re-targeted.
- **e2e:** `23-household.spec.ts` and `26-settlement.spec.ts` navigate to `/household` and will need route/selector updates; `24-shared-accounts` / `25-splits` / `27-wallet-bulk-share` are Wallet-based and mostly unaffected. (Good moment to fix the duplicate spec numbers, §8.4.)
- **Sequencing:** do this move **before** the interaction-consistency wave touches HouseholdPage (§5.1, §4.3 list several fixes on it) — polishing a page that's about to be dismantled is wasted work. See §9.

---

## 4. Dead code and unreachable features

| # | Item | Location | Notes |
|---|------|----------|-------|
| 4.1 | **`SplitDialog.tsx` (280 lines) — dead** | `src/modules/wallet/SplitDialog.tsx` | Imported nowhere. PR #27 wired the row action to the new single-recipient `ShareDialog` and orphaned this multi-member dialog. Consequences: multi-member split of a *single* transaction is only reachable via select-mode bulk share, and existing splits are no longer viewable/editable (§2.2). Per the owner decision in §2.1, its useful behaviours (load existing shares, multi-member lines) should be folded into the individual-share model, then the file deleted. |
| 4.2 | `getFilteredSummary` — unused | `src/hooks/useWallet.ts:562-578` | WalletPage computes the identical summary inline (`WalletPage.tsx:112-120`); Dashboard has a third copy (`Dashboard.tsx:102-110`). Keep one. Survived the C6 dead-code sweep. |
| 4.3 | `loadNetWorth` duplicated in the same file | `WalletPage.tsx:141-152` | A `useCallback` **and** an inline effect with the same body coexist; the effect is the one keyed on `dataVersion`. Merge them. |
| 4.4 | `POST /transactions/shares/status` — dead endpoint | `server/routes/wallet.ts:890-924` | No client caller (`has_shares` now comes on `GET /transactions`). Remove or mark intentionally kept. |
| 4.5 | `POST /transactions/:id/shares` — no UI caller | `server/routes/wallet.ts:651-701` | Only caller was the dead SplitDialog; also carries the divergent permission rule (§2.3). Remove or align. |

---

## 5. Same functionality, different implementations (code-level consistency backlog)

### 5.1 🟠 Delete confirmation — five patterns
Wave 5 (C5) introduced `ConfirmDeleteModal` but only migrated Budgets/Goals/Recurring:

| Pattern | Where |
|---|---|
| `ConfirmDeleteModal` (standard) | BudgetsPage, GoalsPage, RecurringPage |
| Hand-rolled `Modal` + `variant="danger"` button | AccountsPage:136, TransactionList:319, WalletPage bulk delete:582 |
| Hand-rolled `Modal` + primary button with **manual red classes** (`bg-red-600 hover:…`) instead of `variant="danger"` | HouseholdPage delete-group:649, SplitDialog remove-split:267 (dead) |
| Inline in-list confirm panel, no modal | CategoryManager:98-114 |
| `Modal` + plain primary button (not red at all) | HouseholdPage undo-settlement:176 |

Also inconsistent: titles ("Delete Account" vs "Delete budget?" vs "Delete Group?"), button sizes (md vs sm), and `ConfirmDeleteModal`'s default `confirmLabel` is the vague "Confirm". → Migrate all destructive confirms to `ConfirmDeleteModal`, standardise title style, default label "Delete".

### 5.2 🟠 CRUD modal state — `useCrudModal` only half-adopted
Budgets/Goals/Recurring use `useCrudModal`; **AccountsPage** (`formOpen`/`editingAccount`/`deleteTarget`) and **WalletPage** (`formOpen`/`editingTransaction`) hand-roll the identical state machine. Migrating them removes ~40 lines and aligns open/close semantics.

### 5.3 🟠 Error surfacing — four-plus patterns
The C3 standard (toast via `errorMessage()`) covers wallet CRUD pages only:

| Pattern | Where |
|---|---|
| Toast + `errorMessage()` (standard) | Budgets, Goals, Recurring, Accounts, WalletPage, CsvImport |
| Inline error text, persistent | ShareDialog, HouseholdPage settle dialog |
| Inline error, **auto-dismissed after 3 s** (`showTempError`) | BulkShareDialog (also SplitDialog, dead) |
| `window.alert()` | HouseholdPage delete-group:584 |
| **No handling at all** (silent failure / unhandled rejection) | Entire Tasks module (`useTasks`/`TasksPage` — every add/update/delete/indent), Household loads/create/remove/invite accept-decline, AccountForm sharing section (`catch(() => {})`), SettingsPage save, CategoryManager delete |

→ One rule: mutations toast on failure via `errorMessage()`; form-validation feedback stays inline. Tasks is the biggest gap — on a server hiccup, edits vanish silently on refresh.

### 5.4 🟠 Month/date-range math — four implementations
`WalletPage.getMonthRange` (TZ-safe manual), `wallet.store.getDefaultFilters` (**buggy UTC**, §1.1), `Dashboard` (date-fns `format`), `BudgetsPage.currentMonthYear` (manual). → One `monthRange(offset)` util in `lib/utils.ts`; all four call sites use it.

### 5.5 🟠 Date display — three formats
Standard is `format(parseISO(d), 'dd MMM yyyy')` (TransactionList, ExportModal, Recurring). Deviations: `BulkShareDialog.tsx:232` uses `new Date(date).toLocaleDateString()` (locale-dependent output *and* a UTC parsing hazard for `YYYY-MM-DD` strings); `ReportsPage.tsx:173` prints the raw ISO string. → Add `formatDisplayDate()` to `lib/utils.ts`.

### 5.6 🟠 Form controls — raw HTML elements where UI primitives exist
Raw `<select>` + hand-written `<label>` instead of `Select`: AccountForm sharing section (:240), ShareDialog (:115), HouseholdPage settle dialog (:210, :233). Raw `<input type="date">` instead of `DatePicker`: ReportsPage (:134, :144). Raw `<input type="number">` instead of `Input`: BulkShareDialog (:270). These skip the shared focus/error/label styling and a11y wiring.

### 5.7 🟠 Row/card action affordances — icons vs text
AccountCard and TransactionRow use ghost icon `Button`s with aria-labels and ≥40 px touch targets (B11); BudgetsPage uses raw `<button>` icons **without** the 40 px classes; Goals and Recurring use small *text* links ("Edit"/"Delete"). Same actions, three looks. → Pick the icon-button pattern (B4/B6/B11-compliant) everywhere.

### 5.8 🟠 Form validation & submit semantics
- **Feedback:** TransactionForm shows per-field errors; AccountForm shows a name error; Budgets/Goals/Recurring **silently do nothing** when invalid (button appears broken).
- **Submit:** AccountForm/TransactionForm/CategoryManager are real `<form onSubmit>` (Enter works); Budgets/Goals/Recurring are click-handlers only (Enter does nothing).
→ Standardise on `<form onSubmit>` + per-field `error` props.

### 5.9 🟠 Equal-split math — four copies, two rounding rules
The base/remainder cent-split is re-implemented in ShareDialog:66, BulkShareDialog:131+172, server quick-share `wallet.ts:747`, and (dead) SplitDialog:74. Per the owner decision (§2.1) the rule is **owner absorbs the remainder**. → One `splitEqually(amount, n): number[]` helper (client `lib/utils.ts` + server mirror) implementing that rule; delete the other copies.

### 5.10 🟡 Server DELETE semantics differ per entity
Missing-row DELETE returns **404** for categories, an early **204** for transactions, and a blind **204** for accounts/budgets/goals/recurring/tasks. Harmless today, but pick one convention (blind 204 is fine for idempotent deletes) and note it.

### 5.11 🟡 Post-mutation refresh strategy differs per page
WalletPage refetches list + net worth + tags after every add/edit/delete *in addition to* the hook's optimistic store update; Budgets/Goals/Recurring trust the store update alone; bulk share refetches nothing (§2.1). → Document which is intended, or add a shared `afterMutation()` helper (refetch is justified on WalletPage because filters may exclude the new row).

---

## 6. Feature-level misalignments (single-path issues)

### 6.1 🟠 Settings page is out of date with the product
- **Default Currency** select offers USD/EUR/SGD/GBP, but the app is deliberately single-currency (`formatMYR` hardcoded; the per-account currency selector was removed for this reason per CLAUDE.md §6). The setting stores a value nothing reads. → Remove or disable it.
- **API key copy** says "Stored only in your browser database — never sent to any third-party server" — false since Phase 4: it's stored in the server's SQLite via `/api/settings`. Reword.
- Save loops sequential PUTs with no error handling (§1.6).
(Settings is also about to become the home of the Sharing section, §3 — fix these while in there.)

### 6.2 🟡 Task templates only capture a single bullet
"Save as template" stores just the task's `content` string (`useTasks.ts:375`), and apply creates one bullet (`applyTemplate` → `addTask`). Users saving a checklist parent will expect the subtree. Either capture the subtree or rename the affordance ("Save title as template" is what it actually does).

### 6.3 🟡 Sort-order rebalance contradicts CLAUDE.md §9.1
Spec: "batch-update all affected rows in a single transaction". Implementation (`useTasks.ts:436-464`): one `PATCH /tasks/:id` per sibling, sequentially. With a big flat list a rebalance is dozens of round-trips mid-keystroke. → Add a batch endpoint (or accept and amend the spec).

---

## 7. Copy & visual consistency (quick wins)

- **Empty-state titles**, one per page, no shared voice: "No limits configured" / "Nothing here yet" / "No scheduled rules yet" / "No accounts yet" / "No transactions yet" / "No groups yet" / "No data yet". Pick a formula ("No X yet" + action).
- **Primary submit labels:** "Save Changes"/"Create Budget" (Budgets) vs "Save"/"Create" (Goals, Recurring) vs "Save Changes"/"Add Transaction" (Transaction) vs "Save Changes"/"Create Account" (Account).
- **Net-worth hero** markup duplicated in WalletPage:298-315 and AccountsPage:85-102 with subtly different captions ("across 3 accounts" vs "3 accounts"). Extract a `NetWorthBanner` component.
- Only AccountsPage/WalletPage/Tasks/Household empty states include an action button; Budgets/Goals/Recurring don't, though `EmptyState` supports it.

---

## 8. Documentation & convention drift

| # | Item | Detail |
|---|------|--------|
| 8.1 | 🟡 CLAUDE.md §6 schema is stale | Missing: `tasks.due_date`; the `budgets`, `recurring_transactions`, `goals`, `task_templates` tables (all in `0001_initial.sql`); `transactions.tag` is now a JSON array (migrations 0002/0003), not a plain string; `settlements.original_transaction_id` (0005). Also the "includes the payer" split invariant is broken by quick-share "Keep as-is" (§2.1). §6 is labelled "source of truth" — it currently isn't. |
| 8.2 | 🟡 CLAUDE.md §7 types are stale | `Transaction.tag: string` vs actual `tags: string[]`; `Account` lacks `openingBalance`, `isShared`, `sharedByUsername`, `canWrite`; `Task` lacks `dueDate`. |
| 8.3 | 🟠 Migration numbering collision | `0003_fix_empty_tags.sql` **and** `0003_sharing.sql` both exist. They both applied (runner sorts full filenames), but the NNNN convention is broken and the next collision might not be so lucky. Rename-forward is unsafe (shipped files are tracked by name); instead add a startup guard/lint that rejects duplicate numeric prefixes going forward. |
| 8.4 | 🟠 e2e spec numbering collisions | Duplicated prefixes: `23-` (household / wallet-navigation), `24-` (recurring-posting / shared-accounts), `25-` (splits / wallet-intuitiveness), `26-` (opening-balance / settlement). §16 mandates unique `NN-` prefixes; CLAUDE.md status notes even had to disambiguate ("25-splits, 25-wallet-intuitiveness"). Renumber the four newer files — ideally alongside the §3 move, which touches the household/settlement specs anyway. |
| 8.5 | 🟡 CLAUDE.md §5 folder map is stale | Doesn't list `modules/household`, `modules/settings`, `modules/uat`, `components/auth`, `hooks/useCrudModal`, `stores/toast.store`, `server/lib/sharing.ts`; still lists Phase-5a files that don't exist (`lib/claude.ts`, `components/claude/*`, `db/`) without marking them as future. The §3 relocation will reshape this section again — update once, after the move. |

---

## 9. Suggested fix order

Grouped so each wave is one reviewable PR, mirroring the Phase 5c playbook. Ordering rationale: correctness first; then the two owner-decided directions (share-model alignment, IA relocation) **before** any polish touches the pages they will reshape.

1. **W1 — Correctness** (§1.1 store month-range bug + §5.4 shared helper, §1.2 export scope, §1.3 server validation gaps, §1.4 balance fan-outs) + regression e2e for the filter-date bug.
2. **W2 — Sharing model alignment** (owner-approved, §2.1): rebuild bulk share on the individual-share pattern (modes incl. "Keep as-is", per-transaction mode control, owner-absorbs-remainder via one shared `splitEqually` helper §5.9, refetch on save, persistent errors, standard dates, single close button); make existing shares viewable/editable with an overwrite warning (§2.2); collapse to one permission rule and delete the legacy `/shares` endpoint + `SplitDialog` (§2.3, §4.1, §4.5).
3. **W3 — Sharing IA relocation** (owner-approved, §3): Household group admin → Settings → Sharing; balances/settlements → Wallet Shared page; invite badge → Settings nav item; `/household` redirect; settle the Share/Split naming (§2.10, §3.3.4); renumber the touched e2e specs (§8.4).
4. **W4 — Cross-path behaviour** (§2.4 shared-account rules for import/recurring + dropdown filtering, §2.5 type-filtered categories in CSV review, §2.6 hide/disable actions on read-only rows, §2.8 form defaults, §2.7 undo policy).
5. **W5 — Dead code & data flow** (§4.2–4.4, §1.5 non-store-mutating fetch variant, §1.6 bulk/sequential loops).
6. **W6 — Interaction & code consistency** (§5.1 ConfirmDeleteModal everywhere, §5.2 useCrudModal adoption, §5.3 error-toast rule incl. Tasks, §5.5–5.8) — applied to the *post-relocation* pages.
7. **W7 — Copy, settings & docs** (§6.1, §7, §8 CLAUDE.md refresh incl. the new IA, migration-prefix guard).

Every item above needs owner sign-off per CLAUDE.md §2 (rule 8) before implementation. Decisions already made: §2.1 (individual share is the model) and §3 (sharing IA relocation); §3.3 lists the sub-decisions still open (per-group vs netted balances, settings route shape, final naming).
