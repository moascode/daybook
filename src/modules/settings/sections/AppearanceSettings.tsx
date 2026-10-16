import { Palette } from 'lucide-react'
import { useThemePreference } from '@/hooks/useThemePreference'
import { isThemePreference } from '@/lib/theme'
import { Select } from '@/components/ui/Select'

/**
 * Settings → Appearance: theme preference only. Moved out of the old
 * monolithic SettingsPage (module-based settings) with no behaviour change.
 * The saved value itself is loaded once at app boot (App.tsx), not here.
 */
export function AppearanceSettings() {
  const { theme, changeTheme } = useThemePreference()

  return (
    <div className="mx-auto max-w-lg md:mx-0 md:max-w-xl">
      <h1 className="page-title mb-6">Appearance</h1>

      <section className="rounded-xl border border-line bg-surface p-5">
        <div className="mb-4 flex items-center gap-2">
          <Palette className="h-4 w-4 text-fg-faint" />
          <h3 className="text-sm font-semibold text-fg">Appearance</h3>
        </div>

        <Select
          label="Theme"
          options={[
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
            { value: 'system', label: 'System (follow OS)' },
          ]}
          value={theme}
          onChange={(e) => {
            if (isThemePreference(e.target.value)) changeTheme(e.target.value)
          }}
        />
        <p className="mt-2 text-xs text-fg-faint">
          Your choice is saved instantly. System follows your device's light or dark setting
          and updates as it changes.
        </p>
      </section>
    </div>
  )
}
