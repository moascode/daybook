import { useState, useEffect, useCallback } from 'react'
import { Plus, PieChart, Pencil, Trash2, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { ConfirmDeleteModal } from '@/components/ui/ConfirmDeleteModal'
import { Select } from '@/components/ui/Select'
import { Input } from '@/components/ui/Input'
import { EmptyState } from '@/components/ui/EmptyState'
import { useWallet } from '@/hooks/useWallet'
import { useCrudModal } from '@/hooks/useCrudModal'
import { useToastStore } from '@/stores/toast.store'
import { cn, formatMYR, errorMessage, monthRange, todayISO } from '@/lib/utils'
import { dayOfMonth, daysInMonth, monthKey } from '@/modules/wallet/dashboard/insights'
import type { Budget } from '@/types/wallet.types'

/** A row counts as "ahead of pace" once it clears the notch by this much — a rounding error past it is normal noise. Matches `BudgetPace`'s own threshold (dashboard/BudgetPace.tsx). */
const AHEAD_OF_PACE_THRESHOLD = 0.08

interface BudgetFormData {
  categoryId: string
  limitAmount: string
}

export function BudgetsPage() {
  const { budgets, categories, loadBudgets, loadCategories, addBudget, updateBudget, deleteBudget, getBudgetSpending } = useWallet()
  const { addToast } = useToastStore()

  const crud = useCrudModal<Budget>()
  const [form, setForm] = useState<BudgetFormData>({ categoryId: '', limitAmount: '' })
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [spending, setSpending] = useState<Map<string, number>>(new Map())

  useEffect(() => {
    loadCategories()
    loadBudgets()
    // B-15 residual: budget spend must reflect the user's EFFECTIVE share —
    // when they've split an expense, their own share_amount, not the full
    // transaction total. GET /budgets/spending computes this server-side as
    // one aggregate query, scoped to the caller's own transactions and
    // bounded to the current month.
    getBudgetSpending(monthRange(0).dateFrom.slice(0, 7)).then(setSpending)
  }, [loadBudgets, loadCategories, getBudgetSpending])

  const openCreate = useCallback(() => {
    setForm({ categoryId: '', limitAmount: '' })
    setFormError(null)
    crud.openCreate()
  }, [crud])

  const openEdit = useCallback((budget: Budget) => {
    setForm({ categoryId: budget.categoryId, limitAmount: String(budget.limitAmount) })
    setFormError(null)
    crud.openEdit(budget)
  }, [crud])

  const handleSubmit = useCallback(async () => {
    const limit = parseFloat(form.limitAmount)
    // U-04: tell the user why the form won't submit instead of doing nothing.
    if (!form.categoryId) { setFormError('Choose a category.'); return }
    if (isNaN(limit) || limit <= 0) { setFormError('Enter a limit greater than 0.'); return }
    setFormError(null)
    setSaving(true)
    try {
      if (crud.editingItem) {
        await updateBudget(crud.editingItem.id, { limitAmount: limit })
      } else {
        await addBudget({ categoryId: form.categoryId, limitAmount: limit })
      }
      crud.closeForm(false)
    } catch (err) {
      addToast({ message: errorMessage(err, 'Could not save budget — please try again.'), duration: 4000 })
    } finally {
      setSaving(false)
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

  // Summary-band figures: reduces over the same `budgets`/`spending` data
  // every row below already renders — no new fetch, no new aggregation.
  const totalBudgeted = budgets.reduce((sum, b) => sum + b.limitAmount, 0)
  const totalSpent = budgets.reduce((sum, b) => sum + (spending.get(b.categoryId) ?? 0), 0)
  const monthPct = totalBudgeted > 0 ? Math.min((totalSpent / totalBudgeted) * 100, 100) : 0
  const overBudgetCount = budgets.filter((b) => (spending.get(b.categoryId) ?? 0) > b.limitAmount).length

  // Pace: where you SHOULD be today, same day-of-month elapsed fraction
  // `BudgetPace` (dashboard/BudgetPace.tsx) uses for its notch — this page is
  // always the current month (no date-range picker), so it's always in
  // progress and never needs that component's multi-month scaling.
  const today = todayISO()
  const day = dayOfMonth(today)
  const monthLength = daysInMonth(monthKey(today))
  const elapsed = day / monthLength
  const daysRemaining = monthLength - day

  // "RM34 a day instead of RM46 brings it in exactly on budget" — an
  // instruction, not a projection (design.md, R8 Budgets). Needs an actual
  // remaining day to spread the remaining budget over, and a real gap to
  // report; skipped once already over (the per-row "Over budget" badges
  // already say that) or once nothing distinguishes the two rates.
  const actualDailyRate = day > 0 ? totalSpent / day : 0
  const neededDailyRate = daysRemaining > 0 ? (totalBudgeted - totalSpent) / daysRemaining : null
  const paceInstruction =
    neededDailyRate !== null && neededDailyRate >= 0 && Math.abs(neededDailyRate - actualDailyRate) >= 0.5
      ? `${formatMYR(neededDailyRate)} a day instead of ${formatMYR(actualDailyRate)} brings it in exactly on budget.`
      : null

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
          <h2 className="text-base font-semibold text-fg">Budgets</h2>
          <p className="text-xs text-fg-subtle mt-0.5">Monthly spend limits per category</p>
        </div>
        <Button
          size="sm"
          onClick={openCreate}
          disabled={availableCategories.length === 0}
          title={availableCategories.length === 0 ? 'Every expense category already has a budget' : undefined}
        >
          <Plus className="h-3.5 w-3.5" />
          Add Budget
        </Button>
      </div>

      {/* Budget list */}
      {budgets.length === 0 ? (
        <EmptyState
          icon={<PieChart className="h-10 w-10" />}
          title="No budgets yet"
          description="Set a monthly spend limit per category to track how much you have left."
          action={
            availableCategories.length > 0
              ? <Button size="sm" onClick={openCreate}>Add your first budget</Button>
              : undefined
          }
        />
      ) : (
        <>
          {/* Month summary band — figure left, three stats right of a
              hairline, pace bar full width beneath. Reduces over the same
              `budgets`/`spending` data the rows below already render. */}
          <div className="card card-pad mb-4">
            <div className="band">
              <div className="band-main">
                <div className="band-fig">
                  <span className="v">{formatMYR(totalSpent)}</span>
                  <span className="k">of {formatMYR(totalBudgeted)} budgeted</span>
                </div>
                <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-surface-hover">
                  <div
                    className={cn(
                      'h-full rounded-full transition-all',
                      totalSpent > totalBudgeted
                        ? 'bg-red-500'
                        : monthPct > 80
                          ? 'bg-orange-400'
                          : 'bg-brand-500',
                    )}
                    style={{ width: `${monthPct}%` }}
                  />
                </div>
              </div>
              <div className="band-stats">
                <div className="band-stat">
                  <p className="k">Remaining</p>
                  <p className="v">{formatMYR(totalBudgeted - totalSpent)}</p>
                </div>
                <div className="band-stat">
                  <p className="k">Categories</p>
                  <p className="v">{budgets.length}</p>
                </div>
                <div className="band-stat">
                  <p className="k">Over budget</p>
                  <p className="v">{overBudgetCount}</p>
                </div>
              </div>
            </div>
            {paceInstruction && (
              <>
                <div className="divider" />
                <p className="text-sm text-fg-subtle" data-testid="budget-pace-instruction">{paceInstruction}</p>
              </>
            )}
          </div>

          <div className="flex flex-col gap-3">
          {budgets.map((budget) => {
            const category = categories.find((c) => c.id === budget.categoryId)
            const spent = spending.get(budget.categoryId) ?? 0
            const ratio = budget.limitAmount > 0 ? spent / budget.limitAmount : 0
            const pct = Math.min(ratio * 100, 100)
            const isOver = spent > budget.limitAmount
            const isAheadOfPace = !isOver && ratio > elapsed + AHEAD_OF_PACE_THRESHOLD

            return (
              <div
                key={budget.id}
                data-testid="budget-row"
                className="card card-pad hover:bg-surface-hover transition-colors"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium text-fg text-sm">
                        {category?.name ?? 'Unknown'}
                      </span>
                      {isOver && (
                        <Badge variant="danger" className="gap-1" data-testid="over-budget-alert">
                          <AlertTriangle className="h-3 w-3" />
                          Over budget
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center justify-between text-xs text-fg-subtle mb-2">
                      <span>
                        {formatMYR(spent)} spent of{' '}
                        <span className="font-medium text-fg-muted">{formatMYR(budget.limitAmount)}</span>
                      </span>
                      <span className={cn(isOver ? 'text-red-600 font-medium' : 'text-fg-faint')}>
                        {Math.round(pct)}%
                      </span>
                    </div>
                    {/* Progress bar with a pace notch — the line marks where spend
                        SHOULD be today (day/daysInMonth), same math as the
                        Dashboard's `BudgetPace`. Colour follows position against
                        that notch, not a flat 80% threshold: red once over the
                        limit, amber once ahead of pace, green otherwise. */}
                    <div
                      data-testid="budget-progress"
                      role="img"
                      aria-label={
                        `${category?.name ?? 'This category'}: ${Math.round(pct)}% of budget used, ` +
                        `${Math.round(elapsed * 100)}% of the month elapsed` +
                        (isOver ? ' — over limit.' : isAheadOfPace ? ' — ahead of pace.' : ' — on track.')
                      }
                      className="relative h-2 w-full overflow-hidden rounded-full bg-surface-hover"
                    >
                      <div
                        className={cn(
                          'h-full rounded-full transition-all',
                          isOver ? 'bg-red-500' : isAheadOfPace ? 'bg-orange-400' : 'bg-brand-500',
                        )}
                        style={{ width: `${pct}%` }}
                      />
                      <div
                        data-testid="budget-pace-notch"
                        className="absolute top-0 h-full w-px bg-fg/40"
                        style={{ left: `${Math.min(100, elapsed * 100)}%` }}
                      />
                    </div>
                  </div>
                  {/* Actions */}
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => openEdit(budget)}
                      aria-label={`Edit ${category?.name ?? 'budget'} budget`}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-fg-subtle hover:text-red-600"
                      onClick={() => crud.openDelete(budget.id)}
                      aria-label={`Delete ${category?.name ?? 'budget'} budget`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </div>
            )
          })}
          </div>
        </>
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
          <p className="-mt-1 text-xs text-fg-subtle">
            Budgets reset <span className="font-medium text-fg-muted">monthly</span>.
          </p>
          {formError && <p className="-mt-1 text-xs text-red-600">{formError}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" size="sm" onClick={() => crud.closeForm(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleSubmit} loading={saving}>
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
