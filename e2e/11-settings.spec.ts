/**
 * Settings page — e2e tests.
 * Tests the /settings page added in the Tier-1 UX pass.
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

// ── Navigation ─────────────────────────────────────────────────────────

test('Settings link is visible in the sidebar', async () => {
  await expect(page.getByRole('link', { name: 'Settings' })).toBeVisible()
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

test('Theme selector offers Light and System (dark theme not yet shipped)', async () => {
  const select = page.getByLabel('Theme')
  await expect(select).toBeVisible()
  await expect(select.locator('option[value="light"]')).toBeAttached()
  await expect(select.locator('option[value="system"]')).toBeAttached()
})

test('currency is shown as MYR (single-currency app, no picker)', async () => {
  await expect(page.getByText('Malaysian Ringgit (MYR)')).toBeVisible()
})

// ── Persist ────────────────────────────────────────────────────────────

test('changing the theme persists immediately after reload (no Save button)', async () => {
  // U-06: theme is applied and saved on change — there is no batch "Save" step.
  await page.getByLabel('Theme').selectOption('system')
  await page.reload()
  await waitForApp(page)
  await expect(page.getByLabel('Theme')).toHaveValue('system', { timeout: 8000 })
})

// ── Sidebar navigation from settings ──────────────────────────────────

test('clicking Tasks in sidebar from settings navigates to /tasks', async () => {
  await page.getByRole('link', { name: 'Tasks' }).click()
  await expect(page).toHaveURL(/\/tasks$/)
})
