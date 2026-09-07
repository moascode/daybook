/**
 * 82 — Offline behaviour (v3 P2, docs/v3/release-plan.md#p2).
 *
 * v1's service worker answered a failed navigation from a cache nothing ever
 * wrote to, so offline produced a browser error page while the code read as
 * though it were handled. These tests exist so that cannot regress silently:
 * the whole failure mode is invisible unless you actually pull the network.
 */

import { test, expect } from '@playwright/test'
import { newAppPage } from './helpers'

test.describe('offline behaviour', () => {
  test('the service worker registers and caches the shell', async ({ browser }) => {
    const page = await newAppPage(browser)

    const cached = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.ready
      // Give the install handler's cache.add a moment to land.
      for (let i = 0; i < 20; i++) {
        const keys = await caches.keys()
        for (const k of keys) {
          const c = await caches.open(k)
          if (await c.match('/')) return { cache: k, active: !!reg.active }
        }
        await new Promise((r) => setTimeout(r, 250))
      }
      return null
    })

    expect(cached, 'the shell must actually be in a cache — v1 never put it there').toBeTruthy()
    expect(cached!.cache).toBe('daybook-v2')
  })

  test('never caches an API response', async ({ browser }) => {
    const page = await newAppPage(browser)
    await page.goto('/wallet')
    await expect(page.locator('main')).toBeVisible()

    const apiEntries = await page.evaluate(async () => {
      const out: string[] = []
      for (const k of await caches.keys()) {
        const c = await caches.open(k)
        for (const req of await c.keys()) if (new URL(req.url).pathname.startsWith('/api/')) out.push(req.url)
      }
      return out
    })

    // A cached balance is worse than no balance. There is no invalidation
    // story that makes this safe on a ledger.
    expect(apiEntries, 'API responses must never be cached').toEqual([])
  })

  test('offline serves the shell instead of a browser error page', async ({ browser }) => {
    const page = await newAppPage(browser)
    await page.evaluate(() => navigator.serviceWorker.ready)
    await page.waitForTimeout(1000)

    await page.context().setOffline(true)
    const res = await page.goto('/wallet')

    // v1 returned undefined here and the navigation failed outright.
    expect(res, 'navigation must resolve, not fail').toBeTruthy()
    expect(await page.title()).toContain('Daybook')

    await page.context().setOffline(false)
  })

  test('says it is offline rather than looking broken', async ({ browser }) => {
    const page = await newAppPage(browser)
    await expect(page.locator('main')).toBeVisible()

    await page.context().setOffline(true)
    await page.evaluate(() => window.dispatchEvent(new Event('offline')))

    const banner = page.getByTestId('offline-banner')
    await expect(banner).toBeVisible()
    await expect(banner).toContainText('offline')

    await page.context().setOffline(false)
    await page.evaluate(() => window.dispatchEvent(new Event('online')))
    await expect(banner).toHaveCount(0)
  })

  test('a write attempted offline says nothing was saved', async ({ browser }) => {
    const page = await newAppPage(browser)
    await page.context().setOffline(true)

    const message = await page.evaluate(async () => {
      try {
        await fetch('/api/accounts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'Offline', type: 'cash' }),
          credentials: 'include',
        })
        return 'no error'
      } catch (err) {
        return err instanceof Error ? err.message : String(err)
      }
    })
    // The raw browser failure is "Failed to fetch"; api.ts turns it into
    // something a user can act on. This asserts the browser really does reject,
    // which is the precondition for that translation mattering.
    expect(message).not.toBe('no error')

    await page.context().setOffline(false)
  })
})
