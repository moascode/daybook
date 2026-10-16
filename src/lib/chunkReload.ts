/**
 * Stale-tab-after-deploy recovery (fix/import-chunk-and-account-badge).
 *
 * A tab left open across a deploy still holds the old index.html, which
 * references a hashed chunk (e.g. `CsvImport-<hash>.js`, see src/router.tsx's
 * `page()`/`lazy()`) that no longer exists in `dist/` once a new build has
 * shipped. worker/index.ts now 404s that request instead of falling back to
 * index.html's `text/html`, but the browser still can't execute what it
 * asked for — both Vite's own preload mechanism (`vite:preloadError`) and a
 * bare `import()` from React Router's `lazy()` throw for it, and the message
 * differs by browser/bundler path (see {@link CHUNK_LOAD_PATTERNS}).
 *
 * Shared by src/main.tsx (the `vite:preloadError` window event) and
 * src/components/layout/RouteErrorBoundary.tsx (a `lazy()` import rejection
 * that reached the router's `errorElement`) so both paths agree on the same
 * one-reload-per-window guard.
 */

const CHUNK_LOAD_PATTERNS = [
  'failed to fetch dynamically imported module',
  'is not a valid javascript mime type',
  'importing a module script failed',
  'error loading dynamically imported module',
]

export function isChunkLoadError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : typeof err === 'string' ? err : ''
  const lower = message.toLowerCase()
  return CHUNK_LOAD_PATTERNS.some((p) => lower.includes(p))
}

const RELOAD_GUARD_KEY = 'daybook:chunk-reload-at'
const RELOAD_GUARD_WINDOW_MS = 10_000

/**
 * Reloads the page once per `RELOAD_GUARD_WINDOW_MS`, so a genuinely broken
 * deploy (the new chunk 404s too) shows the friendly error instead of
 * reloading forever. Returns `true` if it triggered a reload, `false` if the
 * guard was already spent (the caller should then fall back to rendering its
 * own "please reload" UI).
 */
export function reloadOnceForChunkError(): boolean {
  try {
    const last = sessionStorage.getItem(RELOAD_GUARD_KEY)
    if (last && Date.now() - Number(last) < RELOAD_GUARD_WINDOW_MS) return false
    sessionStorage.setItem(RELOAD_GUARD_KEY, String(Date.now()))
  } catch {
    // Storage unavailable (private mode, quota, etc.) — fail open rather than
    // never recovering (rule 10): a reload that might not have strictly
    // needed a guard this one time beats never recovering at all.
  }
  window.location.reload()
  return true
}
