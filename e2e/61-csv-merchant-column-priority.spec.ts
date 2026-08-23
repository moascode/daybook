/**
 * Wallet — CSV import merchant-column priority.
 *
 * When a CSV has both a clean identity column (Payee) and a raw bank
 * narrative column (Description), column auto-detection must prefer Payee
 * for the merchant field — src/lib/csv.ts orders MERCHANT_KEYWORDS with
 * identity terms ('merchant', 'payee', 'vendor') before generic narrative
 * terms ('description', 'narrative', ...) for exactly this reason.
 *
 * Because both columns are present and distinct, buildImportRows() takes
 * them as-is (isNarrativeColumn only splits a single narrative column when
 * no separate description column was mapped) — so the clean Payee text
 * lands in `merchant` untouched, and the raw narrative lands in
 * `description` untouched. This spec checks both ends: the mapping-step
 * auto-detection, and that the split survives all the way to the imported
 * transaction.
 */

import { test, expect, type Browser, type Page } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { newAppPage, accountCardFor, transactionRowFor, fillAccountForm, navigateToImportCsv } from './helpers'

test.describe.configure({ mode: 'serial' })

let page: Page
const CSV_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'payee-and-narrative.csv')

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  page = await newAppPage(browser, '/wallet/accounts')
  await page.getByRole('button', { name: 'Add Account' }).first().click()
  await fillAccountForm(page, { name: 'Narrative Account', type: 'bank' })
  await expect(accountCardFor(page, 'Narrative Account')).toBeVisible()
})

test.afterAll(async () => {
  await page.context().close()
})

// ── Navigate to Import CSV ──────────────────────────────────────────────

test('navigate to Import CSV via the account menu', async () => {
  await navigateToImportCsv(page)
  await expect(page).toHaveURL(/\/wallet\/import$/)
  await page.waitForLoadState('networkidle')
  await expect(page.locator('main').getByRole('heading', { name: 'Import CSV' })).toBeVisible()
})

// ── Upload the CSV ──────────────────────────────────────────────────────

test('upload CSV file with both Payee and Description columns', async () => {
  const csvContent = await import('node:fs/promises').then((fs) => fs.readFile(CSV_PATH, 'utf-8'))
  await page.evaluate(async (content) => {
    const file = new File([content], 'payee-and-narrative.csv', { type: 'text/csv' })
    await window.__testCsvFileSelect(file)
  }, csvContent)
  await expect(page.getByText('Map Columns')).toBeVisible({ timeout: 10_000 })
})

test('mapping step shows the file name and row count', async () => {
  await expect(page.getByText('payee-and-narrative.csv')).toBeVisible()
  // 3 data rows in the fixture
  await expect(page.getByText('3 rows')).toBeVisible()
})

// ── Column mapping — the core assertion ─────────────────────────────────

test('merchant column is auto-detected as "Payee", not "Description"', async () => {
  const merchantSelect = page.getByLabel('Merchant / Description column')
  await expect(merchantSelect).toHaveValue('Payee')
})

test('description column is separately auto-detected as "Description"', async () => {
  const descriptionSelect = page.getByLabel('Additional description column (optional)')
  await expect(descriptionSelect).toHaveValue('Description')
})

test('account selector shows Narrative Account', async () => {
  const accountSelect = page.getByLabel('Import into account *')
  await accountSelect.selectOption('Narrative Account')
})

test('proceed to Review Rows step', async () => {
  await page.getByRole('button', { name: /Review Rows/ }).click()
  await expect(page.getByText('Review Import')).toBeVisible()
})

// ── Review step — the split survived ────────────────────────────────────

test('review table shows all 3 rows, none duplicate', async () => {
  await expect(page.getByText('3 to import')).toBeVisible()
  await expect(page.getByText('0 duplicate')).toBeVisible()
})

test('review table merchant inputs hold the clean Payee text, not the raw narrative', async () => {
  const merchantInputs = page.getByRole('textbox', { name: /^Merchant for row/ })
  await expect(merchantInputs).toHaveCount(3)
  const values = await merchantInputs.evaluateAll((els) =>
    els.map((e) => (e as HTMLInputElement).value).sort(),
  )
  // Payee text as written in the CSV — not canonicalised (that transform only
  // runs when a single narrative column is split; here Payee is its own
  // column and is taken verbatim), and not the raw "POS PURCHASE ..." text.
  expect(values).toEqual(['Giant Supermarket', 'Grab Food', 'Petron'])
})

// ── Import ──────────────────────────────────────────────────────────────

test('click Import button triggers import and shows success screen', async () => {
  await page.getByRole('button', { name: /Import 3 Transactions/ }).click()
  await expect(page.getByText('Import Complete')).toBeVisible({ timeout: 15_000 })
})

test('success screen reports 3 imported, 0 skipped', async () => {
  await expect(page.getByText('3 transactions imported')).toBeVisible()
})

// ── Verify the split reached the imported transaction ───────────────────

test('imported transaction shows the clean merchant and the raw narrative as description', async () => {
  await page.getByRole('button', { name: 'View Transactions' }).click()
  await expect(page).toHaveURL(/\/wallet$/)

  const grabRow = transactionRowFor(page, 'Grab Food')
  await expect(grabRow).toBeVisible()
  // The raw bank narrative was preserved in the description field, shown
  // alongside the merchant in the transaction row — confirming Payee and
  // Description were kept as two distinct fields, not merged or dropped.
  await expect(grabRow.getByText(/GRABFOOD/)).toBeVisible()
})
