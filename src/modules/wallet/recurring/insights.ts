/**
 * Pure aggregation for the Recurring page (FEAT-068).
 *
 * No React, no fetching — every function here is a plain transform over
 * `RecurringTransaction` rows (and, where noted, the viewer's own-account
 * `Transaction` rows) so the arithmetic behind each card can be reasoned
 * about and tested on its own, the same split dashboard/insights.ts and
 * goals/projection.ts already use.
 *
 * Every function below operates on ACTIVE (non-paused) rules only — each one
 * filters `paused` out itself, so a caller can pass the full rule list.
 *
 * Dates are the 'YYYY-MM-DD' strings they are stored as; "today" must come
 * from `todayISO()` (business timezone), never `toISOString()` (CLAUDE.md §3
 * Tests trap). `advanceDate`/`retreatDate` below mirror worker/routes/wallet.ts's
 * `advanceDate` (~line 3029) exactly, including its B-10 end-of-month
 * anchoring — duplicated here deliberately, since the worker's copy isn't
 * reachable from the client bundle.
 */
import { parseISO, subMonths, isBefore, format } from 'date-fns'
import { countableAmount } from '@/hooks/useWallet'
import { monthKey, priorMonths } from '@/modules/wallet/dashboard/insights'
import type { Category, RecurringTransaction, Transaction } from '@/types/wallet.types'

/**
 * A rule's `createdAt` as a local calendar date. The column is SQLite's
 * `datetime('now')` — UTC, 'YYYY-MM-DD HH:MM:SS' — so slicing it would be a
 * day behind `todayISO()` for the hours UTC and local dates differ.
 */
export function createdLocalDate(rule: RecurringTransaction): string {
  const utc = new Date(`${rule.createdAt.replace(' ', 'T')}Z`)
  return Number.isNaN(utc.getTime()) ? rule.createdAt.slice(0, 10) : format(utc, 'yyyy-MM-dd')
}

const pad = (n: number): string => String(n).padStart(2, '0')

function daysInCalMonth(y: number, m: number): number {
  // Day 0 of month `m` (1-based) is the last day of month `m - 1`.
  return new Date(y, m, 0).getDate()
}

/** One period forward, mirroring the worker's `advanceDate` (B-10 end-of-month anchoring). */
export function advanceDate(dateStr: string, frequency: RecurringTransaction['frequency']): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  if (frequency === 'weekly') {
    const dt = new Date(y, m - 1, d)
    dt.setDate(dt.getDate() + 7)
    return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`
  }
  let ny = y
  let nm = m + 1
  if (nm > 12) { nm = 1; ny += 1 }
  const lastDayThis = daysInCalMonth(y, m)
  const lastDayNext = daysInCalMonth(ny, nm)
  const nd = d >= lastDayThis ? lastDayNext : Math.min(d, lastDayNext)
  return `${ny}-${pad(nm)}-${pad(nd)}`
}

/** One period backward — the B-10-aware inverse of `advanceDate`, used to project occurrences before `nextDueDate`. */
export function retreatDate(dateStr: string, frequency: RecurringTransaction['frequency']): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  if (frequency === 'weekly') {
    const dt = new Date(y, m - 1, d)
    dt.setDate(dt.getDate() - 7)
    return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`
  }
  let py = y
  let pm = m - 1
  if (pm < 1) { pm = 12; py -= 1 }
  const lastDayThis = daysInCalMonth(y, m)
  const lastDayPrev = daysInCalMonth(py, pm)
  const nd = d >= lastDayThis ? lastDayPrev : Math.min(d, lastDayPrev)
  return `${py}-${pad(pm)}-${pad(nd)}`
}

/**
 * Every date in `year`-`month` this rule lands on. Forward projection from
 * `nextDueDate` is unconditional. A backward-projected occurrence is kept
 * ONLY when it is <= `today` (already posted) AND >= the rule's `createdAt`
 * date (first 10 chars) — those are the charges that have actually landed;
 * future dates come only from forward projection, so a 30th-of-month rule
 * advanced to Nov 30 never retreats a phantom Oct 31 for a day that hasn't
 * happened yet (B-10 inverse ambiguity). Sorted ascending.
 */
export function occurrencesInMonth(rule: RecurringTransaction, year: number, month: number, today: string): string[] {
  const monthStart = `${year}-${pad(month)}-01`
  const monthEnd = `${year}-${pad(month)}-${pad(daysInCalMonth(year, month))}`
  const dates = new Set<string>()
  let cur = rule.nextDueDate
  let guard = 0
  while (cur <= monthEnd && guard < 60) {
    if (cur >= monthStart) dates.add(cur)
    cur = advanceDate(cur, rule.frequency)
    guard++
  }
  const createdDate = createdLocalDate(rule)
  cur = retreatDate(rule.nextDueDate, rule.frequency)
  guard = 0
  while (cur >= monthStart && guard < 60) {
    if (cur <= monthEnd && cur <= today && cur >= createdDate) dates.add(cur)
    cur = retreatDate(cur, rule.frequency)
    guard++
  }
  return [...dates].sort()
}

const isActive = (r: RecurringTransaction): boolean => !r.paused

/** Normalised merchant key — lower-cased, trimmed, inner whitespace collapsed. Equality on this form only, no fuzzy matching. */
export function normaliseMerchant(merchant: string): string {
  return merchant.trim().toLowerCase().replace(/\s+/g, ' ')
}

/** Monthly rule = amount; weekly = amount × 52 / 12. */
export function monthlyEquivalent(rule: RecurringTransaction): number {
  return rule.frequency === 'monthly' ? rule.amount : (rule.amount * 52) / 12
}

export function annualCost(rule: RecurringTransaction): number {
  return monthlyEquivalent(rule) * 12
}

/** Sum of the monthly equivalents of active expense rules. */
export function lockedIn(rules: RecurringTransaction[]): number {
  return rules.filter((r) => isActive(r) && r.type === 'expense').reduce((sum, r) => sum + monthlyEquivalent(r), 0)
}

/** Monthly equivalent of active income rules — the fallback leg of the income figure. */
export function activeIncomeMonthlyEquivalent(rules: RecurringTransaction[]): number {
  return rules.filter((r) => isActive(r) && r.type === 'income').reduce((sum, r) => sum + monthlyEquivalent(r), 0)
}

/**
 * Average monthly income (own accounts, `countableAmount`) over the last 3
 * COMPLETE calendar months before `today` — i.e. not the current, partial
 * month. `ownTxns` must already be filtered to the viewer's own accounts.
 */
export function incomeBaseline(ownTxns: Transaction[], today: string): number {
  const months = priorMonths(monthKey(today), 3)
  const total = ownTxns
    .filter((t) => t.type === 'income' && months.includes(monthKey(t.date)))
    .reduce((sum, t) => sum + countableAmount(t), 0)
  return total / 3
}

/** 0 → below 25% (chip-pos); 1 → 25–50% (chip-warn); 2 → above 50% (chip-neg). `pct` is a fraction (lockedIn / income), not a percentage. */
export function committedChipTone(pct: number): 'pos' | 'warn' | 'neg' {
  if (pct < 0.25) return 'pos'
  if (pct <= 0.5) return 'warn'
  return 'neg'
}

export interface LeftThisMonth {
  amount: number
  count: number
  /** Day-of-month of the first and last remaining occurrence, for the "{d1}–{d2} {Mon}" sub-line. Both null when `count` is 0. */
  firstDay: number | null
  lastDay: number | null
  /** 'MMM'-style month abbreviation shared by every remaining occurrence (the calendar's current month). */
  monthLabel: string | null
}

/** Expense occurrences dated strictly after `today` through month-end. Today's own charges have already been posted by the boot-time processor. */
export function leftThisMonth(rules: RecurringTransaction[], today: string, monthLabel: string): LeftThisMonth {
  const [y, m] = today.split('-').map(Number)
  let amount = 0
  const days: number[] = []
  for (const rule of rules.filter((r) => isActive(r) && r.type === 'expense')) {
    for (const date of occurrencesInMonth(rule, y, m, today)) {
      if (date <= today) continue
      amount += rule.amount
      days.push(Number(date.slice(8, 10)))
    }
  }
  if (days.length === 0) return { amount: 0, count: 0, firstDay: null, lastDay: null, monthLabel: null }
  days.sort((a, b) => a - b)
  return { amount, count: days.length, firstDay: days[0], lastDay: days[days.length - 1], monthLabel }
}

export interface CategorySlice {
  /** Stable React key — the category id, '__uncategorised__' or '__other__'. Labels can collide (two unknown ids both read "Uncategorised"). */
  key: string
  label: string
  monthly: number
  color: string
}

/**
 * Top 3 categories by monthly-equivalent locked-in (expense) spend, plus an
 * "Other" bucket for the rest. Uncategorised rules count as their own
 * "Uncategorised" bucket going into the ranking. Each slice uses the
 * category's own colour — the same one the calendar's dots use — so a
 * category reads as one colour across the page; "Other" keeps
 * `rgb(var(--warn))` and "Uncategorised" keeps `rgb(var(--fg-subtle))`.
 */
export function categoryBreakdown(rules: RecurringTransaction[], categories: Category[]): CategorySlice[] {
  const uncategorisedToken = 'rgb(var(--fg-subtle))'
  const otherToken = 'rgb(var(--warn))'
  const byCategory = new Map<string, number>()
  for (const r of rules.filter((r) => isActive(r) && r.type === 'expense')) {
    const key = r.categoryId ?? '__uncategorised__'
    byCategory.set(key, (byCategory.get(key) ?? 0) + monthlyEquivalent(r))
  }
  const labelFor = (key: string): string =>
    key === '__uncategorised__' ? 'Uncategorised' : categories.find((c) => c.id === key)?.name ?? 'Uncategorised'
  const colorFor = (key: string): string =>
    key === '__uncategorised__' ? uncategorisedToken : categories.find((c) => c.id === key)?.color ?? uncategorisedToken
  const sorted = [...byCategory.entries()].sort((a, b) => b[1] - a[1])
  const top3 = sorted.slice(0, 3)
  const rest = sorted.slice(3)
  const slices: CategorySlice[] = top3.map(([key, monthly]) => ({ key, label: labelFor(key), monthly, color: colorFor(key) }))
  const otherTotal = rest.reduce((sum, [, v]) => sum + v, 0)
  if (otherTotal > 0) slices.push({ key: '__other__', label: 'Other', monthly: otherTotal, color: otherToken })
  return slices
}

export interface PriceRise {
  rule: RecurringTransaction
  source: 'a' | 'b'
  /** The figure the rule should move to (the matched charge for (a), `rule.amount` for (b)). */
  newAmount: number
  priorAmount: number
  delta: number
  /** 'MMM' label of the month the rise was noticed (the charge's date for (a), `amountChangedAt` for (b)). */
  changedMonth: string
  changedMonthKey: string
}

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const monthAbbrOf = (monthKeyStr: string): string => MONTH_ABBR[Number(monthKeyStr.slice(5, 7)) - 1]

/** Source (a) + (b) price rises, one per rule (a) wins when both apply. `ownTxns` must already be own-account-filtered. */
export function priceRises(rules: RecurringTransaction[], ownTxns: Transaction[], today: string): PriceRise[] {
  const cutoff120 = (() => {
    const d = parseISO(today)
    d.setDate(d.getDate() - 120)
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  })()
  const sixMonthsAgo = subMonths(parseISO(today), 6)

  const result: PriceRise[] = []
  for (const rule of rules.filter((r) => isActive(r) && r.type === 'expense' && r.merchant.trim() !== '')) {
    const normalised = normaliseMerchant(rule.merchant)
    const candidates = ownTxns
      .filter((t) => t.type === 'expense')
      .filter((t) => t.date >= cutoff120 && t.date <= today)
      .filter((t) => normaliseMerchant(t.merchant) === normalised)
      .filter((t) => {
        const amt = countableAmount(t)
        return amt >= rule.amount * 0.5 && amt <= rule.amount * 1.5
      })
      .sort((a, b) => (a.date < b.date ? 1 : -1))

    const mostRecent = candidates[0]
    if (mostRecent) {
      const chargeAmount = countableAmount(mostRecent)
      if (chargeAmount > rule.amount * 1.005) {
        const mk = monthKey(mostRecent.date)
        result.push({
          rule, source: 'a', newAmount: chargeAmount, priorAmount: rule.amount,
          delta: chargeAmount - rule.amount, changedMonth: monthAbbrOf(mk), changedMonthKey: mk,
        })
        continue
      }
    }

    if (
      rule.previousAmount !== null && rule.amountChangedAt !== null &&
      rule.amount > rule.previousAmount && !isBefore(parseISO(rule.amountChangedAt), sixMonthsAgo)
    ) {
      const mk = monthKey(rule.amountChangedAt)
      result.push({
        rule, source: 'b', newAmount: rule.amount, priorAmount: rule.previousAmount,
        delta: rule.amount - rule.previousAmount, changedMonth: monthAbbrOf(mk), changedMonthKey: mk,
      })
    }
  }
  return result
}

export interface PriceRiseStat {
  count: number
  deltaPerMonth: number
  earliestMonth: string
}

/** "Price rises" band stat: count of flagged rules, and the combined monthly-equivalent delta since the earliest rise. */
export function priceRiseStat(rises: PriceRise[]): PriceRiseStat | null {
  if (rises.length === 0) return null
  const deltaPerMonth = rises.reduce((sum, r) => sum + (r.rule.frequency === 'monthly' ? r.delta : (r.delta * 52) / 12), 0)
  const earliest = rises.reduce((min, r) => (r.changedMonthKey < min ? r.changedMonthKey : min), rises[0].changedMonthKey)
  return { count: rises.length, deltaPerMonth, earliestMonth: monthAbbrOf(earliest) }
}

export interface CostliestNudge {
  rule: RecurringTransaction
  annual: number
  monthly: number
  sinceLabel: string // 'MMM yyyy'
}

/** The active expense rule with the largest annual cost whose `createdAt` is more than 6 months ago. Null when none qualifies. */
export function costliestNudge(rules: RecurringTransaction[], today: string): CostliestNudge | null {
  const sixMonthsAgo = subMonths(parseISO(today), 6)
  const eligible = rules.filter((r) => isActive(r) && r.type === 'expense' && isBefore(parseISO(createdLocalDate(r)), sixMonthsAgo))
  if (eligible.length === 0) return null
  const rule = eligible.reduce((best, r) => (annualCost(r) > annualCost(best) ? r : best), eligible[0])
  const created = parseISO(createdLocalDate(rule))
  return {
    rule,
    annual: annualCost(rule),
    monthly: monthlyEquivalent(rule),
    sinceLabel: `${MONTH_ABBR[created.getMonth()]} ${created.getFullYear()}`,
  }
}

export interface SameDayCollision {
  day: number
  count: number
  total: number
  /** True when an active income-rule occurrence lands the day after the collision day. */
  beforePayday: boolean
}

/** The day THIS month (relative to `today`) with 2+ active expense occurrences and the largest total. Null when no day qualifies. */
export function sameDayCollision(rules: RecurringTransaction[], today: string): SameDayCollision | null {
  const [y, m] = today.split('-').map(Number)
  const byDay = new Map<string, { count: number; total: number }>()
  for (const rule of rules.filter((r) => isActive(r) && r.type === 'expense')) {
    for (const date of occurrencesInMonth(rule, y, m, today)) {
      const cur = byDay.get(date) ?? { count: 0, total: 0 }
      cur.count += 1
      cur.total += rule.amount
      byDay.set(date, cur)
    }
  }
  const qualifying = [...byDay.entries()].filter(([, v]) => v.count >= 2)
  if (qualifying.length === 0) return null
  qualifying.sort((a, b) => b[1].total - a[1].total || (a[0] < b[0] ? -1 : 1))
  const [date, { count, total }] = qualifying[0]
  const day = Number(date.slice(8, 10))
  // Next calendar day — a plain Date increment (no "today" semantics
  // involved, so the §3 toISOString trap doesn't apply here).
  const dt = new Date(y, m - 1, day)
  dt.setDate(dt.getDate() + 1)
  const nextDateStr = `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`
  const beforePayday = rules
    .filter((r) => isActive(r) && r.type === 'income')
    .some((r) => occurrencesInMonth(r, dt.getFullYear(), dt.getMonth() + 1, today).includes(nextDateStr))
  return { day, count, total, beforePayday }
}

export type WorthALookRow =
  | { kind: 'priceRise'; data: PriceRise }
  | { kind: 'collision'; data: SameDayCollision }
  | { kind: 'nudge'; data: CostliestNudge }

/** Price rises first (most recent first, max 2), then the collision, then the nudge — at most 4 rows. */
export function worthALookRows(rises: PriceRise[], collision: SameDayCollision | null, nudge: CostliestNudge | null): WorthALookRow[] {
  const rows: WorthALookRow[] = []
  const sortedRises = [...rises].sort((a, b) => (a.changedMonthKey < b.changedMonthKey ? 1 : -1)).slice(0, 2)
  for (const r of sortedRises) rows.push({ kind: 'priceRise', data: r })
  if (collision) rows.push({ kind: 'collision', data: collision })
  if (nudge) rows.push({ kind: 'nudge', data: nudge })
  return rows.slice(0, 4)
}

export interface DetectCandidate {
  merchant: string
  amount: number
  accountId: string
  categoryId: string | null
  monthsRunning: number
  nextDueDate: string
}

/**
 * Repeating-but-unregistered merchants over the last 6 months of the
 * viewer's own-account expenses: 3+ consecutive calendar months of charges,
 * every charge within ±10% of the group median. `ownTxns` must already be
 * own-account-filtered. Sorted by amount, descending.
 */
export function detectCandidates(ownTxns: Transaction[], rules: RecurringTransaction[], today: string): DetectCandidate[] {
  const existingMerchants = new Set(rules.map((r) => normaliseMerchant(r.merchant)).filter((m) => m !== ''))
  const windowMonths = priorMonths(monthKey(today), 5).concat(monthKey(today)) // last 6 calendar months incl. current

  const groups = new Map<string, Transaction[]>()
  for (const t of ownTxns) {
    if (t.type !== 'expense') continue
    const normalised = normaliseMerchant(t.merchant)
    if (normalised === '' || existingMerchants.has(normalised)) continue
    if (!windowMonths.includes(monthKey(t.date))) continue
    if (!groups.has(normalised)) groups.set(normalised, [])
    groups.get(normalised)!.push(t)
  }

  const cutoff45 = (() => {
    const d = parseISO(today)
    d.setDate(d.getDate() - 45)
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  })()

  const candidates: DetectCandidate[] = []
  for (const [, txns] of groups) {
    const months = [...new Set(txns.map((t) => monthKey(t.date)))].sort()
    if (!hasConsecutiveRun(months, 3)) continue

    const amounts = txns.map((t) => countableAmount(t)).sort((a, b) => a - b)
    const median = amounts[Math.floor(amounts.length / 2)]
    if (median <= 0) continue
    const allWithinBand = amounts.every((a) => a >= median * 0.9 && a <= median * 1.1)
    if (!allWithinBand) continue

    const mostRecent = [...txns].sort((a, b) => (a.date < b.date ? 1 : -1))[0]
    // Lapsed groups (nothing charged in the last 45 days) aren't suggested —
    // a merchant that stopped charging isn't a recurring rule to add.
    if (mostRecent.date < cutoff45) continue

    // Roll the suggested next due forward until it is strictly after today,
    // so accepting the candidate never back-posts a charge that already
    // happened (mirrors the same guard on detect's nextDueDate below).
    let nextDueDate = advanceDate(mostRecent.date, 'monthly')
    let guard = 0
    while (nextDueDate <= today && guard < 60) {
      nextDueDate = advanceDate(nextDueDate, 'monthly')
      guard++
    }

    candidates.push({
      merchant: mostRecent.merchant,
      amount: countableAmount(mostRecent),
      accountId: mostRecent.accountId,
      categoryId: mostRecent.categoryId,
      monthsRunning: longestConsecutiveRun(months),
      nextDueDate,
    })
  }
  return candidates.sort((a, b) => b.amount - a.amount)
}

/** Longest run of CONSECUTIVE calendar months in `months` (sorted 'YYYY-MM' strings). */
function longestConsecutiveRun(months: string[]): number {
  let streak = 1
  let longest = months.length > 0 ? 1 : 0
  for (let i = 1; i < months.length; i++) {
    const prev = months[i - 1]
    const [py, pm] = prev.split('-').map(Number)
    const expectedNext = pm === 12 ? `${py + 1}-01` : `${py}-${pad(pm + 1)}`
    streak = months[i] === expectedNext ? streak + 1 : 1
    if (streak > longest) longest = streak
  }
  return longest
}

/** True when `months` (sorted 'YYYY-MM' strings) contains a run of `run` or more CONSECUTIVE calendar months. */
function hasConsecutiveRun(months: string[], run: number): boolean {
  return longestConsecutiveRun(months) >= run
}
