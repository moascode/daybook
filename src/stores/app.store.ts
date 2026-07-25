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
  // U-16: which first-run WelcomeCards the user has dismissed, keyed by their
  // 'onboarding_dismissed_*' settings key. Loaded once at boot from /settings.
  onboardingDismissed: Record<string, boolean>

  setTheme: (theme: 'light' | 'dark' | 'system') => void
  toggleSidebar: () => void
  setClaudePanelOpen: (open: boolean) => void
  setDbReady: (ready: boolean) => void
  setUser: (user: AuthUser | null) => void
  setOnboardingDismissed: (dismissed: Record<string, boolean>) => void
  markOnboardingDismissed: (key: string) => void
}

export const useAppStore = create<AppState>((set) => ({
  theme: 'light',
  sidebarOpen: true,
  claudePanelOpen: false,
  dbReady: false,
  user: null,
  onboardingDismissed: {},

  setTheme: (theme) => set({ theme }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setClaudePanelOpen: (open) => set({ claudePanelOpen: open }),
  setDbReady: (ready) => set({ dbReady: ready }),
  setUser: (user) => set({ user }),
  setOnboardingDismissed: (dismissed) => set({ onboardingDismissed: dismissed }),
  markOnboardingDismissed: (key) =>
    set((s) => ({ onboardingDismissed: { ...s.onboardingDismissed, [key]: true } })),
}))
