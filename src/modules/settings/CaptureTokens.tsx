import { useEffect, useState } from 'react'
import { Smartphone, Copy, Check } from 'lucide-react'
import { api } from '@/lib/api'
import { errorMessage } from '@/lib/utils'
import { useToastStore } from '@/stores/toast.store'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { ConfirmDeleteModal } from '@/components/ui/ConfirmDeleteModal'

const LOAD_FAILED = 'Could not load your connected devices.'

interface CaptureToken {
  id: string
  label: string
  scope: string
  created_at: string
  last_used_at: string | null
  revoked_at: string | null
}

function whenText(iso: string | null): string {
  if (!iso) return 'never'
  const then = new Date(iso.replace(' ', 'T') + 'Z').getTime()
  if (Number.isNaN(then)) return iso
  const days = Math.floor((Date.now() - then) / 86_400_000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  return `${days} days ago`
}

/**
 * "Connected devices" — capture tokens (docs/v2/wallet/feature-capture-inbox.md §4).
 *
 * A capture token authenticates a non-browser client (an iOS Shortcuts
 * automation, Claude) to create a *pending* capture and nothing else. Managing
 * them is the owner's job and happens here, over the session cookie; the tokens
 * themselves never authenticate this page.
 */
export function CaptureTokens() {
  const { addToast } = useToastStore()
  const [tokens, setTokens] = useState<CaptureToken[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [label, setLabel] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  // Held in memory only, and only until the user navigates away. The server
  // stores a SHA-256 of it and can never show it again.
  const [freshToken, setFreshToken] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [revoking, setRevoking] = useState<CaptureToken | null>(null)

  // Initial load. setState lives in the promise callbacks rather than in an
  // async helper called from the effect body — same shape GoalsPage uses, and
  // the one react-hooks/set-state-in-effect accepts.
  useEffect(() => {
    let cancelled = false
    api
      .get<CaptureToken[]>('/capture-tokens')
      .then((rows) => {
        if (cancelled) return
        setTokens(rows)
        setLoadError(null)
      })
      // Rule 13: an empty list and a failed load must not render identically.
      .catch((err) => {
        if (!cancelled) setLoadError(errorMessage(err, LOAD_FAILED))
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Re-read after a create or a revoke. Not reachable from an effect, so it can
  // await normally.
  async function reload() {
    try {
      setTokens(await api.get<CaptureToken[]>('/capture-tokens'))
      setLoadError(null)
    } catch (err) {
      setLoadError(errorMessage(err, LOAD_FAILED))
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = label.trim()
    if (!trimmed) {
      setCreateError('Give the device a name so you can tell your tokens apart.')
      return
    }
    setCreating(true)
    setCreateError(null)
    try {
      const created = await api.post<CaptureToken & { token: string }>('/capture-tokens', { label: trimmed })
      setFreshToken(created.token)
      setCopied(false)
      setLabel('')
      await reload()
    } catch (err) {
      setCreateError(errorMessage(err, 'Could not create the token — please try again.'))
    } finally {
      setCreating(false)
    }
  }

  async function handleCopy() {
    if (!freshToken) return
    try {
      await navigator.clipboard.writeText(freshToken)
      setCopied(true)
    } catch {
      // Clipboard access is denied in plenty of ordinary contexts. Say so
      // rather than leaving a button that appears to do nothing — the token is
      // selectable above either way.
      addToast({ message: 'Copy failed — select the token above and copy it manually.', duration: 4000 })
    }
  }

  async function handleRevoke() {
    const target = revoking
    if (!target) return
    setRevoking(null)
    try {
      await api.delete(`/capture-tokens/${target.id}`)
      addToast({ message: `"${target.label}" can no longer add transactions.` })
      await reload()
    } catch (err) {
      addToast({ message: errorMessage(err, 'Could not revoke the token.'), duration: 4000 })
    }
  }

  const active = tokens.filter((t) => !t.revoked_at)

  return (
    <section className="rounded-xl border border-line bg-surface p-5" data-testid="capture-tokens-section">
      <div className="mb-4 flex items-center gap-2">
        <Smartphone className="h-4 w-4 text-fg-faint" />
        <h3 className="text-sm font-semibold text-fg">Connected devices</h3>
      </div>
      <p className="text-sm text-fg-muted">
        A device token lets a shortcut on your phone add a transaction without signing in.
        Anything it sends waits in your review inbox until you accept it — a token can't read
        your balances, change anything, or sign in.
      </p>

      {freshToken && (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3" data-testid="capture-token-reveal">
          <p className="text-xs font-semibold text-amber-800">
            Copy this now — it is shown once and cannot be recovered.
          </p>
          <code className="mt-2 block select-all break-all rounded bg-surface px-2 py-1.5 font-mono text-xs text-fg">
            {freshToken}
          </code>
          <div className="mt-2 flex gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={() => void handleCopy()} data-testid="capture-token-copy">
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? 'Copied' : 'Copy'}
            </Button>
            <Button type="button" variant="secondary" size="sm" onClick={() => setFreshToken(null)}>
              Done
            </Button>
          </div>
        </div>
      )}

      <form className="mt-3 flex items-end gap-2" onSubmit={handleCreate}>
        <div className="flex-1">
          <Input
            label="Device name"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="My iPhone"
            data-testid="capture-token-label"
          />
        </div>
        <Button type="submit" size="sm" disabled={creating} data-testid="capture-token-create">
          {creating ? 'Creating…' : 'Create token'}
        </Button>
      </form>
      {createError && (
        <p className="mt-2 text-xs text-red-600" data-testid="capture-token-error">
          {createError}
        </p>
      )}

      {loadError ? (
        <p className="mt-4 text-xs text-red-600" data-testid="capture-token-load-error">
          {loadError}
        </p>
      ) : active.length > 0 ? (
        <ul className="mt-4 divide-y divide-line-subtle border-t border-line-subtle">
          {active.map((t) => (
            <li key={t.id} className="flex items-center gap-3 py-2.5" data-testid="capture-token-row">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-fg">{t.label}</div>
                <div className="text-xs text-fg-subtle">Last used {whenText(t.last_used_at)}</div>
              </div>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setRevoking(t)}
                data-testid="capture-token-revoke"
              >
                Revoke
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 text-xs text-fg-subtle">No devices connected yet.</p>
      )}

      <ConfirmDeleteModal
        open={!!revoking}
        onOpenChange={(open) => !open && setRevoking(null)}
        title={`Revoke "${revoking?.label ?? ''}"?`}
        description="That device stops being able to add transactions immediately. Anything it already sent stays in your inbox. You cannot un-revoke a token — you would create a new one and update the shortcut."
        confirmLabel="Revoke"
        onConfirm={() => void handleRevoke()}
        confirmTestId="capture-token-revoke-confirm"
      />
    </section>
  )
}
