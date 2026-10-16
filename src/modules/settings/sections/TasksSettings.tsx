import { Link } from 'react-router-dom'
import { Bell } from 'lucide-react'

/**
 * Settings → Tasks. Read-only for now: task reminders arrive as push
 * notifications, and that toggle already has one canonical home
 * (Settings → Notifications) — this section explains it and links there
 * rather than duplicating the control.
 */
export function TasksSettings() {
  return (
    <div className="mx-auto max-w-lg md:mx-0 md:max-w-xl">
      <h1 className="page-title mb-6">Tasks</h1>

      <section className="rounded-xl border border-line bg-surface p-5">
        <div className="mb-4 flex items-center gap-2">
          <Bell className="h-4 w-4 text-fg-faint" />
          <h3 className="text-sm font-semibold text-fg">Reminders</h3>
        </div>
        <p className="text-sm text-fg-muted">
          Task reminders and due-today nudges arrive as push notifications, the same
          delivery as Wallet and Day's digests.
        </p>
        <Link
          to="/settings/notifications"
          className="mt-2 inline-block text-xs font-medium text-brand-700 underline"
          data-testid="tasks-settings-notifications-link"
        >
          Manage notifications
        </Link>
      </section>
    </div>
  )
}
