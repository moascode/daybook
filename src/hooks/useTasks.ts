import { useCallback } from 'react'
import { getDB } from '@/db'
import { useTasksStore } from '@/stores/tasks.store'
import { generateId, nowISO } from '@/lib/utils'
import type { Task } from '@/types/tasks.types'

/** DB row shape — column names match the SQL schema. */
interface TaskRow {
  id: string
  parent_id: string | null
  content: string
  note: string
  is_completed: number
  is_collapsed: number
  sort_order: number
  created_at: string
  updated_at: string
}

/** Convert a DB row to the in-memory Task interface. */
function rowToTask(row: TaskRow): Task {
  return {
    id: row.id,
    parentId: row.parent_id,
    content: row.content,
    note: row.note ?? '',
    isCompleted: row.is_completed === 1,
    isCollapsed: row.is_collapsed === 1,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/**
 * Compute the sort order for a new task inserted after `afterId` among `siblings`.
 * Uses midpoint insertion. Returns the sort order value.
 */
function computeSortOrder(siblings: Task[], afterId: string | null): number {
  if (siblings.length === 0) {
    return 1.0
  }

  // If no afterId, insert at the end
  if (afterId === null) {
    const last = siblings[siblings.length - 1]
    return last.sortOrder + 1.0
  }

  const afterIndex = siblings.findIndex((t) => t.id === afterId)
  if (afterIndex === -1) {
    // afterId not found among siblings — append at end
    const last = siblings[siblings.length - 1]
    return last.sortOrder + 1.0
  }

  const afterTask = siblings[afterIndex]
  const nextTask = siblings[afterIndex + 1]

  if (!nextTask) {
    // Inserting at the end
    return afterTask.sortOrder + 1.0
  }

  // Midpoint insertion
  return (afterTask.sortOrder + nextTask.sortOrder) / 2
}

export function useTasks() {
  const store = useTasksStore()

  /** Load all tasks from the database into the Zustand store. */
  const loadTasks = useCallback(async () => {
    const db = await getDB()
    const result = await db.query<TaskRow>(
      'SELECT * FROM tasks ORDER BY sort_order ASC',
    )
    const tasks = result.rows.map(rowToTask)
    store.setTasks(tasks)
  }, [store])

  /**
   * Add a new task.
   * @param content — initial text content
   * @param parentId — parent task ID, or null for root level
   * @param afterId — insert after this sibling (null = append at end)
   * @returns the created Task
   */
  const addTask = useCallback(
    async (
      content: string,
      parentId: string | null,
      afterId: string | null = null,
    ): Promise<Task> => {
      const db = await getDB()
      const allTasks = useTasksStore.getState().tasks

      // Get siblings at the same level
      const siblings = allTasks
        .filter((t) => t.parentId === parentId)
        .sort((a, b) => a.sortOrder - b.sortOrder)

      const sortOrder = computeSortOrder(siblings, afterId)
      const id = generateId()
      const now = nowISO()

      await db.query(
        `INSERT INTO tasks (id, parent_id, content, note, is_completed, is_collapsed, sort_order, created_at, updated_at)
         VALUES ($1, $2, $3, '', 0, 0, $4, $5, $5)`,
        [id, parentId, content, sortOrder, now],
      )

      const newTask: Task = {
        id,
        parentId,
        content,
        note: '',
        isCompleted: false,
        isCollapsed: false,
        sortOrder,
        createdAt: now,
        updatedAt: now,
      }

      useTasksStore.getState().addTask(newTask)

      // Check if rebalance is needed
      await maybeRebalance(parentId)

      return newTask
    },
    [],
  )

  /**
   * Update one or more fields of a task.
   * Accepts partial Task fields using camelCase names — maps to DB column names internally.
   */
  const updateTask = useCallback(
    async (
      id: string,
      updates: Partial<
        Pick<Task, 'content' | 'note' | 'isCompleted' | 'isCollapsed' | 'parentId' | 'sortOrder'>
      >,
    ) => {
      const db = await getDB()
      const now = nowISO()

      // Build SET clauses dynamically
      const setClauses: string[] = ['updated_at = $1']
      const params: unknown[] = [now]
      let paramIndex = 2

      if (updates.content !== undefined) {
        setClauses.push(`content = $${paramIndex}`)
        params.push(updates.content)
        paramIndex++
      }
      if (updates.note !== undefined) {
        setClauses.push(`note = $${paramIndex}`)
        params.push(updates.note)
        paramIndex++
      }
      if (updates.isCompleted !== undefined) {
        setClauses.push(`is_completed = $${paramIndex}`)
        params.push(updates.isCompleted ? 1 : 0)
        paramIndex++
      }
      if (updates.isCollapsed !== undefined) {
        setClauses.push(`is_collapsed = $${paramIndex}`)
        params.push(updates.isCollapsed ? 1 : 0)
        paramIndex++
      }
      if (updates.parentId !== undefined) {
        setClauses.push(`parent_id = $${paramIndex}`)
        params.push(updates.parentId)
        paramIndex++
      }
      if (updates.sortOrder !== undefined) {
        setClauses.push(`sort_order = $${paramIndex}`)
        params.push(updates.sortOrder)
        paramIndex++
      }

      params.push(id)
      const sql = `UPDATE tasks SET ${setClauses.join(', ')} WHERE id = $${paramIndex}`
      await db.query(sql, params)

      // Update Zustand store
      useTasksStore.getState().updateTask(id, {
        ...updates,
        updatedAt: now,
      })
    },
    [],
  )

  /**
   * Delete a task from DB and store. CASCADE in DB handles children.
   * We must also remove children from the Zustand store manually.
   */
  const deleteTask = useCallback(async (id: string) => {
    const db = await getDB()

    // Collect all descendant IDs so we can remove them from the store
    const allTasks = useTasksStore.getState().tasks
    const idsToRemove = collectDescendantIds(id, allTasks)

    await db.query('DELETE FROM tasks WHERE id = $1', [id])

    // Remove the task and all its descendants from the store
    const remaining = allTasks.filter((t) => !idsToRemove.has(t.id))
    useTasksStore.getState().setTasks(remaining)
  }, [])

  /**
   * Move a task to a new parent and/or sort position (for DnD).
   */
  const moveTask = useCallback(
    async (id: string, newParentId: string | null, newSortOrder: number) => {
      const db = await getDB()
      const now = nowISO()

      await db.query(
        `UPDATE tasks SET parent_id = $1, sort_order = $2, updated_at = $3 WHERE id = $4`,
        [newParentId, newSortOrder, now, id],
      )

      useTasksStore.getState().updateTask(id, {
        parentId: newParentId,
        sortOrder: newSortOrder,
        updatedAt: now,
      })

      await maybeRebalance(newParentId)
    },
    [],
  )

  /**
   * Indent a task — make it a child of its previous sibling.
   * Returns true if the indent was successful, false if not possible.
   */
  const indentTask = useCallback(
    async (id: string): Promise<boolean> => {
      const allTasks = useTasksStore.getState().tasks
      const task = allTasks.find((t) => t.id === id)
      if (!task) return false

      // Get siblings at the same level
      const siblings = allTasks
        .filter((t) => t.parentId === task.parentId)
        .sort((a, b) => a.sortOrder - b.sortOrder)

      const currentIndex = siblings.findIndex((t) => t.id === id)
      if (currentIndex <= 0) return false // Can't indent the first item

      const newParent = siblings[currentIndex - 1]

      // Get the new parent's existing children to find the right sort order
      const newSiblings = allTasks
        .filter((t) => t.parentId === newParent.id)
        .sort((a, b) => a.sortOrder - b.sortOrder)

      const sortOrder =
        newSiblings.length > 0
          ? newSiblings[newSiblings.length - 1].sortOrder + 1.0
          : 1.0

      // Uncollapse the new parent so the moved task is visible
      if (newParent.isCollapsed) {
        await updateTask(newParent.id, { isCollapsed: false })
      }

      await moveTask(id, newParent.id, sortOrder)
      return true
    },
    [moveTask, updateTask],
  )

  /**
   * Outdent a task — move it to be a sibling of its parent (after the parent).
   * Returns true if the outdent was successful, false if not possible.
   */
  const outdentTask = useCallback(
    async (id: string): Promise<boolean> => {
      const allTasks = useTasksStore.getState().tasks
      const task = allTasks.find((t) => t.id === id)
      if (!task || !task.parentId) return false // Can't outdent root-level items

      const parent = allTasks.find((t) => t.id === task.parentId)
      if (!parent) return false

      // Get the parent's siblings to find the right sort order
      const parentSiblings = allTasks
        .filter((t) => t.parentId === parent.parentId)
        .sort((a, b) => a.sortOrder - b.sortOrder)

      const parentIndex = parentSiblings.findIndex((t) => t.id === parent.id)
      const nextSibling = parentSiblings[parentIndex + 1]

      let sortOrder: number
      if (!nextSibling) {
        sortOrder = parent.sortOrder + 1.0
      } else {
        sortOrder = (parent.sortOrder + nextSibling.sortOrder) / 2
      }

      await moveTask(id, parent.parentId, sortOrder)
      return true
    },
    [moveTask],
  )

  /**
   * Get the breadcrumb path from root to a given task ID.
   */
  const getBreadcrumb = useCallback(
    (taskId: string | null): Task[] => {
      if (!taskId) return []

      // Always read fresh from the store so callers holding a stale ref still get current data.
      const allTasks = useTasksStore.getState().tasks
      const path: Task[] = []
      let current = allTasks.find((t) => t.id === taskId)

      while (current) {
        path.unshift(current)
        current = current.parentId
          ? allTasks.find((t) => t.id === current!.parentId)
          : undefined
      }

      return path
    },
    [],
  )

  /**
   * Get children of a parent, sorted by sortOrder.
   * Respects hideCompleted setting.
   */
  const getChildren = useCallback(
    (parentId: string | null): Task[] => {
      const { tasks, hideCompleted } = useTasksStore.getState()
      return tasks
        .filter((t) => {
          if (t.parentId !== parentId) return false
          if (hideCompleted && t.isCompleted) return false
          return true
        })
        .sort((a, b) => a.sortOrder - b.sortOrder)
    },
    [],
  )

  /**
   * Check if a task has children.
   */
  const hasChildren = useCallback((taskId: string): boolean => {
    const { tasks } = useTasksStore.getState()
    return tasks.some((t) => t.parentId === taskId)
  }, [])

  return {
    tasks: store.tasks,
    rootId: store.rootId,
    hideCompleted: store.hideCompleted,
    setRootId: store.setRootId,
    setHideCompleted: store.setHideCompleted,
    loadTasks,
    addTask,
    updateTask,
    deleteTask,
    moveTask,
    indentTask,
    outdentTask,
    getBreadcrumb,
    getChildren,
    hasChildren,
  }
}

// ── Helpers ──────────────────────────────────────────

/** Collect the given ID plus all descendant IDs recursively. */
function collectDescendantIds(
  id: string,
  allTasks: Task[],
): Set<string> {
  const ids = new Set<string>([id])
  const queue = [id]

  while (queue.length > 0) {
    const parentId = queue.pop()!
    for (const task of allTasks) {
      if (task.parentId === parentId && !ids.has(task.id)) {
        ids.add(task.id)
        queue.push(task.id)
      }
    }
  }

  return ids
}

/**
 * Check if any adjacent siblings under `parentId` have a sort order gap < 0.001.
 * If so, rebalance all siblings to have integer sort orders.
 */
async function maybeRebalance(parentId: string | null) {
  const allTasks = useTasksStore.getState().tasks
  const siblings = allTasks
    .filter((t) => t.parentId === parentId)
    .sort((a, b) => a.sortOrder - b.sortOrder)

  if (siblings.length < 2) return

  let needsRebalance = false
  for (let i = 1; i < siblings.length; i++) {
    if (siblings[i].sortOrder - siblings[i - 1].sortOrder < 0.001) {
      needsRebalance = true
      break
    }
  }

  if (!needsRebalance) return

  const db = await getDB()
  const now = nowISO()

  // Batch-update all siblings to integer sort orders
  for (let i = 0; i < siblings.length; i++) {
    const newOrder = i + 1
    if (siblings[i].sortOrder !== newOrder) {
      await db.query(
        'UPDATE tasks SET sort_order = $1, updated_at = $2 WHERE id = $3',
        [newOrder, now, siblings[i].id],
      )
      useTasksStore.getState().updateTask(siblings[i].id, {
        sortOrder: newOrder,
        updatedAt: now,
      })
    }
  }
}
