import { create } from 'zustand'

/**
 * "Show on the timeline" toggles for the Day module (R6,
 * docs/v2/day/02-design-adoption.md §Sidebar). Lives here rather than as
 * DayPage-local state because ModuleSidebar renders the checkboxes and
 * DayPage renders the filtered timeline, and the two are siblings under
 * AppShell, not parent/child. Page-session UI state only — no server
 * persistence, same as every other Zustand store's ephemeral-UI slice.
 *
 * Only Tasks and Money are live toggles — R6 ships no "scheduled" or "notes"
 * row kind in the merge, so those two stay sidebar-disabled (with a stated
 * reason) rather than exist here as state with nothing to control.
 */
interface DayState {
  showTasks: boolean
  showMoney: boolean
  toggle: (key: 'showTasks' | 'showMoney') => void
}

export const useDayStore = create<DayState>((set) => ({
  showTasks: true,
  showMoney: true,
  toggle: (key) => set((s) => ({ [key]: !s[key] })),
}))
