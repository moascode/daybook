/**
 * Wallet — CSV Import end-to-end tests.
 * Covers the full 4-step flow: upload → column mapping → review → import.
 * Also verifies duplicate detection on a second import of the same file.
 */

import { test, expect, type Browser, type Page } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { newAppPage, accountCardFor, transactionRowFor, fillAccountForm } from './helpers'

test.describe.configure({ mode: 'serial' })

let page: Page
const CSV_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'transactions.csv')

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  page = await newAppPage(browser, '/wallet/accounts')
  await page.getByRole('button', { name: 'Add Account' }).first().click()
  await fillAccountForm(page, { name: 'Import Account', type: 'bank' })
  await expect(accountCardFor(page, 'Import Account')).toBeVisible()
})

test.afterAll(async () => {
  await page.context().close()
})

// ── Navigate to Import CSV ──────────────────────────────────────────────

test('navigate to Import CSV tab', async () => {
  await page.getByRole('link', { name: 'Import CSV' }).click()
  await expect(page).toHaveURL(/\/wallet\/import$/)
  await page.waitForLoadState('networkidle')
  // Wait for the heading to render
  await expect(page.getByRole('heading', { name: 'Import from CSV' })).toBeVisible()
})

test('upload step shows a drop zone and Choose File button', async () => {
  await expect(page.getByText('Drop a CSV file here')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Choose File' })).toBeVisible()
})

// ── Upload the CSV ──────────────────────────────────────────────────────

test('upload CSV file via file input', async () => {
  // Playwright can't reliably trigger React's onChange on hidden file inputs.
  // Use the exposed test helper to pass a File object directly.
  const csvContent = await import('node:fs/promises').then(fs => fs.readFile(CSV_PATH, 'utf-8'))
  await page.evaluate(async (content) => {
    const file = new File([content], 'transactions.csv', { type: 'text/csv' })
    await (window as any).__testCsvFileSelect(file)
  }, csvContent)
  await expect(page.getByText('Map Columns')).toBeVisible({ timeout: 10_000 })
})

test('mapping step shows the file name and row count', async () => {
  await expect(page.getByText('transactions.csv')).toBeVisible()
  // 4 data rows in the CSV
  await expect(page.getByText('4 rows')).toBeVisible()
})

// ── Column mapping ──────────────────────────────────────────────────────

test('date column is auto-detected from "Date" header', async () => {
  // The Date select should already have "Date" selected
  const dateSelect = page.getByLabel('Date column *')
  await expect(dateSelect).toHaveValue('Date')
})

test('amount column is auto-detected from "Amount" header', async () => {
  const amountSelect = page.getByLabel('Amount column *')
  await expect(amountSelect).toHaveValue('Amount')
})

test('merchant column is auto-detected from "Merchant" header', async () => {
  const merchantSelect = page.getByLabel('Merchant / Description column')
  await expect(merchantSelect).toHaveValue('Merchant')
})

test('account selector shows Import Account', async () => {
  const accountSelect = page.getByLabel('Import into account *')
  await expect(accountSelect).toHaveValue(/.+/) // has a value
  // Select "Import Account" explicitly
  await accountSelect.selectOption('Import Account')
})

test('proceed to Review Rows step', async () => {
  await page.getByRole('button', { name: /Review Rows/ }).click()
  await expect(page.getByText('Review Import')).toBeVisible()
})

// ── Review step ─────────────────────────────────────────────────────────

test('review table shows all 4 rows from the CSV', async () => {
  await expect(page.getByText('4 to import')).toBeVisible()
  await expect(page.getByText('0 duplicate')).toBeVisible()
})

test('review table shows the CSV rows with correct merchants', async () => {
  await expect(page.getByText('Grab Food')).toBeVisible()
  await expect(page.getByText('Petron')).toBeVisible()
  await expect(page.getByText('Giant Supermarket')).toBeVisible()
  await expect(page.getByText('Netflix')).toBeVisible()
})

test('review table has checkboxes (included column)', async () => {
  // Each row has a checkbox; by default all are checked (included)
  const checkboxes = page.locator('input[type="checkbox"]')
  const count = await checkboxes.count()
  expect(count).toBeGreaterThanOrEqual(4)
})

test('unchecking a row reduces the import count', async () => {
  // Uncheck the first row
  await page.locator('input[type="checkbox"]').first().uncheck()
  await expect(page.getByText('3 to import')).toBeVisible()
  // Re-check it for the actual import
  await page.locator('input[type="checkbox"]').first().check()
  await expect(page.getByText('4 to import')).toBeVisible()
})

// ── Import ──────────────────────────────────────────────────────────────

test('click Import button triggers import and shows success screen', async () => {
  await page.getByRole('button', { name: /Import 4 Transactions/ }).click()
  await expect(page.getByText('Import Complete')).toBeVisible({ timeout: 15_000 })
})

test('success screen reports 4 imported, 0 skipped', async () => {
  await expect(page.getByText('4 transactions imported')).toBeVisible()
})

// ── Verify imported transactions ─────────────────────────────────────────

test('navigate to Transactions and see all imported rows', async () => {
  await page.getByRole('button', { name: 'View Transactions' }).click()
  await expect(page).toHaveURL(/\/wallet$/)
  await expect(transactionRowFor(page, 'Grab Food')).toBeVisible()
  await expect(transactionRowFor(page, 'Petron')).toBeVisible()
  await expect(transactionRowFor(page, 'Giant Supermarket')).toBeVisible()
  await expect(transactionRowFor(page, 'Netflix')).toBeVisible()
})

test('imported transactions have correct dates', async () => {
  await expect(page.getByText('10 Jan 2026')).toBeVisible()
  await expect(page.getByText('11 Jan 2026')).toBeVisible()
  await expect(page.getByText('12 Jan 2026')).toBeVisible()
  await expect(page.getByText('13 Jan 2026')).toBeVisible()
})

test('imported transactions have correct amounts', async () => {
  await expect(page.getByText(/RM[\s ]50\.00/).first()).toBeVisible()
  await expect(page.getByText(/RM[\s ]200\.00/).first()).toBeVisible()
  await expect(page.getByText(/RM[\s ]100\.00/).first()).toBeVisible()
  await expect(page.getByText(/RM[\s ]30\.00/).first()).toBeVisible()
})

// ── Duplicate detection ──────────────────────────────────────────────────

test('importing the same CSV a second time detects all 4 as duplicates', async () => {
  await page.getByRole('link', { name: 'Import CSV' }).click()
  const csvContent2 = await import('node:fs/promises').then(fs => fs.readFile(CSV_PATH, 'utf-8'))
  await page.evaluate(async (content) => {
    const file = new File([content], 'transactions.csv', { type: 'text/csv' })
    await (window as any).__testCsvFileSelect(file)
  }, csvContent2)
  await expect(page.getByText('Map Columns')).toBeVisible()
  await page.getByRole('button', { name: /Review Rows/ }).click()
  await expect(page.getByText('Review Import')).toBeVisible()
  // All 4 rows should be marked as duplicates (0 to import)
  await expect(page.getByText(/0 to import/)).toBeVisible()
  await expect(page.getByText('4 duplicate')).toBeVisible()
})

test('Import button is disabled when all rows are duplicates', async () => {
  await expect(page.getByRole('button', { name: /Import 0 Transactions/ })).toBeDisabled()
})
