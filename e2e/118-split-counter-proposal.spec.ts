import { test, expect } from '@playwright/test'
import { businessDatePlus } from './helpers'

// Split review — counter-offer (docs/backlog split-review-improvements):
// a debtor rejecting a claim can propose a lower figure instead of walking
// away entirely, and the payer can accept it without a full re-split.

test.describe.configure({ mode: 'serial' })

const API = '/api'

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

test.describe('118 — Split counter-proposal', () => {
  test('debtor proposes a lower amount; payer sees and accepts it, and the share updates', async ({ browser }) => {
    const f = await splitFixture(browser, 'counter', businessDatePlus(-60), 100)

    const claims = await f.recip.request.get(`${API}/transactions/splits/mine?status=pending`)
      .then((r) => r.json()) as { id: string }[]
    const rej = await f.recip.request.post(`${API}/transactions/splits/${claims[0].id}/reject`, {
      data: { reason: 'too much for one dinner', proposedAmount: 40 },
    })
    expect(rej.ok()).toBeTruthy()

    await f.payer.goto('/wallet/shared')
    await expect(f.payer.locator('main')).toBeVisible({ timeout: 20_000 })
    await f.payer.getByRole('tab', { name: 'Rejected' }).click()
    const row = f.payer.getByTestId('split-row')
    await expect(row).toHaveCount(1, { timeout: 10_000 })
    await expect(row.getByTestId('split-row-proposed-amount')).toContainText('40.00')

    await row.getByTestId('claim-accept-proposal').click()

    // The claim now rests agreed (status 'approved') at the proposed figure,
    // and the rejection is cleared — so it is back under "Open", not "All"
    // only, at the new share amount.
    await f.payer.getByRole('tab', { name: 'Open' }).click()
    const openRow = f.payer.getByTestId('split-row')
    await expect(openRow).toHaveCount(1, { timeout: 10_000 })
    await expect(openRow.getByTestId('activity-row-status')).toHaveText('Agreed')
    await expect(openRow.getByTestId('split-row-amount')).toContainText('40.00')

    const splits = await f.payer.request.get(`${API}/transactions/${f.txn.id}/splits`)
      .then((r) => r.json()) as { user_id: string; share_amount: number; status: string; rejected_reason: string }[]
    const theirs = splits.find((s) => s.user_id === f.recipientId)
    expect(theirs?.status).toBe('approved')
    expect(Math.round((theirs?.share_amount ?? 0) * 100) / 100).toBe(40)
    expect(theirs?.rejected_reason ?? '').toBe('')

    await f.payerCtx.close()
    await f.recipCtx.close()
  })

  test('a proposal at or above the gross is caught client-side, before it reaches the server', async ({ browser }) => {
    const f = await splitFixture(browser, 'counterbad', businessDatePlus(-60), 100)
    await f.recip.goto('/wallet/shared')
    await expect(f.recip.locator('main')).toBeVisible({ timeout: 20_000 })
    await expect(f.recip.getByTestId('split-row')).toHaveCount(1, { timeout: 10_000 })

    await f.recip.getByTestId('claim-reject').click()
    await f.recip.locator('#reject-proposed-amount').fill('100')
    await f.recip.getByTestId('claim-reject-confirm').click()
    await expect(f.recip.getByTestId('proposed-amount-error')).toBeVisible({ timeout: 5000 })
    // Still open — the invalid submission never went anywhere; the claim is
    // still pending, not rejected.
    await expect(f.recip.getByRole('dialog')).toBeVisible()
    expect(await f.recip.request.get(`${API}/transactions/splits/mine?status=pending`)
      .then((r) => r.json())).toHaveLength(1)

    await f.payerCtx.close()
    await f.recipCtx.close()
  })

  test('only the payer sees an Accept action — the debtor who proposed it does not', async ({ browser }) => {
    const f = await splitFixture(browser, 'counterauth', businessDatePlus(-60), 100)
    const claims = await f.recip.request.get(`${API}/transactions/splits/mine?status=pending`)
      .then((r) => r.json()) as { id: string }[]
    await f.recip.request.post(`${API}/transactions/splits/${claims[0].id}/reject`, {
      data: { reason: 'nope', proposedAmount: 30 },
    })

    await f.recip.goto('/wallet/shared')
    await expect(f.recip.locator('main')).toBeVisible({ timeout: 20_000 })
    await f.recip.getByRole('tab', { name: 'Rejected' }).click()
    const row = f.recip.getByTestId('split-row')
    await expect(row).toHaveCount(1, { timeout: 10_000 })
    // The debtor sees their own proposal stated but has nothing to accept —
    // accepting your own counter-offer is meaningless.
    await expect(row.getByTestId('split-row-proposed-amount')).toContainText('30.00')
    await expect(row.getByTestId('claim-accept-proposal')).toHaveCount(0)

    await f.payerCtx.close()
    await f.recipCtx.close()
  })

  // The server validates the counter-offer against the claim's own share,
  // not the transaction's gross — distinguishable only once a split has been
  // divided unevenly, since the fixture's default ('none') makes them equal.
  test('a proposal at or above the claim\'s own share is refused, even when below the gross', async ({ browser }) => {
    const f = await splitFixture(browser, 'countershare', businessDatePlus(-60), 100)
    const resplit = await f.payer.request.post(`${API}/transactions/${f.txn.id}/split`, {
      data: { recipientId: f.recipientId, splitMode: 'equal' },
    })
    expect(resplit.status()).toBe(201)
    const claims = await f.recip.request.get(`${API}/transactions/splits/mine?status=pending`)
      .then((r) => r.json()) as { id: string; share_amount: number }[]
    expect(claims[0].share_amount).toBe(50)

    // 60 is below the RM100 gross but at/above this claim's own RM50 share.
    const bad = await f.recip.request.post(`${API}/transactions/splits/${claims[0].id}/reject`, {
      data: { reason: 'x', proposedAmount: 60 },
    })
    expect(bad.status()).toBe(400)

    await f.payerCtx.close()
    await f.recipCtx.close()
  })

  test('only the payer can accept a proposal — the debtor and a stranger both get 404', async ({ browser }) => {
    const f = await splitFixture(browser, 'counteraccept404', businessDatePlus(-60), 100)
    const claims = await f.recip.request.get(`${API}/transactions/splits/mine?status=pending`)
      .then((r) => r.json()) as { id: string }[]
    await f.recip.request.post(`${API}/transactions/splits/${claims[0].id}/reject`, {
      data: { reason: 'nope', proposedAmount: 30 },
    })

    // The debtor who proposed it cannot accept their own proposal.
    const byDebtor = await f.recip.request.post(`${API}/transactions/splits/${claims[0].id}/accept-proposal`, {})
    expect(byDebtor.status()).toBe(404)

    // Nor can a stranger — ids must not be probeable either way.
    const strangerCtx = await browser.newContext()
    const stranger = await strangerCtx.newPage()
    await stranger.request.post(`${API}/auth/signup`, { data: { username: `str_${Date.now()}`, password: 'test-password' } })
    const byStranger = await stranger.request.post(`${API}/transactions/splits/${claims[0].id}/accept-proposal`, {})
    expect(byStranger.status()).toBe(404)
    await strangerCtx.close()

    await f.payerCtx.close()
    await f.recipCtx.close()
  })

  test('accepting a proposal rewrites the payer\'s own row so both sides sum to the gross', async ({ browser }) => {
    const f = await splitFixture(browser, 'counterrewrite', businessDatePlus(-60), 100)
    const resplit = await f.payer.request.post(`${API}/transactions/${f.txn.id}/split`, {
      data: { recipientId: f.recipientId, splitMode: 'equal' },
    })
    expect(resplit.status()).toBe(201)
    const claims = await f.recip.request.get(`${API}/transactions/splits/mine?status=pending`)
      .then((r) => r.json()) as { id: string }[]
    await f.recip.request.post(`${API}/transactions/splits/${claims[0].id}/reject`, {
      data: { reason: 'too much', proposedAmount: 30 },
    })

    const accept = await f.payer.request.post(`${API}/transactions/splits/${claims[0].id}/accept-proposal`, {})
    expect(accept.ok()).toBeTruthy()

    const splits = await f.payer.request.get(`${API}/transactions/${f.txn.id}/splits`)
      .then((r) => r.json()) as { user_id: string; share_amount: number }[]
    const debtorRow = splits.find((s) => s.user_id === f.recipientId)
    const payerRow = splits.find((s) => s.user_id !== f.recipientId)
    expect(Math.round((debtorRow?.share_amount ?? 0) * 100) / 100).toBe(30)
    expect(Math.round((payerRow?.share_amount ?? 0) * 100) / 100).toBe(70)
    expect(Math.round(((debtorRow?.share_amount ?? 0) + (payerRow?.share_amount ?? 0)) * 100) / 100).toBe(100)

    await f.payerCtx.close()
    await f.recipCtx.close()
  })
})
