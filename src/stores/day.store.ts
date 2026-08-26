import { create } from 'zustand'

/**
 * "Show on the timeline" toggles for the Day module (R6,
 * docs/v2/day/02-design-adoption.md §Sidebar). Lives here rather than as
 * DayPage-local state because ModuleSidebar renders the checkboxes and
 * DayPage renders the filtered timeline, and the two are siblings under
 * AppShell, not parent/child. Page-session UI state only — no server
 * persistence, same as every other Zustand store's ephemeral-UI slice.
 *
 * Notes has no toggle here — it stays sidebar-disabled until R15, so there is
 * nothing yet to show or hide.
 */
interface DayState {
  showTasks: boolean
  showMoney: boolean
  showScheduled: boolean
  toggle: (key: 'showTasks' | 'showMoney' | 'showScheduled') => void
}

export const useDayStore = create<DayState>((set) => ({
  showTasks: true,
  showMoney: true,
  showScheduled: true,
  toggle: (key) => set((s) => ({ [key]: !s[key] })),
}))
