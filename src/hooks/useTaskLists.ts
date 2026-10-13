import { useCallback } from 'react'
import { create } from 'zustand'
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

// A plain per-component useState would give every caller — ModuleSidebar's
// "Lists" group AND every tasks page that calls this hook — its own
// disconnected copy, so a list deleted/renamed/created from one place (e.g.
// TasksListDetailPage.tsx's "Delete list") would leave every other mounted
// copy (the sidebar above all) showing stale rows until a full reload. A
// module-scoped Zustand store (the same library every other cross-component
// slice in this app already uses — tasks.store/toast.store/app.store) makes
// every `useTaskLists()` caller read and write the SAME list, so one
// successful write anywhere is instantly visible everywhere.
interface TaskListsState {
  taskLists: TaskList[]
  loaded: boolean
  setTaskLists: (lists: TaskList[]) => void
  setLoaded: (loaded: boolean) => void
}

const useTaskListsStore = create<TaskListsState>((set) => ({
  taskLists: [],
  loaded: false,
  setTaskLists: (taskLists) => set({ taskLists }),
  setLoaded: (loaded) => set({ loaded }),
}))

/**
 * Fetches `GET /task-lists` (R4 — worker/routes/tasks.ts) and exposes the
 * rows for both the sidebar's dynamic "Lists" group and every tasks page.
 * Backed by a shared store (see the doc comment above) — every caller sees
 * the same `taskLists` array and the same loaded flag.
 */
export function useTaskLists() {
  const taskLists = useTaskListsStore((s) => s.taskLists)
  const loaded = useTaskListsStore((s) => s.loaded)

  const loadTaskLists = useCallback(async (): Promise<TaskList[]> => {
    const rows = await api.get<TaskListRow[]>('/task-lists')
    const lists = rows.map(rowToTaskList)
    useTaskListsStore.getState().setTaskLists(lists)
    useTaskListsStore.getState().setLoaded(true)
    return lists
  }, [])

  // FEAT-053 (docs/backlog/EP-07-tasks-depth/FEAT-053-create-task-list.md):
  // POST /task-lists already existed and worked — nothing in the client ever
  // called it.
  const createTaskList = useCallback(async (input: { name: string; color?: string }): Promise<TaskList> => {
    const row = await api.post<TaskListRow>('/task-lists', input)
    const list = rowToTaskList(row)
    useTaskListsStore.getState().setTaskLists([...useTaskListsStore.getState().taskLists, list])
    return list
  }, [])

  // Tasks-lists-and-assigned-completed-parity work: "Delete list" in
  // TasksListDetailPage.tsx's rail. DELETE /task-lists/:id (worker/routes/
  // tasks.ts) already sets every member task's list_id to NULL server-side
  // before removing the row — nothing in the client ever called it either.
  const deleteTaskList = useCallback(async (id: string): Promise<void> => {
    await api.delete(`/task-lists/${id}`)
    useTaskListsStore.getState().setTaskLists(useTaskListsStore.getState().taskLists.filter((l) => l.id !== id))
  }, [])

  return { taskLists, loaded, loadTaskLists, createTaskList, deleteTaskList }
}
