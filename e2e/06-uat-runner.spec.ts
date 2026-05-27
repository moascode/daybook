/**
 * UAT Runner — verifies that the in-browser test suite at /uat passes 100%.
 *
 * This test opens the app's own UAT page, clicks "Run All Tests", waits for
 * completion, then asserts that every test passed and none failed.
 */

import { test, expect, type Browser, type Page } from '@playwright/test'
import { newAppPage } from './helpers'

test.describe.configure({ mode: 'serial' })

let page: Page

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  page = await newAppPage(browser, '/uat')
})

test.afterAll(async () => {
  await page.context().close()
})

// ── Navigate ────────────────────────────────────────────────────────────

test('UAT page loads at /uat', async () => {
  await expect(page).toHaveURL(/\/uat$/)
  await expect(page.getByText('UAT Test Runner')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Run All Tests' })).toBeVisible()
})

test('shows test suites in pending state before run', async () => {
  await expect(page.getByText('Tasks › Core CRUD')).toBeVisible()
  await expect(page.getByText('Wallet › Accounts')).toBeVisible()
  await expect(page.getByText('Wallet › Transactions')).toBeVisible()
  await expect(page.getByText('Wallet › Balance')).toBeVisible()
  await expect(page.getByText('Wallet › CSV Import')).toBeVisible()
  await expect(page.getByText('Wallet › Filters')).toBeVisible()
})

test('summary shows the total test count before run', async () => {
  const totalEl = page.locator('div').filter({ hasText: /^\d+$/ }).first()
  // At least 30 tests are defined in the UAT suite
  const totalText = await page.locator('p.text-xl.font-bold').first().textContent()
  expect(parseInt(totalText ?? '0')).toBeGreaterThanOrEqual(30)
})

// ── Run all tests ────────────────────────────────────────────────────────

test('click "Run All Tests" starts the runner', async () => {
  await page.getByRole('button', { name: 'Run All Tests' }).click()
  // Button changes to "Running…" while tests are executing
  await expect(page.getByRole('button', { name: 'Running…' })).toBeVisible()
})

test('all tests complete — runner shows no "Running…" state', async () => {
  // Wait up to 120s for the suite to finish (PGlite tests are fast but there are many)
  await expect(page.getByRole('button', { name: 'Run All Tests' })).toBeVisible({ timeout: 120_000 })
})

// ── Results validation ───────────────────────────────────────────────────

test('shows "All N tests passed!" banner with 0 failures', async () => {
  await expect(page.getByText(/All \d+ tests passed!/)).toBeVisible()
})

test('failed count is zero', async () => {
  // The red "Failed" counter should be 0
  const failCountEls = page.locator('p.text-xl.font-bold.text-red-500')
  const failText = await failCountEls.first().textContent()
  expect(parseInt(failText ?? '1')).toBe(0)
})

test('passed count matches total count', async () => {
  const totals = await page.locator('p.text-xl.font-bold').allTextContents()
  const nums = totals.map((t) => parseInt(t.trim())).filter((n) => !isNaN(n))
  // nums[0] = total, nums[1] = passed, nums[2] = failed, nums[3] = pending
  // Total should equal passed
  expect(nums[0]).toBe(nums[1])
  expect(nums[0]).toBeGreaterThanOrEqual(30)
})

test('every suite shows green pass badge (n/n)', async () => {
  // All suite badges should be green (all tests in each suite passed)
  const failBadges = page.locator('span.rounded-full.bg-red-100')
  await expect(failBadges).toHaveCount(0)
})

test('no individual test shows a red failure block', async () => {
  // Fail errors render as <p class="text-xs text-red-600 font-mono ...">
  const errorBlocks = page.locator('p.text-xs.text-red-600.font-mono')
  await expect(errorBlocks).toHaveCount(0)
})

// ── Re-run is idempotent ─────────────────────────────────────────────────

test('re-running the suite produces the same all-pass result', async () => {
  await page.getByRole('button', { name: 'Run All Tests' }).click()
  await expect(page.getByRole('button', { name: 'Run All Tests' })).toBeVisible({ timeout: 120_000 })
  await expect(page.getByText(/All \d+ tests passed!/)).toBeVisible()
})
