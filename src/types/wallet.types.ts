export interface Account {
  id: string
  name: string
  description: string
  currency: string
  type: 'cash' | 'card' | 'e-wallet' | 'bank' | 'investment' | 'other'
  color: string
  icon: string
  createdAt: string
}

export type TransactionType = 'income' | 'expense' | 'transfer'

export interface Transaction {
  id: string
  accountId: string
  destinationAccountId: string | null
  date: string
  merchant: string
  description: string
  amount: number
  type: TransactionType
  categoryId: string | null
  tag: string
  importHash: string
  createdAt: string
  updatedAt: string
}

export interface Category {
  id: string
  name: string
  icon: string
  color: string
  type: 'income' | 'expense' | 'both'
}

export interface Budget {
  id: string
  categoryId: string
  limitAmount: number
  createdAt: string
  updatedAt: string
}

export type RecurrenceFrequency = 'weekly' | 'monthly'

export interface RecurringTransaction {
  id: string
  accountId: string
  amount: number
  merchant: string
  type: TransactionType
  categoryId: string | null
  frequency: RecurrenceFrequency
  nextDueDate: string
  createdAt: string
  updatedAt: string
}

export interface DailyGroup {
  date: string
  transactions: Transaction[]
  totalIncome: number
  totalExpense: number
}
