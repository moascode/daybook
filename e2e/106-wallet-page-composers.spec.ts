/**
 * 106 — PageComposer ports to Accounts and Shared (FEAT-065, FEAT-069's
 * composer half), and the Dashboard header "Settle up" quick action
 * (FEAT-064), docs/backlog/EP-06-wallet-depth/.
 *
 * Does not re-test the composer's own parsing/shortcuts/AI-fallback — that's
 * e2e/75-wallet-composer.spec.ts's job, and PageComposer only mounts the
 * existing Composer/TransactionForm/ImportModal wiring unchanged.
 */

import { test, expect } from '@playwright/test'
import type { Browser, Page } from '@playwright/test'
import { newAppPage, fillAccountForm, transactionRowFor, businessToday } from './helpers'

const API = '/api'

const composerInput = (page: Page) => page.getByLabel('Add a transaction')
const composerPreview = (page: Page) => page.getByTestId('composer-preview')

/** Fulfil the next matching request with a 500 + {error} body, once (mirrors
 *  e2e/32-wallet-error-toasts.spec.ts's own helper). */
async function force500Once(page: Page, urlGlob: string, method: string, errorMessage: string) {
  await page.route(urlGlob, async (route) => {
    if (route.request().method() !== method) return route.continue()
    await route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ error: errorMessage }),
    })
    await page.unroute(urlGlob)
  })
}

test.describe('106 — Accounts composer (FEAT-065)', () => {
  test('adds an expense and the account balance updates on the page', async ({ browser }: { browser: Browser }) => {
    const page = await newAppPage(browser, '/wallet/accounts')
    await page.getByRole('button', { name: 'Add Account' }).first().click()
    await fillAccountForm(page, { name: 'Pocket Cash', type: 'cash' })

    const card = page.getByTestId('account-card').filter({ hasText: 'Pocket Cash' })
    await expect(card.getByTestId('account-card-balance')).toContainText('0.00')

    // Rules-parser path (no API key needed) — same "merchant amount account"
    // shape e2e/75-wallet-composer.spec.ts already covers for /wallet.
    await expect(composerInput(page)).toBeVisible()
    await composerInput(page).fill('coffee 4.20 cash')
    await composerInput(page).press('Enter')
    await expect(composerPreview(page)).toContainText('coffee')
    await composerPreview(page).getByRole('button', { name: 'Confirm' }).click()

    // The composer's own confirm clears; the balance on THIS page (not just
    // /wallet) must reflect the new expense without a manual reload —
    // CLAUDE.md rule 10 / FEAT-065's own acceptance criterion.
    await expect(composerInput(page)).toHaveValue('')
    await expect(card.getByTestId('account-card-balance')).toContainText('4.20')
    await expect(card.getByTestId('account-card-balance')).not.toContainText('0.00')
    await page.context().close()
  })

  test('a failed submit surfaces a toast, not a silent no-op', async ({ browser }: { browser: Browser }) => {
    const page = await newAppPage(browser, '/wallet/accounts')
    await page.getByRole('button', { name: 'Add Account' }).first().click()
    await fillAccountForm(page, { name: 'Bank' })

    // Force the write to fail: the same 500-once pattern e2e/32's own error-
    // toast suite uses, exercising a real outage rather than a contrived one.
    await force500Once(page, `${API}/transactions`, 'POST', 'transaction save exploded')

    await composerInput(page).fill('coffee 4.20 bank')
    await composerInput(page).press('Enter')
    await composerPreview(page).getByRole('button', { name: 'Confirm' }).click()

    await expect(page.getByTestId('toast')).toContainText('transaction save exploded')
    await page.context().close()
  })
})

test.describe('106 — Shared composer (FEAT-069)', () => {
  test('is present on /wallet/shared and adds a transaction', async ({ browser }: { browser: Browser }) => {
    const ownerCtx = await browser.newContext()
    const memberCtx = await browser.newContext()
    const owner = await ownerCtx.newPage()
    const member = await memberCtx.newPage()
    const ts = Date.now()

    const ownerSignup = await owner.request.post(`${API}/auth/signup`, { data: { username: `owner_${ts}`, password: 'test-password' } })
    expect(ownerSignup.ok()).toBeTruthy()
    const memberSignup = await member.request.post(`${API}/auth/signup`, { data: { username: `member_${ts}`, password: 'test-password' } })
    expect(memberSignup.ok()).toBeTruthy()
    const memberUsername = await member.request.get(`${API}/auth/me`).then((r) => r.json())
      .then((m: { user: { username: string } }) => m.user.username)

    const groupRes = await owner.request.post(`${API}/groups`, { data: { name: `G_${ts}` } })
    expect(groupRes.ok()).toBeTruthy()
    const group = await groupRes.json() as { id: string }
    const inviteRes = await owner.request.post(`${API}/groups/${group.id}/invites`, { data: { username: memberUsername } })
    expect(inviteRes.ok()).toBeTruthy()
    const invites = await member.request.get(`${API}/invites`).then((r) => r.json()) as { id: string }[]
    const acceptRes = await member.request.post(`${API}/invites/${invites[0].id}/accept`)
    expect(acceptRes.ok()).toBeTruthy()

    // The owner's own account — composer visibility is gated on `accounts.length
    // > 0` (any account, own or shared-in), same guard WalletPage/Dashboard use.
    const acctRes = await owner.request.post(`${API}/accounts`, {
      data: { name: 'Card', type: 'card', currency: 'MYR', color: '#1D9E75', icon: 'wallet', openingBalance: 0 },
    })
    expect(acctRes.ok()).toBeTruthy()

    await owner.goto('/wallet/shared')
    await expect(composerInput(owner)).toBeVisible()

    await composerInput(owner).fill('groceries 30 card')
    await composerInput(owner).press('Enter')
    await expect(composerPreview(owner)).toContainText('groceries')
    await composerPreview(owner).getByRole('button', { name: 'Confirm' }).click()
    await expect(composerInput(owner)).toHaveValue('')

    // Confirm the write actually landed — check through the Transactions
    // page rather than asserting on SharedActivity (which only lists
    // claims/splits, not every transaction, per its own doc comment).
    await owner.goto('/wallet?range=all')
    await expect(transactionRowFor(owner, 'groceries')).toBeVisible()

    await ownerCtx.close()
    await memberCtx.close()
  })
})

/** Creates a group of two signed-up users + accepts the invite. Returns both
 *  pages' request contexts and identifying info for further setup. */
async function groupFixture(browser: Browser, tag: string) {
  const aCtx = await browser.newContext()
  const bCtx = await browser.newContext()
  const a = await aCtx.newPage()
  const b = await bCtx.newPage()
  const ts = Date.now()

  const aSignup = await a.request.post(`${API}/auth/signup`, { data: { username: `a_${tag}_${ts}`, password: 'test-password' } })
  expect(aSignup.ok()).toBeTruthy()
  const bSignup = await b.request.post(`${API}/auth/signup`, { data: { username: `b_${tag}_${ts}`, password: 'test-password' } })
  expect(bSignup.ok()).toBeTruthy()
  const aId = await a.request.get(`${API}/auth/me`).then((r) => r.json()).then((m: { user: { id: string } }) => m.user.id)
  const bId = await b.request.get(`${API}/auth/me`).then((r) => r.json()).then((m: { user: { id: string } }) => m.user.id)
  const bUsername = await b.request.get(`${API}/auth/me`).then((r) => r.json()).then((m: { user: { username: string } }) => m.user.username)

  const groupRes = await a.request.post(`${API}/groups`, { data: { name: `G_${tag}_${ts}` } })
  expect(groupRes.ok()).toBeTruthy()
  const group = await groupRes.json() as { id: string }
  const inviteRes = await a.request.post(`${API}/groups/${group.id}/invites`, { data: { username: bUsername } })
  expect(inviteRes.ok()).toBeTruthy()
  const invites = await b.request.get(`${API}/invites`).then((r) => r.json()) as { id: string }[]
  const acceptRes = await b.request.post(`${API}/invites/${invites[0].id}/accept`)
  expect(acceptRes.ok()).toBeTruthy()

  return { aCtx, bCtx, a, b, aId, bId, group }
}

test.describe('106 — Dashboard "Settle up" header action (FEAT-064)', () => {
  test('hidden for a solo user with no group and no pending claims', async ({ browser }: { browser: Browser }) => {
    // An account-less, transaction-less Dashboard renders only its EmptyState
    // (no page-head at all) — asserting absence there would pass regardless
    // of this feature. Create an account first so the real header renders,
    // then confirm the button is genuinely absent from it.
    const page = await newAppPage(browser, '/wallet/accounts')
    await page.getByRole('button', { name: 'Add Account' }).first().click()
    await fillAccountForm(page, { name: 'Solo Bank' })

    const [groupsRes] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/groups') && r.request().method() === 'GET'),
      page.goto('/wallet/dashboard'),
    ])
    expect(groupsRes.ok()).toBeTruthy()
    await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible()

    await expect(page.getByTestId('dashboard-settle-up')).toHaveCount(0)
    await page.context().close()
  })

  test('visible with no badge for a group member with nothing pending', async ({ browser }: { browser: Browser }) => {
    const { aCtx, bCtx, a } = await groupFixture(browser, 'nopending')

    // Dashboard.tsx renders only its EmptyState (no page-head at all) while
    // this user has zero accounts AND zero transactions — give `a` an
    // account so the real header, and the button inside it, actually render.
    const acctRes = await a.request.post(`${API}/accounts`, {
      data: { name: 'Card', type: 'card', currency: 'MYR', color: '#1D9E75', icon: 'wallet', openingBalance: 0 },
    })
    expect(acctRes.ok()).toBeTruthy()

    const [groupsRes] = await Promise.all([
      a.waitForResponse((r) => r.url().includes('/api/groups') && r.request().method() === 'GET'),
      a.goto('/wallet/dashboard'),
    ])
    expect(groupsRes.ok()).toBeTruthy()
    await expect(a.getByRole('heading', { name: 'Overview' })).toBeVisible()

    const settleUp = a.getByTestId('dashboard-settle-up')
    await expect(settleUp).toBeVisible()
    await expect(settleUp.getByTestId('settle-up-badge')).toHaveCount(0)

    await aCtx.close()
    await bCtx.close()
  })

  test('visible with a badge when a claim is pending, and navigates to /wallet/shared', async ({ browser }: { browser: Browser }) => {
    const { aCtx, bCtx, a: payer, b: recip, bId: recipientId } = await groupFixture(browser, 'pending')

    const payerAcctRes = await payer.request.post(`${API}/accounts`, {
      data: { name: 'Card', type: 'card', currency: 'MYR', color: '#1D9E75', icon: 'wallet', openingBalance: 0 },
    })
    expect(payerAcctRes.ok()).toBeTruthy()
    const payerAcct = await payerAcctRes.json() as { id: string }

    const txnRes = await payer.request.post(`${API}/transactions`, {
      data: {
        accountId: payerAcct.id,
        date: businessToday(),
        merchant: 'Shared dinner',
        description: '',
        amount: 100,
        type: 'expense',
        tag: '[]',
      },
    })
    expect(txnRes.ok()).toBeTruthy()
    const txn = await txnRes.json() as { id: string }

    const split = await payer.request.post(`${API}/transactions/${txn.id}/split`, {
      data: { recipientId, splitMode: 'none' },
    })
    expect(split.status()).toBe(201)

    // The recipient has one unresolved claim against them — the exact count
    // refreshClaimBadge() (src/lib/claim-badge.ts) computes — so the header
    // button must render WITH that badge.
    const [groupsRes] = await Promise.all([
      recip.waitForResponse((r) => r.url().includes('/api/groups') && r.request().method() === 'GET'),
      recip.goto('/wallet/dashboard'),
    ])
    expect(groupsRes.ok()).toBeTruthy()
    await expect(recip.getByRole('heading', { name: 'Overview' })).toBeVisible()

    const settleUp = recip.getByTestId('dashboard-settle-up')
    await expect(settleUp).toBeVisible()
    await expect(settleUp.getByTestId('settle-up-badge')).toHaveText('1')

    await settleUp.click()
    await expect(recip).toHaveURL(/\/wallet\/shared$/)

    await aCtx.close()
    await bCtx.close()
  })
})
