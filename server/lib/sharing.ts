import type { DB } from '../db.ts'

/**
 * Returns all account IDs the user can see: their own accounts plus any
 * accounts shared into a group they belong to.
 */
export function visibleAccountIds(db: DB, userId: string): string[] {
  const ownRows = db
    .prepare('SELECT id FROM accounts WHERE user_id = ?')
    .all(userId) as { id: string }[]

  const sharedRows = db
    .prepare(
      `SELECT DISTINCT a.id
       FROM account_shares acs
       JOIN groups g ON g.id = acs.group_id
       JOIN group_members gm ON gm.group_id = g.id AND gm.user_id = ?
       JOIN accounts a ON a.id = acs.account_id`,
    )
    .all(userId) as { id: string }[]

  const seen = new Set<string>()
  const ids: string[] = []
  for (const r of [...ownRows, ...sharedRows]) {
    if (!seen.has(r.id)) { seen.add(r.id); ids.push(r.id) }
  }
  return ids
}

/**
 * Returns true if the user can write transactions to this account.
 * True when: user owns the account, OR user is in a group that has can_write=1
 * on this account.
 */
export function canWriteAccount(db: DB, userId: string, accountId: string): boolean {
  const owned = db
    .prepare('SELECT 1 FROM accounts WHERE id = ? AND user_id = ?')
    .get(accountId, userId)
  if (owned) return true

  const shared = db
    .prepare(
      `SELECT 1
       FROM account_shares acs
       JOIN group_members gm ON gm.group_id = acs.group_id
       WHERE acs.account_id = ? AND gm.user_id = ? AND acs.can_write = 1`,
    )
    .get(accountId, userId)
  return !!shared
}

/**
 * For a given transaction, returns the amount attributable to this user.
 * If no split rows exist: returns transactions.amount (full).
 * If split rows exist: returns the user's share_amount, or 0 if not a participant.
 */
export function effectiveAmount(db: DB, userId: string, transactionId: string): number {
  const splitRow = db
    .prepare('SELECT share_amount FROM transaction_splits WHERE transaction_id = ? AND user_id = ?')
    .get(transactionId, userId) as { share_amount: number } | undefined

  if (splitRow !== undefined) return splitRow.share_amount

  // No split rows at all for this transaction → check if any splits exist
  const anyShare = db
    .prepare('SELECT 1 FROM transaction_splits WHERE transaction_id = ? LIMIT 1')
    .get(transactionId)

  if (anyShare) return 0 // splits exist but user has no share

  // No splits → full amount
  const txn = db
    .prepare('SELECT amount FROM transactions WHERE id = ?')
    .get(transactionId) as { amount: number } | undefined
  return txn?.amount ?? 0
}

/**
 * All task_list IDs the user can see: their own lists plus any list shared
 * into a group they belong to. Mirrors visibleAccountIds (D-15).
 */
export function visibleListIds(db: DB, userId: string): string[] {
  const ownRows = db
    .prepare('SELECT id FROM task_lists WHERE user_id = ?')
    .all(userId) as { id: string }[]

  const sharedRows = db
    .prepare(
      `SELECT DISTINCT tl.id
       FROM task_list_shares tls
       JOIN group_members gm ON gm.group_id = tls.group_id AND gm.user_id = ?
       JOIN task_lists tl ON tl.id = tls.list_id`,
    )
    .all(userId) as { id: string }[]

  const seen = new Set<string>()
  const ids: string[] = []
  for (const r of [...ownRows, ...sharedRows]) {
    if (!seen.has(r.id)) { seen.add(r.id); ids.push(r.id) }
  }
  return ids
}

/**
 * Every task_list ID the user may write tasks into: their own lists, plus any
 * list shared into a group they belong to with can_write=1. Mirrors
 * writableAccountIds (D-15).
 */
export function writableListIds(db: DB, userId: string): Set<string> {
  const rows = db
    .prepare(
      `SELECT id FROM task_lists WHERE user_id = ?
       UNION
       SELECT tls.list_id AS id
       FROM task_list_shares tls
       JOIN group_members gm ON gm.group_id = tls.group_id
       WHERE gm.user_id = ? AND tls.can_write = 1`,
    )
    .all(userId, userId) as { id: string }[]
  return new Set(rows.map((r) => r.id))
}

/**
 * True if `userId` is an owner-role member of `groupId`.
 */
export function isGroupOwner(db: DB, userId: string, groupId: string): boolean {
  return !!db
    .prepare("SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ? AND role = 'owner'")
    .get(groupId, userId)
}

/**
 * True if `userId` is any member of `groupId`.
 */
export function isGroupMember(db: DB, userId: string, groupId: string): boolean {
  return !!db
    .prepare('SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?')
    .get(groupId, userId)
}

/**
 * Returns all user IDs in the same groups as `userId` (including `userId` themselves).
 */
export function coGroupUserIds(db: DB, userId: string): string[] {
  const rows = db
    .prepare(
      `SELECT DISTINCT gm2.user_id
       FROM group_members gm1
       JOIN group_members gm2 ON gm2.group_id = gm1.group_id
       WHERE gm1.user_id = ?`,
    )
    .all(userId) as { user_id: string }[]
  return rows.map((r) => r.user_id)
}
