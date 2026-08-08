import { create } from 'zustand'
import {
  type ResolvedTheme,
  type ThemePreference,
  resolveTheme,
  storedThemePreference,
} from '@/lib/theme'

export interface AuthUser {
  id: string
  username: string
}

interface AppState {
  theme: ThemePreference
  /**
   * What is actually on screen, with 'system' already resolved. Components that
   * need to branch on the theme in JS rather than CSS — the Recharts axes and
   * grids, which take colours as props — read this, not `theme`.
   */
  resolvedTheme: ResolvedTheme
  sidebarOpen: boolean
  claudePanelOpen: boolean
  dbReady: boolean
  user: AuthUser | null
  // U-16: which first-run WelcomeCards the user has dismissed, keyed by their
  // 'onboarding_dismissed_*' settings key. Loaded once at boot from /settings.
  onboardingDismissed: Record<string, boolean>
  // Whether an anthropic_api_key is saved for this user — GET /settings masks
  // the value itself to 'set'/'', so this is the presence flag, not the key.
  // Loaded at boot alongside onboardingDismissed; SettingsPage updates it
  // directly on save/clear so the bulk-edit "Ask AI" button reacts without a
  // reload (docs/ai-bulk-categorize-feature.md §3).
  hasAnthropicKey: boolean

  setTheme: (theme: ThemePreference) => void
  setResolvedTheme: (resolved: ResolvedTheme) => void
  toggleSidebar: () => void
  setClaudePanelOpen: (open: boolean) => void
  setDbReady: (ready: boolean) => void
  setUser: (user: AuthUser | null) => void
  setOnboardingDismissed: (dismissed: Record<string, boolean>) => void
  markOnboardingDismissed: (key: string) => void
  setHasAnthropicKey: (hasKey: boolean) => void
}

// Seeded from the localStorage mirror so the store agrees with the class the
// pre-paint script already put on <html>. The server's value still wins once
// /settings resolves; this only avoids a light->dark jump on the way there.
// Default stays 'light' when nothing has been saved.
const initialTheme: ThemePreference = storedThemePreference() ?? 'light'

export const useAppStore = create<AppState>((set) => ({
  theme: initialTheme,
  resolvedTheme: resolveTheme(initialTheme),
  sidebarOpen: true,
  claudePanelOpen: false,
  dbReady: false,
  user: null,
  onboardingDismissed: {},
  hasAnthropicKey: false,

  setTheme: (theme) => set({ theme }),
  setResolvedTheme: (resolved) => set({ resolvedTheme: resolved }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setClaudePanelOpen: (open) => set({ claudePanelOpen: open }),
  setDbReady: (ready) => set({ dbReady: ready }),
  setUser: (user) => set({ user }),
  setOnboardingDismissed: (dismissed) => set({ onboardingDismissed: dismissed }),
  markOnboardingDismissed: (key) =>
    set((s) => ({ onboardingDismissed: { ...s.onboardingDismissed, [key]: true } })),
  setHasAnthropicKey: (hasKey) => set({ hasAnthropicKey: hasKey }),
}))
