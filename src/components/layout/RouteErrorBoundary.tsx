import { useEffect, useRef } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { useRouteError } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { isChunkLoadError, reloadOnceForChunkError } from '@/lib/chunkReload'

/**
 * Router-level `errorElement` (root route, router.tsx) — anything an app
 * route throws during render, a loader or an action lands here instead of
 * React Router's own raw error screen ("Unexpected Application Error!").
 *
 * The case this exists for (fix/import-chunk-and-account-badge): a lazy
 * route's `import()` rejecting because its chunk no longer exists after a
 * deploy. src/main.tsx already handles Vite's own `vite:preloadError` event
 * for that; this component is the other half — a `lazy()` rejection that
 * React throws during render instead goes through `useRouteError()` here,
 * never that window event. Both paths share one guarded reload
 * (src/lib/chunkReload.ts) so a tab can never reload-loop: if the guard is
 * still fresh when a chunk-load error lands here, this renders the friendly
 * message below instead of reloading again.
 */
export function RouteErrorBoundary() {
  const error = useRouteError()
  const chunkLoad = isChunkLoadError(error)
  const attempted = useRef(false)

  useEffect(() => {
    if (!chunkLoad || attempted.current) return
    attempted.current = true
    reloadOnceForChunkError()
  }, [chunkLoad])

  if (import.meta.env.DEV) {
    console.error('Route error:', error)
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-sunken px-4">
      <EmptyState
        icon={<AlertTriangle className="h-10 w-10" aria-hidden="true" />}
        title={chunkLoad ? 'Daybook was updated' : 'Something went wrong'}
        description={
          chunkLoad
            ? "This tab was open before the latest update shipped, so a piece of it couldn't load. Reloading will fix it."
            : "This page hit an error it couldn't recover from. Reloading usually fixes it — if it keeps happening, let us know."
        }
        action={
          <div className="flex items-center gap-3">
            <Button size="sm" onClick={() => window.location.reload()}>
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              Reload
            </Button>
            {!chunkLoad && (
              <Button size="sm" variant="secondary" onClick={() => { window.location.href = '/' }}>
                Go home
              </Button>
            )}
          </div>
        }
      />
    </div>
  )
}
