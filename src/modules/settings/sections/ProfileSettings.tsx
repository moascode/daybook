import { useState } from 'react'
import { LogOut, User, KeyRound } from 'lucide-react'
import { api } from '@/lib/api'
import { errorMessage } from '@/lib/utils'
import { useAppStore } from '@/stores/app.store'
import { useToastStore } from '@/stores/toast.store'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'

const MIN_PASSWORD = 12

/**
 * Settings → Profile & security: account identity, sign out, and the change
 * password form. Moved out of the old monolithic SettingsPage (module-based
 * settings) with no behaviour change — same testids, same copy.
 */
export function ProfileSettings() {
  const user = useAppStore((s) => s.user)
  const setUser = useAppStore((s) => s.setUser)
  const setDbReady = useAppStore((s) => s.setDbReady)
  const { addToast } = useToastStore()

  async function handleLogout() {
    await api.post('/auth/logout')
    setDbReady(false)
    setUser(null)
  }

  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [pwSaving, setPwSaving] = useState(false)
  const [pwError, setPwError] = useState<string | null>(null)

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

  return (
    <div className="mx-auto max-w-lg md:mx-0 md:max-w-xl">
      <h1 className="page-title mb-6">Profile &amp; security</h1>

      <div className="space-y-5">
        {/* Account section */}
        <section className="rounded-xl border border-line bg-surface p-5">
          <div className="mb-4 flex items-center gap-2">
            <User className="h-4 w-4 text-fg-faint" />
            <h3 className="text-sm font-semibold text-fg">Account</h3>
          </div>
          <div className="flex items-center justify-between">
            <p className="text-sm text-fg-muted">
              Signed in as <span className="font-medium text-fg">{user?.username}</span>
            </p>
            <Button variant="secondary" onClick={handleLogout}>
              <LogOut className="h-3.5 w-3.5" />
              Sign out
            </Button>
          </div>
        </section>

        {/* Change password */}
        <section className="rounded-xl border border-line bg-surface p-5">
          <div className="mb-4 flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-fg-faint" />
            <h3 className="text-sm font-semibold text-fg">Change password</h3>
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
            <p className="text-xs text-fg-subtle">
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
      </div>
    </div>
  )
}
