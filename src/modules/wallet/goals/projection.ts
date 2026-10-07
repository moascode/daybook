/**
 * FEAT-067 (docs/archive/ep-06-wallet-depth/FEAT-067-goals-design-adoption.md)
 * — the funding-rate/ETA/status math absorbed from FEAT-019. Pure functions
 * only: no React, no fetching, nothing touches `new Date()`. Every function
 * that needs "now" takes `today` ('YYYY-MM-DD') as a parameter so callers —
 * and tests — control it explicitly (CLAUDE.md §3 "the suite runs on ONE
 * clock" trap applies here too, even though this module has no server side).
 *
 * All of the rules below are this item's best-effort picks (see the spec's
 * "Stated rules" section) — documented and tunable, not hidden as magic
 * numbers.
 */
import { differenceInCalendarMonths, parseISO } from 'date-fns'
import { monthKey, shiftMonth } from '@/modules/wallet/dashboard/insights'
import type { Goal, GoalFlow } from '@/types/wallet.types'

/** Number of whole calendar months from `fromMonth` to `toMonth` ('YYYY-MM' each), positive when `toMonth` is later. */
function monthsBetween(fromMonth: string, toMonth: string): number {
  return differenceInCalendarMonths(parseISO(`${toMonth}-01`), parseISO(`${fromMonth}-01`))
}

/** Floor to the nearest lower multiple of 50 — the "Room for another $X" rounding rule. */
function floor50(n: number): number {
  return Math.floor(n / 50) * 50
}

/**
 * `flows` is the same array reference across a render cycle (GoalsPage
 * memoizes it), so a flows-array → accountId → month lookup map is built
 * once per array identity rather than `Array.find`-scanning on every call —
 * this module is called per goal, per month, in a few nested loops below.
 */
const flowMapCache = new WeakMap<GoalFlow[], Map<string, Map<string, number>>>()

function flowMapFor(flows: GoalFlow[]): Map<string, Map<string, number>> {
  let map = flowMapCache.get(flows)
  if (!map) {
    map = new Map()
    for (const f of flows) {
      let byMonth = map.get(f.accountId)
      if (!byMonth) {
        byMonth = new Map()
        map.set(f.accountId, byMonth)
      }
      byMonth.set(f.month, f.net)
    }
    flowMapCache.set(flows, map)
  }
  return map
}

/** Net inflow of `accountId` in a single month, 0 when that month has no flow row. */
function netInMonth(flows: GoalFlow[], accountId: string, month: string): number {
  return flowMapFor(flows).get(accountId)?.get(month) ?? 0
}

/** Sum of `accountId`'s net inflow for every month STRICTLY AFTER `month` — including months beyond today, e.g. a future-dated transaction — not bounded by "today". */
function sumNetAfter(flows: GoalFlow[], accountId: string, month: string): number {
  const byMonth = flowMapFor(flows).get(accountId)
  if (!byMonth) return 0
  let sum = 0
  for (const [m, net] of byMonth) {
    if (m > month) sum += net
  }
  return sum
}

/**
 * A goal's "saved" figure is its linked account's balance, clamped to
 * [0, target] (spec: "What the data model already gives us"). `balances` is
 * the `GET /accounts/balances` shape — `Record<accountId, balance>`.
 */
export function goalSaved(goal: Goal, balances: Record<string, number>): number {
  const balance = balances[goal.accountId] ?? 0
  return Math.min(Math.max(balance, 0), goal.targetAmount)
}

/**
 * Funding rate = mean net inflow of the linked account over the last 3
 * COMPLETE calendar months, floored at 0. The in-progress month is excluded
 * so a payday on the 25th doesn't swing the figure.
 */
export function fundingRate(flows: GoalFlow[], accountId: string, today: string): number {
  const currentMonth = monthKey(today)
  const complete = [1, 2, 3].map((n) => shiftMonth(currentMonth, -n))
  const sum = complete.reduce((acc, m) => acc + netInMonth(flows, accountId, m), 0)
  return Math.max(0, sum / 3)
}

/** This month's positive net inflow so far (0 when the month is net-negative, never shown as a negative "added"). */
export function addedThisMonth(flows: GoalFlow[], accountId: string, today: string): number {
  return Math.max(0, netInMonth(flows, accountId, monthKey(today)))
}

/**
 * Paused = no positive net-inflow month in the 3-complete-month window AND
 * no positive inflow so far this month.
 */
export function isPaused(flows: GoalFlow[], accountId: string, today: string): boolean {
  const currentMonth = monthKey(today)
  const window = [1, 2, 3].map((n) => shiftMonth(currentMonth, -n))
  const anyPositiveInWindow = window.some((m) => netInMonth(flows, accountId, m) > 0)
  const positiveThisMonth = netInMonth(flows, accountId, currentMonth) > 0
  return !anyPositiveInWindow && !positiveThisMonth
}

/** Last month (up to and including the current one) with positive net inflow, or null if there has never been one. */
export function lastContributionMonth(flows: GoalFlow[], accountId: string, today: string): string | null {
  const currentMonth = monthKey(today)
  const positive = flows
    .filter((f) => f.accountId === accountId && f.net > 0 && f.month <= currentMonth)
    .map((f) => f.month)
    .sort()
  return positive.length > 0 ? positive[positive.length - 1] : null
}

/**
 * today + ceil((target - saved) / rate) months, as a 'YYYY-MM' key. null when
 * already funded or when there is no funding (`rate <= 0`) — shown as "—".
 */
export function etaMonth(saved: number, target: number, rate: number, today: string): string | null {
  if (rate <= 0 || saved >= target) return null
  const monthsNeeded = Math.ceil((target - saved) / rate)
  return shiftMonth(monthKey(today), monthsNeeded)
}

export type GoalStatus =
  | { kind: 'funded' }
  | { kind: 'paused'; since: string | null }
  | { kind: 'ahead'; monthsEarly: number; eta: string; rate: number }
  | { kind: 'onTrack'; eta: string; rate: number }
  | { kind: 'behind'; needed: number; rate: number }
  | { kind: 'overdue'; targetDate: string }
  | { kind: 'undated'; eta: string; rate: number }
  | { kind: 'noFunding' }

/**
 * The status-chip rule, in full (spec "Stated rules"):
 * complete → funded; else paused → paused; else no target date → undated
 * (or noFunding when rate is 0); else behind/onTrack/ahead against
 * `needed = (target - saved) / monthsUntil(targetDate)`, or overdue when the
 * target date has already passed.
 */
export function goalStatus(goal: Goal, saved: number, rate: number, flows: GoalFlow[], today: string): GoalStatus {
  if (saved >= goal.targetAmount) return { kind: 'funded' }

  if (isPaused(flows, goal.accountId, today)) {
    return { kind: 'paused', since: lastContributionMonth(flows, goal.accountId, today) }
  }

  if (!goal.targetDate) {
    if (rate <= 0) return { kind: 'noFunding' }
    // rate > 0 and not yet funded ⇒ etaMonth always resolves to a month.
    const eta = etaMonth(saved, goal.targetAmount, rate, today)!
    return { kind: 'undated', eta, rate }
  }

  if (goal.targetDate < today) {
    return { kind: 'overdue', targetDate: goal.targetDate }
  }

  const todayMonth = monthKey(today)
  const targetMonth = monthKey(goal.targetDate)
  const monthsUntilTarget = Math.max(1, monthsBetween(todayMonth, targetMonth))
  const needed = (goal.targetAmount - saved) / monthsUntilTarget

  if (rate <= 0) return { kind: 'behind', needed, rate }

  const eta = etaMonth(saved, goal.targetAmount, rate, today)!
  const monthsEarly = monthsBetween(eta, targetMonth)
  if (monthsEarly >= 1) {
    return { kind: 'ahead', monthsEarly, eta, rate }
  }
  // ETA resolves to a month strictly after the target month. This matters
  // most when the target is due THIS month (monthsUntilTarget clamped to the
  // 1-month floor above): `needed` can come out <= rate on paper even though
  // the real, whole-month ETA can't land inside the same month — i.e. the
  // goal is already behind regardless of what the needed-vs-rate arithmetic
  // says.
  if (monthsEarly < 0) {
    return { kind: 'behind', needed, rate }
  }
  if (rate >= needed) {
    return { kind: 'onTrack', eta, rate }
  }
  return { kind: 'behind', needed, rate }
}

/** The ETA ('YYYY-MM') carried by whichever status kinds have one, else null. No `any` — exhaustive over the union. */
function etaOf(status: GoalStatus): string | null {
  switch (status.kind) {
    case 'ahead':
    case 'onTrack':
    case 'undated':
      return status.eta
    default:
      return null
  }
}

export interface SavedHistoryPoint {
  month: string
  total: number
}

/**
 * Month-end total saved across `goals`, reconstructed BACKWARDS from today's
 * RAW account balance (not the [0,target]-clamped `goalSaved` figure —
 * clamping first and THEN subtracting inflow would double-clip a goal that's
 * currently over target): balance at the end of month m = current balance −
 * sum of net inflow for every month strictly after m, which includes any
 * future-dated flow beyond today, not just months up to "today". Each
 * resulting point is clamped to [0, target] once, then summed — matching the
 * band's "no de-duplication" rule for a shared linked account.
 */
export function savedHistory(
  goals: Goal[],
  balances: Record<string, number>,
  flows: GoalFlow[],
  fromMonth: string,
  today: string,
): SavedHistoryPoint[] {
  const currentMonth = monthKey(today)
  if (fromMonth > currentMonth) return []

  const months: string[] = []
  for (let m = fromMonth; m <= currentMonth; m = shiftMonth(m, 1)) months.push(m)

  return months.map((month) => {
    let total = 0
    for (const goal of goals) {
      const rawBalance = balances[goal.accountId] ?? 0
      const afterSum = sumNetAfter(flows, goal.accountId, month)
      const savedAtMonth = rawBalance - afterSum
      total += Math.min(Math.max(savedAtMonth, 0), goal.targetAmount)
    }
    return { month, total }
  })
}

/**
 * Dashed projection from today at `totalRate` a month until `totalTarget` or
 * `endMonth`, whichever comes first. Empty when `totalRate <= 0` — no
 * projection is drawn without current funding.
 */
export function projectionSeries(
  totalSaved: number,
  totalTarget: number,
  totalRate: number,
  today: string,
  endMonth: string,
): SavedHistoryPoint[] {
  if (totalRate <= 0) return []

  const series: SavedHistoryPoint[] = []
  let month = monthKey(today)
  let total = totalSaved
  while (true) {
    series.push({ month, total: Math.min(total, totalTarget) })
    if (total >= totalTarget || month >= endMonth) break
    month = shiftMonth(month, 1)
    total += totalRate
  }
  return series
}

export interface Milestone {
  goalId: string
  name: string
  /** "at 25%" | "halfway" | "at 75%" | "fully funded" */
  label: string
  amountToGo: number
  eta: string
}

const MILESTONE_FRACTIONS: Array<[number, string]> = [
  [0.25, 'at 25%'],
  [0.5, 'halfway'],
  [0.75, 'at 75%'],
  [1, 'fully funded'],
]

/** The next unreached 25/50/75/100% milestone per goal (paused/complete goals skipped), top 3 by ETA. */
export function nextMilestones(
  goals: Goal[],
  saved: Record<string, number>,
  rates: Record<string, number>,
  statuses: Record<string, GoalStatus>,
  today: string,
): Milestone[] {
  const candidates: Milestone[] = []
  for (const goal of goals) {
    const status = statuses[goal.id]
    if (!status || status.kind === 'paused' || status.kind === 'funded') continue
    if (goal.targetAmount <= 0) continue

    const s = saved[goal.id] ?? 0
    const rate = rates[goal.id] ?? 0
    const pct = s / goal.targetAmount
    const next = MILESTONE_FRACTIONS.find(([frac]) => frac > pct + 1e-9)
    if (!next) continue
    const [frac, label] = next

    const eta = etaMonth(s, frac * goal.targetAmount, rate, today)
    if (!eta) continue // no funding ⇒ no estimate to show

    candidates.push({
      goalId: goal.id,
      name: goal.name,
      label,
      amountToGo: frac * goal.targetAmount - s,
      eta,
    })
  }

  return candidates.sort((a, b) => a.eta.localeCompare(b.eta)).slice(0, 3)
}

export type KnockOn =
  | { kind: 'enoughToFix'; finishing: string; etaMonth: string; freedRate: number; target: string }
  | { kind: 'partialHelp'; finishing: string; etaMonth: string; freedRate: number; target: string; pct: number }
  | { kind: 'noBehind'; finishing: string; etaMonth: string; freedRate: number }

/**
 * The knock-on sentence (as data, not a string): take the first goal
 * projected to be fully funded within 12 months — its rate frees up then —
 * and say what that means for the most-behind goal, if any.
 */
export function knockOn(goalsWithStatus: Array<{ goal: Goal; status: GoalStatus }>, today: string): KnockOn | null {
  const windowEnd = shiftMonth(monthKey(today), 12)

  const finishing = goalsWithStatus
    .map((g) => ({ goal: g.goal, eta: etaOf(g.status), rate: rateOfFunding(g.status) }))
    .filter((g): g is { goal: Goal; eta: string; rate: number } => g.eta !== null && g.eta <= windowEnd)
    .sort((a, b) => a.eta.localeCompare(b.eta))[0]
  if (!finishing) return null

  // "Behind" for this purpose is both `behind` and `overdue` — a goal whose
  // target date has already passed is behind in the plainest sense, even
  // though its status kind carries no `needed`/`rate` to rank it by. It's
  // given an effectively-infinite shortfall so it always sorts as the MOST
  // behind goal, ahead of any `behind` kind with a finite number.
  const behind = goalsWithStatus
    .filter(
      (g): g is { goal: Goal; status: Extract<GoalStatus, { kind: 'behind' | 'overdue' }> } =>
        g.status.kind === 'behind' || g.status.kind === 'overdue',
    )
    .map((g) => (
      g.status.kind === 'overdue'
        ? { goal: g.goal, needed: Infinity, rate: 0 }
        : { goal: g.goal, needed: g.status.needed, rate: g.status.rate }
    ))
    .sort((a, b) => (b.needed - b.rate) - (a.needed - a.rate))

  if (behind.length === 0) {
    return { kind: 'noBehind', finishing: finishing.goal.name, etaMonth: finishing.eta, freedRate: finishing.rate }
  }

  const mostBehind = behind[0]
  const shortfall = mostBehind.needed - mostBehind.rate
  if (finishing.rate >= shortfall) {
    return {
      kind: 'enoughToFix',
      finishing: finishing.goal.name,
      etaMonth: finishing.eta,
      freedRate: finishing.rate,
      target: mostBehind.goal.name,
    }
  }

  const pct = shortfall > 0 ? Math.round((finishing.rate / shortfall) * 100) : 0
  return {
    kind: 'partialHelp',
    finishing: finishing.goal.name,
    etaMonth: finishing.eta,
    freedRate: finishing.rate,
    target: mostBehind.goal.name,
    pct,
  }
}

/** The funding rate carried by a status that has one (every kind but funded/overdue/noFunding/paused), else 0. */
function rateOfFunding(status: GoalStatus): number {
  switch (status.kind) {
    case 'ahead':
    case 'onTrack':
    case 'undated':
      return status.rate
    default:
      return 0
  }
}

/**
 * "Room for another $X" (spec): projectedKept = income-MTD − (expense-MTD /
 * elapsedFraction); room = floor50(projectedKept − addedThisMonth). null
 * (omit the row) below 50 — "no sentence with nothing behind it."
 */
export function roomForMore(input: {
  incomeMtd: number
  expenseMtd: number
  elapsedFraction: number
  addedThisMonth: number
}): number | null {
  if (input.elapsedFraction <= 0) return null
  const projectedKept = input.incomeMtd - input.expenseMtd / input.elapsedFraction
  const room = floor50(projectedKept - input.addedThisMonth)
  return room >= 50 ? room : null
}

/** Fixed 4-colour cycle matching the mock (green, blue, violet, amber) — tokens that already exist (scripts/gen-theme-tokens.mjs primitives). */
const GOAL_COLORS = ['rgb(var(--g-500))', 'rgb(var(--b-500))', 'rgb(var(--v-500))', 'rgb(var(--a-500))']

export function goalColor(index: number): string {
  return GOAL_COLORS[index % GOAL_COLORS.length]
}
