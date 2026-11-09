/**
 * Rule conditions on description and tags (migration
 * 0035_rule_description_tags.sql), 100% splits, the rule hint in
 * TransactionForm, and Settings → Rules "Apply to past".
 */

import { test, expect } from '@playwright/test'
import type { Browser, Page } from '@playwright/test'
import { newAppPage, businessToday, openBlankTransactionForm, fillTransactionForm } from './helpers'

test.describe.configure({ mode: 'serial' })

const API = '/api'

/** Payer (`page`) plus a co-member to split with — same shape as spec 124's helper. */
async function twoUserGroup(browser: Browser, tag: string) {
  const page = await newAppPage(browser, '/wallet')
  const otherCtx = await browser.newContext()
  const other = await otherCtx.newPage()
  const otherName = `rdt_other_${tag}_${Date.now()}`
  await other.request.post(`${API}/auth/signup`, { data: { username: otherName, password: 'test-password' } })
  const otherMe = await other.request.get(`${API}/auth/me`).then((r) => r.json()) as { user: { id: string } }
  const group = await page.request.post(`${API}/groups`, { data: { name: `G_rdt_${tag}` } }).then((r) => r.json()) as { id: string }
  await page.request.post(`${API}/groups/${group.id}/invites`, { data: { username: otherName } })
  const invites = await other.request.get(`${API}/invites`).then((r) => r.json()) as { id: string }[]
  await other.request.post(`${API}/invites/${invites[0].id}/accept`)
  return { page, otherCtx, otherUserId: otherMe.user.id }
}

async function account(page: Page) {
  const res = await page.request.post(`${API}/accounts`, {
    data: { name: 'RDT Card', type: 'card', currency: 'MYR', color: '#1D9E75', icon: 'wallet', openingBalance: 0 },
  })
  return (await res.json()) as { id: string }
}

async function splitsOf(page: Page, transactionId: string) {
  return page.request.get(`${API}/transactions/${transactionId}/splits`).then((r) => r.json()) as Promise<{ user_id: string; share_amount: number }[]>
}

test.describe('129 — Rules on description and tags', () => {
  let page: Page
  let otherCtx: Awaited<ReturnType<typeof twoUserGroup>>['otherCtx']
  let otherUserId: string
  let accountId: string

  test.beforeAll(async ({ browser }) => {
    ;({ page, otherCtx, otherUserId } = await twoUserGroup(browser, 'main'))
    accountId = (await account(page)).id
  })

  test.afterAll(async () => {
    await otherCtx.close()
    await page.context().close()
  })

  test('API stores description + tag conditions and accepts a 100% split', async () => {
    const res = await page.request.post(`${API}/rules`, {
      data: { name: 'Card 3523', matchDescription: ' 3523 ', matchTags: ['tumpa'], splitUserId: otherUserId, splitPercent: 100 },
    })
    expect(res.status()).toBe(201)
    const row = await res.json()
    expect(row.match_description).toBe('3523')
    expect(JSON.parse(row.match_tags)).toEqual(['tumpa'])
    expect(row.split_percent).toBe(100)

    // Clearing the tag condition leaves description as the only condition — still valid.
    const patched = await page.request.patch(`${API}/rules/${row.id}`, { data: { matchTags: null } })
    expect(patched.status()).toBe(200)
    expect((await patched.json()).match_tags).toBe('[]')

    // Clearing the last condition is rejected.
    const empty = await page.request.patch(`${API}/rules/${row.id}`, { data: { matchDescription: '' } })
    expect(empty.status()).toBe(400)

    await page.request.delete(`${API}/rules/${row.id}`)
  })

  test('form hint applies a tag rule and the 60/40 split is created on save', async () => {
    const rule = await page.request.post(`${API}/rules`, {
      data: { name: 'Freya', matchTags: ['freya', 'baby'], splitUserId: otherUserId, splitPercent: 40 },
    }).then((r) => r.json()) as { id: string }

    await page.goto('/wallet')
    await openBlankTransactionForm(page)
    await fillTransactionForm(page, { amount: '100', account: accountId, merchant: 'Baby Shop RDT', tags: ['Baby'], submit: false })

    const dialog = page.getByRole('dialog')
    await expect(dialog.getByTestId('rule-hint')).toContainText('Rule “Freya” matches: split 60/40')
    await dialog.getByTestId('rule-hint-apply').click()
    await expect(dialog.getByTestId('rule-hint-applied')).toContainText('On save: split 60/40')
    await dialog.getByRole('button', { name: 'Add Transaction' }).click()
    await expect(dialog).toBeHidden()

    const txns = await page.request.get(`${API}/transactions?view=mine`).then((r) => r.json()) as { id: string; merchant: string }[]
    const txn = txns.find((t) => t.merchant === 'Baby Shop RDT')!
    const shares = await splitsOf(page, txn.id)
    expect(shares.find((s) => s.user_id === otherUserId)?.share_amount).toBe(40)
    expect(shares.find((s) => s.user_id !== otherUserId)?.share_amount).toBe(60)

    await page.request.delete(`${API}/rules/${rule.id}`)
  })

  test('Apply to past splits a matching description 0/100 and skips the rest', async () => {
    const make = (description: string, merchant: string) =>
      page.request.post(`${API}/transactions`, {
        data: { accountId, date: businessToday(), merchant, description, amount: 25, type: 'expense', tag: '[]' },
      }).then((r) => r.json()) as Promise<{ id: string }>
    const hit = await make('PURCHASE •••• •••• •••• 3523 KL', 'Card Hit RDT')
    const miss = await make('PURCHASE •••• •••• •••• 9999 KL', 'Card Miss RDT')

    await page.request.post(`${API}/rules`, {
      data: { name: 'Tumpa card', matchDescription: '3523', splitUserId: otherUserId, splitPercent: 100 },
    })

    await page.goto('/settings/wallet')
    const row = page.getByTestId('rule-row').filter({ hasText: 'Tumpa card' })
    await expect(row).toContainText('description contains "3523"')
    await row.getByTestId('rule-backfill-open').click()
    await expect(page.getByTestId('rule-backfill-summary')).toContainText('1 transaction will change · 1 split')
    await expect(page.getByTestId('rule-backfill-row')).toHaveCount(1)
    await page.getByTestId('rule-backfill-confirm').click()
    await expect(page.getByText('Applied "Tumpa card" to 1 transaction.')).toBeVisible()

    const hitShares = await splitsOf(page, hit.id)
    expect(hitShares).toHaveLength(1)
    expect(hitShares[0]).toMatchObject({ user_id: otherUserId, share_amount: 25 })
    expect(await splitsOf(page, miss.id)).toHaveLength(0)

    // Re-running finds nothing: the hit is already split.
    await row.getByTestId('rule-backfill-open').click()
    await expect(page.getByTestId('rule-backfill-empty')).toBeVisible()
  })
})
