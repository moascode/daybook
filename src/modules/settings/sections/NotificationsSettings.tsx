import { useCallback, useState } from 'react'
import { Bell } from 'lucide-react'
import { PushNotifications } from '../PushNotifications'

/**
 * Settings → Notifications. Moved out of the old monolithic SettingsPage
 * (module-based settings) with no behaviour change — `<PushNotifications/>`
 * is untouched, apart from the `onUnavailable` callback it now accepts.
 *
 * `/settings/notifications` must never render blank: when push genuinely
 * isn't configured on this deployment, PushNotifications renders nothing —
 * so this section needs its own explanation in that case. Rather than a
 * second `/notifications/config` fetch, PushNotifications reports that one
 * fact back through `onUnavailable` from the fetch it already makes.
 */
export function NotificationsSettings() {
  const [pushUnavailable, setPushUnavailable] = useState(false)
  const handleUnavailable = useCallback(() => setPushUnavailable(true), [])

  return (
    <div className="mx-auto max-w-lg md:mx-0 md:max-w-xl">
      <h1 className="page-title mb-6">Notifications</h1>
      <PushNotifications onUnavailable={handleUnavailable} />
      {pushUnavailable && (
        <section
          className="rounded-xl border border-line bg-surface p-5"
          data-testid="push-not-configured"
        >
          <div className="mb-4 flex items-center gap-2">
            <Bell className="h-4 w-4 text-fg-faint" />
            <h3 className="text-sm font-semibold text-fg">Notifications</h3>
          </div>
          <p className="text-sm text-fg-muted">
            Push notifications aren't set up on this server yet — reminders and digests still
            appear in the in-app bell.
          </p>
        </section>
      )}
    </div>
  )
}
