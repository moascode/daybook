import { create } from 'zustand'

export interface AuthUser {
  id: string
  username: string
}

interface AppState {
  theme: 'light' | 'dark' | 'system'
  sidebarOpen: boolean
  claudePanelOpen: boolean
  dbReady: boolean
  user: AuthUser | null

  setTheme: (theme: 'light' | 'dark' | 'system') => void
  toggleSidebar: () => void
  setClaudePanelOpen: (open: boolean) => void
  setDbReady: (ready: boolean) => void
  setUser: (user: AuthUser | null) => void
}

export const useAppStore = create<AppState>((set) => ({
  theme: 'light',
  sidebarOpen: true,
  claudePanelOpen: false,
  dbReady: false,
  user: null,

  setTheme: (theme) => set({ theme }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setClaudePanelOpen: (open) => set({ claudePanelOpen: open }),
  setDbReady: (ready) => set({ dbReady: ready }),
  setUser: (user) => set({ user }),
}))
