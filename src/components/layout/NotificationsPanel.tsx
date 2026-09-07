import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell, Inbox, Users, Wallet, CalendarClock, PieChart, CheckSquare, WifiOff } from 'lucide-react'
import { api } from '@/lib/api'
import { errorMessage } from '@/lib/utils'

interface Notification {
  kind: string
  title: string
  body: string
  url: string
  attention: boolean
}

/** One icon per source, so the panel is scannable without reading every line. */
const ICONS: Record<string, typeof Bell> = {
  captures: Inbox,
  silence: WifiOff,
  claims: Users,
  invites: Users,
  bills: CalendarClock,
  budget: PieChart,
  tasks: CheckSquare,
  spend: Wallet,
}

/**
 * The notifications panel (R17 §3).
 *
 * Backed by `GET /api/notifications/pending` — the same computation the push
 * digest sends, so the bell and your phone can never disagree about what needs
 * doing. That endpoint was built for P4; this is its second reader, which is
 * why the panel needed no new backend.
 *
 * Owns its own trigger for the same reason AccountMenu does: one ref containing
 * both the button and the panel, so clicking the trigger while open isn't both
 * an outside-click close and a toggle re-open on the same event pair.
 */
export function NotificationsPanel() {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<Notification[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [count, setCount] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()

  const close = useCallback(() => setOpen(false), [])

  // Count on mount and every 60s, matching the shell's existing badge cadence.
  useEffect(() => {
    let cancelled = false
    const tick = () => {
      api
        .get<{ notifications: Notification[] }>('/notifications/pending')
        .then((res) => {
          if (cancelled) return
          setItems(res.notifications)
          setCount(res.notifications.filter((n) => n.attention).length)
          setError(null)
        })
        // A badge is not the place to shout about a failed count — the panel
        // says so when opened. Showing no badge is the right quiet degradation.
        .catch(() => undefined)
    }
    tick()
    const id = setInterval(tick, 60_000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    function onPointerDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) close()
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, close])

  // Re-read on open so a panel opened an hour after the last poll is current.
  async function toggle() {
    const next = !open
    setOpen(next)
    if (!next) return
    try {
      const res = await api.get<{ notifications: Notification[] }>('/notifications/pending')
      setItems(res.notifications)
      setCount(res.notifications.filter((n) => n.attention).length)
      setError(null)
    } catch (err) {
      // Rule 13: an empty panel and a failed fetch must not look identical.
      setError(errorMessage(err, "Couldn't load your notifications."))
    }
  }

  function go(url: string) {
    navigate(url)
    close()
  }

  return (
    <div className="pop-anchor" ref={containerRef}>
      <button
        type="button"
        className="circle-btn"
        aria-label="Notifications"
        aria-expanded={open}
        data-testid="notifications-bell"
        onClick={() => void toggle()}
      >
        <Bell className="icon" />
        {count > 0 && <span className="count">{count > 99 ? '99+' : count}</span>}
      </button>

      <div
        className={`menu${open ? ' open' : ''}`}
        style={{ right: 0, top: 'calc(100% + 8px)', minWidth: 300 }}
        data-testid="notifications-panel"
      >
        <div className="menu-label">Notifications</div>

        {error ? (
          <p className="px-3 py-2 text-xs text-red-600" data-testid="notifications-error">
            {error}
          </p>
        ) : items === null ? (
          <p className="px-3 py-2 text-xs text-fg-subtle">Loading…</p>
        ) : items.length === 0 ? (
          <p className="px-3 py-3 text-xs text-fg-subtle" data-testid="notifications-empty">
            Nothing needs your attention. You're on top of it.
          </p>
        ) : (
          items.map((n) => {
            const Icon = ICONS[n.kind] ?? Bell
            return (
              <button
                key={n.kind}
                type="button"
                className="menu-item"
                data-testid="notification-item"
                data-kind={n.kind}
                onClick={() => go(n.url)}
              >
                <Icon className="icon-sm" size={15} aria-hidden="true" />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate font-medium text-fg">{n.title}</span>
                  <span className="truncate text-xs text-fg-subtle">{n.body}</span>
                </span>
              </button>
            )
          })
        )}
      </div>
    </div>
  )
}
