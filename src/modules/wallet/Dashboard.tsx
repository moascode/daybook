import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { LayoutDashboard } from 'lucide-react'
import { differenceInDays, format, parseISO } from 'date-fns'
import { useWallet } from '@/hooks/useWallet'
import { useWalletStore } from '@/stores/wallet.store'
import { useAppStore } from '@/stores/app.store'
import { useToastStore } from '@/stores/toast.store'
import { useCrudModal } from '@/hooks/useCrudModal'
import { formatMYR, monthRange, trailingRange, todayISO, dateRangePreset, errorMessage } from '@/lib/utils'
import type { DateRangeValue } from '@/components/ui/DateRangeControl'
import { EmptyState } from '@/components/ui/EmptyState'
import { Button } from '@/components/ui/Button'
import { Composer } from '@/modules/wallet/composer/Composer'
import type { ComposerPreviewDraft } from '@/modules/wallet/composer/ComposerPreview'
import { TransactionForm, type TransactionFormData } from '@/modules/wallet/TransactionForm'
import type { Transaction } from '@/types/wallet.types'

import {
  BASELINE_MONTHS,
  MIN_PROJECTION_DAYS,
  TREND_MONTHS,
  addDaysISO,
  baselineCurve,
  categorySpend,
  cumulativeByDay,
  cumulativeByDayOffset,
  dayOfMonth,
  daysInMonth,
  inRange,
  lastNDaysSpend,
  merchantSpend,
  merchantSpendInRange,
  monthBounds,
  monthKey,
  precedingRange,
  priorMonths,
  projectMonthEnd,
  safeToSpend,
  shiftMonth,
  spendThroughDay,
  summarise,
  trailingMonthsEndingAt,
  UPCOMING_BILLS_WINDOW_DAYS,
  usualMonthTotal,
  usualThroughDay,
} from './dashboard/insights'
import { SpendPace } from './dashboard/SpendPace'
import { CategoryBreakdown } from './dashboard/CategoryBreakdown'
import { WeekRhythm } from './dashboard/WeekRhythm'
import { BudgetPace } from './dashboard/BudgetPace'
import { MerchantTable } from './dashboard/MerchantTable'
import { DashboardCard } from './dashboard/DashboardCard'
import { SharedSummary } from './dashboard/SharedSummary'
import { UpcomingBills, type UpcomingBill } from './dashboard/UpcomingBills'
import { transactionsLink } from './dashboard/links'
import { ICON_MAP, ACCOUNT_TYPE_LABELS } from '@/lib/accountDisplay'
import { TransactionList } from './TransactionList'

/** How many calendar months a date range touches — used to scale monthly budget limits. */
function calendarMonthSpan(dateFrom: string, dateTo: string): number {
  const fromKey = monthKey(dateFrom)
  const toKey = monthKey(dateTo)
  const from = new Date(Number(fromKey.slice(0, 4)), Number(fromKey.slice(5, 7)) - 1, 1)
  const to = new Date(Number(toKey.slice(0, 4)), Number(toKey.slice(5, 7)) - 1, 1)
  const months = (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth()) + 1
  return Math.max(1, months)
}

/** "Good morning/afternoon/evening" — reads the host's local clock. */
function timeOfDayGreeting(hour: number): string {
  if (hour >= 5 && hour < 12) return 'Good morning'
  if (hour >= 12 && hour < 17) return 'Good afternoon'
  return 'Good evening'
}

export function Dashboard() {
  const {
    loadTransactions,
    loadCategories,
    loadAccounts,
    loadRecurringTransactions,
    loadBudgets,
    getAccountBalances,
    addTransaction,
    loadTags,
    accounts,
    categories,
    recurringTransactions,
    budgets,
  } = useWallet()
  const username = useAppStore((s) => s.user?.username ?? '')
  const hasAnthropicKey = useAppStore((s) => s.hasAnthropicKey)
  const { addToast } = useToastStore()
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [range, setRange] = useState<DateRangeValue>(() => monthRange(0))
  const [balances, setBalances] = useState<Record<string, number> | null>(null)
  const [tags, setTags] = useState<string[]>([])
  const dataVersion = useWalletStore((s) => s.dataVersion)

  const crud = useCrudModal<Transaction>()
  const composerInputRef = useRef<HTMLInputElement>(null)
  const [composerDraft, setComposerDraft] = useState<Partial<TransactionFormData> | null>(null)

  const { dateFrom, dateTo } = range
  const preset = dateRangePreset(range)
  const isMonthMode = preset === 'this-month' || preset === 'last-month'
  const isAllTime = preset === 'all-time'

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
    loadTags().then(setTags)
    getAccountBalances().then(setBalances)
  }, [loadAccounts, loadCategories, loadRecurringTransactions, loadBudgets, loadTags, getAccountBalances, dataVersion])

  useEffect(() => {
    if (isMonthMode) {
      if (!dateFrom) return
      const month = monthKey(dateFrom)
      const from = monthBounds(shiftMonth(month, -(TREND_MONTHS - 1))).from
      const to = monthBounds(month).to
      loadTransactions({ dateFrom: from, dateTo: to }).then(setTransactions)
      return
    }
    if (isAllTime) {
      loadTransactions({ dateFrom: '', dateTo: '' }).then(setTransactions)
      return
    }
    if (!dateFrom || !dateTo || dateFrom > dateTo) return
    const comparison = precedingRange(dateFrom, dateTo)
    const trendStart = monthBounds(trailingMonthsEndingAt(dateTo, TREND_MONTHS)[0]).from
    const fetchFrom = comparison.dateFrom < trendStart ? comparison.dateFrom : trendStart
    loadTransactions({ dateFrom: fetchFrom, dateTo }).then(setTransactions)
  }, [isMonthMode, isAllTime, dateFrom, dateTo, loadTransactions, dataVersion])

  const effectiveRange = useMemo(() => {
    if (isMonthMode) return null
    if (isAllTime) {
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
    return `${format(parseISO(effectiveRange.dateFrom), 'd MMM yyyy')} – ${format(parseISO(effectiveRange.dateTo), 'd MMM yyyy')}`
  }, [effectiveRange, isAllTime])

  const periodTxns = useMemo(() => {
    if (isMonthMode && monthPeriod) {
      return transactions.filter((t) => monthKey(t.date) === monthPeriod.month && dayOfMonth(t.date) <= monthPeriod.day)
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

  const hasBaseline = useMemo(() => {
    if (isMonthMode && monthPeriod) {
      return monthPeriod.baselineMonths.some((m) => spendThroughDay(transactions, m, daysInMonth(m)) > 0)
    }
    if (rangeComparison) return summarise(comparisonTxns).expense > 0
    return false
  }, [isMonthMode, monthPeriod, transactions, rangeComparison, comparisonTxns])

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
        baseline: rangeComparison ? cumulativeByDayOffset(transactions, rangeComparison.dateFrom, rangeComparison.dateTo) : [],
        usual,
        comparisonTotal: usual,
        projected: undefined,
      }
    }
    return { curve: [], baseline: [], usual: 0, comparisonTotal: 0, projected: undefined }
  }, [isMonthMode, monthPeriod, effectiveRange, rangeComparison, transactions, comparisonTxns, summary.expense])

  const spendPaceComparisonClause = isMonthMode && monthPeriod
    ? monthPeriod.inProgress ? `usual by day ${monthPeriod.day}` : 'your usual month'
    : 'the same length before this period'
  const spendPaceComparisonDescription = isMonthMode && monthPeriod
    ? `${monthPeriod.baselineMonths.length}-month average`
    : 'same length before'
  const spendPaceFormatDay = !isMonthMode && effectiveRange
    ? (offset: number) => format(parseISO(addDaysISO(effectiveRange.dateFrom, offset)), 'd MMM')
    : undefined

  const breakdown = useMemo(() => categorySpend(periodTxns, categories), [periodTxns, categories])

  // Week rhythm is anchored to the real "today", independent of the selected
  // period filter — the mockup's card is always "the last 7 days", not scoped
  // to whatever range is being browsed.
  const last7Days = useMemo(() => lastNDaysSpend(transactions, todayISO(), 7), [transactions])

  const merchants = useMemo(() => {
    if (isMonthMode && monthPeriod) return merchantSpend(transactions, monthPeriod.month, monthPeriod.trendMonths)
    if (effectiveRange) return merchantSpendInRange(transactions, effectiveRange.dateFrom, effectiveRange.dateTo, rangeTrendMonths)
    return []
  }, [isMonthMode, monthPeriod, effectiveRange, transactions, rangeTrendMonths])

  const budgetSpendingMap = useMemo(
    () => new Map(categorySpend(periodTxns, categories).map((r) => [r.id, r.amount])),
    [periodTxns, categories],
  )
  const budgetElapsed = isMonthMode && monthPeriod ? monthPeriod.day / monthPeriod.length : 1

  const upcomingBills = useMemo((): UpcomingBill[] => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    return recurringTransactions
      .filter((r) => r.type === 'expense' && differenceInDays(parseISO(r.nextDueDate), today) <= UPCOMING_BILLS_WINDOW_DAYS)
      .map((r) => ({ ...r, daysUntilDue: differenceInDays(parseISO(r.nextDueDate), today) }))
  }, [recurringTransactions])

  const ownAccounts = useMemo(() => accounts.filter((a) => !a.isShared), [accounts])

  const netWorth = useMemo(
    () => (balances === null ? null : ownAccounts.reduce((sum, a) => sum + (balances[a.id] ?? 0), 0)),
    [ownAccounts, balances],
  )

  // The chip next to the hero figure — net worth's own change this period, as
  // a % of what it started the period at. Not literally "vs last month" (that
  // would need a stored historical balance we don't have); this is the honest
  // equivalent computable from what's on screen already.
  const netWorthChangePct = useMemo(() => {
    if (netWorth === null) return null
    const startingNetWorth = netWorth - summary.net
    if (Math.abs(startingNetWorth) < 0.005) return null
    return (summary.net / startingNetWorth) * 100
  }, [netWorth, summary.net])

  const featuredAccount = useMemo(() => {
    if (balances === null || ownAccounts.length === 0) return null
    return [...ownAccounts].sort((a, b) => {
      const d = (balances[b.id] ?? 0) - (balances[a.id] ?? 0)
      if (d !== 0) return d
      const c = a.createdAt.localeCompare(b.createdAt)
      return c !== 0 ? c : a.id.localeCompare(b.id)
    })[0]
  }, [ownAccounts, balances])

  const featuredSafeToSpend = useMemo(() => {
    if (balances === null || !featuredAccount) return null
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    return safeToSpend(balances[featuredAccount.id] ?? 0, featuredAccount.id, recurringTransactions, today, new Set())
  }, [balances, featuredAccount, recurringTransactions])

  const recentTxns = useMemo(() => [...periodTxns].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5), [periodTxns])

  // Same baseline-months-average NET used to be the Discretionary tile's
  // "usual" figure before that row was dropped — kept here as the one place
  // that still needs it, day-matched against the baseline months so a 4-day-
  // old month is never compared against a full one.
  const usualNet = useMemo(() => {
    if (isMonthMode && monthPeriod && monthPeriod.baselineMonths.length > 0) {
      const n = monthPeriod.baselineMonths.length
      return (
        monthPeriod.baselineMonths.reduce((sum, m) => {
          const rows = transactions.filter((t) => monthKey(t.date) === m && dayOfMonth(t.date) <= monthPeriod.day)
          return sum + summarise(rows).net
        }, 0) / n
      )
    }
    if (rangeComparison) return summarise(comparisonTxns).net
    return 0
  }, [isMonthMode, monthPeriod, transactions, rangeComparison, comparisonTxns])

  // Matches the mockup's dynamic hero ("Good afternoon 👋 — you're $1,012
  // ahead of last month"). Says "usual" — a baseline-months average — rather
  // than claiming a specific past period, since that's the same figure the
  // rest of the page already uses (CLAUDE.md dashboard rules on agreement).
  const heroGreeting = useMemo(() => {
    const greeting = timeOfDayGreeting(new Date().getHours())
    const who = username ? `, ${username}` : ''
    const base = `${greeting}${who} 👋`
    if (!hasBaseline || usualNet === 0) return base
    const delta = summary.net - usualNet
    if (Math.abs(delta) < 0.005) return base
    return delta > 0
      ? `${base} — you're ${formatMYR(delta)} ahead of usual`
      : `${base} — you're ${formatMYR(Math.abs(delta))} behind usual`
  }, [username, hasBaseline, usualNet, summary.net])

  // ── Composer / add-transaction plumbing — mirrors WalletPage.tsx's wiring
  // so the Overview page's composer bar behaves identically. ──
  const handleAddTransaction = useCallback(async (data: TransactionFormData) => {
    try {
      await addTransaction(data)
    } catch (err) {
      addToast({ message: errorMessage(err, 'Could not save transaction — please try again.'), duration: 4000 })
      throw err
    }
    await getAccountBalances().then(setBalances)
  }, [addTransaction, addToast, getAccountBalances])

  const openComposerForm = useCallback((initialDraft?: Partial<TransactionFormData>) => {
    setComposerDraft(initialDraft ?? null)
    crud.openCreate()
  }, [crud])

  const handleComposerConfirm = useCallback(async (draft: ComposerPreviewDraft) => {
    await handleAddTransaction({ ...draft, description: '', tags: [] })
  }, [handleAddTransaction])

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

  const headerSub = isMonthMode && monthPeriod
    ? monthPeriod.inProgress
      ? `Wallet · 1–${monthPeriod.day} ${monthPeriod.label}`
      : `Wallet · ${monthPeriod.label}`
    : `Wallet · ${rangeLabel}`

  return (
    <div className="mx-auto max-w-5xl">
      <div className="page-head">
        <h1 className="page-title">Overview</h1>
        <span className="page-sub hide-mobile">{headerSub}</span>
        <div className="page-actions">
          <div className="segment" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={preset !== 'last-12-months'}
              onClick={() => setRange(monthRange(0))}
            >
              Month
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={preset === 'last-12-months'}
              onClick={() => setRange(trailingRange(12))}
            >
              Year
            </button>
          </div>
        </div>
      </div>

      {accounts.length > 0 && (
        <div className="mb-4">
          <Composer
            ref={composerInputRef}
            accounts={ownAccounts}
            categories={categories}
            activeAccountId={featuredAccount?.id ?? null}
            hasAnthropicKey={hasAnthropicKey}
            onConfirm={handleComposerConfirm}
            onOpenBlankForm={openComposerForm}
          />
        </div>
      )}

      <div className="dash">
        {/* Row A — hero + featured account */}
        <section className="hero c8" data-testid="overview-hero">
          <p className="hero-eyebrow">Household net worth</p>
          <h2 className="hero-greeting" data-testid="hero-greeting">
            {heroGreeting}
          </h2>
          <div className="hero-body">
            <div className="hero-main">
              <p className="hero-eyebrow" style={{ color: 'rgb(255 255 255 / .72)' }}>
                Total net worth
              </p>
              <div className="hero-figure-row" style={{ marginTop: 'var(--s1)' }}>
                <span className="hero-figure" data-testid="hero-net-worth">
                  {netWorth === null ? '…' : formatMYR(netWorth)}
                </span>
                {netWorthChangePct !== null && (
                  <span className="chip chip-glass">
                    {netWorthChangePct >= 0 ? '↑' : '↓'} {Math.abs(netWorthChangePct).toFixed(1)}% this period
                  </span>
                )}
              </div>
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
          <section className="acct acct-feature c4" data-testid="featured-account" style={{ gap: 'var(--s4)' }}>
            <Link to={`/wallet?account=${featuredAccount.id}`} className="acct-top">
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
            </Link>
            <div>
              <p className="acct-bal" data-testid="featured-account-balance" style={{ fontSize: 'var(--t-2xl)' }}>
                {formatMYR(balances[featuredAccount.id] ?? 0)}
              </p>
              {featuredSafeToSpend && featuredSafeToSpend.bills > 0 && (
                <p className="acct-sub" style={{ marginTop: 'var(--s1)' }} data-testid="featured-account-safe-to-spend">
                  {featuredSafeToSpend.safe >= 0
                    ? `${formatMYR(featuredSafeToSpend.safe)} safe to spend after ${formatMYR(featuredSafeToSpend.bills)} of bills`
                    : `${formatMYR(Math.abs(featuredSafeToSpend.safe))} short of covering ${formatMYR(featuredSafeToSpend.bills)} of upcoming bills`}
                </p>
              )}
            </div>
            <div style={{ display: 'flex', gap: 'var(--s2)', marginTop: 'auto' }}>
              <button
                type="button"
                className="btn"
                style={{ flex: 1, background: 'rgb(255 255 255 / .14)', color: '#fff' }}
                onClick={() => openComposerForm({ type: 'transfer', accountId: featuredAccount.id })}
              >
                Transfer
              </button>
              <Link
                to="/wallet/accounts"
                className="btn"
                style={{ flex: 1, background: 'rgb(255 255 255 / .14)', color: '#fff', textAlign: 'center' }}
              >
                All accounts
              </Link>
            </div>
          </section>
        ) : (
          <Link to="/wallet/accounts" className="acct add c4">
            Add an account
          </Link>
        )}

        {/* Row B */}
        <UpcomingBills className="c4" bills={upcomingBills} />
        <BudgetPace
          className="c4"
          budgets={budgets}
          spending={budgetSpendingMap}
          categories={categories}
          elapsed={budgetElapsed}
          day={monthPeriod?.day}
          periodStart={periodBounds.from}
          showPaceNotch={isMonthMode}
          limitMultiplier={isMonthMode ? 1 : rangeMonthSpan}
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
          formatDay={spendPaceFormatDay}
        />

        {/* Row D */}
        {breakdown.length > 0 && <CategoryBreakdown className="c6" rows={breakdown} total={summary.expense} />}
        <WeekRhythm className="c6" days={last7Days} />

        {/* Row E */}
        <DashboardCard
          className="c8"
          title="Recent activity"
          action={{ label: 'All transactions', to: transactionsLink({ dateFrom: periodBounds.from, dateTo: periodBounds.to }) }}
        >
          <div data-testid="recent-activity">
            <TransactionList transactions={recentTxns} accounts={accounts} categories={categories} readOnly showDayTotals={false} />
          </div>
        </DashboardCard>
        <MerchantTable className="c4" rows={merchants} />
      </div>

      <TransactionForm
        open={crud.formOpen}
        onOpenChange={(open) => { crud.closeForm(open); if (!open) setComposerDraft(null) }}
        transaction={crud.editingItem}
        accounts={accounts}
        categories={categories}
        defaultAccountId={featuredAccount?.id}
        availableTags={tags}
        initialDraft={composerDraft ?? undefined}
        onSubmit={handleAddTransaction}
      />
    </div>
  )
}
