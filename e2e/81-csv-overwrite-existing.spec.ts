/**
 * 81 — CSV review: a possible-duplicate row shows the matched entry's amount
 * and can UPDATE that entry (bank statements carry fuller descriptions than a
 * capture) instead of being imported as a second transaction.
 */

import { test, expect } from '@playwright/test'
import { newAppPage, navigateToImportCsv } from './helpers'

const API = '/api'

test('possible duplicate shows the amount and can update the existing entry', async ({ browser }) => {
  const page = await newAppPage(browser, '/wallet/accounts')
  const account = await (await page.request.post(`${API}/accounts`, { data: { name: 'Everyday', type: 'bank' } })).json()
  const created = await page.request.post(`${API}/transactions`, {
    data: { accountId: account.id, date: '2026-01-10', merchant: 'Zed Cafe', amount: 22.9, type: 'expense' },
  })
  const existingId = (await created.json()).id as string
  await page.reload()

  await navigateToImportCsv(page)
  const csv = 'Date,Amount,Merchant,Description\n2026-01-10,22.90,QQ Mart Nilai,STATEMENT LINE WITH MORE DETAIL\n'
  await page.evaluate(async (content) => {
    await window.__testCsvFileSelect(new File([content], 'one.csv', { type: 'text/csv' }))
  }, csv)
  await page.getByRole('button', { name: 'Review rows' }).click()
  await expect(page.getByRole('heading', { name: 'Review transactions' })).toBeVisible({ timeout: 10_000 })

  const hint = page.getByTestId('csv-possible-duplicate')
  await expect(hint).toContainText('Zed Cafe')
  await expect(hint).toContainText('22.90')

  await expect(page.getByTestId('csv-replace-existing')).toBeChecked()
  await page.getByTestId('import-confirm-btn').click()
  await page.getByTestId('import-final-confirm-btn').click()
  await expect(page.getByText(/imported/i).first()).toBeVisible({ timeout: 10_000 })

  const all = (await (await page.request.get(`${API}/transactions`)).json()) as {
    id: string; merchant: string; description: string
  }[]
  expect(all).toHaveLength(1)
  expect(all[0]).toMatchObject({ id: existingId, merchant: 'QQ Mart Nilai', description: 'STATEMENT LINE WITH MORE DETAIL' })

  await page.context().close()
})
