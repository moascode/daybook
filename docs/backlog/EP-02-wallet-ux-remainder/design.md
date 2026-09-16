> **Status:** Plan · **Last verified:** 2026-09-16

# EP-02 — implementation plan

Every item below was re-verified against current code on 2026-09-16 (the
2026-07 source notes had drifted — see each item file's own header). Two of
the five items were already fully shipped by other work and are now closed;
this doc covers the three with real remaining scope, each sized for its own
PR under `daybook-flow` (CLAUDE.md §13).

## Already closed, no PR needed

**FEAT-006 (responsive grid breakpoints) → Dropped.** Wallet's Dashboard and
Reports pages no longer use Tailwind `grid-cols-N` at all — they moved to a
custom 12-column CSS grid (`src/styles/layout.css`, `.dash`/`.c3`–`.c12`/
`.g2`–`.g4`/`.hero-stats`) with its own responsive breakpoints at 1080/860/
680/420px. The card/summary/chart grids the item was filed against don't
exist in that form anymore. Its only remaining trace — two narrow 2-column
form grids with no breakpoint — is small enough to ride along in FEAT-007's
PR rather than justify keeping this item open (see below).

**FEAT-008 (type/category badges on recurring cards) → Shipped.**
`RecurringPage.tsx:210-231` already renders a type badge, a frequency badge,
and a category badge via the shared `Badge` component
(`src/components/ui/Badge.tsx`), landed in `2a8ec2a` ("R3 PR-4 — Budgets/
Goals/Recurring/Reports design adoption", 2026-08-24) — after the 2026-07
finding date, which is why the item still showed as open. E2E coverage
already exists: `e2e/14-wallet-recurring.spec.ts:111-125` ("Phase 5c B10").

One cosmetic gap survives: `RecurringPage.tsx`'s category badge uses
`variant="default"` instead of passing `color={category.color}` the way
`TransactionList.tsx:249-251` does for the same badge elsewhere. Not worth
its own item — fold it into the FEAT-009 PR if that PR is already touching
`RecurringPage.tsx`, otherwise leave it.

---

## FEAT-007 — 40px touch targets (+ the 2 leftover FEAT-006 form grids)

**Effort: M**

### Current state

A proven ad-hoc pattern already exists at 10 call sites:
`min-h-[40px] min-w-[40px] md:min-h-0 md:min-w-0` layered onto
`Button variant="ghost" size="sm"` (`TransactionList.tsx:287`,
`AccountCard.tsx:142,153,164`, `GoalsPage.tsx:175,184`,
`BudgetsPage.tsx:225,234`, `RecurringPage.tsx:257,266`), plus an equivalent
`h-10 w-10 md:h-6 md:w-6` pattern in `BulletNode.tsx:244,261` (Tasks).

`Button.tsx:24-28` defines `sm`/`md`/`lg` sizes, all padding-only with no
fixed height and no icon-only variant. `--s10: 40px` already exists in
`src/index.css`'s `--s*` spacing scale — Tailwind's default `h-10`/`w-10`
(2.5rem) already resolves to it, so no new hardcoded value is needed.

### Remaining gaps — controls still below 40px, no responsive bump

| File | Line | Current size |
|---|---|---|
| `src/components/layout/ModuleSidebar.tsx` | 75-83 | 36×36px (`.sidebar-close`, `src/styles/shell.css:31`) |
| `src/modules/tasks/TasksListDetailPage.tsx` | 325 | 28×28px (`h-7 w-7`, colour swatch) |
| `src/modules/wallet/AccountForm.tsx` | 232 | 28×28px (`h-7 w-7`, colour swatch) |
| `src/modules/wallet/CategoryManager.tsx` | 164 | 24×24px (`h-6 w-6`, colour swatch) |
| `src/modules/tasks/TasksPage.tsx` | 500 | 28×28px (`h-7 w-7`, "All tasks" breadcrumb) |
| `src/modules/wallet/shared/SharedActivity.tsx` | 33 | 28×28px (`RowActionIcon`) |
| `src/modules/wallet/shared/SharedBalances.tsx` | 60 | 28×28px (`SettleIconButton`) |
| `src/modules/wallet/WalletPage.tsx` | 1020 | 32×32px (`h-8 w-8`, filter toggle, visible on mobile) |
| `src/modules/wallet/WalletPage.tsx` | 1118 | 32×32px (`h-8 w-8`, has `hide-mobile` — lower priority) |
| `src/components/ui/WelcomeCard.tsx` | 51 | 32×32px (`h-8 w-8`, dismiss button) |
| `src/modules/wallet/composer/ComposerPreview.tsx` | 118 | 28×28px (`h-7 w-7`, cancel button) |

Plus the two leftover un-breakpointed form grids from FEAT-006:
`TransactionForm.tsx:305` and `WalletPage.tsx:1055` (both `grid-cols-2`,
narrow, width-capped panels).

### Approach (decided)

Add a proper `size="icon"` variant to `Button.tsx` (`h-10 w-10 p-0`, with a
`md:` shrink where the existing ad-hoc call sites already shrink on desktop)
rather than repeating the ad-hoc className further. Migrate **all** ~20 call
sites — the 10 already on the ad-hoc pattern and the ~11 above — onto the new
variant, so there is one canonical icon-button size going forward instead of
two competing patterns. The colour-swatch buttons (`AccountForm.tsx:232`,
`CategoryManager.tsx:164`, `TasksListDetailPage.tsx:325`) may need the variant
combined with their existing swatch styling rather than a bare icon button —
check each renders correctly, they're not pure icon buttons.

Add `sm:grid-cols-2` (or equivalent) to the two leftover form grids.

### E2E coverage

Extend `e2e/21-mobile-responsive.spec.ts` (existing mobile-viewport spec) with:
- Computed-size assertions (`getBoundingClientRect` ≥ 40×40) on a sample of
  the migrated icon buttons at mobile viewport width.
- A check that the two form grids don't overflow/wrap badly at 390px.

---

## FEAT-009 — error toast coverage

**Effort: M**

### Current state

81 catch sites surveyed across `src/hooks/` (16) and `src/modules/wallet/`
(65), with a spot-check of `src/modules/tasks/` (15), `src/modules/trips/`
(1), `src/modules/day/` (1), and 5 shared components. The large majority are
already covered via `addToast` (`src/stores/toast.store.ts`) or an inline
error state distinct from "empty" — the codebase already treats this as a
named rule ("rule 13") in scattered comments. `useTasks.ts`,
`useThemePreference.ts`, and the non-poll parts of `useNotificationBadges.ts`
are fully covered via a shared `reportAndReconcile` helper.

### Real gaps (get a toast)

| File | Line | What happens today |
|---|---|---|
| `src/modules/wallet/AccountForm.tsx` | 88 | `Promise.all([shares, groups]).catch(() => {})` — sharing tab silently shows "no groups" instead of "couldn't load" |
| `src/modules/wallet/WalletPage.tsx` | 171 | `api.get('/groups').catch(() => {})` — `hasGroups` silently stays `false`, hiding sharing UI with no signal it's a failure vs. genuinely no groups |
| `src/modules/wallet/BulkSplitDialog.tsx` | 109 | `.catch(() => [] as TransactionShare[])` per-transaction split fetch |
| `src/modules/wallet/BulkSplitDialog.tsx` | (outer `loadData`) | the `/groups/members` call in the same function has **no catch at all** — an unhandled rejection, needs one adding, not just a toast |
| `src/modules/wallet/SplitDialog.tsx` | 59 | same silent-empty-shares pattern as `BulkSplitDialog.tsx` |
| `src/modules/wallet/dashboard/SharedSummary.tsx` | 59 | silent subtitle member-count fetch (low stakes, cosmetic) |
| `src/modules/wallet/transferCandidates.ts` | 94 | silent `[]` degrade, undocumented |
| `src/modules/wallet/TransferMatchHint.tsx` | 97 | silent `[]` degrade, undocumented |
| `src/modules/wallet/LinkTransferDialog.tsx` | 56 | silent `[]` degrade, undocumented |

The last three are a deliberate deviation from `SettleUpDialog.tsx:109`,
which does the identical fetch-and-degrade but *documents* it as intentional
("a preview is an aid, not a gate") and stays silent. **Decision: toast these
three anyway rather than just documenting them** — leave a one-line comment
at each site explaining why they're toasted while `SettleUpDialog.tsx`'s
equivalent isn't, so a future reader doesn't "fix" the inconsistency the
wrong way by reverting one or the other.

### Not in scope

`useNotificationBadges.ts:64,87,106` (60s background poll, explicitly
commented as intentional), `CaptureInboxBadge.tsx:29` (ambient badge, cites
rule 13 directly), `WelcomeCard.tsx:36` (dismiss-flag PUT, "worst case the
card reappears"), `Composer.tsx:162,187` (already cite rule 13, hand off to
fallback UI or rethrow) — all already correctly documented as intentional,
leave alone.

### E2E coverage

Extend `e2e/32-wallet-error-toasts.spec.ts`, which already has the exact
pattern needed (`force500Once()` via `page.route()`, serial test mode). Add
one case per real gap above — roughly 7-8 new cases, each asserting a toast
appears and the surrounding UI degrades sensibly (dialog stays open, tab
shows an error state, etc.) rather than silently showing empty.

---

## FEAT-010 — dead code sweep

**Effort: S**

### Current state

The original finding was two functions; one is already gone:

- `processRecurringTransactions` — **already fully removed**, zero hits
  anywhere in the repo. Drop this from scope, nothing to do.
- `getMonthlySpending` (`src/hooks/useWallet.ts:531,739`) — **still dead**.
  Zero callers outside the file; `BudgetsPage.tsx` correctly uses the
  separate, split-aware `getBudgetSpending` instead.

One new finding from the same pass: `useSplits` (`src/hooks/useSplits.ts:45`)
— the hook function itself is dead. Only its sibling action functions
(`approveSplit`, `approveSplits`, `unapproveSplit`, `cancelSplit`,
`rejectSplit`) are imported anywhere (`SharedActivity.tsx`); the hook export
has zero callers.

Other hook exports checked and confirmed live: `useCrudModal`,
`useTaskLists`, `useChartTheme`, `useThemePreference`,
`useNotificationBadges`, `getAccountBalance`.

### Approach

Delete `getMonthlySpending` and the `useSplits` hook (and their entries in
`useWallet`'s / `useSplits`'s returned/exported object) — two small,
independent, low-risk deletions. Confirm with `tsc -b` and a repo-wide grep
that nothing else references either name after removal.

### E2E coverage

None needed — non-behavioural, explicitly out of scope per the item's own
"Out of scope: anything behavioural."
