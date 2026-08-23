import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { Plus, Wallet, TrendingUp, TrendingDown, Download, Upload, CheckSquare, Trash2, SlidersHorizontal, X, Users, Tag, Filter } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'
import { DateRangeControl } from '@/components/ui/DateRangeControl'
import { TagInput } from '@/components/ui/TagInput'
import { ConfirmDeleteModal } from '@/components/ui/ConfirmDeleteModal'
import { NetWorthBanner } from '@/components/ui/NetWorthBanner'
import { WelcomeCard } from '@/components/ui/WelcomeCard'
import { EmptyState } from '@/components/ui/EmptyState'
import { TransactionList } from '@/modules/wallet/TransactionList'
import { TransactionForm } from '@/modules/wallet/TransactionForm'
import { ExportModal } from '@/modules/wallet/ExportModal'
import { CategoryManager } from '@/modules/wallet/CategoryManager'
import { BulkSplitDialog } from '@/modules/wallet/BulkSplitDialog'
import { BulkEditDialog } from '@/modules/wallet/BulkEditDialog'
import { SplitDialog } from '@/modules/wallet/SplitDialog'
import { LinkTransferDialog } from '@/modules/wallet/LinkTransferDialog'
import { useWallet, countableAmount } from '@/hooks/useWallet'
import { useWalletStore } from '@/stores/wallet.store'
import { useAppStore } from '@/stores/app.store'
import { useToastStore } from '@/stores/toast.store'
import { useCrudModal } from '@/hooks/useCrudModal'
import { api } from '@/lib/api'
import { cn, formatMYR, errorMessage, monthRange, dateRangePreset } from '@/lib/utils'
import { UNCATEGORISED } from '@/modules/wallet/dashboard/insights'
import type { Transaction } from '@/types/wallet.types'
import type { TransactionFormData } from '@/modules/wallet/TransactionForm'

export function WalletPage() {
  const currentUserId = useAppStore((s) => s.user?.id ?? '')
  const hasAnthropicKey = useAppStore((s) => s.hasAnthropicKey)
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
    bulkUpdateTransactions,
    linkTransfer,
    exportTransactions,
    getAccountBalances,
    addCategory,
    deleteCategory,
    getCategoryUsage,
  } = useWallet()
  const { addToast, removeToast } = useToastStore()

  const dataVersion = useWalletStore((s) => s.dataVersion)
  const [searchParams] = useSearchParams()
  const crud = useCrudModal<Transaction>()
  const [exportOpen, setExportOpen] = useState(false)
  const [netWorth, setNetWorth] = useState<number | null>(null)

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
  const [bulkSplitOpen, setBulkSplitOpen] = useState(false)
  const [bulkEditOpen, setBulkEditOpen] = useState(false)

  // Split transaction state
  const [splitTarget, setSplitTarget] = useState<Transaction | null>(null)

  // Link-as-transfer picker state
  const [linkTarget, setLinkTarget] = useState<Transaction | null>(null)

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
  //
  // §3: countableAmount, not t.amount — the same figure the day headers below,
  // the dashboard and the budgets all report. Summing the ledger amount here
  // double-counted splits (a RM30 expense split entirely onto someone else reads
  // "your share RM 0.00" on its own row while adding RM30 to the total directly
  // above it) and counted the creditor's balance-only settlement leg as income.
  const summary = useMemo(() => {
    let totalIncome = 0
    let totalExpense = 0
    for (const t of transactions) {
      const amt = countableAmount(t)
      if (t.type === 'income') totalIncome += amt
      else if (t.type === 'expense') totalExpense += amt
    }
    return { totalIncome, totalExpense, net: totalIncome - totalExpense }
  }, [transactions])

  useEffect(() => {
    const accountParam = searchParams.get('account')
    // U-10: arriving via ?account= applies a filter that lives in the collapsed
    // panel — open it so the narrowing is visible (the chip below also shows it).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (accountParam) { setFilters({ accountId: accountParam }); setFiltersOpen(true) }
    // Deep link from the Shared page (and elsewhere): /wallet?view=shared-with-me
    const viewParam = searchParams.get('view')
    if (viewParam === 'all' || viewParam === 'mine' || viewParam === 'shared-with-me' || viewParam === 'shared-with-others') {
      setFilters({ view: viewParam })
    }
    // ?range=all widens to all time. A caller that links to a specific set of
    // rows cannot know which month they fall in, and the default current-month
    // range would silently hide them.
    if (searchParams.get('range') === 'all') {
      setFilters({ dateFrom: '', dateTo: '' })
    }
    // ?dateFrom=&dateTo= pin an explicit window. The dashboard links here for a
    // month that is not necessarily the current one, so it states the range
    // rather than relying on the default.
    const from = searchParams.get('dateFrom')
    const to = searchParams.get('dateTo')
    if (from && to) {
      setFilters({ dateFrom: from, dateTo: to })
    }
    // ?category=<id> narrows to one category, from a dashboard breakdown row.
    // Like ?account= it lives in the collapsed panel, so open it — otherwise
    // the list is filtered with no visible reason why.
    const categoryParam = searchParams.get('category')
    if (categoryParam) {
      setFilters({ categoryId: categoryParam })
      setFiltersOpen(true)
    }
    // ?txn=<id> rings and scrolls to one row (see TransactionList). It is a
    // highlight, not a filter: links that use it pair it with view=all&range=all
    // so the row is inside the result set to begin with.
    // ?split=1 alongside it opens the split dialog once the row has loaded —
    // that is the Re-split action on a rejected claim, which has to reach a
    // dialog that lives here and needs a whole Transaction to open.
  }, [searchParams, setFilters])

  useEffect(() => {
    loadAccounts()
    loadCategories()
    loadTags()
  }, [loadAccounts, loadCategories, loadTags])

  // Deferred until the transactions arrive: the dialog needs the row, not just
  // its id, and on a cold load the list is still empty when the params are read.
  const splitParam = searchParams.get('split')
  const txnParam = searchParams.get('txn')
  useEffect(() => {
    if (splitParam !== '1' || !txnParam) return
    const target = transactions.find((t) => t.id === txnParam)
    if (target) setSplitTarget(target) // eslint-disable-line react-hooks/set-state-in-effect
  }, [splitParam, txnParam, transactions])

  useEffect(() => {
    // dataVersion: re-fetch when data changed out-of-band
    loadTransactions({ ...filters, view: filters.view })
  }, [filters, loadTransactions, dataVersion])

  // Net worth is what YOU own, so shared-in accounts are excluded: `accounts`
  // carries co-members' accounts too, and summing those reported a partner's
  // money as ours. They stay in the filters and the list — only the total is
  // ours alone. Mirrors AccountsPage, which had the same defect.
  const ownAccounts = useMemo(() => accounts.filter((a) => !a.isShared), [accounts])

  // Balances are independent of the active filters, so this is keyed on
  // `ownAccounts` (and dataVersion) — NOT on the filtered transaction list.
  // Mutations refresh it explicitly below.
  const loadNetWorth = useCallback(async () => {
    const balances = await getAccountBalances()
    setNetWorth(ownAccounts.reduce((sum, a) => sum + (balances[a.id] ?? 0), 0))
  }, [ownAccounts, getAccountBalances])

  useEffect(() => {
    let cancelled = false
    getAccountBalances().then((balances) => {
      if (!cancelled) setNetWorth(ownAccounts.reduce((sum, a) => sum + (balances[a.id] ?? 0), 0))
    })
    return () => { cancelled = true }
  }, [ownAccounts, getAccountBalances, dataVersion])

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
    if (!crud.editingItem) return
    try {
      await updateTransaction(crud.editingItem.id, data)
      crud.closeForm(false)
    } catch (err) {
      addToast({ message: errorMessage(err, 'Could not save transaction — please try again.'), duration: 4000 })
      throw err
    }
    await loadTransactions(filtersRef.current)
    await loadNetWorth()
    await loadTags()
  }, [crud, updateTransaction, loadTransactions, loadNetWorth, loadTags, addToast])

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

  const handleLinkTransfer = useCallback(async (twinId: string) => {
    if (!linkTarget) return
    try {
      await linkTransfer(linkTarget.id, twinId)
    } catch (err) {
      addToast({ message: errorMessage(err, 'Could not link the transactions — please try again.'), duration: 4000 })
      return // keep the picker open so the user can pick another candidate
    }
    setLinkTarget(null)
    addToast({ message: 'Linked as one transfer', duration: 4000 })
    await loadTransactions(filtersRef.current)
    await loadNetWorth()
  }, [linkTarget, linkTransfer, loadTransactions, loadNetWorth, addToast])

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

  const handleBulkEdit = useCallback(
    async (changes: {
      categoryId?: string | null
      tags?: { mode: 'add' | 'replace' | 'remove'; values: string[] }
    }) => {
      // Errors propagate to the dialog, which shows them inline and stays open
      // so the selection is not lost — unlike a toast, which would leave the
      // user looking at a closed dialog wondering whether anything happened.
      const { updated, skippedTransfers } = await bulkUpdateTransactions(Array.from(selectedIds), changes)

      setSelectedIds(new Set())
      setSelectMode(false)
      // A re-category can move rows out of the active filter, so reload rather
      // than patching the store.
      await loadTransactions(filtersRef.current)
      await loadTags()

      addToast({
        message:
          `Updated ${updated} transaction${updated !== 1 ? 's' : ''}` +
          (skippedTransfers > 0
            ? ` — ${skippedTransfers} transfer${skippedTransfers !== 1 ? 's' : ''} skipped`
            : ''),
        duration: 4000,
      })
    },
    [selectedIds, bulkUpdateTransactions, loadTransactions, loadTags, addToast],
  )

  // One bulk-update call per distinct suggested category (typically 2-5
  // requests, not one per row) — docs/auto-categorisation-plan.md §4.2.
  const handleApplySuggestions = useCallback(
    async (groups: Array<{ categoryId: string; transactionIds: string[] }>) => {
      let updated = 0
      let skippedTransfers = 0
      let failedGroups = 0
      // Each group is its own request, so a failure part-way through leaves the
      // earlier groups already written. Never rethrow: the refresh below has to
      // run either way, or the list keeps showing rows that HAVE been
      // categorised as though nothing happened.
      for (const g of groups) {
        try {
          const res = await bulkUpdateTransactions(g.transactionIds, { categoryId: g.categoryId })
          updated += res.updated
          skippedTransfers += res.skippedTransfers
        } catch {
          failedGroups += 1
        }
      }

      setSelectedIds(new Set())
      setSelectMode(false)
      await loadTransactions(filtersRef.current)
      await loadTags()

      addToast({
        message:
          `Updated ${updated} transaction${updated !== 1 ? 's' : ''}` +
          (skippedTransfers > 0
            ? ` — ${skippedTransfers} transfer${skippedTransfers !== 1 ? 's' : ''} skipped`
            : '') +
          (failedGroups > 0
            ? ` — ${failedGroups} merchant group${failedGroups !== 1 ? 's' : ''} failed`
            : ''),
        duration: 4000,
      })
    },
    [bulkUpdateTransactions, loadTransactions, loadTags, addToast],
  )

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
    { value: UNCATEGORISED, label: 'Uncategorised' },
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

  // U-10: surface the occasional (collapsed) filters as removable chips so a
  // deep-link like ?account= doesn't silently narrow the list with no visible,
  // clearable indicator. Date range and search have their own always-visible
  // controls, so they're intentionally not chipped here.
  const filterChips = useMemo(() => {
    const chips: { key: string; label: string; onClear: () => void }[] = []
    if (filters.type !== 'all') {
      chips.push({
        key: 'type',
        label: `Type: ${filters.type.charAt(0).toUpperCase() + filters.type.slice(1)}`,
        onClear: () => setFilters({ type: 'all' }),
      })
    }
    if (filters.accountId) {
      const name = accounts.find((a) => a.id === filters.accountId)?.name ?? 'Account'
      chips.push({ key: 'account', label: `Account: ${name}`, onClear: () => setFilters({ accountId: null }) })
    }
    if (filters.categoryId) {
      const name =
        filters.categoryId === UNCATEGORISED
          ? 'Uncategorised'
          : (categories.find((c) => c.id === filters.categoryId)?.name ?? 'Category')
      chips.push({ key: 'category', label: `Category: ${name}`, onClear: () => setFilters({ categoryId: null }) })
    }
    for (const tag of filters.tags) {
      chips.push({ key: `tag:${tag}`, label: `Tag: ${tag}`, onClear: () => setFilters({ tags: filters.tags.filter((t) => t !== tag) }) })
    }
    if (filters.view !== 'all') {
      const vlabel =
        filters.view === 'shared-with-me' ? 'Shared with me'
          : filters.view === 'shared-with-others' ? 'Shared with others'
            : filters.view.charAt(0).toUpperCase() + filters.view.slice(1)
      chips.push({ key: 'view', label: `View: ${vlabel}`, onClear: () => setFilters({ view: 'all' }) })
    }
    return chips
  }, [filters, accounts, categories, setFilters])

  // An empty list is ambiguous: no data, or data hidden by a narrowing filter?
  // Two filters are on by default or arrive via deep link and are therefore the
  // usual culprits — the date range and the sharing view. Name whichever are
  // actually narrowing and offer the matching escape; naming only the date range
  // actively misleads when the view is what is hiding the rows.
  const dateRangeLabel = useMemo(() => {
    const preset = dateRangePreset({ dateFrom: filters.dateFrom, dateTo: filters.dateTo })
    if (preset === 'all-time') return null
    if (preset === 'this-month') return 'this month'
    if (preset === 'last-month') return 'last month'
    return `${filters.dateFrom || '…'} to ${filters.dateTo || '…'}`
  }, [filters.dateFrom, filters.dateTo])

  const viewLabel = useMemo(() => {
    if (filters.view === 'all') return null
    if (filters.view === 'shared-with-me') return 'Shared with me'
    if (filters.view === 'shared-with-others') return 'Shared with others'
    return 'Mine'
  }, [filters.view])

  const allSelected = transactions.length > 0 && selectedIds.size === transactions.length

  return (
    <div className="max-w-5xl mx-auto">
      {/* Page sub-header */}
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-fg">Transactions</h2>
          <p className="text-xs text-fg-subtle mt-0.5">Track income, expenses, and transfers</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
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
          {/* Category management had exactly one entry point: a "Manage
              categories…" option inside the Category filter dropdown, itself
              inside the collapsed filter panel. Nobody looks three levels down
              a filter to create something, so adding a category read as
              impossible. Same modal, surfaced in the toolbar. */}
          {!selectMode && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setCategoryManagerOpen(true)}
              data-testid="manage-categories"
            >
              <Tag className="h-3.5 w-3.5" />
              Categories
            </Button>
          )}
          <Button variant="secondary" size="sm" onClick={() => setExportOpen(true)}>
            <Download className="h-3.5 w-3.5" />
            Export
          </Button>
          <Link to="/wallet/import">
            <Button variant="secondary" size="sm" data-testid="import-csv-btn">
              <Upload className="h-3.5 w-3.5" />
              Import CSV
            </Button>
          </Link>
          {!selectMode && (
            <Button size="sm" onClick={crud.openCreate}>
              <Plus className="h-3.5 w-3.5" />
              Add Transaction
            </Button>
          )}
        </div>
      </div>

      {/* U-16: first-run orientation for a wallet with no accounts yet. */}
      {accounts.length === 0 && (
        <WelcomeCard
          settingKey="onboarding_dismissed_wallet"
          icon={<Wallet className="h-5 w-5" />}
          title="Track your money"
          className="mb-4"
        >
          Start by creating an <span className="font-medium">account</span> (cash, bank, card,
          e-wallet…), then record income and expenses against it. The Dashboard charts your cash
          flow, and CSV import brings in bank statements automatically.
        </WelcomeCard>
      )}

      {/* Total balance hero — the caption must count the same set the figure
          was summed over, i.e. owned accounts only. */}
      {ownAccounts.length > 0 && (
        <NetWorthBanner netWorth={netWorth} accountCount={ownAccounts.length} className="mb-4" />
      )}

      {/* Filter bar + summary — hidden until there's an account to work with
          (or a group: members can view shared transactions with no accounts). */}
      {(accounts.length > 0 || hasGroups) && (
      <>
      <div className="card card-pad mb-4">
        {/* Search-first single row: search, date range, Filters toggle, Clear */}
        <div className="filters">
          <div className="filter-field">
            <Filter className="h-3.5 w-3.5" />
            <input
              id="transaction-search"
              type="search"
              aria-label="Search transactions"
              data-testid="transaction-search"
              placeholder={`Filter these ${transactions.length} transactions…`}
              value={searchDraft}
              onChange={(e) => setSearchDraft(e.target.value)}
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
              'filter-btn',
              filtersOpen || activeFilterCount > 0
                ? 'border-brand-300 bg-brand-50 text-brand-700 hover:bg-brand-100'
                : 'hover:bg-surface-hover hover:text-fg',
            )}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            Filters
            {activeFilterCount > 0 && (
              <span className="count" data-testid="filter-count">
                {activeFilterCount}
              </span>
            )}
          </button>
          {anyFilterActive && (
            <button
              type="button"
              onClick={clearAllFilters}
              data-testid="filter-clear-all"
              className="btn btn-quiet"
            >
              <X className="h-3.5 w-3.5" />
              Clear
            </button>
          )}
        </div>

        {/* U-10: removable chips for the active occasional filters */}
        {filterChips.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5" data-testid="active-filter-chips">
            {filterChips.map((chip) => (
              <span
                key={chip.key}
                data-testid="filter-chip"
                className="chip chip-mute"
              >
                {chip.label}
                <button
                  type="button"
                  onClick={chip.onClear}
                  aria-label="Remove filter"
                  title={`Remove ${chip.label}`}
                  className="ml-0.5 rounded-full p-0.5 hover:bg-surface-hover"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}

        {/* Collapsible occasional filters */}
        {filtersOpen && (
          <div data-testid="filter-panel" className="mt-3 border-t border-line-subtle pt-3">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Select
                label="Type"
                data-testid="filter-type"
                options={typeOptions}
                value={filters.type}
                onChange={(e) => setFilters({ type: e.target.value as typeof filters.type })}
              />
              <Select
                label="Account"
                data-testid="filter-account"
                options={accountOptions}
                value={filters.accountId ?? ''}
                onChange={(e) => setFilters({ accountId: e.target.value || null })}
              />
              <Select
                label="Category"
                data-testid="filter-category"
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
                testId="filter-tags"
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
                <span className="mr-1 text-xs font-medium text-fg-subtle">Sharing</span>
                {(['all', 'mine', 'shared-with-me', 'shared-with-others'] as const).map((v) => (
                  <button
                    key={v}
                    onClick={() => setFilters({ view: v })}
                    className={cn(
                      'rounded-full border px-3 py-1 text-xs transition-colors',
                      filters.view === v
                        ? 'border-brand-500 bg-brand-50 text-brand-700'
                        : 'border-line text-fg-muted hover:bg-surface-sunken hover:border-line-strong',
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
      <div className="grid g3 g-1-on-mobile mb-4">
        <div className="card stat-card">
          <div className="stat-topline">
            <span className="stat-icon bg-pos-bg text-pos-fg">
              <TrendingUp className="h-3.5 w-3.5" />
            </span>
            <span className="stat-label">Income</span>
          </div>
          <p className={cn('stat-value', 'pos')} data-testid="summary-income">{formatMYR(summary.totalIncome)}</p>
        </div>
        <div className="card stat-card">
          <div className="stat-topline">
            <span className="stat-icon bg-neg-bg text-neg-fg">
              <TrendingDown className="h-3.5 w-3.5" />
            </span>
            <span className="stat-label">Expense</span>
          </div>
          <p className={cn('stat-value', 'neg')} data-testid="summary-expense">{formatMYR(summary.totalExpense)}</p>
        </div>
        <div className="card stat-card">
          <div className="stat-topline">
            <span className={cn('stat-icon', summary.net >= 0 ? 'bg-pos-bg text-pos-fg' : 'bg-neg-bg text-neg-fg')}>
              <Wallet className="h-3.5 w-3.5" />
            </span>
            <span className="stat-label">Net</span>
          </div>
          {/* Explicit sign so positive/negative isn't conveyed by colour alone */}
          <p className={cn('stat-value', summary.net >= 0 ? 'pos' : 'neg')} data-testid="summary-net">
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
            className="h-4 w-4 rounded border-line-strong text-brand-600 cursor-pointer"
            aria-label="Select all transactions"
          />
          <span className="text-sm text-fg-muted">
            {selectedIds.size > 0
              ? `${selectedIds.size} selected`
              : 'Select transactions'}
          </span>
          <div className="ml-auto flex items-center gap-2">
            {selectedIds.size > 0 && (
              <>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setBulkEditOpen(true)}
                  data-testid="bulk-edit-btn"
                >
                  <Tag className="h-3.5 w-3.5" />
                  Categorise {selectedIds.size}
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => setBulkSplitOpen(true)}
                  data-testid="bulk-split-btn"
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
      <div className="card overflow-hidden px-4 py-2 sm:px-5">
        {/* "Create an account first" is onboarding advice, and it is only true
            for a user who has nothing at all. A group member with no account of
            their own still has other people's splits to read, so for them the
            date-range hint below is the useful message. */}
        {transactions.length === 0 && accounts.length === 0 && !hasGroups ? (
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
          <div className="py-16 text-center text-sm text-fg-faint" data-testid="transactions-empty">
            {dateRangeLabel || viewLabel ? (
              <>
                <p>
                  No transactions
                  {viewLabel && (
                    <> under <span className="font-medium text-fg-subtle">{viewLabel}</span></>
                  )}
                  {dateRangeLabel && (
                    <> in <span className="font-medium text-fg-subtle">{dateRangeLabel}</span></>
                  )}
                  .
                </p>
                <div className="mt-2 flex flex-wrap items-center justify-center gap-1">
                  {dateRangeLabel && (
                    <button
                      type="button"
                      onClick={() => setFilters({ dateFrom: '', dateTo: '' })}
                      data-testid="empty-show-all-time"
                      className="rounded-lg px-3 py-1.5 text-sm font-medium text-brand-600 hover:bg-brand-50 hover:underline"
                    >
                      Search all time instead
                    </button>
                  )}
                  {viewLabel && (
                    <button
                      type="button"
                      onClick={() => setFilters({ view: 'all' })}
                      data-testid="empty-show-all-views"
                      className="rounded-lg px-3 py-1.5 text-sm font-medium text-brand-600 hover:bg-brand-50 hover:underline"
                    >
                      Show all transactions
                    </button>
                  )}
                </div>
              </>
            ) : (
              'No transactions match your current filters.'
            )}
          </div>
        ) : (
          <TransactionList
            transactions={transactions}
            accounts={accounts}
            categories={categories}
            onEdit={crud.openEdit}
            onDelete={handleDeleteTransaction}
            onSplit={hasGroups ? openSplitDialog : undefined}
            selectMode={selectMode}
            selectedIds={selectedIds}
            onToggleSelect={handleToggleSelect}
            highlightId={searchParams.get('txn') ?? undefined}
          />
        )}
      </div>

      <TransactionForm
        open={crud.formOpen}
        onOpenChange={crud.closeForm}
        transaction={crud.editingItem}
        accounts={accounts}
        categories={categories}
        defaultAccountId={filters.accountId}
        availableTags={tags}
        onSubmit={crud.editingItem ? handleUpdateTransaction : handleAddTransaction}
        onLinkTransfer={
          crud.editingItem && !crud.editingItem.hasSplits
            ? () => { setLinkTarget(crud.editingItem); crud.closeForm(false) }
            : undefined
        }
      />

      <LinkTransferDialog
        open={!!linkTarget}
        onOpenChange={(open) => { if (!open) setLinkTarget(null) }}
        transaction={linkTarget}
        accounts={accounts}
        onLink={handleLinkTransfer}
      />

      <SplitDialog
        open={!!splitTarget}
        onOpenChange={(open) => { if (!open) setSplitTarget(null) }}
        transaction={splitTarget}
        currentUserId={currentUserId}
        onSaved={() => { setSplitTarget(null); loadTransactions(filtersRef.current) }}
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
      <ConfirmDeleteModal
        open={bulkDeleteOpen}
        onOpenChange={(open) => { if (!open) setBulkDeleteOpen(false) }}
        title={`Delete ${selectedIds.size} transaction${selectedIds.size !== 1 ? 's' : ''}?`}
        description="This cannot be undone."
        onConfirm={handleBulkDelete}
        confirmLabel={`Delete ${selectedIds.size}`}
        confirmTestId="confirm-bulk-delete"
      />

      {/* Mounted only while open, so the dialog's fields reset by unmounting
          rather than via a state-resetting effect. */}
      {bulkEditOpen && (
        <BulkEditDialog
          open
          onOpenChange={setBulkEditOpen}
          selectedTransactionIds={Array.from(selectedIds)}
          transactions={transactions}
          categories={categories}
          availableTags={tags}
          hasAiKey={hasAnthropicKey}
          onApply={handleBulkEdit}
          onApplySuggestions={handleApplySuggestions}
        />
      )}

      <BulkSplitDialog
        open={bulkSplitOpen}
        onOpenChange={setBulkSplitOpen}
        selectedTransactionIds={Array.from(selectedIds)}
        transactions={transactions}
        currentUserId={currentUserId}
        onSave={() => {
          setBulkSplitOpen(false)
          setSelectedIds(new Set())
          setSelectMode(false)
          loadTransactions(filtersRef.current)
        }}
      />
    </div>
  )
}
