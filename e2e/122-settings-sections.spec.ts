/**
 * Module-based settings (one registry, three entry points): the Settings
 * page's own left nav, the profile menu's "Settings & privacy" pane, and
 * each module's sidebar settings link all read
 * `src/modules/settings/sections.ts` so they cannot drift apart. This spec
 * covers the registry end to end rather than any one section's own
 * behaviour (which keeps its original, narrower coverage elsewhere, e.g.
 * 52-change-password, 60-ai-bulk-categorize, 77-capture-tokens).
 */

import { test, expect } from '@playwright/test'
import type { Browser } from '@playwright/test'
import { newAppPage, signUpOnPage, waitForApp } from './helpers'

// Mirrors src/modules/settings/sections.ts's enabled entries. Trips is
// listed but disabled (no settings page yet), so it is deliberately absent.
// `level` matches each section's own page title: every section but Sharing
// (unchanged, still an h2) uses an h1 — and a couple of sections also
// nest an unrelated h3 with the exact same text (e.g. PushNotifications'
// own "Notifications" card heading), so the level disambiguates.
const ENABLED_SECTIONS: { path: string; label: string; level: 1 | 2 }[] = [
  { path: '/settings/profile', label: 'Profile & security', level: 1 },
  { path: '/settings/appearance', label: 'Appearance', level: 1 },
  { path: '/settings/notifications', label: 'Notifications', level: 1 },
  { path: '/settings/devices', label: 'Connected devices', level: 1 },
  { path: '/settings/ai', label: 'AI assistant', level: 1 },
  { path: '/settings/sharing', label: 'Sharing', level: 2 },
  { path: '/settings/day', label: 'Day', level: 1 },
  { path: '/settings/tasks', label: 'Tasks', level: 1 },
  { path: '/settings/wallet', label: 'Wallet', level: 1 },
]

test.describe('settings nav (desktop)', () => {
  test('every enabled registry section is reachable from the settings nav and renders its heading', async ({
    browser,
  }: { browser: Browser }) => {
    const page = await newAppPage(browser, '/settings')

    for (const section of ENABLED_SECTIONS) {
      await page.getByRole('navigation', { name: 'Settings sections' }).getByText(section.label, { exact: true }).click()
      await expect(page).toHaveURL(new RegExp(`${section.path}$`))
      await expect(page.getByRole('heading', { name: section.label, level: section.level })).toBeVisible()
    }
  })

  test('/settings on desktop shows the Profile section', async ({ browser }: { browser: Browser }) => {
    const page = await newAppPage(browser, '/settings')
    await expect(page.getByRole('heading', { name: 'Profile & security' })).toBeVisible()
  })

  test('Trips is listed but disabled, with a reason, and is not a link', async ({ browser }: { browser: Browser }) => {
    const page = await newAppPage(browser, '/settings')
    const nav = page.getByRole('navigation', { name: 'Settings sections' })
    await expect(nav.getByText('coming later')).toBeVisible()
    await expect(nav.getByRole('link', { name: /Trips/ })).toHaveCount(0)
  })

  test('Profile & security is active at /settings itself, with aria-current', async ({ browser }: { browser: Browser }) => {
    const page = await newAppPage(browser, '/settings')
    const nav = page.getByRole('navigation', { name: 'Settings sections' })
    await expect(nav.getByRole('link', { name: 'Profile & security' })).toHaveAttribute('aria-current', 'page')
  })
})

test.describe('notifications section', () => {
  test('/settings/notifications never renders blank — push-section or the not-configured card', async ({
    browser,
  }: { browser: Browser }) => {
    const page = await newAppPage(browser, '/settings/notifications')
    await expect(page.getByTestId('push-section').or(page.getByTestId('push-not-configured'))).toBeVisible()
  })
})

test.describe('day section', () => {
  test('unchecking Money in Settings → Day unchecks the Day sidebar toggle too', async ({
    browser,
  }: { browser: Browser }) => {
    const page = await newAppPage(browser, '/settings/day')
    await page.getByTestId('settings-day-show-money').uncheck()

    // Client-side navigation, not page.goto() — the toggle is session-only
    // Zustand state (day.store.ts, no server persistence), so a full
    // navigation would reload the bundle and lose it along with everything
    // else, which would prove nothing about the two controls sharing state.
    await page.locator('[data-testid="modtab-day"]:visible').click()
    await expect(page).toHaveURL(/\/day$/)
    await expect(page.getByTestId('day-toggle-money')).not.toBeChecked()
  })
})

test.describe('wallet section', () => {
  test('Import CSV opens the import modal on /wallet', async ({ browser }: { browser: Browser }) => {
    const page = await newAppPage(browser, '/settings/wallet')
    await page.getByTestId('wallet-settings-import-csv').click()
    await expect(page.getByRole('dialog').filter({ hasText: 'Import transactions' })).toBeVisible()
    await expect(page).toHaveURL(/\/wallet$/)
  })

  test('Merchant names lands on /wallet/canonicalize-merchants', async ({ browser }: { browser: Browser }) => {
    const page = await newAppPage(browser, '/settings/wallet')
    await page.getByRole('button', { name: 'Merchant names' }).click()
    await expect(page).toHaveURL(/\/wallet\/canonicalize-merchants$/)
  })
})

test.describe('tasks section', () => {
  test('links to Settings → Notifications', async ({ browser }: { browser: Browser }) => {
    const page = await newAppPage(browser, '/settings/tasks')
    await page.getByTestId('tasks-settings-notifications-link').click()
    await expect(page).toHaveURL(/\/settings\/notifications$/)
  })
})

test.describe('profile menu entry point', () => {
  test('Settings & privacy → Wallet lands on /settings/wallet and shows Manage categories', async ({
    browser,
  }: { browser: Browser }) => {
    const page = await newAppPage(browser, '/wallet')

    await page.getByTestId('account-menu-button').click()
    await page.getByTestId('account-menu-settings').click()
    await page.getByTestId('account-menu-settings-wallet').click()

    await expect(page).toHaveURL(/\/settings\/wallet$/)
    await expect(page.getByTestId('manage-categories')).toBeVisible()
  })
})

test.describe('module sidebar entry point', () => {
  test('on /wallet the sidebar settings link reads "Wallet settings" and goes to /settings/wallet', async ({
    browser,
  }: { browser: Browser }) => {
    const page = await newAppPage(browser, '/wallet')
    const link = page.getByTestId('nav-settings')
    await expect(link).toContainText('Wallet settings')
    await link.click()
    await expect(page).toHaveURL(/\/settings\/wallet$/)
  })

  test('on /tasks the sidebar settings link reads "Tasks settings" and goes to /settings/tasks', async ({
    browser,
  }: { browser: Browser }) => {
    const page = await newAppPage(browser, '/tasks')
    const link = page.getByTestId('nav-settings')
    await expect(link).toContainText('Tasks settings')
    await link.click()
    await expect(page).toHaveURL(/\/settings\/tasks$/)
  })
})

test.describe('settings nav (mobile, 375x812)', () => {
  test('shows the index list, drills into a section, and back returns to the index with no overflow', async ({
    browser,
  }: { browser: Browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } })
    const page = await ctx.newPage()
    await signUpOnPage(page)
    await page.goto('/settings')
    await waitForApp(page)

    // Index list only — the Profile section's own content stays off-screen.
    const indexList = page.getByTestId('settings-index-list')
    await expect(indexList.getByText('Notifications', { exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Profile & security' })).not.toBeVisible()

    let scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth)
    let clientWidth = await page.evaluate(() => document.documentElement.clientWidth)
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1)

    await indexList.getByText('Notifications', { exact: true }).click()
    await expect(page).toHaveURL(/\/settings\/notifications$/)
    // level: 1 — PushNotifications' own card also has an h3 "Notifications".
    await expect(page.getByRole('heading', { name: 'Notifications', level: 1 })).toBeVisible()

    scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth)
    clientWidth = await page.evaluate(() => document.documentElement.clientWidth)
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1)

    await page.getByRole('link', { name: 'Back to settings' }).click()
    await expect(page).toHaveURL(/\/settings$/)
    await expect(page.getByTestId('settings-index-list').getByText('Notifications', { exact: true })).toBeVisible()

    await ctx.close()
  })
})
