import { useState, useEffect, useCallback, useMemo } from 'react'
import { Plus, PieChart, Pencil, Trash2, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { ConfirmDeleteModal } from '@/components/ui/ConfirmDeleteModal'
import { Select } from '@/components/ui/Select'
import { Input } from '@/components/ui/Input'
import { EmptyState } from '@/components/ui/EmptyState'
import { useWallet } from '@/hooks/useWallet'
import { useCrudModal } from '@/hooks/useCrudModal'
import { useToastStore } from '@/stores/toast.store'
import { cn, formatMYR, errorMessage, monthRange } from '@/lib/utils'
import type { Budget } from '@/types/wallet.types'

interface BudgetFormData {
  categoryId: string
  limitAmount: string
}

export function BudgetsPage() {
  const { budgets, categories, transactions, loadBudgets, loadCategories, loadTransactions, addBudget, updateBudget, deleteBudget, getMonthlySpending } = useWallet()
  const { addToast } = useToastStore()

  const crud = useCrudModal<Budget>()
  const [form, setForm] = useState<BudgetFormData>({ categoryId: '', limitAmount: '' })

  useEffect(() => {
    loadCategories()
    loadBudgets()
    // C8: budget progress only looks at the current month, so bound the fetch
    // instead of pulling the user's full transaction history.
    loadTransactions(monthRange(0))
  }, [loadBudgets, loadCategories, loadTransactions])

  // C6: wire up getMonthlySpending instead of reimplementing the same
  // aggregation inline. `transactions` is a dep only to trigger recompute —
  // getMonthlySpending itself reads the store directly.
  const spending = useMemo(
    () => getMonthlySpending(monthRange(0).dateFrom.slice(0, 7)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [transactions, getMonthlySpending],
  )

  const openCreate = useCallback(() => {
    setForm({ categoryId: '', limitAmount: '' })
    crud.openCreate()
  }, [crud])

  const openEdit = useCallback((budget: Budget) => {
    setForm({ categoryId: budget.categoryId, limitAmount: String(budget.limitAmount) })
    crud.openEdit(budget)
  }, [crud])

  const handleSubmit = useCallback(async () => {
    const limit = parseFloat(form.limitAmount)
    if (!form.categoryId || isNaN(limit) || limit <= 0) return
    try {
      if (crud.editingItem) {
        await updateBudget(crud.editingItem.id, { limitAmount: limit })
      } else {
        await addBudget({ categoryId: form.categoryId, limitAmount: limit })
      }
      crud.closeForm(false)
    } catch (err) {
      addToast({ message: errorMessage(err, 'Could not save budget — please try again.'), duration: 4000 })
    }
  }, [form, crud, addBudget, updateBudget, addToast])

  const handleDelete = useCallback(async (id: string) => {
    try {
      await deleteBudget(id)
      crud.closeDelete()
    } catch (err) {
      addToast({ message: errorMessage(err, 'Could not delete budget — please try again.'), duration: 4000 })
    }
  }, [deleteBudget, crud, addToast])

  const expenseCategories = categories.filter((c) => c.type === 'expense' || c.type === 'both')
  const usedCategoryIds = new Set(budgets.map((b) => b.categoryId))
  const availableCategories = crud.editingItem
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
                      onClick={() => crud.openDelete(budget.id)}
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
        open={crud.formOpen}
        onOpenChange={crud.closeForm}
        title={crud.editingItem ? 'Edit Budget' : 'New Budget'}
      >
        <div className="flex flex-col gap-4">
          <Select
            label="Category"
            id="budget-category"
            options={availableCategories.map((c) => ({ value: c.id, label: c.name }))}
            placeholder="Select category"
            value={form.categoryId}
            onChange={(e) => setForm((f) => ({ ...f, categoryId: e.target.value }))}
            disabled={!!crud.editingItem}
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
            <Button variant="secondary" size="sm" onClick={() => crud.closeForm(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleSubmit}>
              {crud.editingItem ? 'Save Changes' : 'Create Budget'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Delete confirm modal */}
      <ConfirmDeleteModal
        open={!!crud.confirmDeleteId}
        onOpenChange={(open) => { if (!open) crud.closeDelete() }}
        title="Delete budget?"
        description="This will remove the monthly limit for this category. Transactions are not affected."
        onConfirm={() => crud.confirmDeleteId && handleDelete(crud.confirmDeleteId)}
      />
    </div>
  )
}
