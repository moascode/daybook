import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useTasks } from '@/hooks/useTasks'
import { useWallet } from '@/hooks/useWallet'
import { useDayStore } from '@/stores/day.store'
import { useToastStore } from '@/stores/toast.store'
import { cn, errorMessage, formatMYR, todayISO } from '@/lib/utils'
import { dayBand, dayTimeline, shiftDateISO, type TimelineItem } from '@/modules/day/insights'
import type { Task } from '@/types/tasks.types'
import type { Transaction } from '@/types/wallet.types'

function formatDateLabel(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })
}

/**
 * Day — the app's landing page (R6, docs/v2/day/02-design-adoption.md).
 * Merges completed tasks, tasks due today, and today's transactions onto one
 * timeline. "Today" is addressable via `?date=` so the date stepper is
 * bookmarkable without a nested route.
 */
export function DayPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const today = todayISO()
  const rawDate = searchParams.get('date')
  const date = rawDate && /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : today

  const { loadTasks } = useTasks()
  const { loadAccounts, loadTransactions, accounts } = useWallet()
  const { showTasks, showMoney } = useDayStore()
  const addToast = useToastStore((s) => s.addToast)

  const [openTasks, setOpenTasks] = useState<Task[]>([])
  const [completedTasks, setCompletedTasks] = useState<Task[]>([])
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    Promise.all([loadTasks('all'), loadTasks('completed'), loadAccounts(), loadTransactions({})])
      .then(([open, completed, , txns]) => {
        if (cancelled) return
        setOpenTasks(open)
        setCompletedTasks(completed)
        setTransactions(txns)
      })
      .catch((err) => {
        if (cancelled) return
        // A failed load must never render as a confident "0 of 0 / RM0.00"
        // — that's a false figure, not an absence of one (CLAUDE.md rule
        // 13). See TripsPage's identical pattern.
        setLoadFailed(true)
        addToast({ message: errorMessage(err, "Could not load today's data.") })
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [loadTasks, loadAccounts, loadTransactions, addToast])

  const allTasks = useMemo(() => [...openTasks, ...completedTasks], [openTasks, completedTasks])

  const band = useMemo(
    () => dayBand(date, allTasks, transactions, accounts),
    [date, allTasks, transactions, accounts],
  )
  const timeline = useMemo(
    () => dayTimeline(date, allTasks, transactions, accounts),
    [date, allTasks, transactions, accounts],
  )

  const isToday = date === today
  const goTo = (iso: string) => setSearchParams(iso === today ? {} : { date: iso })

  const visibleHappened = useMemo(
    () => timeline.happened.filter((item) => (item.kind === 'task' && showTasks) || (item.kind === 'money' && showMoney)),
    [timeline, showTasks, showMoney],
  )
  const visiblePlanned = useMemo(
    () => timeline.planned.filter((item) => (item.kind === 'task' && showTasks) || (item.kind === 'money' && showMoney)),
    [timeline, showTasks, showMoney],
  )
  const hasAnyItems = timeline.happened.length > 0 || timeline.planned.length > 0
  const hasVisibleItems = visibleHappened.length > 0 || visiblePlanned.length > 0

  return (
    <div className="content">
      <div className="page-head">
        <div>
          <h1 className="page-title">{isToday ? 'Today' : formatDateLabel(date)}</h1>
          <p className="page-sub">{formatDateLabel(date)}</p>
        </div>
        <nav className="datenav" aria-label="Change date" data-testid="day-datenav">
          <button
            type="button"
            aria-label="Previous day"
            onClick={() => goTo(shiftDateISO(date, -1))}
            data-testid="day-prev"
          >
            <ChevronLeft className="icon-sm" aria-hidden="true" />
          </button>
          <button
            type="button"
            className={cn(isToday && 'is-today')}
            aria-label="Today"
            onClick={() => goTo(today)}
            data-testid="day-today"
          >
            Today
          </button>
          <button
            type="button"
            aria-label="Next day"
            onClick={() => goTo(shiftDateISO(date, 1))}
            data-testid="day-next"
          >
            <ChevronRight className="icon-sm" aria-hidden="true" />
          </button>
        </nav>
      </div>

      <div className="card card-pad mb-4" data-testid="day-band">
        {loading ? (
          <p className="text-sm text-fg-subtle">Loading your day…</p>
        ) : loadFailed ? (
          <p className="text-sm text-fg-subtle" data-testid="day-band-error">
            Couldn't load your day — try reloading the page.
          </p>
        ) : (
          <div className="dayfigs">
            <div className="dayfig">
              <span className="k">Tasks done</span>
              <span className="v" data-testid="day-tasks-fig">
                {band.doneCount} <small>of {band.totalCount}</small>
              </span>
            </div>
            <div className="dayfig">
              <span className="k">Today's net</span>
              <span className="v" data-testid="day-net-fig">
                {formatMYR(band.net)}
              </span>
              <span className="s" data-testid="day-net-sub">
                {formatMYR(band.income)} in
              </span>
            </div>
          </div>
        )}
      </div>

      {!loading && !loadFailed && (
        <div className="daytimeline" data-testid="day-timeline">
          {visibleHappened.map((item) => (
            <TimelineRow key={item.id} item={item} />
          ))}
          {isToday && (
            <div className="tl-now" data-testid="day-now-divider">
              <span className="t" />
              <span className="pin" aria-hidden="true" />
              <span className="lbl">Now</span>
            </div>
          )}
          {visiblePlanned.map((item) => (
            <TimelineRow key={item.id} item={item} />
          ))}
          {!hasVisibleItems &&
            (hasAnyItems ? (
              <p className="text-sm text-fg-subtle" data-testid="day-timeline-hidden">
                Everything on this day is hidden — turn a filter back on in the sidebar.
              </p>
            ) : (
              <p className="text-sm text-fg-subtle">Nothing on the timeline for this day yet.</p>
            ))}
        </div>
      )}
    </div>
  )
}

function TimelineRow({ item }: { item: TimelineItem }) {
  const dotClass = item.kind === 'task' ? 'calm' : item.amount?.sign === 'pos' ? 'pos' : 'neg'
  return (
    <div className={cn('tl', item.status === 'ahead' && 'ahead', item.status === 'done' && item.kind === 'task' && 'done')} data-testid="day-timeline-row">
      <span className="tl-time">{item.time ?? ''}</span>
      <span className="tl-mark">
        <span className={cn('tl-dot', dotClass)} aria-hidden="true" />
      </span>
      <div className="tl-body">
        <div className="tl-title">{item.title}</div>
        {item.sub && <div className="tl-sub">{item.sub}</div>}
      </div>
      {item.amount && (
        <span className={cn('tl-amt', item.amount.sign)}>
          {item.amount.sign === 'pos' ? '+' : '−'}
          {formatMYR(item.amount.value)}
        </span>
      )}
    </div>
  )
}
