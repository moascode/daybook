import { Moon, Sun } from 'lucide-react'
import { Tooltip } from '@/components/ui/Tooltip'
import { useThemePreference } from '@/hooks/useThemePreference'

/**
 * One-click light/dark switch in the top bar. Shared by the desktop TopBar and
 * the mobile top bar in AppShell, alongside HelpButton.
 *
 * Deliberately two-state: it flips to the opposite of what is CURRENTLY ON
 * SCREEN, so from 'system' it lands on the explicit opposite rather than
 * cycling through a third state whose effect depends on an OS setting the
 * button cannot show. 'System' stays available in Settings → Appearance.
 */
export function ThemeToggle() {
  const { resolvedTheme, changeTheme } = useThemePreference()
  const goingDark = resolvedTheme === 'light'

  // The accessible name is the thing being toggled, with the on/off state in
  // aria-pressed — NOT a sentence like "Switch to dark theme". getByLabel()
  // matches substrings, so a name containing "to" made every existing
  // getByLabel('To') in the specs ambiguous (the date-range inputs), and one
  // containing "theme" did the same to getByLabel('Theme'). The descriptive
  // wording lives in the tooltip, which is a description, not a name.
  return (
    <Tooltip label={goingDark ? 'Switch to dark theme' : 'Switch to light theme'}>
      <button
        type="button"
        onClick={() => changeTheme(goingDark ? 'dark' : 'light')}
        aria-label="Dark theme"
        aria-pressed={!goingDark}
        data-testid="theme-toggle"
        className="flex h-9 w-9 items-center justify-center rounded-md text-fg-faint transition-colors hover:bg-surface-hover hover:text-fg-muted"
      >
        {goingDark ? <Moon className="h-[18px] w-[18px]" /> : <Sun className="h-[18px] w-[18px]" />}
      </button>
    </Tooltip>
  )
}
