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

test('Anthropic API Key input is present', async () => {
  await expect(page.getByLabel('Anthropic API Key')).toBeVisible()
})

test('API key field is password type by default (obscured)', async () => {
  const input = page.getByLabel('Anthropic API Key')
  await expect(input).toHaveAttribute('type', 'password')
})

test('show/hide toggle reveals the API key value', async () => {
  const input = page.getByLabel('Anthropic API Key')
  // Find the show/hide button near the input
  const toggleBtn = page.getByRole('button', { name: 'Show API key' })
  await toggleBtn.click()
  await expect(input).toHaveAttribute('type', 'text')
  // Hide again
  await page.getByRole('button', { name: 'Hide API key' }).click()
  await expect(input).toHaveAttribute('type', 'password')
})

test('Theme selector is present with Light / Dark / System options', async () => {
  const select = page.getByLabel('Theme')
  await expect(select).toBeVisible()
  await expect(select.locator('option[value="light"]')).toBeAttached()
  await expect(select.locator('option[value="dark"]')).toBeAttached()
  await expect(select.locator('option[value="system"]')).toBeAttached()
})

test('Default Currency selector is present', async () => {
  await expect(page.getByLabel('Default Currency')).toBeVisible()
})

// ── Save and persist ───────────────────────────────────────────────────

test('entering an API key and saving shows a success toast', async () => {
  await page.getByLabel('Anthropic API Key').fill('sk-ant-test-key-e2e')
  await page.getByRole('button', { name: 'Save changes' }).click()

  const toast = page.getByTestId('toast')
  await expect(toast).toBeVisible()
  await expect(toast).toContainText('Settings saved')
})

test('after page reload the API key value is still in the field', async () => {
  await page.reload()
  await waitForApp(page)
  // Wait for the DB query to populate the field
  await expect(page.getByLabel('Anthropic API Key')).toHaveValue('sk-ant-test-key-e2e', {
    timeout: 8000,
  })
})

test('changing the currency and saving persists after reload', async () => {
  await page.getByLabel('Default Currency').selectOption('SGD')
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByTestId('toast')).toContainText('Settings saved')

  await page.reload()
  await waitForApp(page)
  await expect(page.getByLabel('Default Currency')).toHaveValue('SGD', { timeout: 8000 })
})

// ── Sidebar navigation from settings ──────────────────────────────────

test('clicking Tasks in sidebar from settings navigates to /tasks', async () => {
  await page.getByRole('link', { name: 'Tasks' }).click()
  await expect(page).toHaveURL(/\/tasks$/)
})
