import { useEffect, useState, useMemo } from 'react'
import { useWallet } from '@/hooks/useWallet'
import { formatMYR } from '@/lib/utils'
import { EmptyState } from '@/components/ui/EmptyState'
import { WalletTabNav } from '@/modules/wallet/WalletTabNav'
import { LayoutDashboard, TrendingUp, TrendingDown, ArrowUpDown } from 'lucide-react'
import { format, parseISO, endOfWeek, eachWeekOfInterval } from 'date-fns'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from 'recharts'
import type { Transaction } from '@/types/wallet.types'

type DateRange = 'this-month' | 'last-month' | 'custom'

interface WeeklyData {
  week: string
  income: number
  expense: number
}

interface CategorySpend {
  name: string
  value: number
  color: string
}

interface AccountSpend {
  name: string
  amount: number
}

interface MerchantSpend {
  merchant: string
  total: number
  count: number
}

export function Dashboard() {
  const { loadTransactions, loadCategories, loadAccounts, accounts, categories } = useWallet()
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [dateRange, setDateRange] = useState<DateRange>('this-month')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')

  const { dateFrom, dateTo } = useMemo(() => {
    const now = new Date()
    if (dateRange === 'this-month') {
      const first = new Date(now.getFullYear(), now.getMonth(), 1)
      const last = new Date(now.getFullYear(), now.getMonth() + 1, 0)
      return {
        dateFrom: format(first, 'yyyy-MM-dd'),
        dateTo: format(last, 'yyyy-MM-dd'),
      }
    }
    if (dateRange === 'last-month') {
      const first = new Date(now.getFullYear(), now.getMonth() - 1, 1)
      const last = new Date(now.getFullYear(), now.getMonth(), 0)
      return {
        dateFrom: format(first, 'yyyy-MM-dd'),
        dateTo: format(last, 'yyyy-MM-dd'),
      }
    }
    return { dateFrom: customFrom, dateTo: customTo }
  }, [dateRange, customFrom, customTo])

  useEffect(() => {
    loadAccounts()
    loadCategories()
  }, [loadAccounts, loadCategories])

  useEffect(() => {
    if (!dateFrom || !dateTo) return
    loadTransactions({ dateFrom, dateTo }).then(setTransactions)
  }, [dateFrom, dateTo, loadTransactions])

  const summary = useMemo(() => {
    let income = 0
    let expense = 0
    for (const t of transactions) {
      if (t.type === 'income') income += t.amount
      else if (t.type === 'expense') expense += t.amount
    }
    return { income, expense, net: income - expense }
  }, [transactions])

  const weeklyData = useMemo((): WeeklyData[] => {
    if (!dateFrom || !dateTo || transactions.length === 0) return []
    const start = parseISO(dateFrom)
    const end = parseISO(dateTo)
    const weeks = eachWeekOfInterval({ start, end }, { weekStartsOn: 1 })

    return weeks.map((weekStart) => {
      const weekEnd = endOfWeek(weekStart, { weekStartsOn: 1 })
      let income = 0
      let expense = 0
      for (const t of transactions) {
        const d = parseISO(t.date)
        if (d >= weekStart && d <= weekEnd) {
          if (t.type === 'income') income += t.amount
          else if (t.type === 'expense') expense += t.amount
        }
      }
      return {
        week: format(weekStart, 'dd MMM'),
        income,
        expense,
      }
    })
  }, [transactions, dateFrom, dateTo])

  const categoryData = useMemo((): CategorySpend[] => {
    const map = new Map<string, number>()
    for (const t of transactions) {
      if (t.type !== 'expense' || !t.categoryId) continue
      map.set(t.categoryId, (map.get(t.categoryId) ?? 0) + t.amount)
    }

    const catMap = new Map(categories.map((c) => [c.id, c]))

    return Array.from(map.entries())
      .map(([id, value]) => {
        const cat = catMap.get(id)
        return {
          name: cat?.name ?? 'Uncategorised',
          value,
          color: cat?.color ?? '#6b7280',
        }
      })
      .sort((a, b) => b.value - a.value)
  }, [transactions, categories])

  const accountData = useMemo((): AccountSpend[] => {
    const map = new Map<string, number>()
    for (const t of transactions) {
      if (t.type !== 'expense') continue
      map.set(t.accountId, (map.get(t.accountId) ?? 0) + t.amount)
    }

    const acctMap = new Map(accounts.map((a) => [a.id, a]))

    return Array.from(map.entries())
      .map(([id, amount]) => ({
        name: acctMap.get(id)?.name ?? 'Unknown',
        amount,
      }))
      .sort((a, b) => b.amount - a.amount)
  }, [transactions, accounts])

  const topMerchants = useMemo((): MerchantSpend[] => {
    const map = new Map<string, { total: number; count: number }>()
    for (const t of transactions) {
      if (t.type !== 'expense' || !t.merchant) continue
      const key = t.merchant.toLowerCase()
      const existing = map.get(key) ?? { total: 0, count: 0 }
      map.set(key, { total: existing.total + t.amount, count: existing.count + 1 })
    }

    return Array.from(map.entries())
      .map(([merchant, data]) => ({ merchant, ...data }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 10)
  }, [transactions])

  return (
    <div className="p-6">
      {/* Section header */}
      <div className="mb-4">
        <h1 className="text-xl font-bold text-gray-900">Wallet</h1>
      </div>

      {/* Tab navigation */}
      <WalletTabNav />

      {/* Empty state */}
      {transactions.length === 0 && accounts.length === 0 ? (
        <EmptyState
          icon={<LayoutDashboard className="h-12 w-12" />}
          title="No data yet"
          description="Add accounts and transactions to see your financial dashboard."
        />
      ) : (

      <div className="space-y-6">
      {/* Date range selector */}
      <div className="flex items-center gap-3">
        <div className="flex rounded-lg border border-gray-200 bg-white">
          {(['this-month', 'last-month', 'custom'] as const).map((range) => (
            <button
              key={range}
              onClick={() => setDateRange(range)}
              className={`px-3 py-1.5 text-sm font-medium transition-colors first:rounded-l-lg last:rounded-r-lg ${
                dateRange === range
                  ? 'bg-brand-500 text-white'
                  : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              {range === 'this-month' ? 'This Month' : range === 'last-month' ? 'Last Month' : 'Custom'}
            </button>
          ))}
        </div>
        {dateRange === 'custom' && (
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
            />
            <span className="text-gray-400">to</span>
            <input
              type="date"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
            />
          </div>
        )}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <TrendingUp className="h-4 w-4 text-green-500" />
            Income
          </div>
          <p className="mt-1 text-xl font-bold text-green-600">{formatMYR(summary.income)}</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <TrendingDown className="h-4 w-4 text-red-500" />
            Expense
          </div>
          <p className="mt-1 text-xl font-bold text-red-600">{formatMYR(summary.expense)}</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <ArrowUpDown className="h-4 w-4 text-blue-500" />
            Net
          </div>
          <p className={`mt-1 text-xl font-bold ${summary.net >= 0 ? 'text-green-600' : 'text-red-600'}`}>
            {formatMYR(summary.net)}
          </p>
        </div>
      </div>

      {/* Cash flow chart */}
      {weeklyData.length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <h3 className="mb-4 text-sm font-semibold text-gray-900">Cash Flow by Week</h3>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={weeklyData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="week" fontSize={12} tickLine={false} />
              <YAxis fontSize={12} tickLine={false} tickFormatter={(v: number) => `${(v / 1000).toFixed(0)}k`} />
              <Tooltip formatter={(value: number) => formatMYR(value)} />
              <Legend />
              <Bar dataKey="income" fill="#22c55e" radius={[4, 4, 0, 0]} />
              <Bar dataKey="expense" fill="#ef4444" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        {/* Category pie chart */}
        {categoryData.length > 0 && (
          <div className="rounded-xl border border-gray-200 bg-white p-5">
            <h3 className="mb-4 text-sm font-semibold text-gray-900">Spending by Category</h3>
            <ResponsiveContainer width="100%" height={250}>
              <PieChart>
                <Pie
                  data={categoryData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={90}
                  label={({ name, percent }: { name: string; percent: number }) =>
                    `${name} ${(percent * 100).toFixed(0)}%`
                  }
                  labelLine={false}
                  fontSize={11}
                >
                  {categoryData.map((entry, idx) => (
                    <Cell key={idx} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip formatter={(value: number) => formatMYR(value)} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Account spending chart */}
        {accountData.length > 0 && (
          <div className="rounded-xl border border-gray-200 bg-white p-5">
            <h3 className="mb-4 text-sm font-semibold text-gray-900">Spending by Account</h3>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={accountData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis type="number" fontSize={12} tickFormatter={(v: number) => `${(v / 1000).toFixed(0)}k`} />
                <YAxis type="category" dataKey="name" fontSize={12} width={100} />
                <Tooltip formatter={(value: number) => formatMYR(value)} />
                <Bar dataKey="amount" fill="#3b82f6" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Top merchants */}
      {topMerchants.length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <h3 className="mb-3 text-sm font-semibold text-gray-900">Top Merchants</h3>
          <div className="divide-y divide-gray-100">
            {topMerchants.map((m, idx) => (
              <div key={m.merchant} className="flex items-center justify-between py-2.5">
                <div className="flex items-center gap-3">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-gray-100 text-xs font-medium text-gray-500">
                    {idx + 1}
                  </span>
                  <span className="text-sm font-medium text-gray-900 capitalize">{m.merchant}</span>
                  <span className="text-xs text-gray-400">{m.count} txn{m.count !== 1 ? 's' : ''}</span>
                </div>
                <span className="text-sm font-semibold text-gray-700">{formatMYR(m.total)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      </div>
      )}
    </div>
  )
}
