import { test, expect } from '@playwright/test'

// Split → settlement review flow (docs/split-settlement-plan.md).
// W1 covers §5.1 only: "All" genuinely means all, and the empty state names the
// filter that is actually hiding rows. Later waves append to this file.

test.describe.configure({ mode: 'serial' })

const API = 'http://localhost:5173/api'

/** Payer + recipient in one group, with one split transaction dated `date`. */
async function splitFixture(
  browser: import('@playwright/test').Browser,
  tag: string,
  date: string,
  amount = 100,
) {
  const payerCtx = await browser.newContext()
  const recipCtx = await browser.newContext()
  const payer = await payerCtx.newPage()
  const recip = await recipCtx.newPage()
  const ts = Date.now()
  const payerName = `pay_${tag}_${ts}`
  const recipName = `rec_${tag}_${ts}`

  await payer.request.post(`${API}/auth/signup`, { data: { username: payerName, password: 'test-password' } })
  await recip.request.post(`${API}/auth/signup`, { data: { username: recipName, password: 'test-password' } })
  const me = await recip.request.get(`${API}/auth/me`).then((r) => r.json()) as { user: { id: string } }

  const group = await payer.request.post(`${API}/groups`, { data: { name: `G_${tag}` } })
    .then((r) => r.json()) as { id: string }
  await payer.request.post(`${API}/groups/${group.id}/invites`, { data: { username: recipName } })
  const invites = await recip.request.get(`${API}/invites`).then((r) => r.json()) as { id: string }[]
  await recip.request.post(`${API}/invites/${invites[0].id}/accept`)

  const acct = await payer.request.post(`${API}/accounts`, {
    data: { name: 'Payer Card', type: 'card', currency: 'MYR', color: '#1D9E75', icon: 'wallet', openingBalance: 0 },
  }).then((r) => r.json()) as { id: string }
  const txn = await payer.request.post(`${API}/transactions`, {
    data: { accountId: acct.id, date, merchant: `M_${tag}`, amount, type: 'expense', tag: '[]' },
  }).then((r) => r.json()) as { id: string }
  const split = await payer.request.post(`${API}/transactions/${txn.id}/split`, {
    data: { recipientId: me.user.id, splitMode: 'none' },
  })
  expect(split.status()).toBe(201)

  return { payerCtx, recipCtx, payer, recip, group, acct, txn, merchant: `M_${tag}`, recipientId: me.user.id }
}

/** Two months back, from local date parts (never toISOString — shifts on UTC+). */
function priorMonthDate(): string {
  const now = new Date()
  const d = new Date(now.getFullYear(), now.getMonth() - 2, 15)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-15`
}

test.describe('52 — Split review (W1: visibility)', () => {
  // The core of §5.1. Before this, `all` covered own rows and rows on shared-in
  // accounts only — disjoint from the recipient's splits whenever no account has
  // been shared, which is the live state. The recipient's default view was empty
  // at every date range while "Shared with me" showed the rows.
  test('"All" includes transactions split with me', async ({ browser }) => {
    const f = await splitFixture(browser, 'allview', priorMonthDate())

    const all = await f.recip.request.get(`${API}/transactions`).then((r) => r.json()) as { merchant: string }[]
    expect(all.map((t) => t.merchant)).toContain(f.merchant)

    // The narrowing views still narrow — "All" is a superset, not a replacement.
    const mine = await f.recip.request.get(`${API}/transactions?view=mine`).then((r) => r.json()) as unknown[]
    expect(mine).toHaveLength(0)
    const sharedWithMe = await f.recip.request.get(`${API}/transactions?view=shared-with-me`)
      .then((r) => r.json()) as { merchant: string }[]
    expect(sharedWithMe.map((t) => t.merchant)).toEqual([f.merchant])

    await f.payerCtx.close()
    await f.recipCtx.close()
  })

  // The payer's own view must not change: their transaction is theirs in every
  // view it was in before, and splitting it does not duplicate it.
  test('splitting does not change what the payer sees', async ({ browser }) => {
    const f = await splitFixture(browser, 'payerview', priorMonthDate())

    const all = await f.payer.request.get(`${API}/transactions`).then((r) => r.json()) as { merchant: string }[]
    expect(all.filter((t) => t.merchant === f.merchant)).toHaveLength(1)
    const mine = await f.payer.request.get(`${API}/transactions?view=mine`).then((r) => r.json()) as { merchant: string }[]
    expect(mine.map((t) => t.merchant)).toContain(f.merchant)

    await f.payerCtx.close()
    await f.recipCtx.close()
  })

  // A non-member must not gain visibility from anyone else's split.
  test('a user outside the group sees nothing', async ({ browser }) => {
    const f = await splitFixture(browser, 'outsider', priorMonthDate())
    const outCtx = await browser.newContext()
    const out = await outCtx.newPage()
    await out.request.post(`${API}/auth/signup`, { data: { username: `out_${Date.now()}`, password: 'test-password' } })

    const all = await out.request.get(`${API}/transactions`).then((r) => r.json()) as unknown[]
    expect(all).toHaveLength(0)

    await outCtx.close()
    await f.payerCtx.close()
    await f.recipCtx.close()
  })

  // The empty state must name the filter that is actually responsible. Naming
  // the date range while the *view* is hiding the rows sends the user to a
  // button that changes nothing.
  test('the empty state names the sharing view, not just the date range', async ({ browser }) => {
    const f = await splitFixture(browser, 'emptystate', priorMonthDate())

    // view=mine + all time: the recipient owns nothing, so only the view is
    // narrowing. The date escape must not be offered as the cause.
    await f.recip.goto('/wallet?view=mine&range=all')
    await expect(f.recip.getByTestId('transactions-empty')).toBeVisible({ timeout: 20_000 })
    await expect(f.recip.getByTestId('transactions-empty')).toContainText('Mine')
    await expect(f.recip.getByTestId('empty-show-all-time')).toHaveCount(0)

    // Clearing the view reveals the split transaction — proving the view was the
    // cause and the offered escape is the one that works.
    await f.recip.getByTestId('empty-show-all-views').click()
    await expect(f.recip.getByText(f.merchant)).toBeVisible({ timeout: 10_000 })

    await f.payerCtx.close()
    await f.recipCtx.close()
  })

  // Both narrowings at once: the message names both and offers both escapes.
  test('the empty state names view and date range together', async ({ browser }) => {
    const f = await splitFixture(browser, 'bothnarrow', priorMonthDate())

    await f.recip.goto('/wallet?view=mine')
    await expect(f.recip.getByTestId('transactions-empty')).toBeVisible({ timeout: 20_000 })
    await expect(f.recip.getByTestId('transactions-empty')).toContainText('Mine')
    await expect(f.recip.getByTestId('transactions-empty')).toContainText('this month')
    await expect(f.recip.getByTestId('empty-show-all-time')).toBeVisible()
    await expect(f.recip.getByTestId('empty-show-all-views')).toBeVisible()

    await f.payerCtx.close()
    await f.recipCtx.close()
  })
})
