import { useState } from 'react'
import { Sparkles } from 'lucide-react'
import { api } from '@/lib/api'
import { errorMessage } from '@/lib/utils'
import { useAppStore } from '@/stores/app.store'
import { useToastStore } from '@/stores/toast.store'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'

/**
 * Settings → AI assistant: the Anthropic API key used by bulk categorisation
 * (docs/archive/ai-bulk-categorize-feature.md §2). Moved out of the old
 * monolithic SettingsPage (module-based settings) with no behaviour change
 * — same testids, same copy. `hasAnthropicKey` is loaded once at app boot
 * (App.tsx), not here.
 */
export function AiSettings() {
  const hasAnthropicKey = useAppStore((s) => s.hasAnthropicKey)
  const setHasAnthropicKey = useAppStore((s) => s.setHasAnthropicKey)
  const { addToast } = useToastStore()
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

  return (
    <div className="mx-auto max-w-lg md:mx-0 md:max-w-xl">
      <h1 className="page-title mb-6">AI assistant</h1>

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
    </div>
  )
}
