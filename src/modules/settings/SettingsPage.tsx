import { useState, useEffect } from 'react'
import { Palette, Globe, LogOut, User, KeyRound } from 'lucide-react'
import { api } from '@/lib/api'
import { errorMessage } from '@/lib/utils'
import { useAppStore } from '@/stores/app.store'
import { useToastStore } from '@/stores/toast.store'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'
import { Input } from '@/components/ui/Input'

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

  // Change password
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [pwSaving, setPwSaving] = useState(false)
  const [pwError, setPwError] = useState<string | null>(null)

  const MIN_PASSWORD = 12

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault()
    setPwError(null)

    // Checked client-side too so the mismatch case never leaves the browser —
    // the server has no way to tell "confirm" apart from a typo in "new".
    if (newPassword !== confirmPassword) {
      setPwError('The new passwords do not match.')
      return
    }
    if (newPassword.length < MIN_PASSWORD) {
      setPwError(`New password must be at least ${MIN_PASSWORD} characters.`)
      return
    }

    setPwSaving(true)
    try {
      await api.post('/auth/change-password', { currentPassword, newPassword })
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      addToast({ message: 'Password changed. Other devices have been signed out.' })
    } catch (err: unknown) {
      setPwError(errorMessage(err, 'Could not change your password — please try again.'))
    } finally {
      setPwSaving(false)
    }
  }

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

        {/* Change password */}
        <section className="rounded-xl border border-gray-200 bg-white p-5">
          <div className="mb-4 flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-gray-400" />
            <h3 className="text-sm font-semibold text-gray-900">Change password</h3>
          </div>
          <form className="space-y-3" onSubmit={handleChangePassword}>
            <Input
              label="Current password"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              data-testid="current-password"
              required
            />
            <Input
              label="New password"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              data-testid="new-password"
              required
            />
            <Input
              label="Confirm new password"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              data-testid="confirm-password"
              required
            />
            <p className="text-xs text-gray-500">
              At least {MIN_PASSWORD} characters. A long, randomly generated password is
              strongly recommended. Changing it signs out your other devices.
            </p>
            {pwError && (
              <p className="text-xs text-red-600" data-testid="password-error">
                {pwError}
              </p>
            )}
            <Button type="submit" disabled={pwSaving} data-testid="change-password-submit">
              {pwSaving ? 'Changing…' : 'Change password'}
            </Button>
          </form>
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
