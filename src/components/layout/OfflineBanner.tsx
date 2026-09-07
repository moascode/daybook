import { useEffect, useState } from 'react'
import { WifiOff } from 'lucide-react'

/**
 * Says so when the browser has no connection (v3 P2).
 *
 * Daybook reads and writes everything over `/api`, and the service worker
 * deliberately never caches those responses — a stale balance is worse than no
 * balance. So offline means the app shell renders and nothing else works, and
 * without this banner that state is indistinguishable from the app being
 * broken. Rule 13: the failure has to say something the user can act on.
 *
 * `navigator.onLine` only knows about the network interface, not whether the
 * server is reachable — so a request that fails while `onLine` is true still
 * reports its own error through `src/lib/api.ts`. This covers the case the
 * browser is certain about.
 */
export function OfflineBanner() {
  const [offline, setOffline] = useState(() => typeof navigator !== 'undefined' && !navigator.onLine)

  useEffect(() => {
    const goOffline = () => setOffline(true)
    const goOnline = () => setOffline(false)
    window.addEventListener('offline', goOffline)
    window.addEventListener('online', goOnline)
    return () => {
      window.removeEventListener('offline', goOffline)
      window.removeEventListener('online', goOnline)
    }
  }, [])

  if (!offline) return null

  return (
    <div
      role="status"
      data-testid="offline-banner"
      className="flex items-center justify-center gap-2 bg-amber-100 px-4 py-1.5 text-center text-xs font-medium text-amber-900"
    >
      <WifiOff className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
      <span>You're offline — you can read what's on screen, but nothing will save until you reconnect.</span>
    </div>
  )
}
