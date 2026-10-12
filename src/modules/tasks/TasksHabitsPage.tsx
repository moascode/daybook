import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { errorMessage } from '@/lib/utils'
import { useHabits } from '@/hooks/useHabits'
import { useToastStore } from '@/stores/toast.store'
import type { Habit, JointHabitStats } from '@/types/habits.types'
import { ConsistencyCard } from './habits/ConsistencyCard'
import { HabitCard } from './habits/HabitCard'
import { HabitFormModal, type HabitFormValues } from './habits/HabitFormModal'
import { WeekdayCard } from './habits/WeekdayCard'
import { WorthKnowingCard } from './habits/WorthKnowingCard'
import { ArchivedHabitsSection } from './habits/ArchivedHabitsSection'
import { HabitEmptyState } from './habits/HabitEmptyState'
import { RING_COLORS, pooledWeekdayStats } from './habits/habitMath'

/**
 * Habits — `/tasks/habits` (FEAT-029, docs/backlog/EP-07-tasks-depth/FEAT-029-tasks-habits.md;
 * visual language brought to design parity by FEAT-061,
 * docs/backlog/EP-07-tasks-depth/FEAT-061-tasks-habits-design-adoption.md;
 * production-hardening pass adding edit, archive/restore, a race-safe
 * toggle and ConfirmDeleteModal-backed delete — see e2e/111-tasks-habits-parity.spec.ts).
 * A habit is a repeated commitment tracked by day, not a due-dated task
 * instance — rings/streaks/dots/weekday chart all come pre-computed from
 * `GET /habits` (worker/routes/habits.ts's computeStats) except the pooled
 * "Kept by weekday" card, which is deliberately derived client-side from the
 * already-loaded per-habit `entries` (see FEAT-061's "does NOT build" note —
 * no new fetch). The joint "all habits kept" streak, by contrast, IS a
 * server-side aggregate (`GET /habits/joint-stats`, review fix #6) — the
 * client only has 28 days of `entries` per habit, not enough to agree with
 * each habit's own 84-day `currentStreak`.
 *
 * This file is the orchestrator only — every card lives in `./habits/*`.
 */
export function TasksHabitsPage() {
  const { habits, loadHabits, loadJointStats, createHabit, updateHabit, deleteHabit, toggleHabitEntry, pendingToggles } =
    useHabits()
  const addToast = useToastStore((s) => s.addToast)
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingHabit, setEditingHabit] = useState<Habit | null>(null)
  const [jointStats, setJointStats] = useState<JointHabitStats>({ currentStreak: 0, bestRun: null })
  const [archivedLoaded, setArchivedLoaded] = useState(false)
  const [archivedLoading, setArchivedLoading] = useState(false)

  // TasksTodayPage.tsx's composer "Habit" action navigates here with
  // `{ openCreateHabit: true }` so the create-habit modal opens immediately
  // instead of just changing the route — same one-shot nav-state +
  // `location.key` guard TasksTodayPage.tsx already uses for its own
  // `openTaskForm` flag (quick add).
  const location = useLocation()
  const navigate = useNavigate()
  const shouldOpenCreate = (location.state as { openCreateHabit?: boolean } | null)?.openCreateHabit
  const [handledOpenKey, setHandledOpenKey] = useState<string | null>(null)
  if (shouldOpenCreate && location.key !== handledOpenKey) {
    setHandledOpenKey(location.key)
  }
  useEffect(() => {
    if (shouldOpenCreate && handledOpenKey === location.key) {
      // One-shot transition from nav state (TasksTodayPage.tsx's composer
      // "Habit" action), same story as WalletPage.tsx's ?account= deep link.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setEditingHabit(null)
      setShowForm(true)
      navigate(location.pathname, { replace: true, state: null })
    }
  }, [shouldOpenCreate, handledOpenKey, location, navigate])

  // The joint streak is refetched any time a habit's entries (or set of
  // active habits) could have changed, since it's a cross-habit aggregate
  // no single habit mutation response carries.
  const refreshJointStats = async () => {
    try {
      setJointStats(await loadJointStats())
    } catch (err) {
      addToast({ message: errorMessage(err, "Could not refresh habits' joint streak.") })
    }
  }

  useEffect(() => {
    let cancelled = false
    Promise.all([
      loadHabits().catch((err) => {
        if (!cancelled) addToast({ message: errorMessage(err, 'Could not load your habits.') })
      }),
      loadJointStats()
        .then((stats) => {
          if (!cancelled) setJointStats(stats)
        })
        .catch((err) => {
          if (!cancelled) addToast({ message: errorMessage(err, "Could not load habits' joint streak.") })
        }),
    ]).finally(() => {
      if (!cancelled) setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [loadHabits, loadJointStats, addToast])

  const openNewHabit = () => {
    setEditingHabit(null)
    setShowForm(true)
  }

  const handleFormSubmit = async (values: HabitFormValues) => {
    if (editingHabit) {
      await updateHabit(editingHabit.id, {
        name: values.name,
        color: values.color,
        targetPerWeek: values.targetPerWeek,
        schedule: values.schedule,
      })
    } else {
      await createHabit(values)
    }
    void refreshJointStats()
  }

  // Lazily fetches the full (archived-included) list the first time the
  // "Archived" section is opened — the default `loadHabits()` call on mount
  // deliberately excludes archived habits, so this is the one place that
  // asks for them.
  const expandArchived = () => {
    if (archivedLoaded) return
    setArchivedLoading(true)
    loadHabits(true)
      .catch((err) => addToast({ message: errorMessage(err, 'Could not load archived habits.') }))
      .finally(() => {
        setArchivedLoaded(true)
        setArchivedLoading(false)
      })
  }

  const handleRestore = (habit: Habit) => {
    void updateHabit(habit.id, { archived: false })
      .then(() => refreshJointStats())
      .catch(() => {
        // updateHabit already toasted the failure.
      })
  }

  const handleLowerTarget = async (habit: Habit) => {
    await updateHabit(habit.id, { targetPerWeek: Math.max(1, habit.targetPerWeek - 1) })
  }

  const active = habits.filter((h) => !h.archived)
  const archived = habits.filter((h) => h.archived)
  // Anchored to the server's own "today" (the last entry of the 28-day
  // window every habit was computed against) rather than a client Date —
  // keeps every per-habit calculation below in agreement with computeStats.
  const today = active[0]?.stats.entries.at(-1)?.date ?? ''
  const pooledWeekday = pooledWeekdayStats(active)

  return (
    <div className="content">
      <div className="page-head">
        <div>
          <h1 className="page-title">Habits</h1>
          <span className="page-sub hide-mobile">
            {active.length} active{jointStats.currentStreak > 0 ? ` · ${jointStats.currentStreak}-day streak` : ''}
          </span>
        </div>
        <div className="page-actions">
          <button type="button" className="btn btn-primary" onClick={openNewHabit} data-testid="habit-new-btn">
            <Plus className="h-4 w-4" />
            New habit
          </button>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-fg-subtle">Loading your habits…</p>
      ) : (
        <div className="dash">
          {active.length === 0 ? (
            <HabitEmptyState onNewHabit={openNewHabit} />
          ) : (
            <>
              <ConsistencyCard habits={active} today={today} jointStats={jointStats} pooledWeekday={pooledWeekday} />

              {active.map((habit, i) => (
                <HabitCard
                  key={habit.id}
                  habit={habit}
                  today={today}
                  ringColor={habit.color || RING_COLORS[i % RING_COLORS.length]}
                  pendingToggles={pendingToggles}
                  onToggleDay={(date) => {
                    void toggleHabitEntry(habit.id, date).then(() => refreshJointStats())
                  }}
                  onEdit={() => {
                    setEditingHabit(habit)
                    setShowForm(true)
                  }}
                  onArchive={() => {
                    void updateHabit(habit.id, { archived: true })
                      .then(() => refreshJointStats())
                      .catch(() => {
                        // updateHabit already toasted the failure.
                      })
                  }}
                  onDelete={() => {
                    void deleteHabit(habit.id)
                      .then(() => refreshJointStats())
                      .catch(() => {
                        // deleteHabit already toasted the failure.
                      })
                  }}
                />
              ))}

              <WeekdayCard pooled={pooledWeekday} />
              <WorthKnowingCard habits={active} onLowerTarget={handleLowerTarget} />
            </>
          )}

          <ArchivedHabitsSection
            archived={archived}
            loading={archivedLoading}
            loaded={archivedLoaded}
            onExpand={expandArchived}
            onRestore={handleRestore}
          />
        </div>
      )}

      <HabitFormModal
        open={showForm}
        habit={editingHabit}
        onOpenChange={(open) => {
          setShowForm(open)
          if (!open) setEditingHabit(null)
        }}
        onSubmit={handleFormSubmit}
      />
    </div>
  )
}
