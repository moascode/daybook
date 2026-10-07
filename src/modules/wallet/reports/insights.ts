/**
 * FEAT-070 (docs/backlog/EP-06-wallet-depth/FEAT-070-reports-design-adoption.md)
 * — Reports' maths. Pure functions only: no React, no fetching, nothing
 * touches `new Date()` directly — date math goes through `monthKey`/
 * `shiftMonth` (src/modules/wallet/dashboard/insights.ts), same as Goals/
 * Recurring. Every function that needs "now" takes `today` or `anchor`
 * explicitly so callers (and tests) control it (CLAUDE.md §3 "the suite
 * runs on ONE clock" trap).
 *
 * Every figure here assumes its caller already filtered to OWN accounts and
 * excluded transfers (CLAUDE.md §3's money traps) — this module does not
 * re-check either; it only sums `countableAmount`.
 *
 * All thresholds below are this item's best-effort picks (the spec's
 * "Stated rules" section) — documented and tunable, not hidden as magic
 * numbers.
 */
import { parseISO, format } from 'date-fns'
import { monthKey, shiftMonth } from '@/modules/wallet/dashboard/insights'
import { countableAmount } from '@/hooks/useWallet'
import { accountBalanceAsOf } from '@/modules/wallet/accounts/insights'
import { formatMYR } from '@/lib/utils'
import type { Transaction, Category, Account } from '@/types/wallet.types'

export type PeriodSegment = '3m' | '6m' | '12m' | 'all'

export const UNCATEGORISED_KEY = '__uncategorised__'
const UNCATEGORISED_COLOR = 'rgb(var(--fg-subtle))'
const UNCATEGORISED_LABEL = 'Uncategorised'

const MINUS = '−' // U+2212, the mock's minus sign — never a plain hyphen.

// ── Window selection ────────────────────────────────────────────────

/** The last COMPLETE month: the month before `todayIso`'s. */
export function anchorMonth(todayIso: string): string {
  return shiftMonth(monthKey(todayIso), -1)
}

/** 'YYYY-MM' of the earliest own-account transaction, or null with no history at all. */
export function earliestMonth(txns: Transaction[]): string | null {
  let earliest: string | null = null
  for (const t of txns) {
    const m = monthKey(t.date)
    if (earliest === null || m < earliest) earliest = m
  }
  return earliest
}

/**
 * The window's months, oldest first, ending at `anchor`. A window never
 * starts before `earliest` — 12m over 5 months of history shows 5 months.
 */
export function windowMonths(anchor: string, segment: PeriodSegment, earliest: string): string[] {
  const desired = segment === '3m' ? 3 : segment === '6m' ? 6 : segment === '12m' ? 12 : null
  const start = desired === null ? earliest : maxMonth(shiftMonth(anchor, -(desired - 1)), earliest)
  const months: string[] = []
  for (let m = start; m <= anchor; m = shiftMonth(m, 1)) {
    months.push(m)
    if (months.length > 600) break // guard against a bad month never reaching anchor
  }
  return months
}

function maxMonth(a: string, b: string): string {
  return a > b ? a : b
}

/** "{Mon YYYY} – {Mon YYYY}" of a (non-empty) months list — the page's header sub. */
export function windowRangeLabel(months: string[]): string {
  const first = format(parseISO(`${months[0]}-01`), 'MMM yyyy')
  const last = format(parseISO(`${months[months.length - 1]}-01`), 'MMM yyyy')
  return `${first} – ${last}`
}

/**
 * The word the mock's sentences use for the window ("over the YEAR", "weakest
 * months of the YEAR") — not the date-range label. 12 months reads as "year";
 * anything else (3m/6m/All, or a 12m window shortened by limited history)
 * reads as "N months".
 */
export function windowPhrase(monthCount: number): string {
  if (monthCount === 12) return 'year'
  if (monthCount === 1) return 'month'
  return `${monthCount} months`
}

// ── Aggregation ─────────────────────────────────────────────────────

export interface MonthlyTotals {
  income: Map<string, number>
  expense: Map<string, number>
}

/** Sums income/expense `countableAmount` per month over every (own-account, non-transfer) transaction given. */
export function monthlyTotals(txns: Transaction[]): MonthlyTotals {
  const income = new Map<string, number>()
  const expense = new Map<string, number>()
  for (const t of txns) {
    if (t.type === 'transfer') continue
    const m = monthKey(t.date)
    const amt = countableAmount(t)
    const target = t.type === 'income' ? income : expense
    target.set(m, (target.get(m) ?? 0) + amt)
  }
  return { income, expense }
}

export function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0)
}

export function average(values: number[]): number {
  return values.length === 0 ? 0 : sum(values) / values.length
}

export function pickSeries(months: string[], byMonth: Map<string, number>): number[] {
  return months.map((m) => byMonth.get(m) ?? 0)
}

// ── Trend (ordinary least squares over x = 0..n-1) ─────────────────

export interface TrendLine {
  slope: number
  intercept: number
}

/** Least-squares line through `values` (x = 0, 1, …, n-1). Needs at least 2 points. */
export function fitTrendLine(values: number[]): TrendLine | null {
  const n = values.length
  if (n < 2) return null
  const xs = Array.from({ length: n }, (_, i) => i)
  const meanX = average(xs)
  const meanY = average(values)
  let num = 0
  let den = 0
  for (let i = 0; i < n; i++) {
    num += (xs[i] - meanX) * (values[i] - meanY)
    den += (xs[i] - meanX) ** 2
  }
  const slope = den === 0 ? 0 : num / den
  const intercept = meanY - slope * meanX
  return { slope, intercept }
}

export function fitAt(line: TrendLine, x: number): number {
  return line.intercept + line.slope * x
}

/**
 * Growth % over the window = fit(n-1) ÷ fit(0) − 1, as a plain number (not
 * ×100). Undefined (null) when the window has fewer than 3 months, the
 * fitted start value is ≤ 0, or the fitted end value is < 0 (either makes the
 * ratio read as a meaningless or impossible-looking "down 120%").
 */
export function trendGrowth(values: number[]): number | null {
  if (values.length < 3) return null
  const line = fitTrendLine(values)
  if (!line) return null
  const start = fitAt(line, 0)
  if (start <= 0) return null
  const end = fitAt(line, values.length - 1)
  if (end < 0) return null
  return end / start - 1
}

// ── Gap sentence (Income vs spending) ───────────────────────────────

const MAX_CROSSING_MONTHS = 120

/** A gap-sentence fragment: plain text, or a `{ bold }` wrapper for the two trend percentages (the mock renders these `<b>`, fg-coloured, weight 600). */
export type GapSentencePart = string | { bold: string }

export function gapSentenceParts(incomeValues: number[], spendValues: number[], windowLabel: string, keptTotal: number): GapSentencePart[] {
  const incomeGrowth = trendGrowth(incomeValues)
  const spendGrowth = trendGrowth(spendValues)
  if (incomeGrowth === null || spendGrowth === null) {
    return [`${formatSignedMYR(keptTotal, false)} kept over the ${windowLabel}.`]
  }
  const incomeLine = fitTrendLine(incomeValues)!
  const spendLine = fitTrendLine(spendValues)!
  const n = incomeValues.length
  const incomeAtEnd = fitAt(incomeLine, n - 1)
  const spendAtEnd = fitAt(spendLine, n - 1)

  const incomeDir = incomeGrowth >= 0 ? 'up' : 'down'
  const spendDir = spendGrowth >= 0 ? 'up' : 'down'
  const base: GapSentencePart[] = [
    `Income is ${incomeDir} `,
    { bold: formatPercentAbs(incomeGrowth) },
    ` over the ${windowLabel}, spending ${spendDir} `,
    { bold: formatPercentAbs(spendGrowth) },
    '.',
  ]

  if (spendAtEnd >= incomeAtEnd) {
    return [...base, ' Spending is already above income.']
  }
  if (incomeLine.slope >= spendLine.slope) {
    return [...base, ' If both hold, the gap is widening.']
  }
  // Spending's slope exceeds income's and spending is currently below income
  // — find where the two fitted lines cross, measured in months after the
  // anchor (x = n-1).
  const crossX = (spendLine.intercept - incomeLine.intercept) / (incomeLine.slope - spendLine.slope)
  const monthsAhead = crossX - (n - 1)
  if (monthsAhead >= 0 && monthsAhead <= MAX_CROSSING_MONTHS) {
    const n2 = Math.max(1, Math.round(monthsAhead))
    return [...base, ` If both hold, the gap closes in about ${n2} month${n2 === 1 ? '' : 's'}.`]
  }
  return [...base, ' At this rate the gap holds for over 10 years.']
}

// ── Savings rate ─────────────────────────────────────────────────────

/** null when income is 0 — "division makes no sense" (mirrors `accountMonthChange`'s guard). */
export function savingsRate(income: number, expense: number): number | null {
  if (income === 0) return null
  return (income - expense) / income
}

export function savingsRateSeries(months: string[], incomeByMonth: Map<string, number>, expenseByMonth: Map<string, number>): (number | null)[] {
  return months.map((m) => savingsRate(incomeByMonth.get(m) ?? 0, expenseByMonth.get(m) ?? 0))
}

export interface WeakMonth {
  key: string
  label: string
}

/**
 * The two (or one, with < 4 window months) lowest non-null-rate months,
 * returned in CHRONOLOGICAL order (the sentence names them "June and July",
 * not by severity). The label is the month name alone, unless two selected
 * months share a calendar-month name — only possible under "All" spanning
 * more than 12 months — in which case both labels add the year.
 */
export function weakestMonths(months: string[], rates: (number | null)[]): WeakMonth[] {
  const withRates = months
    .map((m, i) => ({ m, rate: rates[i] }))
    .filter((x): x is { m: string; rate: number } => x.rate !== null)
  const count = months.length < 4 ? 1 : 2
  const picked = [...withRates].sort((a, b) => a.rate - b.rate).slice(0, count)
  picked.sort((a, b) => (a.m < b.m ? -1 : a.m > b.m ? 1 : 0))
  const monthNames = picked.map((x) => format(parseISO(`${x.m}-01`), 'MMMM'))
  const needsYear = monthNames.length === 2 && monthNames[0] === monthNames[1]
  return picked.map((x, i) => ({
    key: x.m,
    label: needsYear ? format(parseISO(`${x.m}-01`), 'MMMM yyyy') : monthNames[i],
  }))
}

/**
 * The savings-rate card's closing sentence, built from the window label
 * ("June and July were the weakest months of the {window}."). `weakCategoryFinder`
 * returns the category whose spend ran furthest above its own baseline for a
 * given month, or null — the caller supplies it (see `topOverBaselineCategory`)
 * so this function stays a pure string-builder.
 */
export function savingsSentence(weak: WeakMonth[], windowLabel: string, weakCategoryFinder: (month: string) => string | null): string {
  if (weak.length === 0) return ''
  const monthsPhrase = weak.length === 1 ? `${weak[0].label} was` : `${weak[0].label} and ${weak[1].label} were`
  const base = `${monthsPhrase} the weakest month${weak.length > 1 ? 's' : ''} of the ${windowLabel}.`
  const categories = weak.map((w) => weakCategoryFinder(w.key))
  if (categories.some((c) => c === null)) return base
  const first = categories[0]
  if (categories.every((c) => c === first)) {
    const verb = weak.length > 1 ? 'Both' : 'It'
    return `${base} ${verb} had ${first} above its usual.`
  }
  return base
}

/** The expense category with the largest POSITIVE delta vs its baseline for one month, or null. */
export function topOverBaselineCategory(
  categorySpendByMonth: Map<string, Map<string, number>>,
  baselineByCategory: Map<string, number>,
  month: string,
  labelFor: (key: string) => string,
): string | null {
  let best: { key: string; delta: number } | null = null
  for (const [key, baseline] of baselineByCategory) {
    const spend = categorySpendByMonth.get(key)?.get(month) ?? 0
    const delta = spend - baseline
    if (delta > 0 && (best === null || delta > best.delta)) best = { key, delta }
  }
  return best ? labelFor(best.key) : null
}

// ── Category baseline ("your own 12-month average") ─────────────────

/** Up to 12 complete months strictly before `anchor`, oldest first, never reaching before `earliest`. */
export function baselineMonths(anchor: string, earliest: string): string[] {
  const start = maxMonth(shiftMonth(anchor, -12), earliest)
  const end = shiftMonth(anchor, -1)
  const months: string[] = []
  for (let m = start; m <= end; m = shiftMonth(m, 1)) {
    months.push(m)
    if (months.length > 12) break
  }
  return months
}

/** Minimum 3 baseline months — below that, What changed / Category trends show "Needs 3 months of history". */
export const MIN_BASELINE_MONTHS = 3

export function categoryBaseline(categorySpendByMonth: Map<string, Map<string, number>>, months: string[]): Map<string, number> {
  const result = new Map<string, number>()
  for (const key of categorySpendByMonth.keys()) {
    const byMonth = categorySpendByMonth.get(key)!
    result.set(key, average(months.map((m) => byMonth.get(m) ?? 0)))
  }
  return result
}

// ── What changed ──────────────────────────────────────────────────────

export interface WhatChangedRow {
  key: string
  label: string
  delta: number
}

export interface WhatChangedResult {
  rows: WhatChangedRow[]
  net: number
  explainsMostLabel: string | null
}

const MIN_DELTA = 1

/**
 * Per-category `anchorSpend - baseline`, the 6 largest by |delta| (dropping
 * |delta| < RM1), ordered positives (descending) then negatives (descending
 * — the mock's "ascending by value" meaning smallest decrease first, the
 * largest decrease last). `net` sums delta over ALL categories, not just the
 * shown rows.
 */
export function whatChangedRows(
  anchorSpendByCategory: Map<string, number>,
  baselineByCategory: Map<string, number>,
  labelFor: (key: string) => string,
): WhatChangedResult {
  const keys = new Set<string>([...anchorSpendByCategory.keys(), ...baselineByCategory.keys()])
  const deltas: { key: string; delta: number }[] = []
  let net = 0
  for (const key of keys) {
    const delta = (anchorSpendByCategory.get(key) ?? 0) - (baselineByCategory.get(key) ?? 0)
    net += delta
    if (Math.abs(delta) >= MIN_DELTA) deltas.push({ key, delta })
  }
  net = Math.round(net * 100) / 100
  if (Math.abs(net) < 0.005) net = 0

  const top6 = [...deltas].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 6)
  const positives = top6.filter((d) => d.delta > 0).sort((a, b) => b.delta - a.delta)
  const negatives = top6.filter((d) => d.delta < 0).sort((a, b) => b.delta - a.delta)
  const rows: WhatChangedRow[] = [...positives, ...negatives].map((d) => ({ key: d.key, label: labelFor(d.key), delta: d.delta }))

  let explainsMostLabel: string | null = null
  if (net !== 0) {
    const sameSign = deltas.filter((d) => Math.sign(d.delta) === Math.sign(net))
    const biggest = sameSign.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))[0]
    if (biggest && Math.abs(biggest.delta) >= 0.5 * Math.abs(net)) {
      explainsMostLabel = labelFor(biggest.key)
    }
  }

  return { rows, net, explainsMostLabel }
}

// ── Cash flow ─────────────────────────────────────────────────────────

export interface CashFlowRow {
  month: string
  monthLabel: string
  income: number
  expense: number
  kept: number
}

const CASH_FLOW_MAX_ROWS = 6

/** The window's months, newest first, capped at 6 rows. */
export function cashFlowRows(months: string[], incomeByMonth: Map<string, number>, expenseByMonth: Map<string, number>): CashFlowRow[] {
  return [...months]
    .reverse()
    .slice(0, CASH_FLOW_MAX_ROWS)
    .map((m) => {
      const income = incomeByMonth.get(m) ?? 0
      const expense = expenseByMonth.get(m) ?? 0
      return { month: m, monthLabel: format(parseISO(`${m}-01`), 'MMMM'), income, expense, kept: income - expense }
    })
}

/** Total kept over the WHOLE window (not just the capped rows shown). */
export function totalKept(months: string[], incomeByMonth: Map<string, number>, expenseByMonth: Map<string, number>): number {
  return sum(months.map((m) => (incomeByMonth.get(m) ?? 0) - (expenseByMonth.get(m) ?? 0)))
}

// ── Category trends ────────────────────────────────────────────────

export type TrendMeasure = 'amount' | 'share'

export interface CategoryTrendRow {
  key: string
  label: string
  color: string
  sparkline: number[]
  average: number
  current: number
  changeLabel: string
  chipClass: string
}

const CHIP_MUTE = 'chip-mute'
const CHIP_WARN = 'chip-warn'
const CHIP_NEG = 'chip-neg'
const CHIP_POS = 'chip-pos'

function amountChangeChip(pctChange: number): string {
  const pct = pctChange * 100
  if (Math.abs(pct) < 5) return CHIP_MUTE
  if (pct < 0) return CHIP_POS // down ≥5% → pos
  return pct > 50 ? CHIP_NEG : CHIP_WARN // up 5–50% → warn, up >50% → neg
}

function shareChangePtsChip(pts: number): string {
  if (Math.abs(pts) < 5) return CHIP_MUTE
  if (pts < 0) return CHIP_POS
  return pts > 15 ? CHIP_NEG : CHIP_WARN
}

export function categoryTrendRows(
  categorySpendByMonth: Map<string, Map<string, number>>,
  baselineByCategory: Map<string, number>,
  months: string[],
  measure: TrendMeasure,
  totalSpendByMonth: Map<string, number>,
  labelFor: (key: string) => { label: string; color: string },
  baselineMonthsList: string[],
): CategoryTrendRow[] {
  const anchor = months[months.length - 1]
  const keys = [...baselineByCategory.keys()].filter((key) => {
    const byMonth = categorySpendByMonth.get(key)
    const hasWindowSpend = byMonth ? months.some((m) => (byMonth.get(m) ?? 0) > 0) : false
    return hasWindowSpend || (baselineByCategory.get(key) ?? 0) > 0
  })

  const rows = keys.map((key) => {
    const { label, color } = labelFor(key)
    const byMonth = categorySpendByMonth.get(key) ?? new Map<string, number>()
    const baseline = baselineByCategory.get(key) ?? 0
    const current = byMonth.get(anchor) ?? 0

    if (measure === 'amount') {
      const sparkline = months.map((m) => byMonth.get(m) ?? 0)
      let changeLabel: string
      let chipClass: string
      if (baseline <= 0 && current > 0) {
        changeLabel = 'New'
        chipClass = CHIP_WARN
      } else if (baseline <= 0) {
        changeLabel = formatPercentWhole(0)
        chipClass = CHIP_MUTE
      } else {
        const pctChange = current / baseline - 1
        changeLabel = formatPercentWhole(pctChange)
        chipClass = amountChangeChip(pctChange)
      }
      return { key, label, color, sparkline, average: baseline, current, changeLabel, chipClass }
    }

    // Share mode: each figure as % of that month's total spend.
    const shareOf = (m: string) => {
      const total = totalSpendByMonth.get(m) ?? 0
      return total > 0 ? ((byMonth.get(m) ?? 0) / total) * 100 : 0
    }
    const sparkline = months.map(shareOf)
    const baselineShare = average(baselineMonthsShareValues(byMonth, totalSpendByMonth, baselineMonthsList))
    const currentShare = shareOf(anchor)
    const pts = currentShare - baselineShare
    return {
      key, label, color, sparkline,
      average: baselineShare, current: currentShare,
      changeLabel: `${formatSignedNumber(pts, 1)} pts`,
      chipClass: shareChangePtsChip(pts),
    }
  })

  // Both modes sort by the Amount baseline (not `row.average`, which in Share
  // mode holds the baseline SHARE — a different scale) so the row order never
  // changes when the Amount/Share toggle is flipped.
  return rows.sort((a, b) => (baselineByCategory.get(b.key) ?? 0) - (baselineByCategory.get(a.key) ?? 0))
}

// Share's baseline uses the SAME baseline months as Amount mode (up to 12
// complete months before the anchor, independent of the period segment) so
// the two modes' "Average" column means the same window. A month with zero
// total spend is skipped entirely — not counted as 0% — since a share of
// nothing is undefined, not zero.
function baselineMonthsShareValues(byMonth: Map<string, number>, totalSpendByMonth: Map<string, number>, baselineMonthsList: string[]): number[] {
  const values: number[] = []
  for (const m of baselineMonthsList) {
    const total = totalSpendByMonth.get(m) ?? 0
    if (total > 0) values.push(((byMonth.get(m) ?? 0) / total) * 100)
  }
  return values
}

// ── Net worth ─────────────────────────────────────────────────────────

export interface NetWorthChange {
  amount: number
  start: number
  end: number
}

/**
 * Σ own-account `accountBalanceAsOf` at the window's last day minus the same
 * at the day before the window starts. `allOwnTxns` must be the full,
 * unfiltered own-account history (all-time), not a window-bounded slice —
 * mirrors `computeMonthlyNetWorth`'s own requirement.
 */
export function netWorthChange(ownAccounts: Account[], allOwnTxns: Transaction[], windowStartMonth: string, windowEndMonth: string): NetWorthChange {
  const endDate = monthLastDay(windowEndMonth)
  const startDate = dayBefore(`${windowStartMonth}-01`)
  const end = sum(ownAccounts.map((a) => accountBalanceAsOf(a, allOwnTxns, endDate)))
  const start = sum(ownAccounts.map((a) => accountBalanceAsOf(a, allOwnTxns, startDate)))
  return { amount: end - start, start, end }
}

function monthLastDay(month: string): string {
  const next = shiftMonth(month, 1)
  return dayBefore(`${next}-01`)
}

function dayBefore(isoDate: string): string {
  const d = new Date(Number(isoDate.slice(0, 4)), Number(isoDate.slice(5, 7)) - 1, Number(isoDate.slice(8, 10)))
  d.setDate(d.getDate() - 1)
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

// ── Formatting ──────────────────────────────────────────────────────

/** formatMYR with the mock's real minus sign (U+2212) instead of a hyphen, and an explicit "+" for positives when `signPositive`. */
export function formatSignedMYR(amount: number, signPositive = true): string {
  const abs = formatMYR(Math.abs(amount))
  if (amount < 0) return `${MINUS}${abs}`
  return signPositive ? `+${abs}` : abs
}

/** "+6.1%" / "−3.2%" — 1 decimal, U+2212 for negatives. Stat-card chips and the gap sentence. */
export function formatPercentSigned(fraction: number): string {
  return formatSignedNumber(fraction * 100, 1) + '%'
}

/** "+100%" / "−33%" — WHOLE percent, U+2212 for negatives. Category-trend Amount-mode change chips only. */
export function formatPercentWhole(fraction: number): string {
  return formatSignedNumber(fraction * 100, 0) + '%'
}

/** "6.1%" with no sign — for the gap sentence's "up X%"/"down X%" phrasing. */
export function formatPercentAbs(fraction: number): string {
  return `${Math.abs(fraction * 100).toFixed(1)}%`
}

export function formatSignedNumber(value: number, decimals: number): string {
  const rounded = Math.abs(value).toFixed(decimals)
  return value < 0 ? `${MINUS}${rounded}` : `+${rounded}`
}

/**
 * Round UP to a "nice" step — 1/2/2.5/5 × a power of ten. The income-vs-
 * spending axis uses `step = niceStep(max ÷ 3)`, `top = 3 × step` (4
 * gridlines at 0/step/2·step/3·step), so e.g. max 7,300 → step 2,500 → top
 * 7,500, labelled RM0/RM2.5k/RM5k/RM7.5k.
 */
export function niceStep(value: number): number {
  if (value <= 0) return 1
  const magnitude = 10 ** Math.floor(Math.log10(value))
  const residual = value / magnitude
  const niceResidual = residual <= 1 ? 1 : residual <= 2 ? 2 : residual <= 2.5 ? 2.5 : residual <= 5 ? 5 : 10
  return niceResidual * magnitude
}

export function ceil10(n: number): number {
  return Math.ceil(n / 10) * 10
}

export function floor10(n: number): number {
  return Math.floor(n / 10) * 10
}

/** Category key for a transaction's `categoryId` — `__uncategorised__` for null or an unknown id. */
export function categoryLabelKeyFor(categoryId: string | null, categories: Category[]): string {
  if (categoryId === null) return UNCATEGORISED_KEY
  return categories.some((c) => c.id === categoryId) ? categoryId : UNCATEGORISED_KEY
}

export interface CategoryLabelInfo {
  label: string
  color: string
}

export function categoryLabelInfo(key: string, categories: Category[]): CategoryLabelInfo {
  if (key === UNCATEGORISED_KEY) return { label: UNCATEGORISED_LABEL, color: UNCATEGORISED_COLOR }
  const cat = categories.find((c) => c.id === key)
  return cat ? { label: cat.name, color: cat.color } : { label: UNCATEGORISED_LABEL, color: UNCATEGORISED_COLOR }
}

/** Builds the per-category, per-month expense spend map keyed by `categoryLabelKeyFor`. */
export function categorySpendByMonthMap(txns: Transaction[], categories: Category[]): Map<string, Map<string, number>> {
  const result = new Map<string, Map<string, number>>()
  for (const t of txns) {
    if (t.type !== 'expense') continue
    const key = categoryLabelKeyFor(t.categoryId, categories)
    const month = monthKey(t.date)
    let byMonth = result.get(key)
    if (!byMonth) {
      byMonth = new Map()
      result.set(key, byMonth)
    }
    byMonth.set(month, (byMonth.get(month) ?? 0) + countableAmount(t))
  }
  return result
}
