import { useState, useEffect, useCallback } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { Plus, Upload, Wallet, TrendingUp, TrendingDown } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'
import { DatePicker } from '@/components/ui/DatePicker'
import { Input } from '@/components/ui/Input'
import { EmptyState } from '@/components/ui/EmptyState'
import { TransactionList } from '@/modules/wallet/TransactionList'
import { TransactionForm } from '@/modules/wallet/TransactionForm'
import { WalletTabNav } from '@/modules/wallet/WalletTabNav'
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
  } = useWallet()

  const [searchParams] = useSearchParams()
  const [formOpen, setFormOpen] = useState(false)
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null)
  const [summary, setSummary] = useState({ totalIncome: 0, totalExpense: 0, net: 0 })

  // Initialize from URL params (e.g., ?account=xxx from AccountCard click)
  useEffect(() => {
    const accountParam = searchParams.get('account')
    if (accountParam) {
      setFilters({ accountId: accountParam })
    }
  }, [searchParams, setFilters])

  // Load initial data
  useEffect(() => {
    loadAccounts()
    loadCategories()
  }, [loadAccounts, loadCategories])

  // Load transactions when filters change
  useEffect(() => {
    loadTransactions(filters).then(() => {
      const s = getFilteredSummary()
      setSummary(s)
    })
  }, [filters, loadTransactions, getFilteredSummary])

  // Refresh summary when transactions change
  useEffect(() => {
    const s = getFilteredSummary()
    setSummary(s)
  }, [transactions, getFilteredSummary])

  const handleAddTransaction = useCallback(async (data: TransactionFormData) => {
    await addTransaction(data)
    // Reload to reflect new data
    await loadTransactions(filters)
  }, [addTransaction, loadTransactions, filters])

  const handleUpdateTransaction = useCallback(async (data: TransactionFormData) => {
    if (!editingTransaction) return
    await updateTransaction(editingTransaction.id, data)
    setEditingTransaction(null)
    await loadTransactions(filters)
  }, [editingTransaction, updateTransaction, loadTransactions, filters])

  const handleDeleteTransaction = useCallback(async (id: string) => {
    await deleteTransaction(id)
    await loadTransactions(filters)
  }, [deleteTransaction, loadTransactions, filters])

  function openEditForm(transaction: Transaction) {
    setEditingTransaction(transaction)
    setFormOpen(true)
  }

  function openCreateForm() {
    setEditingTransaction(null)
    setFormOpen(true)
  }

  // Filter options
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
    <div className="mx-auto max-w-4xl p-6">
      {/* Section header */}
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900">Wallet</h1>
        <div className="flex items-center gap-2">
          <Link to="/wallet/import">
            <Button variant="secondary" size="sm">
              <Upload className="h-4 w-4" />
              Import CSV
            </Button>
          </Link>
          <Button size="sm" onClick={openCreateForm}>
            <Plus className="h-4 w-4" />
            Add Transaction
          </Button>
        </div>
      </div>

      {/* Tab navigation */}
      <WalletTabNav />

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
            onChange={(e) =>
              setFilters({ type: e.target.value as typeof filters.type })
            }
          />
          <Select
            label="Account"
            options={accountOptions}
            value={filters.accountId ?? ''}
            onChange={(e) =>
              setFilters({ accountId: e.target.value || null })
            }
          />
          <Select
            label="Category"
            options={categoryOptions}
            value={filters.categoryId ?? ''}
            onChange={(e) =>
              setFilters({ categoryId: e.target.value || null })
            }
          />
        </div>
        {/* Tag filter */}
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
          <div className="flex items-center gap-2 text-xs font-medium text-green-600">
            <TrendingUp className="h-3.5 w-3.5" />
            Income
          </div>
          <p className="mt-1 text-lg font-bold text-green-700">
            {formatMYR(summary.totalIncome)}
          </p>
        </div>
        <div className="rounded-lg border border-red-100 bg-red-50 px-4 py-3">
          <div className="flex items-center gap-2 text-xs font-medium text-red-600">
            <TrendingDown className="h-3.5 w-3.5" />
            Expense
          </div>
          <p className="mt-1 text-lg font-bold text-red-700">
            {formatMYR(summary.totalExpense)}
          </p>
        </div>
        <div className={cn(
          'rounded-lg border px-4 py-3',
          summary.net >= 0
            ? 'border-gray-200 bg-gray-50'
            : 'border-red-200 bg-red-50'
        )}>
          <div className="text-xs font-medium text-gray-600">Net</div>
          <p className={cn(
            'mt-1 text-lg font-bold',
            summary.net >= 0 ? 'text-gray-900' : 'text-red-700'
          )}>
            {formatMYR(summary.net)}
          </p>
        </div>
      </div>

      {/* Transaction list */}
      <div className="rounded-xl border border-gray-200 bg-white">
        {transactions.length === 0 && accounts.length === 0 ? (
          <EmptyState
            icon={<Wallet className="h-12 w-12" />}
            title="No transactions yet"
            description="Create an account first, then add your transactions."
            action={
              <Link to="/wallet/accounts">
                <Button>Go to Accounts</Button>
              </Link>
            }
          />
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

      {/* Transaction form */}
      <TransactionForm
        open={formOpen}
        onOpenChange={(open) => {
          setFormOpen(open)
          if (!open) setEditingTransaction(null)
        }}
        transaction={editingTransaction}
        accounts={accounts}
        categories={categories}
        defaultAccountId={filters.accountId}
        onSubmit={editingTransaction ? handleUpdateTransaction : handleAddTransaction}
      />
    </div>
  )
}
