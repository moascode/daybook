import { todayStr, businessDatePlus } from '../lib.ts'
import { EFFECTIVE_AMOUNT_SQL } from './sharing.ts'

// What Daybook is willing to interrupt you about (v3 P4).
//
// Every figure here is computed server-side and read live — the push itself
// carries no payload, so the service worker asks for this at the moment it
// shows the notification. A number can therefore never be stale by the time
// you read it.
//
// EFFECTIVE_AMOUNT_SQL is used for every money figure, never `amount`. A split
// transaction's effective cost is not its gross, and a notification saying you
// spent RM100 on something you split in half would be exactly the class of bug
// CLAUDE.md §9.2 documents.

export type Slot = 'morning' | 'evening'

export interface Notification {
  kind: string
  title: string
  body: string
  /** Where tapping it should land. */
  url: string
}

const SILENCE_DAYS = 5
const BUDGET_THRESHOLD = 0.9

function money(n: number): string {
  return `RM${n.toFixed(2)}`
}

/** Tasks due today or already overdue, not completed. */
async function tasksDue(db: D1Database, userId: string): Promise<Notification | null> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM tasks
        WHERE user_id = ? AND is_completed = 0
          AND due_date IS NOT NULL AND due_date != '' AND due_date <= ?`,
    )
    .bind(userId, todayStr())
    .first<{ n: number }>()
  const n = Number(row?.n ?? 0)
  if (n === 0) return null
  return {
    kind: 'tasks',
    title: n === 1 ? '1 task due' : `${n} tasks due`,
    body: n === 1 ? 'One thing is due today or overdue.' : `${n} things are due today or overdue.`,
    url: '/tasks',
  }
}

async function capturesWaiting(db: D1Database, userId: string): Promise<Notification | null> {
  const row = await db
    .prepare(`SELECT COUNT(*) AS n FROM pending_captures WHERE user_id = ? AND status = 'pending'`)
    .bind(userId)
    .first<{ n: number }>()
  const n = Number(row?.n ?? 0)
  if (n === 0) return null
  return {
    kind: 'captures',
    title: n === 1 ? '1 payment to review' : `${n} payments to review`,
    body: 'Captured from your phone and waiting to be accepted.',
    url: '/wallet/inbox',
  }
}

/**
 * The silence detector: an automation that quietly stopped firing.
 *
 * Only ever warns a user who has a live capture token — someone who never set
 * capture up is not "silent", they simply do not use it, and telling them
 * otherwise is noise.
 */
async function captureSilence(db: D1Database, userId: string): Promise<Notification | null> {
  const row = await db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM capture_tokens WHERE user_id = ?1 AND revoked_at IS NULL) AS tokens,
         (SELECT MAX(created_at) FROM pending_captures WHERE user_id = ?1) AS last_at`,
    )
    .bind(userId)
    .first<{ tokens: number; last_at: string | null }>()

  if (!row || Number(row.tokens) === 0) return null

  const cutoff = businessDatePlus(-SILENCE_DAYS)
  const lastDate = (row.last_at ?? '').slice(0, 10)
  if (lastDate && lastDate > cutoff) return null

  return {
    kind: 'silence',
    title: 'No payments captured recently',
    body: lastDate
      ? `Nothing since ${lastDate}. Your phone's automation may have stopped — worth checking Shortcuts.`
      : 'Your device is set up but has never sent a payment. Worth checking the automation in Shortcuts.',
    url: '/settings',
  }
}

/** Split claims standing against you and still open. */
async function openClaims(db: D1Database, userId: string): Promise<Notification | null> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n
         FROM transaction_splits ts
         JOIN transactions t ON t.id = ts.transaction_id
        WHERE ts.user_id = ? AND t.user_id != ts.user_id
          AND ts.status = 'pending' AND ts.settled_at IS NULL`,
    )
    .bind(userId)
    .first<{ n: number }>()
  const n = Number(row?.n ?? 0)
  if (n === 0) return null
  return {
    kind: 'claims',
    title: n === 1 ? '1 split to review' : `${n} splits to review`,
    body: 'Someone has split a transaction with you.',
    url: '/wallet/shared',
  }
}

/** Any budget at or past 90% of its limit this month. */
async function budgetThreshold(db: D1Database, userId: string): Promise<Notification | null> {
  const monthStart = `${todayStr().slice(0, 7)}-01`
  const { results } = await db
    .prepare(
      `SELECT c.name AS name, b.limit_amount AS lim,
              COALESCE((
                SELECT SUM(${EFFECTIVE_AMOUNT_SQL('t')})
                  FROM transactions t
                 WHERE t.user_id = ? AND t.category_id = b.category_id
                   AND t.type = 'expense' AND t.date >= ?
              ), 0) AS spent
         FROM budgets b
         JOIN categories c ON c.id = b.category_id
        WHERE b.user_id = ? AND b.limit_amount > 0`,
    )
    .bind(userId, userId, monthStart, userId)
    .all<{ name: string; lim: number; spent: number }>()

  const over = results
    .map((r) => ({ ...r, pct: Number(r.spent) / Number(r.lim) }))
    .filter((r) => r.pct >= BUDGET_THRESHOLD)
    .sort((a, b) => b.pct - a.pct)

  if (over.length === 0) return null
  const top = over[0]
  const pct = Math.round(top.pct * 100)
  return {
    kind: 'budget',
    title: `${top.name} is at ${pct}%`,
    body:
      over.length === 1
        ? `${money(Number(top.spent))} of ${money(Number(top.lim))} this month.`
        : `${money(Number(top.spent))} of ${money(Number(top.lim))} this month, and ${over.length - 1} other budget${over.length > 2 ? 's' : ''} near the limit.`,
    url: '/wallet/budgets',
  }
}

/** What you spent today. Evening only — it is a summary, not an alert. */
async function todaySpend(db: D1Database, userId: string): Promise<Notification | null> {
  const today = todayStr()
  const row = await db
    .prepare(
      `SELECT COALESCE(SUM(${EFFECTIVE_AMOUNT_SQL('t')}), 0) AS total, COUNT(*) AS n
         FROM transactions t
        WHERE t.user_id = ? AND t.type = 'expense' AND t.date = ?`,
    )
    .bind(userId, userId, today)
    .first<{ total: number; n: number }>()

  const total = Number(row?.total ?? 0)
  const n = Number(row?.n ?? 0)
  if (n === 0) {
    return { kind: 'spend', title: 'Nothing spent today', body: 'No expenses recorded.', url: '/wallet' }
  }
  return {
    kind: 'spend',
    title: `${money(total)} spent today`,
    body: n === 1 ? 'Across 1 transaction.' : `Across ${n} transactions.`,
    url: '/wallet',
  }
}

/**
 * Everything worth telling this user right now, most urgent first.
 *
 * `slot` selects the set: the morning digest is about what needs attention, the
 * evening one is a single summary of the day. Passing no slot returns
 * everything, which is what the service worker asks for when a push arrives.
 */
export async function notificationsFor(
  db: D1Database,
  userId: string,
  slot?: Slot,
): Promise<Notification[]> {
  const morning = [captureSilence, openClaims, capturesWaiting, budgetThreshold, tasksDue]
  const evening = [todaySpend]
  const checks = slot === 'morning' ? morning : slot === 'evening' ? evening : [...morning, ...evening]

  const settled = await Promise.all(checks.map((fn) => fn(db, userId).catch(() => null)))
  return settled.filter((n): n is Notification => n !== null)
}
