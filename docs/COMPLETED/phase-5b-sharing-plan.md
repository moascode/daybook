# Phase 5b — Transaction Sharing & Family Groups: Implementation Plan

> Planned: 2026-06-01 | Status: Pending implementation

---

## Recommended Approach

Build a **household group** abstraction with two sharing primitives layered on top:
1. **Shared accounts** — one account (e.g. joint credit card) visible to multiple users
2. **Transaction splits** — divide a transaction into per-member shares with settlement tracking

Current `user_id` isolation stays as the default. Sharing is opt-in and additive — no existing queries break. All visibility flows through a single `visibleAccountIds(userId)` helper on the server.

---

## Confirmed Decisions (owner sign-off 2026-06-01)

| # | Question | Decision |
|---|---|---|
| 1 | Multiple households? | Yes — a user can belong to multiple groups simultaneously |
| 2 | Shared account write default | Read-only by default; owner can grant add/edit permission per group |
| 3 | Net worth / balance for shared accounts | Dashboard toggle: "Own accounts only" vs "Include shared accounts" |
| 4 | Edit amount on a split transaction | Auto-rescale all share lines proportionally |
| 5 | Settlement creates real transactions? | Yes — two real `transfer` transactions are created in the ledger |
| 6 | Categories on shared items | Show the original owner's category name and colour (read-only) |
| 7 | MVP scope | All four phases (A–D) in v1 of this feature |

---

## Key Design Addition: Transaction Ownership & Spending Attribution

When a transaction is split, each user's **share** is what counts as *their* spending — not the full transaction amount.

- **Payer (original owner)**: their spending = their own share line (`transaction_shares.share_amount` where `user_id = payer`), not the full `transactions.amount`
- **Recipient (non-payer)**: their spending = their share line — shows up in their own dashboard/reports as real expenditure
- Every existing dashboard, report, and budget calculation must respect this: if a transaction has splits, use `transaction_shares.share_amount` for the relevant user; if no splits exist, fall back to `transactions.amount` as today

### Dashboard "spending view" toggle
- "My transactions only" — shows only transactions the user created + their share portions of splits
- "All visible" — includes all transactions on shared accounts (full amounts, regardless of splits)
- Default: "My transactions only"

### Filter in TransactionList
- Filter pill options: **Mine** | **Shared with me** | **All**
- "Mine" = transactions I created (whether split or not), with my share amount shown for splits
- "Shared with me" = transactions created by others where I have a share line
- "All" = everything visible (own + shared accounts + all splits)

---

## Data Model

### New migration: `server/migrations/0003_sharing.sql`

```sql
-- A household / family group.
CREATE TABLE IF NOT EXISTS groups (
  id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  name        TEXT NOT NULL,
  created_by  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TEXT DEFAULT (datetime('now'))
);

-- Group membership. A user can belong to multiple groups.
CREATE TABLE IF NOT EXISTS group_members (
  group_id   TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'member',   -- 'owner' | 'member'
  joined_at  TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (group_id, user_id)
);

-- Pending invites (username-based, no email infra needed).
CREATE TABLE IF NOT EXISTS group_invites (
  id         TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  group_id   TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  invitee_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invited_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status     TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'accepted' | 'declined' | 'revoked'
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE (group_id, invitee_id)
);

-- Per-account share grant. Ownership stays with accounts.user_id;
-- this table adds visibility (and optionally write access) for group members.
CREATE TABLE IF NOT EXISTS account_shares (
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  group_id   TEXT NOT NULL REFERENCES groups(id)   ON DELETE CASCADE,
  can_write  INTEGER NOT NULL DEFAULT 0,            -- 0=read-only, 1=can add/edit transactions
  shared_at  TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (account_id, group_id)
);

-- Split lines. One row per user per split transaction.
-- The payer has a row too (their own portion).
-- SUM(share_amount) across all rows = transactions.amount.
-- All spending calculations use share_amount for the relevant user when rows exist.
CREATE TABLE IF NOT EXISTS transaction_shares (
  id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  transaction_id  TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  share_amount    REAL NOT NULL,
  note            TEXT DEFAULT '',
  settled_at      TEXT DEFAULT NULL,               -- NULL = outstanding
  created_at      TEXT DEFAULT (datetime('now')),
  UNIQUE (transaction_id, user_id)
);

-- Explicit settlement records ("I paid you RM80 cash").
-- Auto-creates two transfer transactions in the ledger (confirmed decision #5).
CREATE TABLE IF NOT EXISTS settlements (
  id                      TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  group_id                TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  from_user               TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_user                 TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount                  REAL NOT NULL,
  currency                TEXT NOT NULL DEFAULT 'MYR',
  note                    TEXT DEFAULT '',
  -- These two transactions are created automatically in the ledger:
  from_transaction_id     TEXT REFERENCES transactions(id) ON DELETE SET NULL,
  to_transaction_id       TEXT REFERENCES transactions(id) ON DELETE SET NULL,
  settled_at              TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_group_members_user        ON group_members(user_id);
CREATE INDEX IF NOT EXISTS idx_account_shares_group      ON account_shares(group_id);
CREATE INDEX IF NOT EXISTS idx_txn_shares_user_settled   ON transaction_shares(user_id, settled_at);
CREATE INDEX IF NOT EXISTS idx_txn_shares_txn            ON transaction_shares(transaction_id);
```

### Key server helper: `server/lib/sharing.ts`
```ts
// Returns all account IDs the user can see (own + shared-in via any group).
function visibleAccountIds(db, userId): string[]

// Returns true if the user can write transactions to this account.
function canWriteAccount(db, userId, accountId): boolean

// For a given transaction, returns the amount attributable to this user.
// If no split rows exist: returns transactions.amount (full).
// If split rows exist: returns the user's share_amount (or 0 if not a participant).
function effectiveAmount(db, userId, transactionId): number
```

---

## Phased Delivery

### Phase A — Households (groups, invites, memberships)
**Goal**: Users can create a household, invite family members by username, accept/decline.

**DB**: `groups`, `group_members`, `group_invites`

**API endpoints**:
- `GET  /api/groups` — my groups
- `POST /api/groups` — create `{name}`
- `GET  /api/groups/:id` — detail + members
- `PATCH /api/groups/:id` — rename (owner only)
- `DELETE /api/groups/:id` — delete (owner only; block if outstanding shares exist)
- `GET  /api/groups/:id/members`
- `DELETE /api/groups/:id/members/:userId` — remove member (owner) or self-leave
- `POST /api/groups/:id/invites` — invite `{username}`
- `GET  /api/invites` — my pending invites (inbound)
- `POST /api/invites/:id/accept`
- `POST /api/invites/:id/decline`
- `DELETE /api/invites/:id` — revoke (inviter only)
- `GET  /api/users/search?q=` — username prefix search (authenticated; for invite UI)

**UI**: New `src/modules/household/` folder
- `HouseholdPage.tsx` — list groups, create group, member management
- `InviteDialog.tsx` — username search + send invite
- `InvitationsBadge.tsx` — sidebar badge for pending inbound invites
- `household.store.ts` — Zustand store
- `src/types/household.types.ts` — Group, GroupMember, GroupInvite interfaces
- Settings tab: "Household" added to `SettingsPage.tsx`
- New route: `/household`

**E2E** (`e2e/23-household.spec.ts`):
- Alice creates group → invites Bob → Bob accepts → both see each other in member list
- Alice invites Charlie → Charlie declines → invite disappears
- Bob leaves → Alice sees only herself
- Alice cannot see Bob's group

**Effort**: ~2–3 dev-days

---

### Phase B — Shared Accounts (read-only visibility, optional write)
**Goal**: Alice shares "Family Visa" with the household; Bob sees the account and all its transactions.

**DB**: `account_shares`

**API changes**:
- `GET  /api/accounts/:id/shares` — current share grants
- `POST /api/accounts/:id/shares` — `{groupId, canWrite}` (owner only)
- `PATCH /api/accounts/:id/shares/:groupId` — update `canWrite`
- `DELETE /api/accounts/:id/shares/:groupId` — unshare (owner only)
- Modify `GET /api/accounts` — union in shared-in accounts via `visibleAccountIds`
- Modify `GET /api/accounts/:id/balance` — no change (balance is canonical per account)
- Modify `GET /api/transactions` — filter by `visibleAccountIds` not just `user_id`
- Write guards on `POST/PATCH/DELETE /api/transactions` — check `canWriteAccount`

**Server**: Introduce `server/lib/sharing.ts` with helpers above.

**UI**:
- `AccountForm.tsx` — add "Sharing" section (list shares, add/remove/toggle write)
- `AccountCard.tsx` — "Shared by X" badge on shared-in accounts; "Shared with N" badge on own shared accounts
- `TransactionList.tsx` — owner avatar/name on rows from shared accounts; hide edit/delete when no write permission
- Dashboard "net worth" toggle: "Own accounts" / "Include shared" (stored in user settings)

**E2E** (`e2e/24-shared-accounts.spec.ts`):
- Alice shares account (read-only) → Bob sees account and transactions → Bob cannot edit
- Alice grants can_write → Bob posts a transaction → both see it
- Alice unshares → Bob no longer sees it
- Dashboard toggle: Bob's net worth excludes shared account when toggled off

**Effort**: ~4–5 dev-days

---

### Phase C — Transaction Splits
**Goal**: Alice pays RM200 groceries; she splits it 60/40 with Bob. Bob's dashboard shows RM80 as his spending.

**DB**: `transaction_shares`

**API endpoints**:
- `GET  /api/transactions/:id/shares`
- `POST /api/transactions/:id/shares` — `{shares: [{userId, shareAmount, note}]}`:
  - Validates `SUM(shareAmount) === transaction.amount` (within rounding tolerance)
  - Validates all users are in a shared group with the transaction owner
  - Replaces any existing rows atomically
  - Auto-rescales if transaction amount was edited (see below)
- `DELETE /api/transactions/:id/shares` — remove all splits (back to private)
- `GET  /api/transactions?view=shared-with-me` — transactions where I have a share but am not the creator
- Modify all spending aggregation (dashboard totals, category breakdown) to use `effectiveAmount`

**Amount edit + auto-rescale rule**:  
On `PATCH /api/transactions/:id`, if `amount` changes and `transaction_shares` rows exist:
```
new_share = round(old_share / old_amount * new_amount, 2)
# Last share absorbs rounding remainder so sum stays exact
```

**Split modes in UI** (frontend only — API always receives final `shareAmount`):
- **Equal**: `amount / N`, last person absorbs remainder
- **Custom amount**: free text per person, live validation
- **Percentage**: percent per person, converts to amounts on submit

**UI**:
- `SplitDialog.tsx` — mode selector, member multi-select (from user's groups), live sum validation
- Transaction row chip: "Split ✓" (settled) or "You owe Alice RM80" or "Bob owes you RM80"
- TransactionList filter pill: **Mine** | **Shared with me** | **All**
- Dashboard tile: "Outstanding splits" — net owed-to-me and I-owe totals
- All spending calculations (`Dashboard.tsx`, `ReportsPage.tsx`) use `effectiveAmount`

**E2E** (`e2e/25-splits.spec.ts`):
- Alice splits RM200 60/40 with Bob → Bob sees "you owe Alice RM80" in "Shared with me"
- Alice's dashboard shows RM120 spending (her share), not RM200
- Bob's dashboard shows RM80 as his spending
- Alice edits amount to RM240 → shares auto-rescale to RM144 / RM96
- Alice removes split → transaction returns to private, Bob can no longer see it

**Effort**: ~4–5 dev-days

---

### Phase D — Settlement & Balances
**Goal**: Bob can see he owes Alice RM80 and record settlement. Two real transfer transactions created in the ledger.

**DB**: `settlements` (+ `transaction_shares.settled_at` already in schema)

**API endpoints**:
- `GET  /api/groups/:id/balances` — pairwise net amounts per currency
- `POST /api/settlements` — `{groupId, toUser, amount, note, fromAccountId, toAccountId}`:
  - Creates two `transfer` transactions: `expense` on `fromAccountId` (payer) + `income` on `toAccountId` (recipient)
  - Marks oldest outstanding `transaction_shares` rows settled (FIFO by `created_at`) up to the settled amount
  - Creates `settlements` record with both transaction IDs
- `DELETE /api/settlements/:id` — undo settlement (owner only, within same day; deletes the two transactions, un-settles the share rows)
- `GET  /api/settlements?groupId=` — settlement history
- `POST /api/transaction-shares/:id/settle` — manual mark single share as settled
- `POST /api/transaction-shares/:id/unsettle`

**Settlement flow — two transfer transactions**:
```
Bob settles RM80 with Alice:
  Transaction 1 (Bob's ledger): type=transfer, account=Bob's Cash, 
    destination_account_id=NULL (Alice's account, different user — use description instead),
    amount=80, description="Settlement to Alice — groceries"
  Transaction 2 (Alice's ledger): type=income, account=Alice's Cash,
    amount=80, description="Settlement from Bob — groceries"
  (True cross-user transfer is not possible via destination_account_id since accounts are user-scoped.
   Two separate transactions with a settlements record linking them is the correct model.)
```

**UI**:
- `BalancesTab.tsx` inside HouseholdPage — pairwise balance table, "Settle Up" CTA per row
- `SettleUpDialog.tsx` — counterparty, amount (defaults to net owed), pick source account, destination account (for the ledger entries), note
- Settlement history list in HouseholdPage
- "Mark settled" action on individual share rows in Shared-with-me view
- Dashboard: replace "Outstanding splits" tile with live net balance (owed/owe summary)

**E2E** (`e2e/26-settlement.spec.ts`):
- Alice owed RM80 from Bob → Bob opens Settle Up, picks Cash account → two transfer txns created → share marked settled → group balance = 0
- Alice's Cash shows +RM80 income; Bob's Cash shows -RM80 (transfer out)
- Bob undoes settlement within same day → transactions deleted, share unsettled, balance restores

**Effort**: ~3–4 dev-days

---

## Files Changed Summary

| File | Change |
|---|---|
| `server/migrations/0003_sharing.sql` | NEW — all sharing tables |
| `server/lib/sharing.ts` | NEW — `visibleAccountIds`, `canWriteAccount`, `effectiveAmount` |
| `server/lib.ts` | Extend `updateRow` for new tables |
| `server/routes/wallet.ts` | All list queries + write guards use sharing helpers |
| `server/routes/groups.ts` | NEW — group/invite/member endpoints |
| `server/routes/settlements.ts` | NEW — settlement endpoints |
| `server/index.ts` | Mount new routers |
| `src/types/household.types.ts` | NEW — Group, Member, Invite, Share, Split, Settlement |
| `src/types/wallet.types.ts` | Add `shares?: TransactionShare[]` on Transaction |
| `src/lib/api.ts` | New typed methods for groups, shares, settlements |
| `src/modules/household/` | NEW — HouseholdPage, InviteDialog, InvitationsBadge |
| `src/modules/wallet/SplitDialog.tsx` | NEW |
| `src/modules/wallet/TransactionList.tsx` | Split chips, filter pills, owner badge, effective amount |
| `src/modules/wallet/TransactionForm.tsx` | Share section, edit triggers rescale |
| `src/modules/wallet/AccountsPage.tsx` | Shared-in accounts, sharing badges |
| `src/modules/wallet/AccountForm.tsx` | Sharing section |
| `src/modules/wallet/Dashboard.tsx` | effectiveAmount for spending, net worth toggle, outstanding splits tile |
| `src/modules/wallet/ReportsPage.tsx` | effectiveAmount for all aggregations |
| `src/modules/household/BalancesTab.tsx` | NEW — pairwise balances |
| `src/modules/household/SettleUpDialog.tsx` | NEW |
| `src/modules/settings/SettingsPage.tsx` | Add Household tab |
| `src/stores/household.store.ts` | NEW — Zustand store for groups/invites |
| `src/stores/wallet.store.ts` | Add shares cache, dashboard toggle state |
| `src/router.tsx` | Add `/household` route |
| `e2e/23-household.spec.ts` | NEW |
| `e2e/24-shared-accounts.spec.ts` | NEW |
| `e2e/25-splits.spec.ts` | NEW |
| `e2e/26-settlement.spec.ts` | NEW |

---

## Total Effort Estimate

| Phase | Effort |
|---|---|
| A — Households | 2–3 dev-days |
| B — Shared accounts | 4–5 dev-days |
| C — Splits + spending attribution | 4–5 dev-days |
| D — Settlement | 3–4 dev-days |
| **Total** | **~13–17 dev-days** |

---

## Implementation Notes

- **No changes to existing tables** — all changes are additive (new tables + new columns only). Existing user-scoped queries keep working unchanged.
- **`effectiveAmount` is the key invariant**: every place that sums `transactions.amount` for spending (dashboard, reports, budgets) must use `effectiveAmount` instead once Phase C lands. Missing this in one place = wrong totals.
- **Settlement creates real transactions**: settlement `transfer` records must be excluded from the "splits outstanding" calculation (they are regular ledger entries, not new debts).
- **Cross-user `destination_account_id`**: the existing `transfer` type links two accounts owned by the *same* user. For settlements between different users, use two separate `income`/`expense` transactions linked only by the `settlements` table — do not try to use `destination_account_id` across user boundaries.
- **Rounding**: always assign the remainder penny to the transaction creator's share line. This ensures `SUM(share_amount) === transaction.amount` exactly without floating-point drift.
