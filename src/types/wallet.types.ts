export interface Account {
  id: string
  name: string
  description: string
  currency: string
  type: 'cash' | 'card' | 'e-wallet' | 'bank' | 'investment' | 'other'
  color: string
  icon: string
  openingBalance: number
  createdAt: string
  // Sharing — populated when the account is shared-in from another user
  isShared?: boolean
  sharedByUserId?: string | null
  sharedByUsername?: string | null
  canWrite?: number  // 0 | 1; only on shared-in accounts
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
  tags: string[]
  importHash: string
  createdAt: string
  updatedAt: string
  hasSplits?: boolean
  // What this transaction actually cost the viewer (docs/split-settlement-plan.md
  // §3): the ledger `amount` less whatever others have settled on it, and 0 for
  // a transaction the viewer does not own. `amount` stays the ledger truth and
  // drives balances; `effectiveAmount` drives income/expense totals.
  effectiveAmount: number
  // The creditor's incoming settlement leg. Moves the balance, never counted as
  // income — their expense already fell by the settled amount, so counting the
  // arrival too would correct the same money twice. The debtor's outgoing
  // payment is NOT flagged: it is a normal expense (§3).
  isBalanceOnly: boolean
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

export interface Goal {
  id: string
  name: string
  targetAmount: number
  accountId: string
  createdAt: string
  updatedAt: string
}

export interface DailyGroup {
  date: string
  transactions: Transaction[]
  totalIncome: number
  totalExpense: number
}
