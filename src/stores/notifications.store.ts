import { create } from 'zustand'

/**
 * The two counts the old Sidebar poll never computed: bills due soon and tasks
 * due/overdue. Small and separate from `household.store` (which already owns
 * `pendingInvites`/`pendingClaimCount`) rather than widening that store's
 * shape for two unrelated numbers. Written by `useNotificationBadges`
 * (src/hooks), read by AppBar/ModuleSidebar/MobileTabBar.
 */
interface NotificationBadgeState {
  billsDueCount: number
  tasksDueCount: number
  setBillsDueCount: (n: number) => void
  setTasksDueCount: (n: number) => void
}

export const useNotificationBadgeStore = create<NotificationBadgeState>((set) => ({
  billsDueCount: 0,
  tasksDueCount: 0,
  setBillsDueCount: (n) => set({ billsDueCount: n }),
  setTasksDueCount: (n) => set({ tasksDueCount: n }),
}))
