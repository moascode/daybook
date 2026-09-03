import { useState, useEffect, useMemo, useCallback } from 'react'
import { BarChart2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { DateRangeControl } from '@/components/ui/DateRangeControl'
import { useWallet, countableAmount } from '@/hooks/useWallet'
import {
  formatMYR,
  formatAxisMYR,
  POSITIVE_MONEY_COLOR,
  POSITIVE_MONEY_COLOR_FADED,
  NEGATIVE_MONEY_COLOR,
  NEGATIVE_MONEY_COLOR_FADED,
} from '@/lib/utils'
import { useChartTheme } from '@/hooks/useChartTheme'
import { format, parseISO } from 'date-fns'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'
import type { Transaction } from '@/types/wallet.types'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function buildYoYData(transactions: Transaction[]) {
  const now = new Date()
  const thisYear = now.getFullYear()
  const lastYear = thisYear - 1

  const map: Record<number, Record<number, { income: number; expense: number }>> = {
    [lastYear]: {},
    [thisYear]: {},
  }

  for (const t of transactions) {
    if (t.type === 'transfer') continue
    const d = parseISO(t.date)
    const y = d.getFullYear()
    const m = d.getMonth()
    if (y !== thisYear && y !== lastYear) continue
    if (!map[y][m]) map[y][m] = { income: 0, expense: 0 }
    // §3: countableAmount nets off settled splits and drops the creditor's
    // incoming leg. t.amount stays the ledger figure shown on the row itself.
    if (t.type === 'income') map[y][m].income += countableAmount(t)
    else map[y][m].expense += countableAmount(t)
  }

  return MONTHS.map((month, idx) => ({
    month,
    [`${lastYear} income`]: map[lastYear][idx]?.income ?? 0,
    [`${lastYear} expense`]: map[lastYear][idx]?.expense ?? 0,
    [`${thisYear} income`]: map[thisYear][idx]?.income ?? 0,
    [`${thisYear} expense`]: map[thisYear][idx]?.expense ?? 0,
  }))
}

export function ReportsPage() {
  const chart = useChartTheme()
  const { loadTransactions } = useWallet()
  const [allTransactions, setAllTransactions] = useState<Transaction[]>([])
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [appliedFrom, setAppliedFrom] = useState('')
  const [appliedTo, setAppliedTo] = useState('')
  const [rangeTransactions, setRangeTransactions] = useState<Transaction[]>([])

  const now = new Date()
  const thisYear = now.getFullYear()
  const lastYear = thisYear - 1

  useEffect(() => {
    loadTransactions({}).then(setAllTransactions)
  }, [loadTransactions])

  const yoyData = useMemo(() => buildYoYData(allTransactions), [allTransactions])

  // Yearly totals for the chart's accessible summary.
  const yoyTotals = useMemo(() => {
    const sum = (key: string) => yoyData.reduce((acc, m) => acc + Number(m[key] ?? 0), 0)
    return {
      lastIncome: sum(`${lastYear} income`),
      lastExpense: sum(`${lastYear} expense`),
      thisIncome: sum(`${thisYear} income`),
      thisExpense: sum(`${thisYear} expense`),
    }
  }, [yoyData, lastYear, thisYear])

  const handleApply = useCallback(async () => {
    if (!customFrom || !customTo) return
    setAppliedFrom(customFrom)
    setAppliedTo(customTo)
    const txns = await loadTransactions({ dateFrom: customFrom, dateTo: customTo })
    setRangeTransactions(txns)
  }, [customFrom, customTo, loadTransactions])

  const hasRangeData = appliedFrom && appliedTo

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-5 flex items-center gap-2">
        <BarChart2 className="h-5 w-5 text-fg-faint" />
        <h2 className="text-base font-semibold text-fg">Reports</h2>
      </div>

      {/* Year-on-year */}
      <div className="card card-pad mb-6">
        <h3 className="mb-1 text-sm font-semibold text-fg">Year-on-year comparison</h3>
        <p className="mb-4 text-xs text-fg-subtle">{lastYear} vs {thisYear}</p>
        <div data-testid="yoy-chart">
          <div className="mb-2 flex gap-4 text-xs text-fg-subtle">
            <span className="font-medium text-fg-muted">{lastYear}</span>
            <span className="font-medium text-fg-muted">{thisYear}</span>
          </div>
          <div
            role="img"
            aria-label={`Year-on-year bar chart of monthly income and expense. ${lastYear}: income ${formatMYR(yoyTotals.lastIncome)}, expense ${formatMYR(yoyTotals.lastExpense)}. ${thisYear}: income ${formatMYR(yoyTotals.thisIncome)}, expense ${formatMYR(yoyTotals.thisExpense)}`}
          >
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={yoyData}>
              <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} />
              <XAxis stroke={chart.axis} tick={{ fill: chart.axis }} dataKey="month" fontSize={11} tickLine={false} />
              <YAxis stroke={chart.axis} tick={{ fill: chart.axis }} fontSize={11} tickLine={false} tickFormatter={formatAxisMYR} />
              <Tooltip contentStyle={chart.tooltip.contentStyle} labelStyle={chart.tooltip.labelStyle} itemStyle={chart.tooltip.itemStyle} formatter={(value: number) => formatMYR(value)} />
              <Legend />
              <Bar dataKey={`${lastYear} expense`} fill={NEGATIVE_MONEY_COLOR_FADED} radius={[3, 3, 0, 0]} />
              <Bar dataKey={`${thisYear} expense`} fill={NEGATIVE_MONEY_COLOR} radius={[3, 3, 0, 0]} />
              <Bar dataKey={`${lastYear} income`} fill={POSITIVE_MONEY_COLOR_FADED} radius={[3, 3, 0, 0]} />
              <Bar dataKey={`${thisYear} income`} fill={POSITIVE_MONEY_COLOR} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Custom date range */}
      <div className="card card-pad" data-testid="custom-date-range">
        <h3 className="mb-4 text-sm font-semibold text-fg">Custom date range</h3>
        <div className="flex flex-wrap items-end gap-3">
          {/* Shared date-range widgets (§6.4); the range only loads on Apply. */}
          <DateRangeControl
            value={{ dateFrom: customFrom, dateTo: customTo }}
            onChange={(v) => {
              setCustomFrom(v.dateFrom)
              setCustomTo(v.dateTo)
            }}
            presets={['custom']}
          />
          <Button size="sm" onClick={handleApply}>Apply</Button>
        </div>

        {hasRangeData && (
          <div className="mt-5">
            <p className="text-xs text-fg-subtle mb-3">
              {format(parseISO(appliedFrom), 'dd MMM yyyy')} – {format(parseISO(appliedTo), 'dd MMM yyyy')}
              {' '}
              <span className="font-medium text-fg-muted">
                ({format(parseISO(appliedFrom), 'MMM yyyy')} – {format(parseISO(appliedTo), 'MMM yyyy')})
              </span>
            </p>

            {rangeTransactions.length === 0 ? (
              <p className="text-sm text-fg-faint text-center py-4">No transactions in this period</p>
            ) : (
              <div className="divide-y divide-line-subtle max-h-64 overflow-y-auto rounded-lg border border-line-subtle">
                {rangeTransactions.map((t) => (
                  <div key={t.id} className="flex items-center justify-between px-3 py-2 text-sm">
                    <div>
                      <span className="font-medium text-fg">{t.merchant || '(no merchant)'}</span>
                      <span className="ml-2 text-xs text-fg-faint">{t.date}</span>
                    </div>
                    <span className={t.type === 'income' ? 'text-positive-600 font-medium' : t.type === 'transfer' ? 'text-fg-subtle font-medium' : 'text-red-600 font-medium'}>
                      {t.type === 'income' ? '+' : t.type === 'transfer' ? '↔' : '-'}{formatMYR(countableAmount(t))}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
