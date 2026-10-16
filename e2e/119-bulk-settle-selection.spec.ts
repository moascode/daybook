import { test, expect } from '@playwright/test'
import { businessDatePlus } from './helpers'

// Split review — multi-select settle (docs/backlog split-review-improvements):
// a debtor can select several of their own owed rows and settle exactly that
// subset in one go, as long as the selection is coherent (same counterparty,
// all debts they owe, all still open).

test.describe.configure({ mode: 'serial' })

const API = '/api'

/** Payer + recipient in one group, with no transactions yet. */
async function groupFixture(browser: import('@playwright/test').Browser, tag: string) {
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

  return { payerCtx, recipCtx, payer, recip, group, acct, recipientId: me.user.id }
}


/** A transaction on the payer's own account, split 100% to the recipient. */
async function splitTxn(
  f: Awaited<ReturnType<typeof groupFixture>>,
  merchant: string,
  amount: number,
  date: string,
) {
  const txn = await f.payer.request.post(`${API}/transactions`, {
    data: { accountId: f.acct.id, date, merchant, amount, type: 'expense', tag: '[]' },
  }).then((r) => r.json()) as { id: string }
  const split = await f.payer.request.post(`${API}/transactions/${txn.id}/split`, {
    data: { recipientId: f.recipientId, splitMode: 'none' },
  })
  expect(split.status()).toBe(201)
  return txn
}

test.describe('119 — Bulk settle selection', () => {
  test('selecting two of three owed rows settles exactly those two, leaving the third open', async ({ browser }) => {
    const f = await groupFixture(browser, 'bulksettle')
    const date = businessDatePlus(-60)
    await splitTxn(f, 'BulkA', 40, date)
    await splitTxn(f, 'BulkB', 25, date)
    await splitTxn(f, 'BulkC', 15, date)

    const recipAcct = await f.recip.request.post(`${API}/accounts`, {
      data: { name: 'Recip Card', type: 'card', currency: 'MYR', color: '#3b82f6', icon: 'wallet', openingBalance: 0 },
    }).then((r) => r.json()) as { id: string }

    await f.recip.goto('/wallet/shared')
    await expect(f.recip.locator('main')).toBeVisible({ timeout: 20_000 })
    const rows = f.recip.getByTestId('split-row')
    await expect(rows).toHaveCount(3, { timeout: 10_000 })

    // Select BulkA (40) and BulkB (25) — 65 total — and leave BulkC alone.
    await rows.filter({ hasText: 'BulkA' }).locator('input[type="checkbox"]').click()
    await rows.filter({ hasText: 'BulkB' }).locator('input[type="checkbox"]').click()
    await expect(f.recip.getByTestId('split-bulk-bar')).toContainText('2 selected')

    const settleBtn = f.recip.getByTestId('split-bulk-settle')
    await expect(settleBtn).toBeEnabled()
    await settleBtn.click()

    const dialog = f.recip.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 10_000 })
    await expect(dialog).toContainText('Settling 2 selected transactions')
    await expect(dialog.locator('input[type="number"]')).toHaveValue('65')

    await dialog.locator('select').selectOption(recipAcct.name)
    await dialog.getByRole('button', { name: 'Record Settlement' }).click()
    await expect(dialog).toHaveCount(0, { timeout: 10_000 })

    // Recording the payment is a claim, not a clearance (W4, 53-split-review)
    // — `settled_amount` stays untouched until the payer confirms
    // (worker/routes/settlements.ts:606), so the immediately-observable
    // effect is the derived claim state: BulkA/BulkB move to
    // "awaiting_confirmation" with a settlementId, BulkC is untouched.
    const afterRecord = await f.recip.request.get(`${API}/transactions/splits/mine?state=pending,approved,awaiting_confirmation`)
      .then((r) => r.json()) as { merchant: string; claim_state: string; settlement_id: string | null; share_amount: number }[]
    const aAfter = afterRecord.find((c) => c.merchant === 'BulkA')
    const bAfter = afterRecord.find((c) => c.merchant === 'BulkB')
    const cAfter = afterRecord.find((c) => c.merchant === 'BulkC')
    expect(aAfter?.claim_state).toBe('awaiting_confirmation')
    expect(bAfter?.claim_state).toBe('awaiting_confirmation')
    expect(cAfter?.claim_state).toBe('pending')
    expect(aAfter?.settlement_id).toBeTruthy()
    expect(aAfter?.settlement_id).toBe(bAfter?.settlement_id) // one payment, both lines

    // The payer confirms it arrived — now settled_amount reflects it, exactly
    // on the two selected rows, and BulkC is still fully outstanding.
    const confirm = await f.payer.request.post(`${API}/settlements/${aAfter!.settlement_id}/confirm`, {
      data: { accountId: f.acct.id },
    })
    expect(confirm.ok()).toBeTruthy()

    const claims = await f.recip.request.get(`${API}/transactions/splits/mine?state=pending,approved,settled`)
      .then((r) => r.json()) as { merchant: string; settled_amount: number; share_amount: number }[]
    const a = claims.find((c) => c.merchant === 'BulkA')
    const b = claims.find((c) => c.merchant === 'BulkB')
    const cRow = claims.find((c) => c.merchant === 'BulkC')
    expect(Math.round(a?.settled_amount ?? 0)).toBe(40)
    expect(Math.round(b?.settled_amount ?? 0)).toBe(25)
    expect(Math.round(cRow?.settled_amount ?? 0)).toBe(0)
    expect(Math.round(cRow?.share_amount ?? 0)).toBe(15)

    await f.payerCtx.close()
    await f.recipCtx.close()
  })

  // Same role (debtor) on both rows, but owed to two different people —
  // Settle still has to refuse, since one payment cannot name two payees.
  test('a selection spanning two counterparties disables Settle with a visible reason', async ({ browser }) => {
    const f = await groupFixture(browser, 'bulkmixed')
    const outsiderCtx = await browser.newContext()
    const outsider = await outsiderCtx.newPage()
    const outsiderName = `out_${Date.now()}`
    await outsider.request.post(`${API}/auth/signup`, { data: { username: outsiderName, password: 'test-password' } })
    await f.payer.request.post(`${API}/groups/${f.group.id}/invites`, { data: { username: outsiderName } })
    const outInvites = await outsider.request.get(`${API}/invites`).then((r) => r.json()) as { id: string }[]
    await outsider.request.post(`${API}/invites/${outInvites[0].id}/accept`)

    const date = businessDatePlus(-60)
    await splitTxn(f, 'MixA', 40, date) // owed to the payer
    const outAcct = await outsider.request.post(`${API}/accounts`, {
      data: { name: 'Outsider Card', type: 'card', currency: 'MYR', color: '#999999', icon: 'wallet', openingBalance: 0 },
    }).then((r) => r.json()) as { id: string }
    const outTxn = await outsider.request.post(`${API}/transactions`, {
      data: { accountId: outAcct.id, date, merchant: 'MixB', amount: 20, type: 'expense', tag: '[]' },
    }).then((r) => r.json()) as { id: string }
    await outsider.request.post(`${API}/transactions/${outTxn.id}/split`, { // owed to the outsider
      data: { recipientId: f.recipientId, splitMode: 'none' },
    })

    await f.recip.goto('/wallet/shared')
    await expect(f.recip.locator('main')).toBeVisible({ timeout: 20_000 })
    const rows = f.recip.getByTestId('split-row')
    await expect(rows).toHaveCount(2, { timeout: 10_000 })

    await rows.filter({ hasText: 'MixA' }).locator('input[type="checkbox"]').click()
    await rows.filter({ hasText: 'MixB' }).locator('input[type="checkbox"]').click()

    const settleBtn = f.recip.getByTestId('split-bulk-settle')
    await expect(settleBtn).toBeDisabled()
    await expect(f.recip.getByTestId('split-bulk-settle-reason')).toContainText('same person', { timeout: 5000 })

    await f.payerCtx.close()
    await f.recipCtx.close()
    await outsiderCtx.close()
  })

  // A claim the viewer HOLDS (creditor role) mixed into an otherwise-debtor
  // selection — Settle is a debtor-only action (API contract: the request is
  // always made with toUserId), so this must refuse too.
  test('a creditor-side row in the selection disables Settle with a visible reason', async ({ browser }) => {
    const f = await groupFixture(browser, 'bulkcreditor')
    const date = businessDatePlus(-60)
    await splitTxn(f, 'CredA', 40, date) // the recipient owes the payer

    const recipAcct = await f.recip.request.post(`${API}/accounts`, {
      data: { name: 'Recip Card', type: 'card', currency: 'MYR', color: '#3b82f6', icon: 'wallet', openingBalance: 0 },
    }).then((r) => r.json()) as { id: string }
    const payerMe = await f.payer.request.get(`${API}/auth/me`).then((r) => r.json()) as { user: { id: string } }
    const ownTxn = await f.recip.request.post(`${API}/transactions`, {
      data: { accountId: recipAcct.id, date, merchant: 'CredB', amount: 20, type: 'expense', tag: '[]' },
    }).then((r) => r.json()) as { id: string }
    await f.recip.request.post(`${API}/transactions/${ownTxn.id}/split`, { // the payer owes the recipient
      data: { recipientId: payerMe.user.id, splitMode: 'none' },
    })

    await f.recip.goto('/wallet/shared')
    await expect(f.recip.locator('main')).toBeVisible({ timeout: 20_000 })
    const rows = f.recip.getByTestId('split-row')
    await expect(rows).toHaveCount(2, { timeout: 10_000 })

    await rows.filter({ hasText: 'CredA' }).locator('input[type="checkbox"]').click()
    await rows.filter({ hasText: 'CredB' }).locator('input[type="checkbox"]').click()

    const settleBtn = f.recip.getByTestId('split-bulk-settle')
    await expect(settleBtn).toBeDisabled()
    await expect(f.recip.getByTestId('split-bulk-settle-reason')).toContainText('owed to you', { timeout: 5000 })

    await f.payerCtx.close()
    await f.recipCtx.close()
  })
})

// ── Server-side shareIds validation (API-level) ─────────────────────────────
//
// What the UI's eligibility check cannot catch — it only ever offers the
// viewer's own open, debtor-side claims — but a direct request still has to
// be refused for an ineligible id, and for the fromUserId + shareIds
// combination that means "someone else chose which of MY claims to pay".
test.describe('119 — Bulk settle: shareIds server validation', () => {
  test('shareIds naming someone else\'s split returns 400', async ({ browser }) => {
    const f = await groupFixture(browser, 'bulkforeign')
    const g2 = await groupFixture(browser, 'bulkforeign2')
    const date = businessDatePlus(-60)
    await splitTxn(f, 'ForeignA', 40, date)
    await splitTxn(g2, 'ForeignB', 20, date)

    const mine = await f.recip.request.get(`${API}/transactions/splits/mine?status=pending`)
      .then((r) => r.json()) as { id: string }[]
    const theirs = await g2.recip.request.get(`${API}/transactions/splits/mine?status=pending`)
      .then((r) => r.json()) as { id: string }[]
    const payerId = await f.payer.request.get(`${API}/auth/me`).then((r) => r.json())
      .then((m: { user: { id: string } }) => m.user.id)
    const recipAcct = await f.recip.request.post(`${API}/accounts`, {
      data: { name: 'R', type: 'card', currency: 'MYR', color: '#3b82f6', icon: 'wallet', openingBalance: 0 },
    }).then((r) => r.json()) as { id: string }

    const res = await f.recip.request.post(`${API}/settlements`, {
      data: {
        groupId: f.group.id,
        toUserId: payerId,
        amount: 60,
        fromAccountId: recipAcct.id,
        shareIds: [mine[0].id, theirs[0].id],
      },
    })
    expect(res.status()).toBe(400)

    await f.payerCtx.close()
    await f.recipCtx.close()
    await g2.payerCtx.close()
    await g2.recipCtx.close()
  })

  test('shareIds naming a rejected split returns 400', async ({ browser }) => {
    const f = await groupFixture(browser, 'bulkrejectedshare')
    const date = businessDatePlus(-60)
    await splitTxn(f, 'RejA', 40, date)
    const claims = await f.recip.request.get(`${API}/transactions/splits/mine?status=pending`)
      .then((r) => r.json()) as { id: string }[]
    await f.recip.request.post(`${API}/transactions/splits/${claims[0].id}/reject`, { data: {} })

    const payerId = await f.payer.request.get(`${API}/auth/me`).then((r) => r.json())
      .then((m: { user: { id: string } }) => m.user.id)
    const recipAcct = await f.recip.request.post(`${API}/accounts`, {
      data: { name: 'R', type: 'card', currency: 'MYR', color: '#3b82f6', icon: 'wallet', openingBalance: 0 },
    }).then((r) => r.json()) as { id: string }

    const res = await f.recip.request.post(`${API}/settlements`, {
      data: { groupId: f.group.id, toUserId: payerId, amount: 40, fromAccountId: recipAcct.id, shareIds: [claims[0].id] },
    })
    expect(res.status()).toBe(400)

    await f.payerCtx.close()
    await f.recipCtx.close()
  })

  test('shareIds naming a split already in an awaiting_confirmation settlement returns 400', async ({ browser }) => {
    const f = await groupFixture(browser, 'bulkalreadyshare')
    const date = businessDatePlus(-60)
    await splitTxn(f, 'AlreadyA', 40, date)
    const claims = await f.recip.request.get(`${API}/transactions/splits/mine?status=pending`)
      .then((r) => r.json()) as { id: string }[]
    const payerId = await f.payer.request.get(`${API}/auth/me`).then((r) => r.json())
      .then((m: { user: { id: string } }) => m.user.id)
    const recipAcct = await f.recip.request.post(`${API}/accounts`, {
      data: { name: 'R', type: 'card', currency: 'MYR', color: '#3b82f6', icon: 'wallet', openingBalance: 0 },
    }).then((r) => r.json()) as { id: string }

    const first = await f.recip.request.post(`${API}/settlements`, {
      data: { groupId: f.group.id, toUserId: payerId, amount: 40, fromAccountId: recipAcct.id, shareIds: [claims[0].id] },
    })
    expect(first.ok()).toBeTruthy()

    // The same split again — it is already claimed by the first payment, and
    // settled_amount does not move until the payer confirms, so this is not
    // "already settled", it is "already spoken for".
    const second = await f.recip.request.post(`${API}/settlements`, {
      data: { groupId: f.group.id, toUserId: payerId, amount: 40, fromAccountId: recipAcct.id, shareIds: [claims[0].id] },
    })
    expect(second.status()).toBe(400)

    await f.payerCtx.close()
    await f.recipCtx.close()
  })

  test('fromUserId combined with shareIds returns 400', async ({ browser }) => {
    const f = await groupFixture(browser, 'bulkfromusershare')
    const date = businessDatePlus(-60)
    await splitTxn(f, 'FromA', 40, date)
    const claims = await f.recip.request.get(`${API}/transactions/splits/mine?status=pending`)
      .then((r) => r.json()) as { id: string }[]

    // fromUserId means "the creditor is recording receipt on the debtor's
    // behalf" — there is no "which of my claims" for the creditor to have
    // chosen, so the combination is refused outright.
    const res = await f.payer.request.post(`${API}/settlements`, {
      data: { groupId: f.group.id, fromUserId: f.recipientId, amount: 40, shareIds: [claims[0].id] },
    })
    expect(res.status()).toBe(400)

    await f.payerCtx.close()
    await f.recipCtx.close()
  })
})
