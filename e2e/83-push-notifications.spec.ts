/**
 * 83 — Push notifications (v3 P4, docs/v3/release-plan.md#p4).
 *
 * Real push delivery is not testable here: it needs a live push service and a
 * browser Apple or Google controls. What IS testable — and where the actual
 * risk lives — is the decision layer: what Daybook considers worth
 * interrupting you about, and whether the subscription lifecycle is sound.
 *
 * The notification COUNTS matter more than they look. They are money and task
 * figures, computed with EFFECTIVE_AMOUNT_SQL rather than raw amounts, so a
 * split transaction must not be reported at its gross.
 */

import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import { newAppPage, businessToday } from './helpers'

const API = '/api'

async function seedAccount(page: Page, name = 'Main'): Promise<string> {
  const res = await page.request.post(`${API}/accounts`, { data: { name, type: 'bank' } })
  return (await res.json()).id as string
}
function pending(page: Page) {
  return page.request.get(`${API}/notifications/pending`).then((r) => r.json())
}

test.describe('push subscription lifecycle', () => {
  test('reports its configuration', async ({ browser }) => {
    const page = await newAppPage(browser)
    const cfg = await (await page.request.get(`${API}/notifications/config`)).json()
    expect(cfg.enabled).toBe(true)
    expect(cfg.publicKey).toMatch(/^B[A-Za-z0-9_-]{80,}$/)
  })

  test('subscribes, reports itself subscribed, and unsubscribes', async ({ browser }) => {
    const page = await newAppPage(browser)
    const endpoint = `https://push.example.com/sub/${Date.now()}`

    expect(
      (await (await page.request.get(`${API}/notifications/subscription?endpoint=${encodeURIComponent(endpoint)}`)).json())
        .subscribed,
    ).toBe(false)

    const sub = await page.request.post(`${API}/notifications/subscribe`, {
      data: { endpoint, keys: { p256dh: 'p', auth: 'a' } },
    })
    expect(sub.status()).toBe(201)

    expect(
      (await (await page.request.get(`${API}/notifications/subscription?endpoint=${encodeURIComponent(endpoint)}`)).json())
        .subscribed,
    ).toBe(true)

    // Re-subscribing the same browser must update, not duplicate.
    expect((await page.request.post(`${API}/notifications/subscribe`, { data: { endpoint, keys: {} } })).status()).toBe(201)

    await page.request.post(`${API}/notifications/unsubscribe`, { data: { endpoint } })
    expect(
      (await (await page.request.get(`${API}/notifications/subscription?endpoint=${encodeURIComponent(endpoint)}`)).json())
        .subscribed,
    ).toBe(false)
  })

  test('rejects a subscription with no endpoint', async ({ browser }) => {
    const page = await newAppPage(browser)
    expect((await page.request.post(`${API}/notifications/subscribe`, { data: {} })).status()).toBe(400)
    expect(
      (await page.request.post(`${API}/notifications/subscribe`, { data: { endpoint: 'not-a-url' } })).status(),
    ).toBe(400)
  })

  test("one user cannot delete another's subscription", async ({ browser }) => {
    const owner = await newAppPage(browser)
    const endpoint = `https://push.example.com/sub/private-${Date.now()}`
    await owner.request.post(`${API}/notifications/subscribe`, { data: { endpoint, keys: {} } })

    const other = await newAppPage(browser)
    await other.request.post(`${API}/notifications/unsubscribe`, { data: { endpoint } })

    expect(
      (await (await owner.request.get(`${API}/notifications/subscription?endpoint=${encodeURIComponent(endpoint)}`)).json())
        .subscribed,
      "the owner's subscription must survive another account's unsubscribe",
    ).toBe(true)
  })
})

test.describe('what Daybook decides to say', () => {
  test('says nothing when there is nothing to say', async ({ browser }) => {
    const page = await newAppPage(browser)
    const { notifications } = await pending(page)
    // A fresh account: no tasks, no captures, no budgets, no spend. A digest
    // that arrives regardless is one you learn to ignore.
    expect(notifications.filter((n: { kind: string }) => n.kind !== 'spend')).toEqual([])
  })

  test('counts overdue and due-today tasks, and ignores completed ones', async ({ browser }) => {
    const page = await newAppPage(browser)
    await page.request.post(`${API}/tasks`, { data: { content: 'Due today', dueDate: businessToday() } })
    await page.request.post(`${API}/tasks`, { data: { content: 'No due date' } })

    const { notifications } = await pending(page)
    const task = notifications.find((n: { kind: string }) => n.kind === 'tasks')
    expect(task, 'a task due today should be reported').toBeTruthy()
    expect(task.title).toBe('1 task due')
  })

  test('reports captures waiting to review', async ({ browser }) => {
    const page = await newAppPage(browser)
    const tok = await (await page.request.post(`${API}/capture-tokens`, { data: { label: 'Push spec' } })).json()

    for (const merchant of ['One', 'Two']) {
      await page.request.post(`${API}/capture/transaction`, {
        headers: { Authorization: `Bearer ${tok.token}`, 'Idempotency-Key': `push-${merchant}-${Date.now()}` },
        data: { merchant, amount: 5 },
      })
    }

    const { notifications } = await pending(page)
    const cap = notifications.find((n: { kind: string }) => n.kind === 'captures')
    expect(cap.title).toBe('2 payments to review')
    expect(cap.url).toBe('/wallet/inbox')
  })

  test('warns about capture silence only when a device is actually set up', async ({ browser }) => {
    const noDevice = await newAppPage(browser)
    expect(
      (await pending(noDevice)).notifications.find((n: { kind: string }) => n.kind === 'silence'),
      'someone who never set capture up is not "silent" — telling them so is noise',
    ).toBeUndefined()

    const withDevice = await newAppPage(browser)
    await withDevice.request.post(`${API}/capture-tokens`, { data: { label: 'Silent phone' } })
    const silence = (await pending(withDevice)).notifications.find((n: { kind: string }) => n.kind === 'silence')
    expect(silence, 'a token with no captures ever is the case worth warning about').toBeTruthy()
    expect(silence.url).toBe('/settings')
  })

  test('reports a budget at or past 90%, and stays quiet below it', async ({ browser }) => {
    const page = await newAppPage(browser)
    const accountId = await seedAccount(page)
    const categories = await (await page.request.get(`${API}/categories`)).json()
    const food = categories.find((c: { name: string }) => c.name === 'Food & Drink')

    await page.request.post(`${API}/budgets`, { data: { categoryId: food.id, limitAmount: 100 } })
    await page.request.post(`${API}/transactions`, {
      data: { accountId, date: businessToday(), merchant: 'Half', amount: 50, type: 'expense', categoryId: food.id },
    })
    expect(
      (await pending(page)).notifications.find((n: { kind: string }) => n.kind === 'budget'),
      '50% is not worth interrupting anyone',
    ).toBeUndefined()

    await page.request.post(`${API}/transactions`, {
      data: { accountId, date: businessToday(), merchant: 'Rest', amount: 41, type: 'expense', categoryId: food.id },
    })
    const budget = (await pending(page)).notifications.find((n: { kind: string }) => n.kind === 'budget')
    expect(budget.title).toBe('Food & Drink is at 91%')
  })

  test("the evening summary totals today's spend", async ({ browser }) => {
    const page = await newAppPage(browser)
    const accountId = await seedAccount(page)
    await page.request.post(`${API}/transactions`, {
      data: { accountId, date: businessToday(), merchant: 'Lunch', amount: 12.5, type: 'expense' },
    })
    await page.request.post(`${API}/transactions`, {
      data: { accountId, date: businessToday(), merchant: 'Coffee', amount: 7.5, type: 'expense' },
    })
    // Income must not offset the spend figure.
    await page.request.post(`${API}/transactions`, {
      data: { accountId, date: businessToday(), merchant: 'Salary', amount: 1000, type: 'income' },
    })

    const spend = (await pending(page)).notifications.find((n: { kind: string }) => n.kind === 'spend')
    expect(spend.title).toBe('RM20.00 spent today')
    expect(spend.body).toBe('Across 2 transactions.')
  })

  test('requires a session — a push endpoint is not a way in', async ({ playwright, baseURL }) => {
    const anon = await playwright.request.newContext({ baseURL })
    expect((await anon.get(`${API}/notifications/pending`)).status()).toBe(401)
    expect((await anon.post(`${API}/notifications/subscribe`, { data: { endpoint: 'https://x.example/1' } })).status()).toBe(401)
    await anon.dispose()
  })
})
