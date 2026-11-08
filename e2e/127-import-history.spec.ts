/**
 * 127 — Wallet → Imports: an import is recorded as a batch, listed with its
 * account, and a batch that went into the wrong account can be moved in one
 * go (the file name suggests the right one) or undone.
 */

import { test, expect } from '@playwright/test'
import { newAppPage } from './helpers'

const API = '/api'

test('an import lands in history and can be moved, then undone', async ({ browser }) => {
  const page = await newAppPage(browser, '/wallet/accounts')
  const savings = await (await page.request.post(`${API}/accounts`, {
    data: { name: 'Maybank Savings', type: 'bank', last4: '4417' },
  })).json()
  await page.request.post(`${API}/accounts`, { data: { name: 'CIMB Credit', type: 'card' } })
  await page.reload()

  await page.getByTestId('nav-imports').click()
  await expect(page.getByRole('heading', { name: 'Imports', exact: true })).toBeVisible()
  await expect(page.getByText('No imports yet')).toBeVisible()

  // The silly-but-expensive mistake: a Maybank statement into the card.
  await page.getByLabel('Import into').selectOption({ label: 'CIMB Credit' })
  await page.getByTestId('imports-start').click()
  const csv = 'Date,Amount,Merchant,Description\n2026-01-10,12.50,Kopi Place,coffee\n2026-01-11,40.00,Jaya Grocer,food\n'
  await page.evaluate(async (content) => {
    await window.__testCsvFileSelect(new File([content], 'MAYBANK_NOV.csv', { type: 'text/csv' }))
  }, csv)
  await page.getByRole('button', { name: 'Review rows' }).click()
  await expect(page.getByRole('heading', { name: 'Review transactions' })).toBeVisible({ timeout: 10_000 })
  await expect(page.getByTestId('review-account-trigger')).toContainText('CIMB Credit')
  await page.getByTestId('import-confirm-btn').click()
  await page.getByTestId('import-final-confirm-btn').click()
  await expect(page.getByText('Import Complete')).toBeVisible({ timeout: 10_000 })

  await page.getByRole('button', { name: 'See in Imports' }).click()
  const row = page.getByTestId('import-batch-row')
  await expect(row).toHaveCount(1)
  await expect(row).toContainText('MAYBANK_NOV.csv')
  await expect(row.getByTestId('import-batch-account')).toContainText('CIMB Credit')

  // Move: the file name points at Maybank, so it is preselected.
  await row.click()
  await expect(page.getByTestId('import-batch-account-name')).toContainText('CIMB Credit')
  await page.getByTestId('move-import-btn').click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByText('Matches file name')).toBeVisible()
  await dialog.getByTestId('move-import-confirm').click()
  await expect(page.getByText('Moved 2 transactions to Maybank Savings.')).toBeVisible()
  await expect(page.getByTestId('import-batch-account-name')).toContainText('Maybank Savings')

  const moved = (await (await page.request.get(`${API}/transactions`)).json()) as { account_id: string }[]
  expect(moved).toHaveLength(2)
  expect(moved.every((t) => t.account_id === savings.id)).toBe(true)

  // Undo removes the rows and the batch.
  await page.getByTestId('undo-import-btn').click()
  await page.getByTestId('undo-import-confirm').click()
  await expect(page.getByText('No imports yet')).toBeVisible()
  expect(await (await page.request.get(`${API}/transactions`)).json()).toHaveLength(0)

  await page.context().close()
})

test('moving is refused when a transfer would point at its own account', async ({ browser }) => {
  const page = await newAppPage(browser, '/wallet/accounts')
  const a = await (await page.request.post(`${API}/accounts`, { data: { name: 'Alpha', type: 'bank' } })).json()
  const b = await (await page.request.post(`${API}/accounts`, { data: { name: 'Beta', type: 'bank' } })).json()
  await page.request.post(`${API}/transactions/import`, {
    data: {
      rows: [{ accountId: a.id, destinationAccountId: b.id, date: '2026-01-10', merchant: 'To Beta', amount: 5, type: 'transfer' }],
      batch: { sourceName: 'alpha.csv', kind: 'csv' },
    },
  })
  const [batch] = (await (await page.request.get(`${API}/imports`)).json()) as { id: string }[]

  const res = await page.request.post(`${API}/imports/${batch.id}/move`, { data: { accountId: b.id } })
  expect(res.status()).toBe(409)
  expect((await res.json()).error).toMatch(/transfer/)

  await page.context().close()
})
