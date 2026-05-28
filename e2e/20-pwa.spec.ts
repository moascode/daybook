/**
 * App: PWA — Tier 3 feature.
 * Verifies web app manifest is linked, manifest fields are valid,
 * and a service worker is registered.
 *
 * ALL TESTS IN THIS FILE ARE EXPECTED TO FAIL until the feature is implemented.
 */

import { test, expect } from '@playwright/test'
import type { Browser, Page } from '@playwright/test'
import { newAppPage } from './helpers'

test.skip(true, 'Tier 3 — not yet implemented')

test.describe.configure({ mode: 'serial' })

let page: Page

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  page = await newAppPage(browser, '/')
})

test.afterAll(async () => {
  await page.context().close()
})

// ── Manifest link in <head> ────────────────────────────────────────────

test('HTML <head> has a <link rel="manifest"> element', async () => {
  const manifestLink = await page.$('link[rel="manifest"]')
  expect(manifestLink).not.toBeNull()
})

// ── manifest.json content ──────────────────────────────────────────────

test('manifest.json is served with HTTP 200', async () => {
  const response = await page.request.get('/manifest.json')
  expect(response.status()).toBe(200)
})

test('manifest.json contains required PWA fields: name, short_name, icons, start_url, display', async () => {
  const response = await page.request.get('/manifest.json')
  const manifest = await response.json() as Record<string, unknown>
  expect(manifest).toHaveProperty('name')
  expect(manifest).toHaveProperty('short_name')
  expect(manifest).toHaveProperty('icons')
  expect(manifest).toHaveProperty('start_url')
  expect(manifest).toHaveProperty('display')
})

test('manifest name is "Daybook"', async () => {
  const response = await page.request.get('/manifest.json')
  const manifest = await response.json() as { name: string }
  expect(manifest.name).toBe('Daybook')
})

test('manifest display mode is "standalone" or "minimal-ui"', async () => {
  const response = await page.request.get('/manifest.json')
  const manifest = await response.json() as { display: string }
  expect(['standalone', 'minimal-ui']).toContain(manifest.display)
})

// ── Service worker ─────────────────────────────────────────────────────

test('service worker is registered in the browser', async () => {
  const hasSW = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return false
    const registrations = await navigator.serviceWorker.getRegistrations()
    return registrations.length > 0
  })
  expect(hasSW).toBe(true)
})

// ── Meta theme-color ───────────────────────────────────────────────────

test('HTML <head> has a <meta name="theme-color"> element', async () => {
  const themeColor = await page.$('meta[name="theme-color"]')
  expect(themeColor).not.toBeNull()
})

// ── Apple mobile meta ──────────────────────────────────────────────────

test('HTML <head> has <meta name="apple-mobile-web-app-capable"> for iOS install', async () => {
  const appleMeta = await page.$('meta[name="apple-mobile-web-app-capable"]')
  expect(appleMeta).not.toBeNull()
})
