import { useCallback } from 'react'
import { api } from '@/lib/api'
import { useWalletStore } from '@/stores/wallet.store'
import { todayISO } from '@/lib/utils'
import type { Account, Transaction, Category, TransactionType, Budget, RecurringTransaction, RecurrenceFrequency, Goal } from '@/types/wallet.types'

function parseTags(raw: string | null | undefined): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return [raw]
  }
}

// ── DB row types (snake_case from PGlite) ───────────

interface AccountRow {
  id: string
  name: string
  description: string
  currency: string
  type: string
  color: string
  icon: string
  opening_balance: number
  created_at: string
}

interface TransactionRow {
  id: string
  account_id: string
  destination_account_id: string | null
  date: string
  merchant: string
  description: string
  amount: number
  type: string
  category_id: string | null
  tag: string
  import_hash: string
  created_at: string
  updated_at: string
}

interface CategoryRow {
  id: string
  name: string
  icon: string
  color: string
  type: string
}

// ── Row → Model mappers ─────────────────────────────

function mapAccount(row: AccountRow): Account {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? '',
    currency: row.currency,
    type: row.type as Account['type'],
    color: row.color,
    icon: row.icon,
    openingBalance: row.opening_balance ?? 0,
    createdAt: row.created_at,
  }
}

function mapTransaction(row: TransactionRow): Transaction {
  return {
    id: row.id,
    accountId: row.account_id,
    destinationAccountId: row.destination_account_id,
    date: row.date,
    merchant: row.merchant ?? '',
    description: row.description ?? '',
    amount: row.amount,
    type: row.type as TransactionType,
    categoryId: row.category_id,
    tags: parseTags(row.tag),
    importHash: row.import_hash ?? '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapCategory(row: CategoryRow): Category {
  return {
    id: row.id,
    name: row.name,
    icon: row.icon,
    color: row.color,
    type: row.type as Category['type'],
  }
}

interface BudgetRow {
  id: string
  category_id: string
  limit_amount: number
  created_at: string
  updated_at: string
}

interface RecurringRow {
  id: string
  account_id: string
  amount: number
  merchant: string
  type: string
  category_id: string | null
  frequency: string
  next_due_date: string
  created_at: string
  updated_at: string
}

function mapBudget(row: BudgetRow): Budget {
  return {
    id: row.id,
    categoryId: row.category_id,
    limitAmount: row.limit_amount,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapRecurring(row: RecurringRow): RecurringTransaction {
  return {
    id: row.id,
    accountId: row.account_id,
    amount: row.amount,
    merchant: row.merchant ?? '',
    type: row.type as TransactionType,
    categoryId: row.category_id,
    frequency: row.frequency as RecurrenceFrequency,
    nextDueDate: row.next_due_date,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

// ── Input types ─────────────────────────────────────

interface AccountInput {
  name: string
  description?: string
  currency?: string
  type?: Account['type']
  color?: string
  icon?: string
  openingBalance?: number
}

interface TransactionInput {
  accountId: string
  destinationAccountId?: string | null
  date?: string
  merchant?: string
  description?: string
  amount: number
  type: TransactionType
  categoryId?: string | null
  tags?: string[]
  importHash?: string
}

export interface CategoryInput {
  name: string
  type: 'income' | 'expense' | 'both'
  color?: string
  icon?: string
}

interface BudgetInput {
  categoryId: string
  limitAmount: number
}

interface RecurringInput {
  accountId: string
  amount: number
  merchant?: string
  type?: TransactionType
  categoryId?: string | null
  frequency: RecurrenceFrequency
  nextDueDate: string
}

interface GoalInput {
  name: string
  targetAmount: number
  accountId: string
}

interface GoalRow {
  id: string
  name: string
  target_amount: number
  account_id: string
  created_at: string
  updated_at: string
}

function mapGoal(row: GoalRow): Goal {
  return {
    id: row.id,
    name: row.name,
    targetAmount: row.target_amount,
    accountId: row.account_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

interface TransactionFilters {
  dateFrom?: string
  dateTo?: string
  type?: 'all' | TransactionType
  categoryId?: string | null
  accountId?: string | null
  tags?: string[]
}

// ── Hook ────────────────────────────────────────────

export function useWallet() {
  const store = useWalletStore()

  // ── Load operations ─────────────────────────────

  const loadAccounts = useCallback(async () => {
    const rows = await api.get<AccountRow[]>('/accounts')
    const accounts = rows.map(mapAccount)
    useWalletStore.getState().setAccounts(accounts)
    return accounts
  }, [])

  const loadCategories = useCallback(async () => {
    const rows = await api.get<CategoryRow[]>('/categories')
    const categories = rows.map(mapCategory)
    useWalletStore.getState().setCategories(categories)
    return categories
  }, [])

  const loadTags = useCallback(async (): Promise<string[]> => {
    const tags = await api.get<string[]>('/tags')
    useWalletStore.getState().setTags(tags)
    return tags
  }, [])

  // ── Category CRUD ────────────────────────────────

  const addCategory = useCallback(async (data: CategoryInput): Promise<Category> => {
    const row = await api.post<CategoryRow>('/categories', data)
    const category = mapCategory(row)
    useWalletStore.getState().setCategories([...useWalletStore.getState().categories, category])
    return category
  }, [])

  const deleteCategory = useCallback(async (id: string): Promise<void> => {
    await api.delete(`/categories/${id}`)
    const s = useWalletStore.getState()
    s.setCategories(s.categories.filter((c) => c.id !== id))
    // ON DELETE SET NULL on transactions.category_id — mirror in store
    s.setTransactions(s.transactions.map((t) => t.categoryId === id ? { ...t, categoryId: null } : t))
    // ON DELETE CASCADE on budgets.category_id — remove from store
    s.setBudgets(s.budgets.filter((b) => b.categoryId !== id))
  }, [])

  const getCategoryUsage = useCallback(async (id: string): Promise<number> => {
    const { count } = await api.get<{ count: number }>(`/categories/${id}/usage`)
    return count
  }, [])

  const loadTransactions = useCallback(async (filters?: TransactionFilters) => {
    const qs = new URLSearchParams()
    if (filters?.dateFrom) qs.set('dateFrom', filters.dateFrom)
    if (filters?.dateTo) qs.set('dateTo', filters.dateTo)
    if (filters?.type && filters.type !== 'all') qs.set('type', filters.type)
    if (filters?.categoryId) qs.set('categoryId', filters.categoryId)
    if (filters?.accountId) qs.set('accountId', filters.accountId)
    if (filters?.tags?.length) {
      for (const t of filters.tags) qs.append('tags', t)
    }

    const query = qs.toString()
    const rows = await api.get<TransactionRow[]>(`/transactions${query ? `?${query}` : ''}`)
    const transactions = rows.map(mapTransaction)
    useWalletStore.getState().setTransactions(transactions)
    return transactions
  }, [])

  // ── Account balance ─────────────────────────────

  const getAccountBalance = useCallback(async (accountId: string): Promise<number> => {
    const { balance } = await api.get<{ balance: number }>(`/accounts/${accountId}/balance`)
    return balance
  }, [])

  // ── Account CRUD ────────────────────────────────

  const addAccount = useCallback(async (data: AccountInput): Promise<Account> => {
    const row = await api.post<AccountRow>('/accounts', data)
    const account = mapAccount(row)
    useWalletStore.getState().addAccount(account)
    return account
  }, [])

  const updateAccount = useCallback(async (id: string, data: Partial<AccountInput>): Promise<void> => {
    await api.patch<AccountRow>(`/accounts/${id}`, data)
    useWalletStore.getState().updateAccount(id, data as Partial<Account>)
  }, [])

  const deleteAccount = useCallback(async (id: string): Promise<void> => {
    // CASCADE will delete transactions automatically
    await api.delete(`/accounts/${id}`)
    useWalletStore.getState().removeAccount(id)
  }, [])

  // ── Transaction CRUD ────────────────────────────

  const addTransaction = useCallback(async (data: TransactionInput): Promise<Transaction> => {
    const row = await api.post<TransactionRow>('/transactions', {
      ...data,
      date: data.date ?? todayISO(),
      tag: JSON.stringify(data.tags ?? []),
    })
    const transaction = mapTransaction(row)
    useWalletStore.getState().addTransaction(transaction)
    return transaction
  }, [])

  const updateTransaction = useCallback(async (id: string, data: Partial<TransactionInput>): Promise<void> => {
    const payload: Record<string, unknown> = { ...data }
    if ('tags' in data) {
      payload.tag = JSON.stringify(data.tags ?? [])
      delete payload.tags
    }
    const row = await api.patch<TransactionRow>(`/transactions/${id}`, payload)
    useWalletStore.getState().updateTransaction(id, mapTransaction(row))
  }, [])

  const deleteTransaction = useCallback(async (id: string): Promise<void> => {
    await api.delete(`/transactions/${id}`)
    useWalletStore.getState().removeTransaction(id)
  }, [])

  // ── Batch import ────────────────────────────────

  const importTransactions = useCallback(async (
    transactions: TransactionInput[]
  ): Promise<number> => {
    if (transactions.length === 0) return 0

    const payload = transactions.map((data) => ({
      ...data,
      date: data.date ?? todayISO(),
      tag: JSON.stringify(data.tags ?? []),
    }))
    const rows = await api.post<TransactionRow[]>('/transactions/import', payload)

    for (const row of rows) {
      useWalletStore.getState().addTransaction(mapTransaction(row))
    }

    return rows.length
  }, [])

  // ── Budget CRUD ─────────────────────────────────

  const loadBudgets = useCallback(async () => {
    const rows = await api.get<BudgetRow[]>('/budgets')
    const budgets = rows.map(mapBudget)
    useWalletStore.getState().setBudgets(budgets)
    return budgets
  }, [])

  const addBudget = useCallback(async (data: BudgetInput): Promise<Budget> => {
    const row = await api.post<BudgetRow>('/budgets', data)
    const budget = mapBudget(row)
    useWalletStore.getState().addBudget(budget)
    return budget
  }, [])

  const updateBudget = useCallback(async (id: string, data: Partial<BudgetInput>): Promise<void> => {
    const row = await api.patch<BudgetRow>(`/budgets/${id}`, data)
    useWalletStore.getState().updateBudget(id, mapBudget(row))
  }, [])

  const deleteBudget = useCallback(async (id: string): Promise<void> => {
    await api.delete(`/budgets/${id}`)
    useWalletStore.getState().removeBudget(id)
  }, [])

  /** Returns spending per category for the given month (YYYY-MM), computed from in-memory transactions. */
  const getMonthlySpending = useCallback((monthYear: string): Map<string, number> => {
    const { transactions } = useWalletStore.getState()
    const map = new Map<string, number>()
    for (const t of transactions) {
      if (t.type !== 'expense' || !t.categoryId) continue
      if (!t.date.startsWith(monthYear)) continue
      map.set(t.categoryId, (map.get(t.categoryId) ?? 0) + t.amount)
    }
    return map
  }, [])

  // ── Recurring CRUD ───────────────────────────────

  const loadRecurringTransactions = useCallback(async () => {
    const rows = await api.get<RecurringRow[]>('/recurring-transactions')
    const rts = rows.map(mapRecurring)
    useWalletStore.getState().setRecurringTransactions(rts)
    return rts
  }, [])

  const addRecurringTransaction = useCallback(async (data: RecurringInput): Promise<RecurringTransaction> => {
    const row = await api.post<RecurringRow>('/recurring-transactions', data)
    const rt = mapRecurring(row)
    useWalletStore.getState().addRecurringTransaction(rt)
    return rt
  }, [])

  const updateRecurringTransaction = useCallback(async (id: string, data: Partial<RecurringInput>): Promise<void> => {
    const row = await api.patch<RecurringRow>(`/recurring-transactions/${id}`, data)
    useWalletStore.getState().updateRecurringTransaction(id, mapRecurring(row))
  }, [])

  const deleteRecurringTransaction = useCallback(async (id: string): Promise<void> => {
    await api.delete(`/recurring-transactions/${id}`)
    useWalletStore.getState().removeRecurringTransaction(id)
  }, [])

  // Post all rules due on/before today (catch-up). Returns the number posted.
  const processRecurringTransactions = useCallback(async (): Promise<number> => {
    const { posted } = await api.post<{ posted: number }>('/recurring-transactions/process')
    return posted
  }, [])

  // Post a single rule immediately and advance its schedule one period.
  const postRecurringNow = useCallback(async (id: string): Promise<void> => {
    const row = await api.post<RecurringRow>(`/recurring-transactions/${id}/post`)
    useWalletStore.getState().updateRecurringTransaction(id, mapRecurring(row))
  }, [])

  // ── Goal CRUD ────────────────────────────────────

  const loadGoals = useCallback(async () => {
    const rows = await api.get<GoalRow[]>('/goals')
    const goals = rows.map(mapGoal)
    useWalletStore.getState().setGoals(goals)
    return goals
  }, [])

  const addGoal = useCallback(async (data: GoalInput): Promise<Goal> => {
    const row = await api.post<GoalRow>('/goals', data)
    const goal = mapGoal(row)
    useWalletStore.getState().addGoal(goal)
    return goal
  }, [])

  const updateGoal = useCallback(async (id: string, data: Partial<GoalInput>): Promise<void> => {
    const row = await api.patch<GoalRow>(`/goals/${id}`, data)
    useWalletStore.getState().updateGoal(id, mapGoal(row))
  }, [])

  const deleteGoal = useCallback(async (id: string): Promise<void> => {
    await api.delete(`/goals/${id}`)
    useWalletStore.getState().removeGoal(id)
  }, [])

  // ── Export ───────────────────────────────────────

  /**
   * Export a specific set of transactions (by ID) as CSV or JSON.
   * Uses already-loaded store data — no extra server call needed.
   */
  const exportTransactions = useCallback((format: 'csv' | 'json', ids: string[]): void => {
    const { transactions, accounts, categories } = useWalletStore.getState()
    const idSet = new Set(ids)
    const toExport = transactions.filter((t) => idSet.has(t.id))

    const filename = `daybook-transactions-${todayISO()}.${format}`

    if (format === 'csv') {
      const header = 'date,merchant,description,amount,type,category,account,tags'
      const q = (s: string) => `"${s.replace(/"/g, '""')}"`
      const csvRows = toExport.map((t) => {
        const catName = t.categoryId ? (categories.find((c) => c.id === t.categoryId)?.name ?? '') : ''
        const acctName = accounts.find((a) => a.id === t.accountId)?.name ?? ''
        return [t.date, q(t.merchant), q(t.description), t.amount, t.type, q(catName), q(acctName), q(t.tags.join(', '))].join(',')
      })
      triggerDownload([header, ...csvRows].join('\n'), filename, 'text/csv')
    } else {
      const rows = toExport.map((t) => ({
        date: t.date,
        merchant: t.merchant,
        description: t.description,
        amount: t.amount,
        type: t.type,
        category: t.categoryId ? (categories.find((c) => c.id === t.categoryId)?.name ?? null) : null,
        account: accounts.find((a) => a.id === t.accountId)?.name ?? '',
        tags: t.tags,
      }))
      triggerDownload(JSON.stringify(rows, null, 2), filename, 'application/json')
    }
  }, [])

  // ── Summary helpers ─────────────────────────────

  const getFilteredSummary = useCallback(() => {
    const { transactions } = useWalletStore.getState()
    let totalIncome = 0
    let totalExpense = 0

    for (const t of transactions) {
      if (t.type === 'income') totalIncome += t.amount
      else if (t.type === 'expense') totalExpense += t.amount
      // transfers excluded from totals
    }

    return {
      totalIncome,
      totalExpense,
      net: totalIncome - totalExpense,
    }
  }, [])

  return {
    // State
    accounts: store.accounts,
    transactions: store.transactions,
    categories: store.categories,
    budgets: store.budgets,
    recurringTransactions: store.recurringTransactions,
    goals: store.goals,
    tags: store.tags,
    filters: store.filters,
    setFilters: store.setFilters,

    // Load
    loadAccounts,
    loadTransactions,
    loadCategories,
    loadTags,
    loadBudgets,
    loadRecurringTransactions,
    loadGoals,

    // Balance
    getAccountBalance,

    // Account CRUD
    addAccount,
    updateAccount,
    deleteAccount,

    // Transaction CRUD
    addTransaction,
    updateTransaction,
    deleteTransaction,

    // Batch
    importTransactions,

    // Budget CRUD
    addBudget,
    updateBudget,
    deleteBudget,
    getMonthlySpending,

    // Recurring CRUD
    addRecurringTransaction,
    updateRecurringTransaction,
    deleteRecurringTransaction,
    processRecurringTransactions,
    postRecurringNow,

    // Goal CRUD
    addGoal,
    updateGoal,
    deleteGoal,

    // Category CRUD
    addCategory,
    deleteCategory,
    getCategoryUsage,

    // Export
    exportTransactions,

    // Summary
    getFilteredSummary,
  }
}

export type { AccountInput, TransactionInput, TransactionFilters, BudgetInput, RecurringInput }

function triggerDownload(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
