import { useState, useEffect, useCallback } from 'react'
import { Target, Plus, Pencil, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { ConfirmDeleteModal } from '@/components/ui/ConfirmDeleteModal'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { EmptyState } from '@/components/ui/EmptyState'
import { useWallet } from '@/hooks/useWallet'
import { useCrudModal } from '@/hooks/useCrudModal'
import { useToastStore } from '@/stores/toast.store'
import { formatMYR, errorMessage } from '@/lib/utils'
import type { Goal } from '@/types/wallet.types'

interface GoalFormData {
  name: string
  targetAmount: string
  accountId: string
}

export function GoalsPage() {
  const {
    goals,
    accounts,
    loadGoals,
    loadAccounts,
    addGoal,
    updateGoal,
    deleteGoal,
    getAccountBalances,
  } = useWallet()
  const { addToast } = useToastStore()

  const crud = useCrudModal<Goal>()
  const [balances, setBalances] = useState<Record<string, number>>({})
  const [form, setForm] = useState<GoalFormData>({ name: '', targetAmount: '', accountId: '' })

  useEffect(() => {
    // §1.4: one batched balances call instead of a per-account fan-out.
    loadAccounts()
    loadGoals()
    getAccountBalances().then(setBalances)
  }, [loadGoals, loadAccounts, getAccountBalances])

  const openCreate = useCallback(() => {
    setForm({ name: '', targetAmount: '', accountId: accounts[0]?.id ?? '' })
    crud.openCreate()
  }, [accounts, crud])

  const openEdit = useCallback((goal: Goal) => {
    setForm({ name: goal.name, targetAmount: String(goal.targetAmount), accountId: goal.accountId })
    crud.openEdit(goal)
  }, [crud])

  const handleSubmit = useCallback(async () => {
    const targetAmount = parseFloat(form.targetAmount)
    if (!form.name.trim() || isNaN(targetAmount) || targetAmount <= 0 || !form.accountId) return
    try {
      if (crud.editingItem) {
        await updateGoal(crud.editingItem.id, { name: form.name.trim(), targetAmount, accountId: form.accountId })
      } else {
        await addGoal({ name: form.name.trim(), targetAmount, accountId: form.accountId })
      }
      crud.closeForm(false)
    } catch (err) {
      addToast({ message: errorMessage(err, 'Could not save goal — please try again.'), duration: 4000 })
    }
  }, [form, crud, addGoal, updateGoal, addToast])

  const handleDelete = useCallback(async (id: string) => {
    try {
      await deleteGoal(id)
      crud.closeDelete()
    } catch (err) {
      addToast({ message: errorMessage(err, 'Could not delete goal — please try again.'), duration: 4000 })
    }
  }, [deleteGoal, crud, addToast])

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Goals</h2>
          <p className="text-xs text-gray-500 mt-0.5">Track your savings targets</p>
        </div>
        <Button size="sm" onClick={openCreate}>
          <Plus className="h-3.5 w-3.5" />
          Add Goal
        </Button>
      </div>

      {goals.length === 0 ? (
        <EmptyState
          icon={<Target className="h-10 w-10" />}
          title="Nothing here yet"
          description="No goals have been created. Add your first goal to track your savings progress."
        />
      ) : (
        <div className="flex flex-col gap-3">
          {goals.map((goal) => {
            const balance = balances[goal.accountId] ?? 0
            const saved = Math.max(0, Math.min(balance, goal.targetAmount))
            const percent = goal.targetAmount > 0 ? (saved / goal.targetAmount) * 100 : 0
            const account = accounts.find((a) => a.id === goal.accountId)

            return (
              <div
                key={goal.id}
                data-testid="goal-card"
                className="rounded-xl border border-gray-200 bg-white p-4"
              >
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div>
                    <p className="font-medium text-gray-900 text-sm">{goal.name}</p>
                    {account && <p className="text-xs text-gray-500 mt-0.5">{account.name}</p>}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="min-h-[40px] min-w-[40px] md:min-h-0 md:min-w-0"
                      onClick={() => openEdit(goal)}
                      aria-label={`Edit ${goal.name}`}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="min-h-[40px] min-w-[40px] md:min-h-0 md:min-w-0 text-gray-500 hover:text-red-600"
                      onClick={() => crud.openDelete(goal.id)}
                      aria-label={`Delete ${goal.name}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>

                <div className="flex items-center justify-between text-xs text-gray-500 mb-1.5">
                  <span>{formatMYR(saved)} saved</span>
                  <span>Target: {formatMYR(goal.targetAmount)}</span>
                </div>

                <div
                  data-testid="goal-progress"
                  className="h-2.5 w-full rounded-full bg-gray-100 overflow-hidden"
                >
                  <div
                    className="h-full rounded-full bg-brand-500 transition-all duration-300"
                    style={{ width: `${Math.min(100, percent).toFixed(1)}%` }}
                  />
                </div>

                <p className="mt-1 text-right text-xs text-gray-400">{percent.toFixed(0)}%</p>
              </div>
            )
          })}
        </div>
      )}

      {/* Create / Edit modal */}
      <Modal
        open={crud.formOpen}
        onOpenChange={crud.closeForm}
        title={crud.editingItem ? 'Edit Goal' : 'New Goal'}
      >
        <div className="flex flex-col gap-4">
          <Input
            label="Goal name"
            id="goal-name"
            placeholder="e.g. Emergency Fund"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          />
          <Input
            label="Target amount"
            id="target-amount"
            type="number"
            min="0"
            step="0.01"
            placeholder="0.00"
            value={form.targetAmount}
            onChange={(e) => setForm((f) => ({ ...f, targetAmount: e.target.value }))}
          />
          <Select
            label="Account"
            id="account"
            options={accounts.map((a) => ({ value: a.id, label: a.name }))}
            placeholder="Select account"
            value={form.accountId}
            onChange={(e) => setForm((f) => ({ ...f, accountId: e.target.value }))}
          />
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" size="sm" onClick={() => crud.closeForm(false)}>Cancel</Button>
            <Button size="sm" onClick={handleSubmit}>{crud.editingItem ? 'Save' : 'Create'}</Button>
          </div>
        </div>
      </Modal>

      {/* Delete confirm modal */}
      <ConfirmDeleteModal
        open={!!crud.confirmDeleteId}
        onOpenChange={(open) => { if (!open) crud.closeDelete() }}
        title="Delete goal?"
        description="This will remove the goal. Your account and transactions are not affected."
        onConfirm={() => crud.confirmDeleteId && handleDelete(crud.confirmDeleteId)}
      />
    </div>
  )
}
