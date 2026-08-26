/**
 * Pure aggregation for the Day landing page (R6,
 * docs/v2/day/02-design-adoption.md). No React, no fetching — same shape as
 * `src/modules/trips/insights.ts` and `src/modules/wallet/dashboard/insights.ts`.
 *
 * The merge's solid/hollow grammar needs no wall-clock math (D-6,
 * docs/v2/open-decisions.md): "happened" is exactly {completed tasks,
 * transactions} and "planned" is exactly {open tasks due today} — the
 * grouping itself is the grammar. Sorting inside each group uses whatever
 * real timestamp each row has (`completedAt`, `dueTime`, `createdAt`); no row
 * needs a true time-of-day column for the ordering to be correct.
 */
import { countableAmount } from '@/hooks/useWallet'
import type { Account, Transaction } from '@/types/wallet.types'
import type { Task } from '@/types/tasks.types'

/** `iso` shifted by `days` (negative goes back), local date parts — never
 *  toISOString() (CLAUDE.md §16 trap 1). */
export function shiftDateISO(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(y, m - 1, d + days)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}

/**
 * A real, comparable epoch for a `'YYYY-MM-DD HH:MM:SS'` timestamp — needed
 * because the two timestamps the timeline merges are stamped in DIFFERENT
 * clocks and would otherwise sort ~8 hours apart from where they really
 * happened: `tasks.completed_at` is business-timezone wall-clock
 * (`worker/routes/tasks.ts`'s `nowStr()`, Asia/Kuala_Lumpur), while
 * `transactions.created_at` is `datetime('now')`, i.e. UTC
 * (`worker/routes/wallet.ts`). Both are naive strings with no offset, so a
 * plain lexical comparison silently mis-orders them. Kuala Lumpur has no DST
 * (a fixed UTC+8), so the offset is a constant.
 */
function businessEpoch(ts: string): number {
  return new Date(`${ts.replace(' ', 'T')}+08:00`).getTime()
}
function utcEpoch(ts: string): number {
  return new Date(`${ts.replace(' ', 'T')}Z`).getTime()
}
/** Zero-padded so same-length epoch strings still sort lexically within a
 *  group — the two groups are sorted independently, so cross-group
 *  comparability with `dueTime`'s 'HH:MM' key space is never needed. */
function epochSortKey(epochMs: number): string {
  return String(epochMs).padStart(15, '0')
}

export interface DayBand {
  doneCount: number
  totalCount: number
  net: number
  income: number
}

/**
 * The band's two figures. `date` is the selected day (not necessarily
 * today — the date stepper can move it).
 *
 * "Still to happen" (design-adoption doc's money subtext) is deliberately
 * NOT computed from `recurring_transactions.nextDueDate` here — a rule due
 * on `date` gets auto-posted into a real transaction by the existing
 * `/recurring-transactions/process` sweep essentially as soon as the app is
 * open (discovered while implementing this page), so "due but not yet
 * posted" is not an observable state on the day it's true. Rather than ship
 * a figure that reads 0 the instant a user could see it, the money subtext
 * is "money in" only — same standard R6-trips already set: omit what
 * existing data can't back honestly, don't approximate it.
 */
export function dayBand(
  date: string,
  tasks: Task[],
  transactions: Transaction[],
  accounts: Account[],
): DayBand {
  const dueToday = tasks.filter((t) => t.dueDate === date && !t.isCompleted)
  const completedToday = tasks.filter((t) => t.completedAt?.slice(0, 10) === date)

  const ownAccountIds = new Set(accounts.filter((a) => !a.isShared).map((a) => a.id))
  const todaysTxns = transactions.filter((t) => t.date === date && ownAccountIds.has(t.accountId))
  let income = 0
  let net = 0
  for (const t of todaysTxns) {
    const amount = countableAmount(t)
    if (t.type === 'income') {
      income += amount
      net += amount
    } else if (t.type === 'expense') {
      net -= amount
    }
  }

  return {
    doneCount: completedToday.length,
    totalCount: dueToday.length + completedToday.length,
    net,
    income,
  }
}

export type TimelineStatus = 'done' | 'ahead'

export interface TimelineItem {
  id: string
  kind: 'task' | 'money'
  title: string
  sub?: string
  /** Display time, e.g. "09:30" — null when no time should render (every
   *  money row, per D-6: no clock time on money rows). */
  time: string | null
  /** Sort key within the item's own group — a real timestamp, never a
   *  fabricated one. */
  sortKey: string
  status: TimelineStatus
  amount?: { value: number; sign: 'pos' | 'neg' }
}

export interface DayTimeline {
  /** Solid rows: completed tasks + transactions, chronological. */
  happened: TimelineItem[]
  /** Hollow rows: open tasks due on this date, chronological by due time. */
  planned: TimelineItem[]
}

function formatHM(time: string | null): string | null {
  if (!time) return null
  return time.length >= 5 ? time.slice(0, 5) : time
}

/** Merge completed tasks, open tasks due today, and today's transactions
 *  onto one spine for `date`. */
export function dayTimeline(
  date: string,
  tasks: Task[],
  transactions: Transaction[],
  accounts: Account[],
): DayTimeline {
  const ownAccountIds = new Set(accounts.filter((a) => !a.isShared).map((a) => a.id))

  const happened: TimelineItem[] = []
  const planned: TimelineItem[] = []

  for (const t of tasks) {
    if (t.completedAt?.slice(0, 10) === date) {
      happened.push({
        id: `task-${t.id}`,
        kind: 'task',
        title: t.content,
        time: formatHM(t.completedAt.slice(11, 16)),
        sortKey: epochSortKey(businessEpoch(t.completedAt)),
        status: 'done',
      })
    } else if (t.dueDate === date && !t.isCompleted) {
      planned.push({
        id: `task-${t.id}`,
        kind: 'task',
        title: t.content,
        time: formatHM(t.dueTime),
        // Undated (no due-time) tasks sort after timed ones within the day.
        sortKey: t.dueTime ?? '99:99',
        status: 'ahead',
      })
    }
  }

  for (const t of transactions) {
    if (t.date !== date || !ownAccountIds.has(t.accountId)) continue
    // Transfers are excluded from the merge, not just from net (dayBand
    // already excludes them there) — a transfer row would show only one leg
    // with an unsigned amount that can't reconcile against the net figure
    // directly above it (CLAUDE.md §9.2: never let a visible money figure
    // disagree with the total next to it).
    if (t.type !== 'income' && t.type !== 'expense') continue
    const amount = countableAmount(t)
    happened.push({
      id: `txn-${t.id}`,
      kind: 'money',
      title: t.merchant || t.description || 'Transaction',
      sub: t.description && t.merchant ? t.description : undefined,
      time: null,
      sortKey: epochSortKey(utcEpoch(t.createdAt)),
      status: 'done',
      amount: { value: amount, sign: t.type === 'income' ? 'pos' : 'neg' },
    })
  }

  happened.sort((a, b) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0))
  planned.sort((a, b) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0))

  return { happened, planned }
}
