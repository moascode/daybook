import { useCallback } from 'react'
import { api } from '@/lib/api'
import { errorMessage } from '@/lib/utils'
import { useAppStore } from '@/stores/app.store'
import { useToastStore } from '@/stores/toast.store'
import type { ThemePreference } from '@/lib/theme'

/**
 * Reads and writes the theme preference.
 *
 * Shared by the Settings → Appearance select and the TopBar toggle so the two
 * controls cannot drift: both apply the change immediately and persist it in
 * the same way (U-06 — a preference, not a form field, so there is no Save
 * step and it must not silently revert on reload).
 */
export function useThemePreference() {
  const theme = useAppStore((s) => s.theme)
  const resolvedTheme = useAppStore((s) => s.resolvedTheme)
  const setTheme = useAppStore((s) => s.setTheme)
  const { addToast } = useToastStore()

  const changeTheme = useCallback(
    async (next: ThemePreference) => {
      const previous = useAppStore.getState().theme
      // Apply first: the store drives the class on <html>, so the UI switches
      // instantly and the request settles behind it.
      setTheme(next)
      try {
        await api.put('/settings/theme', { value: next })
      } catch (err: unknown) {
        // Roll back, or the screen and the saved preference disagree until reload.
        setTheme(previous)
        addToast({ message: errorMessage(err, 'Could not save your theme — please try again.') })
      }
    },
    [setTheme, addToast],
  )

  return { theme, resolvedTheme, changeTheme }
}
