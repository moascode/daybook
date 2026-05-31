import { useState, useEffect, useCallback, useMemo } from 'react'
import { Plus, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Select'
import { Input } from '@/components/ui/Input'
import { DatePicker } from '@/components/ui/DatePicker'
import { EmptyState } from '@/components/ui/EmptyState'
import { useWallet } from '@/hooks/useWallet'
import { useWalletStore } from '@/stores/wallet.store'
import { useToastStore } from '@/stores/toast.store'
import { formatMYR } from '@/lib/utils'
import { format, parseISO } from 'date-fns'
import type {
  RecurringTransaction,
  RecurrenceFrequency,
  TransactionType,
} from '@/types/wallet.types'

interface RecurringFormData {
  accountId: string
  amount: string
  merchant: string
  type: TransactionType
  categoryId: string
  frequency: RecurrenceFrequency
  nextDueDate: string
}

export function RecurringPage() {
  const {
    recurringTransactions,
    accounts,
    categories,
    loadRecurringTransactions,
    loadAccounts,
    loadCategories,
    addRecurringTransaction,
    updateRecurringTransaction,
    deleteRecurringTransaction,
    postRecurringNow,
  } = useWallet()
  const { addToast } = useToastStore()
  const invalidate = useWalletStore((s) => s.invalidate)

  const [formOpen, setFormOpen] = useState(false)
  const [editingRule, setEditingRule] = useState<RecurringTransaction | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [postingId, setPostingId] = useState<string | null>(null)
  const [form, setForm] = useState<RecurringFormData>({
    accountId: '',
    amount: '',
    merchant: '',
    type: 'expense',
    categoryId: '',
    frequency: 'monthly',
    nextDueDate: '',
  })

  useEffect(() => {
    loadRecurringTransactions()
    loadAccounts()
    loadCategories()
  }, [loadRecurringTransactions, loadAccounts, loadCategories])

  // Categories valid for the rule's direction (income/expense + 'both').
  const categoryOptions = useMemo(
    () =>
      categories
        .filter((c) => c.type === form.type || c.type === 'both')
        .map((c) => ({ value: c.id, label: c.name })),
    [categories, form.type],
  )

  const openCreate = useCallback(() => {
    setEditingRule(null)
    setForm({
      accountId: '',
      amount: '',
      merchant: '',
      type: 'expense',
      categoryId: '',
      frequency: 'monthly',
      nextDueDate: '',
    })
    setFormOpen(true)
  }, [])

  const openEdit = useCallback((rule: RecurringTransaction) => {
    setEditingRule(rule)
    setForm({
      accountId: rule.accountId,
      amount: String(rule.amount),
      merchant: rule.merchant,
      type: rule.type === 'income' ? 'income' : 'expense',
      categoryId: rule.categoryId ?? '',
      frequency: rule.frequency,
      nextDueDate: rule.nextDueDate,
    })
    setFormOpen(true)
  }, [])

  const handleSubmit = useCallback(async () => {
    const amount = parseFloat(form.amount)
    if (!form.accountId || isNaN(amount) || amount <= 0 || !form.nextDueDate) return
    const categoryId = form.categoryId || null
    if (editingRule) {
      await updateRecurringTransaction(editingRule.id, {
        amount,
        merchant: form.merchant,
        type: form.type,
        categoryId,
        frequency: form.frequency,
        nextDueDate: form.nextDueDate,
      })
    } else {
      await addRecurringTransaction({
        accountId: form.accountId,
        amount,
        merchant: form.merchant,
        type: form.type,
        categoryId,
        frequency: form.frequency,
        nextDueDate: form.nextDueDate,
      })
    }
    setFormOpen(false)
  }, [form, editingRule, addRecurringTransaction, updateRecurringTransaction])

  const handlePostNow = useCallback(async (rule: RecurringTransaction) => {
    setPostingId(rule.id)
    try {
      await postRecurringNow(rule.id)
      const account = accounts.find((a) => a.id === rule.accountId)
      addToast({
        message: `Posted ${formatMYR(rule.amount)}${rule.merchant ? ` · ${rule.merchant}` : ''}${account ? ` → ${account.name}` : ''}`,
        duration: 3500,
      })
      // A transaction was created — refresh balances/lists on other pages.
      invalidate()
    } finally {
      setPostingId(null)
    }
  }, [postRecurringNow, addToast, accounts, invalidate])

  const handleDelete = useCallback(async (id: string) => {
    await deleteRecurringTransaction(id)
    setConfirmDeleteId(null)
  }, [deleteRecurringTransaction])

  return (
    <div className="max-w-2xl mx-auto">
      {/* Header */}
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Recurring</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Repeating bills &amp; income — posted automatically when due
          </p>
        </div>
        <Button size="sm" onClick={openCreate}>
          <Plus className="h-3.5 w-3.5" />
          Add Recurring
        </Button>
      </div>

      {/* List */}
      {recurringTransactions.length === 0 ? (
        <EmptyState
          icon={<RefreshCw className="h-10 w-10" />}
          title="No scheduled rules yet"
          description="No recurring transactions. Set up repeating rules for regular bills, subscriptions, or income — they post automatically on their due date."
        />
      ) : (
        <div className="flex flex-col gap-3">
          {recurringTransactions.map((rule) => {
            const account = accounts.find((a) => a.id === rule.accountId)
            const freqLabel = rule.frequency === 'monthly' ? 'Monthly' : 'Weekly'
            const dueDateDisplay = format(parseISO(rule.nextDueDate), 'dd MMM yyyy')
            const isIncome = rule.type === 'income'

            return (
              <div
                key={rule.id}
                data-testid="recurring-row"
                className="rounded-xl border border-gray-200 bg-white p-4"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium text-gray-900 text-sm">
                        {rule.merchant || '(no merchant)'}
                      </span>
                      <span className="text-xs text-gray-500 bg-gray-100 rounded-full px-2 py-0.5">
                        {freqLabel}
                      </span>
                    </div>
                    <div className="text-xs text-gray-500">
                      Next: {dueDateDisplay}
                      {account && <span className="ml-3">{account.name}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span
                      className={
                        isIncome
                          ? 'text-sm font-semibold text-green-700'
                          : 'text-sm font-semibold text-gray-900'
                      }
                    >
                      {isIncome ? '+' : '−'}
                      {formatMYR(rule.amount)}
                    </span>
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        className="rounded px-2 py-1 text-xs font-medium text-brand-600 hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-50"
                        onClick={() => handlePostNow(rule)}
                        disabled={postingId === rule.id}
                      >
                        {postingId === rule.id ? 'Posting…' : 'Post now'}
                      </button>
                      <button
                        className="rounded px-2 py-1 text-xs font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-700"
                        onClick={() => openEdit(rule)}
                      >
                        Edit
                      </button>
                      <button
                        className="rounded px-2 py-1 text-xs font-medium text-gray-500 hover:bg-red-50 hover:text-red-600"
                        onClick={() => setConfirmDeleteId(rule.id)}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Add / Edit modal */}
      <Modal
        open={formOpen}
        onOpenChange={(open) => { setFormOpen(open); if (!open) setEditingRule(null) }}
        title={editingRule ? 'Edit Recurring Rule' : 'New Recurring Rule'}
      >
        <div className="flex flex-col gap-4">
          <Select
            label="Type"
            id="type"
            options={[
              { value: 'expense', label: 'Expense' },
              { value: 'income', label: 'Income' },
            ]}
            value={form.type}
            onChange={(e) =>
              setForm((f) => ({ ...f, type: e.target.value as TransactionType, categoryId: '' }))
            }
          />
          <Input
            label="Amount"
            id="amount"
            type="number"
            min="0"
            step="0.01"
            placeholder="0.00"
            value={form.amount}
            onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
          />
          <Select
            label="Account"
            id="account"
            options={accounts.map((a) => ({ value: a.id, label: a.name }))}
            placeholder="Select account"
            value={form.accountId}
            onChange={(e) => setForm((f) => ({ ...f, accountId: e.target.value }))}
          />
          <Input
            label="Merchant"
            id="merchant"
            type="text"
            placeholder="e.g. Netflix"
            value={form.merchant}
            onChange={(e) => setForm((f) => ({ ...f, merchant: e.target.value }))}
          />
          <Select
            label="Category"
            id="category"
            options={[{ value: '', label: 'No category' }, ...categoryOptions]}
            value={form.categoryId}
            onChange={(e) => setForm((f) => ({ ...f, categoryId: e.target.value }))}
          />
          <Select
            label="Frequency"
            id="frequency"
            options={[
              { value: 'monthly', label: 'Monthly' },
              { value: 'weekly', label: 'Weekly' },
            ]}
            value={form.frequency}
            onChange={(e) => setForm((f) => ({ ...f, frequency: e.target.value as RecurrenceFrequency }))}
          />
          <DatePicker
            label="Next due"
            value={form.nextDueDate}
            onChange={(e) => setForm((f) => ({ ...f, nextDueDate: e.target.value }))}
          />
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" size="sm" onClick={() => setFormOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleSubmit}>
              {editingRule ? 'Save' : 'Create'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Delete confirm modal */}
      <Modal
        open={!!confirmDeleteId}
        onOpenChange={(open) => { if (!open) setConfirmDeleteId(null) }}
        title="Delete recurring rule?"
        description="This will remove the recurring rule. Existing transactions are not affected."
        className="max-w-sm"
      >
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" size="sm" onClick={() => setConfirmDeleteId(null)}>
            Cancel
          </Button>
          <Button variant="danger" size="sm" onClick={() => confirmDeleteId && handleDelete(confirmDeleteId)}>
            Confirm
          </Button>
        </div>
      </Modal>
    </div>
  )
}
