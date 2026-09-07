/**
 * 81 — PWA install surface (v3 P1, docs/v3/release-plan.md#p1).
 *
 * None of this had coverage before: nothing asserted that the manifest is
 * served, that the icons exist, or that iOS has an icon it can actually use.
 * The failure mode is silent and only visible on a phone home screen, which is
 * exactly the kind of thing that rots without a test.
 */

import { test, expect } from '@playwright/test'
import { newAppPage } from './helpers'

test.describe('PWA install surface', () => {
  test('serves a manifest with real PNG icons', async ({ page }) => {
    const res = await page.request.get('/manifest.json')
    expect(res.status()).toBe(200)
    expect(res.headers()['content-type']).toContain('json')

    const m = await res.json()
    expect(m.display).toBe('standalone')
    expect(m.start_url).toBe('/')

    // iOS cannot use an SVG home-screen icon, so a PNG has to be present.
    const pngs = m.icons.filter((i: { type: string }) => i.type === 'image/png')
    expect(pngs.length).toBeGreaterThan(0)
    expect(m.icons.some((i: { purpose?: string }) => i.purpose === 'maskable')).toBeTruthy()
  })

  test('every icon the manifest names actually resolves', async ({ page }) => {
    const m = await (await page.request.get('/manifest.json')).json()
    for (const icon of m.icons as { src: string; type: string }[]) {
      const res = await page.request.get(icon.src)
      expect(res.status(), `${icon.src} must be served`).toBe(200)
      expect(res.headers()['content-type'], icon.src).toContain(
        icon.type === 'image/png' ? 'png' : 'svg',
      )
    }
  })

  test('declares an apple-touch-icon, and it is a PNG', async ({ page }) => {
    await page.goto('/')
    const href = await page.locator('link[rel="apple-touch-icon"]').getAttribute('href')
    expect(href, 'without this iOS uses a screenshot of the page').toBeTruthy()

    const res = await page.request.get(href!)
    expect(res.status()).toBe(200)
    expect(res.headers()['content-type']).toContain('png')
  })

  test('the manifest and the pre-paint script agree on the brand colour', async ({ page }) => {
    await page.goto('/')
    const meta = await page.locator('meta[name="theme-color"]').getAttribute('content')
    const m = await (await page.request.get('/manifest.json')).json()
    // They drifted once (#1D9E75 vs #10a37a) and nothing caught it.
    expect(m.theme_color.toLowerCase()).toBe(meta!.toLowerCase())
  })

  test('opts into the safe area so a notch does not clip the shell', async ({ page }) => {
    await page.goto('/')
    const viewport = await page.locator('meta[name="viewport"]').getAttribute('content')
    expect(viewport).toContain('viewport-fit=cover')
  })

  test('form fields are at least 16px on a touch device, so iOS cannot zoom', async ({ browser }) => {
    // A focused field under 16px makes iOS Safari zoom the viewport and never
    // zoom back. Emulated here by the coarse-pointer media query the rule keys
    // off, since Playwright's chromium reports a fine pointer by default.
    const context = await browser.newContext({
      hasTouch: true,
      viewport: { width: 390, height: 844 },
    })
    const page = await context.newPage()
    await page.request.post('/api/auth/signup', {
      data: { username: `e2e_pwa_${Date.now()}`, password: 'test-password' },
    })
    await page.goto('/settings')
    await expect(page.locator('main')).toBeVisible({ timeout: 20_000 })

    const input = page.getByTestId('capture-token-label')
    await expect(input).toBeVisible()
    const size = await input.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))
    expect(size, 'anything under 16px triggers the iOS zoom').toBeGreaterThanOrEqual(16)

    await context.close()
  })
})
