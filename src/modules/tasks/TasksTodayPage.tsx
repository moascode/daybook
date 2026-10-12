import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { TaskComposer } from '@/modules/tasks/composer/TaskComposer'
import { TaskFormModal } from '@/modules/tasks/composer/TaskFormModal'
import { TaskDetailModal } from '@/modules/tasks/TaskDetailModal'
import { TodayHead } from '@/modules/tasks/today/TodayHead'
import { TodayBand } from '@/modules/tasks/today/TodayBand'
import { TodayTaskGroups } from '@/modules/tasks/today/TodayTaskGroups'
import { TodayRail } from '@/modules/tasks/today/TodayRail'
import { useTodayTasks } from '@/modules/tasks/today/useTodayTasks'
import type { Task } from '@/types/tasks.types'

/**
 * Today — the Tasks module's landing page (R5 PR-1,
 * docs/archive/design-adoption/tasks-design-adoption.md §Today). Band (done-today progress +
 * overdue/assigned/finished-this-week + a 7-day load strip), the full
 * Wallet-syntax composer (FEAT-054), the Overdue/Today/Done-today grouped
 * list, and an "Up next" + "Lists" + "Worth knowing" right rail. Pure
 * layout/composition — data loading and derived stats live in
 * today/useTodayTasks.ts, and each card is its own file under today/.
 */
export function TasksTodayPage() {
  const data = useTodayTasks()
  const composerInputRef = useRef<HTMLInputElement>(null)
  const [detailTask, setDetailTask] = useState<Task | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  // FEAT-054 follow-up: one shared "New task" modal for both the composer's
  // "Task" (blank) and "Assign" (assignee field focused) shortcuts — see
  // TaskFormModal.tsx.
  const [taskFormOpen, setTaskFormOpen] = useState(false)
  const [taskFormContent, setTaskFormContent] = useState<string | undefined>(undefined)
  const [taskFormFocusField, setTaskFormFocusField] = useState<'assignee' | undefined>(undefined)

  // The global quick-add's "Task" action navigates here with
  // `{ openTaskForm: true }` and the "New task" modal opens — the same thing
  // its Expense/Income/Transfer siblings do for Wallet. (BUG-005 first fixed
  // the bare route change by focusing the composer; a focused input still
  // read as "nothing happened".) Same one-shot nav-state + `location.key`
  // guard WalletPage.tsx uses for its own quick-add flag — a navigation to
  // the route we're already on updates `location` without remounting, so a
  // lazy `useState` initializer would miss it.
  const location = useLocation()
  const navigate = useNavigate()
  const shouldOpenTaskForm = (location.state as { openTaskForm?: boolean } | null)?.openTaskForm
  const [handledOpenKey, setHandledOpenKey] = useState<string | null>(null)
  if (shouldOpenTaskForm && location.key !== handledOpenKey) {
    setHandledOpenKey(location.key)
    setTaskFormContent(undefined)
    setTaskFormFocusField(undefined)
    setTaskFormOpen(true)
  }
  useEffect(() => {
    if (shouldOpenTaskForm && handledOpenKey === location.key) {
      navigate(location.pathname, { replace: true, state: null })
    }
  }, [shouldOpenTaskForm, handledOpenKey, location, navigate])

  const openDetail = (task: Task) => {
    setDetailTask(task)
    setDetailOpen(true)
  }

  const handleOpenHabitModal = () => {
    navigate('/tasks/habits', { state: { openCreateHabit: true } })
  }

  const handleOpenTaskForm = (initialContent?: string) => {
    setTaskFormContent(initialContent)
    setTaskFormFocusField(undefined)
    setTaskFormOpen(true)
  }

  const handleOpenAssignForm = (initialContent?: string) => {
    setTaskFormContent(initialContent)
    setTaskFormFocusField('assignee')
    setTaskFormOpen(true)
  }

  return (
    <div className="content">
      <TodayHead
        todayLabel={data.todayLabel}
        audience={data.audience}
        onAudienceChange={data.setAudience}
        onPlanWeek={() => navigate('/tasks/upcoming')}
      />

      <TaskComposer
        ref={composerInputRef}
        lists={data.taskLists}
        coMembers={data.coMembers}
        onCreateTask={data.handleCreateTask}
        onOpenHabitModal={handleOpenHabitModal}
        onOpenTaskForm={handleOpenTaskForm}
        onOpenAssignForm={handleOpenAssignForm}
      />

      {data.loading ? (
        <p className="text-sm text-fg-subtle">Loading your tasks…</p>
      ) : (
        <div className="dash">
          <TodayBand
            todayLabel={data.todayLabel}
            todayDueCount={data.todayTasks.length}
            overdueCount={data.overdueTasks.length}
            lateOfDueTodayCount={data.lateOfDueTodayCount}
            isHeaviestDay={data.isHeaviestDay}
            doneCount={data.doneCount}
            totalToday={data.totalToday}
            donePct={data.donePct}
            oldestOverdueDays={data.oldestOverdueDays}
            assignedCount={data.assignedCount}
            finishedThisWeekCount={data.finishedThisWeekCount}
            loadStrip={data.loadStrip}
            maxLoad={data.maxLoad}
          />

          <TodayTaskGroups
            overdueTasks={data.overdueTasks}
            todayTasks={data.todayTasks}
            doneTodayTasks={data.doneTodayTasks}
            doneCollapsed={data.doneCollapsed}
            onToggleDoneCollapsed={() => data.setDoneCollapsed((v) => !v)}
            listById={data.listById}
            coMembers={data.coMembers}
            rescheduleLabel={data.rescheduleLabel}
            onRescheduleAll={data.handleRescheduleAll}
            onToggleComplete={data.handleToggleComplete}
            onOpenDetail={openDetail}
            onContentChange={data.handleContentChange}
            onDueDateChange={data.handleDueDateChange}
            onDelete={data.handleDeleteTask}
          />

          <TodayRail
            upNext={data.upNext}
            taskLists={data.taskLists}
            openTasks={data.openTasks}
            completedTasks={data.completedTasks}
            listById={data.listById}
            worthKnowing={data.worthKnowing}
            onNavigate={navigate}
          />
        </div>
      )}

      <TaskDetailModal
        task={detailTask}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        availableLists={data.taskLists}
        coMembers={data.coMembers}
        onSaved={data.handleSaved}
        onDeleted={data.handleDeletedFromModal}
      />

      <TaskFormModal
        open={taskFormOpen}
        onClose={() => setTaskFormOpen(false)}
        lists={data.taskLists}
        coMembers={data.coMembers}
        initialContent={taskFormContent}
        focusField={taskFormFocusField}
        onSubmit={data.handleTaskFormSubmit}
      />
    </div>
  )
}
