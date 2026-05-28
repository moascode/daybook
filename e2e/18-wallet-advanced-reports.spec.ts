/**
 * Wallet: advanced reports — Tier 3 feature.
 * Year-on-year spend comparison and fully custom date ranges.
 *
 * ALL TESTS IN THIS FILE ARE EXPECTED TO FAIL until the feature is implemented.
 */

import { test, expect } from '@playwright/test'
import type { Browser, Page } from '@playwright/test'
import { newAppPage, fillAccountForm, fillTransactionForm } from './helpers'

test.describe.configure({ mode: 'serial' })

let page: Page

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  page = await newAppPage(browser, '/wallet/accounts')
  // Create account and seed two transactions in different months for report data
  await page.getByRole('button', { name: 'Add Account' }).first().click()
  await fillAccountForm(page, { name: 'Reports Account', type: 'bank' })

  await page.goto('/wallet')
  await page.getByRole('button', { name: 'Add Transaction' }).click()
  await fillTransactionForm(page, {
    type: 'Expense',
    amount: '300',
    account: 'Reports Account',
    merchant: 'Jan Expense',
    date: '2026-01-15',
  })

  await page.getByRole('button', { name: 'Add Transaction' }).click()
  await fillTransactionForm(page, {
    type: 'Expense',
    amount: '450',
    account: 'Reports Account',
    merchant: 'Mar Expense',
    date: '2026-03-20',
  })
})

test.afterAll(async () => {
  await page.context().close()
})

// ── Navigation to reports ──────────────────────────────────────────────

test('wallet navigation or dashboard has a "Reports" link/button', async () => {
  await page.goto('/wallet/dashboard')
  await expect(
    page.getByRole('link', { name: /Reports/i }).or(page.getByRole('button', { name: /Reports/i })),
  ).toBeVisible()
})

test('navigating to /wallet/reports shows the Reports page', async () => {
  await page.goto('/wallet/reports')
  await expect(page).toHaveURL(/\/wallet\/reports$/)
  await expect(page.getByRole('heading', { name: /Reports/i })).toBeVisible()
})

// ── Year-on-year comparison ────────────────────────────────────────────

test('reports page has a year-on-year comparison section', async () => {
  await expect(page.getByText(/Year.on.year|Year over year|YoY/i)).toBeVisible()
})

test('year-on-year section contains a chart element', async () => {
  await expect(page.getByTestId('yoy-chart')).toBeVisible()
})

test('year-on-year section shows two year labels', async () => {
  const yoySection = page.getByTestId('yoy-chart')
  // Should show at least one calendar year label
  await expect(yoySection.getByText(/20\d\d/)).toHaveCount({ minimum: 1 })
})

// ── Custom date range ──────────────────────────────────────────────────

test('custom date range selector is present on the reports page', async () => {
  await expect(page.getByTestId('custom-date-range')).toBeVisible()
})

test('custom date range has From and To date inputs', async () => {
  const picker = page.getByTestId('custom-date-range')
  await expect(picker.getByLabel(/From|Start/i)).toBeVisible()
  await expect(picker.getByLabel(/To|End/i)).toBeVisible()
})

test('applying a custom date range updates the report to show that period', async () => {
  const picker = page.getByTestId('custom-date-range')
  await picker.getByLabel(/From|Start/i).fill('2026-01-01')
  await picker.getByLabel(/To|End/i).fill('2026-01-31')
  await page.getByRole('button', { name: /Apply|Update/i }).click()
  // Report should now reflect January data only
  await expect(page.getByText(/Jan 2026|January 2026/i)).toBeVisible()
})

test('custom range report shows only transactions within the selected window', async () => {
  // Jan expense (300) should appear; Mar expense (450) should not
  await expect(page.getByText(/300|RM 300/)).toBeVisible()
  await expect(page.getByText(/450|RM 450/)).not.toBeVisible()
})

test('changing date range to Q1 shows both transactions', async () => {
  const picker = page.getByTestId('custom-date-range')
  await picker.getByLabel(/From|Start/i).fill('2026-01-01')
  await picker.getByLabel(/To|End/i).fill('2026-03-31')
  await page.getByRole('button', { name: /Apply|Update/i }).click()
  await expect(page.getByText(/300|RM 300/)).toBeVisible()
  await expect(page.getByText(/450|RM 450/)).toBeVisible()
})
