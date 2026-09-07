// Daybook service worker.
//
// v2 (P1/P2). v1 shipped a fetch handler that answered a failed navigation
// with `caches.match('/')` while nothing in the file ever wrote to a cache —
// zero calls to caches.open/add/put. It resolved `undefined`, respondWith
// rejected, and going offline produced a browser error page. Its comment also
// promised "cache-first for assets", which was never implemented. So this is a
// rewrite, not a tweak, and the version bump exists to evict v1's empty cache.
//
// Two rules, and one hard exclusion:
//
//  1. NAVIGATION is network-first, and every successful response refreshes the
//     cached shell. That keeps the offline copy current without a build step:
//     a deploy changes the hashed asset filenames the HTML points at, so a
//     stale shell would reference assets that no longer exist.
//  2. ASSETS are cache-first. Vite content-hashes these filenames, so a cached
//     one can never be the wrong version of anything — a new build produces a
//     new name.
//  3. /api/* IS NEVER CACHED, under any condition. This is a ledger. A stale
//     balance served from a cache is worse than no balance at all, and there is
//     no invalidation story that makes it safe.

const CACHE_NAME = 'daybook-v2'
const SHELL = '/'

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.add(SHELL))
      // A failed precache must not block activation — the app works without
      // the worker, and a half-installed worker is worse than none.
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

function isAsset(url) {
  return url.origin === self.location.origin && /^\/(assets|icon-|apple-touch-icon|favicon)/.test(url.pathname)
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)

  // Rule 3, first and unconditional.
  if (url.origin === self.location.origin && url.pathname.startsWith('/api/')) return

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone()
            caches.open(CACHE_NAME).then((c) => c.put(SHELL, copy)).catch(() => undefined)
          }
          return res
        })
        .catch(async () => {
          const cached = await caches.match(SHELL)
          if (cached) return cached
          // Nothing cached yet — say so in the response the browser renders,
          // rather than letting respondWith reject into a blank error page.
          return new Response(
            '<!doctype html><meta charset="utf-8"><title>Daybook is offline</title>' +
              '<body style="font:16px/1.5 system-ui;padding:2rem;max-width:32rem;margin:0 auto">' +
              '<h1 style="font-size:1.25rem">You are offline</h1>' +
              '<p>Daybook has not been opened on this device while online yet, so there is nothing saved to show. ' +
              'Reconnect and open it once, and it will work offline after that.</p>',
            { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
          )
        }),
    )
    return
  }

  if (isAsset(url)) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ??
          fetch(request).then((res) => {
            if (res && res.ok) {
              const copy = res.clone()
              caches.open(CACHE_NAME).then((c) => c.put(request, copy)).catch(() => undefined)
            }
            return res
          }),
      ),
    )
  }
})
