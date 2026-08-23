/**
 * Wallet — CSV transfer import (Item 1 of docs/csv-transfer-linking-plan.md).
 * A review-step row can be marked Transfer→another account, producing a single
 * transfer row that is excluded from income/expense totals while moving the
 * balance on both accounts. Also covers the destination validation and the
 * transfer hint shown when editing an imported row (Item 3).
 */

import { test, expect, type Browser, type Page } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { newAppPage, accountCardFor, transactionRowFor, fillAccountForm, navTo, navigateToImportCsv } from './helpers'

test.describe.configure({ mode: 'serial' })

let page: Page
const CSV_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'transactions.csv')

async function uploadFixtureCsv(p: Page) {
  const csvContent = await import('node:fs/promises').then((fs) => fs.readFile(CSV_PATH, 'utf-8'))
  await p.evaluate(async (content) => {
    const file = new File([content], 'transactions.csv', { type: 'text/csv' })
    await window.__testCsvFileSelect(file)
  }, csvContent)
  await expect(p.getByText('Map Columns')).toBeVisible({ timeout: 10_000 })
}

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  page = await newAppPage(browser, '/wallet/accounts')
  await page.getByRole('button', { name: 'Add Account' }).first().click()
  await fillAccountForm(page, { name: 'Main Bank', type: 'bank' })
  await expect(accountCardFor(page, 'Main Bank')).toBeVisible()
  await page.getByRole('button', { name: 'Add Account' }).first().click()
  await fillAccountForm(page, { name: 'Credit Card', type: 'card' })
  await expect(accountCardFor(page, 'Credit Card')).toBeVisible()
})

test.afterAll(async () => {
  await page.context().close()
})

// ── Review step: mark a row as a transfer ────────────────────────────────

test('upload CSV and reach the review step', async () => {
  await navigateToImportCsv(page)
  await expect(page.locator('main').getByRole('heading', { name: 'Import CSV' })).toBeVisible()
  await uploadFixtureCsv(page)
  await page.getByLabel('Import into account *').selectOption('Main Bank')
  await page.getByRole('button', { name: /Review Rows/ }).click()
  await expect(page.getByText('Review Import')).toBeVisible()
  await expect(page.getByText('4 to import')).toBeVisible()
})

test('type select offers Transfer and swaps category for a destination dropdown', async () => {
  // Petron (RM 200) is the credit-card payment leg — mark it as a transfer.
  // Fixture rows keep CSV order: Grab Food, Petron, Giant, Netflix.
  const petronRow = page.getByTestId('csv-review-row').nth(1)
  await expect(petronRow.getByRole('textbox', { name: /^Merchant for row/ })).toHaveValue('Petron')
  const typeSelect = petronRow.getByRole('combobox', { name: /^Type for row/ })
  await expect(typeSelect.locator('option', { hasText: 'Transfer' })).toHaveCount(1)
  await typeSelect.selectOption('transfer')

  // Category select is replaced by the destination-account select for this row.
  const destSelect = petronRow.getByRole('combobox', { name: /^Destination account for row/ })
  await expect(destSelect).toBeVisible()
  // The import target itself is not offered as a destination.
  await expect(destSelect.locator('option', { hasText: 'Main Bank' })).toHaveCount(0)
  await expect(destSelect.locator('option', { hasText: 'Credit Card' })).toHaveCount(1)
})

test('importing a transfer row without a destination is blocked with a toast', async () => {
  await page.getByRole('button', { name: /Import 4 Transactions/ }).click()
  await expect(
    page.getByText(/a transfer needs a destination account different from the import account/),
  ).toBeVisible()
  // Still on the review step — nothing was imported.
  await expect(page.getByText('Review Import')).toBeVisible()
})

test('selecting a destination and importing succeeds', async () => {
  const destSelect = page.getByRole('combobox', { name: /^Destination account for row/ })
  await destSelect.selectOption('Credit Card')
  await page.getByRole('button', { name: /Import 4 Transactions/ }).click()
  await expect(page.getByText('Import Complete')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('4 transactions imported')).toBeVisible()
})

// ── Resulting transactions ───────────────────────────────────────────────

test('the transfer shows as a single row and is excluded from totals', async () => {
  await page.getByRole('button', { name: 'View Transactions' }).click()
  await expect(page).toHaveURL(/\/wallet$/)

  // One single Petron row (the transfer), alongside the three income rows.
  await expect(transactionRowFor(page, 'Petron')).toHaveCount(1)
  await expect(transactionRowFor(page, 'Grab Food')).toBeVisible()

  // Summary: income = 50 + 100 + 30 = 180; the RM 200 transfer is excluded
  // from both income and expense, so net = +180.
  await expect(page.getByText(/RM\s?180\.00/).first()).toBeVisible()
  await expect(page.getByText(/RM\s?200\.00/).first()).toBeVisible() // row amount still visible
  await expect(page.getByText(/\+\s?RM\s?180\.00/)).toBeVisible() // Net
})

test('balances move on both accounts', async () => {
  await navTo(page, 'accounts')
  // Main Bank: +180 income − 200 transferred out = −20.
  await expect(accountCardFor(page, 'Main Bank').getByTestId('account-card-balance')).toHaveText(/-\s?RM\s?20\.00/)
  // Credit Card: +200 transferred in.
  await expect(accountCardFor(page, 'Credit Card').getByTestId('account-card-balance')).toHaveText(/RM\s?200\.00/)
})

// ── Item 3: transfer hint on edit ────────────────────────────────────────

test('editing an imported income/expense row shows the transfer hint', async () => {
  await navTo(page, 'transactions')
  const row = transactionRowFor(page, 'Grab Food')
  await row.hover()
  await row.getByRole('button', { name: 'Edit transaction' }).click()
  await expect(page.getByTestId('transfer-hint')).toBeVisible()
  await page.getByRole('button', { name: 'Cancel' }).click()
})

test('the hint is not shown on a manually created transaction', async () => {
  await page.getByRole('button', { name: 'Add Transaction' }).first().click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(page.getByTestId('transfer-hint')).toHaveCount(0)
  await dialog.getByRole('button', { name: 'Cancel' }).click()
})
