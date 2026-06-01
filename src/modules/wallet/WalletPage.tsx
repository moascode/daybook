import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { Plus, Wallet, TrendingUp, TrendingDown, Download, Coins, CheckSquare, Trash2, Settings } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'
import { DatePicker } from '@/components/ui/DatePicker'
import { TagInput } from '@/components/ui/TagInput'
import { Modal } from '@/components/ui/Modal'
import { EmptyState } from '@/components/ui/EmptyState'
import { TransactionList } from '@/modules/wallet/TransactionList'
import { TransactionForm } from '@/modules/wallet/TransactionForm'
import { ExportModal } from '@/modules/wallet/ExportModal'
import { CategoryManager } from '@/modules/wallet/CategoryManager'
import { SplitDialog } from '@/modules/wallet/SplitDialog'
import { useWallet } from '@/hooks/useWallet'
import { useWalletStore } from '@/stores/wallet.store'
import { useAppStore } from '@/stores/app.store'
import { cn, formatMYR } from '@/lib/utils'
import type { Transaction } from '@/types/wallet.types'
import type { TransactionFormData } from '@/modules/wallet/TransactionForm'

function getMonthRange(monthOffset: number) {
  const now = new Date()
  // Use local year/month arithmetic — never toISOString() which converts to UTC
  // and shifts the date by up to a day in non-UTC timezones.
  const year = now.getFullYear()
  const month = now.getMonth() + monthOffset        // JS handles underflow (month < 0)
  const d = new Date(year, month, 1)                // normalises month overflow/underflow
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const lastDay = new Date(y, d.getMonth() + 1, 0).getDate()
  return {
    dateFrom: `${y}-${m}-01`,
    dateTo: `${y}-${m}-${String(lastDay).padStart(2, '0')}`,
  }
}

export function WalletPage() {
  const currentUserId = useAppStore((s) => s.user?.id ?? '')
  const {
    accounts,
    transactions,
    categories,
    tags,
    filters,
    setFilters,
    loadAccounts,
    loadCategories,
    loadTags,
    loadTransactions,
    addTransaction,
    updateTransaction,
    deleteTransaction,
    exportTransactions,
    getAccountBalance,
    addCategory,
    deleteCategory,
    getCategoryUsage,
  } = useWallet()

  const dataVersion = useWalletStore((s) => s.dataVersion)
  const [searchParams] = useSearchParams()
  const [formOpen, setFormOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [netWorth, setNetWorth] = useState<number | null>(null)
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null)

  // Split transaction state (for user-based share splitting)
  const [splitTarget, setSplitTarget] = useState<Transaction | null>(null)

  // Category manager state
  const [categoryManagerOpen, setCategoryManagerOpen] = useState(false)

  // Multi-select state
  const [selectMode, setSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false)

  // Keep the latest filters in a ref so the load-on-mutation handlers below can
  // read them without depending on `filters` (which would recreate them).
  // Also track previous filters to detect changes and clear the selection.
  const filtersRef = useRef(filters)
  const prevFiltersRef = useRef(filters)

  useEffect(() => {
    // Detect filter changes and clear selection if in select mode
    if (selectMode && JSON.stringify(prevFiltersRef.current) !== JSON.stringify(filters)) {
      setSelectedIds(new Set())
    }
    filtersRef.current = filters
    prevFiltersRef.current = filters
  }, [filters, selectMode])

  // Income/expense/net for the currently loaded transactions — derived state,
  // recomputed whenever the transaction list changes (transfers excluded).
  const summary = useMemo(() => {
    let totalIncome = 0
    let totalExpense = 0
    for (const t of transactions) {
      if (t.type === 'income') totalIncome += t.amount
      else if (t.type === 'expense') totalExpense += t.amount
    }
    return { totalIncome, totalExpense, net: totalIncome - totalExpense }
  }, [transactions])

  useEffect(() => {
    const accountParam = searchParams.get('account')
    if (accountParam) setFilters({ accountId: accountParam })
  }, [searchParams, setFilters])

  useEffect(() => {
    loadAccounts()
    loadCategories()
    loadTags()
  }, [loadAccounts, loadCategories, loadTags])

  useEffect(() => {
    // dataVersion: re-fetch when data changed out-of-band
    loadTransactions({ ...filters, view: filters.view })
  }, [filters, loadTransactions, dataVersion])

  // Total balance across all accounts. Balances are independent of the active
  // filters, so this is keyed on `accounts` (and dataVersion) — NOT on the
  // filtered transaction list. Mutations refresh it explicitly below.
  const loadNetWorth = useCallback(async () => {
    const balances = await Promise.all(accounts.map((a) => getAccountBalance(a.id)))
    setNetWorth(balances.reduce((sum, b) => sum + b, 0))
  }, [accounts, getAccountBalance])

  useEffect(() => {
    let cancelled = false
    Promise.all(accounts.map((a) => getAccountBalance(a.id))).then((balances) => {
      if (!cancelled) setNetWorth(balances.reduce((sum, b) => sum + b, 0))
    })
    return () => { cancelled = true }
  }, [accounts, getAccountBalance, dataVersion])

  const handleAddTransaction = useCallback(async (data: TransactionFormData) => {
    await addTransaction(data)
    await loadTransactions(filtersRef.current)
    await loadNetWorth()
    await loadTags()
  }, [addTransaction, loadTransactions, loadNetWorth, loadTags])

  const handleUpdateTransaction = useCallback(async (data: TransactionFormData) => {
    if (!editingTransaction) return
    await updateTransaction(editingTransaction.id, data)
    setEditingTransaction(null)
    await loadTransactions(filtersRef.current)
    await loadNetWorth()
    await loadTags()
  }, [editingTransaction, updateTransaction, loadTransactions, loadNetWorth, loadTags])

  const handleDeleteTransaction = useCallback(async (id: string) => {
    await deleteTransaction(id)
    await loadTransactions(filtersRef.current)
    await loadNetWorth()
  }, [deleteTransaction, loadTransactions, loadNetWorth])

  const handleBulkDelete = useCallback(async () => {
    for (const id of Array.from(selectedIds)) {
      await deleteTransaction(id)
    }
    setSelectedIds(new Set())
    setSelectMode(false)
    setBulkDeleteOpen(false)
    await loadTransactions(filtersRef.current)
    await loadNetWorth()
  }, [selectedIds, deleteTransaction, loadTransactions, loadNetWorth])

  function openEditForm(transaction: Transaction) {
    setEditingTransaction(transaction)
    setFormOpen(true)
  }

  function openCreateForm() {
    setEditingTransaction(null)
    setFormOpen(true)
  }

  function openSplitDialog(transaction: Transaction) {
    setSplitTarget(transaction)
  }

  function toggleSelectMode() {
    setSelectMode((m) => !m)
    setSelectedIds(new Set())
  }

  function handleToggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function handleSelectAll() {
    if (selectedIds.size === transactions.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(transactions.map((t) => t.id)))
    }
  }

  const handleExport = useCallback((format: 'csv' | 'json', ids: string[]) => {
    exportTransactions(format, ids)
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

  const allSelected = transactions.length > 0 && selectedIds.size === transactions.length

  return (
    <div className="max-w-5xl mx-auto">
      {/* Page sub-header */}
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Transactions</h2>
          <p className="text-xs text-gray-500 mt-0.5">Track income, expenses, and transfers</p>
        </div>
        <div className="flex items-center gap-2">
          {accounts.length > 0 && !selectMode && (
            <Button
              variant="secondary"
              size="sm"
              onClick={toggleSelectMode}
              aria-label="Select transactions"
            >
              <CheckSquare className="h-3.5 w-3.5" />
              Select
            </Button>
          )}
          <Button variant="secondary" size="sm" onClick={() => setExportOpen(true)}>
            <Download className="h-3.5 w-3.5" />
            Export
          </Button>
          {!selectMode && (
            <Button size="sm" onClick={openCreateForm}>
              <Plus className="h-3.5 w-3.5" />
              Add Transaction
            </Button>
          )}
        </div>
      </div>

      {/* Total balance hero */}
      {accounts.length > 0 && (
        <div className="mb-4 flex items-center justify-between rounded-xl border border-brand-200 bg-brand-50 px-5 py-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-brand-600">
              Total Balance
            </p>
            <p className="mt-1.5 text-2xl font-bold text-brand-900">
              {netWorth === null ? '…' : formatMYR(netWorth)}
            </p>
            <p className="mt-1 text-xs text-brand-700/60">
              across {accounts.length} account{accounts.length !== 1 ? 's' : ''}
            </p>
          </div>
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-100">
            <Coins className="h-6 w-6 text-brand-600" />
          </div>
        </div>
      )}

      {/* Filter bar + summary — hidden until there's an account to work with. */}
      {accounts.length > 0 && (
      <>
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
          <div className="flex items-end gap-1">
            <div className="flex-1">
              <Select
                label="Category"
                options={categoryOptions}
                value={filters.categoryId ?? ''}
                onChange={(e) => setFilters({ categoryId: e.target.value || null })}
              />
            </div>
            <button
              type="button"
              onClick={() => setCategoryManagerOpen(true)}
              className="mb-[1px] flex-shrink-0 rounded-lg border border-gray-300 p-2 text-gray-400 hover:border-gray-400 hover:text-gray-600 transition-colors"
              aria-label="Manage categories"
              title="Manage categories"
            >
              <Settings className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[12rem] max-w-xs">
            <TagInput
              id="filter-tags"
              label="Tags"
              value={filters.tags}
              onChange={(tags) => setFilters({ tags })}
              suggestions={tags}
              allowCreate={false}
              placeholder="Filter by tags..."
            />
          </div>
          {/* Quick date filter buttons */}
          <div className="flex items-center gap-1.5 pb-0.5">
            <button
              onClick={() => setFilters(getMonthRange(0))}
              data-testid="filter-this-month"
              className="rounded-full border border-gray-200 px-3 py-1 text-xs text-gray-600 hover:bg-gray-50 hover:border-gray-300 transition-colors"
            >
              This Month
            </button>
            <button
              onClick={() => setFilters(getMonthRange(-1))}
              data-testid="filter-last-month"
              className="rounded-full border border-gray-200 px-3 py-1 text-xs text-gray-600 hover:bg-gray-50 hover:border-gray-300 transition-colors"
            >
              Last Month
            </button>
            <button
              onClick={() => setFilters({ dateFrom: '', dateTo: '' })}
              data-testid="filter-clear-dates"
              className="rounded-full border border-gray-200 px-3 py-1 text-xs text-gray-400 hover:bg-gray-50 hover:border-gray-300 transition-colors"
            >
              All Time
            </button>
          </div>
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
          summary.net >= 0 ? 'border-green-100 bg-green-50' : 'border-red-100 bg-red-50',
        )}>
          <div className="text-xs font-medium text-gray-500">Net</div>
          <p className={cn('mt-1 text-lg font-bold', summary.net >= 0 ? 'text-green-700' : 'text-red-700')}>
            {formatMYR(summary.net)}
          </p>
        </div>
      </div>
      </>
      )}

      {/* View filter pills — always visible so users in groups can see shared transactions */}
      <div className="mb-3 flex items-center gap-1.5">
        {(['all', 'mine', 'shared-with-me'] as const).map((v) => (
          <button
            key={v}
            onClick={() => setFilters({ view: v })}
            className={cn(
              'rounded-full border px-3 py-1 text-xs transition-colors capitalize',
              filters.view === v
                ? 'border-brand-500 bg-brand-50 text-brand-700'
                : 'border-gray-200 text-gray-600 hover:bg-gray-50 hover:border-gray-300',
            )}
          >
            {v === 'shared-with-me' ? 'Shared with me' : v.charAt(0).toUpperCase() + v.slice(1)}
          </button>
        ))}
      </div>

      {/* Multi-select action bar */}
      {selectMode && (
        <div
          data-testid="select-mode-bar"
          className="mb-4 flex items-center gap-3 rounded-xl border border-brand-200 bg-brand-50 px-4 py-2.5"
        >
          <input
            type="checkbox"
            checked={allSelected}
            onChange={handleSelectAll}
            className="h-4 w-4 rounded border-gray-300 text-brand-600 cursor-pointer"
            aria-label="Select all transactions"
          />
          <span className="text-sm text-gray-600">
            {selectedIds.size > 0
              ? `${selectedIds.size} selected`
              : 'Select transactions'}
          </span>
          <div className="ml-auto flex items-center gap-2">
            {selectedIds.size > 0 && (
              <Button
                variant="danger"
                size="sm"
                onClick={() => setBulkDeleteOpen(true)}
                data-testid="bulk-delete-btn"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete {selectedIds.size}
              </Button>
            )}
            <Button variant="secondary" size="sm" onClick={toggleSelectMode}>
              Cancel
            </Button>
          </div>
        </div>
      )}

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
            onSplit={openSplitDialog}
            selectMode={selectMode}
            selectedIds={selectedIds}
            onToggleSelect={handleToggleSelect}
          />
        )}
      </div>

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
        availableTags={tags}
        onSubmit={editingTransaction ? handleUpdateTransaction : handleAddTransaction}
      />

      <SplitDialog
        open={!!splitTarget}
        onOpenChange={(open) => { if (!open) setSplitTarget(null) }}
        transaction={splitTarget}
        currentUserId={currentUserId}
        onSaved={() => loadTransactions(filtersRef.current)}
      />

      <ExportModal
        open={exportOpen}
        onOpenChange={setExportOpen}
        transactions={transactions}
        accounts={accounts}
        categories={categories}
        onExport={handleExport}
      />

      <CategoryManager
        open={categoryManagerOpen}
        onOpenChange={setCategoryManagerOpen}
        categories={categories}
        onAdd={async (data) => { await addCategory(data) }}
        onDelete={async (id) => { await deleteCategory(id) }}
        onGetUsage={getCategoryUsage}
      />

      {/* Bulk delete confirmation */}
      <Modal
        open={bulkDeleteOpen}
        onOpenChange={(open) => { if (!open) setBulkDeleteOpen(false) }}
        title="Delete Transactions"
        description={`Delete ${selectedIds.size} selected transaction${selectedIds.size !== 1 ? 's' : ''}? This cannot be undone.`}
      >
        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" onClick={() => setBulkDeleteOpen(false)}>
            Cancel
          </Button>
          <Button variant="danger" onClick={handleBulkDelete} data-testid="confirm-bulk-delete">
            Delete {selectedIds.size}
          </Button>
        </div>
      </Modal>
    </div>
  )
}
