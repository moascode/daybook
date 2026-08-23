/**
 * Wallet — CSV import narrative-to-merchant canonicalization (single-column case).
 *
 * When a CSV has ONLY a raw bank-narrative column (no separate Payee/Merchant
 * column at all), `detectColumns()` has no identity keyword to prefer, so its
 * fallback assigns the description-keyword column straight to
 * `mapping.merchant` and leaves `mapping.description` null (src/lib/csv.ts).
 * `buildImportRows()` then recognises this as a narrative column
 * (`isNarrativeColumn`) and splits it: `canonicalizeMerchantForCsv()` strips
 * the payment-rail prefix, the masked/unmasked card or reference number, and
 * the outlet/location tail, then title-cases what's left for `merchant` —
 * while the untouched raw narrative is preserved verbatim in `description`.
 * Nothing is lost, but the transaction list shows a clean name instead of a
 * wall of bank jargon.
 *
 * This is the sibling of 61-csv-merchant-column-priority.spec.ts (which
 * covers the two-column Payee+Description case, where the split columns are
 * taken as-is with no canonicalization). This spec is the only e2e coverage
 * of the actual `isNarrativeColumn` split path in `buildImportRows()` — 61's
 * fixture has a separate Payee column, so that path never runs there.
 */

import { test, expect, type Browser, type Page } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { newAppPage, accountCardFor, transactionRowFor, fillAccountForm, navigateToImportCsv } from './helpers'

test.describe.configure({ mode: 'serial' })

let page: Page
const CSV_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'narrative-only.csv')

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  page = await newAppPage(browser, '/wallet/accounts')
  await page.getByRole('button', { name: 'Add Account' }).first().click()
  await fillAccountForm(page, { name: 'Narrative Only Account', type: 'bank' })
  await expect(accountCardFor(page, 'Narrative Only Account')).toBeVisible()
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

test('upload CSV file with only a Description column', async () => {
  const csvContent = await import('node:fs/promises').then((fs) => fs.readFile(CSV_PATH, 'utf-8'))
  await page.evaluate(async (content) => {
    const file = new File([content], 'narrative-only.csv', { type: 'text/csv' })
    await window.__testCsvFileSelect(file)
  }, csvContent)
  await expect(page.getByText('Map Columns')).toBeVisible({ timeout: 10_000 })
})

test('mapping step shows the file name and row count', async () => {
  await expect(page.getByText('narrative-only.csv')).toBeVisible()
  // 3 data rows in the fixture
  await expect(page.getByText('3 rows')).toBeVisible()
})

// ── Column mapping — the core auto-detection assertion ──────────────────

test('merchant column is auto-detected as the only candidate, "Description"', async () => {
  // No Payee/Merchant/Vendor column exists, so detectColumns()'s fallback
  // assigns the sole description-keyword column straight to mapping.merchant.
  const merchantSelect = page.getByLabel('Merchant / Description column')
  await expect(merchantSelect).toHaveValue('Description')
})

test('the separate description selector is left unmapped', async () => {
  // The "Additional description column" <select> always renders — it isn't
  // conditionally hidden — but with only one usable column in this CSV there
  // is nothing left to map it to. It stays on its blank "None" option, so
  // mapping.description is null and buildImportRows() takes the narrative-
  // split path instead of copying the column verbatim.
  const descriptionSelect = page.getByLabel('Additional description column (optional)')
  await expect(descriptionSelect).toHaveValue('')
})

test('account selector shows Narrative Only Account', async () => {
  const accountSelect = page.getByLabel('Import into account *')
  await accountSelect.selectOption('Narrative Only Account')
})

test('proceed to Review Rows step', async () => {
  await page.getByRole('button', { name: /Review Rows/ }).click()
  await expect(page.getByText('Review Import')).toBeVisible()
})

// ── Review step — canonicalization is the core assertion ────────────────

test('review table shows all 3 rows, none duplicate', async () => {
  await expect(page.getByText('3 to import')).toBeVisible()
  await expect(page.getByText('0 duplicate')).toBeVisible()
})

test('review table merchant inputs hold the canonicalized name, not the raw narrative or its all-caps token', async () => {
  const merchantInputs = page.getByRole('textbox', { name: /^Merchant for row/ })
  await expect(merchantInputs).toHaveCount(3)
  const values = await merchantInputs.evaluateAll((els) =>
    els.map((e) => (e as HTMLInputElement).value).sort(),
  )
  // canonicalizeMerchantForCsv() strips the "POS PURCHASE"/"POS DEBIT"/
  // "PURCHASE" rail prefix, the embedded card/reference number, and the
  // outlet/location tail, then title-cases what remains — the raw
  // "POS PURCHASE 4123456789008891 GRABFOOD*MY KUALA LUMPUR MY REF 029384"
  // becomes "Grabfood", never the untouched raw string and never the shouty
  // "GRABFOOD" token exactly as written in the narrative.
  expect(values).toEqual(['Giant', 'Grabfood', 'Petron'])
})

// ── Import ──────────────────────────────────────────────────────────────

test('click Import button triggers import and shows success screen', async () => {
  await page.getByRole('button', { name: /Import 3 Transactions/ }).click()
  await expect(page.getByText('Import Complete')).toBeVisible({ timeout: 15_000 })
})

test('success screen reports 3 imported, 0 skipped', async () => {
  await expect(page.getByText('3 transactions imported')).toBeVisible()
})

// ── Verify the canonical/raw split reached the imported transaction ─────

test('imported transaction shows the canonical merchant and preserves the raw narrative as description', async () => {
  await page.getByRole('button', { name: 'View Transactions' }).click()
  await expect(page).toHaveURL(/\/wallet$/)

  const grabRow = transactionRowFor(page, 'Grabfood')
  await expect(grabRow).toBeVisible()

  // Merchant LABEL is exact-match "Grabfood" — title-case, not the raw
  // narrative and not the all-caps "GRABFOOD" token as written in the CSV.
  // Exact-matching guards against a leftover raw string (checked separately
  // below) making this assertion pass for the wrong reason.
  await expect(grabRow.getByText('Grabfood', { exact: true })).toBeVisible()

  // The raw bank narrative was preserved in the description field, shown
  // alongside the merchant — confirming the split kept both pieces instead
  // of overwriting or dropping one.
  await expect(grabRow.getByText(/POS PURCHASE/)).toBeVisible()
})
