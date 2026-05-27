import { useEffect, useState, useCallback, useRef } from 'react'
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable'
import { Plus, Eye, EyeOff, ChevronRight, Home } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { CheckSquare } from 'lucide-react'
import { useTasks } from '@/hooks/useTasks'
import { useTasksStore } from '@/stores/tasks.store'
import { BulletTree } from './BulletTree'

export function TasksPage() {
  const {
    tasks,
    rootId,
    hideCompleted,
    setRootId,
    setHideCompleted,
    loadTasks,
    addTask,
    updateTask,
    deleteTask,
    moveTask,
    indentTask,
    outdentTask,
    getBreadcrumb,
  } = useTasks()

  const [loaded, setLoaded] = useState(false)
  const [focusId, setFocusId] = useState<string | null>(null)

  // Track the previously focused ID so we clear autoFocus after it mounts
  const focusTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Task action callbacks ──────────────────────────────────────────
  const handleUpdate = useCallback(
    (id: string, content: string) => {
      updateTask(id, { content })
    },
    [updateTask],
  )

  const handleUpdateNote = useCallback(
    (id: string, note: string) => {
      updateTask(id, { note })
    },
    [updateTask],
  )

  const handleToggleComplete = useCallback(
    (id: string) => {
      const task = useTasksStore.getState().tasks.find((t) => t.id === id)
      if (task) {
        updateTask(id, { isCompleted: !task.isCompleted })
      }
    },
    [updateTask],
  )

  const handleToggleCollapse = useCallback(
    (id: string) => {
      const task = useTasksStore.getState().tasks.find((t) => t.id === id)
      if (task) {
        updateTask(id, { isCollapsed: !task.isCollapsed })
      }
    },
    [updateTask],
  )

  const handleEnter = useCallback(
    async (id: string) => {
      const allTasks = useTasksStore.getState().tasks
      const task = allTasks.find((t) => t.id === id)
      if (!task) return

      const newTask = await addTask('', task.parentId, id)
      setFocusId(newTask.id)
    },
    [addTask],
  )

  const handleBackspaceEmpty = useCallback(
    async (id: string) => {
      const allTasks = useTasksStore.getState().tasks
      const task = allTasks.find((t) => t.id === id)
      if (!task) return

      const siblings = allTasks
        .filter((t) => t.parentId === task.parentId)
        .sort((a, b) => a.sortOrder - b.sortOrder)

      const currentIndex = siblings.findIndex((t) => t.id === id)
      const prevSibling = siblings[currentIndex - 1]

      await deleteTask(id)

      if (prevSibling) {
        setFocusId(prevSibling.id)
      } else if (task.parentId) {
        setFocusId(task.parentId)
      }
    },
    [deleteTask],
  )

  const handleIndent = useCallback(
    async (id: string) => {
      await indentTask(id)
    },
    [indentTask],
  )

  const handleOutdent = useCallback(
    async (id: string) => {
      await outdentTask(id)
    },
    [outdentTask],
  )

  const handleDelete = useCallback(
    async (id: string) => {
      await deleteTask(id)
    },
    [deleteTask],
  )

  const handleZoomIn = useCallback(
    (id: string) => {
      setRootId(id)
    },
    [setRootId],
  )

  const handleAddRootTask = useCallback(async () => {
    const newTask = await addTask('', rootId)
    setFocusId(newTask.id)
  }, [addTask, rootId])

  const handleToggleHideCompleted = useCallback(() => {
    setHideCompleted(!hideCompleted)
  }, [hideCompleted, setHideCompleted])

  // Load tasks on mount
  useEffect(() => {
    loadTasks().then(() => setLoaded(true))
  }, [loadTasks])

  // Expose task operations for E2E testing
  useEffect(() => {
    if (import.meta.env.DEV) {
      (window as any).__testIndentTask = (id: string) => indentTask(id);
      (window as any).__testOutdentTask = (id: string) => outdentTask(id);
      (window as any).__testGetTasks = () => useTasksStore.getState().tasks;
      (window as any).__testToggleCollapse = (id: string) => handleToggleCollapse(id);
      (window as any).__testUpdateTask = (id: string, updates: any) => updateTask(id, updates)
      return () => {
        delete (window as any).__testIndentTask
        delete (window as any).__testOutdentTask
        delete (window as any).__testGetTasks
        delete (window as any).__testToggleCollapse
        delete (window as any).__testUpdateTask
      }
    }
  }, [indentTask, outdentTask, handleToggleCollapse, updateTask])

  // Clear focusId after a short delay so it doesn't re-focus on every render
  useEffect(() => {
    if (focusId) {
      focusTimeoutRef.current = setTimeout(() => {
        setFocusId(null)
      }, 100)
    }
    return () => {
      if (focusTimeoutRef.current) {
        clearTimeout(focusTimeoutRef.current)
      }
    }
  }, [focusId])

  // ── DnD sensors ──────────────────────────────────────────
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // Require 8px of movement before drag starts (prevents accidental drags)
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  )

  // ── DnD handler ──────────────────────────────────────────
  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event
      if (!over || active.id === over.id) return

      const activeId = active.id as string
      const overId = over.id as string

      const allTasks = useTasksStore.getState().tasks
      const activeTask = allTasks.find((t) => t.id === activeId)
      const overTask = allTasks.find((t) => t.id === overId)
      if (!activeTask || !overTask) return

      // Move within the same parent level
      const parentId = overTask.parentId
      const siblings = allTasks
        .filter((t) => t.parentId === parentId)
        .sort((a, b) => a.sortOrder - b.sortOrder)

      const overIndex = siblings.findIndex((t) => t.id === overId)

      let newSortOrder: number
      if (overIndex === 0) {
        // Dropped before the first item
        newSortOrder = siblings[0].sortOrder / 2
      } else if (overIndex === siblings.length - 1) {
        // Dropped after the last item
        newSortOrder = siblings[siblings.length - 1].sortOrder + 1.0
      } else {
        // Dropped between two items — determine if before or after the over item
        const activeIndex = siblings.findIndex((t) => t.id === activeId)
        if (activeIndex < overIndex) {
          // Moving down — place after over
          const next = siblings[overIndex + 1]
          newSortOrder = next
            ? (overTask.sortOrder + next.sortOrder) / 2
            : overTask.sortOrder + 1.0
        } else {
          // Moving up — place before over
          const prev = siblings[overIndex - 1]
          newSortOrder = prev
            ? (prev.sortOrder + overTask.sortOrder) / 2
            : overTask.sortOrder / 2
        }
      }

      moveTask(activeId, parentId, newSortOrder)
    },
    [moveTask],
  )

  // ── Breadcrumb ──────────────────────────────────────────
  const breadcrumb = getBreadcrumb(rootId)

  // ── Render ──────────────────────────────────────────
  if (!loaded) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
      </div>
    )
  }

  // Check if there are any tasks at the current root level
  const currentLevelTasks = tasks.filter((t) => t.parentId === rootId)
  const isEmpty = currentLevelTasks.length === 0

  return (
    <div className="mx-auto max-w-2xl">
      {/* ── Toolbar ─────────────────────────────────────────── */}
      <div className="mb-5 flex items-center justify-between gap-3">

        {/* Breadcrumb */}
        <div className="flex min-w-0 items-center gap-0.5 text-sm">
          <button
            onClick={() => setRootId(null)}
            className={`flex shrink-0 items-center justify-center h-7 w-7 rounded-md transition-colors ${
              rootId === null
                ? 'text-gray-900 bg-gray-100'
                : 'text-gray-400 hover:text-gray-700 hover:bg-gray-100'
            }`}
            title="All tasks"
          >
            <Home className="h-3.5 w-3.5" />
          </button>

          {breadcrumb.map((task) => (
            <span key={task.id} className="flex min-w-0 items-center gap-0.5">
              <ChevronRight className="h-3 w-3 shrink-0 text-gray-300" />
              <button
                onClick={() => setRootId(task.id)}
                className="max-w-[160px] truncate rounded-md px-1.5 py-0.5 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-800 text-xs"
                title={task.content}
              >
                {task.content || 'Untitled'}
              </button>
            </span>
          ))}
        </div>

        {/* Actions */}
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            onClick={handleToggleHideCompleted}
            title={hideCompleted ? 'Show completed tasks' : 'Hide completed tasks'}
            className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-800"
          >
            {hideCompleted ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
            {hideCompleted ? 'Show done' : 'Hide done'}
          </button>

          <Button size="sm" onClick={handleAddRootTask}>
            <Plus className="h-3.5 w-3.5" />
            New task
          </Button>
        </div>
      </div>

      {/* ── Content ─────────────────────────────────────────── */}
      {isEmpty ? (
        <EmptyState
          icon={<CheckSquare className="h-10 w-10" />}
          title={rootId ? 'No tasks here' : 'No tasks yet'}
          description={
            rootId
              ? 'Press Enter or click "New task" to add items here.'
              : 'Create your first task to get started.'
          }
          action={
            <Button size="sm" onClick={handleAddRootTask}>
              <Plus className="h-3.5 w-3.5" />
              New task
            </Button>
          }
        />
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <BulletTree
            parentId={rootId}
            depth={0}
            focusId={focusId}
            onUpdate={handleUpdate}
            onUpdateNote={handleUpdateNote}
            onToggleComplete={handleToggleComplete}
            onToggleCollapse={handleToggleCollapse}
            onEnter={handleEnter}
            onBackspaceEmpty={handleBackspaceEmpty}
            onIndent={handleIndent}
            onOutdent={handleOutdent}
            onDelete={handleDelete}
            onZoomIn={handleZoomIn}
          />
        </DndContext>
      )}
    </div>
  )
}
