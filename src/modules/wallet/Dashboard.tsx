import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { LayoutDashboard } from 'lucide-react'
import { differenceInDays, format, parseISO } from 'date-fns'
import { useWallet } from '@/hooks/useWallet'
import { useWalletStore } from '@/stores/wallet.store'
import { useAppStore } from '@/stores/app.store'
import { formatMYR, monthRange, todayISO, dateRangePreset } from '@/lib/utils'
import { DateRangeControl, type DateRangeValue } from '@/components/ui/DateRangeControl'
import { EmptyState } from '@/components/ui/EmptyState'
import { Button } from '@/components/ui/Button'
import type { Transaction } from '@/types/wallet.types'

import {
  BASELINE_MONTHS,
  MIN_PROJECTION_DAYS,
  TREND_MONTHS,
  addDaysISO,
  baselineCurve,
  categoryDeltas,
  categoryDeltasBetween,
  categorySpend,
  committedSplit,
  committedSplitInRange,
  cumulativeByDay,
  cumulativeByDayOffset,
  daysBetween,
  dayOfMonth,
  daysInMonth,
  inRange,
  merchantSpend,
  merchantSpendInRange,
  MIN_AVERAGE_DAYS,
  monthBounds,
  monthKey,
  monthsSpanned,
  precedingRange,
  priorMonths,
  projectMonthEnd,
  shiftMonth,
  spendThroughDay,
  summarise,
  trailingMonthsEndingAt,
  usualMonthTotal,
  usualThroughDay,
  weekdayAverages,
  weekdayAveragesInRange,
} from './dashboard/insights'
import { SpendPace } from './dashboard/SpendPace'
import { StatTiles, type StatTile } from './dashboard/StatTiles'
import { WhatChanged } from './dashboard/WhatChanged'
import { CategoryBreakdown } from './dashboard/CategoryBreakdown'
import { WeekRhythm } from './dashboard/WeekRhythm'
import { CommittedSpend } from './dashboard/CommittedSpend'
import { BudgetPace } from './dashboard/BudgetPace'
import { MerchantTable } from './dashboard/MerchantTable'
import { DashboardCard } from './dashboard/DashboardCard'
import { SharedSummary } from './dashboard/SharedSummary'
import { UpcomingBills, type UpcomingBill } from './dashboard/UpcomingBills'
import { transactionsLink } from './dashboard/links'
import { ICON_MAP, ACCOUNT_TYPE_LABELS } from '@/lib/accountDisplay'
import { TransactionList } from './TransactionList'

/** Months of history behind the stat-tile sparklines, regardless of mode. */
const TILE_TREND_MONTHS = 12

// U-15: namespace dismissals per user so one account's dismissed reminders
// don't carry over to another on a shared home-network browser.
function dismissedKey(userId: string): string {
  return `daybook:dismissed_reminders:${userId || 'anon'}`
}

function getDismissed(userId: string): Set<string> {
  try {
    const raw = localStorage.getItem(dismissedKey(userId))
    return new Set(raw ? (JSON.parse(raw) as string[]) : [])
  } catch {
    return new Set()
  }
}

function saveDismissed(userId: string, ids: Set<string>) {
  localStorage.setItem(dismissedKey(userId), JSON.stringify(Array.from(ids)))
}

/** How many calendar months a date range touches — used to scale monthly budget limits and to describe the weekday panel's window in range mode. */
function calendarMonthSpan(dateFrom: string, dateTo: string): number {
  const fromKey = monthKey(dateFrom)
  const toKey = monthKey(dateTo)
  const from = new Date(Number(fromKey.slice(0, 4)), Number(fromKey.slice(5, 7)) - 1, 1)
  const to = new Date(Number(toKey.slice(0, 4)), Number(toKey.slice(5, 7)) - 1, 1)
  const months = (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth()) + 1
  return Math.max(1, months)
}

export function Dashboard() {
  const {
    loadTransactions,
    loadCategories,
    loadAccounts,
    loadRecurringTransactions,
    loadBudgets,
    loadGoals,
    getAccountBalances,
    accounts,
    categories,
    recurringTransactions,
    budgets,
    goals,
  } = useWallet()
  const userId = useAppStore((s) => s.user?.id ?? '')
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [range, setRange] = useState<DateRangeValue>(() => monthRange(0))
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(() => getDismissed(userId))
  const [balances, setBalances] = useState<Record<string, number> | null>(null)
  const dataVersion = useWalletStore((s) => s.dataVersion)

  const { dateFrom, dateTo } = range
  const preset = dateRangePreset(range)
  const isMonthMode = preset === 'this-month' || preset === 'last-month'
  const isAllTime = preset === 'all-time'

  // ── MONTH-MODE period — the original single-calendar-month model,
  // completely unchanged. "This month" / "Last month" keep exactly the
  // behaviour they had before ranges existed. ──
  const monthPeriod = useMemo(() => {
    if (!isMonthMode || !dateFrom) return null
    const month = monthKey(dateFrom)
    const length = daysInMonth(month)
    const today = todayISO()
    const isCurrentMonth = month === monthKey(today)
    const day = isCurrentMonth ? Math.min(dayOfMonth(today), length) : length
    return {
      month,
      length,
      day,
      inProgress: isCurrentMonth,
      label: format(parseISO(`${month}-01`), 'MMMM'),
      baselineMonths: priorMonths(month, BASELINE_MONTHS),
      trendMonths: trailingMonthsEndingAt(`${month}-01`, TREND_MONTHS),
    }
  }, [isMonthMode, dateFrom])

  useEffect(() => {
    loadAccounts()
    loadCategories()
    loadRecurringTransactions()
    loadBudgets()
    loadGoals()
    getAccountBalances().then(setBalances)
  }, [
    loadAccounts,
    loadCategories,
    loadRecurringTransactions,
    loadBudgets,
    loadGoals,
    getAccountBalances,
    dataVersion,
  ])

  // One wide fetch rather than one per panel. Month mode keeps its original
  // trailing-12-month window; range mode fetches enough to cover the
  // comparison window AND the trend lookback the merchant/committed panels
  // need, whichever starts earlier. All-time asks for everything.
  useEffect(() => {
    if (isMonthMode) {
      if (!dateFrom) return
      const month = monthKey(dateFrom)
      const from = monthBounds(shiftMonth(month, -(TILE_TREND_MONTHS - 1))).from
      const to = monthBounds(month).to
      loadTransactions({ dateFrom: from, dateTo: to }).then(setTransactions)
      return
    }
    if (isAllTime) {
      loadTransactions({ dateFrom: '', dateTo: '' }).then(setTransactions)
      return
    }
    if (!dateFrom || !dateTo || dateFrom > dateTo) return // custom, still mid-edit or inverted
    const comparison = precedingRange(dateFrom, dateTo)
    const trendStart = monthBounds(trailingMonthsEndingAt(dateTo, TREND_MONTHS)[0]).from
    const fetchFrom = comparison.dateFrom < trendStart ? comparison.dateFrom : trendStart
    loadTransactions({ dateFrom: fetchFrom, dateTo }).then(setTransactions)
  }, [isMonthMode, isAllTime, dateFrom, dateTo, loadTransactions, dataVersion])

  // ── RANGE-MODE period: Last 3/12 months, All time, Custom. ──
  const effectiveRange = useMemo(() => {
    if (isMonthMode) return null
    if (isAllTime) {
      // Resolved from the fetched data itself once it arrives, rather than
      // from the (empty) dateFrom the "all time" preset stores — that keeps
      // the fetch effect above free of a circular dependency on its own result.
      if (transactions.length === 0) return null
      const earliest = transactions.reduce((min, t) => (t.date < min ? t.date : min), transactions[0].date)
      return { dateFrom: earliest, dateTo: todayISO(), hasComparison: false }
    }
    if (!dateFrom || !dateTo || dateFrom > dateTo) return null
    return { dateFrom, dateTo, hasComparison: true }
  }, [isMonthMode, isAllTime, dateFrom, dateTo, transactions])

  const rangeComparison = useMemo(() => {
    if (!effectiveRange || !effectiveRange.hasComparison) return null
    return precedingRange(effectiveRange.dateFrom, effectiveRange.dateTo)
  }, [effectiveRange])

  const rangeTrendMonths = useMemo(() => {
    if (!effectiveRange) return []
    return trailingMonthsEndingAt(effectiveRange.dateTo, TREND_MONTHS)
  }, [effectiveRange])

  const rangeMonthSpan = useMemo(() => {
    if (!effectiveRange) return TREND_MONTHS
    return calendarMonthSpan(effectiveRange.dateFrom, effectiveRange.dateTo)
  }, [effectiveRange])

  const rangeLabel = useMemo(() => {
    if (!effectiveRange) return '…'
    if (isAllTime) return 'all time'
    return `${format(parseISO(effectiveRange.dateFrom), 'd MMM yyyy')} – ${format(
      parseISO(effectiveRange.dateTo),
      'd MMM yyyy',
    )}`
  }, [effectiveRange, isAllTime])

  // ── The selected period's own rows, and its comparison window's rows —
  // mode-agnostic from here on. Every panel below reads one or both of these
  // rather than re-deriving its own filter. ──
  const periodTxns = useMemo(() => {
    if (isMonthMode && monthPeriod) {
      return transactions.filter(
        (t) => monthKey(t.date) === monthPeriod.month && dayOfMonth(t.date) <= monthPeriod.day,
      )
    }
    if (effectiveRange) {
      return transactions.filter((t) => inRange(t.date, effectiveRange.dateFrom, effectiveRange.dateTo))
    }
    return []
  }, [transactions, isMonthMode, monthPeriod, effectiveRange])

  const comparisonTxns = useMemo(() => {
    if (!rangeComparison) return []
    return transactions.filter((t) => inRange(t.date, rangeComparison.dateFrom, rangeComparison.dateTo))
  }, [transactions, rangeComparison])

  const summary = useMemo(() => summarise(periodTxns), [periodTxns])

  const periodBounds = useMemo(() => {
    if (isMonthMode && monthPeriod) return monthBounds(monthPeriod.month)
    if (effectiveRange) return { from: effectiveRange.dateFrom, to: effectiveRange.dateTo }
    return { from: '', to: '' }
  }, [isMonthMode, monthPeriod, effectiveRange])

  // A comparison genuinely worth showing — there's a window AND it has some
  // spend in it, not just an empty stretch before the account existed.
  const hasBaseline = useMemo(() => {
    if (isMonthMode && monthPeriod) {
      return monthPeriod.baselineMonths.some((m) => spendThroughDay(transactions, m, daysInMonth(m)) > 0)
    }
    if (rangeComparison) {
      return summarise(comparisonTxns).expense > 0
    }
    return false
  }, [isMonthMode, monthPeriod, transactions, rangeComparison, comparisonTxns])

  // ── Hero / pace ──
  const pace = useMemo(() => {
    if (isMonthMode && monthPeriod) {
      return {
        curve: cumulativeByDay(transactions, monthPeriod.month, monthPeriod.day),
        baseline: baselineCurve(transactions, monthPeriod.baselineMonths, monthPeriod.length),
        usual: usualThroughDay(transactions, monthPeriod.baselineMonths, monthPeriod.day),
        comparisonTotal: usualMonthTotal(transactions, monthPeriod.baselineMonths),
        projected:
          monthPeriod.inProgress && monthPeriod.day >= MIN_PROJECTION_DAYS
            ? projectMonthEnd(summary.expense, monthPeriod.day, monthPeriod.length)
            : undefined,
      }
    }
    if (effectiveRange) {
      const usual = rangeComparison ? summarise(comparisonTxns).expense : 0
      return {
        curve: cumulativeByDayOffset(transactions, effectiveRange.dateFrom, effectiveRange.dateTo),
        baseline: rangeComparison
          ? cumulativeByDayOffset(transactions, rangeComparison.dateFrom, rangeComparison.dateTo)
          : [],
        usual,
        comparisonTotal: usual,
        projected: undefined,
      }
    }
    return { curve: [], baseline: [], usual: 0, comparisonTotal: 0, projected: undefined }
  }, [isMonthMode, monthPeriod, effectiveRange, rangeComparison, transactions, comparisonTxns, summary.expense])

  const spendPaceComparisonClause = isMonthMode && monthPeriod
    ? monthPeriod.inProgress
      ? `usual by day ${monthPeriod.day}`
      : 'your usual month'
    : 'the same length before this period'

  const spendPaceComparisonDescription = isMonthMode && monthPeriod
    ? `${monthPeriod.baselineMonths.length}-month average`
    : 'same length before'

  // A month-by-month rate only adds information once the period is long
  // enough that "per month" isn't a shaky extrapolation (see
  // MIN_AVERAGE_DAYS). Divides by the exact day count, not by how many
  // calendar months the range happens to touch — the latter is a step
  // function that lags a trailing window's own day-by-day growth and jumps
  // sharply on the day the window rolls past a month boundary, even for
  // perfectly steady spending.
  const spendPaceMonthsSpanned =
    !isMonthMode && effectiveRange && daysBetween(effectiveRange.dateFrom, effectiveRange.dateTo) >= MIN_AVERAGE_DAYS
      ? monthsSpanned(effectiveRange.dateFrom, effectiveRange.dateTo)
      : undefined

  const spendPaceFormatDay =
    !isMonthMode && effectiveRange
      ? (offset: number) => format(parseISO(addDaysISO(effectiveRange.dateFrom, offset)), 'd MMM')
      : undefined
  const spendPaceFormatDayTooltipLabel = !isMonthMode ? (label: string | number) => String(label) : undefined

  // ── What changed ──
  const deltas = useMemo(() => {
    if (isMonthMode && monthPeriod) {
      return categoryDeltas(transactions, categories, monthPeriod.month, monthPeriod.day, monthPeriod.baselineMonths)
    }
    if (effectiveRange) {
      return categoryDeltasBetween(periodTxns, effectiveRange.hasComparison ? comparisonTxns : null, categories)
    }
    return []
  }, [isMonthMode, monthPeriod, effectiveRange, transactions, categories, periodTxns, comparisonTxns])

  const netDelta = useMemo(() => {
    if (isMonthMode && monthPeriod) {
      return summary.expense - usualThroughDay(transactions, monthPeriod.baselineMonths, monthPeriod.day)
    }
    if (effectiveRange) {
      return summary.expense - (effectiveRange.hasComparison ? summarise(comparisonTxns).expense : 0)
    }
    return 0
  }, [isMonthMode, monthPeriod, effectiveRange, transactions, summary.expense, comparisonTxns])

  // The FULL window behind a What-changed row — from the start of the
  // earliest comparison period through the end of the current one. A link
  // scoped to only the current period would land on a total that matches
  // neither the delta shown nor the baseline it was compared against.
  const whatChangedBounds = useMemo(() => {
    if (isMonthMode && monthPeriod) {
      const earliestBaseline = monthPeriod.baselineMonths[0]
      const from = earliestBaseline ? monthBounds(earliestBaseline).from : monthBounds(monthPeriod.month).from
      return { from, to: monthBounds(monthPeriod.month).to }
    }
    if (effectiveRange) {
      const from =
        effectiveRange.hasComparison && rangeComparison ? rangeComparison.dateFrom : effectiveRange.dateFrom
      return { from, to: effectiveRange.dateTo }
    }
    return { from: '', to: '' }
  }, [isMonthMode, monthPeriod, effectiveRange, rangeComparison])

  const comparisonDescription = isMonthMode && monthPeriod
    ? monthPeriod.inProgress
      ? `its own ${monthPeriod.baselineMonths.length}-month average for the first ${monthPeriod.day} days of a month`
      : `its own ${monthPeriod.baselineMonths.length}-month average over a full month`
    : 'the same length immediately before it'

  const breakdown = useMemo(() => categorySpend(periodTxns, categories), [periodTxns, categories])

  const previousByCategory = useMemo(() => {
    if (isMonthMode && monthPeriod) {
      const prev = shiftMonth(monthPeriod.month, -1)
      const rows = categorySpend(
        transactions.filter((t) => monthKey(t.date) === prev && dayOfMonth(t.date) <= monthPeriod.day),
        categories,
      )
      return new Map(rows.map((r) => [r.id, r.amount]))
    }
    return new Map(categorySpend(comparisonTxns, categories).map((r) => [r.id, r.amount]))
  }, [isMonthMode, monthPeriod, transactions, categories, comparisonTxns])

  const weekday = useMemo(() => {
    if (isMonthMode && monthPeriod) {
      return weekdayAverages(transactions, priorMonths(monthPeriod.month, BASELINE_MONTHS))
    }
    if (effectiveRange) {
      return weekdayAveragesInRange(transactions, effectiveRange.dateFrom, effectiveRange.dateTo)
    }
    return new Array(7).fill(0)
  }, [isMonthMode, monthPeriod, effectiveRange, transactions])

  const committed = useMemo(() => {
    if (isMonthMode && monthPeriod) {
      return committedSplit(periodTxns, monthPeriod.month, recurringTransactions, monthPeriod.trendMonths, transactions)
    }
    if (effectiveRange) {
      return committedSplitInRange(
        transactions,
        effectiveRange.dateFrom,
        effectiveRange.dateTo,
        recurringTransactions,
        transactions,
        rangeTrendMonths,
      )
    }
    return { committed: 0, discretionary: 0, items: [] }
  }, [isMonthMode, monthPeriod, effectiveRange, periodTxns, transactions, recurringTransactions, rangeTrendMonths])

  const merchants = useMemo(() => {
    if (isMonthMode && monthPeriod) {
      return merchantSpend(transactions, monthPeriod.month, monthPeriod.trendMonths)
    }
    if (effectiveRange) {
      return merchantSpendInRange(transactions, effectiveRange.dateFrom, effectiveRange.dateTo, rangeTrendMonths)
    }
    return []
  }, [isMonthMode, monthPeriod, effectiveRange, transactions, rangeTrendMonths])

  // ── Budgets ──
  const budgetSpendingMap = useMemo(
    () => new Map(categorySpend(periodTxns, categories).map((r) => [r.id, r.amount])),
    [periodTxns, categories],
  )
  const budgetElapsed = isMonthMode && monthPeriod ? monthPeriod.day / monthPeriod.length : 1
  const budgetElapsedLabel = isMonthMode && monthPeriod ? `day ${monthPeriod.day} of ${monthPeriod.length}` : ''
  const budgetDaysLeft = isMonthMode && monthPeriod ? monthPeriod.length - monthPeriod.day : undefined

  // ── Stat tiles ───────────────────────────────────────────────────
  const tiles = useMemo((): StatTile[] => {
    const tileDateTo = isMonthMode && monthPeriod ? monthBounds(monthPeriod.month).to : (effectiveRange?.dateTo ?? todayISO())
    const tileMonths = trailingMonthsEndingAt(tileDateTo, TILE_TREND_MONTHS)

    const incomeTrend: number[] = []
    const netTrend: number[] = []
    const committedTrend: number[] = []
    const discretionaryTrend: number[] = []

    for (const m of tileMonths) {
      const rows = transactions.filter((t) => monthKey(t.date) === m)
      const s = summarise(rows)
      incomeTrend.push(s.income)
      netTrend.push(s.net)
      const split = committedSplit(
        rows,
        m,
        recurringTransactions,
        trailingMonthsEndingAt(`${m}-01`, TREND_MONTHS),
        transactions,
      )
      committedTrend.push(split.committed)
      discretionaryTrend.push(split.discretionary)
    }

    let usualNet = 0
    let usualDiscretionary = 0
    const periodLabel = isMonthMode && monthPeriod ? monthPeriod.label : rangeLabel

    if (isMonthMode && monthPeriod && monthPeriod.baselineMonths.length > 0) {
      const n = monthPeriod.baselineMonths.length
      usualNet =
        monthPeriod.baselineMonths.reduce((sum, m) => {
          const rows = transactions.filter((t) => monthKey(t.date) === m && dayOfMonth(t.date) <= monthPeriod.day)
          return sum + summarise(rows).net
        }, 0) / n
      usualDiscretionary =
        monthPeriod.baselineMonths.reduce((sum, m) => {
          const rows = transactions.filter((t) => monthKey(t.date) === m && dayOfMonth(t.date) <= monthPeriod.day)
          return (
            sum +
            committedSplit(rows, m, recurringTransactions, trailingMonthsEndingAt(`${m}-01`, TREND_MONTHS), transactions)
              .discretionary
          )
        }, 0) / n
    } else if (effectiveRange?.hasComparison) {
      usualNet = summarise(comparisonTxns).net
      // usualDiscretionary intentionally left 0 for range mode — falls back
      // to the generic "spending you chose in the moment" note below.
    }

    const total = committed.committed + committed.discretionary
    const committedShare = total > 0 ? Math.round((committed.committed / total) * 100) : 0
    const discretionaryDelta = committed.discretionary - usualDiscretionary
    const inProgress = isMonthMode && !!monthPeriod?.inProgress

    return [
      {
        label: 'Income',
        value: summary.income,
        note: inProgress ? `so far in ${periodLabel}` : `in ${periodLabel}`,
        trend: incomeTrend,
        testId: 'tile-income',
      },
      {
        label: inProgress ? 'Net so far' : 'Net',
        value: summary.net,
        signed: true,
        note: usualNet !== 0 ? `usually ${formatMYR(usualNet)} by now` : 'income minus spending',
        trend: netTrend,
        testId: 'tile-net',
      },
      {
        label: 'Committed',
        value: committed.committed,
        note: `${committedShare}% of spending`,
        trend: committedTrend,
        testId: 'tile-committed',
      },
      {
        label: 'Discretionary',
        value: committed.discretionary,
        note:
          usualDiscretionary > 0
            ? `${formatMYR(Math.abs(discretionaryDelta))} ${
                discretionaryDelta >= 0 ? 'above' : 'below'
              } usual`
            : 'spending you chose in the moment',
        trend: discretionaryTrend,
        testId: 'tile-discretionary',
      },
    ]
  }, [
    isMonthMode,
    monthPeriod,
    effectiveRange,
    rangeLabel,
    transactions,
    recurringTransactions,
    summary,
    committed,
    comparisonTxns,
  ])

  // ── Bill reminders ───────────────────────────────────────────────
  const upcomingBills = useMemo((): UpcomingBill[] => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    return recurringTransactions
      .filter((r) => {
        if (dismissedIds.has(r.id)) return false
        return differenceInDays(parseISO(r.nextDueDate), today) <= 7
      })
      .map((r) => ({ ...r, daysUntilDue: differenceInDays(parseISO(r.nextDueDate), today) }))
  }, [recurringTransactions, dismissedIds])

  const handleDismiss = (id: string) => {
    const next = new Set(dismissedIds)
    next.add(id)
    setDismissedIds(next)
    saveDismissed(userId, next)
  }

  // ── Hero / featured account / recent activity — selections over figures
  // already displayed elsewhere on the page, not new aggregations. ──
  const username = useAppStore((s) => s.user?.username ?? '')

  // Net worth is what YOU own — byte-identical to AccountsPage.tsx:46-51 and
  // WalletPage.tsx's own ownAccounts reduce (README invariant 3 / PR #101).
  const ownAccounts = useMemo(() => accounts.filter((a) => !a.isShared), [accounts])

  const netWorth = useMemo(
    () => (balances === null ? null : ownAccounts.reduce((sum, a) => sum + (balances[a.id] ?? 0), 0)),
    [ownAccounts, balances],
  )

  // Highest-balance own account. No default_account_id setting exists in this
  // codebase to reuse (Decision 5), so this selection rule is the one being
  // introduced. Ties broken by earlier createdAt, then id, so the pick is
  // deterministic.
  const featuredAccount = useMemo(() => {
    if (balances === null || ownAccounts.length === 0) return null
    return [...ownAccounts].sort((a, b) => {
      const d = (balances[b.id] ?? 0) - (balances[a.id] ?? 0)
      if (d !== 0) return d
      const c = a.createdAt.localeCompare(b.createdAt)
      return c !== 0 ? c : a.id.localeCompare(b.id)
    })[0]
  }, [ownAccounts, balances])

  // Most recent 5 rows of the period already scoped by the filter row above.
  const recentTxns = useMemo(
    () => [...periodTxns].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5),
    [periodTxns],
  )

  if (transactions.length === 0 && accounts.length === 0) {
    return (
      <div className="mx-auto max-w-5xl">
        <EmptyState
          icon={<LayoutDashboard className="h-12 w-12" />}
          title="No data yet"
          description="Add accounts and transactions to see your financial dashboard."
          action={
            <Link to="/wallet/accounts">
              <Button size="sm">Go to Accounts</Button>
            </Link>
          }
        />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-5xl">
      {/* One filter row, scoping every panel below it. Year-on-year history
          stays on Reports — a genuinely different lens (monthly bars, two
          calendar years side by side) the dashboard doesn't replicate. */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <DateRangeControl
          value={range}
          onChange={setRange}
          presets={['this-month', 'last-month', 'last-3-months', 'last-12-months', 'all-time', 'custom']}
        />
        <Link
          to="/wallet/reports"
          className="text-sm font-medium text-brand-600 hover:text-brand-700 hover:underline"
        >
          Year-on-year comparison →
        </Link>
      </div>

      <div className="dash">
        {/* Row A — hero + featured account */}
        <section className="hero c8" data-testid="overview-hero">
          <p className="hero-eyebrow">
            {isMonthMode && monthPeriod?.inProgress ? 'So far in' : 'In'}{' '}
            {isMonthMode && monthPeriod ? monthPeriod.label : rangeLabel}
          </p>
          <h2 className="hero-greeting">{username ? `Hi, ${username}` : 'Your money'}</h2>
          <div className="hero-body">
            <div className="hero-main">
              <div className="hero-figure-row">
                <span className="hero-figure" data-testid="hero-net-worth">
                  {netWorth === null ? '…' : formatMYR(netWorth)}
                </span>
                <span className="chip chip-glass">Net worth</span>
              </div>
              <p className="hero-eyebrow mt-2" data-testid="hero-account-count">
                across {ownAccounts.length} account{ownAccounts.length !== 1 ? 's' : ''}
              </p>
            </div>
            <div className="hero-stats">
              <div>
                <span className="hero-stat-k">Money in</span>
                <span className="hero-stat-v" data-testid="hero-money-in">{formatMYR(summary.income)}</span>
              </div>
              <div>
                <span className="hero-stat-k">Money out</span>
                <span className="hero-stat-v" data-testid="hero-money-out">{formatMYR(summary.expense)}</span>
              </div>
              <div>
                <span className="hero-stat-k">Kept</span>
                <span className="hero-stat-v" data-testid="hero-kept">
                  {summary.net > 0 ? '+' : ''}{formatMYR(summary.net)}
                </span>
              </div>
            </div>
          </div>
        </section>

        {balances === null ? (
          <div className="acct acct-feature c4" data-testid="featured-account">
            <p className="acct-bal">…</p>
          </div>
        ) : featuredAccount ? (
          <Link
            to={`/wallet?account=${featuredAccount.id}`}
            className="acct acct-feature c4"
            data-testid="featured-account"
          >
            <div className="acct-top">
              <div className="acct-mark">
                {(() => {
                  const FeaturedIcon = ICON_MAP[featuredAccount.icon] ?? ICON_MAP.wallet
                  return <FeaturedIcon className="h-5 w-5" />
                })()}
              </div>
              <div>
                <h3 className="acct-name">{featuredAccount.name}</h3>
                <span className="acct-sub">
                  {ACCOUNT_TYPE_LABELS[featuredAccount.type]} · {featuredAccount.currency}
                </span>
              </div>
            </div>
            <p className="acct-bal" data-testid="featured-account-balance">
              {formatMYR(balances[featuredAccount.id] ?? 0)}
            </p>
            <p className="acct-foot">
              <span>Largest balance</span>
              <span>Accounts →</span>
            </p>
          </Link>
        ) : (
          <Link to="/wallet/accounts" className="acct add c4">
            Add an account
          </Link>
        )}

        {/* Row B */}
        <UpcomingBills className="c4" bills={upcomingBills} onDismiss={handleDismiss} />
        <BudgetPace
          className="c4"
          budgets={budgets}
          spending={budgetSpendingMap}
          categories={categories}
          elapsed={budgetElapsed}
          elapsedLabel={budgetElapsedLabel}
          showPaceNotch={isMonthMode}
          limitMultiplier={isMonthMode ? 1 : rangeMonthSpan}
          daysLeft={budgetDaysLeft}
        />
        <SharedSummary className="c4" />

        {/* Row C */}
        <SpendPace
          className="c12"
          spent={summary.expense}
          usual={pace.usual}
          curve={pace.curve}
          baseline={pace.baseline}
          projected={pace.projected}
          comparisonTotal={pace.comparisonTotal}
          elapsedDays={isMonthMode && monthPeriod ? monthPeriod.day : pace.curve.length}
          periodLabel={isMonthMode && monthPeriod ? monthPeriod.label : rangeLabel}
          inProgress={isMonthMode && !!monthPeriod?.inProgress}
          comparisonCount={hasBaseline ? (isMonthMode && monthPeriod ? monthPeriod.baselineMonths.length : 1) : 0}
          comparisonDescription={spendPaceComparisonDescription}
          comparisonClause={spendPaceComparisonClause}
          monthsSpanned={spendPaceMonthsSpanned}
          formatDay={spendPaceFormatDay}
          formatDayTooltipLabel={spendPaceFormatDayTooltipLabel}
        />

        {/* Row C' — StatTiles keeps its own markup and mobile behaviour
            untouched (Decision 3); it is the one child kept in a wrapper. */}
        <div className="c12">
          <StatTiles tiles={tiles} />
        </div>

        {/* Row D */}
        {breakdown.length > 0 && (
          <CategoryBreakdown
            className="c6"
            rows={breakdown}
            previous={previousByCategory}
            total={summary.expense}
            dateFrom={periodBounds.from}
            dateTo={periodBounds.to}
          />
        )}
        <WeekRhythm className="c6" averages={weekday} months={isMonthMode ? BASELINE_MONTHS : rangeMonthSpan} />

        {/* Row E */}
        <DashboardCard
          className="c8"
          title="Recent activity"
          action={{
            label: 'See all',
            to: transactionsLink({ dateFrom: periodBounds.from, dateTo: periodBounds.to }),
          }}
        >
          <div data-testid="recent-activity">
            <TransactionList
              transactions={recentTxns}
              accounts={accounts}
              categories={categories}
              readOnly
              showDayTotals={false}
            />
          </div>
        </DashboardCard>
        <MerchantTable
          className="c4"
          rows={merchants}
          trendMonths={TREND_MONTHS}
          dateFrom={periodBounds.from}
          dateTo={periodBounds.to}
        />

        {/* Row F */}
        <CommittedSpend className={hasBaseline ? 'c6' : 'c12'} split={committed} />
        {hasBaseline && (
          <WhatChanged
            className="c6"
            rows={deltas}
            netDelta={netDelta}
            comparisonDescription={comparisonDescription}
            dateFrom={whatChangedBounds.from}
            dateTo={whatChangedBounds.to}
          />
        )}

        {/* Row G */}
        <DashboardCard
          className="c12"
          title="Goals"
          subtitle="Progress against target."
          action={{ label: 'Manage', to: '/wallet/goals' }}
        >
          {goals.length === 0 ? (
            <p className="py-6 text-center text-sm text-fg-subtle">No goals set yet.</p>
          ) : (
            <div data-testid="dashboard-goals">
              {goals.map((goal) => {
                const balance = balances?.[goal.accountId] ?? 0
                const saved = Math.max(0, Math.min(balance, goal.targetAmount))
                const percent = goal.targetAmount > 0 ? (saved / goal.targetAmount) * 100 : 0
                return (
                  <div
                    key={goal.id}
                    className="border-t border-line-subtle py-2.5 first:border-0 first:pt-0"
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="truncate text-[13px] font-medium text-fg">{goal.name}</span>
                      <span className="shrink-0 text-[11px] tabular-nums text-fg-subtle">
                        {formatMYR(saved)} of {formatMYR(goal.targetAmount)}
                      </span>
                    </div>
                    <div
                      className="mt-1.5 h-2 rounded-full bg-surface-hover"
                      role="img"
                      aria-label={`${goal.name}: ${Math.round(percent)}% of target saved.`}
                    >
                      <div
                        className="h-2 rounded-full bg-brand-500"
                        style={{ width: `${Math.min(100, percent)}%` }}
                      />
                    </div>
                    <p className="mt-1 text-[11px] text-fg-subtle">{Math.round(percent)}%</p>
                  </div>
                )
              })}
            </div>
          )}
        </DashboardCard>
      </div>
    </div>
  )
}
