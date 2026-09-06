/**
 * Wave F2 — regression coverage for the CSV parser fixes (Wave D / B-13, B-14).
 * Locks in DD/MM-vs-MM/DD date disambiguation and European decimal handling by
 * driving a real import and asserting the parsed values in the review table.
 */
import { test, expect } from '@playwright/test'
import type { Browser, Page } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { newAppPage, fillAccountForm, navigateToImportCsv } from './helpers'

const CSV_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'european-format.csv')

declare global {
  interface Window {
    __testCsvFileSelect: (file: File) => Promise<void>
  }
}

test.describe.configure({ mode: 'serial' })

let page: Page

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  page = await newAppPage(browser, '/wallet/accounts')
  await page.getByRole('button', { name: 'Add Account' }).first().click()
  await fillAccountForm(page, { name: 'Import Account', type: 'bank' })
  await navigateToImportCsv(page)
})

test.afterAll(async () => {
  await page.context().close()
})

test('imports a US-format date and a European-decimal amount correctly', async () => {
  // Account is picked in the pick view (shared by both import types), before upload.
  await page.getByLabel('Import into account').selectOption('Import Account')

  const csvContent = await import('node:fs/promises').then((fs) => fs.readFile(CSV_PATH, 'utf-8'))
  await page.evaluate(async (content) => {
    const file = new File([content], 'european-format.csv', { type: 'text/csv' })
    await window.__testCsvFileSelect(file)
  }, csvContent)

  // Map view: headers auto-detect, then review.
  await expect(page.getByText('rows detected')).toBeVisible({ timeout: 10_000 })
  await page.getByRole('button', { name: 'Review rows' }).click()
  await expect(page.getByRole('heading', { name: 'Review transactions' })).toBeVisible({ timeout: 10_000 })

  // B-13: 12/31/2025 (day 31 > 12 ⇒ MM/DD) → 2025-12-31, not the invalid 2025-31-12.
  await expect(page.getByTestId('csv-row-date')).toHaveValue('2025-12-31')
  // B-14: European "1.234,56" → 1234.56, not 1.23456.
  await expect(page.getByTestId('csv-row-amount')).toHaveValue('1234.56')
  await expect(page.getByRole('textbox', { name: /^Merchant for row/ })).toHaveValue('Euro Store')
})
