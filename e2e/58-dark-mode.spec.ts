/**
 * Dark mode — e2e tests.
 *
 * Covers the three things that can silently break: the `dark` class actually
 * reaching <html>, the preference surviving a reload (including BEFORE the
 * app has authenticated, which is what the pre-paint script in index.html is
 * for), and the semantic tokens genuinely resolving to different colours in
 * each theme rather than falling back to a Tailwind default.
 */

import { test, expect } from '@playwright/test'
import type { Browser, Page } from '@playwright/test'
import { newAppPage, waitForApp } from './helpers'

test.describe.configure({ mode: 'serial' })

let page: Page

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  page = await newAppPage(browser, '/settings')
})

test.afterAll(async () => {
  await page.context().close()
})

const htmlIsDark = (p: Page) =>
  p.evaluate(() => document.documentElement.classList.contains('dark'))

// D-2: the resolved theme is carried by TWO markers set together — the `dark`
// class (Tailwind darkMode:'class') and the data-theme attribute (the ported
// proposal CSS's [data-theme] selectors). If they ever drift, half the app
// themes and half does not, so assert both.
const htmlDataTheme = (p: Page) =>
  p.evaluate(() => document.documentElement.dataset.theme)

const bodyBackground = (p: Page) =>
  p.evaluate(() => getComputedStyle(document.body).backgroundColor)

// ── The toggle ─────────────────────────────────────────────────────────

test('app starts in light mode by default', async () => {
  expect(await htmlIsDark(page)).toBe(false)
  expect(await htmlDataTheme(page)).toBe('light')
})

// R2: the standalone top-bar theme toggle is gone — light/dark switching now
// happens only through the Settings page's Theme select (SettingsPage.tsx),
// which was always the second, independent path CLAUDE.md §18 rule 4 already
// documents ("shared by the Settings select and the TopBar toggle"). This
// test replaces the removed toggle-click test and keeps the same coverage
// (both D-2 markers move together, the token layer actually repaints) — and
// leaves the page in dark mode for the reload/pre-boot tests below, same as
// the toggle click used to.
test('choosing Dark from Settings switches to dark', async () => {
  const lightBackground = await bodyBackground(page)

  await page.getByLabel('Theme', { exact: true }).selectOption('dark')

  await expect.poll(() => htmlIsDark(page)).toBe(true)
  // Both markers move together (D-2), not just the class.
  await expect.poll(() => htmlDataTheme(page)).toBe('dark')
  // The token layer must actually repaint, not just add a class.
  expect(await bodyBackground(page)).not.toBe(lightBackground)
})

// ── Persistence ────────────────────────────────────────────────────────

test('dark mode survives a reload', async () => {
  await page.reload()
  await waitForApp(page)
  expect(await htmlIsDark(page)).toBe(true)
  await expect(page.getByLabel('Theme', { exact: true })).toHaveValue('dark', { timeout: 8000 })
})

test('dark mode is applied before the app boots, with no white flash', async () => {
  // The preference lives on the server and is not readable until after login,
  // so index.html replays a localStorage mirror pre-paint.
  //
  // Block the bundle so React cannot run: anything still theming the page is
  // necessarily the inline script. Asserting after hydration instead would
  // pass on the store's localStorage seed alone, which happens a frame too
  // late — after the white paint this test exists to prevent.
  const fresh = await page.context().newPage()
  await fresh.route('**/*.js', (route) => route.abort())
  await fresh.goto('/settings', { waitUntil: 'domcontentloaded' })

  expect(await htmlIsDark(fresh)).toBe(true)
  // Both markers must be set pre-paint by the inline script, not just the class.
  expect(await htmlDataTheme(fresh)).toBe('dark')
  // The <html> class is only half of it — the canvas token must resolve dark.
  // v2 dark canvas is --n-1000 (rgb(9, 11, 15)); the pre-v2 value was 13,17,23.
  expect(await bodyBackground(fresh)).toBe('rgb(9, 11, 15)')
  await fresh.close()
})

// ── Settings select ────────────────────────────────────────────────────

test('choosing Light from Settings leaves dark mode', async () => {
  await page.getByLabel('Theme', { exact: true }).selectOption('light')
  await expect.poll(() => htmlIsDark(page)).toBe(false)
})

test('System follows the OS preference', async () => {
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.getByLabel('Theme', { exact: true }).selectOption('system')
  await expect.poll(() => htmlIsDark(page)).toBe(true)

  // ...and tracks it changing while still set to System.
  await page.emulateMedia({ colorScheme: 'light' })
  await expect.poll(() => htmlIsDark(page)).toBe(false)

  await page.emulateMedia({ colorScheme: null })
  await page.getByLabel('Theme', { exact: true }).selectOption('light')
  await expect.poll(() => htmlIsDark(page)).toBe(false)
})
