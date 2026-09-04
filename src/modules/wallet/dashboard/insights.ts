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
import { differenceInDays, parseISO } from 'date-fns'
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

/** The `count` trailing months ENDING at (and including) `monthKey(dateTo)`. */
export function trailingMonthsEndingAt(dateTo: string, count: number): string[] {
  const end = monthKey(dateTo)
  return [...priorMonths(end, count - 1), end]
}

/** First and last ISO dates of a 'YYYY-MM'. */
export function monthBounds(month: string): { from: string; to: string } {
  return { from: `${month}-01`, to: `${month}-${String(daysInMonth(month)).padStart(2, '0')}` }
}

// ── Arbitrary date ranges (multi-month / custom periods) ───────────
//
// The month-based functions above assume a single calendar month with a
// same-day-of-month baseline, which is a deliberately different (and more
// precise) comparison than "the N days before." These range functions back
// the "Last 3 months" / "Last 12 months" / "All time" / "Custom" presets,
// where the period itself spans many months and the fair comparison is
// simply the immediately preceding window of equal length.

/** Day count of an ISO date, local-midnight based (no DST drift at this app's fixed-offset timezone). */
function dayIndex(isoDate: string): number {
  const d = new Date(Number(isoDate.slice(0, 4)), Number(isoDate.slice(5, 7)) - 1, Number(isoDate.slice(8, 10)))
  return Math.round(d.getTime() / 86_400_000)
}

/** `iso` shifted by `n` days (negative goes back). Date's own overflow handling does the month/year rollover. */
export function addDaysISO(isoDate: string, n: number): string {
  const d = new Date(
    Number(isoDate.slice(0, 4)),
    Number(isoDate.slice(5, 7)) - 1,
    Number(isoDate.slice(8, 10)) + n,
  )
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Inclusive day count between two ISO dates. */
export function daysBetween(dateFrom: string, dateTo: string): number {
  return dayIndex(dateTo) - dayIndex(dateFrom) + 1
}

/**
 * How many days a period must span before "per month" is a meaningful rate
 * rather than a shaky extrapolation. 60 is the exact floor of "Last 3
 * months" (the shortest a trailing 3-month window can be, when today is the
 * 1st of the month and the two preceding months are Jan+Feb) — so the
 * presets this feature targets always qualify, while a short custom range or
 * a brand-new "All time" account correctly does not.
 */
export const MIN_AVERAGE_DAYS = 60

/**
 * Continuous month count for a date range — days spanned ÷ 30, NOT the
 * number of distinct calendar months touched. A trailing "Last N months"
 * window changes length by a day at a time as today advances, then drops by
 * roughly a full month in one step when it rolls past a month boundary (the
 * oldest month falls out of the window). Dividing by the exact day count
 * tracks that same shape, so a steady spend rate reports a steady average;
 * dividing by "months touched" is a step function that lags the total's own
 * steps and produces a visible jump on the day the window rolls over.
 */
export function monthsSpanned(dateFrom: string, dateTo: string): number {
  return daysBetween(dateFrom, dateTo) / 30
}

/** Whether `isoDate` falls within [dateFrom, dateTo] inclusive. 'YYYY-MM-DD' sorts lexicographically, so plain string comparison is exact. */
export function inRange(isoDate: string, dateFrom: string, dateTo: string): boolean {
  return isoDate >= dateFrom && isoDate <= dateTo
}

/**
 * The comparison window: the same number of days, immediately before
 * `dateFrom`. This is the "range mode" equivalent of `priorMonths` — the one
 * fair baseline when the period itself isn't a calendar month.
 */
export function precedingRange(dateFrom: string, dateTo: string): { dateFrom: string; dateTo: string } {
  const days = daysBetween(dateFrom, dateTo)
  const to = addDaysISO(dateFrom, -1)
  const from = addDaysISO(to, -(days - 1))
  return { dateFrom: from, dateTo: to }
}

/**
 * Running total for each day of [dateFrom, dateTo], index 0 = dateFrom. The
 * range-mode equivalent of `cumulativeByDay` — same monotonic-fill behaviour,
 * generalised from "day of a named month" to "day offset in an arbitrary span."
 */
export function cumulativeByDayOffset(txns: Transaction[], dateFrom: string, dateTo: string): number[] {
  const length = daysBetween(dateFrom, dateTo)
  const daily = new Array<number>(length).fill(0)
  for (const t of txns) {
    if (!inRange(t.date, dateFrom, dateTo)) continue
    const offset = daysBetween(dateFrom, t.date) - 1
    daily[offset] += expenseOf(t)
  }
  const out = new Array<number>(length)
  let running = 0
  for (let i = 0; i < length; i++) {
    running += daily[i]
    out[i] = running
  }
  return out
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
 * Days that must have elapsed before a month-end projection is shown at all.
 *
 * The projection is a flat linear run-rate, and early in the month that is
 * dominated by whichever day happened to contain a big purchase: RM 2,940 over
 * four days extrapolates to RM 22,785, which is not a forecast, it is one
 * grocery run multiplied by eight. Below this threshold the dashboard shows the
 * comparison and says nothing about the total — an honest silence beats a
 * confident wrong number, and it also stops the projection's y-range from
 * flattening the actual spend line into the axis.
 */
export const MIN_PROJECTION_DAYS = 7

/**
 * Where the month lands if the rest of it looks like the part already spent.
 * Deliberately a flat extrapolation — anything cleverer would imply a
 * confidence the data does not support. Guard with MIN_PROJECTION_DAYS.
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

/** How many category slices the donut draws individually before folding the rest into "Everything else". */
const MAX_DONUT_SLICES = 6

/** Id of the synthetic "everything past the top N" slice — exported so the component doesn't redefine it. */
export const EVERYTHING_ELSE_ID = '__everything_else__'

export interface DonutSlice {
  id: string
  name: string
  /** null for the uncategorised row and for the synthetic "Everything else" slice. */
  color: string | null
  amount: number
  /** 0–100. */
  share: number
}

/**
 * `categorySpend` rows folded into a donut-sized set: the top slices kept
 * individually, everything past `MAX_DONUT_SLICES` merged into a trailing
 * "Everything else" slice so the chart never draws a sliver too thin to
 * label. `rows` is already biggest-first, so "top N" and "largest-first with
 * Everything else last" fall out of a plain slice.
 */
export function categoryDonutSlices(rows: CategorySpend[], total: number): DonutSlice[] {
  if (total <= 0) return []
  const top = rows.slice(0, MAX_DONUT_SLICES)
  const rest = rows.slice(MAX_DONUT_SLICES)
  const slices: DonutSlice[] = top
    .filter((r) => r.amount > 0)
    .map((r) => ({ id: r.id, name: r.name, color: r.color, amount: r.amount, share: (r.amount / total) * 100 }))

  const restAmount = rest.reduce((sum, r) => sum + r.amount, 0)
  if (restAmount > 0) {
    slices.push({
      id: EVERYTHING_ELSE_ID,
      name: 'Everything else',
      color: null,
      amount: restAmount,
      share: (restAmount / total) * 100,
    })
  }
  return slices
}

export interface CategoryDelta extends CategorySpend {
  /** Same category's average over the baseline months, to the same day. */
  usual: number
  delta: number
}

/**
 * Shared arithmetic behind every "category vs its own baseline" view. Takes
 * pre-filtered transaction buckets so it has no opinion on WHAT the period or
 * the comparison window are — `categoryDeltas` (month mode) and
 * `categoryDeltasBetween` (range mode) each build the buckets their own way
 * and delegate here, so the two can never disagree on the merge/sort logic.
 *
 * `comparisonBuckets` is averaged: one bucket per baseline month (month mode)
 * or a single bucket holding the whole comparison range (range mode) — either
 * way, dividing by `comparisonBuckets.length` produces the right average.
 */
function categoryDeltasCore(
  currentTxns: Transaction[],
  comparisonBuckets: Transaction[][],
  categories: Category[],
): CategoryDelta[] {
  const current = categorySpend(currentTxns, categories)

  const usualByCategory = new Map<string, number>()
  if (comparisonBuckets.length > 0) {
    for (const bucket of comparisonBuckets) {
      for (const r of categorySpend(bucket, categories)) {
        usualByCategory.set(r.id, (usualByCategory.get(r.id) ?? 0) + r.amount)
      }
    }
    for (const [id, total] of usualByCategory) {
      usualByCategory.set(id, total / comparisonBuckets.length)
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
  const currentTxns = txns.filter((t) => monthKey(t.date) === month && dayOfMonth(t.date) <= day)
  const comparisonBuckets = baselineMonths.map((m) =>
    txns.filter((t) => monthKey(t.date) === m && dayOfMonth(t.date) <= day),
  )
  return categoryDeltasCore(currentTxns, comparisonBuckets, categories)
}

/**
 * The range-mode equivalent of `categoryDeltas`: the period against a single
 * arbitrary comparison window instead of an averaged set of baseline months.
 * `comparisonTxns: null` means no comparison window exists at all (the
 * all-time preset with nothing before it) — distinct from an empty array,
 * which means the window exists but had no spending in it.
 */
export function categoryDeltasBetween(
  periodTxns: Transaction[],
  comparisonTxns: Transaction[] | null,
  categories: Category[],
): CategoryDelta[] {
  return categoryDeltasCore(periodTxns, comparisonTxns === null ? [] : [comparisonTxns], categories)
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

/**
 * Range-mode equivalent of `weekdayAverages`: occurrence counts come from
 * iterating the day span directly instead of a list of whole months. Kept as
 * a near-duplicate rather than unified behind one abstraction — "a list of
 * whole calendar months" and "an arbitrary day range" don't share enough
 * shape to be worth threading through a common iterator.
 */
export function weekdayAveragesInRange(txns: Transaction[], dateFrom: string, dateTo: string): number[] {
  const totals = new Array<number>(7).fill(0)
  const occurrences = new Array<number>(7).fill(0)
  const length = daysBetween(dateFrom, dateTo)

  for (let i = 0; i < length; i++) {
    occurrences[mondayFirstIndex(addDaysISO(dateFrom, i))] += 1
  }
  for (const t of txns) {
    const amount = expenseOf(t)
    if (amount === 0 || !inRange(t.date, dateFrom, dateTo)) continue
    totals[mondayFirstIndex(t.date)] += amount
  }

  return totals.map((total, i) => (occurrences[i] > 0 ? total / occurrences[i] : 0))
}

export interface DailySpend {
  date: string
  label: string
  amount: number
}

/**
 * Literal per-day spend for the last `n` calendar days ending at `dateTo`
 * (inclusive), oldest first. Unlike `weekdayAverages` (a multi-month average
 * per weekday), this is the actual total for each of the real last `n` days —
 * the "Week rhythm" card's mockup shows a specific week's numbers, not an
 * average.
 */
export function lastNDaysSpend(txns: Transaction[], dateTo: string, n: number): DailySpend[] {
  const byDate = new Map<string, number>()
  for (const t of txns) {
    const amount = expenseOf(t)
    if (amount === 0) continue
    byDate.set(t.date, (byDate.get(t.date) ?? 0) + amount)
  }
  return Array.from({ length: n }, (_, i) => {
    const date = addDaysISO(dateTo, i - (n - 1))
    return { date, label: WEEKDAY_LABELS[mondayFirstIndex(date)], amount: byDate.get(date) ?? 0 }
  })
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

/** Shared arithmetic behind `merchantSpend` and `merchantSpendInRange`. */
function merchantSpendCore(
  periodTxns: Transaction[],
  history: Map<string, Map<string, number>>,
  trendMonths: string[],
): MerchantSpend[] {
  const current = new Map<string, { total: number; count: number; label: string }>()
  for (const t of periodTxns) {
    const amount = expenseOf(t)
    if (amount === 0 || !t.merchant) continue
    const key = t.merchant.trim().toLowerCase()
    if (!key) continue
    const row = current.get(key) ?? { total: 0, count: 0, label: t.merchant.trim() }
    current.set(key, { total: row.total + amount, count: row.count + 1, label: row.label })
  }

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

export function merchantSpend(
  txns: Transaction[],
  month: string,
  trendMonths: string[],
): MerchantSpend[] {
  const periodTxns = txns.filter((t) => monthKey(t.date) === month)
  const history = monthlyTotalsByMerchant(txns, trendMonths)
  return merchantSpendCore(periodTxns, history, trendMonths)
}

/** Range-mode equivalent of `merchantSpend`. `trendMonths` still buckets the sparkline by calendar month regardless of the period's own granularity — a monthly trend reads the same whether the period itself is one month or twelve. */
export function merchantSpendInRange(
  txns: Transaction[],
  dateFrom: string,
  dateTo: string,
  trendMonths: string[],
): MerchantSpend[] {
  const periodTxns = txns.filter((t) => inRange(t.date, dateFrom, dateTo))
  const history = monthlyTotalsByMerchant(txns, trendMonths)
  return merchantSpendCore(periodTxns, history, trendMonths)
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
  /** The committed merchants this period, largest first. */
  items: { merchant: string; amount: number; fromRule: boolean; date: string }[]
}

/**
 * Shared arithmetic behind `committedSplit` and `committedSplitInRange`. Takes
 * the period's rows pre-filtered so it has no opinion on whether "the period"
 * is a calendar month or an arbitrary range.
 *
 * A merchant counts as committed when it either matches an existing recurring
 * rule, or turned up in at least `REGULAR_THRESHOLD` of `historyBuckets` — the
 * second test catches the standing costs that were never entered as a rule,
 * which in practice is most of them. `date` on each item is the most recent
 * transaction date for that merchant within the period, for "Paid <date>".
 */
function committedSplitCore(
  periodTxns: Transaction[],
  rules: RecurringTransaction[],
  history: Map<string, Map<string, number>>,
  historyBuckets: string[],
): CommittedSplit {
  const ruleMerchants = new Set(
    rules.map((r) => r.merchant.trim().toLowerCase()).filter(Boolean),
  )

  const items: CommittedSplit['items'] = []
  let committed = 0
  let discretionary = 0

  const thisPeriod = new Map<string, { total: number; label: string; lastDate: string }>()
  for (const t of periodTxns) {
    const amount = expenseOf(t)
    if (amount === 0) continue
    const key = t.merchant.trim().toLowerCase()
    if (!key) {
      discretionary += amount
      continue
    }
    const row = thisPeriod.get(key) ?? { total: 0, label: t.merchant.trim(), lastDate: t.date }
    thisPeriod.set(key, {
      total: row.total + amount,
      label: row.label,
      lastDate: t.date > row.lastDate ? t.date : row.lastDate,
    })
  }

  for (const [key, row] of thisPeriod) {
    const fromRule = ruleMerchants.has(key)
    const months = history.get(key)
    const recurring = fromRule || (months ? countActive(months, historyBuckets) >= REGULAR_THRESHOLD : false)
    if (recurring) {
      committed += row.total
      items.push({ merchant: row.label, amount: row.total, fromRule, date: row.lastDate })
    } else {
      discretionary += row.total
    }
  }

  items.sort((a, b) => b.amount - a.amount)
  return { committed, discretionary, items }
}

/**
 * Split the month into spending that was decided once and spending decided in
 * the moment. No classifier and no new table: this is the
 * `recurring_transactions` the app already has, plus a count.
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
  const periodTxns = txns.filter((t) => monthKey(t.date) === month)
  const history = monthlyTotalsByMerchant(historyTxns, trendMonths)
  return committedSplitCore(periodTxns, rules, history, trendMonths)
}

/** Range-mode equivalent of `committedSplit`. */
export function committedSplitInRange(
  txns: Transaction[],
  dateFrom: string,
  dateTo: string,
  rules: RecurringTransaction[],
  historyTxns: Transaction[],
  historyMonths: string[],
): CommittedSplit {
  const periodTxns = txns.filter((t) => inRange(t.date, dateFrom, dateTo))
  const history = monthlyTotalsByMerchant(historyTxns, historyMonths)
  return committedSplitCore(periodTxns, rules, history, historyMonths)
}

function countActive(perMonth: Map<string, number>, months: string[]): number {
  return months.reduce((n, m) => n + ((perMonth.get(m) ?? 0) > 0 ? 1 : 0), 0)
}

// ── Featured account ─────────────────────────────────────────────

/** Bills within this many days count as "upcoming" — shared by the Coming-up card and safe-to-spend, so the two never disagree on what's included. */
export const UPCOMING_BILLS_WINDOW_DAYS = 7

export interface SafeToSpend {
  balance: number
  /** Sum of this account's own EXPENSE recurring amounts due within `UPCOMING_BILLS_WINDOW_DAYS` (including overdue). */
  bills: number
  /** `balance - bills`, can go negative if bills exceed the balance. */
  safe: number
}

/**
 * What's actually free to spend on one account: its balance minus its OWN
 * upcoming bills, not every bill in the household. A bill drawn from a
 * different account has no claim on this one.
 *
 * Only `type === 'expense'` rules count. A recurring INCOME rule (payday,
 * a standing credit) due in the window is money arriving, not owed — summing
 * it in would flip the sign and make safe-to-spend go DOWN right before money
 * comes in. `dismissedIds` mirrors the same set the "Coming up" card already
 * excludes, so the two cards can't disagree about what's upcoming.
 */
export function safeToSpend(
  balance: number,
  accountId: string,
  recurring: RecurringTransaction[],
  today: Date,
  dismissedIds: Set<string> = new Set(),
): SafeToSpend {
  let bills = 0
  for (const r of recurring) {
    if (r.accountId !== accountId) continue
    if (r.type !== 'expense') continue
    if (dismissedIds.has(r.id)) continue
    if (differenceInDays(parseISO(r.nextDueDate), today) <= UPCOMING_BILLS_WINDOW_DAYS) {
      bills += r.amount
    }
  }
  return { balance, bills, safe: balance - bills }
}
