import { create } from 'zustand'
import type { Account, Transaction, Category, Budget, RecurringTransaction } from '@/types/wallet.types'

interface WalletFilters {
  dateFrom: string
  dateTo: string
  type: 'all' | 'income' | 'expense' | 'transfer'
  categoryId: string | null
  accountId: string | null
  tag: string
}

interface WalletState {
  accounts: Account[]
  transactions: Transaction[]
  categories: Category[]
  budgets: Budget[]
  recurringTransactions: RecurringTransaction[]
  filters: WalletFilters

  setAccounts: (accounts: Account[]) => void
  setTransactions: (transactions: Transaction[]) => void
  setCategories: (categories: Category[]) => void
  setBudgets: (budgets: Budget[]) => void
  setRecurringTransactions: (rts: RecurringTransaction[]) => void
  setFilters: (filters: Partial<WalletFilters>) => void
  addAccount: (account: Account) => void
  updateAccount: (id: string, updates: Partial<Account>) => void
  removeAccount: (id: string) => void
  addTransaction: (transaction: Transaction) => void
  updateTransaction: (id: string, updates: Partial<Transaction>) => void
  removeTransaction: (id: string) => void
  addBudget: (budget: Budget) => void
  updateBudget: (id: string, updates: Partial<Budget>) => void
  removeBudget: (id: string) => void
  addRecurringTransaction: (rt: RecurringTransaction) => void
  updateRecurringTransaction: (id: string, updates: Partial<RecurringTransaction>) => void
  removeRecurringTransaction: (id: string) => void
}

function getDefaultFilters(): WalletFilters {
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth()
  const firstDay = new Date(year, month, 1)
  const lastDay = new Date(year, month + 1, 0)

  return {
    dateFrom: firstDay.toISOString().slice(0, 10),
    dateTo: lastDay.toISOString().slice(0, 10),
    type: 'all',
    categoryId: null,
    accountId: null,
    tag: '',
  }
}

export const useWalletStore = create<WalletState>((set) => ({
  accounts: [],
  transactions: [],
  categories: [],
  budgets: [],
  recurringTransactions: [],
  filters: getDefaultFilters(),

  setAccounts: (accounts) => set({ accounts }),
  setTransactions: (transactions) => set({ transactions }),
  setCategories: (categories) => set({ categories }),
  setBudgets: (budgets) => set({ budgets }),
  setRecurringTransactions: (rts) => set({ recurringTransactions: rts }),
  setFilters: (updates) =>
    set((s) => ({ filters: { ...s.filters, ...updates } })),

  addAccount: (account) =>
    set((s) => ({ accounts: [...s.accounts, account] })),
  updateAccount: (id, updates) =>
    set((s) => ({
      accounts: s.accounts.map((a) => (a.id === id ? { ...a, ...updates } : a)),
    })),
  removeAccount: (id) =>
    set((s) => ({ accounts: s.accounts.filter((a) => a.id !== id) })),

  addTransaction: (transaction) =>
    set((s) => ({ transactions: [...s.transactions, transaction] })),
  updateTransaction: (id, updates) =>
    set((s) => ({
      transactions: s.transactions.map((t) =>
        t.id === id ? { ...t, ...updates } : t,
      ),
    })),
  removeTransaction: (id) =>
    set((s) => ({
      transactions: s.transactions.filter((t) => t.id !== id),
    })),

  addBudget: (budget) =>
    set((s) => ({ budgets: [...s.budgets, budget] })),
  updateBudget: (id, updates) =>
    set((s) => ({
      budgets: s.budgets.map((b) => (b.id === id ? { ...b, ...updates } : b)),
    })),
  removeBudget: (id) =>
    set((s) => ({ budgets: s.budgets.filter((b) => b.id !== id) })),

  addRecurringTransaction: (rt) =>
    set((s) => ({ recurringTransactions: [...s.recurringTransactions, rt] })),
  updateRecurringTransaction: (id, updates) =>
    set((s) => ({
      recurringTransactions: s.recurringTransactions.map((r) =>
        r.id === id ? { ...r, ...updates } : r,
      ),
    })),
  removeRecurringTransaction: (id) =>
    set((s) => ({
      recurringTransactions: s.recurringTransactions.filter((r) => r.id !== id),
    })),
}))
