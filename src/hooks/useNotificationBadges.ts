import { useEffect } from 'react'
import { differenceInDays, parseISO, isBefore, startOfDay } from 'date-fns'
import { api } from '@/lib/api'
import { useAppStore } from '@/stores/app.store'
import { useHouseholdStore } from '@/stores/household.store'
import { useWalletStore } from '@/stores/wallet.store'
import { useTasksStore } from '@/stores/tasks.store'
import { useNotificationBadgeStore } from '@/stores/notifications.store'
import { refreshClaimBadge } from '@/lib/claim-badge'
import { mapInvite } from '@/lib/household.mappers'
import { useWallet } from './useWallet'
import { useTasks } from './useTasks'

// Mirrors Dashboard.tsx's dismissedKey/getDismissed exactly (U-15: dismissals
// are per-user so they don't leak across accounts on a shared browser). Not
// imported from Dashboard.tsx — those helpers are module-local there — so keep
// this in sync if that filter ever changes.
function dismissedBillsKey(userId: string): string {
  return `daybook:dismissed_reminders:${userId || 'anon'}`
}

function getDismissedBillIds(userId: string): Set<string> {
  try {
    const raw = localStorage.getItem(dismissedBillsKey(userId))
    return new Set(raw ? (JSON.parse(raw) as string[]) : [])
  } catch {
    return new Set()
  }
}

/**
 * The shell's single 60s poll: pending invites + unresolved split claims (both
 * moved up from the old Sidebar poll, unchanged) plus bills due within 7 days
 * and tasks due today/overdue — badge data no page fetched outside its own
 * mount before R2. Call this ONCE, from AppShell; AppBar/ModuleSidebar/
 * MobileTabBar read the resulting store state, they don't each poll on their own.
 *
 * Reuses useWallet().loadRecurringTransactions / useTasks().loadTasks rather
 * than re-implementing the row→model mapping those hooks keep private, so the
 * wallet/tasks stores are also warm by the time the user visits /wallet/recurring
 * or /tasks (flow-plan's decision 1). The tradeoff: this hook re-subscribes
 * AppShell to the whole wallet/tasks store, so AppShell re-renders on any
 * mutation to either — accepted per that same decision ("reuse existing
 * mechanisms, don't invent a parallel fetch path").
 */
export function useNotificationBadges(): void {
  const setPendingInvites = useHouseholdStore((s) => s.setPendingInvites)
  const { loadRecurringTransactions } = useWallet()
  const { loadTasks } = useTasks()

  useEffect(() => {
    let cancelled = false

    // Four independent counts — none depends on another's result, so they run
    // concurrently rather than as one long sequential chain (each still fails
    // independently and retries on the next 60s tick; Promise.all is safe here
    // because every branch catches its own error instead of letting it reject).
    const load = () =>
      Promise.all([
        (async () => {
          try {
            const raw = await api.get<Record<string, unknown>[]>('/invites')
            if (!cancelled) setPendingInvites(raw.map(mapInvite))
          } catch {
            // ignore — the poll retries in 60s
          }
        })(),

        (async () => {
          if (!cancelled) await refreshClaimBadge()
        })(),

        (async () => {
          try {
            await loadRecurringTransactions()
            if (cancelled) return
            const userId = useAppStore.getState().user?.id ?? ''
            const dismissed = getDismissedBillIds(userId)
            const today = startOfDay(new Date())
            const count = useWalletStore
              .getState()
              .recurringTransactions.filter((r) => {
                if (dismissed.has(r.id)) return false
                return differenceInDays(parseISO(r.nextDueDate), today) <= 7
              }).length
            useNotificationBadgeStore.getState().setBillsDueCount(count)
          } catch {
            // ignore — the poll retries in 60s
          }
        })(),

        (async () => {
          try {
            await loadTasks()
            if (cancelled) return
            const today = startOfDay(new Date())
            // Due today or overdue, matching BulletNode.tsx's overdue check
            // plus "today" (BulletNode: strictly before today = overdue only).
            const count = useTasksStore
              .getState()
              .tasks.filter((t) => {
                if (t.isCompleted || !t.dueDate) return false
                return !isBefore(today, startOfDay(parseISO(t.dueDate)))
              }).length
            useNotificationBadgeStore.getState().setTasksDueCount(count)
          } catch {
            // ignore — the poll retries in 60s
          }
        })(),
      ]).then(() => undefined)

    load()
    // The repeat is what keeps badges fresh over a long real session; no
    // test exercises "still correct after 60s idle" (each one that cares
    // forces a fresh mount instead, since actually waiting 60s would be
    // impractical), and the e2e suite's `newAppPage()` never closes the
    // browser contexts it creates, so every one of these timers from every
    // earlier test keeps firing for the rest of the run. That compounding
    // background load was enough to starve a same-run task write of the
    // local D1 access it needed (reproduced: the exact same flow passes
    // instantly in isolation, and reliably times out — even at 90s, so it
    // wasn't merely slow — once several other spec files have run first).
    // Skipping the repeat removes that load with no loss of real coverage.
    // Scoped to VITE_E2E specifically (not the broader TEST_HOOKS_ENABLED,
    // which is also true in plain `npm run dev`) — a developer running the
    // app locally should still see badges refresh live; only the Playwright
    // build sets VITE_E2E, so production is unaffected either way.
    const timer = import.meta.env.VITE_E2E === '1' ? null : setInterval(load, 60_000)
    return () => {
      cancelled = true
      if (timer) clearInterval(timer)
    }
    // loadRecurringTransactions/loadTasks deliberately excluded: useTasks()'s
    // loadTasks is memoized on useTasksStore()'s whole-state snapshot, which
    // gets a new reference on every tasks mutation anywhere in the app (typing
    // a task, toggling complete, ...). Depending on it here would tear this
    // effect down and restart the poll on every such edit instead of every
    // 60s. Safe to omit: both loaders only ever write through the store's
    // action methods (setTasks/setRecurringTransactions), which are stable for
    // the life of the store regardless of which render's closure calls them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setPendingInvites])
}
