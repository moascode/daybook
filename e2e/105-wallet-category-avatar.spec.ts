/**
 * 105 — Transaction row avatar renders the category's icon/colour
 * (FEAT-063), and Shared's activity row does the same (FEAT-069's
 * "Activity icons" half).
 *
 * Both `TransactionList.tsx` and `SharedActivity.tsx` resolve a category's
 * `icon` name through the shared `src/lib/categoryIcon.tsx` lookup and stamp
 * `data-category-icon` with the RESOLVED icon key (never the category's raw,
 * possibly-bogus `icon` string) so these specs don't need to inspect which
 * lucide SVG rendered — just which icon *name* was resolved. CLAUDE.md §2
 * rule 10: an unresolved category must still render a neutral fallback,
 * never a blank avatar.
 */

import { test, expect } from '@playwright/test'
import type { APIResponse, Browser, Locator, Page } from '@playwright/test'
import { businessToday, fillAccountForm, fillTransactionForm, newAppPage, transactionRowFor } from './helpers'

const API = '/api'

function expectOk(res: APIResponse, label: string) {
  expect(res.ok(), `${label} failed: ${res.status()} ${res.statusText()}`).toBeTruthy()
}

interface SeededCategory {
  id: string
  name: string
  icon: string
}

async function getCategory(page: Page, name: string): Promise<SeededCategory> {
  const res = await page.request.get(`${API}/categories`)
  expectOk(res, 'GET /categories')
  const cats = (await res.json()) as SeededCategory[]
  const cat = cats.find((c) => c.name === name)
  if (!cat) throw new Error(`seeded category "${name}" not found`)
  return cat
}

/** Resolved `color` of an avatar's icon glyph — the `color` CSS property an
 * icon's `currentColor` stroke actually paints with, not the inline `style`
 * string (which we deliberately don't hardcode: `categoryTint` mixes toward
 * a theme token, so the literal rgb() is an implementation detail). */
async function avatarColor(avatar: Locator): Promise<string> {
  return avatar.evaluate((el) => getComputedStyle(el).color)
}

test.describe('TransactionList row avatar — category icon', () => {
  test('an expense with a seeded category shows that category\'s icon, coloured distinctly from the neutral fallback', async ({ browser }: { browser: Browser }) => {
    const page = await newAppPage(browser, '/wallet/accounts')
    await page.getByRole('button', { name: 'Add Account' }).first().click()
    await fillAccountForm(page, { name: 'Bank' })
    const foodDrink = await getCategory(page, 'Food & Drink')

    await page.goto('/wallet')
    await page.getByRole('button', { name: 'Expense' }).first().click()
    await fillTransactionForm(page, {
      amount: '12.50',
      merchant: 'Nasi Lemak Stall',
      date: businessToday(),
      category: foodDrink.name,
    })
    // And an uncategorised row in the same list, to compare colour against.
    await page.getByRole('button', { name: 'Expense' }).first().click()
    await fillTransactionForm(page, {
      amount: '7.70',
      merchant: 'Unlabeled Thing',
      date: businessToday(),
    })

    const categorised = transactionRowFor(page, 'Nasi Lemak Stall').getByTestId('tx-avatar')
    const neutral = transactionRowFor(page, 'Unlabeled Thing').getByTestId('tx-avatar')
    await expect(categorised).toHaveAttribute('data-category-icon', foodDrink.icon)
    await expect(neutral).toHaveAttribute('data-category-icon', 'none')

    // categoryTint mixes the category's own hex toward the theme's ink token
    // (src/index.css's --fg) rather than the raw hex, and the neutral
    // fallback uses the plain fg-faint/surface-sunken tokens — the two
    // should never land on the same computed colour.
    const [categorisedColor, neutralColor] = await Promise.all([avatarColor(categorised), avatarColor(neutral)])
    expect(categorisedColor).not.toBe(neutralColor)

    await page.context().close()
  })

  test('a transfer keeps the swap glyph, never a category icon', async ({ browser }: { browser: Browser }) => {
    const page = await newAppPage(browser, '/wallet/accounts')
    await page.getByRole('button', { name: 'Add Account' }).first().click()
    await fillAccountForm(page, { name: 'Bank A' })
    await page.getByRole('button', { name: 'Add Account' }).first().click()
    await fillAccountForm(page, { name: 'Bank B' })

    await page.goto('/wallet')
    await page.getByRole('button', { name: 'Expense' }).first().click()
    await fillTransactionForm(page, {
      type: 'Transfer',
      amount: '20',
      account: 'Bank A',
      toAccount: 'Bank B',
      merchant: 'Move funds',
      date: businessToday(),
    })

    const avatar = transactionRowFor(page, 'Move funds').getByTestId('tx-avatar')
    await expect(avatar).toHaveAttribute('data-category-icon', 'transfer')
    await page.context().close()
  })

  test('an uncategorised expense falls back to a neutral icon, never a blank avatar', async ({ browser }: { browser: Browser }) => {
    const page = await newAppPage(browser, '/wallet/accounts')
    await page.getByRole('button', { name: 'Add Account' }).first().click()
    await fillAccountForm(page, { name: 'Bank' })

    await page.goto('/wallet')
    await page.getByRole('button', { name: 'Expense' }).first().click()
    await fillTransactionForm(page, {
      amount: '7.70',
      merchant: 'Unlabeled Thing',
      date: businessToday(),
      // No category selected — TransactionForm defaults to none.
    })

    const avatar = transactionRowFor(page, 'Unlabeled Thing').getByTestId('tx-avatar')
    await expect(avatar).toHaveAttribute('data-category-icon', 'none')
    // The fallback is a real icon, not an empty div.
    await expect(avatar.locator('svg')).toHaveCount(1)
    await page.context().close()
  })
})

test.describe('SharedActivity row avatar — category icon', () => {
  test('a split row shows the underlying transaction\'s category icon', async ({ browser }: { browser: Browser }) => {
    const payerCtx = await browser.newContext()
    const recipCtx = await browser.newContext()
    const payer = await payerCtx.newPage()
    const recip = await recipCtx.newPage()
    const ts = Date.now()
    const payerName = `payer_${ts}`
    const recipName = `recip_${ts}`

    expectOk(await payer.request.post(`${API}/auth/signup`, { data: { username: payerName, password: 'test-password' } }), 'payer signup')
    expectOk(await recip.request.post(`${API}/auth/signup`, { data: { username: recipName, password: 'test-password' } }), 'recipient signup')

    const groupRes = await payer.request.post(`${API}/groups`, { data: { name: `G_${ts}` } })
    expectOk(groupRes, 'create group')
    const group = (await groupRes.json()) as { id: string }

    expectOk(await payer.request.post(`${API}/groups/${group.id}/invites`, { data: { username: recipName } }), 'invite recipient')

    const invitesRes = await recip.request.get(`${API}/invites`)
    expectOk(invitesRes, 'GET /invites')
    const invites = (await invitesRes.json()) as { id: string }[]
    expect(invites.length, 'recipient has a pending invite').toBeGreaterThan(0)
    expectOk(await recip.request.post(`${API}/invites/${invites[0].id}/accept`), 'accept invite')

    const acctRes = await payer.request.post(`${API}/accounts`, {
      data: { name: 'Card', type: 'card', currency: 'MYR', color: '#1D9E75', icon: 'wallet', openingBalance: 0 },
    })
    expectOk(acctRes, 'create payer account')
    const payerAcct = (await acctRes.json()) as { id: string }

    const foodDrink = await getCategory(payer, 'Food & Drink')

    const txnRes = await payer.request.post(`${API}/transactions`, {
      data: {
        accountId: payerAcct.id,
        date: businessToday(),
        merchant: 'Weekly groceries',
        description: '',
        amount: 100,
        type: 'expense',
        categoryId: foodDrink.id,
        tag: '[]',
      },
    })
    expectOk(txnRes, 'create transaction')
    const txn = (await txnRes.json()) as { id: string }

    const meRes = await recip.request.get(`${API}/auth/me`)
    expectOk(meRes, 'GET /auth/me (recipient)')
    const recipientId = ((await meRes.json()) as { user: { id: string } }).user.id

    expectOk(
      await payer.request.post(`${API}/transactions/${txn.id}/split`, { data: { recipientId, splitMode: 'none' } }),
      'split transaction',
    )

    // GET /categories is scoped to the caller's own categories, so a local
    // `categories` lookup would never resolve for the recipient (debtor
    // side) — they don't own `foodDrink`. GET /transactions/splits/mine now
    // carries the category icon/colour on the claim itself (LEFT JOIN onto
    // the transaction's own category, worker/routes/wallet.ts), which
    // resolves regardless of which side is viewing. Asserting from the
    // recipient's debtor-side row exercises exactly that path.
    await recip.goto('/wallet/shared')
    await expect(recip.getByTestId('shared-activity')).toBeVisible()

    const row = recip.getByTestId('split-row').filter({ hasText: 'Weekly groceries' })
    await expect(row).toBeVisible()
    await expect(row.getByTestId('activity-avatar')).toHaveAttribute('data-category-icon', foodDrink.icon)

    await payerCtx.close()
    await recipCtx.close()
  })

  test('an uncategorised split keeps the existing Receipt fallback, never a blank avatar', async ({ browser }: { browser: Browser }) => {
    const payerCtx = await browser.newContext()
    const recipCtx = await browser.newContext()
    const payer = await payerCtx.newPage()
    const recip = await recipCtx.newPage()
    const ts = Date.now()
    const payerName = `payer2_${ts}`
    const recipName = `recip2_${ts}`

    expectOk(await payer.request.post(`${API}/auth/signup`, { data: { username: payerName, password: 'test-password' } }), 'payer signup')
    expectOk(await recip.request.post(`${API}/auth/signup`, { data: { username: recipName, password: 'test-password' } }), 'recipient signup')

    const groupRes = await payer.request.post(`${API}/groups`, { data: { name: `G2_${ts}` } })
    expectOk(groupRes, 'create group')
    const group = (await groupRes.json()) as { id: string }

    expectOk(await payer.request.post(`${API}/groups/${group.id}/invites`, { data: { username: recipName } }), 'invite recipient')

    const invitesRes = await recip.request.get(`${API}/invites`)
    expectOk(invitesRes, 'GET /invites')
    const invites = (await invitesRes.json()) as { id: string }[]
    expect(invites.length, 'recipient has a pending invite').toBeGreaterThan(0)
    expectOk(await recip.request.post(`${API}/invites/${invites[0].id}/accept`), 'accept invite')

    const acctRes = await payer.request.post(`${API}/accounts`, {
      data: { name: 'Cash', type: 'cash', currency: 'MYR', color: '#1D9E75', icon: 'wallet', openingBalance: 0 },
    })
    expectOk(acctRes, 'create payer account')
    const payerAcct = (await acctRes.json()) as { id: string }

    const txnRes = await payer.request.post(`${API}/transactions`, {
      data: {
        accountId: payerAcct.id,
        date: businessToday(),
        merchant: 'Unsorted shared cost',
        description: '',
        amount: 40,
        type: 'expense',
        tag: '[]',
      },
    })
    expectOk(txnRes, 'create transaction')
    const txn = (await txnRes.json()) as { id: string }

    const meRes = await recip.request.get(`${API}/auth/me`)
    expectOk(meRes, 'GET /auth/me (recipient)')
    const recipientId = ((await meRes.json()) as { user: { id: string } }).user.id

    expectOk(
      await payer.request.post(`${API}/transactions/${txn.id}/split`, { data: { recipientId, splitMode: 'none' } }),
      'split transaction',
    )

    await recip.goto('/wallet/shared')
    const row = recip.getByTestId('split-row').filter({ hasText: 'Unsorted shared cost' })
    await expect(row).toBeVisible()
    const avatar = row.getByTestId('activity-avatar')
    await expect(avatar).toHaveAttribute('data-category-icon', 'none')
    await expect(avatar.locator('svg')).toHaveCount(1)

    await payerCtx.close()
    await recipCtx.close()
  })
})
