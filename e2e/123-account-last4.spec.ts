/**
 * Account `last4` — a short card-disambiguator the owner can set on an
 * account (worker/routes/wallet.ts, migration 0033_account_last4_rules.sql).
 * API coverage only here; the backend half of the feature. The client agent
 * fills in the UI section below.
 */

import { test, expect } from '@playwright/test'
import { newAppPage, fillAccountForm } from './helpers'
import type { Page } from '@playwright/test'

test.describe.configure({ mode: 'serial' })

const API = '/api'

async function createAccount(page: Page, extra: Record<string, unknown> = {}) {
  return page.request.post(`${API}/accounts`, {
    data: { name: 'Card', type: 'card', currency: 'MYR', color: '#1D9E75', icon: 'wallet', openingBalance: 0, ...extra },
  })
}

// ── API ──────────────────────────────────────────────────────────────────

test.describe('123 — Account last4 (API)', () => {
  let page: Page

  test.beforeAll(async ({ browser }) => {
    page = await newAppPage(browser, '/wallet/accounts')
  })

  test.afterAll(async () => {
    await page.context().close()
  })

  test('POST /accounts accepts a blank last4', async () => {
    const res = await createAccount(page, { last4: '' })
    expect(res.status()).toBe(201)
    const row = await res.json()
    expect(row.last4).toBe('')
  })

  test('POST /accounts accepts exactly 4 digits', async () => {
    const res = await createAccount(page, { last4: '1234' })
    expect(res.status()).toBe(201)
    const row = await res.json()
    expect(row.last4).toBe('1234')
  })

  test('POST /accounts rejects a non-4-digit last4', async () => {
    for (const bad of ['123', '12345', 'abcd', '12a4']) {
      const res = await createAccount(page, { last4: bad })
      expect(res.status()).toBe(400)
      const body = await res.json()
      expect(body.error).toBe('last 4 digits must be exactly 4 digits')
    }
  })

  test('POST /accounts rejects a last4 already used by another of the caller\'s own accounts', async () => {
    await (await createAccount(page, { last4: '5566' })).json()
    const res = await createAccount(page, { last4: '5566' })
    expect(res.status()).toBe(409)
    const body = await res.json()
    expect(body.error).toBe('Another of your accounts already uses ••5566')
  })

  test('PATCH /accounts/:id validates and rejects a duplicate last4 the same way', async () => {
    const a = await (await createAccount(page, { last4: '7788' })).json() as { id: string }
    const b = await (await createAccount(page, { last4: '' })).json() as { id: string }

    const badFormat = await page.request.patch(`${API}/accounts/${b.id}`, { data: { last4: '99' } })
    expect(badFormat.status()).toBe(400)

    const dup = await page.request.patch(`${API}/accounts/${b.id}`, { data: { last4: '7788' } })
    expect(dup.status()).toBe(409)

    // Patching an account to its OWN existing last4 is not a collision with itself.
    const self = await page.request.patch(`${API}/accounts/${a.id}`, { data: { last4: '7788' } })
    expect(self.status()).toBe(200)
  })

  test('a last4 collision across two different users is allowed', async ({ browser }) => {
    const other = await newAppPage(browser, '/wallet/accounts')
    const mine = await createAccount(page, { last4: '4321' })
    expect(mine.status()).toBe(201)
    const theirs = await createAccount(other, { last4: '4321' })
    expect(theirs.status()).toBe(201)
    await other.context().close()
  })

  test('GET /accounts returns last4 on the caller\'s own accounts', async () => {
    const created = await (await createAccount(page, { last4: '2468' })).json() as { id: string }
    const list = await page.request.get(`${API}/accounts`).then((r) => r.json()) as { id: string; last4: string }[]
    const found = list.find((a) => a.id === created.id)
    expect(found?.last4).toBe('2468')
  })

  test('GET /accounts returns last4 on a shared-in account too', async ({ browser }) => {
    const ownerCtx = await browser.newContext()
    const owner = await ownerCtx.newPage()
    const ts = Date.now()
    const ownerName = `last4_owner_${ts}`
    const viewerName = `last4_viewer_${ts}`
    await owner.request.post(`${API}/auth/signup`, { data: { username: ownerName, password: 'test-password' } })

    const viewerCtx = await browser.newContext()
    const viewer = await viewerCtx.newPage()
    // The invitee must already exist before a username-based invite can
    // target them (worker/routes/groups.ts) — sign up before inviting.
    await viewer.request.post(`${API}/auth/signup`, { data: { username: viewerName, password: 'test-password' } })

    const group = await owner.request.post(`${API}/groups`, { data: { name: `G_last4_${ts}` } }).then((r) => r.json()) as { id: string }
    await owner.request.post(`${API}/groups/${group.id}/invites`, { data: { username: viewerName } })

    const invites = await viewer.request.get(`${API}/invites`).then((r) => r.json()) as { id: string }[]
    await viewer.request.post(`${API}/invites/${invites[0].id}/accept`)

    const acct = await owner.request.post(`${API}/accounts`, {
      data: { name: 'Shared Card', type: 'card', currency: 'MYR', color: '#1D9E75', icon: 'wallet', openingBalance: 0, last4: '9999' },
    }).then((r) => r.json()) as { id: string }
    await owner.request.post(`${API}/accounts/${acct.id}/shares`, { data: { groupId: group.id, canWrite: false } })

    const list = await viewer.request.get(`${API}/accounts`).then((r) => r.json()) as { id: string; last4: string; is_shared: number }[]
    const shared = list.find((a) => a.id === acct.id)
    expect(shared?.last4).toBe('9999')
    expect(shared?.is_shared).toBe(1)

    await ownerCtx.close()
    await viewerCtx.close()
  })
})

// ── UI ───────────────────────────────────────────────────────────────────

test.describe('123 — Account last4 (UI)', () => {
  test('setting last4 in the account form shows it on the account card', async ({ browser }) => {
    const page = await newAppPage(browser, '/wallet/accounts')
    await page.getByRole('button', { name: 'Add Account' }).first().click()
    await fillAccountForm(page, { name: 'Visa Everyday', type: 'card', last4: '4321' })

    await expect(page.locator('[data-testid="account-card"]').filter({ hasText: 'Visa Everyday' })).toContainText('••4321')
    await page.context().close()
  })

  test('an invalid last4 shows the validation message inline and keeps the dialog open', async ({ browser }) => {
    const page = await newAppPage(browser, '/wallet/accounts')
    await page.getByRole('button', { name: 'Add Account' }).first().click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Account Name').fill('Bad Last4')
    await dialog.getByLabel('Last 4 digits').fill('12')
    // AccountForm validates the shape client-side before ever reaching the
    // server, using the identical message — so this never needs a 400 at all.
    await dialog.getByRole('button', { name: 'Create Account' }).click()
    await expect(dialog.getByText('last 4 digits must be exactly 4 digits')).toBeVisible()
    await expect(dialog).toBeVisible()
    await page.context().close()
  })

  test('a duplicate last4 on save shows the server 409 message inline', async ({ browser }) => {
    const page = await newAppPage(browser, '/wallet/accounts')
    await page.getByRole('button', { name: 'Add Account' }).first().click()
    await fillAccountForm(page, { name: 'First Card', type: 'card', last4: '1111' })

    await page.getByRole('button', { name: 'Add Account' }).first().click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Account Name').fill('Second Card')
    await dialog.getByLabel('Type').selectOption('card')
    await dialog.getByLabel('Last 4 digits').fill('1111')
    await dialog.getByRole('button', { name: 'Create Account' }).click()
    await expect(dialog.getByText('Another of your accounts already uses ••1111')).toBeVisible()
    await page.context().close()
  })

  test('a capture whose card ends in a mapped account\'s last4 lands there without the unmapped flag', async ({ browser, baseURL }) => {
    const { request: playwrightRequest } = await import('@playwright/test')
    const page = await newAppPage(browser, '/wallet/accounts')
    await page.getByRole('button', { name: 'Add Account' }).first().click()
    await fillAccountForm(page, { name: 'Maybank Visa', type: 'card', last4: '9876' })

    const accounts = await (await page.request.get(`${API}/accounts`)).json() as { id: string; name: string }[]
    const accountId = accounts.find((a) => a.name === 'Maybank Visa')!.id

    const tokenRes = await page.request.post(`${API}/capture-tokens`, { data: { label: 'last4 spec device' } })
    const { token } = await tokenRes.json()
    const anon = await playwrightRequest.newContext({ baseURL })
    const res = await anon.post(`${API}/capture/transaction`, {
      headers: { Authorization: `Bearer ${token}`, 'Idempotency-Key': `last4-ui-${Date.now()}` },
      data: { merchant: 'Grab', amount: 14.5, card: 'Visa 9876' },
    })
    expect(res.status()).toBe(201)

    await page.goto('/wallet/inbox')
    await expect(page.getByTestId('capture-inbox-count')).toContainText('1 waiting')
    await expect(page.getByTestId('capture-row-unmapped')).toHaveCount(0)
    await expect(page.getByLabel('Account for row 1')).toHaveValue(accountId)
    await page.context().close()
  })

  test('Settings → Wallet shows the auto-match text for a seen card with no explicit mapping', async ({ browser, baseURL }) => {
    const { request: playwrightRequest } = await import('@playwright/test')
    const page = await newAppPage(browser, '/wallet/accounts')
    await page.getByRole('button', { name: 'Add Account' }).first().click()
    await fillAccountForm(page, { name: 'Autolink Bank', type: 'card', last4: '6543' })

    // A capture makes the raw card string "seen" (GET /captures/cards) —
    // #14 must not call this "Not mapped" just because nobody explicitly
    // entered it into the card map; it resolves via last4, same as the inbox.
    const tokenRes = await page.request.post(`${API}/capture-tokens`, { data: { label: 'card-map spec device' } })
    const { token } = await tokenRes.json()
    const anon = await playwrightRequest.newContext({ baseURL })
    await anon.post(`${API}/capture/transaction`, {
      headers: { Authorization: `Bearer ${token}`, 'Idempotency-Key': `card-map-ui-${Date.now()}` },
      data: { merchant: 'Some Shop', amount: 9, card: 'Debit 6543' },
    })

    await page.goto('/settings/wallet')
    const row = page.locator('[data-testid="capture-card-row"]').filter({ hasText: 'Debit 6543' })
    await expect(row.getByTestId('capture-card-auto-match')).toHaveText('Matched by ••6543 → Autolink Bank')
    // The select itself still reads "Override", not "Not mapped" — nothing
    // was explicitly entered, but something IS happening.
    await expect(row.getByTestId('capture-card-account')).toHaveValue('')
    await expect(row.getByTestId('capture-card-account').locator('option').first()).toHaveText('Override')

    await page.context().close()
  })
})
