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

// AppShell renders both bars and hides one with `md:` classes, so the toggle is
// in the DOM twice. Match the one actually on screen for this viewport.
const themeToggle = (p: Page) => p.getByTestId('theme-toggle').locator('visible=true')

const htmlIsDark = (p: Page) =>
  p.evaluate(() => document.documentElement.classList.contains('dark'))

const bodyBackground = (p: Page) =>
  p.evaluate(() => getComputedStyle(document.body).backgroundColor)

// ── The toggle ─────────────────────────────────────────────────────────

test('app starts in light mode by default', async () => {
  expect(await htmlIsDark(page)).toBe(false)
})

test('the top-bar toggle switches to dark', async () => {
  const lightBackground = await bodyBackground(page)

  await themeToggle(page).click()

  await expect.poll(() => htmlIsDark(page)).toBe(true)
  // The token layer must actually repaint, not just add a class.
  expect(await bodyBackground(page)).not.toBe(lightBackground)
})

test('the toggle reflects the current theme and switches back', async () => {
  await expect(themeToggle(page)).toHaveAttribute(
    'aria-label',
    'Switch to light theme',
  )
  await themeToggle(page).click()
  await expect.poll(() => htmlIsDark(page)).toBe(false)
  await expect(themeToggle(page)).toHaveAttribute(
    'aria-label',
    'Switch to dark theme',
  )
})

// ── Persistence ────────────────────────────────────────────────────────

test('the toggle writes through to the Settings select', async () => {
  await themeToggle(page).click()
  await expect(page.getByLabel('Theme', { exact: true })).toHaveValue('dark')
})

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
  // The <html> class is only half of it — the canvas token must resolve dark.
  expect(await bodyBackground(fresh)).toBe('rgb(13, 17, 23)')
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
