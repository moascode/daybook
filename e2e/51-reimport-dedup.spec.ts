/**
 * Wallet — re-import dedup after link-as-transfer (Item 4 of
 * docs/csv-transfer-linking-plan.md). Merging two imported legs into one
 * transfer preserves the absorbed leg's import hash in
 * absorbed_import_hashes, so check-duplicates still reports it; deleting the
 * merged transfer releases both hashes so a re-import brings both sides back.
 * Pure API spec — one fresh user per run.
 */

import { test, expect } from '@playwright/test'

const API = '/api'

const OUT_HASH = 'e2e-link-out-hash'
const IN_HASH = 'e2e-link-in-hash'

test('absorbed import hashes dedup re-imports until the transfer is deleted', async ({ browser }) => {
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  await page.request.post(`${API}/auth/signup`, {
    data: { username: `e2e_dedup_${Date.now()}`, password: 'test-password' },
  })

  const mkAccount = async (name: string) =>
    (await page.request.post(`${API}/accounts`, {
      data: { name, type: 'bank', currency: 'MYR', color: '#1D9E75', icon: 'wallet', openingBalance: 0 },
    })).json()
  const bank = await mkAccount('Dedup Bank')
  const card = await mkAccount('Dedup Card')

  // The two imported legs of one 120.00 movement, each with its import hash.
  const mk = async (data: Record<string, unknown>) => {
    const res = await page.request.post(`${API}/transactions`, {
      data: { date: '2026-07-15', categoryId: null, ...data },
    })
    expect(res.status()).toBe(201)
    return (await res.json()).id as string
  }
  const outId = await mk({
    accountId: bank.id, amount: 120, type: 'expense', merchant: 'CC Payment', importHash: OUT_HASH,
  })
  const inId = await mk({
    accountId: card.id, amount: 120, type: 'income', merchant: 'Payment Received', importHash: IN_HASH,
  })

  const duplicates = async () =>
    (await (await page.request.post(`${API}/transactions/check-duplicates`, {
      data: { hashes: [OUT_HASH, IN_HASH] },
    })).json()) as string[]

  // Both legs live → both hashes are duplicates.
  expect((await duplicates()).sort()).toEqual([IN_HASH, OUT_HASH].sort())

  // Merge: the expense survives as the transfer, the income leg is absorbed.
  const linkRes = await page.request.post(`${API}/transactions/${outId}/link-transfer`, {
    data: { twinId: inId },
  })
  expect(linkRes.ok()).toBeTruthy()
  const merged = await linkRes.json()
  expect(merged.type).toBe('transfer')
  expect(merged.destination_account_id).toBe(card.id)

  // The absorbed leg's hash must STILL be a duplicate — a re-import of the
  // card statement must not re-create the income row.
  expect((await duplicates()).sort()).toEqual([IN_HASH, OUT_HASH].sort())

  // Deleting the merged transfer cascades the absorbed hash away, so a
  // re-import correctly brings both sides back.
  const delRes = await page.request.delete(`${API}/transactions/${outId}`)
  expect(delRes.status()).toBe(204)
  expect(await duplicates()).toEqual([])

  await ctx.close()
})
