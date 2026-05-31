/**
 * Wallet — Dashboard end-to-end tests.
 * Verifies charts render, date range selector works, and key metrics are displayed.
 * Creates its own transactions so this file is fully self-contained.
 */

import { test, expect, type Browser, type Page } from '@playwright/test'
import { newAppPage, accountCardFor, fillAccountForm, fillTransactionForm } from './helpers'

test.describe.configure({ mode: 'serial' })

let page: Page

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  page = await newAppPage(browser, '/wallet/accounts')
  // Create an account and add several transactions for the charts
  await page.getByRole('button', { name: 'Add Account' }).first().click()
  await fillAccountForm(page, { name: 'Dashboard Bank', type: 'bank' })
  await expect(accountCardFor(page, 'Dashboard Bank')).toBeVisible()

  await page.getByRole('link', { name: 'Transactions' }).click()
  // Wait for the Add Transaction button to confirm accounts are loaded in the form
  await expect(page.getByRole('button', { name: 'Add Transaction' })).toBeVisible()

  // Add a mix of income and expenses across multiple days this month
  const thisMonth = new Date()
  const yyyy = thisMonth.getFullYear()
  const mm = String(thisMonth.getMonth() + 1).padStart(2, '0')

  for (const [day, type, amount, merchant, category] of [
    ['01', 'Income',  '6000', 'Salary Corp',      'Salary'],
    ['03', 'Expense', '80',   'Grab Food',         'Food & Drink'],
    ['05', 'Expense', '150',  'Petronas',          'Transport'],
    ['07', 'Expense', '60',   'Netflix',           'Entertainment'],
    ['10', 'Income',  '500',  'Freelance Client',  'Freelance'],
    ['15', 'Expense', '200',  'Giant Mall',        'Shopping'],
  ] as const) {
    await page.getByRole('button', { name: 'Add Transaction' }).click()
    await fillTransactionForm(page, {
      type,
      date: `${yyyy}-${mm}-${day}`,
      amount,
      account: 'Dashboard Bank',
      merchant,
      category: type === 'Expense' || type === 'Income' ? category : undefined,
    })
  }
})

test.afterAll(async () => {
  await page.context().close()
})

// ── Navigate to Dashboard ───────────────────────────────────────────────

test('navigate to Dashboard tab', async () => {
  await page.getByRole('link', { name: 'Dashboard' }).click()
  await expect(page).toHaveURL(/\/wallet\/dashboard$/)
  // Use the role-scoped nav link: once charts render, the account name
  // "Dashboard Bank" makes a plain getByText('Dashboard') ambiguous.
  await expect(page.getByRole('link', { name: 'Dashboard' })).toBeVisible()
})

// ── Date range selector ─────────────────────────────────────────────────

test('shows "This Month" as the default date range', async () => {
  await expect(page.getByRole('button', { name: 'This Month' })).toBeVisible()
})

test('summary cards show Income, Expense, Net for this month', async () => {
  // Income = 6000 + 500 = 6500, Expense = 80+150+60+200 = 490, Net = 6010
  await expect(page.getByText(/6,500|6500/)).toBeVisible()
  await expect(page.getByText(/490/)).toBeVisible()
})

// ── Charts ──────────────────────────────────────────────────────────────

test('cash flow bar chart is rendered as SVG', async () => {
  // Recharts renders charts as <svg> inside a <div>
  const svgCharts = page.locator('.recharts-wrapper svg')
  await expect(svgCharts.first()).toBeVisible()
})

test('chart container exists for cash flow (bar chart)', async () => {
  // Look for Recharts bar chart container
  await expect(page.locator('.recharts-bar-rectangle').first()).toBeVisible()
})

test('chart container exists for spending by category (pie chart)', async () => {
  await expect(page.locator('.recharts-pie').first()).toBeVisible()
})

test('top merchants section lists merchants', async () => {
  await expect(page.getByText('Top Merchants')).toBeVisible()
  await expect(page.getByText('Petronas')).toBeVisible()
})

// ── Date range switching ────────────────────────────────────────────────

test('switch to Last Month shows zero or different data', async () => {
  await page.getByRole('button', { name: 'Last Month' }).click()
  await expect(page.getByRole('button', { name: 'Last Month' })).toHaveClass(/border-brand|text-brand|bg-brand/)
  // No transactions last month — income and expense should be 0
  await expect(page.getByText(/RM\s*0\.00/).first()).toBeVisible()
})

test('switch back to This Month shows data again', async () => {
  await page.getByRole('button', { name: 'This Month' }).click()
  await expect(page.getByText(/6,500|6500/)).toBeVisible()
})

test('dashboard links to Reports for custom ranges (no inline custom picker)', async () => {
  // Custom/historical analysis lives on the Reports page now — the dashboard
  // stays an at-a-glance current-period view.
  await expect(page.getByRole('button', { name: 'Custom' })).toHaveCount(0)
  await expect(
    page.getByRole('link', { name: /Custom range.*history/i }),
  ).toBeVisible()
})

// ── Spending by account chart ───────────────────────────────────────────

test('account bar chart renders for Dashboard Bank', async () => {
  await page.getByRole('button', { name: 'This Month' }).click()
  await expect(page.getByText('Spending by Account')).toBeVisible()
  await expect(page.locator('.recharts-bar-rectangle').first()).toBeVisible()
})
