export type TaskPriority = 'none' | 'low' | 'med' | 'high'

export interface Task {
  id: string
  parentId: string | null
  content: string
  note: string
  isCompleted: boolean
  isCollapsed: boolean
  sortOrder: number
  dueDate: string | null
  createdAt: string
  updatedAt: string
  children?: Task[]
  // R4 fields (docs/v2/tasks/01-data-model.md) — additive, nullable/optional.
  listId: string | null
  priority: TaskPriority
  dueTime: string | null
  assigneeId: string | null
  completedAt: string | null
  // R5 PR-2: subtask progress, always present on rows from `GET /tasks`
  // (worker/routes/tasks.ts derives them via correlated subqueries on every
  // row) but not carried through the client mapping until now — see
  // TaskListRow.tsx's subtask progress badge.
  subtaskTotal: number
  subtaskDone: number
}
