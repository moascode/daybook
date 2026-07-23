import { useState, useEffect } from 'react'
import { Palette, Globe, LogOut, User } from 'lucide-react'
import { api } from '@/lib/api'
import { errorMessage } from '@/lib/utils'
import { useAppStore } from '@/stores/app.store'
import { useToastStore } from '@/stores/toast.store'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'

export function SettingsPage() {
  const { theme, setTheme } = useAppStore()
  const user = useAppStore((s) => s.user)
  const setUser = useAppStore((s) => s.setUser)
  const setDbReady = useAppStore((s) => s.setDbReady)
  const { addToast } = useToastStore()

  async function handleLogout() {
    await api.post('/auth/logout')
    setDbReady(false)
    setUser(null)
  }

  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api
      .get<{ key: string; value: string }[]>('/settings')
      .then((rows) => {
        for (const row of rows) {
          if (row.key === 'theme') setTheme(row.value as 'light' | 'dark' | 'system')
        }
      })
      .finally(() => setLoading(false))
  }, [setTheme])

  // U-06: a preference, not a form field — apply and persist immediately so it
  // never silently reverts on reload after being changed and navigated away.
  async function handleThemeChange(next: 'light' | 'dark' | 'system') {
    setTheme(next)
    try {
      await api.put('/settings/theme', { value: next })
    } catch (err: unknown) {
      addToast({ message: errorMessage(err, 'Could not save your theme — please try again.') })
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-lg">
      <div className="mb-6">
        <h2 className="text-base font-semibold text-gray-900">Settings</h2>
        <p className="mt-0.5 text-xs text-gray-500">Preferences and API configuration</p>
      </div>

      <div className="space-y-5">
        {/* Account section */}
        <section className="rounded-xl border border-gray-200 bg-white p-5">
          <div className="mb-4 flex items-center gap-2">
            <User className="h-4 w-4 text-gray-400" />
            <h3 className="text-sm font-semibold text-gray-900">Account</h3>
          </div>
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-600">
              Signed in as <span className="font-medium text-gray-900">{user?.username}</span>
            </p>
            <Button variant="secondary" onClick={handleLogout}>
              <LogOut className="h-3.5 w-3.5" />
              Sign out
            </Button>
          </div>
        </section>

        {/* Preferences section */}
        <section className="rounded-xl border border-gray-200 bg-white p-5">
          <div className="mb-4 flex items-center gap-2">
            <Palette className="h-4 w-4 text-gray-400" />
            <h3 className="text-sm font-semibold text-gray-900">Appearance</h3>
          </div>

          <Select
            label="Theme"
            options={[
              { value: 'light', label: 'Light' },
              { value: 'system', label: 'System (follow OS)' },
            ]}
            value={theme === 'dark' ? 'system' : theme}
            onChange={(e) => handleThemeChange(e.target.value as 'light' | 'system')}
          />
          <p className="mt-2 text-xs text-gray-400">
            Your choice is saved instantly. A full dark theme is still in progress, so only
            Light and System are available for now.
          </p>
        </section>

        {/* Finance section */}
        <section className="rounded-xl border border-gray-200 bg-white p-5">
          <div className="mb-4 flex items-center gap-2">
            <Globe className="h-4 w-4 text-gray-400" />
            <h3 className="text-sm font-semibold text-gray-900">Finance</h3>
          </div>
          <p className="text-sm text-gray-600">
            Currency <span className="font-medium text-gray-900">Malaysian Ringgit (MYR)</span>
          </p>
          <p className="mt-1 text-xs text-gray-400">Daybook is single-currency for now.</p>
        </section>
      </div>
    </div>
  )
}
