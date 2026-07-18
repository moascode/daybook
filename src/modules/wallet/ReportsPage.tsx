import { useState, useEffect, useMemo, useCallback } from 'react'
import { BarChart2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { useWallet } from '@/hooks/useWallet'
import { formatMYR, POSITIVE_MONEY_COLOR, POSITIVE_MONEY_COLOR_FADED } from '@/lib/utils'
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
    if (t.type === 'income') map[y][m].income += t.amount
    else map[y][m].expense += t.amount
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
        <BarChart2 className="h-5 w-5 text-gray-400" />
        <h2 className="text-base font-semibold text-gray-900">Reports</h2>
      </div>

      {/* Year-on-year */}
      <div className="rounded-xl border border-gray-200 bg-white p-5 mb-6">
        <h3 className="mb-1 text-sm font-semibold text-gray-900">Year-on-year comparison</h3>
        <p className="mb-4 text-xs text-gray-500">{lastYear} vs {thisYear}</p>
        <div data-testid="yoy-chart">
          <div className="mb-2 flex gap-4 text-xs text-gray-500">
            <span className="font-medium text-gray-700">{lastYear}</span>
            <span className="font-medium text-gray-700">{thisYear}</span>
          </div>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={yoyData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="month" fontSize={11} tickLine={false} />
              <YAxis fontSize={11} tickLine={false} tickFormatter={(v: number) => `${(v / 1000).toFixed(0)}k`} />
              <Tooltip formatter={(value: number) => formatMYR(value)} />
              <Legend />
              <Bar dataKey={`${lastYear} expense`} fill="#fca5a5" radius={[3, 3, 0, 0]} />
              <Bar dataKey={`${thisYear} expense`} fill="#ef4444" radius={[3, 3, 0, 0]} />
              <Bar dataKey={`${lastYear} income`} fill={POSITIVE_MONEY_COLOR_FADED} radius={[3, 3, 0, 0]} />
              <Bar dataKey={`${thisYear} income`} fill={POSITIVE_MONEY_COLOR} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Custom date range */}
      <div className="rounded-xl border border-gray-200 bg-white p-5" data-testid="custom-date-range">
        <h3 className="mb-4 text-sm font-semibold text-gray-900">Custom date range</h3>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-600">From</label>
            <input
              type="date"
              aria-label="From"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-600">To</label>
            <input
              type="date"
              aria-label="To"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
            />
          </div>
          <Button size="sm" onClick={handleApply}>Apply</Button>
        </div>

        {hasRangeData && (
          <div className="mt-5">
            <p className="text-xs text-gray-500 mb-3">
              {format(parseISO(appliedFrom), 'dd MMM yyyy')} – {format(parseISO(appliedTo), 'dd MMM yyyy')}
              {' '}
              <span className="font-medium text-gray-700">
                ({format(parseISO(appliedFrom), 'MMM yyyy')} – {format(parseISO(appliedTo), 'MMM yyyy')})
              </span>
            </p>

            {rangeTransactions.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-4">No transactions in this period</p>
            ) : (
              <div className="divide-y divide-gray-100 max-h-64 overflow-y-auto rounded-lg border border-gray-100">
                {rangeTransactions.map((t) => (
                  <div key={t.id} className="flex items-center justify-between px-3 py-2 text-sm">
                    <div>
                      <span className="font-medium text-gray-800">{t.merchant || '(no merchant)'}</span>
                      <span className="ml-2 text-xs text-gray-400">{t.date}</span>
                    </div>
                    <span className={t.type === 'income' ? 'text-positive-600 font-medium' : t.type === 'transfer' ? 'text-gray-500 font-medium' : 'text-red-600 font-medium'}>
                      {t.type === 'income' ? '+' : t.type === 'transfer' ? '↔' : '-'}{formatMYR(t.amount)}
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
