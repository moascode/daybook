import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { LayoutDashboard } from 'lucide-react'
import { differenceInDays, format, parseISO } from 'date-fns'
import { useWallet } from '@/hooks/useWallet'
import { useWalletStore } from '@/stores/wallet.store'
import { useAppStore } from '@/stores/app.store'
import { formatMYR, monthRange, todayISO } from '@/lib/utils'
import { DateRangeControl, type DateRangeValue } from '@/components/ui/DateRangeControl'
import { EmptyState } from '@/components/ui/EmptyState'
import { Button } from '@/components/ui/Button'
import type { Transaction } from '@/types/wallet.types'

import {
  BASELINE_MONTHS,
  MIN_PROJECTION_DAYS,
  TREND_MONTHS,
  baselineCurve,
  categoryDeltas,
  categorySpend,
  committedSplit,
  cumulativeByDay,
  dayOfMonth,
  daysInMonth,
  merchantSpend,
  monthBounds,
  monthKey,
  priorMonths,
  projectMonthEnd,
  shiftMonth,
  spendThroughDay,
  summarise,
  usualMonthTotal,
  usualThroughDay,
  weekdayAverages,
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
import { UpcomingBills, type UpcomingBill } from './dashboard/UpcomingBills'

/** Months of history behind the stat-tile sparklines. */
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

export function Dashboard() {
  const {
    loadTransactions,
    loadCategories,
    loadAccounts,
    loadRecurringTransactions,
    loadBudgets,
    loadGoals,
    getBudgetSpending,
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
  const [budgetSpending, setBudgetSpending] = useState<Map<string, number>>(() => new Map())
  const [balances, setBalances] = useState<Record<string, number>>({})
  const dataVersion = useWalletStore((s) => s.dataVersion)

  const { dateFrom, dateTo } = range

  // ── Where in the month are we ────────────────────────────────────
  const period = useMemo(() => {
    const month = dateFrom ? monthKey(dateFrom) : monthKey(todayISO())
    const length = daysInMonth(month)
    const today = todayISO()
    const isCurrentMonth = month === monthKey(today)
    // A finished month is measured over all of itself; the month in progress
    // stops at today, and every baseline is cut to the same day, so both sides
    // of every comparison cover the same span. Measuring 18 days against 31
    // would report an improvement that isn't there.
    const day = isCurrentMonth ? Math.min(dayOfMonth(today), length) : length
    return {
      month,
      length,
      day,
      inProgress: isCurrentMonth,
      label: format(parseISO(`${month}-01`), 'MMMM'),
      baselineMonths: priorMonths(month, BASELINE_MONTHS),
      trendMonths: [...priorMonths(month, TREND_MONTHS - 1), month],
      tileMonths: [...priorMonths(month, TILE_TREND_MONTHS - 1), month],
    }
  }, [dateFrom])

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

  // One wide fetch rather than one per panel: the comparisons need a trailing
  // year, and at this app's volume that is a few hundred rows — cheaper in
  // round trips than asking the server to aggregate, and it keeps every panel
  // reading from exactly the same slice.
  useEffect(() => {
    if (!dateFrom || !dateTo) return
    const from = monthBounds(shiftMonth(period.month, -(TILE_TREND_MONTHS - 1))).from
    const to = monthBounds(period.month).to
    loadTransactions({ dateFrom: from, dateTo: to }).then(setTransactions)
  }, [dateFrom, dateTo, period.month, loadTransactions, dataVersion])

  useEffect(() => {
    getBudgetSpending(period.month)
      .then(setBudgetSpending)
      .catch(() => setBudgetSpending(new Map()))
  }, [getBudgetSpending, period.month, dataVersion])

  // ── The selected period's own rows ───────────────────────────────
  const periodTxns = useMemo(
    () =>
      transactions.filter(
        (t) => monthKey(t.date) === period.month && dayOfMonth(t.date) <= period.day,
      ),
    [transactions, period.month, period.day],
  )

  const summary = useMemo(() => summarise(periodTxns), [periodTxns])

  const pace = useMemo(() => {
    const curve = cumulativeByDay(transactions, period.month, period.day)
    const baseline = baselineCurve(transactions, period.baselineMonths, period.length)
    const usual = usualThroughDay(transactions, period.baselineMonths, period.day)
    return {
      curve,
      baseline,
      usual,
      monthAverage: usualMonthTotal(transactions, period.baselineMonths),
      projected:
        period.inProgress && period.day >= MIN_PROJECTION_DAYS
          ? projectMonthEnd(summary.expense, period.day, period.length)
          : undefined,
    }
  }, [transactions, period, summary.expense])

  const deltas = useMemo(
    () => categoryDeltas(transactions, categories, period.month, period.day, period.baselineMonths),
    [transactions, categories, period],
  )

  const breakdown = useMemo(() => categorySpend(periodTxns, categories), [periodTxns, categories])

  const previousByCategory = useMemo(() => {
    const prev = shiftMonth(period.month, -1)
    const rows = categorySpend(
      transactions.filter((t) => monthKey(t.date) === prev && dayOfMonth(t.date) <= period.day),
      categories,
    )
    return new Map(rows.map((r) => [r.id, r.amount]))
  }, [transactions, categories, period.month, period.day])

  const weekday = useMemo(
    () => weekdayAverages(transactions, priorMonths(period.month, BASELINE_MONTHS)),
    [transactions, period.month],
  )

  const committed = useMemo(
    () =>
      committedSplit(
        periodTxns,
        period.month,
        recurringTransactions,
        period.trendMonths,
        transactions,
      ),
    [periodTxns, transactions, period.month, period.trendMonths, recurringTransactions],
  )

  const merchants = useMemo(
    () => merchantSpend(transactions, period.month, period.trendMonths),
    [transactions, period.month, period.trendMonths],
  )

  // ── Stat tiles ───────────────────────────────────────────────────
  const tiles = useMemo((): StatTile[] => {
    const incomeTrend: number[] = []
    const netTrend: number[] = []
    const committedTrend: number[] = []
    const discretionaryTrend: number[] = []

    for (const m of period.tileMonths) {
      const rows = transactions.filter((t) => monthKey(t.date) === m)
      const s = summarise(rows)
      incomeTrend.push(s.income)
      netTrend.push(s.net)
      const split = committedSplit(
        rows,
        m,
        recurringTransactions,
        [...priorMonths(m, TREND_MONTHS - 1), m],
        transactions,
      )
      committedTrend.push(split.committed)
      discretionaryTrend.push(split.discretionary)
    }

    const baselineAvg = (pick: (rows: Transaction[], month: string) => number): number => {
      if (period.baselineMonths.length === 0) return 0
      const total = period.baselineMonths.reduce((sum, m) => {
        const rows = transactions.filter(
          (t) => monthKey(t.date) === m && dayOfMonth(t.date) <= period.day,
        )
        return sum + pick(rows, m)
      }, 0)
      return total / period.baselineMonths.length
    }

    const usualNet = baselineAvg((rows) => summarise(rows).net)
    const usualDiscretionary = baselineAvg(
      (rows, m) =>
        committedSplit(
          rows,
          m,
          recurringTransactions,
          [...priorMonths(m, TREND_MONTHS - 1), m],
          transactions,
        ).discretionary,
    )

    const total = committed.committed + committed.discretionary
    const committedShare = total > 0 ? Math.round((committed.committed / total) * 100) : 0
    const discretionaryDelta = committed.discretionary - usualDiscretionary

    return [
      {
        label: 'Income',
        value: summary.income,
        note: period.inProgress ? `so far in ${period.label}` : `in ${period.label}`,
        trend: incomeTrend,
        testId: 'tile-income',
      },
      {
        label: period.inProgress ? 'Net so far' : 'Net',
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
  }, [transactions, period, recurringTransactions, summary, committed])

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

  const netDelta = useMemo(
    () => summary.expense - usualThroughDay(transactions, period.baselineMonths, period.day),
    [summary.expense, transactions, period],
  )

  // Comparison panels only mean something once there is history to compare
  // against. A brand-new user gets the totals and the breakdown, and the
  // baseline appears on its own after their first full month.
  const hasBaseline = useMemo(
    () => period.baselineMonths.some((m) => spendThroughDay(transactions, m, daysInMonth(m)) > 0),
    [transactions, period.baselineMonths],
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

  const bounds = monthBounds(period.month)
  const dayLabel = period.inProgress
    ? `for the first ${period.day} days of a month`
    : 'over a full month'

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex flex-col gap-4">
        {/* One filter row, scoping every panel below it. Custom ranges and
            year-on-year history stay on Reports so the two pages don't
            duplicate each other. */}
        <div className="flex items-center justify-between gap-3">
          <DateRangeControl
            value={range}
            onChange={setRange}
            presets={['this-month', 'last-month']}
          />
          <Link
            to="/wallet/reports"
            className="text-sm font-medium text-brand-600 hover:text-brand-700 hover:underline"
          >
            Custom range &amp; history →
          </Link>
        </div>

        <SpendPace
          spent={summary.expense}
          usual={pace.usual}
          curve={pace.curve}
          baseline={pace.baseline}
          projected={pace.projected}
          usualMonthTotal={pace.monthAverage}
          day={period.day}
          monthLabel={period.label}
          inProgress={period.inProgress}
          baselineMonths={hasBaseline ? period.baselineMonths.length : 0}
        />

        <StatTiles tiles={tiles} />

        <UpcomingBills bills={upcomingBills} onDismiss={handleDismiss} />

        {hasBaseline && (
          <WhatChanged
            rows={deltas}
            netDelta={netDelta}
            baselineMonths={period.baselineMonths.length}
            dateFrom={bounds.from}
            dateTo={bounds.to}
            dayLabel={dayLabel}
          />
        )}

        <div className="grid gap-4 lg:grid-cols-2">
          {breakdown.length > 0 && (
            <CategoryBreakdown
              rows={breakdown}
              previous={previousByCategory}
              total={summary.expense}
              dateFrom={bounds.from}
              dateTo={bounds.to}
            />
          )}
          <WeekRhythm averages={weekday} months={BASELINE_MONTHS} />
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <CommittedSpend split={committed} />
          <BudgetPace
            budgets={budgets}
            spending={budgetSpending}
            categories={categories}
            elapsed={period.day / period.length}
            elapsedLabel={`day ${period.day} of ${period.length}`}
          />
        </div>

        <MerchantTable rows={merchants} trendMonths={TREND_MONTHS} />

        {goals.length > 0 && (
          <DashboardCard
            title="Goals"
            subtitle="Progress against target."
            action={{ label: 'Manage', to: '/wallet/goals' }}
          >
            <div data-testid="dashboard-goals">
              {goals.map((goal) => {
                const balance = balances[goal.accountId] ?? 0
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
          </DashboardCard>
        )}
      </div>
    </div>
  )
}
