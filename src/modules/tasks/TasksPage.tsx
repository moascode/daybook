import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
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
import { Plus, Eye, EyeOff, ChevronRight, Home, Search, X, CheckSquare, CalendarClock, BookCopy } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { useTasks } from '@/hooks/useTasks'
import { useTasksStore } from '@/stores/tasks.store'
import { useToastStore } from '@/stores/toast.store'
import { BulletTree } from './BulletTree'
import { cn } from '@/lib/utils'
import type { Task } from '@/types/tasks.types'

declare global {
  interface Window {
    // DEV/E2E-only hooks so Playwright can drive task operations directly.
    __testIndentTask?: (id: string) => void
    __testOutdentTask?: (id: string) => void
    __testGetTasks?: () => Task[]
    __testToggleCollapse?: (id: string) => void
    __testUpdateTask?: (
      id: string,
      updates: Partial<Pick<Task, 'content' | 'note' | 'isCompleted' | 'isCollapsed' | 'parentId' | 'sortOrder' | 'dueDate'>>,
    ) => void
  }
}

// ── Search helpers ──────────────────────────────────

function getTaskPath(task: Task, allTasks: Task[]): string {
  const parts: string[] = []
  let parentId = task.parentId

  while (parentId) {
    const parent = allTasks.find((t) => t.id === parentId)
    if (!parent) break
    parts.unshift(parent.content || 'Untitled')
    parentId = parent.parentId
  }

  return parts.length > 0 ? parts.join(' › ') : 'Home'
}

function highlight(text: string, query: string): React.ReactNode {
  if (!query || !text) return text || ''
  const lower = text.toLowerCase()
  const q = query.toLowerCase()
  const idx = lower.indexOf(q)
  if (idx === -1) return text

  return (
    <>
      {text.slice(0, idx)}
      <mark className="rounded-[2px] bg-yellow-100 text-yellow-900 not-italic">
        {text.slice(idx, idx + query.length)}
      </mark>
      {text.slice(idx + query.length)}
    </>
  )
}

// ── Component ─────────────────────────────────────

interface TaskTemplate {
  id: string
  name: string
  content: string
  createdAt: string
}

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
    restoreDeleted,
    moveTask,
    indentTask,
    outdentTask,
    getBreadcrumb,
    loadTemplates,
    saveTemplate,
    deleteTemplate,
    applyTemplate,
  } = useTasks()

  const { addToast, removeToast } = useToastStore()

  const [loaded, setLoaded] = useState(false)
  const [focusId, setFocusId] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [sortByDue, setSortByDue] = useState(false)

  // Template state
  const [saveTemplateDialogOpen, setSaveTemplateDialogOpen] = useState(false)
  const [pendingTemplateName, setPendingTemplateName] = useState('')
  const [templateTaskToSave, setTemplateTaskToSave] = useState<Task | null>(null)
  const [templatesDialogOpen, setTemplatesDialogOpen] = useState(false)
  const [templates, setTemplates] = useState<TaskTemplate[]>([])
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null)

  const focusTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const undoToastIdRef = useRef<string | null>(null)

  // ── Search results ────────────────────────────────
  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return []
    return tasks
      .filter(
        (t) =>
          t.content.toLowerCase().includes(q) ||
          t.note.toLowerCase().includes(q),
      )
      .slice(0, 50)
  }, [tasks, searchQuery])

  // ── Undo toast helper ─────────────────────────────
  const showDeleteToast = useCallback(() => {
    if (undoToastIdRef.current) removeToast(undoToastIdRef.current)
    undoToastIdRef.current = addToast({
      message: 'Task deleted',
      action: {
        label: 'Undo',
        onClick: () => {
          restoreDeleted()
          undoToastIdRef.current = null
        },
      },
      duration: 5000,
    })
  }, [addToast, removeToast, restoreDeleted])

  // ── Keyboard shortcuts (global) ───────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault()
        searchInputRef.current?.focus()
        searchInputRef.current?.select()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  // ── Task action callbacks ──────────────────────────────────────────
  const handleUpdate = useCallback(
    (id: string, content: string) => updateTask(id, { content }),
    [updateTask],
  )

  const handleUpdateNote = useCallback(
    (id: string, note: string) => updateTask(id, { note }),
    [updateTask],
  )

  const handleToggleComplete = useCallback(
    (id: string) => {
      const task = useTasksStore.getState().tasks.find((t) => t.id === id)
      if (task) updateTask(id, { isCompleted: !task.isCompleted })
    },
    [updateTask],
  )

  const handleToggleCollapse = useCallback(
    (id: string) => {
      const task = useTasksStore.getState().tasks.find((t) => t.id === id)
      if (task) updateTask(id, { isCollapsed: !task.isCollapsed })
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
      showDeleteToast()

      if (prevSibling) {
        setFocusId(prevSibling.id)
      } else if (task.parentId) {
        setFocusId(task.parentId)
      }
    },
    [deleteTask, showDeleteToast],
  )

  const handleIndent = useCallback(async (id: string) => { await indentTask(id) }, [indentTask])
  const handleOutdent = useCallback(async (id: string) => { await outdentTask(id) }, [outdentTask])

  const handleDelete = useCallback(
    async (id: string) => {
      await deleteTask(id)
      showDeleteToast()
    },
    [deleteTask, showDeleteToast],
  )

  const handleZoomIn = useCallback((id: string) => { setRootId(id) }, [setRootId])

  const handleSetDueDate = useCallback(
    (id: string, date: string | null) => updateTask(id, { dueDate: date }),
    [updateTask],
  )

  const handleAddRootTask = useCallback(async () => {
    const newTask = await addTask('', rootId)
    setFocusId(newTask.id)
  }, [addTask, rootId])

  const handleSaveAsTemplate = useCallback((task: Task) => {
    setTemplateTaskToSave(task)
    setPendingTemplateName(task.content || '')
    setSaveTemplateDialogOpen(true)
  }, [])

  const handleConfirmSaveTemplate = useCallback(async () => {
    if (!pendingTemplateName.trim() || !templateTaskToSave) return
    await saveTemplate(pendingTemplateName.trim(), templateTaskToSave.content)
    setSaveTemplateDialogOpen(false)
    setTemplateTaskToSave(null)
    setPendingTemplateName('')
    addToast({ message: 'Template saved', duration: 3000 })
  }, [pendingTemplateName, templateTaskToSave, saveTemplate, addToast])

  const handleOpenTemplates = useCallback(async () => {
    const loaded = await loadTemplates()
    setTemplates(loaded)
    setSelectedTemplateId(null)
    setTemplatesDialogOpen(true)
  }, [loadTemplates])

  const handleApplyTemplate = useCallback(async () => {
    const tpl = templates.find((t) => t.id === selectedTemplateId)
    if (!tpl) return
    const newTask = await applyTemplate(tpl, rootId)
    setFocusId(newTask.id)
    setTemplatesDialogOpen(false)
  }, [templates, selectedTemplateId, applyTemplate, rootId])

  const handleDeleteTemplate = useCallback(async (id: string) => {
    await deleteTemplate(id)
    setTemplates((prev) => prev.filter((t) => t.id !== id))
    if (selectedTemplateId === id) setSelectedTemplateId(null)
  }, [deleteTemplate, selectedTemplateId])

  const handleToggleHideCompleted = useCallback(
    () => setHideCompleted(!hideCompleted),
    [hideCompleted, setHideCompleted],
  )

  // Load tasks on mount
  useEffect(() => {
    loadTasks().then(() => setLoaded(true))
  }, [loadTasks])

  // Expose task operations for E2E testing
  useEffect(() => {
    if (import.meta.env.DEV) {
      window.__testIndentTask = (id: string) => indentTask(id)
      window.__testOutdentTask = (id: string) => outdentTask(id)
      window.__testGetTasks = () => useTasksStore.getState().tasks
      window.__testToggleCollapse = (id: string) => handleToggleCollapse(id)
      window.__testUpdateTask = (id, updates) => updateTask(id, updates)
      return () => {
        delete window.__testIndentTask
        delete window.__testOutdentTask
        delete window.__testGetTasks
        delete window.__testToggleCollapse
        delete window.__testUpdateTask
      }
    }
  }, [indentTask, outdentTask, handleToggleCollapse, updateTask])

  useEffect(() => {
    if (focusId) {
      focusTimeoutRef.current = setTimeout(() => setFocusId(null), 100)
    }
    return () => {
      if (focusTimeoutRef.current) clearTimeout(focusTimeoutRef.current)
    }
  }, [focusId])

  // ── DnD sensors ──────────────────────────────────────────
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

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

      const parentId = overTask.parentId
      const siblings = allTasks
        .filter((t) => t.parentId === parentId)
        .sort((a, b) => a.sortOrder - b.sortOrder)

      const overIndex = siblings.findIndex((t) => t.id === overId)

      let newSortOrder: number
      if (overIndex === 0) {
        newSortOrder = siblings[0].sortOrder / 2
      } else if (overIndex === siblings.length - 1) {
        newSortOrder = siblings[siblings.length - 1].sortOrder + 1.0
      } else {
        const activeIndex = siblings.findIndex((t) => t.id === activeId)
        if (activeIndex < overIndex) {
          const next = siblings[overIndex + 1]
          newSortOrder = next
            ? (overTask.sortOrder + next.sortOrder) / 2
            : overTask.sortOrder + 1.0
        } else {
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

  // ── Render ──────────────────────────────────────────
  const breadcrumb = getBreadcrumb(rootId)

  if (!loaded) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
      </div>
    )
  }

  const currentLevelTasks = tasks.filter((t) => t.parentId === rootId)
  const isEmpty = currentLevelTasks.length === 0
  const isSearching = searchQuery.trim().length > 0

  return (
    <div className="mx-auto max-w-2xl">
      {/* ── Toolbar ─────────────────────────────────────────── */}
      <div className="mb-3 flex items-center justify-between gap-3">
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
            onClick={() => setSortByDue((v) => !v)}
            title={sortByDue ? 'Revert to default order' : 'Sort by due date'}
            className={cn(
              'flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors',
              sortByDue
                ? 'bg-blue-50 text-blue-600 hover:bg-blue-100'
                : 'text-gray-500 hover:bg-gray-100 hover:text-gray-800',
            )}
          >
            <CalendarClock className="h-3.5 w-3.5" />
            Sort by due date
          </button>

          <button
            onClick={handleToggleHideCompleted}
            title={hideCompleted ? 'Show completed tasks' : 'Hide completed tasks'}
            className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-800"
          >
            {hideCompleted ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
            {hideCompleted ? 'Show done' : 'Hide done'}
          </button>

          <button
            onClick={handleOpenTemplates}
            title="Apply a saved task template"
            className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-800"
          >
            <BookCopy className="h-3.5 w-3.5" />
            Templates
          </button>

          <Button size="sm" onClick={handleAddRootTask}>
            <Plus className="h-3.5 w-3.5" />
            New task
          </Button>
        </div>
      </div>

      {/* ── Search bar ──────────────────────────────────────── */}
      <div className="relative mb-4">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
        <input
          ref={searchInputRef}
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setSearchQuery('')
              searchInputRef.current?.blur()
            }
          }}
          placeholder="Search tasks… (⌘F)"
          className={cn(
            'w-full rounded-lg border bg-white py-2 pl-9 pr-8 text-sm text-gray-800 placeholder-gray-400 outline-none transition-all',
            isSearching
              ? 'border-brand-400 ring-2 ring-brand-500/20'
              : 'border-gray-200 hover:border-gray-300 focus:border-brand-400 focus:ring-2 focus:ring-brand-500/20',
          )}
        />
        {isSearching && (
          <button
            onClick={() => { setSearchQuery(''); searchInputRef.current?.focus() }}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-gray-400 hover:text-gray-700"
            aria-label="Clear search"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* ── Search results ──────────────────────────────────── */}
      {isSearching ? (
        <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
          {searchResults.length === 0 ? (
            <div className="py-12 text-center text-sm text-gray-400">
              No tasks found matching &ldquo;{searchQuery}&rdquo;
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {searchResults.map((task) => (
                <button
                  key={task.id}
                  className="w-full px-4 py-3 text-left transition-colors hover:bg-gray-50 focus:bg-gray-50 focus:outline-none"
                  onClick={() => {
                    setRootId(task.parentId)
                    setFocusId(task.id)
                    setSearchQuery('')
                  }}
                >
                  <p className="mb-0.5 text-xs text-gray-400">
                    {getTaskPath(task, tasks)}
                  </p>
                  <p
                    className={cn(
                      'text-sm text-gray-800',
                      task.isCompleted && 'line-through opacity-50',
                    )}
                  >
                    {highlight(task.content || 'Untitled', searchQuery.trim())}
                  </p>
                  {task.note &&
                    task.note.toLowerCase().includes(searchQuery.trim().toLowerCase()) && (
                      <p className="mt-0.5 text-xs text-gray-400 line-clamp-1">
                        {highlight(task.note, searchQuery.trim())}
                      </p>
                    )}
                </button>
              ))}
              <div className="px-4 py-2 text-xs text-gray-400">
                {searchResults.length === 50
                  ? '50+ results — refine your search'
                  : `${searchResults.length} result${searchResults.length !== 1 ? 's' : ''}`}
              </div>
            </div>
          )}
        </div>
      ) : (
        /* ── Tree ───────────────────────────────────────────── */
        isEmpty ? (
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
              sortByDue={sortByDue}
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
              onSetDueDate={handleSetDueDate}
              onSaveAsTemplate={handleSaveAsTemplate}
            />
          </DndContext>
        )
      )}
      {/* Save as template dialog */}
      <Modal
        open={saveTemplateDialogOpen}
        onOpenChange={(open) => { if (!open) { setSaveTemplateDialogOpen(false); setTemplateTaskToSave(null) } }}
        title="Save as template"
        className="max-w-sm"
      >
        <div className="flex flex-col gap-4">
          <Input
            label="Template name"
            placeholder="e.g. Weekly Review"
            value={pendingTemplateName}
            onChange={(e) => setPendingTemplateName(e.target.value)}
            autoFocus
          />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setSaveTemplateDialogOpen(false)}>Cancel</Button>
            <Button size="sm" onClick={handleConfirmSaveTemplate}>Save</Button>
          </div>
        </div>
      </Modal>

      {/* Templates browser dialog */}
      <Modal
        open={templatesDialogOpen}
        onOpenChange={(open) => { if (!open) setTemplatesDialogOpen(false) }}
        title="Templates"
        className="max-w-sm"
      >
        <div className="flex flex-col gap-3">
          {templates.length === 0 ? (
            <p className="py-6 text-center text-sm text-gray-400">
              No templates yet. Save your first template from the task menu.
            </p>
          ) : (
            <div className="flex flex-col gap-1 max-h-64 overflow-y-auto">
              {templates.map((tpl) => (
                <div
                  key={tpl.id}
                  className={cn(
                    'flex items-center justify-between rounded-lg px-3 py-2 cursor-pointer transition-colors',
                    selectedTemplateId === tpl.id ? 'bg-brand-50 text-brand-700' : 'hover:bg-gray-50',
                  )}
                  onClick={() => setSelectedTemplateId(tpl.id)}
                >
                  <span className="text-sm font-medium truncate">{tpl.name}</span>
                  <button
                    className="ml-2 shrink-0 rounded px-1.5 py-0.5 text-xs text-gray-400 hover:bg-red-50 hover:text-red-600"
                    onClick={(e) => { e.stopPropagation(); handleDeleteTemplate(tpl.id) }}
                    aria-label={`Delete ${tpl.name}`}
                  >
                    Delete
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" size="sm" onClick={() => setTemplatesDialogOpen(false)}>Cancel</Button>
            <Button size="sm" disabled={!selectedTemplateId} onClick={handleApplyTemplate}>Apply</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
