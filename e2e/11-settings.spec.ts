/**
 * Settings page — e2e tests.
 * Tests the /settings tree. Module-based settings (one registry, three entry
 * points) split the old single page into per-section routes — see
 * e2e/122-settings-sections.spec.ts for the registry-wide coverage. This
 * file keeps the original, narrower checks against their new homes.
 */

import { test, expect } from '@playwright/test'
import type { Browser, Page } from '@playwright/test'
import { newAppPage, waitForApp, navTo } from './helpers'

test.describe.configure({ mode: 'serial' })

let page: Page

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  page = await newAppPage(browser, '/settings/appearance')
})

test.afterAll(async () => {
  await page.context().close()
})

// ── Navigation ─────────────────────────────────────────────────────────

test('Settings is reachable via the account menu', async () => {
  // R2: the module sidebar renders nothing on /settings itself (it's not one
  // of the four primary modules — design spec §4's own allowance), so
  // Settings' discoverability now runs through the account menu instead.
  await page.getByTestId('account-menu-button').click()
  await expect(page.getByTestId('account-menu-settings')).toBeVisible()
  await page.keyboard.press('Escape')
})

test('the account menu actually navigates to /settings/profile', async () => {
  // Prove the real path works (not just that the shared `page` already
  // happens to be there from beforeAll): leave, then come back via
  // Settings & privacy → Profile & security.
  await page.goto('/tasks')
  await waitForApp(page)
  await page.getByTestId('account-menu-button').click()
  await page.getByTestId('account-menu-settings').click()
  await page.getByRole('button', { name: 'Profile & security' }).click()
  await expect(page).toHaveURL(/\/settings\/profile$/)
  await page.goto('/settings/appearance')
  await waitForApp(page)
})

// ── Page content ───────────────────────────────────────────────────────

test('appearance section heading is visible', async () => {
  await expect(page.getByRole('heading', { name: 'Appearance', level: 1 })).toBeVisible()
})

test('Theme selector offers Light, Dark and System', async () => {
  const select = page.getByLabel('Theme', { exact: true })
  await expect(select).toBeVisible()
  await expect(select.locator('option[value="light"]')).toBeAttached()
  await expect(select.locator('option[value="dark"]')).toBeAttached()
  await expect(select.locator('option[value="system"]')).toBeAttached()
})

test('currency is shown as MYR on the Wallet section (single-currency app, no picker)', async () => {
  await page.goto('/settings/wallet')
  await waitForApp(page)
  await expect(page.getByText('Malaysian Ringgit (MYR)')).toBeVisible()
  await page.goto('/settings/appearance')
  await waitForApp(page)
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
