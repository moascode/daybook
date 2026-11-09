import { useEffect, useState } from 'react'
import { TransactionForm, type TransactionFormData } from '@/modules/wallet/TransactionForm'
import { TaskFormModal, type TaskFormDraft } from '@/modules/tasks/composer/TaskFormModal'
import { HabitFormModal, type HabitFormValues } from '@/modules/tasks/habits/HabitFormModal'
import { useWallet } from '@/hooks/useWallet'
import { useTasks } from '@/hooks/useTasks'
import { useTaskLists } from '@/hooks/useTaskLists'
import { useHabits } from '@/hooks/useHabits'
import { useAppStore } from '@/stores/app.store'
import { useToastStore } from '@/stores/toast.store'
import { api } from '@/lib/api'
import { errorMessage, todayISO } from '@/lib/utils'
import { mapMember } from '@/lib/household.mappers'
import type { TransactionType } from '@/types/wallet.types'

export type QuickAddForm = TransactionType | 'task' | 'habit'

interface QuickAddFormsProps {
  form: QuickAddForm | null
  onClose: () => void
}

/**
 * The create forms behind the global `+`, mounted over whatever page the user
 * is on — the same form components the pages use, so quick add never
 * navigates. Each form mounts only while open, so nothing is fetched until
 * it is needed. A save bumps `quickAddVersion` so the page underneath reloads.
 */
export function QuickAddForms({ form, onClose }: QuickAddFormsProps) {
  if (form === 'task') return <QuickTask onClose={onClose} />
  if (form === 'habit') return <QuickHabit onClose={onClose} />
  if (form) return <QuickTransaction type={form} onClose={onClose} />
  return null
}

function QuickTransaction({ type, onClose }: { type: TransactionType; onClose: () => void }) {
  const { accounts, categories, tags, loadAccounts, loadCategories, loadTags, addTransaction } = useWallet()
  const addToast = useToastStore((s) => s.addToast)
  const bump = useAppStore((s) => s.bumpQuickAddVersion)

  useEffect(() => {
    Promise.all([loadAccounts(), loadCategories(), loadTags()]).catch((err) =>
      addToast({ message: errorMessage(err, 'Could not load your accounts — please try again.') }),
    )
  }, [loadAccounts, loadCategories, loadTags, addToast])

  const submit = async (data: TransactionFormData) => {
    try {
      await addTransaction(data)
    } catch (err) {
      addToast({ message: errorMessage(err, 'Could not save transaction — please try again.'), duration: 4000 })
      throw err // keep the form open so the user can retry
    }
    bump()
  }

  return (
    <TransactionForm
      open
      onOpenChange={(open) => { if (!open) onClose() }}
      accounts={accounts}
      categories={categories}
      availableTags={tags}
      initialDraft={{ type } as Partial<TransactionFormData>}
      onSubmit={submit}
    />
  )
}

function QuickTask({ onClose }: { onClose: () => void }) {
  const { addTask } = useTasks()
  const { taskLists, loadTaskLists } = useTaskLists()
  const [coMembers, setCoMembers] = useState<{ userId: string; username: string }[]>([])
  const addToast = useToastStore((s) => s.addToast)
  const bump = useAppStore((s) => s.bumpQuickAddVersion)

  useEffect(() => {
    Promise.all([loadTaskLists(), api.get<Record<string, unknown>[]>('/groups/members')])
      .then(([, rows]) => setCoMembers(rows.map(mapMember).map((m) => ({ userId: m.userId, username: m.username }))))
      .catch((err) => addToast({ message: errorMessage(err, 'Could not load your lists — please try again.') }))
  }, [loadTaskLists, addToast])

  const submit = async (draft: TaskFormDraft) => {
    try {
      const task = await addTask(draft.content, null)
      // Same follow-up PATCH Today's handleCreateTask sends; a task with no
      // date defaults to today so it still lands somewhere visible.
      const patch: Record<string, unknown> = { dueDate: draft.dueDate ?? todayISO() }
      if (draft.listId !== null) patch.listId = draft.listId
      if (draft.priority !== null) patch.priority = draft.priority
      if (draft.assigneeId !== null) patch.assigneeId = draft.assigneeId
      if (draft.dueTime !== null) patch.dueTime = draft.dueTime
      await api.patch(`/tasks/${task.id}`, patch)
    } catch (err) {
      addToast({ message: errorMessage(err, 'Could not add that task — please try again.') })
      return
    }
    bump()
  }

  return <TaskFormModal open onClose={onClose} lists={taskLists} coMembers={coMembers} onSubmit={submit} />
}

function QuickHabit({ onClose }: { onClose: () => void }) {
  const { createHabit } = useHabits()
  const bump = useAppStore((s) => s.bumpQuickAddVersion)

  // createHabit toasts its own failure and rethrows, which keeps the form open.
  const submit = async (values: HabitFormValues) => {
    await createHabit(values)
    bump()
  }

  return <HabitFormModal open habit={null} onOpenChange={(open) => { if (!open) onClose() }} onSubmit={submit} />
}
