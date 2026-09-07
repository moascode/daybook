import { useEffect, useState } from 'react'
import { Bell } from 'lucide-react'
import { api } from '@/lib/api'
import { errorMessage } from '@/lib/utils'
import { useToastStore } from '@/stores/toast.store'
import { Button } from '@/components/ui/Button'

interface PushConfig {
  enabled: boolean
  publicKey: string
}

/** base64url VAPID key → the Uint8Array PushManager wants. */
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0))
}

const supported =
  typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window

/**
 * The notifications toggle (v3 P4).
 *
 * Permission is asked for HERE, on a button press, and never on page load —
 * a prompt sprung on arrival is the fastest way to a permanent "Denied", and
 * iOS never asks again once that happens.
 *
 * On iOS this only works for a PWA installed to the home screen. Safari in a
 * tab reports PushManager as missing, which is why the unsupported state
 * explains itself rather than hiding.
 */
export function PushNotifications() {
  const { addToast } = useToastStore()
  const [config, setConfig] = useState<PushConfig | null>(null)
  const [subscribed, setSubscribed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const cfg = await api.get<PushConfig>('/notifications/config')
        if (cancelled) return
        setConfig(cfg)
        setLoadError(null)
        if (!cfg.enabled || !supported) return
        const reg = await navigator.serviceWorker.ready
        const sub = await reg.pushManager.getSubscription()
        if (cancelled) return
        if (!sub) return setSubscribed(false)
        const { subscribed: known } = await api.get<{ subscribed: boolean }>(
          `/notifications/subscription?endpoint=${encodeURIComponent(sub.endpoint)}`,
        )
        if (!cancelled) setSubscribed(known)
      } catch (err) {
        if (!cancelled) setLoadError(errorMessage(err, "Couldn't check your notification settings."))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  async function enable() {
    if (!config?.publicKey) return
    setBusy(true)
    try {
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        addToast({
          message:
            permission === 'denied'
              ? 'Notifications are blocked for Daybook. You can re-allow them in your browser settings.'
              : 'Notifications were not enabled.',
          duration: 5000,
        })
        return
      }
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(config.publicKey) as BufferSource,
      })
      await api.post('/notifications/subscribe', sub.toJSON())
      setSubscribed(true)
      addToast({ message: 'Notifications on. You will get a morning digest and an evening summary.' })
    } catch (err) {
      addToast({ message: errorMessage(err, "Couldn't turn notifications on."), duration: 5000 })
    } finally {
      setBusy(false)
    }
  }

  async function disable() {
    setBusy(true)
    try {
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.getSubscription()
      if (sub) {
        await api.post('/notifications/unsubscribe', { endpoint: sub.endpoint })
        await sub.unsubscribe()
      }
      setSubscribed(false)
      addToast({ message: 'Notifications off.' })
    } catch (err) {
      addToast({ message: errorMessage(err, "Couldn't turn notifications off."), duration: 5000 })
    } finally {
      setBusy(false)
    }
  }

  // Render nothing until we know. Showing the section and then pulling it away
  // once config resolves is a worse first impression than a beat of nothing —
  // and if config FAILED we do want the section, to carry the error.
  if (!config && !loadError) return null
  // Push isn't configured on this deployment: the feature genuinely does not
  // exist here, and a dead toggle is worse than no toggle.
  if (config && !config.enabled) return null

  return (
    <section className="rounded-xl border border-line bg-surface p-5" data-testid="push-section">
      <div className="mb-4 flex items-center gap-2">
        <Bell className="h-4 w-4 text-fg-faint" />
        <h3 className="text-sm font-semibold text-fg">Notifications</h3>
      </div>

      <p className="text-sm text-fg-muted">
        A short digest each morning — payments waiting to review, splits raised against you, budgets near
        their limit, tasks due — and a summary of what you spent each evening. At most one of each per day.
      </p>

      {loadError ? (
        <p className="mt-3 text-xs text-red-600" data-testid="push-error">
          {loadError}
        </p>
      ) : !supported ? (
        <p className="mt-3 text-xs text-fg-subtle" data-testid="push-unsupported">
          This browser can't show notifications. On an iPhone, add Daybook to your home screen first — Safari
          in a tab can't do it.
        </p>
      ) : (
        <div className="mt-3 flex items-center gap-3">
          {subscribed ? (
            <Button variant="secondary" size="sm" disabled={busy} onClick={() => void disable()} data-testid="push-disable">
              {busy ? 'Working…' : 'Turn off'}
            </Button>
          ) : (
            <Button size="sm" disabled={busy} onClick={() => void enable()} data-testid="push-enable">
              {busy ? 'Working…' : 'Turn on notifications'}
            </Button>
          )}
          <span className="text-xs text-fg-subtle" data-testid="push-state">
            {subscribed ? 'On for this device' : 'Off'}
          </span>
        </div>
      )}
    </section>
  )
}
