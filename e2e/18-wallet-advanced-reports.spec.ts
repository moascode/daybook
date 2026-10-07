/**
 * Wallet: Reports navigation.
 *
 * The Year-on-year comparison and custom-date-range cards this file used to
 * cover were dropped by FEAT-070 (EP-06) — the mock's 3m/6m/12m/All segment
 * and Export replace them, and Transactions already has its own date filter.
 * The replacement coverage (stat cards, income-vs-spending, savings rate,
 * what changed, cash flow, category trends, Export) lives in
 * e2e/104-reports-design-adoption.spec.ts. This file keeps only the
 * navigation checks that never depended on the old cards.
 */

import { test, expect } from '@playwright/test'
import type { Browser, Page } from '@playwright/test'
import { newAppPage, navItem } from './helpers'

test.describe.configure({ mode: 'serial' })

let page: Page

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  page = await newAppPage(browser, '/wallet/dashboard')
})

test.afterAll(async () => {
  await page.context().close()
})

// ── Navigation to reports ──────────────────────────────────────────────

test('wallet navigation or dashboard has a "Reports" link/button', async () => {
  await page.goto('/wallet/dashboard')
  await expect(
    navItem(page, 'reports'),
  ).toBeVisible()
})

test('navigating to /wallet/reports shows the Reports page', async () => {
  await page.goto('/wallet/reports')
  await expect(page).toHaveURL(/\/wallet\/reports$/)
  await expect(page.locator('main').getByRole('heading', { name: /Reports/i })).toBeVisible()
})
