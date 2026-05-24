import { create } from 'zustand'
import type { Account, Transaction, Category } from '@/types/wallet.types'

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
  filters: WalletFilters

  setAccounts: (accounts: Account[]) => void
  setTransactions: (transactions: Transaction[]) => void
  setCategories: (categories: Category[]) => void
  setFilters: (filters: Partial<WalletFilters>) => void
  addAccount: (account: Account) => void
  updateAccount: (id: string, updates: Partial<Account>) => void
  removeAccount: (id: string) => void
  addTransaction: (transaction: Transaction) => void
  updateTransaction: (id: string, updates: Partial<Transaction>) => void
  removeTransaction: (id: string) => void
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
  filters: getDefaultFilters(),

  setAccounts: (accounts) => set({ accounts }),
  setTransactions: (transactions) => set({ transactions }),
  setCategories: (categories) => set({ categories }),
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
}))
