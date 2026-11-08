/**
 * 126 — Import asks which account before committing. The review page's
 * account defaults to the first one and was easy to miss; the confirm dialog
 * restates it and lets it be switched, and Cancel imports nothing.
 */

import { test, expect } from '@playwright/test'
import { newAppPage, navigateToImportCsv } from './helpers'

const API = '/api'

test('confirm dialog names the account, can switch it, and Cancel imports nothing', async ({ browser }) => {
  const page = await newAppPage(browser, '/wallet/accounts')
  await page.request.post(`${API}/accounts`, { data: { name: 'Alpha Bank', type: 'bank' } })
  const card = await (await page.request.post(`${API}/accounts`, {
    data: { name: 'Beta Card', type: 'card', last4: '4242' },
  })).json()
  await page.reload()

  await navigateToImportCsv(page)
  const csv = 'Date,Amount,Merchant,Description\n2026-01-10,12.50,Kopi Place,coffee\n'
  await page.evaluate(async (content) => {
    await window.__testCsvFileSelect(new File([content], 'one.csv', { type: 'text/csv' }))
  }, csv)
  await page.getByRole('button', { name: 'Review rows' }).click()
  await expect(page.getByRole('heading', { name: 'Review transactions' })).toBeVisible({ timeout: 10_000 })

  // Cancel closes the dialog without importing.
  await page.getByTestId('import-confirm-btn').click()
  const select = page.getByTestId('import-confirm-account')
  await expect(select.locator('option:checked')).toHaveText('Alpha Bank')
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(await (await page.request.get(`${API}/transactions`)).json()).toHaveLength(0)

  // Switching in the dialog is what the import uses, and the page badge follows.
  await page.getByTestId('import-confirm-btn').click()
  await select.selectOption({ label: 'Beta Card ··4242' })
  await expect(page.getByTestId('review-account-trigger')).toContainText('Beta Card')
  await page.getByTestId('import-final-confirm-btn').click()
  await expect(page.getByText('Import Complete')).toBeVisible({ timeout: 10_000 })

  const all = (await (await page.request.get(`${API}/transactions`)).json()) as { account_id: string }[]
  expect(all).toHaveLength(1)
  expect(all[0].account_id).toBe(card.id)

  await page.context().close()
})
