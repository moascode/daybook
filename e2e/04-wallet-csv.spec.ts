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
  await expect(page.locator('main').getByRole('heading', { name: 'Import CSV' })).toBeVisible()
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
    await window.__testCsvFileSelect(file)
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
  // Merchant is now an editable input (U-14), so assert on the input values.
  const merchantInputs = page.getByRole('textbox', { name: /^Merchant for row/ })
  await expect(merchantInputs).toHaveCount(4)
  const values = await merchantInputs.evaluateAll((els) =>
    els.map((e) => (e as HTMLInputElement).value).sort(),
  )
  expect(values).toEqual(['Giant Supermarket', 'Grab Food', 'Netflix', 'Petron'])
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
  await expect(page.getByText(/RM\s50\.00/).first()).toBeVisible()
  await expect(page.getByText(/RM\s200\.00/).first()).toBeVisible()
  await expect(page.getByText(/RM\s100\.00/).first()).toBeVisible()
  await expect(page.getByText(/RM\s30\.00/).first()).toBeVisible()
})

// ── Duplicate detection ──────────────────────────────────────────────────

test('importing the same CSV a second time detects all 4 as duplicates', async () => {
  await page.getByRole('link', { name: 'Import CSV' }).click()
  const csvContent2 = await import('node:fs/promises').then(fs => fs.readFile(CSV_PATH, 'utf-8'))
  await page.evaluate(async (content) => {
    const file = new File([content], 'transactions.csv', { type: 'text/csv' })
    await window.__testCsvFileSelect(file)
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

// ── First-row-is-header toggle ───────────────────────────────────────────

test('header toggle is checked by default in the mapping step', async () => {
  // Re-upload the CSV to get back to mapping step
  const csvContent = await import('node:fs/promises').then(fs => fs.readFile(CSV_PATH, 'utf-8'))
  await page.getByRole('link', { name: 'Import CSV' }).click()
  await page.evaluate(async (content) => {
    const file = new File([content], 'transactions.csv', { type: 'text/csv' })
    await window.__testCsvFileSelect(file)
  }, csvContent)
  await expect(page.getByText('Map Columns')).toBeVisible({ timeout: 10_000 })
  await expect(page.getByLabel('First row is a header (column names)')).toBeChecked()
})

test('unchecking header toggle increases row count (first row treated as data)', async () => {
  // With header: the CSV has 4 data rows (header row is excluded from count).
  // Without header: first row becomes data too, so count becomes 5.
  await expect(page.getByText('4 rows')).toBeVisible()
  await page.getByLabel('First row is a header (column names)').uncheck()
  // Wait for the async re-parse to complete and the count to update
  await expect(page.getByText('5 rows')).toBeVisible({ timeout: 5000 })
})

test('re-checking header toggle restores original row count', async () => {
  await page.getByLabel('First row is a header (column names)').check()
  await expect(page.getByText('4 rows')).toBeVisible()
})

// ── Type-filtered category options (§2.5) ────────────────────────────────

test('review category options are filtered by each row type', async ({ browser }) => {
  // Isolated fresh user so the CSV rows aren't duplicates (which would disable
  // the row controls) — the shared `page` already imported this fixture.
  const isoPage = await newAppPage(browser, '/wallet/accounts')
  await isoPage.getByRole('button', { name: 'Add Account' }).first().click()
  await fillAccountForm(isoPage, { name: 'Filter Account', type: 'bank' })

  await isoPage.getByRole('link', { name: 'Import CSV' }).click()
  await expect(isoPage.locator('main').getByRole('heading', { name: 'Import CSV' })).toBeVisible()
  const csvContent = await import('node:fs/promises').then((fs) => fs.readFile(CSV_PATH, 'utf-8'))
  await isoPage.evaluate(async (content) => {
    const file = new File([content], 'transactions.csv', { type: 'text/csv' })
    await window.__testCsvFileSelect(file)
  }, csvContent)
  await expect(isoPage.getByText('Map Columns')).toBeVisible({ timeout: 10_000 })
  await isoPage.getByRole('button', { name: /Review Rows/ }).click()
  await expect(isoPage.getByText('Review Import')).toBeVisible()

  // Positive amounts parse as income → the category select offers income
  // categories, never an expense-only one.
  const firstRow = isoPage.locator('tbody tr').first()
  const categorySelect = firstRow.locator('select').last()
  await expect(categorySelect.locator('option', { hasText: 'Salary' })).toHaveCount(1)
  await expect(categorySelect.locator('option', { hasText: 'Food & Drink' })).toHaveCount(0)

  // Flip the row to Expense → the options swap: an income category can no
  // longer be attached to an expense row.
  await firstRow.locator('select').first().selectOption('expense')
  await expect(categorySelect.locator('option', { hasText: 'Food & Drink' })).toHaveCount(1)
  await expect(categorySelect.locator('option', { hasText: 'Salary' })).toHaveCount(0)

  await isoPage.context().close()
})

// ── Shared-account write permission on import (§2.4) ──────────────────────

test('CSV import respects shared-account write permission', async ({ browser }) => {
  const aliceCtx = await browser.newContext()
  const bobCtx = await browser.newContext()
  const alice = await aliceCtx.newPage()
  const bob = await bobCtx.newPage()
  const ts = Date.now()
  const aliceName = `alice_csv_${ts}`
  const bobName = `bob_csv_${ts}`
  const API = 'http://localhost:5173/api'

  await alice.request.post(`${API}/auth/signup`, { data: { username: aliceName, password: 'test-password' } })
  await bob.request.post(`${API}/auth/signup`, { data: { username: bobName, password: 'test-password' } })

  // Group with Bob as a member.
  const group = await (await alice.request.post(`${API}/groups`, { data: { name: 'CsvGroup' } })).json()
  await alice.request.post(`${API}/groups/${group.id}/invites`, { data: { username: bobName } })
  const invites = await (await bob.request.get(`${API}/invites`)).json()
  await bob.request.post(`${API}/invites/${invites[0].id}/accept`)

  // Alice shares one writable account and one read-only account with the group.
  const mkAccount = async (name: string) =>
    (await alice.request.post(`${API}/accounts`, {
      data: { name, type: 'cash', currency: 'MYR', color: '#1D9E75', icon: 'wallet', openingBalance: 0 },
    })).json()
  const writable = await mkAccount('Writable Shared')
  const readonly = await mkAccount('ReadOnly Shared')
  await alice.request.post(`${API}/accounts/${writable.id}/shares`, { data: { groupId: group.id, canWrite: true } })
  await alice.request.post(`${API}/accounts/${readonly.id}/shares`, { data: { groupId: group.id, canWrite: false } })

  // Bob imports into the writable shared account → allowed.
  const okRes = await bob.request.post(`${API}/transactions/import`, {
    data: [{ accountId: writable.id, date: '2026-02-01', merchant: 'Shared Buy', amount: 12.5, type: 'expense', categoryId: null }],
  })
  expect(okRes.status()).toBe(201)

  // Bob imports into the read-only shared account → still refused.
  const denyRes = await bob.request.post(`${API}/transactions/import`, {
    data: [{ accountId: readonly.id, date: '2026-02-01', merchant: 'Nope', amount: 5, type: 'expense', categoryId: null }],
  })
  expect(denyRes.status()).toBe(403)

  await aliceCtx.close()
  await bobCtx.close()
})

// ── No-account guard ────────────────────────────────────────────────────

test('CSV import shows no-account warning when user has no accounts', async ({ browser }) => {
  // A freshly signed-up user has no accounts — navigate directly to import
  const noAccountPage = await newAppPage(browser, '/wallet/import')

  await expect(noAccountPage.getByTestId('csv-no-account-warning')).toBeVisible()
  await expect(noAccountPage.getByText('No accounts yet')).toBeVisible()
  await expect(noAccountPage.getByRole('link', { name: 'Create an Account' })).toBeVisible()

  // Drop zone should not be visible when no accounts exist
  await expect(noAccountPage.getByText('Drop a CSV file here')).not.toBeVisible()

  await noAccountPage.context().close()
})
