/**
 * Theme resolution and application.
 *
 * The stored preference is tri-state ('light' | 'dark' | 'system'); what the
 * page actually renders is binary. `resolveTheme` collapses one to the other,
 * and `applyTheme` is the ONLY place that touches the `dark` class on <html>.
 *
 * The preference lives on the server (settings key 'theme'), but that is not
 * readable until after login — so it is also mirrored into localStorage and
 * replayed by the inline script in index.html before first paint. Without that
 * mirror every load of a dark-themed app flashes a full-white screen while the
 * session check and the /settings request complete.
 */

export type ThemePreference = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'

/** Mirrors the server-side preference. Read by the pre-paint script in index.html. */
export const THEME_STORAGE_KEY = 'daybook.theme'

/** Browser-chrome colour per theme; keeps the mobile status bar in step. */
const META_THEME_COLOR: Record<ResolvedTheme, string> = {
  light: '#1D9E75',
  dark: '#0d1117',
}

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system'
}

export function prefersDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
}

export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  if (preference === 'system') return prefersDark() ? 'dark' : 'light'
  return preference
}

/** Applies the resolved theme to the document and persists the preference. */
export function applyTheme(preference: ThemePreference): ResolvedTheme {
  const resolved = resolveTheme(preference)
  document.documentElement.classList.toggle('dark', resolved === 'dark')

  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', META_THEME_COLOR[resolved])

  try {
    localStorage.setItem(THEME_STORAGE_KEY, preference)
  } catch {
    // Private-mode / disabled storage: the theme still applies for this page
    // load, it just cannot pre-empt the flash on the next one.
  }

  return resolved
}

/** The preference saved by a previous session, if any. */
export function storedThemePreference(): ThemePreference | null {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY)
    return isThemePreference(raw) ? raw : null
  } catch {
    return null
  }
}
