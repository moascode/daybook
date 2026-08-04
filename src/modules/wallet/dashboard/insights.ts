/**
 * Pure aggregation for the wallet dashboard.
 *
 * Everything here is a plain function over transaction rows — no React, no
 * fetching — so the arithmetic behind every panel can be reasoned about (and
 * tested) on its own.
 *
 * Two rules hold throughout:
 *
 * 1. Money always goes through `countableAmount`, never `t.amount`. The raw
 *    ledger figure double-counts a split expense: the payer carries the full
 *    amount on the row, but only their own share is spending once the split
 *    settles. The summary tiles have always used the effective figure; the
 *    charts used to disagree with them, which is the bug this module closes.
 *
 * 2. Dates are treated as the 'YYYY-MM-DD' STRINGS they are stored as. Month
 *    and day are read by slicing, never by constructing a Date and reading UTC
 *    parts — that is the §1.1 timezone bug, and it shifts a row into the wrong
 *    month for the eight hours a day when UTC and Malaysian dates differ. The
 *    one place a Date is unavoidable is the weekday lookup, where `parseISO`
 *    of a date-only string yields LOCAL midnight and `getDay()` is stable.
 */
import { parseISO } from 'date-fns'
import { countableAmount } from '@/hooks/useWallet'
import type { Category, RecurringTransaction, Transaction } from '@/types/wallet.types'

/** How many prior months form the "usual" baseline. */
export const BASELINE_MONTHS = 3

/** How far back the merchant sparklines and the regular-merchant test look. */
export const TREND_MONTHS = 6

/** A merchant seen in at least this many of the trailing months is "regular". */
const REGULAR_THRESHOLD = 3

// ── Date helpers (string arithmetic only) ─────────────────────────

/** 'YYYY-MM' of an ISO date string. */
export function monthKey(isoDate: string): string {
  return isoDate.slice(0, 7)
}

/** Day of month (1–31) of an ISO date string. */
export function dayOfMonth(isoDate: string): number {
  return Number(isoDate.slice(8, 10))
}

/**
 * Shift a 'YYYY-MM' key by whole months. Built on local Date arithmetic with
 * day 1, which normalises overflow (2026-12 + 1 → 2027-01) without ever
 * touching a timezone-sensitive conversion.
 */
export function shiftMonth(month: string, offset: number): string {
  const d = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1 + offset, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/** Number of days in a 'YYYY-MM'. Day 0 of the next month is the last of this. */
export function daysInMonth(month: string): number {
  return new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate()
}

/** The `count` months immediately BEFORE `month`, oldest first. */
export function priorMonths(month: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => shiftMonth(month, i - count))
}

/** First and last ISO dates of a 'YYYY-MM'. */
export function monthBounds(month: string): { from: string; to: string } {
  return { from: `${month}-01`, to: `${month}-${String(daysInMonth(month)).padStart(2, '0')}` }
}

// ── Money helpers ─────────────────────────────────────────────────

/** Spend contributed by one row: 0 unless it is a countable expense. */
export function expenseOf(t: Transaction): number {
  return t.type === 'expense' ? countableAmount(t) : 0
}

export interface PeriodSummary {
  income: number
  expense: number
  net: number
}

export function summarise(txns: Transaction[]): PeriodSummary {
  let income = 0
  let expense = 0
  for (const t of txns) {
    if (t.type === 'income') income += countableAmount(t)
    else if (t.type === 'expense') expense += countableAmount(t)
  }
  return { income, expense, net: income - expense }
}

/** Total spend in `month` on days 1..`day` inclusive. */
export function spendThroughDay(txns: Transaction[], month: string, day: number): number {
  let total = 0
  for (const t of txns) {
    if (monthKey(t.date) !== month) continue
    if (dayOfMonth(t.date) > day) continue
    total += expenseOf(t)
  }
  return total
}

/**
 * Average spend across `months` by the same day of the month. This — not "vs
 * all of last month" — is the honest mid-month comparison: measuring 18 days
 * against 31 always reports an improvement that isn't there.
 */
export function usualThroughDay(txns: Transaction[], months: string[], day: number): number {
  if (months.length === 0) return 0
  const total = months.reduce((sum, m) => sum + spendThroughDay(txns, m, day), 0)
  return total / months.length
}

/** Average of the full-month totals across `months`. */
export function usualMonthTotal(txns: Transaction[], months: string[]): number {
  if (months.length === 0) return 0
  const total = months.reduce((sum, m) => sum + spendThroughDay(txns, m, daysInMonth(m)), 0)
  return total / months.length
}

/**
 * Running total for each day 1..`length` of `month`. Days with no activity
 * repeat the previous total, so the series is monotonic and plots as a line
 * rather than dropping to zero on quiet days.
 */
export function cumulativeByDay(txns: Transaction[], month: string, length: number): number[] {
  const daily = new Array<number>(length).fill(0)
  for (const t of txns) {
    if (monthKey(t.date) !== month) continue
    const d = dayOfMonth(t.date)
    if (d < 1 || d > length) continue
    daily[d - 1] += expenseOf(t)
  }
  const out = new Array<number>(length)
  let running = 0
  for (let i = 0; i < length; i++) {
    running += daily[i]
    out[i] = running
  }
  return out
}

/**
 * The averaged "usual" curve over `length` days. A prior month shorter than
 * `length` holds at its own final total for the extra days rather than being
 * dropped — a 30-day month still has a legitimate month-end figure to average.
 */
export function baselineCurve(txns: Transaction[], months: string[], length: number): number[] {
  if (months.length === 0) return new Array<number>(length).fill(0)
  const curves = months.map((m) => {
    const own = cumulativeByDay(txns, m, daysInMonth(m))
    const last = own.length > 0 ? own[own.length - 1] : 0
    return Array.from({ length }, (_, i) => (i < own.length ? own[i] : last))
  })
  return Array.from({ length }, (_, i) =>
    curves.reduce((sum, c) => sum + c[i], 0) / curves.length,
  )
}

/**
 * Where the month lands if the rest of it looks like the part already spent.
 * A flat linear extrapolation, deliberately: anything cleverer would imply a
 * confidence the data does not support at day 3.
 */
export function projectMonthEnd(spentToDate: number, day: number, length: number): number {
  if (day <= 0) return 0
  return spentToDate + (spentToDate / day) * (length - day)
}

// ── Categories ────────────────────────────────────────────────────

/** The id used for spending that has not been filed under any category. */
export const UNCATEGORISED = '__uncategorised__'

export interface CategorySpend {
  id: string
  name: string
  /** null for the uncategorised row, which has no user-chosen colour. */
  color: string | null
  amount: number
}

/**
 * Spend per category, biggest first, INCLUDING an uncategorised row.
 *
 * The old pie skipped rows with no category, so it silently failed to sum to
 * the expense total and hid the one bucket worth acting on. Unfiled spending
 * is a real category here.
 */
export function categorySpend(
  txns: Transaction[],
  categories: Category[],
): CategorySpend[] {
  const totals = new Map<string, number>()
  for (const t of txns) {
    const amount = expenseOf(t)
    if (amount === 0) continue
    const key = t.categoryId ?? UNCATEGORISED
    totals.set(key, (totals.get(key) ?? 0) + amount)
  }

  const byId = new Map(categories.map((c) => [c.id, c]))
  return Array.from(totals.entries())
    .map(([id, amount]) => {
      if (id === UNCATEGORISED) {
        return { id, name: 'Uncategorised', color: null, amount }
      }
      const cat = byId.get(id)
      return { id, name: cat?.name ?? 'Deleted category', color: cat?.color ?? null, amount }
    })
    .sort((a, b) => b.amount - a.amount)
}

export interface CategoryDelta extends CategorySpend {
  /** Same category's average over the baseline months, to the same day. */
  usual: number
  delta: number
}

/**
 * Every category's spend against its own baseline, largest overspend first.
 *
 * Categories that were active in the baseline but not this month are included
 * with a negative delta — "you stopped spending on this" is exactly as much a
 * change as "you started".
 */
export function categoryDeltas(
  txns: Transaction[],
  categories: Category[],
  month: string,
  day: number,
  baselineMonths: string[],
): CategoryDelta[] {
  const current = categorySpend(
    txns.filter((t) => monthKey(t.date) === month && dayOfMonth(t.date) <= day),
    categories,
  )

  const usualByCategory = new Map<string, number>()
  if (baselineMonths.length > 0) {
    for (const m of baselineMonths) {
      const rows = categorySpend(
        txns.filter((t) => monthKey(t.date) === m && dayOfMonth(t.date) <= day),
        categories,
      )
      for (const r of rows) {
        usualByCategory.set(r.id, (usualByCategory.get(r.id) ?? 0) + r.amount)
      }
    }
    for (const [id, total] of usualByCategory) {
      usualByCategory.set(id, total / baselineMonths.length)
    }
  }

  const byId = new Map(categories.map((c) => [c.id, c]))
  const seen = new Map<string, CategoryDelta>()
  for (const r of current) {
    const usual = usualByCategory.get(r.id) ?? 0
    seen.set(r.id, { ...r, usual, delta: r.amount - usual })
  }
  for (const [id, usual] of usualByCategory) {
    if (seen.has(id)) continue
    const cat = byId.get(id)
    seen.set(id, {
      id,
      name: id === UNCATEGORISED ? 'Uncategorised' : cat?.name ?? 'Deleted category',
      color: id === UNCATEGORISED ? null : cat?.color ?? null,
      amount: 0,
      usual,
      delta: -usual,
    })
  }

  return Array.from(seen.values()).sort((a, b) => b.delta - a.delta)
}

// ── Weekday rhythm ────────────────────────────────────────────────

export const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/**
 * Average spend per weekday across `months`, Monday first.
 *
 * Divided by how many times each weekday actually OCCURRED in the window, not
 * by the month count — five Saturdays and four Sundays in the same month would
 * otherwise make Saturday look 25% bigger than it is.
 */
export function weekdayAverages(txns: Transaction[], months: string[]): number[] {
  const totals = new Array<number>(7).fill(0)
  const occurrences = new Array<number>(7).fill(0)
  const wanted = new Set(months)

  for (const month of months) {
    const days = daysInMonth(month)
    for (let d = 1; d <= days; d++) {
      const iso = `${month}-${String(d).padStart(2, '0')}`
      occurrences[mondayFirstIndex(iso)] += 1
    }
  }
  for (const t of txns) {
    const amount = expenseOf(t)
    if (amount === 0 || !wanted.has(monthKey(t.date))) continue
    totals[mondayFirstIndex(t.date)] += amount
  }

  return totals.map((total, i) => (occurrences[i] > 0 ? total / occurrences[i] : 0))
}

/** getDay() is Sunday-first; the strip reads Monday-first. */
function mondayFirstIndex(isoDate: string): number {
  return (parseISO(isoDate).getDay() + 6) % 7
}

// ── Merchants ─────────────────────────────────────────────────────

export interface MerchantSpend {
  merchant: string
  total: number
  count: number
  average: number
  /** Spend per trailing month, oldest first — the sparkline series. */
  trend: number[]
  /** No spend at this merchant in any earlier month in the window. */
  isNew: boolean
  /** Present in at least REGULAR_THRESHOLD of the trailing months. */
  isRegular: boolean
}

export function merchantSpend(
  txns: Transaction[],
  month: string,
  trendMonths: string[],
): MerchantSpend[] {
  const current = new Map<string, { total: number; count: number; label: string }>()
  for (const t of txns) {
    if (monthKey(t.date) !== month) continue
    const amount = expenseOf(t)
    if (amount === 0 || !t.merchant) continue
    const key = t.merchant.trim().toLowerCase()
    if (!key) continue
    const row = current.get(key) ?? { total: 0, count: 0, label: t.merchant.trim() }
    current.set(key, { total: row.total + amount, count: row.count + 1, label: row.label })
  }

  const history = monthlyTotalsByMerchant(txns, trendMonths)

  return Array.from(current.entries())
    .map(([key, row]) => {
      const trend = trendMonths.map((m) => history.get(key)?.get(m) ?? 0)
      const earlier = trend.slice(0, -1)
      const active = trend.filter((v) => v > 0).length
      return {
        merchant: row.label,
        total: row.total,
        count: row.count,
        average: row.total / row.count,
        trend,
        isNew: earlier.every((v) => v === 0),
        isRegular: active >= REGULAR_THRESHOLD,
      }
    })
    .sort((a, b) => b.total - a.total)
}

function monthlyTotalsByMerchant(
  txns: Transaction[],
  months: string[],
): Map<string, Map<string, number>> {
  const wanted = new Set(months)
  const out = new Map<string, Map<string, number>>()
  for (const t of txns) {
    const amount = expenseOf(t)
    if (amount === 0 || !t.merchant) continue
    const m = monthKey(t.date)
    if (!wanted.has(m)) continue
    const key = t.merchant.trim().toLowerCase()
    if (!key) continue
    const perMonth = out.get(key) ?? new Map<string, number>()
    perMonth.set(m, (perMonth.get(m) ?? 0) + amount)
    out.set(key, perMonth)
  }
  return out
}

// ── Committed vs discretionary ────────────────────────────────────

export interface CommittedSplit {
  committed: number
  discretionary: number
  /** The committed merchants this month, largest first. */
  items: { merchant: string; amount: number; fromRule: boolean }[]
}

/**
 * Split the month into spending that was decided once and spending decided in
 * the moment. A merchant counts as committed when it either matches an
 * existing recurring rule, or turned up in at least three of the trailing
 * months — the second test catches the standing costs that were never entered
 * as a rule, which in practice is most of them.
 *
 * No classifier and no new table: this is the `recurring_transactions` the app
 * already has, plus a count.
 */
export function committedSplit(
  txns: Transaction[],
  month: string,
  rules: RecurringTransaction[],
  trendMonths: string[],
  /**
   * Rows used ONLY to decide what recurs. Separate from `txns` because the
   * split is scoped to one month while the recurrence test has to see the
   * trailing months around it — handing it the period's own rows would mean
   * every merchant appears in exactly one month and nothing is ever committed.
   */
  historyTxns: Transaction[] = txns,
): CommittedSplit {
  const ruleMerchants = new Set(
    rules.map((r) => r.merchant.trim().toLowerCase()).filter(Boolean),
  )
  const history = monthlyTotalsByMerchant(historyTxns, trendMonths)

  const items: CommittedSplit['items'] = []
  let committed = 0
  let discretionary = 0

  const thisMonth = new Map<string, { total: number; label: string }>()
  for (const t of txns) {
    if (monthKey(t.date) !== month) continue
    const amount = expenseOf(t)
    if (amount === 0) continue
    const key = t.merchant.trim().toLowerCase()
    if (!key) {
      discretionary += amount
      continue
    }
    const row = thisMonth.get(key) ?? { total: 0, label: t.merchant.trim() }
    thisMonth.set(key, { total: row.total + amount, label: row.label })
  }

  for (const [key, row] of thisMonth) {
    const fromRule = ruleMerchants.has(key)
    const months = history.get(key)
    const recurring = fromRule || (months ? countActive(months, trendMonths) >= REGULAR_THRESHOLD : false)
    if (recurring) {
      committed += row.total
      items.push({ merchant: row.label, amount: row.total, fromRule })
    } else {
      discretionary += row.total
    }
  }

  items.sort((a, b) => b.amount - a.amount)
  return { committed, discretionary, items }
}

function countActive(perMonth: Map<string, number>, months: string[]): number {
  return months.reduce((n, m) => n + ((perMonth.get(m) ?? 0) > 0 ? 1 : 0), 0)
}
