import { useState, useEffect, useCallback, useMemo } from 'react'
import { Download, BarChart2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { useWallet, mapTransaction, type TransactionRow } from '@/hooks/useWallet'
import { api } from '@/lib/api'
import { useToastStore } from '@/stores/toast.store'
import { errorMessage, todayISO } from '@/lib/utils'
import { ExportModal } from '@/modules/wallet/ExportModal'
import { ReportsStats } from '@/modules/wallet/reports/ReportsStats'
import { IncomeVsSpendingChart } from '@/modules/wallet/reports/IncomeVsSpendingChart'
import { SavingsRateCard } from '@/modules/wallet/reports/SavingsRateCard'
import { WhatChanged } from '@/modules/wallet/reports/WhatChanged'
import { CashFlowTable } from '@/modules/wallet/reports/CashFlowTable'
import { CategoryTrends } from '@/modules/wallet/reports/CategoryTrends'
import {
  anchorMonth, earliestMonth, windowMonths, windowRangeLabel, windowPhrase,
  monthlyTotals, pickSeries, sum, average, trendGrowth,
  gapSentenceParts, savingsRate, savingsRateSeries, weakestMonths, savingsSentence, topOverBaselineCategory,
  baselineMonths, categoryBaseline, categorySpendByMonthMap, categoryLabelInfo,
  whatChangedRows, cashFlowRows, totalKept, categoryTrendRows, netWorthChange,
  MIN_BASELINE_MONTHS,
  type PeriodSegment, type TrendMeasure,
} from '@/modules/wallet/reports/insights'
import type { Transaction } from '@/types/wallet.types'

const SEGMENTS: { value: PeriodSegment; label: string }[] = [
  { value: '3m', label: '3m' },
  { value: '6m', label: '6m' },
  { value: '12m', label: '12m' },
  { value: 'all', label: 'All' },
]

const CHART_MAX_MONTHS = 12

export function ReportsPage() {
  const { accounts, categories, loadAccounts, loadCategories, exportTransactions } = useWallet()
  const { addToast } = useToastStore()

  const [segment, setSegment] = useState<PeriodSegment>('12m')
  const [measure, setMeasure] = useState<TrendMeasure>('amount')
  const [allTxns, setAllTxns] = useState<Transaction[] | null>(null)
  const [accountsLoaded, setAccountsLoaded] = useState(false)
  const [txnsFailed, setTxnsFailed] = useState(false)
  const [accountsFailed, setAccountsFailed] = useState(false)
  const [categoriesFailed, setCategoriesFailed] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)

  // Any of the three page-local loads failing is reported as one error state
  // (CLAUDE.md §10 "never fail silently") — Retry re-runs all three.
  const loadFailed = txnsFailed || accountsFailed || categoriesFailed
  // Both accounts (for `ownAccountIds`) and transactions must have resolved
  // before `isEmpty`/the dashboard can be computed honestly — otherwise a
  // cold load reads "no data" off an accounts array that just hasn't arrived
  // yet and flashes the empty state before the real one.
  const dataReady = accountsLoaded && allTxns !== null

  const today = todayISO()

  // One page-local fetch, no date bounds — net worth needs the full history,
  // same reasoning as Goals'/Recurring's own page-local fetch (CLAUDE.md
  // §6 "server write first" pattern doesn't apply here: this is a read).
  // NOT routed through `useWallet().loadTransactions` — see FEAT-070 spec's
  // "Data loading" acceptance criterion.
  const reloadTxns = useCallback(() => {
    api.get<TransactionRow[]>('/transactions')
      .then((rows) => {
        setAllTxns(rows.map(mapTransaction))
        setTxnsFailed(false)
      })
      .catch((err) => {
        setAllTxns(null)
        setTxnsFailed(true)
        addToast({ message: errorMessage(err, 'Could not load transaction history — Reports is unavailable.'), duration: 4000 })
      })
  }, [addToast])

  const reloadAccounts = useCallback(() => {
    loadAccounts()
      .then(() => {
        setAccountsLoaded(true)
        setAccountsFailed(false)
      })
      .catch((err) => {
        setAccountsLoaded(false)
        setAccountsFailed(true)
        addToast({ message: errorMessage(err, 'Could not load accounts — Reports is unavailable.'), duration: 4000 })
      })
  }, [loadAccounts, addToast])

  const reloadCategories = useCallback(() => {
    loadCategories()
      .then(() => setCategoriesFailed(false))
      .catch((err) => {
        setCategoriesFailed(true)
        addToast({ message: errorMessage(err, 'Could not load categories — Reports is unavailable.'), duration: 4000 })
      })
  }, [loadCategories, addToast])

  const reloadAll = useCallback(() => {
    reloadAccounts()
    reloadCategories()
    reloadTxns()
  }, [reloadAccounts, reloadCategories, reloadTxns])

  useEffect(() => {
    reloadAll()
  }, [reloadAll])

  // §3: own accounts only, never the whole GET /api/accounts array.
  const ownAccounts = useMemo(() => accounts.filter((a) => !a.isShared), [accounts])
  const ownAccountIds = useMemo(() => new Set(ownAccounts.map((a) => a.id)), [ownAccounts])

  // Full own-account ledger (incl. transfers) — needed by `netWorthChange`'s
  // `accountBalanceAsOf` reconstruction. `ownTxns` below additionally drops
  // transfers for every income/expense/category figure.
  const ownAccountTxnsAll = useMemo(
    () => (allTxns ?? []).filter((t) => ownAccountIds.has(t.accountId) || (t.destinationAccountId && ownAccountIds.has(t.destinationAccountId))),
    [allTxns, ownAccountIds],
  )
  const ownTxns = useMemo(
    () => ownAccountTxnsAll.filter((t) => ownAccountIds.has(t.accountId) && t.type !== 'transfer'),
    [ownAccountTxnsAll, ownAccountIds],
  )

  const anchor = anchorMonth(today)
  const earliest = useMemo(() => earliestMonth(ownAccountTxnsAll), [ownAccountTxnsAll])

  const isEmpty = dataReady && (earliest === null || earliest > anchor)

  const months = useMemo(() => (earliest ? windowMonths(anchor, segment, earliest) : []), [anchor, segment, earliest])
  const windowLabel = useMemo(() => (months.length > 0 ? windowRangeLabel(months) : ''), [months])
  const segmentPhrase = windowPhrase(months.length)

  const totals = useMemo(() => monthlyTotals(ownTxns), [ownTxns])
  const incomeSeries = useMemo(() => pickSeries(months, totals.income), [months, totals])
  const spendSeries = useMemo(() => pickSeries(months, totals.expense), [months, totals])

  const incomeSum = sum(incomeSeries)
  const spendSum = sum(spendSeries)
  const incomeAvg = average(incomeSeries)
  const spendAvg = average(spendSeries)
  const incomeGrowth = trendGrowth(incomeSeries)
  const spendGrowth = trendGrowth(spendSeries)
  const windowSavingsRate = savingsRate(incomeSum, spendSum)

  const rates = useMemo(() => savingsRateSeries(months, totals.income, totals.expense), [months, totals])
  const anchorRate = rates.length > 0 ? rates[rates.length - 1] : null
  const ratesWithIncome = rates.filter((r): r is number => r !== null)
  const bestRate = ratesWithIncome.length > 0 ? Math.max(...ratesWithIncome) * 100 : null
  const worstRate = ratesWithIncome.length > 0 ? Math.min(...ratesWithIncome) * 100 : null

  const netWorth = useMemo(
    () => (months.length > 0 ? netWorthChange(ownAccounts, ownAccountTxnsAll, months[0], months[months.length - 1]) : { amount: 0, start: 0, end: 0 }),
    [months, ownAccounts, ownAccountTxnsAll],
  )

  const gapSentenceData = useMemo(
    () => (months.length > 0 ? gapSentenceParts(incomeSeries, spendSeries, segmentPhrase, incomeSum - spendSum) : []),
    [months, incomeSeries, spendSeries, segmentPhrase, incomeSum, spendSum],
  )

  // Category spend-by-month (expense txns only) and the 12-month baseline
  // ending the month before the anchor — independent of the period segment.
  const categorySpendByMonth = useMemo(() => categorySpendByMonthMap(ownTxns, categories), [ownTxns, categories])
  const baseMonths = useMemo(() => (earliest ? baselineMonths(anchor, earliest) : []), [anchor, earliest])
  const hasEnoughBaseline = baseMonths.length >= MIN_BASELINE_MONTHS
  const baseline = useMemo(() => categoryBaseline(categorySpendByMonth, baseMonths), [categorySpendByMonth, baseMonths])

  const labelFor = useCallback((key: string) => categoryLabelInfo(key, categories).label, [categories])
  const labelInfoFor = useCallback((key: string) => categoryLabelInfo(key, categories), [categories])

  const anchorSpendByCategory = useMemo(() => {
    const m = new Map<string, number>()
    for (const [key, byMonth] of categorySpendByMonth) m.set(key, byMonth.get(anchor) ?? 0)
    return m
  }, [categorySpendByMonth, anchor])

  const whatChanged = useMemo(
    () => (hasEnoughBaseline ? whatChangedRows(anchorSpendByCategory, baseline, labelFor) : { rows: [], net: 0, explainsMostLabel: null }),
    [hasEnoughBaseline, anchorSpendByCategory, baseline, labelFor],
  )

  const weak = useMemo(() => weakestMonths(months, rates), [months, rates])
  const savingsSentenceText = useMemo(() => {
    if (!hasEnoughBaseline) return savingsSentence(weak, segmentPhrase, () => null)
    return savingsSentence(weak, segmentPhrase, (month) => topOverBaselineCategory(categorySpendByMonth, baseline, month, labelFor))
  }, [weak, segmentPhrase, hasEnoughBaseline, categorySpendByMonth, baseline, labelFor])

  const cashRows = useMemo(() => cashFlowRows(months, totals.income, totals.expense), [months, totals])
  const keptTotal = useMemo(() => totalKept(months, totals.income, totals.expense), [months, totals])

  const totalSpendByMonth = totals.expense
  const trendRows = useMemo(
    () => (hasEnoughBaseline ? categoryTrendRows(categorySpendByMonth, baseline, months, measure, totalSpendByMonth, labelInfoFor, baseMonths) : []),
    [hasEnoughBaseline, categorySpendByMonth, baseline, months, measure, totalSpendByMonth, labelInfoFor, baseMonths],
  )

  const chartMonths = months.length > CHART_MAX_MONTHS ? months.slice(months.length - CHART_MAX_MONTHS) : months
  const chartIncome = useMemo(() => pickSeries(chartMonths, totals.income), [chartMonths, totals])
  const chartSpend = useMemo(() => pickSeries(chartMonths, totals.expense), [chartMonths, totals])

  // Export's own window slice — unlike every other figure on this page, it
  // INCLUDES transfers (an export is a ledger listing, not a total) and is
  // filtered on the transaction's own `accountId` being own (not
  // `ownAccountTxnsAll`, which also pulls in transfers whose *destination*
  // is own — a txn like that belongs to the other account's export, not
  // this one, or it would appear on both).
  const windowTxns = useMemo(() => {
    const monthSet = new Set(months)
    return (allTxns ?? []).filter((t) => ownAccountIds.has(t.accountId) && monthSet.has(t.date.slice(0, 7)))
  }, [allTxns, ownAccountIds, months])

  const handleExport = useCallback((format: 'csv' | 'json', ids: string[]) => {
    exportTransactions(format, ids).catch((err) => {
      addToast({ message: errorMessage(err, 'Could not export transactions — please try again.'), duration: 4000 })
    })
  }, [exportTransactions, addToast])

  const exportButton = (
    <Button variant="secondary" size="sm" onClick={() => setExportOpen(true)}>
      <Download className="icon-sm" />
      Export
    </Button>
  )

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">Reports</h1>
        {!isEmpty && !loadFailed && windowLabel && (
          <span className="page-sub hide-mobile" data-testid="reports-window">{windowLabel}</span>
        )}
        <div className="page-actions">
          {!isEmpty && !loadFailed && (
            <div className="segment" role="tablist" aria-label="Report period">
              {SEGMENTS.map((s) => (
                <button key={s.value} type="button" role="tab" aria-selected={segment === s.value} onClick={() => setSegment(s.value)}>
                  {s.label}
                </button>
              ))}
            </div>
          )}
          {/* Hidden when `isEmpty`: that EmptyState renders its own Export
              below, and Export must appear exactly once. */}
          {!loadFailed && !isEmpty && exportButton}
        </div>
      </div>

      {loadFailed ? (
        <EmptyState
          icon={<BarChart2 className="h-10 w-10" />}
          title="Could not load Reports"
          description="Something went wrong loading your transaction history."
          action={<Button size="sm" onClick={reloadAll}>Retry</Button>}
        />
      ) : !dataReady ? null : isEmpty ? (
        <EmptyState
          icon={<BarChart2 className="h-10 w-10" />}
          title="Reports start once a full month of transactions exists"
          action={exportButton}
        />
      ) : (
        <div className="dash">
          <ReportsStats
            income={incomeSum}
            incomeAvg={incomeAvg}
            incomeGrowth={incomeGrowth}
            spending={spendSum}
            spendingAvg={spendAvg}
            spendingGrowth={spendGrowth}
            savingsRatePct={windowSavingsRate === null ? null : windowSavingsRate * 100}
            bestMonthPct={bestRate}
            worstMonthPct={worstRate}
            netWorth={netWorth}
          />

          <IncomeVsSpendingChart
            months={chartMonths}
            incomeValues={chartIncome}
            spendValues={chartSpend}
            anchor={anchor}
            windowLabel={`last ${chartMonths.length} months`}
            gapSentence={gapSentenceData}
          />

          <SavingsRateCard
            months={months}
            rates={rates}
            anchorRatePct={anchorRate === null ? null : anchorRate * 100}
            windowRatePct={windowSavingsRate === null ? null : windowSavingsRate * 100}
            sentence={savingsSentenceText}
          />

          <WhatChanged
            hasEnoughHistory={hasEnoughBaseline}
            rows={whatChanged.rows}
            net={whatChanged.net}
            explainsMostLabel={whatChanged.explainsMostLabel}
          />

          <CashFlowTable
            rows={cashRows}
            anchorMonth={anchor}
            totalKept={keptTotal}
            monthCount={months.length}
          />

          <CategoryTrends
            hasEnoughHistory={hasEnoughBaseline}
            rows={trendRows}
            measure={measure}
            onMeasureChange={setMeasure}
            windowLabel={`last ${months.length} months`}
            monthCount={months.length}
          />
        </div>
      )}

      <ExportModal
        open={exportOpen}
        onOpenChange={setExportOpen}
        transactions={windowTxns}
        accounts={accounts}
        categories={categories}
        onExport={handleExport}
      />
    </div>
  )
}
