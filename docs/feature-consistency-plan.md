# Feature Consistency — Implementation Plan (8 Waves)

> **Status:** Proposed 2026-07-19, awaiting owner approval. Companion to
> `docs/feature-consistency-review.md` (the analysis with per-item problem detail and
> file:line anchors — all §-references below point into that document). This document
> sequences the review's findings into eight themed wave PRs, mirroring the Phase 5c
> playbook (`docs/phase-5c-implementation-plan.md`).
>
> **Baseline:** `main` after PR #35 (consistency review doc merged, 2026-07-19).
> All waves branch from post-#35 main and merge **sequentially** in order below —
> each wave's PR is owner-reviewed and merged before the next wave branches.

---

## Scope decisions

1. **No schema changes, no migrations.** Every wave is schema-free. Next free migration
   prefix is `0006` and stays unused by this plan. (W8's duplicate-prefix *guard* is
   startup code in `server/db.ts`, not a migration.)
2. **E2E spec numbering:** existing files end at `32-`; duplicate prefixes exist at
   `23-`/`24-`/`25-`/`26-` (§8.4). Prefixes **33–36 are reserved for W3's renumbering**
   of the four newer duplicates; new spec files start at **37**. Do not create further
   duplicates, and do not renumber if waves land out of order.
3. **Owner-decided directions already locked** (recorded in the review): individual
   share is the canonical split model (§2.1), sharing IA relocation (§3), filter-bar
   reorganisation (§6.4).
4. **Sub-decisions adopted from the review's own recommendations** — veto any of these
   at plan review and the affected wave adjusts:
   - **Shared-page balances (§3.3.1):** sectioned **per group** with an all-groups
     headline total as a purely visual sum. No new endpoint.
   - **Settings route shape (§3.3.3):** promote Settings to **sub-routes now** —
     Sharing lands at `/settings/sharing` so bookmarks and the invite-badge deep link
     survive the section's predicted growth.
   - **Naming (§3.3.4, §2.10):** accounts are **shared** (Share2 icon), expenses are
     **split** (scissors icon); Settings section = **"Sharing"**; new Wallet page =
     **"Shared"**. "Household groups" survives only as warm copy inside Sharing.
   - **Payer-row invariant (§2.1 note):** **amend CLAUDE.md §6** — a payer row is
     written only when the payer participates in the split — rather than relaxing the
     server's `amount > 0` rule to allow 0-value payer rows.
5. **Out of scope:** Phase 5c parked D-items and C9 (per that plan), Phase 5a (AI).
   §6.2 (template captures one bullet) and §6.3 (rebalance is N PATCHes) get recorded
   decisions in W8, not silent implementations — each would need its own sign-off.

## Sequencing rationale

Correctness first (W1). The two owner-decided sharing directions (W2 model alignment,
W3 IA relocation) land **before** any polish touches the pages they reshape —
HouseholdPage is dismantled in W3, so the §5.x consistency fixes that touch it happen
only afterwards, in W7. W4 (filter bar) follows W3 because two of its moves (Sharing
view pills into the Filters section, Manage-categories toward Settings) land in homes
W3 creates. W5–W6 are behaviour/data-flow fixes independent of layout; W7 applies the
interaction patterns to the post-relocation page set; W8 sweeps copy and docs last so
CLAUDE.md is updated exactly once, after the IA has settled.

---

## Wave 1 — Correctness fixes

**Branch:** `fix/wallet-correctness-dates-export-validation` · **Size:** ~350–450 lines · **Depends on:** post-#35 main

| Item | Implementation note |
|---|---|
| §1.1 + §5.4 month-range bug & helper (S) | One TZ-safe `monthRange(offset): {from, to}` util in `src/lib/utils.ts` (lift the manual-format logic from `WalletPage.tsx:25-39`); replace all four implementations: `wallet.store.ts:54-71` (`getDefaultFilters` — the UTC bug), `WalletPage.getMonthRange`, Dashboard's date-fns version, `BudgetsPage.currentMonthYear` |
| §1.2 export scope (S) | `GET /transactions/export` (`server/routes/wallet.ts:432-483`) accepts and applies the same `view` scoping as `GET /transactions` so exported rows match the on-screen selection; client passes the active view |
| §1.3 server validation gaps (S) | `POST`/`PATCH /recurring-transactions`: validate `amount` (finite > 0, reuse the C2 `positiveAmountError` helper) and `nextDueDate` ISO format → 400 `{error}`; `POST /accounts` and `POST /goals`: validate `name` non-empty (categories already do) |
| §1.4 balance fan-outs (S) | `GoalsPage.tsx:38-48` and `AccountCard.tsx:55-62` switch to the batched `getAccountBalances()`; AccountsPage fetches once and passes balances down as props; per-account endpoint remains for the UAT runner only |

- **E2E:** regression block in `03-wallet-transactions` — default From/To equal the
  current month's first/last day (would have caught §1.1); block in `15-wallet-export`
  — with shared-in rows selected, exported row count matches the button count (§1.2);
  blocks in `31-wallet-server-hardening` — recurring amount 0/negative and malformed
  `nextDueDate` → 400, account/goal missing name → 400 (§1.3); run `10-wallet-net-worth`,
  `16-wallet-goals`, `02-wallet-accounts`, `26-opening-balance`, `24-shared-accounts`
  as the §1.4 regression net.
- **Commits:** §1.1+§5.4 / §1.2 / §1.3 / §1.4 — four commits.
- **Risks:** the store's default-filter change shifts which transactions the Wallet
  page shows by default — specs that seeded month-boundary data may have silently
  relied on the off-by-one. The export change alters server CSV row selection — diff
  a sample against spec 15's assertions first.

## Wave 2 — Sharing model alignment (owner-approved, §2.1)

**Branch:** `feat/split-model-alignment` · **Size:** ~500–650 lines · **Depends on:** Wave 1 merged

| Item | Implementation note |
|---|---|
| §5.9 one split helper (S) | `splitEqually(amount, n): number[]` — **owner absorbs the remainder cent** — in `src/lib/utils.ts` + a server mirror; delete the three live copies (`ShareDialog.tsx:66`, `BulkShareDialog.tsx:131,172`, server `wallet.ts:747`) |
| §2.1 bulk share rebuilt on the individual-share pattern (L) | `BulkShareDialog`: three modes incl. "Keep as-is" (per-recipient owes-100% — server bulk route must accept a payer-less single-recipient line, matching the quick-share route); **per-transaction** mode control (not global-rendered-per-card); owner-absorbs rounding via the shared helper; `onSave` refetches the transaction list so "Shared" badges update and select-mode exits; persistent inline errors (drop `showTempError`); dates via `dd MMM yyyy`; single Modal close button; validation copy aligned with ShareDialog |
| §2.2 view/edit existing shares (M) | Both dialogs load existing share rows on open (SplitDialog's behaviour, folded in); display who-owes-what; explicit warning before the save that replaces prior rows (`wallet.ts:774-782`) |
| §2.3 + §4.5 one permission rule (S) | Delete legacy `POST /transactions/:id/shares` + its `DELETE` (no UI caller); remaining share routes stay owner-only — one rule, one message |
| §4.1 delete `SplitDialog.tsx` (trivial) | Remove the 280-line orphan once its load-existing behaviour is folded into §2.2 |
| §2.1 note — invariant (trivial) | Amend CLAUDE.md §6: payer row written only when the payer participates in the split |

- **E2E:** rework `27-wallet-bulk-share` (modes, per-transaction control, rounding,
  badge refresh on save); new blocks in `25-splits` (re-open shows existing shares;
  overwrite warning); API-level check that the legacy `/shares` route is gone (404).
- **Commits:** §5.9 helper / bulk-dialog rebuild / §2.2 view-existing / §2.3+§4.1
  removals + CLAUDE.md — four commits.
- **Risks:** highest-touch wave for sharing maths — the server bulk route changes
  its accepted payload ("Keep as-is" lines). Run the full 5b suite (`23-household`,
  `24-shared-accounts`, `25-splits`, `26-settlement`, `27-wallet-bulk-share`) plus
  `06-uat-runner`. Rounding-rule unification changes cents in existing bulk-share
  expectations — update spec fixtures deliberately, not to-make-green.

## Wave 3 — Sharing IA relocation (owner-approved, §3)

**Branch:** `feat/sharing-ia-relocation` · **Size:** ~600–750 lines (mostly moves) · **Depends on:** Wave 2 merged

**Client-only — zero server changes** (the route split already matches the target IA,
§3.1). Split the 662-line `HouseholdPage.tsx`:

| Item | Implementation note |
|---|---|
| Settings → Sharing (M) | Group admin (`GroupCard` minus its Balances tab, `PendingInvites`, create/delete group, `InviteDialog`) moves to `modules/settings/` under a new **`/settings/sharing`** sub-route; Settings promoted to sub-routes (`/settings` = general, `/settings/sharing`); `household.store` reused as-is |
| Wallet → Shared page (M) | Balances tab promoted to `modules/wallet/SharedPage.tsx` at **`/wallet/shared`** (sidebar Wallet section): balances **sectioned per group** + all-groups visual headline total; Settle Up dialog + settlement history + Undo move with it; deep-links into pre-filtered transaction views (`/wallet?view=shared-with-me`) instead of re-listing |
| Nav & redirects (S) | Top-level "Household" sidebar item removed; pending-invite badge + its polling (`Sidebar.tsx:86-97`) re-targeted to the Settings nav item; login-time banner/toast for pending invites so they aren't missed; `/household` renders a client `Navigate` to `/settings/sharing` for one release |
| §2.10 naming sweep (S) | Accounts *shared* / expenses *split* applied to labels, aria-labels, dialog titles, empty states; account sharing gets a titled section (or small dedicated dialog) instead of hiding inside Edit Account |
| §8.4 spec renumbering (S) | Renumber the four newer duplicate specs to **33–36** (`git log` decides "newer" per pair at 23/24/25/26); done here because the household/settlement specs are being rewritten anyway |

- **E2E:** rewrite `23-household` → group admin under `/settings/sharing`; rewrite
  `26-settlement` → settle/undo on `/wallet/shared`; add `/household`-redirect assertion;
  renumbered specs adjusted for new routes/selectors; `24-shared-accounts`, `25-splits`,
  `27-wallet-bulk-share` re-run (Wallet-based, mostly unaffected).
- **Commits:** Settings sub-routes + Sharing move / SharedPage / nav+redirect /
  naming sweep / spec renumbering — five commits.
- **Risks:** biggest diff of the plan, but almost all relocation. Run the **full e2e
  suite** — routing and sidebar changes touch every spec's navigation. Settings
  sub-route promotion must keep `11-settings` passing (general settings stay at
  `/settings`).

## Wave 4 — Transactions filter-bar reorganisation (owner-approved, §6.4)

**Branch:** `feat/wallet-filter-bar` · **Size:** ~450–550 lines · **Depends on:** Wave 3 merged

| Item | Implementation note |
|---|---|
| Search-first single row (M) | Default bar: wide search input first, then the date-range control, then `Filters (n)`, then conditional `✕ Clear` — replaces the two-row card (`WalletPage.tsx:317-459`) |
| One date-range control (M) | Segmented/dropdown picker — *This month · Last month · All time · Custom…* — always shows its active value (fixes the no-active-state pills); Custom reveals From/To; built on W1's `monthRange`; **reused by Dashboard and Reports** so the three pages converge on one date-range UI |
| Filters section (M) | Collapsible row/popover with active-count badge holding Type, Account, Category, Tags — plus the **Sharing view** moved in as a fifth filter, **hidden when the user has no groups** (stays deep-linkable via `?view=` for W3's Shared-page links) |
| Clear-all + `?account=` visibility (S) | Clear-all resets every filter incl. view and search; appears only when something is active; the active-count badge makes URL-driven narrowing visible |
| Manage-categories out of the bar (S) | Short-term: "Manage…" footer item inside the Category dropdown; proper home is Settings (noted for a later wave — it's configuration per §3) |

- **E2E:** update `03-wallet-transactions`, `28-wallet-search`, and every spec using
  the `filter-this-month` / `filter-last-month` / `filter-clear-dates` /
  `transaction-search` test-ids; update the renumbered intuitiveness spec's layout
  assertions; new `e2e/37-wallet-filter-bar.spec.ts` (active-state on range control,
  filter count badge, clear-all, sharing view hidden with no groups, `?view=`
  deep-link still lands).
- **Commits:** bar layout / date-range control + Dashboard/Reports adoption /
  Filters section + view pills / clear-all / manage-categories — five commits.
- **Risks:** heavily-asserted markup — grep all specs for the touched test-ids before
  changing them; run the **full suite**. Dashboard/Reports adoption of the range
  control must not change their computed ranges (specs 05, 18).

## Wave 5 — Cross-path behaviour rules

**Branch:** `fix/wallet-cross-path-rules` · **Size:** ~350–450 lines · **Depends on:** Wave 4 merged

| Item | Implementation note |
|---|---|
| §2.4 one write-permission rule (M) | CSV import (`wallet.ts:515`) permits writable shared-in accounts, matching manual add; recurring stays own-accounts-only (documented) **and** `RecurringPage.tsx:296-302` filters its dropdown to own accounts; CsvImport dropdown offers only accounts the flow accepts |
| §2.5 type-filtered CSV categories (S) | `CsvReviewTable.tsx:22-25` filters the category options per row type, matching TransactionForm/RecurringPage |
| §2.6 read-only rows (S) | Hide/disable edit/delete/split on rows and cards where `account.isShared && !account.canWrite` (data already client-side, `useWallet.ts:86-89`); AccountCard hides delete on shared-in accounts |
| §2.8 form defaults (S) | RecurringPage pre-selects first account + defaults next-due date to today, matching TransactionForm/Goals/CsvImport |
| §2.7 undo policy (M) | Transaction delete gets the task-style 5-second undo toast (row data still in memory); all other destructive actions standardise on the confirm dialog; bulk-delete copy stays honest ("cannot be undone") until W6's batch endpoint |

- **E2E:** blocks in `04-wallet-csv` (import into writable shared account succeeds;
  income category absent from an expense row's options); blocks in `24-shared-accounts`
  (read-only rows show no mutating actions); block in `14-wallet-recurring` (defaults);
  new `e2e/38-transaction-undo.spec.ts` (delete → undo restores row).
- **Commits:** §2.4 / §2.5 / §2.6 / §2.8 / §2.7 — five commits.
- **Risks:** §2.4 loosens a server check — verify the import path still enforces
  category ownership and per-user scoping (`24-shared-accounts` + API-level negative
  tests). Undo toast must not fight WalletPage's post-mutation refetch.

## Wave 6 — Dead code & data flow

**Branch:** `refactor/wallet-dataflow-cleanup` · **Size:** ~300–400 lines · **Depends on:** Wave 5 merged

| Item | Implementation note |
|---|---|
| §1.5 non-mutating fetch (M) | `fetchTransactions()` read-only variant in `useWallet` (doesn't touch the store); Dashboard, ReportsPage, BudgetsPage switch to it — visiting them no longer clobbers the shared transaction list |
| §1.6 bulk delete (M) | Batch `DELETE /transactions` endpoint (body: ids) next to the batch import route; WalletPage bulk delete uses it — one request, honest failure handling; SettingsPage save gets try/catch + toast; task-undo's row-by-row re-POST noted as accepted (task subtrees need ordered inserts) |
| §4.2–§4.4 dead code (S) | Delete `getFilteredSummary` (`useWallet.ts:562-578`) keeping one summary implementation; merge the duplicate `loadNetWorth` callback/effect (`WalletPage.tsx:141-152`); remove dead `POST /transactions/shares/status` (`wallet.ts:890-924`) |

- **E2E:** block in `05-wallet-dashboard` (visit Dashboard, return to Wallet — list
  unchanged, §1.5); bulk-delete block updated in `03-wallet-transactions` (multi-row
  delete in one action); `11-settings` block (failed save shows toast, via
  `page.route()` 500).
- **Commits:** §1.5 / §1.6 / §4.x — three commits.
- **Risks:** §1.5 changes who populates the store — BudgetsPage's month-bounded load
  (C8) must keep budgets accurate (`13-wallet-budgets`). Batch delete must be scoped
  per-user and per-ownership exactly like single delete.

## Wave 7 — Interaction & code consistency

**Branch:** `refactor/ui-consistency` · **Size:** ~500–650 lines · **Depends on:** Wave 6 merged (applies to the post-relocation pages)

| Item | Implementation note |
|---|---|
| §5.1 ConfirmDeleteModal everywhere (M) | Migrate AccountsPage, TransactionList, WalletPage bulk delete, delete-group + undo-settlement (now in their W3 homes), CategoryManager's inline panel; default `confirmLabel` becomes "Delete"; one title style ("Delete X?") |
| §5.2 useCrudModal adoption (S) | AccountsPage + WalletPage replace hand-rolled `formOpen`/`editing*`/`deleteTarget` state (~40 lines removed) |
| §5.3 error-toast rule (M) | Every mutation toasts on failure via `errorMessage()`; **Tasks module is the priority gap** (`useTasks`/`TasksPage` — add/update/delete/indent all silent today); also Sharing loads/invites, AccountForm's `catch(() => {})`, CategoryManager delete; form-validation feedback stays inline |
| §5.5 formatDisplayDate (S) | `formatDisplayDate()` in `lib/utils.ts` (`dd MMM yyyy`); fix `ReportsPage.tsx:173` raw ISO (BulkShareDialog already fixed in W2) |
| §5.6 UI primitives (S) | Replace raw `<select>`/`<input type="date">`/`<input type="number">` with `Select`/`DatePicker`/`Input` in AccountForm sharing section, settle dialog (W3 home), ReportsPage |
| §5.7 action affordances (S) | Icon-button pattern (ghost `Button`, aria-label, ≥40px) on BudgetsPage/GoalsPage/RecurringPage rows |
| §5.8 form semantics (S) | Budgets/Goals/Recurring become real `<form onSubmit>` (Enter submits) with per-field error props |

- **E2E:** blocks in `32-wallet-error-toasts` extended to Tasks (`page.route()` 500 on
  a task PATCH → toast, edit not silently lost); specs 02/03/13/14/16 re-run for the
  modal/state migrations; `01-tasks` re-run for §5.3's Tasks wiring.
- **Commits:** §5.1 / §5.2 / §5.3 (tasks) / §5.3 (rest) / §5.5+§5.6 / §5.7+§5.8 — six commits.
- **Risks:** widest page count of the plan — pure-refactor items (§5.1/§5.2) must keep
  existing specs passing unchanged; §5.3 in Tasks touches the hot editing path — verify
  no toast spam during rapid keystrokes (only failures toast).

## Wave 8 — Copy, settings & docs

**Branch:** `chore/copy-settings-docs` · **Size:** ~250–350 lines · **Depends on:** Wave 7 merged

| Item | Implementation note |
|---|---|
| §6.1 Settings corrections (S) | Remove (or disable with a note) the dead Default Currency select; reword the API-key copy (key is stored server-side since Phase 4); save error handling already fixed in W6 |
| §7 copy & visual quick wins (S) | Empty-state formula "No X yet" + action button everywhere `EmptyState` supports it; primary submit labels unified ("Save Changes" / "Create X"); extract `NetWorthBanner` from the WalletPage/AccountsPage duplicates |
| §8.3 migration-prefix guard (S) | Startup check in `server/db.ts` rejecting duplicate numeric prefixes in `server/migrations/` (existing 0003 pair grandfathered by exact filename) |
| §8.1/§8.2/§8.5 CLAUDE.md refresh (M) | §6 schema (due_date, budgets/recurring/goals/templates tables, tags array, `settlements.original_transaction_id`, amended payer-row invariant), §7 types (`tags: string[]`, Account share fields + openingBalance, Task.dueDate), §5 folder map incl. the W3 IA (settings/sharing, SharedPage), §13 status |
| §6.2/§6.3 decision notes (trivial) | Record in CLAUDE.md: template captures title only (rename affordance or future subtree capture — owner call); rebalance stays per-row PATCH until a batch endpoint is justified (amend §9.1 spec wording) |

- **E2E:** blocks updated where copy is asserted (empty-state titles, submit labels —
  grep first); `11-settings` updated for the currency-select removal; API-level guard
  test optional (unit-style, boot with a fabricated duplicate prefix in a temp dir).
- **Commits:** §6.1 / §7 / §8.3 guard / CLAUDE.md — four commits.
- **Risks:** low; mostly copy. The CLAUDE.md refresh must be written against the
  *post-W7 merged* state, which is why it lands last.

---

## Cross-wave summary

| # | Feature wave | Branch | Review items | New specs | Depends on |
|---|---|---|---|---|---|
| 1 | Correctness | `fix/wallet-correctness-dates-export-validation` | §1.1–1.4, §5.4 | — (blocks in 03/15/31) | main post-#35 |
| 2 | Split-model alignment | `feat/split-model-alignment` | §2.1–2.3, §4.1, §4.5, §5.9 | — (rework 27, blocks in 25-splits) | Wave 1 |
| 3 | Sharing IA relocation | `feat/sharing-ia-relocation` | §3, §2.10, §8.4 | 33–36 (renumbers) | Wave 2 |
| 4 | Filter-bar reorganisation | `feat/wallet-filter-bar` | §6.4 | 37 | Wave 3 |
| 5 | Cross-path rules | `fix/wallet-cross-path-rules` | §2.4–2.8 | 38 | Wave 4 |
| 6 | Dead code & data flow | `refactor/wallet-dataflow-cleanup` | §1.5, §1.6, §4.2–4.4 | — (blocks in 03/05/11) | Wave 5 |
| 7 | Interaction consistency | `refactor/ui-consistency` | §5.1–5.3, §5.5–5.8 | — (blocks in 32, 01) | Wave 6 |
| 8 | Copy, settings & docs | `chore/copy-settings-docs` | §6.1, §7, §8.1–8.3, §8.5 | — | Wave 7 |

**Per-wave gate** (CLAUDE.md §11/§16/§17): branch from fresh `main` → implement →
verify (`tsc`, `npm run typecheck:server`, lint, affected e2e specs — **full suite
for Waves 2, 3, and 4**, which touch shared dialogs, app routing, and
heavily-asserted filter markup) → PR → owner merges before the next wave branches.

## Deferred / recorded, not implemented

- **§5.10** DELETE semantics per entity — convention note only (blind 204 accepted), W8 doc line.
- **§5.11** post-mutation refresh strategy — documented as intentional per page in W8; no `afterMutation()` helper unless divergence bites again.
- **§2.9** wallet vs task search feel — intentional; CLAUDE.md note in W8. Wallet match-highlighting is a cheap future add, not scheduled.
- **§3.4** generic sharing helper extraction — explicitly deferred until the first non-wallet share feature lands.
- **§6.4 optional** URL-mirrored filter state — noted as a Phase-2 enhancement of W4, not scheduled.
