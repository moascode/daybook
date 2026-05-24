import { create } from 'zustand'

interface AppState {
  theme: 'light' | 'dark' | 'system'
  sidebarOpen: boolean
  claudePanelOpen: boolean
  dbReady: boolean

  setTheme: (theme: 'light' | 'dark' | 'system') => void
  toggleSidebar: () => void
  setClaudePanelOpen: (open: boolean) => void
  setDbReady: (ready: boolean) => void
}

export const useAppStore = create<AppState>((set) => ({
  theme: 'light',
  sidebarOpen: true,
  claudePanelOpen: false,
  dbReady: false,

  setTheme: (theme) => set({ theme }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setClaudePanelOpen: (open) => set({ claudePanelOpen: open }),
  setDbReady: (ready) => set({ dbReady: ready }),
}))
