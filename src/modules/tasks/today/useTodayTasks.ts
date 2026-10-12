import { useEffect, useMemo, useRef, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { useTasks } from '@/hooks/useTasks'
import { useTaskLists } from '@/hooks/useTaskLists'
import { useAppStore } from '@/stores/app.store'
import { useToastStore } from '@/stores/toast.store'
import { api } from '@/lib/api'
import { mapMember } from '@/lib/household.mappers'
import { errorMessage, todayISO } from '@/lib/utils'
import { dayDiff } from '@/modules/tasks/taskRowFormat'
import type { TaskComposerDraft } from '@/modules/tasks/composer/TaskComposer'
import type { TaskFormDraft } from '@/modules/tasks/composer/TaskFormModal'
import type { Task } from '@/types/tasks.types'
import type { GroupMember } from '@/types/household.types'

/** `days` from today, using local date parts — never toISOString() (CLAUDE.md §3 Traps). */
function isoDatePlus(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

export type TodayAudience = 'mine' | 'everyone'

export interface WorthKnowingItem {
  title: string
  sub: string
  href: string
  actionLabel: string
}

/**
 * All of the Today page's data loading, derived stats and mutation handlers
 * — split out of TasksTodayPage.tsx (one concern per file, CLAUDE.md §2) so
 * the page component itself is pure layout/composition.
 */
export function useTodayTasks() {
  const { loadTasks, addTask, completeTask, rescheduleTasks, deleteTaskById } = useTasks()
  const { taskLists, loadTaskLists } = useTaskLists()
  const currentUserId = useAppStore((s) => s.user?.id ?? '')
  const addToast = useToastStore((s) => s.addToast)
  const removeToast = useToastStore((s) => s.removeToast)

  const [openTasks, setOpenTasks] = useState<Task[]>([])
  const [completedTasks, setCompletedTasks] = useState<Task[]>([])
  const [members, setMembers] = useState<GroupMember[]>([])
  const [loading, setLoading] = useState(true)
  const [doneCollapsed, setDoneCollapsed] = useState(false)
  const [audience, setAudience] = useState<TodayAudience>('mine')

  // `useTasks()`/`useTaskLists()` re-derive `loadTasks`/`loadTaskLists`/
  // `addToast` on every render of ANY subscriber to the tasks store,
  // including this page's own store mutations (e.g. `addTask` inside
  // `handleCreateTask`). Depending on those identities directly re-fires the
  // mount effect below every time a task is added — the resulting refetch
  // can land between `addTask`'s POST and `handleCreateTask`'s follow-up
  // PATCH and overwrite the just-created task with its pre-PATCH (no due
  // date) snapshot, so a composer-created task silently vanishes from every
  // group on this page even though it did save. Refs keep the effect's
  // dependency array empty (TasksUpcomingPage.tsx/TasksAllPage.tsx have the
  // same pattern/comment).
  const loadTasksRef = useRef(loadTasks)
  const loadTaskListsRef = useRef(loadTaskLists)
  const addToastRef = useRef(addToast)
  useEffect(() => {
    loadTasksRef.current = loadTasks
    loadTaskListsRef.current = loadTaskLists
    addToastRef.current = addToast
  })

  useEffect(() => {
    let cancelled = false
    Promise.all([
      loadTasksRef.current('all'),
      loadTasksRef.current('completed'),
      loadTaskListsRef.current(),
      api.get<Record<string, unknown>[]>('/groups/members').then((rows) => rows.map(mapMember)),
    ])
      .then(([open, done, , memberRows]) => {
        if (cancelled) return
        setOpenTasks(open)
        setCompletedTasks(done)
        setMembers(memberRows)
      })
      .catch((err) => {
        if (cancelled) return
        addToastRef.current({ message: errorMessage(err, 'Could not load your tasks.') })
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const today = todayISO()
  const todayLabel = format(parseISO(today), 'EEEE d MMMM')

  const listById = useMemo(() => new Map(taskLists.map((l) => [l.id, l])), [taskLists])
  const coMembers = useMemo(() => members.map((m) => ({ userId: m.userId, username: m.username })), [members])

  // "Mine" filters both arrays to tasks owned by or assigned to the current
  // user; "Everyone" leaves the already-loaded own+assigned+shared-list set
  // (GET /tasks already scopes that server-side) untouched. No new fetch.
  const mineFilter = (t: Task) => t.ownerId === currentUserId || t.assigneeId === currentUserId
  const visibleOpen = audience === 'mine' ? openTasks.filter(mineFilter) : openTasks
  const visibleCompleted = audience === 'mine' ? completedTasks.filter(mineFilter) : completedTasks

  const overdueTasks = visibleOpen.filter((t) => t.dueDate !== null && t.dueDate < today)
  const todayTasks = visibleOpen.filter((t) => t.dueDate === today)
  const doneTodayTasks = visibleCompleted.filter((t) => t.completedAt?.slice(0, 10) === today)
  const upNext = visibleOpen
    .filter((t) => t.dueDate !== null && t.dueDate > today)
    .sort((a, b) => (a.dueDate! < b.dueDate! ? -1 : 1))
    .slice(0, 5)

  const oldestOverdueDays =
    overdueTasks.length > 0 ? Math.max(...overdueTasks.map((t) => dayDiff(t.dueDate!, today))) : null

  const assignedCount = visibleOpen.filter((t) => t.assigneeId === currentUserId).length
  const weekStart = isoDatePlus(-6)
  const finishedThisWeekCount = visibleCompleted.filter(
    (t) => t.completedAt && t.completedAt.slice(0, 10) >= weekStart && t.completedAt.slice(0, 10) <= today,
  ).length

  // The band total — overdue + due today + done today — is the single
  // number both the "N of M done today" figure and today's load-strip bar
  // report, so the two never disagree about what "today" contains.
  const totalToday = overdueTasks.length + todayTasks.length + doneTodayTasks.length
  const doneCount = doneTodayTasks.length
  const donePct = totalToday > 0 ? Math.round((doneCount / totalToday) * 100) : 0
  const lateOfDueTodayCount = overdueTasks.length

  const loadStrip = Array.from({ length: 7 }, (_, i) => {
    const date = isoDatePlus(i)
    const count = i === 0 ? totalToday : visibleOpen.filter((t) => t.dueDate === date).length
    return { date, label: format(parseISO(date), 'EEE'), count }
  })
  const maxLoad = Math.max(1, ...loadStrip.map((d) => d.count))
  const isHeaviestDay =
    loadStrip[0].count > 0 && loadStrip[0].count === maxLoad && loadStrip.some((d) => d.count < loadStrip[0].count)

  const handleToggleComplete = async (id: string) => {
    try {
      const updated = await completeTask(id)
      if (updated.isCompleted) {
        setOpenTasks((prev) => prev.filter((t) => t.id !== id))
        setCompletedTasks((prev) => [updated, ...prev])
      } else {
        setCompletedTasks((prev) => prev.filter((t) => t.id !== id))
        setOpenTasks((prev) => [...prev, updated])
      }
    } catch (err) {
      addToast({ message: errorMessage(err, 'Could not update that task — please try again.') })
    }
  }

  const handleContentChange = (taskId: string, content: string) => {
    setOpenTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, content } : t)))
    setCompletedTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, content } : t)))
  }
  const handleDueDateChange = (taskId: string, dueDate: string | null) => {
    setOpenTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, dueDate } : t)))
    setCompletedTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, dueDate } : t)))
  }

  /**
   * Re-creates a deleted task via a direct POST (the same restore shape
   * `useTasks.ts`'s own `restoreDeleted`/`TasksListDetailPage.tsx`'s
   * `undoDelete` use), kept local to this page since `openTasks`/
   * `completedTasks` are the only source of truth it needs here. CD-20:
   * Tasks deletes are always undo-toast, never a confirm dialog — this is
   * that undo.
   */
  const undoDeleteTask = async (snapshot: { task: Task; wasOpen: boolean }) => {
    const t = snapshot.task
    try {
      await api.post('/tasks', {
        id: t.id,
        parentId: t.parentId,
        content: t.content,
        note: t.note,
        isCompleted: t.isCompleted,
        isCollapsed: t.isCollapsed,
        sortOrder: t.sortOrder,
        dueDate: t.dueDate ?? null,
        listId: t.listId ?? null,
        priority: t.priority,
        dueTime: t.dueTime ?? null,
        assigneeId: t.assigneeId ?? null,
        assignedAt: t.assignedAt ?? null,
        recurrence: t.recurrence ?? null,
        recurrenceData: t.recurrenceData ?? null,
        recurrenceParentId: t.recurrenceParentId ?? null,
        walletRef: t.walletRef ?? null,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
      })
    } catch (err) {
      addToast({ message: errorMessage(err, 'Could not undo that delete — please try again.') })
      return
    }
    if (snapshot.wasOpen) setOpenTasks((prev) => [...prev, t])
    else setCompletedTasks((prev) => [...prev, t])
  }

  const undoToastIdsRef = useRef<Map<string, string>>(new Map())

  /** Delete + undo-toast, shared by TaskRow's kebab and TaskDetailModal's "Delete task" (CD-20). */
  const handleDeleteTask = async (task: Task) => {
    const wasOpen = openTasks.some((t) => t.id === task.id)
    const wasCompleted = completedTasks.some((t) => t.id === task.id)
    if (!wasOpen && !wasCompleted) return

    try {
      await deleteTaskById(task.id)
    } catch {
      // deleteTaskById already surfaced the failure (reportAndReconcile) —
      // nothing removed locally, nothing more to do here.
      return
    }

    setOpenTasks((prev) => prev.filter((t) => t.id !== task.id))
    setCompletedTasks((prev) => prev.filter((t) => t.id !== task.id))

    const existingToastId = undoToastIdsRef.current.get(task.id)
    if (existingToastId) removeToast(existingToastId)
    const toastId = addToast({
      message: 'Task deleted',
      action: {
        label: 'Undo',
        onClick: () => {
          void undoDeleteTask({ task, wasOpen })
          undoToastIdsRef.current.delete(task.id)
        },
      },
      duration: 5000,
    })
    undoToastIdsRef.current.set(task.id, toastId)
  }

  /**
   * "Reschedule all to today" — never claims success for a task it couldn't
   * move (CLAUDE.md §2 rule 10). `POST /tasks/reschedule` silently skips any
   * id outside the caller's own scope (e.g. assigned to someone else) and
   * only returns the rows it actually updated, so a shortfall is detected by
   * comparing what came back against what was asked for, not by trusting a
   * blanket "done" response.
   */
  const handleRescheduleAll = async () => {
    if (overdueTasks.length === 0) return
    const ids = overdueTasks.map((t) => t.id)
    try {
      const updated = await rescheduleTasks(ids, today)
      const updatedIds = new Set(updated.map((t) => t.id))
      setOpenTasks((prev) => prev.map((t) => (updatedIds.has(t.id) ? { ...t, dueDate: today } : t)))
      if (updated.length > 0) {
        addToast({ message: `Rescheduled ${updated.length} task${updated.length === 1 ? '' : 's'} to today.` })
      }
      const shortfall = ids.length - updated.length
      if (shortfall > 0) {
        addToast({
          message: `${shortfall} couldn't move — they belong to someone else.`,
        })
      }
    } catch (err) {
      addToast({ message: errorMessage(err, 'Could not reschedule those tasks — please try again.') })
    }
  }

  // FEAT-054: the composer parses a whole line ("pay rent tomorrow 9am
  // #household !high @tumpa") into a draft — create the task plain, then
  // fold every non-null parsed field into ONE follow-up PATCH (mirrors the
  // combined-update shape updateTaskDueDate/updateTaskDueTime already send,
  // per BUG-009's fix), rather than chaining several guard-free setters and
  // paying for a round trip each.
  const handleCreateTask = async (draft: TaskComposerDraft) => {
    let newTask: Task
    try {
      newTask = await addTask(draft.content, null)
    } catch (err) {
      addToast({ message: errorMessage(err, 'Could not add that task — please try again.') })
      return
    }

    // BUG-009: a task added from Today always defaults to today's date so it
    // still lands in the Today group, even when the composer text has no
    // date word — the parser leaving dueDate null must not mean "no date".
    const dueDate = draft.dueDate ?? today

    const patch: Record<string, unknown> = { dueDate }
    if (draft.listId !== null) patch.listId = draft.listId
    if (draft.priority !== null) patch.priority = draft.priority
    if (draft.assigneeId !== null) patch.assigneeId = draft.assigneeId
    if (draft.dueTime !== null) patch.dueTime = draft.dueTime

    try {
      const row = await api.patch<Record<string, unknown>>(`/tasks/${newTask.id}`, patch)
      const merged: Task = {
        ...newTask,
        listId: (row.list_id as string | null | undefined) ?? draft.listId ?? newTask.listId,
        priority: (row.priority as Task['priority'] | undefined) ?? draft.priority ?? newTask.priority,
        assigneeId: (row.assignee_id as string | null | undefined) ?? draft.assigneeId ?? newTask.assigneeId,
        dueDate: (row.due_date as string | null | undefined) ?? dueDate,
        dueTime: (row.due_time as string | null | undefined) ?? draft.dueTime ?? newTask.dueTime,
      }
      setOpenTasks((prev) => [...prev, merged])
    } catch (err) {
      // The task itself was created — only the follow-up detail patch failed.
      // Surface that distinction rather than implying the whole add failed.
      addToast({ message: errorMessage(err, 'Task added, but its details could not be saved — please edit it to fix that.') })
      setOpenTasks((prev) => [...prev, newTask])
    }
  }

  const handleTaskFormSubmit = async (draft: TaskFormDraft) => {
    await handleCreateTask(draft)
  }

  const handleSaved = (updated: Task) => {
    setOpenTasks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)))
    setCompletedTasks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)))
  }

  const handleDeletedFromModal = (taskId: string) => {
    setOpenTasks((prev) => prev.filter((t) => t.id !== taskId))
    setCompletedTasks((prev) => prev.filter((t) => t.id !== taskId))
  }

  // "Worth knowing" — only what's honestly derivable from data already on
  // the page (no fabricated "moved N times" stat — no such tracking exists).
  const noDueDateCount = visibleOpen.filter((t) => t.dueDate === null).length
  const eveningTodayCount = todayTasks.filter((t) => t.dueTime && Number(t.dueTime.slice(0, 2)) >= 17).length
  const loadImbalance = maxLoad - Math.min(...loadStrip.map((d) => d.count))
  const worthKnowing: WorthKnowingItem[] = []
  if (loadImbalance >= 3) {
    worthKnowing.push({
      title: 'Your week is lopsided',
      sub: `Busiest day has ${maxLoad}, lightest has ${Math.min(...loadStrip.map((d) => d.count))} — worth spreading out.`,
      href: '/tasks/upcoming',
      actionLabel: 'Spread it out',
    })
  }
  if (noDueDateCount > 0) {
    worthKnowing.push({
      title: `${noDueDateCount} task${noDueDateCount === 1 ? '' : 's'} with no due date`,
      sub: 'Nothing is tracking when these should happen.',
      href: '/tasks/all',
      actionLabel: 'Add dates',
    })
  }
  if (eveningTodayCount > 0) {
    worthKnowing.push({
      title: `${eveningTodayCount} evening task${eveningTodayCount === 1 ? '' : 's'} today`,
      sub: 'Your evening is loaded up — plan around it.',
      href: '/tasks/all',
      actionLabel: 'Review evenings',
    })
  }

  const rescheduleLabel =
    overdueTasks.length === 2
      ? 'Reschedule both to today'
      : overdueTasks.length === 1
        ? 'Reschedule to today'
        : `Reschedule all ${overdueTasks.length} to today`

  return {
    taskLists,
    loading,
    doneCollapsed,
    setDoneCollapsed,
    audience,
    setAudience,
    today,
    todayLabel,
    listById,
    coMembers,
    overdueTasks,
    todayTasks,
    doneTodayTasks,
    upNext,
    oldestOverdueDays,
    assignedCount,
    finishedThisWeekCount,
    totalToday,
    doneCount,
    donePct,
    lateOfDueTodayCount,
    loadStrip,
    maxLoad,
    isHeaviestDay,
    openTasks,
    completedTasks,
    rescheduleLabel,
    worthKnowing,
    handleToggleComplete,
    handleContentChange,
    handleDueDateChange,
    handleDeleteTask,
    handleRescheduleAll,
    handleCreateTask,
    handleTaskFormSubmit,
    handleSaved,
    handleDeletedFromModal,
  }
}
