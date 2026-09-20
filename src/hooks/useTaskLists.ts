import { useCallback, useState } from 'react'
import { api } from '@/lib/api'

/** In-memory shape of a `task_lists` row, plus its live open-task count. */
export interface TaskList {
  id: string
  name: string
  color: string
  icon: string
  sortOrder: number
  openCount: number
}

/** DB row shape returned by GET /task-lists — column names match the SQL schema. */
interface TaskListRow {
  id: string
  user_id: string
  name: string
  color: string
  icon: string
  sort_order: number
  archived: number
  created_at: string
  // Only present on GET /task-lists (a correlated subquery) — POST /task-lists'
  // plain `RETURNING *` doesn't compute it, since a list a caller just
  // created can't have any open tasks in it yet anyway.
  open_count?: number
}

function rowToTaskList(row: TaskListRow): TaskList {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    icon: row.icon,
    sortOrder: row.sort_order,
    openCount: row.open_count ?? 0,
  }
}

/**
 * Fetches `GET /task-lists` (R4 — worker/routes/tasks.ts) and exposes the
 * rows for both the sidebar's dynamic "Lists" group and the Today page.
 */
export function useTaskLists() {
  const [taskLists, setTaskLists] = useState<TaskList[]>([])
  const [loaded, setLoaded] = useState(false)

  const loadTaskLists = useCallback(async (): Promise<TaskList[]> => {
    const rows = await api.get<TaskListRow[]>('/task-lists')
    const lists = rows.map(rowToTaskList)
    setTaskLists(lists)
    setLoaded(true)
    return lists
  }, [])

  // FEAT-053 (docs/backlog/EP-07-tasks-depth/FEAT-053-create-task-list.md):
  // POST /task-lists already existed and worked — nothing in the client ever
  // called it.
  const createTaskList = useCallback(async (input: { name: string; color?: string }): Promise<TaskList> => {
    const row = await api.post<TaskListRow>('/task-lists', input)
    const list = rowToTaskList(row)
    setTaskLists((prev) => [...prev, list])
    return list
  }, [])

  return { taskLists, loaded, loadTaskLists, createTaskList }
}
