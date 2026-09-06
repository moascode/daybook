import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { listCaptures } from '@/lib/captures'
import { CAPTURES_CHANGED } from './CaptureInbox'

/**
 * Count of captures waiting on the Inbox nav link. Mirrors PendingClaimsBadge —
 * same shape, same question: "is something waiting for me?"
 *
 * Recounts on navigation and on the inbox's own accept/dismiss event rather
 * than polling. A capture arriving while the tab sits idle shows up on the next
 * navigation, which is soon enough for a queue whose whole point is that it can
 * wait — and a poll on a live money app is a cost with no matching benefit.
 */
export function CaptureInboxBadge() {
  const [count, setCount] = useState(0)
  const location = useLocation()

  useEffect(() => {
    let cancelled = false
    const recount = () => {
      listCaptures()
        .then((rows) => {
          if (!cancelled) setCount(rows.length)
        })
        // A badge is not the place to report a failed count — the inbox page
        // itself says so loudly (rule 13). Showing a stale or absent number is
        // the correct degradation for an ambient indicator.
        .catch(() => {})
    }
    recount()
    window.addEventListener(CAPTURES_CHANGED, recount)
    return () => {
      cancelled = true
      window.removeEventListener(CAPTURES_CHANGED, recount)
    }
  }, [location.pathname])

  if (count === 0) return null
  return (
    <span
      data-testid="capture-inbox-badge"
      aria-label={`${count} capture${count === 1 ? '' : 's'} to review`}
      className="ml-auto flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-fg-on-accent leading-none"
    >
      {count > 9 ? '9+' : count}
    </span>
  )
}
