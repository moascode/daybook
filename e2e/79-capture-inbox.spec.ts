/**
 * 79 — The capture inbox (R18 PR-4,
 * docs/v2/wallet/feature-capture-inbox.md §4.2, §5.2, §5.4, §5.5).
 *
 * The load-bearing assertion in here is the NEGATIVE one: opening the inbox
 * must make ZERO Anthropic-spending requests. ai-usage.md guardrail 2 forbids a
 * Claude call on anything but an explicit human action, and a page load is the
 * definition of a non-human trigger — A5 exists because exactly that slipped
 * into CSV import once already.
 */

import { test, expect, request as playwrightRequest } from '@playwright/test'
import type { APIRequestContext, Page } from '@playwright/test'
import { newAppPage, businessToday } from './helpers'

const API = '/api'

let seq = 0
const key = () => `inbox-${Date.now()}-${seq++}`

async function tokenFor(page: Page): Promise<string> {
  const res = await page.request.post(`${API}/capture-tokens`, { data: { label: 'Inbox spec' } })
  return (await res.json()).token
}

function capture(anon: APIRequestContext, token: string, data: Record<string, unknown>) {
  return anon.post(`${API}/capture/transaction`, {
    headers: { Authorization: `Bearer ${token}`, 'Idempotency-Key': key() },
    data,
  })
}

async function setup(browser: Parameters<typeof newAppPage>[0], baseURL: string | undefined) {
  const page = await newAppPage(browser)
  // Seeded over the API — this is setup, not the thing under test.
  const created = await page.request.post(`${API}/accounts`, {
    data: { name: 'Everyday', type: 'bank' },
  })
  expect(created.ok()).toBeTruthy()
  const token = await tokenFor(page)
  const anon = await playwrightRequest.newContext({ baseURL })
  return { page, token, anon }
}

test.describe('capture inbox', () => {
  test('shows a capture, accepts it into the ledger, and empties', async ({ browser, baseURL }) => {
    const { page, token, anon } = await setup(browser, baseURL)
    await capture(anon, token, { merchant: 'Starbucks', amount: 18.9, card: 'Visa 1234' })

    await page.goto('/wallet/inbox')
    await expect(page.getByTestId('capture-inbox-count')).toContainText('1 waiting')
    await expect(page.getByTestId('csv-review-row')).toHaveCount(1)
    // No card mapping yet, so the account is a fallback and says so.
    await expect(page.getByTestId('capture-row-unmapped')).toHaveCount(1)

    await page.getByTestId('capture-accept-btn').click()

    await expect(page.getByText('Nothing waiting')).toBeVisible()

    const txns = await (await page.request.get(`${API}/transactions`)).json()
    expect(txns).toHaveLength(1)
    expect(txns[0].merchant).toBe('Starbucks')
    expect(Number(txns[0].amount)).toBe(18.9)
    expect(txns[0].date).toBe(businessToday())

    // The pending row is marked, not deleted — the unique idempotency row is
    // what stops a retry re-capturing the same payment.
    expect(await (await page.request.get(`${API}/captures`)).json()).toHaveLength(0)
    await anon.dispose()
  })

  test('opening the inbox spends nothing on Claude', async ({ browser, baseURL }) => {
    const { page, token, anon } = await setup(browser, baseURL)
    await capture(anon, token, { merchant: 'Grab', amount: 12 })

    const paid: string[] = []
    await page.route('**/api/**', (route) => {
      const url = route.request().url()
      if (/suggest-categories-ai|parse-composer-ai|import-photo/.test(url)) paid.push(url)
      // The merchant ladder is shared: only a useAI:true body spends anything.
      if (url.includes('/merchants/resolve')) {
        const body = route.request().postDataJSON() as { useAI?: boolean } | null
        if (body?.useAI === true) paid.push(url)
      }
      return route.continue()
    })

    await page.goto('/wallet/inbox')
    await expect(page.getByTestId('csv-review-row')).toHaveCount(1)
    expect(paid, `paid AI calls on load: ${paid.join(', ')}`).toEqual([])
    await anon.dispose()
  })

  test('dismiss asks first and never reaches the ledger', async ({ browser, baseURL }) => {
    const { page, token, anon } = await setup(browser, baseURL)
    await capture(anon, token, { merchant: 'Mistake', amount: 3 })

    await page.goto('/wallet/inbox')
    await page.getByTestId('capture-dismiss-btn').click()
    await page.getByTestId('capture-dismiss-confirm').click()

    await expect(page.getByText('Nothing waiting')).toBeVisible()
    expect(await (await page.request.get(`${API}/transactions`)).json()).toHaveLength(0)
    await anon.dispose()
  })

  test('a transfer with no destination is refused with a reason', async ({ browser, baseURL }) => {
    const { page, token, anon } = await setup(browser, baseURL)
    await capture(anon, token, { merchant: 'Moved money', amount: 50, type: 'transfer' })

    await page.goto('/wallet/inbox')
    await page.getByTestId('capture-accept-btn').click()

    // Never silently downgraded to an expense (rule 13, spec §13.7).
    await expect(page.getByText(/needs a destination account/i)).toBeVisible()
    expect(await (await page.request.get(`${API}/transactions`)).json()).toHaveLength(0)
    await anon.dispose()
  })

  test('a mapped card files the row without a flag', async ({ browser, baseURL }) => {
    const { page, token, anon } = await setup(browser, baseURL)
    const accounts = await (await page.request.get(`${API}/accounts`)).json()
    await page.request.put(`${API}/settings/capture_card_map`, {
      data: { value: JSON.stringify({ 'Visa 1234': accounts[0].id }) },
    })
    await capture(anon, token, { merchant: 'Mapped', amount: 7, card: 'Visa 1234' })

    await page.goto('/wallet/inbox')
    await expect(page.getByTestId('csv-review-row')).toHaveCount(1)
    await expect(page.getByTestId('capture-row-unmapped')).toHaveCount(0)
    await anon.dispose()
  })

  test('the nav badge counts what is waiting', async ({ browser, baseURL }) => {
    const { page, token, anon } = await setup(browser, baseURL)
    await capture(anon, token, { merchant: 'One', amount: 1 })
    await capture(anon, token, { merchant: 'Two', amount: 2 })

    await page.goto('/wallet')
    await expect(page.getByTestId('capture-inbox-badge')).toHaveText('2')

    await page.goto('/wallet/inbox')
    await page.getByTestId('capture-accept-btn').click()
    await expect(page.getByText('Nothing waiting')).toBeVisible()
    await expect(page.getByTestId('capture-inbox-badge')).toHaveCount(0)
    await anon.dispose()
  })

  test('an empty inbox explains itself', async ({ browser }) => {
    const page = await newAppPage(browser)
    await page.goto('/wallet/inbox')
    await expect(page.getByText('Nothing waiting')).toBeVisible()
    await expect(page.getByText(/Connected devices/)).toBeVisible()
  })

  test('Settings lists the captured card and maps it', async ({ browser, baseURL }) => {
    const { page, token, anon } = await setup(browser, baseURL)
    await capture(anon, token, { merchant: 'Anything', amount: 4, card: 'Amex 9999' })

    await page.goto('/settings')
    const row = page.getByTestId('capture-card-row')
    await expect(row).toHaveCount(1)
    await expect(row).toContainText('Amex 9999')
    await expect(page.getByTestId('capture-last-seen')).toContainText('Last capture received today')

    await page.getByTestId('capture-card-account').selectOption({ label: 'Everyday' })

    // The mapping is persisted, so the inbox stops flagging the row.
    await page.goto('/wallet/inbox')
    await expect(page.getByTestId('capture-row-unmapped')).toHaveCount(0)
    await anon.dispose()
  })
})
