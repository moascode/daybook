import { useState, useEffect, useCallback, useMemo } from 'react'
import { Plus, PieChart, Pencil, Trash2, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Select'
import { Input } from '@/components/ui/Input'
import { EmptyState } from '@/components/ui/EmptyState'
import { useWallet } from '@/hooks/useWallet'
import { cn, formatMYR } from '@/lib/utils'
import type { Budget } from '@/types/wallet.types'

interface BudgetFormData {
  categoryId: string
  limitAmount: string
}

function currentMonthYear(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

export function BudgetsPage() {
  const { budgets, categories, transactions, loadBudgets, loadCategories, loadTransactions, addBudget, updateBudget, deleteBudget } = useWallet()

  const [formOpen, setFormOpen] = useState(false)
  const [editingBudget, setEditingBudget] = useState<Budget | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [form, setForm] = useState<BudgetFormData>({ categoryId: '', limitAmount: '' })

  useEffect(() => {
    loadCategories()
    loadBudgets()
    // C8: budget progress only looks at the current month, so bound the fetch
    // instead of pulling the user's full transaction history.
    const now = new Date()
    const prefix = currentMonthYear()
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
    loadTransactions({ dateFrom: `${prefix}-01`, dateTo: `${prefix}-${String(lastDay).padStart(2, '0')}` })
  }, [loadBudgets, loadCategories, loadTransactions])

  const spending = useMemo(() => {
    const prefix = currentMonthYear()
    const map = new Map<string, number>()
    for (const t of transactions) {
      if (t.type !== 'expense' || !t.categoryId) continue
      if (!t.date.startsWith(prefix)) continue
      map.set(t.categoryId, (map.get(t.categoryId) ?? 0) + t.amount)
    }
    return map
  }, [transactions])

  const openCreate = useCallback(() => {
    setEditingBudget(null)
    setForm({ categoryId: '', limitAmount: '' })
    setFormOpen(true)
  }, [])

  const openEdit = useCallback((budget: Budget) => {
    setEditingBudget(budget)
    setForm({ categoryId: budget.categoryId, limitAmount: String(budget.limitAmount) })
    setFormOpen(true)
  }, [])

  const handleSubmit = useCallback(async () => {
    const limit = parseFloat(form.limitAmount)
    if (!form.categoryId || isNaN(limit) || limit <= 0) return
    if (editingBudget) {
      await updateBudget(editingBudget.id, { limitAmount: limit })
    } else {
      await addBudget({ categoryId: form.categoryId, limitAmount: limit })
    }
    setFormOpen(false)
  }, [form, editingBudget, addBudget, updateBudget])

  const handleDelete = useCallback(async (id: string) => {
    await deleteBudget(id)
    setConfirmDeleteId(null)
  }, [deleteBudget])

  const expenseCategories = categories.filter((c) => c.type === 'expense' || c.type === 'both')
  const usedCategoryIds = new Set(budgets.map((b) => b.categoryId))
  const availableCategories = editingBudget
    ? expenseCategories
    : expenseCategories.filter((c) => !usedCategoryIds.has(c.id))

  return (
    <div className="max-w-2xl mx-auto">
      {/* Header */}
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Budgets</h2>
          <p className="text-xs text-gray-500 mt-0.5">Monthly spend limits per category</p>
        </div>
        <Button size="sm" onClick={openCreate} disabled={availableCategories.length === 0}>
          <Plus className="h-3.5 w-3.5" />
          Add Budget
        </Button>
      </div>

      {/* Budget list */}
      {budgets.length === 0 ? (
        <EmptyState
          icon={<PieChart className="h-10 w-10" />}
          title="No limits configured"
          description="No budgets set. Set monthly spend limits per category to track your spending."
        />
      ) : (
        <div className="flex flex-col gap-3">
          {budgets.map((budget) => {
            const category = categories.find((c) => c.id === budget.categoryId)
            const spent = spending.get(budget.categoryId) ?? 0
            const pct = Math.min((spent / budget.limitAmount) * 100, 100)
            const isOver = spent > budget.limitAmount

            return (
              <div
                key={budget.id}
                data-testid="budget-row"
                className="rounded-xl border border-gray-200 bg-white p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium text-gray-900 text-sm">
                        {category?.name ?? 'Unknown'}
                      </span>
                      {isOver && (
                        <span
                          data-testid="over-budget-alert"
                          className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700"
                        >
                          <AlertTriangle className="h-3 w-3" />
                          Over budget
                        </span>
                      )}
                    </div>
                    <div className="flex items-center justify-between text-xs text-gray-500 mb-2">
                      <span>
                        {formatMYR(spent)} spent of{' '}
                        <span className="font-medium text-gray-700">{formatMYR(budget.limitAmount)}</span>
                      </span>
                      <span className={cn(isOver ? 'text-red-600 font-medium' : 'text-gray-400')}>
                        {Math.round(pct)}%
                      </span>
                    </div>
                    {/* Progress bar */}
                    <div
                      data-testid="budget-progress"
                      className="h-2 w-full overflow-hidden rounded-full bg-gray-100"
                    >
                      <div
                        className={cn(
                          'h-full rounded-full transition-all',
                          isOver ? 'bg-red-500' : pct > 80 ? 'bg-orange-400' : 'bg-brand-500',
                        )}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                  {/* Actions */}
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      className="rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                      onClick={() => openEdit(budget)}
                      aria-label="Edit"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      className="rounded p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600"
                      onClick={() => setConfirmDeleteId(budget.id)}
                      aria-label="Delete"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
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
        onOpenChange={(open) => { setFormOpen(open); if (!open) setEditingBudget(null) }}
        title={editingBudget ? 'Edit Budget' : 'New Budget'}
      >
        <div className="flex flex-col gap-4">
          <Select
            label="Category"
            id="budget-category"
            options={availableCategories.map((c) => ({ value: c.id, label: c.name }))}
            placeholder="Select category"
            value={form.categoryId}
            onChange={(e) => setForm((f) => ({ ...f, categoryId: e.target.value }))}
            disabled={!!editingBudget}
          />
          <Input
            label="Limit"
            id="limit-amount"
            type="number"
            min="0"
            step="0.01"
            placeholder="500"
            value={form.limitAmount}
            onChange={(e) => setForm((f) => ({ ...f, limitAmount: e.target.value }))}
          />
          <p className="-mt-1 text-xs text-gray-500">
            Budgets reset <span className="font-medium text-gray-700">monthly</span>.
          </p>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" size="sm" onClick={() => setFormOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleSubmit}>
              {editingBudget ? 'Save Changes' : 'Create Budget'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Delete confirm modal */}
      <Modal
        open={!!confirmDeleteId}
        onOpenChange={(open) => { if (!open) setConfirmDeleteId(null) }}
        title="Delete budget?"
        description="This will remove the monthly limit for this category. Transactions are not affected."
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
