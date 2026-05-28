import { useCallback } from 'react'
import { getDB } from '@/db'
import { useWalletStore } from '@/stores/wallet.store'
import { generateId, nowISO, todayISO } from '@/lib/utils'
import type { Account, Transaction, Category, TransactionType, Budget, RecurringTransaction, RecurrenceFrequency, Goal } from '@/types/wallet.types'

// ── DB row types (snake_case from PGlite) ───────────

interface AccountRow {
  id: string
  name: string
  description: string
  currency: string
  type: string
  color: string
  icon: string
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

interface SumRow {
  total: number
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
    tag: row.tag ?? '',
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
  tag?: string
  importHash?: string
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
  tag?: string
}

// ── Hook ────────────────────────────────────────────

export function useWallet() {
  const store = useWalletStore()

  // ── Load operations ─────────────────────────────

  const loadAccounts = useCallback(async () => {
    const db = await getDB()
    const result = await db.query<AccountRow>(
      'SELECT * FROM accounts ORDER BY created_at ASC'
    )
    const accounts = result.rows.map(mapAccount)
    useWalletStore.getState().setAccounts(accounts)
    return accounts
  }, [])

  const loadCategories = useCallback(async () => {
    const db = await getDB()
    const result = await db.query<CategoryRow>(
      'SELECT * FROM categories ORDER BY type ASC, name ASC'
    )
    const categories = result.rows.map(mapCategory)
    useWalletStore.getState().setCategories(categories)
    return categories
  }, [])

  const loadTransactions = useCallback(async (filters?: TransactionFilters) => {
    const db = await getDB()

    const conditions: string[] = []
    const params: (string | number)[] = []
    let paramIdx = 1

    if (filters?.dateFrom) {
      conditions.push(`t.date >= $${paramIdx}`)
      params.push(filters.dateFrom)
      paramIdx++
    }
    if (filters?.dateTo) {
      conditions.push(`t.date <= $${paramIdx}`)
      params.push(filters.dateTo)
      paramIdx++
    }
    if (filters?.type && filters.type !== 'all') {
      conditions.push(`t.type = $${paramIdx}`)
      params.push(filters.type)
      paramIdx++
    }
    if (filters?.categoryId) {
      conditions.push(`t.category_id = $${paramIdx}`)
      params.push(filters.categoryId)
      paramIdx++
    }
    if (filters?.accountId) {
      conditions.push(`(t.account_id = $${paramIdx} OR t.destination_account_id = $${paramIdx})`)
      params.push(filters.accountId)
      paramIdx++
    }
    if (filters?.tag) {
      conditions.push(`t.tag ILIKE $${paramIdx}`)
      params.push(`%${filters.tag}%`)
      paramIdx++
    }

    const whereClause = conditions.length > 0
      ? `WHERE ${conditions.join(' AND ')}`
      : ''

    const result = await db.query<TransactionRow>(
      `SELECT t.* FROM transactions t ${whereClause} ORDER BY t.date DESC, t.created_at DESC`,
      params
    )

    const transactions = result.rows.map(mapTransaction)
    useWalletStore.getState().setTransactions(transactions)
    return transactions
  }, [])

  // ── Account balance ─────────────────────────────

  const getAccountBalance = useCallback(async (accountId: string): Promise<number> => {
    const db = await getDB()

    // Income for this account
    const incomeResult = await db.query<SumRow>(
      `SELECT COALESCE(SUM(amount), 0) as total FROM transactions
       WHERE account_id = $1 AND type = 'income'`,
      [accountId]
    )
    const income = incomeResult.rows[0]?.total ?? 0

    // Expense for this account
    const expenseResult = await db.query<SumRow>(
      `SELECT COALESCE(SUM(amount), 0) as total FROM transactions
       WHERE account_id = $1 AND type = 'expense'`,
      [accountId]
    )
    const expense = expenseResult.rows[0]?.total ?? 0

    // Transfers OUT (this account is the source)
    const transferOutResult = await db.query<SumRow>(
      `SELECT COALESCE(SUM(amount), 0) as total FROM transactions
       WHERE account_id = $1 AND type = 'transfer'`,
      [accountId]
    )
    const transferOut = transferOutResult.rows[0]?.total ?? 0

    // Transfers IN (this account is the destination)
    const transferInResult = await db.query<SumRow>(
      `SELECT COALESCE(SUM(amount), 0) as total FROM transactions
       WHERE destination_account_id = $1 AND type = 'transfer'`,
      [accountId]
    )
    const transferIn = transferInResult.rows[0]?.total ?? 0

    return income - expense - transferOut + transferIn
  }, [])

  // ── Account CRUD ────────────────────────────────

  const addAccount = useCallback(async (data: AccountInput): Promise<Account> => {
    const db = await getDB()
    const id = generateId()
    const now = nowISO()

    await db.query(
      `INSERT INTO accounts (id, name, description, currency, type, color, icon, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        id,
        data.name,
        data.description ?? '',
        data.currency ?? 'MYR',
        data.type ?? 'cash',
        data.color ?? '#1D9E75',
        data.icon ?? 'wallet',
        now,
      ]
    )

    const account: Account = {
      id,
      name: data.name,
      description: data.description ?? '',
      currency: data.currency ?? 'MYR',
      type: data.type ?? 'cash',
      color: data.color ?? '#1D9E75',
      icon: data.icon ?? 'wallet',
      createdAt: now,
    }

    useWalletStore.getState().addAccount(account)
    return account
  }, [])

  const updateAccount = useCallback(async (id: string, data: Partial<AccountInput>): Promise<void> => {
    const db = await getDB()

    const fields: string[] = []
    const params: (string | number)[] = []
    let paramIdx = 1

    if (data.name !== undefined) {
      fields.push(`name = $${paramIdx}`)
      params.push(data.name)
      paramIdx++
    }
    if (data.description !== undefined) {
      fields.push(`description = $${paramIdx}`)
      params.push(data.description)
      paramIdx++
    }
    if (data.currency !== undefined) {
      fields.push(`currency = $${paramIdx}`)
      params.push(data.currency)
      paramIdx++
    }
    if (data.type !== undefined) {
      fields.push(`type = $${paramIdx}`)
      params.push(data.type)
      paramIdx++
    }
    if (data.color !== undefined) {
      fields.push(`color = $${paramIdx}`)
      params.push(data.color)
      paramIdx++
    }
    if (data.icon !== undefined) {
      fields.push(`icon = $${paramIdx}`)
      params.push(data.icon)
      paramIdx++
    }

    if (fields.length === 0) return

    params.push(id)
    await db.query(
      `UPDATE accounts SET ${fields.join(', ')} WHERE id = $${paramIdx}`,
      params
    )

    useWalletStore.getState().updateAccount(id, data as Partial<Account>)
  }, [])

  const deleteAccount = useCallback(async (id: string): Promise<void> => {
    const db = await getDB()
    // CASCADE will delete transactions automatically
    await db.query('DELETE FROM accounts WHERE id = $1', [id])
    useWalletStore.getState().removeAccount(id)
  }, [])

  // ── Transaction CRUD ────────────────────────────

  const addTransaction = useCallback(async (data: TransactionInput): Promise<Transaction> => {
    const db = await getDB()
    const id = generateId()
    const now = nowISO()

    await db.query(
      `INSERT INTO transactions
       (id, account_id, destination_account_id, date, merchant, description, amount, type, category_id, tag, import_hash, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        id,
        data.accountId,
        data.destinationAccountId ?? null,
        data.date ?? todayISO(),
        data.merchant ?? '',
        data.description ?? '',
        data.amount,
        data.type,
        data.categoryId ?? null,
        data.tag ?? '',
        data.importHash ?? '',
        now,
        now,
      ]
    )

    const transaction: Transaction = {
      id,
      accountId: data.accountId,
      destinationAccountId: data.destinationAccountId ?? null,
      date: data.date ?? todayISO(),
      merchant: data.merchant ?? '',
      description: data.description ?? '',
      amount: data.amount,
      type: data.type,
      categoryId: data.categoryId ?? null,
      tag: data.tag ?? '',
      importHash: data.importHash ?? '',
      createdAt: now,
      updatedAt: now,
    }

    useWalletStore.getState().addTransaction(transaction)
    return transaction
  }, [])

  const updateTransaction = useCallback(async (id: string, data: Partial<TransactionInput>): Promise<void> => {
    const db = await getDB()
    const now = nowISO()

    const fields: string[] = [`updated_at = $1`]
    const params: (string | number | null)[] = [now]
    let paramIdx = 2

    if (data.accountId !== undefined) {
      fields.push(`account_id = $${paramIdx}`)
      params.push(data.accountId)
      paramIdx++
    }
    if (data.destinationAccountId !== undefined) {
      fields.push(`destination_account_id = $${paramIdx}`)
      params.push(data.destinationAccountId ?? null)
      paramIdx++
    }
    if (data.date !== undefined) {
      fields.push(`date = $${paramIdx}`)
      params.push(data.date)
      paramIdx++
    }
    if (data.merchant !== undefined) {
      fields.push(`merchant = $${paramIdx}`)
      params.push(data.merchant)
      paramIdx++
    }
    if (data.description !== undefined) {
      fields.push(`description = $${paramIdx}`)
      params.push(data.description)
      paramIdx++
    }
    if (data.amount !== undefined) {
      fields.push(`amount = $${paramIdx}`)
      params.push(data.amount)
      paramIdx++
    }
    if (data.type !== undefined) {
      fields.push(`type = $${paramIdx}`)
      params.push(data.type)
      paramIdx++
    }
    if (data.categoryId !== undefined) {
      fields.push(`category_id = $${paramIdx}`)
      params.push(data.categoryId ?? null)
      paramIdx++
    }
    if (data.tag !== undefined) {
      fields.push(`tag = $${paramIdx}`)
      params.push(data.tag)
      paramIdx++
    }

    params.push(id)
    await db.query(
      `UPDATE transactions SET ${fields.join(', ')} WHERE id = $${paramIdx}`,
      params
    )

    // Map TransactionInput fields to Transaction fields for store update
    const storeUpdate: Partial<Transaction> = { updatedAt: now }
    if (data.accountId !== undefined) storeUpdate.accountId = data.accountId
    if (data.destinationAccountId !== undefined) storeUpdate.destinationAccountId = data.destinationAccountId ?? null
    if (data.date !== undefined) storeUpdate.date = data.date
    if (data.merchant !== undefined) storeUpdate.merchant = data.merchant
    if (data.description !== undefined) storeUpdate.description = data.description
    if (data.amount !== undefined) storeUpdate.amount = data.amount
    if (data.type !== undefined) storeUpdate.type = data.type
    if (data.categoryId !== undefined) storeUpdate.categoryId = data.categoryId ?? null
    if (data.tag !== undefined) storeUpdate.tag = data.tag

    useWalletStore.getState().updateTransaction(id, storeUpdate)
  }, [])

  const deleteTransaction = useCallback(async (id: string): Promise<void> => {
    const db = await getDB()
    await db.query('DELETE FROM transactions WHERE id = $1', [id])
    useWalletStore.getState().removeTransaction(id)
  }, [])

  // ── Batch import ────────────────────────────────

  const importTransactions = useCallback(async (
    transactions: TransactionInput[]
  ): Promise<number> => {
    const db = await getDB()
    let imported = 0

    for (const data of transactions) {
      const id = generateId()
      const now = nowISO()

      await db.query(
        `INSERT INTO transactions
         (id, account_id, destination_account_id, date, merchant, description, amount, type, category_id, tag, import_hash, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          id,
          data.accountId,
          data.destinationAccountId ?? null,
          data.date ?? todayISO(),
          data.merchant ?? '',
          data.description ?? '',
          data.amount,
          data.type,
          data.categoryId ?? null,
          data.tag ?? '',
          data.importHash ?? '',
          now,
          now,
        ]
      )

      const transaction: Transaction = {
        id,
        accountId: data.accountId,
        destinationAccountId: data.destinationAccountId ?? null,
        date: data.date ?? todayISO(),
        merchant: data.merchant ?? '',
        description: data.description ?? '',
        amount: data.amount,
        type: data.type,
        categoryId: data.categoryId ?? null,
        tag: data.tag ?? '',
        importHash: data.importHash ?? '',
        createdAt: now,
        updatedAt: now,
      }

      useWalletStore.getState().addTransaction(transaction)
      imported++
    }

    return imported
  }, [])

  // ── Budget CRUD ─────────────────────────────────

  const loadBudgets = useCallback(async () => {
    const db = await getDB()
    const result = await db.query<BudgetRow>('SELECT * FROM budgets ORDER BY created_at ASC')
    const budgets = result.rows.map(mapBudget)
    useWalletStore.getState().setBudgets(budgets)
    return budgets
  }, [])

  const addBudget = useCallback(async (data: BudgetInput): Promise<Budget> => {
    const db = await getDB()
    const id = generateId()
    const now = nowISO()
    await db.query(
      `INSERT INTO budgets (id, category_id, limit_amount, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $4)`,
      [id, data.categoryId, data.limitAmount, now],
    )
    const budget: Budget = { id, categoryId: data.categoryId, limitAmount: data.limitAmount, createdAt: now, updatedAt: now }
    useWalletStore.getState().addBudget(budget)
    return budget
  }, [])

  const updateBudget = useCallback(async (id: string, data: Partial<BudgetInput>): Promise<void> => {
    const db = await getDB()
    const now = nowISO()
    const fields: string[] = ['updated_at = $1']
    const params: (string | number)[] = [now]
    let idx = 2
    if (data.limitAmount !== undefined) { fields.push(`limit_amount = $${idx}`); params.push(data.limitAmount); idx++ }
    params.push(id)
    await db.query(`UPDATE budgets SET ${fields.join(', ')} WHERE id = $${idx}`, params)
    useWalletStore.getState().updateBudget(id, { ...(data.limitAmount !== undefined ? { limitAmount: data.limitAmount } : {}), updatedAt: now })
  }, [])

  const deleteBudget = useCallback(async (id: string): Promise<void> => {
    const db = await getDB()
    await db.query('DELETE FROM budgets WHERE id = $1', [id])
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
    const db = await getDB()
    const result = await db.query<RecurringRow>(
      'SELECT * FROM recurring_transactions ORDER BY next_due_date ASC',
    )
    const rts = result.rows.map(mapRecurring)
    useWalletStore.getState().setRecurringTransactions(rts)
    return rts
  }, [])

  const addRecurringTransaction = useCallback(async (data: RecurringInput): Promise<RecurringTransaction> => {
    const db = await getDB()
    const id = generateId()
    const now = nowISO()
    await db.query(
      `INSERT INTO recurring_transactions
       (id, account_id, amount, merchant, type, category_id, frequency, next_due_date, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)`,
      [id, data.accountId, data.amount, data.merchant ?? '', data.type ?? 'expense', data.categoryId ?? null, data.frequency, data.nextDueDate, now],
    )
    const rt: RecurringTransaction = {
      id, accountId: data.accountId, amount: data.amount, merchant: data.merchant ?? '',
      type: data.type ?? 'expense', categoryId: data.categoryId ?? null,
      frequency: data.frequency, nextDueDate: data.nextDueDate, createdAt: now, updatedAt: now,
    }
    useWalletStore.getState().addRecurringTransaction(rt)
    return rt
  }, [])

  const updateRecurringTransaction = useCallback(async (id: string, data: Partial<RecurringInput>): Promise<void> => {
    const db = await getDB()
    const now = nowISO()
    const fields: string[] = ['updated_at = $1']
    const params: (string | number | null)[] = [now]
    let idx = 2
    if (data.amount !== undefined) { fields.push(`amount = $${idx}`); params.push(data.amount); idx++ }
    if (data.merchant !== undefined) { fields.push(`merchant = $${idx}`); params.push(data.merchant); idx++ }
    if (data.type !== undefined) { fields.push(`type = $${idx}`); params.push(data.type); idx++ }
    if (data.categoryId !== undefined) { fields.push(`category_id = $${idx}`); params.push(data.categoryId ?? null); idx++ }
    if (data.frequency !== undefined) { fields.push(`frequency = $${idx}`); params.push(data.frequency); idx++ }
    if (data.nextDueDate !== undefined) { fields.push(`next_due_date = $${idx}`); params.push(data.nextDueDate); idx++ }
    if (data.accountId !== undefined) { fields.push(`account_id = $${idx}`); params.push(data.accountId); idx++ }
    params.push(id)
    await db.query(`UPDATE recurring_transactions SET ${fields.join(', ')} WHERE id = $${idx}`, params)
    const storeUpdate: Partial<RecurringTransaction> = { updatedAt: now }
    if (data.amount !== undefined) storeUpdate.amount = data.amount
    if (data.merchant !== undefined) storeUpdate.merchant = data.merchant
    if (data.type !== undefined) storeUpdate.type = data.type
    if (data.categoryId !== undefined) storeUpdate.categoryId = data.categoryId ?? null
    if (data.frequency !== undefined) storeUpdate.frequency = data.frequency
    if (data.nextDueDate !== undefined) storeUpdate.nextDueDate = data.nextDueDate
    if (data.accountId !== undefined) storeUpdate.accountId = data.accountId
    useWalletStore.getState().updateRecurringTransaction(id, storeUpdate)
  }, [])

  const deleteRecurringTransaction = useCallback(async (id: string): Promise<void> => {
    const db = await getDB()
    await db.query('DELETE FROM recurring_transactions WHERE id = $1', [id])
    useWalletStore.getState().removeRecurringTransaction(id)
  }, [])

  // ── Goal CRUD ────────────────────────────────────

  const loadGoals = useCallback(async () => {
    const db = await getDB()
    const result = await db.query<GoalRow>('SELECT * FROM goals ORDER BY created_at ASC')
    const goals = result.rows.map(mapGoal)
    useWalletStore.getState().setGoals(goals)
    return goals
  }, [])

  const addGoal = useCallback(async (data: GoalInput): Promise<Goal> => {
    const db = await getDB()
    const id = generateId()
    const now = nowISO()
    await db.query(
      `INSERT INTO goals (id, name, target_amount, account_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $5)`,
      [id, data.name, data.targetAmount, data.accountId, now],
    )
    const goal: Goal = { id, name: data.name, targetAmount: data.targetAmount, accountId: data.accountId, createdAt: now, updatedAt: now }
    useWalletStore.getState().addGoal(goal)
    return goal
  }, [])

  const updateGoal = useCallback(async (id: string, data: Partial<GoalInput>): Promise<void> => {
    const db = await getDB()
    const now = nowISO()
    const fields: string[] = ['updated_at = $1']
    const params: (string | number)[] = [now]
    let idx = 2
    if (data.name !== undefined) { fields.push(`name = $${idx}`); params.push(data.name); idx++ }
    if (data.targetAmount !== undefined) { fields.push(`target_amount = $${idx}`); params.push(data.targetAmount); idx++ }
    if (data.accountId !== undefined) { fields.push(`account_id = $${idx}`); params.push(data.accountId); idx++ }
    params.push(id)
    await db.query(`UPDATE goals SET ${fields.join(', ')} WHERE id = $${idx}`, params)
    const storeUpdate: Partial<Goal> = { updatedAt: now }
    if (data.name !== undefined) storeUpdate.name = data.name
    if (data.targetAmount !== undefined) storeUpdate.targetAmount = data.targetAmount
    if (data.accountId !== undefined) storeUpdate.accountId = data.accountId
    useWalletStore.getState().updateGoal(id, storeUpdate)
  }, [])

  const deleteGoal = useCallback(async (id: string): Promise<void> => {
    const db = await getDB()
    await db.query('DELETE FROM goals WHERE id = $1', [id])
    useWalletStore.getState().removeGoal(id)
  }, [])

  // ── Export ───────────────────────────────────────

  const exportTransactions = useCallback(async (format: 'csv' | 'json'): Promise<void> => {
    const db = await getDB()

    interface ExportRow {
      date: string; merchant: string; description: string; amount: number
      type: string; category_name: string | null; account_name: string; tag: string
    }

    const result = await db.query<ExportRow>(
      `SELECT t.date, t.merchant, t.description, t.amount, t.type,
              c.name as category_name, a.name as account_name, t.tag
       FROM transactions t
       LEFT JOIN categories c ON c.id = t.category_id
       LEFT JOIN accounts a ON a.id = t.account_id
       ORDER BY t.date DESC, t.created_at DESC`,
    )

    const filename = `daybook-transactions-${todayISO()}.${format}`

    if (format === 'csv') {
      const header = 'date,merchant,description,amount,type,category,account,tag'
      const rows = result.rows.map((r) =>
        [r.date, `"${(r.merchant ?? '').replace(/"/g, '""')}"`, `"${(r.description ?? '').replace(/"/g, '""')}"`,
         r.amount, r.type, `"${(r.category_name ?? '').replace(/"/g, '""')}"`,
         `"${(r.account_name ?? '').replace(/"/g, '""')}"`, `"${(r.tag ?? '').replace(/"/g, '""')}"`].join(','),
      )
      triggerDownload([header, ...rows].join('\n'), filename, 'text/csv')
    } else {
      const json = JSON.stringify(result.rows, null, 2)
      triggerDownload(json, filename, 'application/json')
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
    filters: store.filters,
    setFilters: store.setFilters,

    // Load
    loadAccounts,
    loadTransactions,
    loadCategories,
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

    // Goal CRUD
    addGoal,
    updateGoal,
    deleteGoal,

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
