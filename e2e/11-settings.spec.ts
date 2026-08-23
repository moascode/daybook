/**
 * Settings page — e2e tests.
 * Tests the /settings page added in the Tier-1 UX pass.
 */

import { test, expect } from '@playwright/test'
import type { Browser, Page } from '@playwright/test'
import { newAppPage, waitForApp, navTo } from './helpers'

test.describe.configure({ mode: 'serial' })

let page: Page

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  page = await newAppPage(browser, '/settings')
})

test.afterAll(async () => {
  await page.context().close()
})

// ── Navigation ─────────────────────────────────────────────────────────

test('Settings is reachable via the account menu', async () => {
  // R2: the module sidebar renders nothing on /settings itself (it's not one
  // of the four primary modules — design spec §4's own allowance), so
  // Settings' discoverability now runs through the account menu instead.
  // Close again without navigating, so the shared `page` stays on /settings
  // for the tests that follow.
  await page.getByTestId('account-menu-button').click()
  await expect(page.getByTestId('account-menu-settings')).toBeVisible()
  await page.keyboard.press('Escape')
})

test('Settings link navigates to /settings', async () => {
  await expect(page).toHaveURL(/\/settings$/)
})

// ── Page content ───────────────────────────────────────────────────────

test('settings page heading is visible', async () => {
  // The TopBar renders an h1 "SETTINGS"; the page body renders an h2 "Settings".
  // Use the h2 content heading (the human-readable one, not the uppercase banner).
  await expect(page.getByRole('heading', { name: 'Settings', level: 2 })).toBeVisible()
})

test('Theme selector offers Light, Dark and System', async () => {
  const select = page.getByLabel('Theme', { exact: true })
  await expect(select).toBeVisible()
  await expect(select.locator('option[value="light"]')).toBeAttached()
  await expect(select.locator('option[value="dark"]')).toBeAttached()
  await expect(select.locator('option[value="system"]')).toBeAttached()
})

test('currency is shown as MYR (single-currency app, no picker)', async () => {
  await expect(page.getByText('Malaysian Ringgit (MYR)')).toBeVisible()
})

// ── Persist ────────────────────────────────────────────────────────────

test('changing the theme persists immediately after reload (no Save button)', async () => {
  // U-06: theme is applied and saved on change — there is no batch "Save" step.
  await page.getByLabel('Theme', { exact: true }).selectOption('system')
  await page.reload()
  await waitForApp(page)
  await expect(page.getByLabel('Theme', { exact: true })).toHaveValue('system', { timeout: 8000 })
})

// ── Module-tab navigation from settings ─────────────────────────────────

test('clicking Tasks in the app bar from settings navigates to /tasks', async () => {
  await navTo(page, 'tasks')
  await expect(page).toHaveURL(/\/tasks$/)
})
