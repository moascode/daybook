import { useState, useEffect } from 'react'
import { Eye, EyeOff, Key, Palette, Globe } from 'lucide-react'
import { getDB } from '@/db'
import { useAppStore } from '@/stores/app.store'
import { useToastStore } from '@/stores/toast.store'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'

export function SettingsPage() {
  const { theme, setTheme } = useAppStore()
  const { addToast } = useToastStore()

  const [apiKey, setApiKey] = useState('')
  const [defaultCurrency, setDefaultCurrency] = useState('MYR')
  const [showApiKey, setShowApiKey] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getDB()
      .then((db) =>
        db.query<{ key: string; value: string }>(
          "SELECT key, value FROM settings WHERE key IN ('anthropic_api_key', 'default_currency', 'theme')",
        ),
      )
      .then((result) => {
        for (const row of result.rows) {
          if (row.key === 'anthropic_api_key') setApiKey(row.value)
          if (row.key === 'default_currency') setDefaultCurrency(row.value)
          if (row.key === 'theme') setTheme(row.value as 'light' | 'dark' | 'system')
        }
      })
      .finally(() => setLoading(false))
  }, [setTheme])

  async function handleSave() {
    const db = await getDB()
    const entries: [string, string][] = [
      ['anthropic_api_key', apiKey],
      ['default_currency', defaultCurrency],
      ['theme', theme],
    ]
    for (const [key, value] of entries) {
      await db.query(
        'INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2',
        [key, value],
      )
    }
    addToast({ message: 'Settings saved' })
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
        {/* AI section */}
        <section className="rounded-xl border border-gray-200 bg-white p-5">
          <div className="mb-4 flex items-center gap-2">
            <Key className="h-4 w-4 text-gray-400" />
            <h3 className="text-sm font-semibold text-gray-900">AI (Claude)</h3>
          </div>

          <div className="relative">
            <Input
              label="Anthropic API Key"
              type={showApiKey ? 'text' : 'password'}
              placeholder="sk-ant-api03-…"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
            <button
              type="button"
              onClick={() => setShowApiKey((v) => !v)}
              className="absolute right-3 top-[30px] text-gray-400 hover:text-gray-600"
              aria-label={showApiKey ? 'Hide API key' : 'Show API key'}
            >
              {showApiKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </button>
          </div>
          <p className="mt-2 text-xs text-gray-400">
            Stored only in your browser database — never sent to any third-party server.
            Get your key at console.anthropic.com.
          </p>
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
              { value: 'dark', label: 'Dark' },
              { value: 'system', label: 'System (follow OS)' },
            ]}
            value={theme}
            onChange={(e) => setTheme(e.target.value as 'light' | 'dark' | 'system')}
          />
          <p className="mt-2 text-xs text-gray-400">
            Dark mode styles are coming soon — selecting Dark will apply the CSS class but
            full dark theme is not yet complete.
          </p>
        </section>

        {/* Finance section */}
        <section className="rounded-xl border border-gray-200 bg-white p-5">
          <div className="mb-4 flex items-center gap-2">
            <Globe className="h-4 w-4 text-gray-400" />
            <h3 className="text-sm font-semibold text-gray-900">Finance</h3>
          </div>

          <Select
            label="Default Currency"
            options={[
              { value: 'MYR', label: 'MYR — Malaysian Ringgit' },
              { value: 'USD', label: 'USD — US Dollar' },
              { value: 'EUR', label: 'EUR — Euro' },
              { value: 'SGD', label: 'SGD — Singapore Dollar' },
              { value: 'GBP', label: 'GBP — British Pound' },
            ]}
            value={defaultCurrency}
            onChange={(e) => setDefaultCurrency(e.target.value)}
          />
        </section>

        <div className="flex justify-end">
          <Button onClick={handleSave}>Save changes</Button>
        </div>
      </div>
    </div>
  )
}
