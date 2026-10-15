import { format, parseISO } from 'date-fns'
import { localDateOfUtc, todayISO } from '@/lib/utils'
import type { TaskList } from '@/hooks/useTaskLists'
import type { Task } from '@/types/tasks.types'

export type TaskStatus = 'open' | 'done' | 'all'
export type TaskGrouping = 'date' | 'list'
export type TaskSort = 'due' | 'priority' | 'recent'

export const SORT_LABELS: Record<TaskSort, string> = {
  due: 'Due date',
  priority: 'Priority',
  recent: 'Recently added',
}

export interface TaskGroup {
  key: string
  label: string
  /** Overdue reads red; a list group carries its colour dot. */
  tone?: 'neg'
  color?: string
  /** Every task in the group — `visible` is the slice the current page shows. */
  tasks: Task[]
  visible: Task[]
}

/** "Older than three months" — shared by the age card and the page's age filter so both count the same set. */
export const OLD_TASK_DAYS = 90

/** Days since a task was created. */
export function taskAgeDays(task: Task): number {
  return dayDiff(localDateOfUtc(task.createdAt), todayISO())
}

const PRIORITY_RANK: Record<string, number> = { high: 0, med: 1, low: 2 }

function dayDiff(fromIso: string, toIso: string): number {
  const [y1, m1, d1] = fromIso.split('-').map(Number)
  const [y2, m2, d2] = toIso.split('-').map(Number)
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000)
}

/** Soonest due first, undated last; completed tasks most-recently-done first. */
function byDue(a: Task, b: Task): number {
  if (a.isCompleted && b.isCompleted) return (b.completedAt ?? '').localeCompare(a.completedAt ?? '')
  if (a.dueDate !== b.dueDate) {
    if (a.dueDate === null) return 1
    if (b.dueDate === null) return -1
    return a.dueDate.localeCompare(b.dueDate)
  }
  if (a.dueTime !== b.dueTime) {
    if (a.dueTime === null) return 1
    if (b.dueTime === null) return -1
    return a.dueTime.localeCompare(b.dueTime)
  }
  return a.createdAt.localeCompare(b.createdAt)
}

export function sortTasks(tasks: Task[], sort: TaskSort): Task[] {
  const copy = [...tasks]
  if (sort === 'recent') return copy.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  if (sort === 'priority') {
    return copy.sort((a, b) => {
      const rank = (PRIORITY_RANK[a.priority] ?? 3) - (PRIORITY_RANK[b.priority] ?? 3)
      return rank !== 0 ? rank : byDue(a, b)
    })
  }
  return copy.sort(byDue)
}

/** Which date bucket a task falls in, in display order, with its heading. */
function dateBucket(task: Task, status: TaskStatus, today: string): { order: number; key: string; label: string; tone?: 'neg' } {
  if (task.isCompleted) {
    if (status === 'all') return { order: 10, key: 'done', label: 'Done' }
    const ago = task.completedAt ? dayDiff(task.completedAt.slice(0, 10), today) : Infinity
    if (ago <= 0) return { order: 10, key: 'done-today', label: 'Completed today' }
    if (ago === 1) return { order: 11, key: 'done-yesterday', label: 'Yesterday' }
    if (ago < 7) return { order: 12, key: 'done-week', label: 'Earlier this week' }
    return { order: 13, key: 'done-earlier', label: 'Earlier' }
  }
  if (task.dueDate === null) return { order: 6, key: 'none', label: 'No due date' }
  const diff = dayDiff(today, task.dueDate)
  const day = format(parseISO(task.dueDate), 'EEE d MMM')
  if (diff < 0) return { order: 1, key: 'overdue', label: 'Overdue', tone: 'neg' }
  if (diff === 0) return { order: 2, key: 'today', label: `Today · ${day}` }
  if (diff === 1) return { order: 3, key: 'tomorrow', label: `Tomorrow · ${day}` }
  if (diff < 7) return { order: 4, key: 'week', label: 'Later this week' }
  return { order: 5, key: 'later', label: 'Later' }
}

/**
 * Groups, sorts within each group, then pages across the flattened order —
 * so "Load more" reveals the next rows in exactly the order they display,
 * and each group heading keeps counting its full size.
 */
export function groupTasks(
  tasks: Task[],
  opts: {
    status: TaskStatus
    grouping: TaskGrouping
    sort: TaskSort
    limit: number
    today: string
    lists: TaskList[]
  },
): TaskGroup[] {
  const groups = new Map<string, TaskGroup & { order: number }>()

  if (opts.grouping === 'list') {
    const order = new Map(opts.lists.map((l, i) => [l.id, i]))
    for (const t of tasks) {
      const list = t.listId ? opts.lists.find((l) => l.id === t.listId) : undefined
      const key = list?.id ?? 'unsorted'
      if (!groups.has(key)) {
        groups.set(key, {
          key,
          label: list?.name ?? 'Unsorted',
          color: list?.color ?? 'rgb(var(--line-strong))',
          order: list ? (order.get(list.id) ?? 0) : Number.MAX_SAFE_INTEGER,
          tasks: [],
          visible: [],
        })
      }
      groups.get(key)!.tasks.push(t)
    }
  } else {
    for (const t of tasks) {
      const b = dateBucket(t, opts.status, opts.today)
      if (!groups.has(b.key)) groups.set(b.key, { ...b, tasks: [], visible: [] })
      groups.get(b.key)!.tasks.push(t)
    }
  }

  const ordered = [...groups.values()].sort((a, b) => a.order - b.order)
  let remaining = opts.limit
  for (const g of ordered) {
    g.tasks = sortTasks(g.tasks, opts.sort)
    g.visible = g.tasks.slice(0, Math.max(0, remaining))
    remaining -= g.visible.length
  }
  return ordered.filter((g) => g.visible.length > 0)
}
