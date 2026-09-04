import { useState, useEffect } from 'react'
import { Palette, Globe, LogOut, User, KeyRound, Sparkles, Wallet, Tag } from 'lucide-react'
import { api } from '@/lib/api'
import { errorMessage } from '@/lib/utils'
import { useAppStore } from '@/stores/app.store'
import { useThemePreference } from '@/hooks/useThemePreference'
import { isThemePreference } from '@/lib/theme'
import { useToastStore } from '@/stores/toast.store'
import { useWallet } from '@/hooks/useWallet'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'
import { Input } from '@/components/ui/Input'
import { CategoryManager } from '@/modules/wallet/CategoryManager'

export function SettingsPage() {
  const { theme, changeTheme } = useThemePreference()
  const setTheme = useAppStore((s) => s.setTheme)
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

  // Wallet → Categories (moved here from the Transactions toolbar and its
  // filter-dropdown footer entry, so there's a single canonical place to
  // manage categories rather than three).
  const { categories, loadCategories, addCategory, deleteCategory, getCategoryUsage } = useWallet()
  const [categoryManagerOpen, setCategoryManagerOpen] = useState(false)

  useEffect(() => {
    loadCategories()
  }, [loadCategories])

  // Change password
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [pwSaving, setPwSaving] = useState(false)
  const [pwError, setPwError] = useState<string | null>(null)

  const MIN_PASSWORD = 12

  // AI categorisation key (docs/ai-bulk-categorize-feature.md §2)
  const hasAnthropicKey = useAppStore((s) => s.hasAnthropicKey)
  const setHasAnthropicKey = useAppStore((s) => s.setHasAnthropicKey)
  const [apiKeyInput, setApiKeyInput] = useState('')
  const [apiKeySaving, setApiKeySaving] = useState(false)
  const [apiKeyError, setApiKeyError] = useState<string | null>(null)

  async function handleSaveApiKey(e: React.FormEvent) {
    e.preventDefault()
    setApiKeyError(null)
    const trimmed = apiKeyInput.trim()
    if (!trimmed) {
      setApiKeyError('Enter a key, or use Clear to remove the saved one.')
      return
    }
    setApiKeySaving(true)
    try {
      await api.put('/settings/anthropic_api_key', { value: trimmed })
      setHasAnthropicKey(true)
      setApiKeyInput('')
      addToast({ message: 'API key saved.' })
    } catch (err) {
      setApiKeyError(errorMessage(err, 'Could not save the key — please try again.'))
    } finally {
      setApiKeySaving(false)
    }
  }

  async function handleClearApiKey() {
    setApiKeySaving(true)
    setApiKeyError(null)
    try {
      await api.put('/settings/anthropic_api_key', { value: '' })
      setHasAnthropicKey(false)
      setApiKeyInput('')
      addToast({ message: 'API key removed.' })
    } catch (err) {
      setApiKeyError(errorMessage(err, 'Could not remove the key — please try again.'))
    } finally {
      setApiKeySaving(false)
    }
  }

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
          if (row.key === 'theme' && isThemePreference(row.value)) setTheme(row.value)
        }
      })
      .finally(() => setLoading(false))
  }, [setTheme])

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
        <h2 className="text-base font-semibold text-fg">Settings</h2>
        <p className="mt-0.5 text-xs text-fg-subtle">Preferences and API configuration</p>
      </div>

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

        {/* AI categorisation key */}
        <section className="rounded-xl border border-line bg-surface p-5">
          <div className="mb-4 flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-fg-faint" />
            <h3 className="text-sm font-semibold text-fg">AI categorisation</h3>
          </div>
          <p className="text-sm text-fg-muted">
            Optional. When a transaction's merchant has no rule-based suggestion, the bulk
            edit dialog can ask Claude to guess a category from your own category list.
          </p>
          <p className="mt-1 text-xs text-fg-faint">
            Get a key from{' '}
            <a
              href="https://console.anthropic.com"
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              console.anthropic.com
            </a>
            . Stored as plain text in the database — the same trust level as the rest of
            your data here, not a secret vault.
          </p>

          <form className="mt-3 space-y-2" onSubmit={handleSaveApiKey}>
            <Input
              label={hasAnthropicKey ? 'Replace API key' : 'Anthropic API key'}
              type="password"
              autoComplete="off"
              value={apiKeyInput}
              onChange={(e) => setApiKeyInput(e.target.value)}
              placeholder={hasAnthropicKey ? 'A key is saved — enter a new one to replace it' : 'sk-ant-...'}
              data-testid="anthropic-api-key-input"
            />
            {apiKeyError && (
              <p className="text-xs text-red-600" data-testid="anthropic-api-key-error">
                {apiKeyError}
              </p>
            )}
            <div className="flex items-center gap-2">
              <Button type="submit" size="sm" disabled={apiKeySaving} data-testid="anthropic-api-key-save">
                {apiKeySaving ? 'Saving…' : 'Save key'}
              </Button>
              {hasAnthropicKey && (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={apiKeySaving}
                  onClick={handleClearApiKey}
                  data-testid="anthropic-api-key-clear"
                >
                  Clear
                </Button>
              )}
            </div>
          </form>
        </section>

        {/* Wallet module settings */}
        <section className="rounded-xl border border-line bg-surface p-5">
          <div className="mb-4 flex items-center gap-2">
            <Wallet className="h-4 w-4 text-fg-faint" />
            <h3 className="text-sm font-semibold text-fg">Wallet</h3>
          </div>
          <div className="flex items-center justify-between">
            <p className="text-sm text-fg-muted">
              Categories used across transactions, budgets, and imports.
            </p>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setCategoryManagerOpen(true)}
              data-testid="manage-categories"
            >
              <Tag className="h-3.5 w-3.5" />
              Manage categories
            </Button>
          </div>
        </section>

        {/* Preferences section */}
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

        {/* Finance section */}
        <section className="rounded-xl border border-line bg-surface p-5">
          <div className="mb-4 flex items-center gap-2">
            <Globe className="h-4 w-4 text-fg-faint" />
            <h3 className="text-sm font-semibold text-fg">Finance</h3>
          </div>
          <p className="text-sm text-fg-muted">
            Currency <span className="font-medium text-fg">Malaysian Ringgit (MYR)</span>
          </p>
          <p className="mt-1 text-xs text-fg-faint">Daybook is single-currency for now.</p>
        </section>
      </div>

      <CategoryManager
        open={categoryManagerOpen}
        onOpenChange={setCategoryManagerOpen}
        categories={categories}
        onAdd={async (data) => { await addCategory(data) }}
        onDelete={async (id) => { await deleteCategory(id) }}
        onGetUsage={getCategoryUsage}
      />
    </div>
  )
}
