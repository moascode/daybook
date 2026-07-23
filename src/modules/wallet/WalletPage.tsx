import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { Plus, Wallet, TrendingUp, TrendingDown, Download, Coins, CheckSquare, Trash2, SlidersHorizontal, X, Users } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { DateRangeControl } from '@/components/ui/DateRangeControl'
import { TagInput } from '@/components/ui/TagInput'
import { Modal } from '@/components/ui/Modal'
import { EmptyState } from '@/components/ui/EmptyState'
import { TransactionList } from '@/modules/wallet/TransactionList'
import { TransactionForm } from '@/modules/wallet/TransactionForm'
import { ExportModal } from '@/modules/wallet/ExportModal'
import { CategoryManager } from '@/modules/wallet/CategoryManager'
import { BulkShareDialog } from '@/modules/wallet/BulkShareDialog'
import { ShareDialog } from '@/modules/wallet/ShareDialog'
import { useWallet } from '@/hooks/useWallet'
import { useWalletStore } from '@/stores/wallet.store'
import { useAppStore } from '@/stores/app.store'
import { useToastStore } from '@/stores/toast.store'
import { api } from '@/lib/api'
import { cn, formatMYR, errorMessage, monthRange, dateRangePreset } from '@/lib/utils'
import type { Transaction } from '@/types/wallet.types'
import type { TransactionFormData } from '@/modules/wallet/TransactionForm'

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
    getAccountBalances,
    addCategory,
    deleteCategory,
    getCategoryUsage,
  } = useWallet()
  const { addToast, removeToast } = useToastStore()

  const dataVersion = useWalletStore((s) => s.dataVersion)
  const [searchParams] = useSearchParams()
  const [formOpen, setFormOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [netWorth, setNetWorth] = useState<number | null>(null)
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null)

  // Category manager state
  const [categoryManagerOpen, setCategoryManagerOpen] = useState(false)

  // §6.4 filter bar: the occasional filters live in a collapsible section; the
  // sharing view only renders for users who are actually in a group (it stays
  // deep-linkable via ?view= either way).
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [hasGroups, setHasGroups] = useState(false)

  useEffect(() => {
    api.get<unknown[]>('/groups')
      .then((groups) => setHasGroups(groups.length > 0))
      .catch(() => {})
  }, [])

  // Multi-select state
  const [selectMode, setSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false)
  const [bulkShareOpen, setBulkShareOpen] = useState(false)

  // Share transaction state
  const [shareTarget, setShareTarget] = useState<Transaction | null>(null)

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

  // B1: free-text search — keep keystrokes local, push to filters.q debounced
  // so each character doesn't fire a server round-trip.
  const [searchDraft, setSearchDraft] = useState(filters.q)

  useEffect(() => {
    const handle = setTimeout(() => {
      if (searchDraft !== filtersRef.current.q) setFilters({ q: searchDraft })
    }, 300)
    return () => clearTimeout(handle)
  }, [searchDraft, setFilters])

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
    // Deep link from the Shared page (and elsewhere): /wallet?view=shared-with-me
    const viewParam = searchParams.get('view')
    if (viewParam === 'all' || viewParam === 'mine' || viewParam === 'shared-with-me' || viewParam === 'shared-with-others') {
      setFilters({ view: viewParam })
    }
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
    const balances = await getAccountBalances()
    setNetWorth(accounts.reduce((sum, a) => sum + (balances[a.id] ?? 0), 0))
  }, [accounts, getAccountBalances])

  useEffect(() => {
    let cancelled = false
    getAccountBalances().then((balances) => {
      if (!cancelled) setNetWorth(accounts.reduce((sum, a) => sum + (balances[a.id] ?? 0), 0))
    })
    return () => { cancelled = true }
  }, [accounts, getAccountBalances, dataVersion])

  const handleAddTransaction = useCallback(async (data: TransactionFormData) => {
    try {
      await addTransaction(data)
    } catch (err) {
      addToast({ message: errorMessage(err, 'Could not save transaction — please try again.'), duration: 4000 })
      throw err // keep the form open so the user can retry
    }
    await loadTransactions(filtersRef.current)
    await loadNetWorth()
    await loadTags()
  }, [addTransaction, loadTransactions, loadNetWorth, loadTags, addToast])

  const handleUpdateTransaction = useCallback(async (data: TransactionFormData) => {
    if (!editingTransaction) return
    try {
      await updateTransaction(editingTransaction.id, data)
      setEditingTransaction(null)
    } catch (err) {
      addToast({ message: errorMessage(err, 'Could not save transaction — please try again.'), duration: 4000 })
      throw err
    }
    await loadTransactions(filtersRef.current)
    await loadNetWorth()
    await loadTags()
  }, [editingTransaction, updateTransaction, loadTransactions, loadNetWorth, loadTags, addToast])

  // Single-transaction delete: no confirm dialog — delete immediately and offer
  // a 5-second undo toast, matching the tasks module. The row object is captured
  // in the closure, so the restore doesn't depend on the post-delete refetch.
  const undoToastIdRef = useRef<string | null>(null)
  const handleDeleteTransaction = useCallback(async (transaction: Transaction) => {
    try {
      await deleteTransaction(transaction.id)
    } catch (err) {
      addToast({ message: errorMessage(err, 'Could not delete transaction — please try again.'), duration: 4000 })
      return
    }
    await loadTransactions(filtersRef.current)
    await loadNetWorth()

    if (undoToastIdRef.current) removeToast(undoToastIdRef.current)
    undoToastIdRef.current = addToast({
      message: 'Transaction deleted',
      action: {
        label: 'Undo',
        onClick: async () => {
          undoToastIdRef.current = null
          try {
            await addTransaction({
              accountId: transaction.accountId,
              destinationAccountId: transaction.destinationAccountId,
              date: transaction.date,
              merchant: transaction.merchant,
              description: transaction.description,
              amount: transaction.amount,
              type: transaction.type,
              categoryId: transaction.categoryId,
              tags: transaction.tags,
              importHash: transaction.importHash,
            })
          } catch (err) {
            addToast({ message: errorMessage(err, 'Could not restore transaction — please try again.'), duration: 4000 })
          }
          await loadTransactions(filtersRef.current)
          await loadNetWorth()
        },
      },
      duration: 5000,
    })
  }, [deleteTransaction, addTransaction, loadTransactions, loadNetWorth, addToast, removeToast])

  const handleBulkDelete = useCallback(async () => {
    try {
      for (const id of Array.from(selectedIds)) {
        await deleteTransaction(id)
      }
    } catch (err) {
      addToast({ message: errorMessage(err, 'Could not delete all selected transactions — please try again.'), duration: 4000 })
    }
    setSelectedIds(new Set())
    setSelectMode(false)
    setBulkDeleteOpen(false)
    await loadTransactions(filtersRef.current)
    await loadNetWorth()
  }, [selectedIds, deleteTransaction, loadTransactions, loadNetWorth, addToast])
  function openEditForm(transaction: Transaction) {
    setEditingTransaction(transaction)
    setFormOpen(true)
  }

  function openCreateForm() {
    setEditingTransaction(null)
    setFormOpen(true)
  }

  function openShareDialog(transaction: Transaction) {
    setShareTarget(transaction)
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
    void exportTransactions(format, ids)
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

  // The Category dropdown doubles as the entry point to category management —
  // the "Manage categories…" footer option opens the manager without changing
  // the active filter (the select is controlled, so it snaps back).
  const MANAGE_CATEGORIES = '__manage__'
  const categoryOptions = [
    { value: '', label: 'All Categories' },
    ...categories.map((c) => ({ value: c.id, label: c.name })),
    { value: MANAGE_CATEGORIES, label: 'Manage categories…' },
  ]

  // Count of active occasional filters — shown on the Filters toggle so
  // URL-driven narrowing (?account=, ?view=) stays visible even collapsed.
  const activeFilterCount = [
    filters.type !== 'all',
    !!filters.accountId,
    !!filters.categoryId,
    filters.tags.length > 0,
    filters.view !== 'all',
  ].filter(Boolean).length

  const anyFilterActive =
    activeFilterCount > 0 || filters.q !== '' || dateRangePreset(filters) !== 'this-month'

  const clearAllFilters = useCallback(() => {
    setSearchDraft('')
    setFilters({
      ...monthRange(0),
      type: 'all',
      categoryId: null,
      accountId: null,
      tags: [],
      view: 'all',
      q: '',
    })
  }, [setFilters])

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
              Total Net Worth
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

      {/* Filter bar + summary — hidden until there's an account to work with
          (or a group: members can view shared transactions with no accounts). */}
      {(accounts.length > 0 || hasGroups) && (
      <>
      <div className="mb-4 rounded-xl border border-gray-200 bg-white p-4">
        {/* Search-first single row: search, date range, Filters toggle, Clear */}
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-[14rem] flex-1">
            <Input
              id="transaction-search"
              type="search"
              aria-label="Search transactions"
              placeholder="Search merchant or description..."
              value={searchDraft}
              onChange={(e) => setSearchDraft(e.target.value)}
              data-testid="transaction-search"
            />
          </div>
          <DateRangeControl
            value={{ dateFrom: filters.dateFrom, dateTo: filters.dateTo }}
            onChange={(range) => setFilters(range)}
          />
          <button
            type="button"
            onClick={() => setFiltersOpen((o) => !o)}
            data-testid="filter-toggle"
            aria-expanded={filtersOpen}
            className={cn(
              'flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors',
              filtersOpen || activeFilterCount > 0
                ? 'border-brand-300 bg-brand-50 text-brand-700'
                : 'border-gray-200 text-gray-600 hover:bg-gray-50',
            )}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            Filters
            {activeFilterCount > 0 && (
              <span
                data-testid="filter-count"
                className="flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-brand-500 px-1 text-xs font-semibold text-white"
              >
                {activeFilterCount}
              </span>
            )}
          </button>
          {anyFilterActive && (
            <button
              type="button"
              onClick={clearAllFilters}
              data-testid="filter-clear-all"
              className="flex items-center gap-1 rounded-lg px-3 py-2 text-sm text-gray-500 hover:bg-gray-50 hover:text-gray-700 transition-colors"
            >
              <X className="h-3.5 w-3.5" />
              Clear
            </button>
          )}
        </div>

        {/* Collapsible occasional filters */}
        {filtersOpen && (
          <div data-testid="filter-panel" className="mt-3 border-t border-gray-100 pt-3">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
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
                onChange={(e) => {
                  if (e.target.value === MANAGE_CATEGORIES) {
                    setCategoryManagerOpen(true)
                    return
                  }
                  setFilters({ categoryId: e.target.value || null })
                }}
              />
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
            {hasGroups && (
              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                <span className="mr-1 text-xs font-medium text-gray-500">Sharing</span>
                {(['all', 'mine', 'shared-with-me', 'shared-with-others'] as const).map((v) => (
                  <button
                    key={v}
                    onClick={() => setFilters({ view: v })}
                    className={cn(
                      'rounded-full border px-3 py-1 text-xs transition-colors',
                      filters.view === v
                        ? 'border-brand-500 bg-brand-50 text-brand-700'
                        : 'border-gray-200 text-gray-600 hover:bg-gray-50 hover:border-gray-300',
                    )}
                  >
                    {v === 'shared-with-me'
                      ? 'Shared with me'
                      : v === 'shared-with-others'
                        ? 'Shared with others'
                        : v.charAt(0).toUpperCase() + v.slice(1)}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Summary row */}
      <div className="mb-4 grid grid-cols-3 gap-3">
        <div className="rounded-lg border border-positive-100 bg-positive-50 px-4 py-3">
          <div className="flex items-center gap-1.5 text-xs font-medium text-positive-600">
            <TrendingUp className="h-3.5 w-3.5" /> Income
          </div>
          <p className="mt-1 text-lg font-bold text-positive-700">{formatMYR(summary.totalIncome)}</p>
        </div>
        <div className="rounded-lg border border-red-100 bg-red-50 px-4 py-3">
          <div className="flex items-center gap-1.5 text-xs font-medium text-red-600">
            <TrendingDown className="h-3.5 w-3.5" /> Expense
          </div>
          <p className="mt-1 text-lg font-bold text-red-700">{formatMYR(summary.totalExpense)}</p>
        </div>
        <div className={cn(
          'rounded-lg border px-4 py-3',
          summary.net >= 0 ? 'border-positive-100 bg-positive-50' : 'border-red-100 bg-red-50',
        )}>
          <div className="text-xs font-medium text-gray-500">Net</div>
          {/* Explicit sign so positive/negative isn't conveyed by colour alone */}
          <p className={cn('mt-1 text-lg font-bold', summary.net >= 0 ? 'text-positive-700' : 'text-red-700')}>
            {summary.net >= 0 ? '+' : ''}
            {formatMYR(summary.net)}
          </p>
        </div>
      </div>
      </>
      )}

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
              <>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => setBulkShareOpen(true)}
                  data-testid="bulk-share-btn"
                >
                  <Users className="h-3.5 w-3.5" />
                  Split {selectedIds.size}
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => setBulkDeleteOpen(true)}
                  data-testid="bulk-delete-btn"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete {selectedIds.size}
                </Button>
              </>
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
            onSplit={hasGroups ? openShareDialog : undefined}
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

      <ShareDialog
        open={!!shareTarget}
        onOpenChange={(open) => { if (!open) setShareTarget(null) }}
        transaction={shareTarget}
        currentUserId={currentUserId}
        onSaved={() => { setShareTarget(null); loadTransactions(filtersRef.current) }}
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

      <BulkShareDialog
        open={bulkShareOpen}
        onOpenChange={setBulkShareOpen}
        selectedTransactionIds={Array.from(selectedIds)}
        transactions={transactions}
        currentUserId={currentUserId}
        onSave={() => {
          setBulkShareOpen(false)
          setSelectedIds(new Set())
          setSelectMode(false)
          loadTransactions(filtersRef.current)
        }}
      />
    </div>
  )
}
