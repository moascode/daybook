/**
 * Regression for a bug reported on the live app shortly after v3.19.0:
 * "Unexpected Application Error! 'text/html' is not a valid JavaScript MIME
 * type" when navigating to a lazy route whose chunk no longer exists after a
 * deploy (a tab left open across it still holds the old index.html, which
 * references a hashed filename like CsvImport-<hash>.js that the new build
 * no longer produces — the SPA fallback then serves index.html, text/html,
 * for that request).
 *
 * Covers the router's `errorElement` (src/components/layout/
 * RouteErrorBoundary.tsx) rendering a friendly "Daybook was updated" message
 * with a Reload button instead of React Router's raw error screen. The
 * reload-once guard in src/lib/chunkReload.ts is pre-spent via
 * `sessionStorage` before navigating so this test observes the fallback UI
 * directly rather than racing the automatic reload src/main.tsx's
 * `vite:preloadError` listener would otherwise trigger first.
 *
 * Builds its own context with `serviceWorkers: 'block'` — public/sw.js caches
 * `/assets/*` cache-first and would otherwise serve the chunk from its own
 * network fetch inside the worker thread, which `page.route()` does not see,
 * silently defeating the interception below (confirmed: without this, the
 * route never fires and CsvImport loads normally).
 */

import { test, expect, type Browser } from '@playwright/test'
import { signUpOnPage } from './helpers'

test('a stale chunk request (text/html instead of JS) shows the friendly reload screen', async ({
  browser,
}: {
  browser: Browser
}) => {
  const context = await browser.newContext({ serviceWorkers: 'block' })
  const page = await context.newPage()
  await signUpOnPage(page)

  // Spend the reload guard up front so the automatic one-shot reload
  // (src/lib/chunkReload.ts) doesn't fire and mask the errorElement this
  // test asserts on — see the file header above.
  await page.addInitScript(() => {
    try {
      sessionStorage.setItem('daybook:chunk-reload-at', String(Date.now()))
    } catch {
      // Storage unavailable — the app's own guard degrades the same way.
    }
  })

  // Simulate the stale-tab-after-deploy case directly: answer the review
  // page's lazy chunk request with the SPA fallback's content type instead
  // of JS. (Built chunk naming confirmed via `npm run dev:worker`'s build
  // log: dist/assets/CsvImport-<hash>.js.)
  await page.route('**/assets/CsvImport-*.js', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<!doctype html><html><body>stale index.html</body></html>',
    }),
  )

  await page.goto('/wallet/import')

  await expect(page.getByText('Daybook was updated')).toBeVisible({ timeout: 10_000 })
  await expect(page.getByRole('button', { name: 'Reload' })).toBeVisible()
  await expect(page.getByText('Unexpected Application Error', { exact: false })).not.toBeVisible()

  await context.close()
})
