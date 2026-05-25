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

  // Load tasks on mount
  useEffect(() => {
    loadTasks().then(() => setLoaded(true))
  }, [loadTasks])

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

      // Find the previous sibling to focus on
      const siblings = allTasks
        .filter((t) => t.parentId === task.parentId)
        .sort((a, b) => a.sortOrder - b.sortOrder)

      const currentIndex = siblings.findIndex((t) => t.id === id)
      const prevSibling = siblings[currentIndex - 1]

      await deleteTask(id)

      if (prevSibling) {
        setFocusId(prevSibling.id)
      } else if (task.parentId) {
        // Focus on parent if no previous sibling
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
    <div className="mx-auto max-w-3xl">
      {/* Toolbar */}
      <div className="mb-4 flex items-center justify-between gap-4">
        {/* Breadcrumb navigation */}
        <div className="flex items-center gap-1 text-sm min-w-0">
          <button
            onClick={() => setRootId(null)}
            className={`flex-shrink-0 rounded px-1.5 py-0.5 transition-colors ${
              rootId === null
                ? 'text-gray-900 font-medium'
                : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
            }`}
          >
            <Home className="h-4 w-4" />
          </button>

          {breadcrumb.map((task) => (
            <span key={task.id} className="flex items-center gap-1 min-w-0">
              <ChevronRight className="h-3 w-3 flex-shrink-0 text-gray-400" />
              <button
                onClick={() => setRootId(task.id)}
                className="truncate rounded px-1.5 py-0.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition-colors max-w-[150px]"
                title={task.content}
              >
                {task.content || 'Untitled'}
              </button>
            </span>
          ))}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleToggleHideCompleted}
            title={hideCompleted ? 'Show completed tasks' : 'Hide completed tasks'}
          >
            {hideCompleted ? (
              <Eye className="h-4 w-4" />
            ) : (
              <EyeOff className="h-4 w-4" />
            )}
            {hideCompleted ? 'Show done' : 'Hide done'}
          </Button>

          <Button
            variant="secondary"
            size="sm"
            onClick={handleAddRootTask}
          >
            <Plus className="h-4 w-4" />
            Add task
          </Button>
        </div>
      </div>

      {/* Task tree or empty state */}
      {isEmpty ? (
        <EmptyState
          icon={<CheckSquare className="h-12 w-12" />}
          title="No tasks yet"
          description="Create your first task to get started."
          action={
            <Button size="sm" onClick={handleAddRootTask}>
              <Plus className="h-4 w-4" />
              Add task
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
