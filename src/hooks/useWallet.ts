import { useCallback } from 'react'
import { getDB } from '@/db'
import { useWalletStore } from '@/stores/wallet.store'
import { generateId, nowISO, todayISO } from '@/lib/utils'
import type { Account, Transaction, Category, TransactionType } from '@/types/wallet.types'

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
    filters: store.filters,
    setFilters: store.setFilters,

    // Load
    loadAccounts,
    loadTransactions,
    loadCategories,

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

    // Summary
    getFilteredSummary,
  }
}

export type { AccountInput, TransactionInput, TransactionFilters }
