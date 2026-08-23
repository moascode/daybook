/**
 * Wallet — "Link as transfer" (Item 2 of docs/csv-transfer-linking-plan.md).
 * An expense in account A and a matching income in account B merge into one
 * single transfer row via the edit-form picker; the guards (same account,
 * mismatched amounts, same direction, already-split) reject bad links.
 */

import { test, expect, type Browser, type Page } from '@playwright/test'
import { newAppPage, accountCardFor, transactionRowFor, fillAccountForm, fillTransactionForm, navTo } from './helpers'

test.describe.configure({ mode: 'serial' })

const API = '/api'

let page: Page

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  page = await newAppPage(browser, '/wallet/accounts')
  await page.getByRole('button', { name: 'Add Account' }).first().click()
  await fillAccountForm(page, { name: 'Bank A', type: 'bank' })
  await expect(accountCardFor(page, 'Bank A')).toBeVisible()
  await page.getByRole('button', { name: 'Add Account' }).first().click()
  await fillAccountForm(page, { name: 'Bank B', type: 'bank' })
  await expect(accountCardFor(page, 'Bank B')).toBeVisible()
})

test.afterAll(async () => {
  await page.context().close()
})

// ── Happy path via the UI ────────────────────────────────────────────────

test('create the two legs: expense in Bank A, income in Bank B', async () => {
  await navTo(page, 'transactions')
  await page.getByRole('button', { name: 'Add Transaction' }).first().click()
  await fillTransactionForm(page, {
    type: 'Expense', amount: '350', account: 'Bank A', merchant: 'CC Payment',
  })
  await page.getByRole('button', { name: 'Add Transaction' }).first().click()
  await fillTransactionForm(page, {
    type: 'Income', amount: '350', account: 'Bank B', merchant: 'Payment Received',
  })
  await expect(transactionRowFor(page, 'CC Payment')).toBeVisible()
  await expect(transactionRowFor(page, 'Payment Received')).toBeVisible()
})

test('edit form offers "Link as transfer" and the picker lists the twin', async () => {
  const row = transactionRowFor(page, 'CC Payment')
  await row.hover()
  await row.getByRole('button', { name: 'Edit transaction' }).click()
  await page.getByTestId('link-transfer-open').click()

  // The edit form closes; the picker opens with the matching income leg.
  await expect(page.getByRole('dialog').getByText('Link as transfer')).toBeVisible()
  const candidates = page.getByTestId('link-transfer-candidates')
  await expect(candidates.getByRole('button', { name: /Payment Received/ })).toBeVisible()
})

test('picking the twin merges the two rows into one transfer', async () => {
  await page
    .getByTestId('link-transfer-candidates')
    .getByRole('button', { name: /Payment Received/ })
    .click()
  await expect(page.getByText('Linked as one transfer')).toBeVisible()

  // One surviving transfer row; the income leg is gone.
  await expect(transactionRowFor(page, 'CC Payment')).toHaveCount(1)
  await expect(transactionRowFor(page, 'Payment Received')).toHaveCount(0)

  // Both totals drop to zero — a transfer counts as neither income nor expense.
  // Scoped to the summary tile (not a bare text search): R3 added an unlabelled
  // per-day net pill next to each day header, which can coincidentally render
  // the identical "+RM 0.00" string and made the old unscoped locator ambiguous.
  await expect(page.getByTestId('summary-net')).toHaveText(/\+\s?RM\s?0\.00/) // Net
})

test('balances reflect the transfer on both accounts', async () => {
  await navTo(page, 'accounts')
  await expect(accountCardFor(page, 'Bank A').getByTestId('account-card-balance')).toHaveText(/-\s?RM\s?350\.00/)
  await expect(accountCardFor(page, 'Bank B').getByTestId('account-card-balance')).toHaveText(/RM\s?350\.00/)
})

// ── Guard cases via the API (same session user) ──────────────────────────

test('guards: same account, mismatched amount, same direction are rejected', async () => {
  const accounts = (await (await page.request.get(`${API}/accounts`)).json()) as Array<{
    id: string
    name: string
  }>
  const acctA = accounts.find((a) => a.name === 'Bank A')!.id
  const acctB = accounts.find((a) => a.name === 'Bank B')!.id

  const mk = async (data: Record<string, unknown>) => {
    const res = await page.request.post(`${API}/transactions`, {
      data: { date: '2026-07-20', merchant: 'guard', categoryId: null, ...data },
    })
    expect(res.status()).toBe(201)
    return (await res.json()).id as string
  }
  const link = (id: string, twinId: string) =>
    page.request.post(`${API}/transactions/${id}/link-transfer`, { data: { twinId } })

  // Same account.
  const e1 = await mk({ accountId: acctA, amount: 40, type: 'expense' })
  const i1 = await mk({ accountId: acctA, amount: 40, type: 'income' })
  let res = await link(e1, i1)
  expect(res.status()).toBe(400)
  expect((await res.json()).error).toContain('same account')

  // Mismatched amounts (fee/FX legs) are rejected in v1.
  const i2 = await mk({ accountId: acctB, amount: 39.5, type: 'income' })
  res = await link(e1, i2)
  expect(res.status()).toBe(400)
  expect((await res.json()).error).toContain('amounts differ')

  // Same direction.
  const e2 = await mk({ accountId: acctB, amount: 40, type: 'expense' })
  res = await link(e1, e2)
  expect(res.status()).toBe(400)
  expect((await res.json()).error).toContain('money-out')

  // Self-link.
  res = await link(e1, e1)
  expect(res.status()).toBe(400)
})

test('guard: a split transaction cannot be linked', async ({ browser }) => {
  // Two users in a group so a split can exist (same setup as spec 04).
  const aliceCtx = await browser.newContext()
  const bobCtx = await browser.newContext()
  const alice = await aliceCtx.newPage()
  const bob = await bobCtx.newPage()
  const ts = Date.now()
  const bobName = `bob_link_${ts}`

  await alice.request.post(`${API}/auth/signup`, { data: { username: `alice_link_${ts}`, password: 'test-password' } })
  await bob.request.post(`${API}/auth/signup`, { data: { username: bobName, password: 'test-password' } })
  const group = await (await alice.request.post(`${API}/groups`, { data: { name: 'LinkGroup' } })).json()
  await alice.request.post(`${API}/groups/${group.id}/invites`, { data: { username: bobName } })
  const invites = await (await bob.request.get(`${API}/invites`)).json()
  await bob.request.post(`${API}/invites/${invites[0].id}/accept`)
  const bobUser = (await (await bob.request.get(`${API}/auth/me`)).json()).user

  const mkAccount = async (name: string) =>
    (await alice.request.post(`${API}/accounts`, {
      data: { name, type: 'bank', currency: 'MYR', color: '#1D9E75', icon: 'wallet', openingBalance: 0 },
    })).json()
  const a = await mkAccount('Link A')
  const b = await mkAccount('Link B')

  const mk = async (data: Record<string, unknown>) =>
    (await (await alice.request.post(`${API}/transactions`, {
      data: { date: '2026-07-20', merchant: 'split-guard', categoryId: null, ...data },
    })).json()).id as string
  const expense = await mk({ accountId: a.id, amount: 60, type: 'expense' })
  const income = await mk({ accountId: b.id, amount: 60, type: 'income' })

  // Split the expense with Bob, then try to link it.
  const splitRes = await alice.request.post(`${API}/transactions/${expense}/split`, {
    data: { recipientId: bobUser.id, splitMode: 'equal' },
  })
  expect(splitRes.ok()).toBeTruthy()

  const res = await alice.request.post(`${API}/transactions/${expense}/link-transfer`, {
    data: { twinId: income },
  })
  expect(res.status()).toBe(409)
  expect((await res.json()).error).toContain('split')

  await aliceCtx.close()
  await bobCtx.close()
})
