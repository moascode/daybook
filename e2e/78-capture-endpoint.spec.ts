/**
 * 78 — POST /api/capture/transaction (R18 PR-3,
 * docs/v2/wallet/feature-capture-inbox.md §5.1).
 *
 * The endpoint is the machine surface, so every test here drives it through a
 * cookie-less request context carrying only a bearer token — the same way a
 * shortcut or an agent reaches it. `page.request` is used only to mint the
 * token and to read the inbox back, both of which are the owner's own,
 * cookie-authenticated actions.
 */

import { test, expect, request as playwrightRequest } from '@playwright/test'
import type { APIRequestContext, Page } from '@playwright/test'
import { newAppPage, businessToday } from './helpers'

const API = '/api'

let seq = 0
const key = () => `spec-${Date.now()}-${seq++}`

async function tokenFor(page: Page, label = 'Spec device'): Promise<string> {
  const res = await page.request.post(`${API}/capture-tokens`, { data: { label } })
  expect(res.status()).toBe(201)
  return (await res.json()).token
}

function post(
  anon: APIRequestContext,
  token: string,
  data: Record<string, unknown>,
  idempotencyKey = key(),
) {
  return anon.post(`${API}/capture/transaction`, {
    headers: { Authorization: `Bearer ${token}`, 'Idempotency-Key': idempotencyKey },
    data,
  })
}

test.describe('capture endpoint', () => {
  test('captures a payment as pending and reports it back', async ({ browser, baseURL }) => {
    const page = await newAppPage(browser)
    const token = await tokenFor(page)
    const anon = await playwrightRequest.newContext({ baseURL })

    const res = await post(anon, token, { merchant: 'Starbucks', amount: 18.9, card: 'Visa 1234' })
    expect(res.status()).toBe(201)
    const body = await res.json()
    expect(body.status).toBe('pending')
    // The message goes straight into a phone notification — it must name the
    // merchant, the money, and how much is waiting.
    expect(body.message).toBe('Starbucks RM18.90 — 1 to review')

    // Nothing reached the ledger.
    const txns = await page.request.get(`${API}/transactions`)
    expect((await txns.json()).length ?? 0).toBe(0)

    // It is in the inbox instead, stamped today in the business timezone.
    const inbox = await (await page.request.get(`${API}/captures`)).json()
    expect(inbox).toHaveLength(1)
    expect(inbox[0].raw_merchant).toBe('Starbucks')
    expect(inbox[0].amount).toBe(18.9)
    expect(inbox[0].type).toBe('expense')
    expect(inbox[0].occurred_at).toBe(businessToday())

    await anon.dispose()
  })

  test('a replayed Idempotency-Key creates no second row', async ({ browser, baseURL }) => {
    const page = await newAppPage(browser)
    const token = await tokenFor(page)
    const anon = await playwrightRequest.newContext({ baseURL })
    const idem = key()

    const first = await post(anon, token, { merchant: 'Grab', amount: 12 }, idem)
    expect(first.status()).toBe(201)

    const replay = await post(anon, token, { merchant: 'Grab', amount: 12 }, idem)
    expect(replay.status()).toBe(200)
    expect((await replay.json()).status).toBe('duplicate')

    const inbox = await (await page.request.get(`${API}/captures`)).json()
    expect(inbox).toHaveLength(1)

    await anon.dispose()
  })

  test('two same-second same-amount payments both land when keys differ', async ({ browser, baseURL }) => {
    const page = await newAppPage(browser)
    const token = await tokenFor(page)
    const anon = await playwrightRequest.newContext({ baseURL })

    await post(anon, token, { merchant: 'Kopitiam', amount: 5 })
    await post(anon, token, { merchant: 'Kopitiam', amount: 5 })

    // Two RM5 coffees are a real thing. The random component of the key is
    // what stops them collapsing into one.
    expect(await (await page.request.get(`${API}/captures`)).json()).toHaveLength(2)
    await anon.dispose()
  })

  test('rejects a non-positive or non-numeric amount', async ({ browser, baseURL }) => {
    const page = await newAppPage(browser)
    const token = await tokenFor(page)
    const anon = await playwrightRequest.newContext({ baseURL })

    // 0.0 is the documented Apple bug; a decline arrives the same way.
    for (const amount of [0, -5, 'abc', null, undefined]) {
      const res = await post(anon, token, { merchant: 'X', amount })
      expect(res.status(), `amount=${String(amount)}`).toBe(400)
      expect((await res.json()).error).toContain('greater than zero')
    }
    expect(await (await page.request.get(`${API}/captures`)).json()).toHaveLength(0)
    await anon.dispose()
  })

  test('accepts an empty merchant rather than losing the payment', async ({ browser, baseURL }) => {
    const page = await newAppPage(browser)
    const token = await tokenFor(page)
    const anon = await playwrightRequest.newContext({ baseURL })

    const res = await post(anon, token, { merchant: '   ', amount: 9.5 })
    expect(res.status()).toBe(201)
    expect((await res.json()).message).toBe('Unnamed RM9.50 — 1 to review')

    const inbox = await (await page.request.get(`${API}/captures`)).json()
    expect(inbox[0].raw_merchant).toBe('')
    await anon.dispose()
  })

  test('requires an Idempotency-Key', async ({ browser, baseURL }) => {
    const page = await newAppPage(browser)
    const token = await tokenFor(page)
    const anon = await playwrightRequest.newContext({ baseURL })

    const res = await anon.post(`${API}/capture/transaction`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { merchant: 'X', amount: 1 },
    })
    expect(res.status()).toBe(400)
    await anon.dispose()
  })

  test('validates type and occurredAt', async ({ browser, baseURL }) => {
    const page = await newAppPage(browser)
    const token = await tokenFor(page)
    const anon = await playwrightRequest.newContext({ baseURL })

    const badType = await post(anon, token, { merchant: 'X', amount: 1, type: 'refund' })
    expect(badType.status()).toBe(400)

    const badDate = await post(anon, token, { merchant: 'X', amount: 1, occurredAt: 'last tuesday' })
    expect(badDate.status()).toBe(400)

    // Income and transfers are allowed (owner, 2026-09-07).
    for (const type of ['income', 'transfer']) {
      const ok = await post(anon, token, { merchant: 'X', amount: 1, type })
      expect(ok.status(), type).toBe(201)
    }

    const inbox = await (await page.request.get(`${API}/captures`)).json()
    expect(inbox.map((r: { type: string }) => r.type).sort()).toEqual(['income', 'transfer'])
    await anon.dispose()
  })

  test('honours a supplied occurredAt', async ({ browser, baseURL }) => {
    const page = await newAppPage(browser)
    const token = await tokenFor(page)
    const anon = await playwrightRequest.newContext({ baseURL })

    await post(anon, token, { merchant: 'Backdated', amount: 3, occurredAt: '2026-01-15T10:00:00+08:00' })
    const inbox = await (await page.request.get(`${API}/captures`)).json()
    expect(inbox[0].occurred_at).toBe('2026-01-15')
    await anon.dispose()
  })

  test('rejects an unauthenticated capture', async ({ baseURL }) => {
    const anon = await playwrightRequest.newContext({ baseURL })
    const res = await anon.post(`${API}/capture/transaction`, {
      headers: { 'Idempotency-Key': key() },
      data: { merchant: 'X', amount: 1 },
    })
    expect(res.status()).toBe(401)
    await anon.dispose()
  })

  test('one user never sees another user\'s captures', async ({ browser, baseURL }) => {
    const owner = await newAppPage(browser)
    const token = await tokenFor(owner)
    const anon = await playwrightRequest.newContext({ baseURL })
    await post(anon, token, { merchant: 'Private', amount: 42 })

    const other = await newAppPage(browser)
    expect(await (await other.request.get(`${API}/captures`)).json()).toHaveLength(0)
    expect(await (await owner.request.get(`${API}/captures`)).json()).toHaveLength(1)
    await anon.dispose()
  })

  test('enforces the per-token hourly cap', async ({ browser, baseURL }) => {
    const page = await newAppPage(browser)
    const token = await tokenFor(page, 'Chatty device')
    const anon = await playwrightRequest.newContext({ baseURL })

    // The cap is charged in the guard, so the cheap health route spends the
    // same budget the capture route does — which is the point.
    const headers = { Authorization: `Bearer ${token}` }
    for (let batch = 0; batch < 6; batch++) {
      await Promise.all(
        Array.from({ length: 10 }, () => anon.get(`${API}/capture/health`, { headers })),
      )
    }

    const over = await post(anon, token, { merchant: 'One too many', amount: 1 })
    expect(over.status()).toBe(429)
    expect((await over.json()).error).toContain('capture limit reached')

    // A second token on the same account is unaffected — the bucket is per
    // token, so one noisy device cannot silence another.
    const fresh = await tokenFor(page, 'Quiet device')
    const ok = await post(anon, fresh, { merchant: 'Still fine', amount: 1 })
    expect(ok.status()).toBe(201)

    await anon.dispose()
  })
})
