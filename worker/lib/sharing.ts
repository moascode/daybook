// Async port of server/lib/sharing.ts. Used by the groups, settlements and
// (in the next increment) wallet routes.
//
// Every function here is one or two round trips on D1 where it was a free
// in-process call under better-sqlite3. That is fine for a single guard per
// request, but see the note on canWriteAccount — it is the one that must never
// be called in a loop.

/**
 * All account IDs the user can see: their own accounts plus any accounts shared
 * into a group they belong to.
 */
export async function visibleAccountIds(db: D1Database, userId: string): Promise<string[]> {
  const own = await db.prepare('SELECT id FROM accounts WHERE user_id = ?').bind(userId).all<{
    id: string
  }>()

  const shared = await db
    .prepare(
      `SELECT DISTINCT a.id
       FROM account_shares acs
       JOIN groups g ON g.id = acs.group_id
       JOIN group_members gm ON gm.group_id = g.id AND gm.user_id = ?
       JOIN accounts a ON a.id = acs.account_id`,
    )
    .bind(userId)
    .all<{ id: string }>()

  const seen = new Set<string>()
  const ids: string[] = []
  for (const r of [...own.results, ...shared.results]) {
    if (!seen.has(r.id)) {
      seen.add(r.id)
      ids.push(r.id)
    }
  }
  return ids
}

/**
 * True if the user can write transactions to this account — they own it, or they
 * are in a group holding `can_write = 1` on it.
 *
 * ⚠️ Up to two round trips per call. The CSV import route calls this **per row**
 * (server/routes/wallet.ts:583-595), which is free under better-sqlite3 and
 * 1,000+ sequential awaited queries for a 500-row import under D1 — the N+1
 * documented in docs/option-2-spike-findings.md S2. Use writableAccountIds()
 * once and check a Set instead whenever the caller has a list.
 */
export async function canWriteAccount(
  db: D1Database,
  userId: string,
  accountId: string,
): Promise<boolean> {
  const owned = await db
    .prepare('SELECT 1 AS ok FROM accounts WHERE id = ? AND user_id = ?')
    .bind(accountId, userId)
    .first()
  if (owned) return true

  const shared = await db
    .prepare(
      `SELECT 1 AS ok
       FROM account_shares acs
       JOIN group_members gm ON gm.group_id = acs.group_id
       WHERE acs.account_id = ? AND gm.user_id = ? AND acs.can_write = 1`,
    )
    .bind(accountId, userId)
    .first()
  return !!shared
}

/**
 * Batched form of canWriteAccount: every account id the user may write to.
 *
 * This is the fix for the S2 N+1. One query instead of 2×N, and the result is a
 * Set the caller checks in memory. Introduced here so the wallet port has it
 * ready rather than discovering the problem at 500-row import time.
 */
export async function writableAccountIds(db: D1Database, userId: string): Promise<Set<string>> {
  const { results } = await db
    .prepare(
      `SELECT id FROM accounts WHERE user_id = ?1
       UNION
       SELECT acs.account_id AS id
       FROM account_shares acs
       JOIN group_members gm ON gm.group_id = acs.group_id
       WHERE gm.user_id = ?1 AND acs.can_write = 1`,
    )
    .bind(userId)
    .all<{ id: string }>()
  return new Set(results.map((r) => r.id))
}

/**
 * For a given transaction, the amount attributable to this user.
 * No split rows → the full transaction amount. Split rows exist → this user's
 * share_amount, or 0 if they are not a participant.
 */
export async function effectiveAmount(
  db: D1Database,
  userId: string,
  transactionId: string,
): Promise<number> {
  const splitRow = await db
    .prepare('SELECT share_amount FROM transaction_splits WHERE transaction_id = ? AND user_id = ?')
    .bind(transactionId, userId)
    .first<{ share_amount: number }>()
  // NOTE: `.first()` returns null where better-sqlite3's `.get()` returned
  // undefined. The server compared `!== undefined`, which would be true for
  // null and silently return null as the amount — so this must test for null.
  if (splitRow !== null) return splitRow.share_amount

  const anyShare = await db
    .prepare('SELECT 1 AS ok FROM transaction_splits WHERE transaction_id = ? LIMIT 1')
    .bind(transactionId)
    .first()
  if (anyShare) return 0 // splits exist but this user has no share

  const txn = await db
    .prepare('SELECT amount FROM transactions WHERE id = ?')
    .bind(transactionId)
    .first<{ amount: number }>()
  return txn?.amount ?? 0
}

/** True if `userId` is an owner-role member of `groupId`. */
export async function isGroupOwner(
  db: D1Database,
  userId: string,
  groupId: string,
): Promise<boolean> {
  const row = await db
    .prepare("SELECT 1 AS ok FROM group_members WHERE group_id = ? AND user_id = ? AND role = 'owner'")
    .bind(groupId, userId)
    .first()
  return !!row
}

/** True if `userId` is any member of `groupId`. */
export async function isGroupMember(
  db: D1Database,
  userId: string,
  groupId: string,
): Promise<boolean> {
  const row = await db
    .prepare('SELECT 1 AS ok FROM group_members WHERE group_id = ? AND user_id = ?')
    .bind(groupId, userId)
    .first()
  return !!row
}

/** All user IDs in the same groups as `userId`, including `userId`. */
export async function coGroupUserIds(db: D1Database, userId: string): Promise<string[]> {
  const { results } = await db
    .prepare(
      `SELECT DISTINCT gm2.user_id
       FROM group_members gm1
       JOIN group_members gm2 ON gm2.group_id = gm1.group_id
       WHERE gm1.user_id = ?`,
    )
    .bind(userId)
    .all<{ user_id: string }>()
  return results.map((r) => r.user_id)
}
