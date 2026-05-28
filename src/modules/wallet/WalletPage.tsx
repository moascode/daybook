import { useState, useEffect, useCallback, useRef } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { Plus, Wallet, TrendingUp, TrendingDown, Download } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'
import { DatePicker } from '@/components/ui/DatePicker'
import { Input } from '@/components/ui/Input'
import { EmptyState } from '@/components/ui/EmptyState'
import { TransactionList } from '@/modules/wallet/TransactionList'
import { TransactionForm } from '@/modules/wallet/TransactionForm'
import { useWallet } from '@/hooks/useWallet'
import { cn, formatMYR } from '@/lib/utils'
import type { Transaction } from '@/types/wallet.types'
import type { TransactionFormData } from '@/modules/wallet/TransactionForm'

export function WalletPage() {
  const {
    accounts,
    transactions,
    categories,
    filters,
    setFilters,
    loadAccounts,
    loadCategories,
    loadTransactions,
    addTransaction,
    updateTransaction,
    deleteTransaction,
    getFilteredSummary,
    exportTransactions,
  } = useWallet()

  const [searchParams] = useSearchParams()
  const [formOpen, setFormOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null)
  const [summary, setSummary] = useState({ totalIncome: 0, totalExpense: 0, net: 0 })
  const filtersRef = useRef(filters)
  filtersRef.current = filters

  useEffect(() => {
    const accountParam = searchParams.get('account')
    if (accountParam) setFilters({ accountId: accountParam })
  }, [searchParams, setFilters])

  useEffect(() => {
    loadAccounts()
    loadCategories()
  }, [loadAccounts, loadCategories])

  useEffect(() => {
    loadTransactions(filters).then(() => setSummary(getFilteredSummary()))
  }, [filters, loadTransactions, getFilteredSummary])

  useEffect(() => {
    setSummary(getFilteredSummary())
  }, [transactions, getFilteredSummary])

  const handleAddTransaction = useCallback(async (data: TransactionFormData) => {
    await addTransaction(data)
    await loadTransactions(filtersRef.current)
  }, [addTransaction, loadTransactions])

  const handleUpdateTransaction = useCallback(async (data: TransactionFormData) => {
    if (!editingTransaction) return
    await updateTransaction(editingTransaction.id, data)
    setEditingTransaction(null)
    await loadTransactions(filtersRef.current)
  }, [editingTransaction, updateTransaction, loadTransactions])

  const handleDeleteTransaction = useCallback(async (id: string) => {
    await deleteTransaction(id)
    await loadTransactions(filtersRef.current)
  }, [deleteTransaction, loadTransactions])

  function openEditForm(transaction: Transaction) {
    setEditingTransaction(transaction)
    setFormOpen(true)
  }

  function openCreateForm() {
    setEditingTransaction(null)
    setFormOpen(true)
  }

  const handleExport = useCallback(async (format: 'csv' | 'json') => {
    await exportTransactions(format)
    setExportOpen(false)
  }, [exportTransactions])

  const typeOptions = [
    { value: 'all', label: 'All Types' },
    { value: 'income', label: 'Income' },
    { value: 'expense', label: 'Expense' },
    { value: 'transfer', label: 'Transfer' },
  ]

  const accountOptions = [
    { value: '', label: 'All Accounts' },
    ...accounts.map((a) => ({ value: a.id, label: a.name })),
  ]

  const categoryOptions = [
    { value: '', label: 'All Categories' },
    ...categories.map((c) => ({ value: c.id, label: c.name })),
  ]

  return (
    <div className="max-w-5xl mx-auto">
      {/* Page sub-header */}
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Transactions</h2>
          <p className="text-xs text-gray-500 mt-0.5">Track income, expenses, and transfers</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Button variant="secondary" size="sm" onClick={() => setExportOpen((o) => !o)}>
              <Download className="h-3.5 w-3.5" />
              Export
            </Button>
            {exportOpen && (
              <div
                data-testid="export-panel"
                className="absolute right-0 top-full mt-1 z-10 w-44 rounded-xl border border-gray-200 bg-white shadow-lg p-2 flex flex-col gap-1"
              >
                <button
                  className="w-full rounded-lg px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
                  onClick={() => handleExport('csv')}
                >
                  Export CSV
                </button>
                <button
                  className="w-full rounded-lg px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
                  onClick={() => handleExport('json')}
                >
                  Export JSON
                </button>
              </div>
            )}
          </div>
          <Button size="sm" onClick={openCreateForm}>
            <Plus className="h-3.5 w-3.5" />
            Add Transaction
          </Button>
        </div>
      </div>

      {/* Filter bar */}
      <div className="mb-4 rounded-xl border border-gray-200 bg-white p-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <DatePicker
            label="From"
            value={filters.dateFrom}
            onChange={(e) => setFilters({ dateFrom: e.target.value })}
          />
          <DatePicker
            label="To"
            value={filters.dateTo}
            onChange={(e) => setFilters({ dateTo: e.target.value })}
          />
          <Select
            label="Type"
            options={typeOptions}
            value={filters.type}
            onChange={(e) => setFilters({ type: e.target.value as typeof filters.type })}
          />
          <Select
            label="Account"
            options={accountOptions}
            value={filters.accountId ?? ''}
            onChange={(e) => setFilters({ accountId: e.target.value || null })}
          />
          <Select
            label="Category"
            options={categoryOptions}
            value={filters.categoryId ?? ''}
            onChange={(e) => setFilters({ categoryId: e.target.value || null })}
          />
        </div>
        <div className="mt-3 max-w-xs">
          <Input
            label="Tag"
            placeholder="Filter by tag..."
            value={filters.tag}
            onChange={(e) => setFilters({ tag: e.target.value })}
          />
        </div>
      </div>

      {/* Summary row */}
      <div className="mb-4 grid grid-cols-3 gap-3">
        <div className="rounded-lg border border-green-100 bg-green-50 px-4 py-3">
          <div className="flex items-center gap-1.5 text-xs font-medium text-green-600">
            <TrendingUp className="h-3.5 w-3.5" /> Income
          </div>
          <p className="mt-1 text-lg font-bold text-green-700">{formatMYR(summary.totalIncome)}</p>
        </div>
        <div className="rounded-lg border border-red-100 bg-red-50 px-4 py-3">
          <div className="flex items-center gap-1.5 text-xs font-medium text-red-600">
            <TrendingDown className="h-3.5 w-3.5" /> Expense
          </div>
          <p className="mt-1 text-lg font-bold text-red-700">{formatMYR(summary.totalExpense)}</p>
        </div>
        <div className={cn(
          'rounded-lg border px-4 py-3',
          summary.net >= 0 ? 'border-gray-200 bg-gray-50' : 'border-red-100 bg-red-50',
        )}>
          <div className="text-xs font-medium text-gray-500">Net</div>
          <p className={cn('mt-1 text-lg font-bold', summary.net >= 0 ? 'text-gray-800' : 'text-red-700')}>
            {formatMYR(summary.net)}
          </p>
        </div>
      </div>

      {/* Transaction list */}
      <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
        {transactions.length === 0 && accounts.length === 0 ? (
          <EmptyState
            icon={<Wallet className="h-10 w-10" />}
            title="No transactions yet"
            description="Create an account first, then start recording transactions."
            action={
              <Link to="/wallet/accounts">
                <Button size="sm">Go to Accounts</Button>
              </Link>
            }
          />
        ) : transactions.length === 0 ? (
          <div className="py-16 text-center text-sm text-gray-400">
            No transactions match your current filters.
          </div>
        ) : (
          <TransactionList
            transactions={transactions}
            accounts={accounts}
            categories={categories}
            onEdit={openEditForm}
            onDelete={handleDeleteTransaction}
          />
        )}
      </div>

      <TransactionForm
        open={formOpen}
        onOpenChange={(open) => { setFormOpen(open); if (!open) setEditingTransaction(null) }}
        transaction={editingTransaction}
        accounts={accounts}
        categories={categories}
        defaultAccountId={filters.accountId}
        onSubmit={editingTransaction ? handleUpdateTransaction : handleAddTransaction}
      />
    </div>
  )
}
