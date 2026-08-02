import { test, expect } from '@playwright/test'
import type { Browser } from '@playwright/test'

// Shared-page follow-ups to the W1–W6 review flow:
//   1. the payer can withdraw a claim they made (previously only the recipient
//      could get rid of one, by rejecting it)
//   2. a long merchant no longer prints over the amount and the buttons
//   3. the description is on the row, because it is what a claim is judged by
//   4. the settlement undo window is a week rather than the calendar day
//   5. settlement history carries its date, status and note
//   6. each direction is drawn as a proportional bar over its states

test.describe.configure({ mode: 'serial' })

const API = 'http://localhost:5173/api'

interface Fixture {
  payerCtx: import('@playwright/test').BrowserContext
  recipCtx: import('@playwright/test').BrowserContext
  payer: import('@playwright/test').Page
  recip: import('@playwright/test').Page
  payerId: string
  recipientId: string
  group: { id: string }
  payerAcct: { id: string }
  recipAcct: { id: string }
  txn: { id: string }
  splitId: string
  merchant: string
}

/** Payer + recipient in one group, with one 100.00 split transaction. */
async function fixture(
  browser: Browser,
  tag: string,
  opts: { merchant?: string; description?: string } = {},
): Promise<Fixture> {
  const merchant = opts.merchant ?? `M_${tag}`
  const payerCtx = await browser.newContext()
  const recipCtx = await browser.newContext()
  const payer = await payerCtx.newPage()
  const recip = await recipCtx.newPage()
  const ts = Date.now()
  const payerName = `pay_${tag}_${ts}`
  const recipName = `rec_${tag}_${ts}`

  await payer.request.post(`${API}/auth/signup`, { data: { username: payerName, password: 'test-password' } })
  await recip.request.post(`${API}/auth/signup`, { data: { username: recipName, password: 'test-password' } })
  const payerId = await payer.request.get(`${API}/auth/me`).then((r) => r.json())
    .then((m: { user: { id: string } }) => m.user.id)
  const recipientId = await recip.request.get(`${API}/auth/me`).then((r) => r.json())
    .then((m: { user: { id: string } }) => m.user.id)

  const group = await payer.request.post(`${API}/groups`, { data: { name: `G_${tag}` } })
    .then((r) => r.json()) as { id: string }
  await payer.request.post(`${API}/groups/${group.id}/invites`, { data: { username: recipName } })
  const invites = await recip.request.get(`${API}/invites`).then((r) => r.json()) as { id: string }[]
  await recip.request.post(`${API}/invites/${invites[0].id}/accept`)

  const acct = { name: 'Card', type: 'card', currency: 'MYR', color: '#1D9E75', icon: 'wallet', openingBalance: 0 }
  const payerAcct = await payer.request.post(`${API}/accounts`, { data: acct })
    .then((r) => r.json()) as { id: string }
  const recipAcct = await recip.request.post(`${API}/accounts`, { data: acct })
    .then((r) => r.json()) as { id: string }

  const txn = await payer.request.post(`${API}/transactions`, {
    data: {
      accountId: payerAcct.id,
      date: businessToday(),
      merchant,
      description: opts.description ?? '',
      amount: 100,
      type: 'expense',
      tag: '[]',
    },
  }).then((r) => r.json()) as { id: string }

  const split = await payer.request.post(`${API}/transactions/${txn.id}/split`, {
    data: { recipientId, splitMode: 'none' },
  })
  expect(split.status()).toBe(201)
  const rows = await split.json() as { id: string; user_id: string }[]
  const splitId = rows.find((r) => r.user_id === recipientId)!.id

  return { payerCtx, recipCtx, payer, recip, payerId, recipientId, group, payerAcct, recipAcct, txn, splitId, merchant }
}

/** Today in the app's business timezone — never the host clock (see helpers.ts). */
function businessToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kuala_Lumpur', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
}

/** Debtor records a payment, creditor confirms it. */
async function settleAndConfirm(f: Fixture, amount: number): Promise<string> {
  const settle = await f.recip.request.post(`${API}/settlements`, {
    data: { groupId: f.group.id, toUserId: f.payerId, amount, fromAccountId: f.recipAcct.id, note: 'bank transfer' },
  })
  expect(settle.ok()).toBeTruthy()
  const id = (await settle.json()).id as string
  const confirm = await f.payer.request.post(`${API}/settlements/${id}/confirm`, {
    data: { accountId: f.payerAcct.id },
  })
  expect(confirm.ok()).toBeTruthy()
  return id
}

async function close(f: Fixture) {
  await f.payerCtx.close()
  await f.recipCtx.close()
}

test.describe('54 — Cancelling a split you made', () => {
  test('the payer withdraws a pending claim and the transaction is unsplit again', async ({ browser }) => {
    const f = await fixture(browser, 'cancel')

    const before = await f.recip.request.get(`${API}/transactions/splits/mine`).then((r) => r.json()) as unknown[]
    expect(before).toHaveLength(1)

    const res = await f.payer.request.delete(`${API}/transactions/splits/${f.splitId}`)
    expect(res.status()).toBe(204)

    // Gone from the recipient's queue…
    const after = await f.recip.request.get(`${API}/transactions/splits/mine`).then((r) => r.json()) as unknown[]
    expect(after).toHaveLength(0)
    // …and the payer's transaction no longer badged as split.
    const txns = await f.payer.request.get(`${API}/transactions`).then((r) => r.json()) as
      { id: string; has_splits: number; effective_amount: number }[]
    const row = txns.find((t) => t.id === f.txn.id)!
    expect(row.has_splits).toBe(0)
    // The whole cost is back on the payer, which is the point of cancelling.
    expect(row.effective_amount).toBeCloseTo(100, 2)

    await close(f)
  })

  test('an agreed claim can still be withdrawn — nothing has moved yet', async ({ browser }) => {
    const f = await fixture(browser, 'cancelagreed')

    const approve = await f.recip.request.post(`${API}/transactions/splits/${f.splitId}/approve`, { data: {} })
    expect(approve.ok()).toBeTruthy()

    const res = await f.payer.request.delete(`${API}/transactions/splits/${f.splitId}`)
    expect(res.status()).toBe(204)

    await close(f)
  })

  test('only the payer can withdraw it, and an unknown id is not probeable', async ({ browser }) => {
    const f = await fixture(browser, 'cancelauth')

    // The recipient holds the claim but did not make it — reject is their lever.
    const asRecipient = await f.recip.request.delete(`${API}/transactions/splits/${f.splitId}`)
    expect(asRecipient.status()).toBe(404)

    const unknown = await f.payer.request.delete(`${API}/transactions/splits/does-not-exist`)
    expect(unknown.status()).toBe(404)

    // Still there.
    const still = await f.recip.request.get(`${API}/transactions/splits/mine`).then((r) => r.json()) as unknown[]
    expect(still).toHaveLength(1)

    await close(f)
  })

  test('refused once money has moved against it', async ({ browser }) => {
    const f = await fixture(browser, 'cancelsettled')
    await settleAndConfirm(f, 100)

    const res = await f.payer.request.delete(`${API}/transactions/splits/${f.splitId}`)
    expect(res.status()).toBe(409)
    expect((await res.json()).error).toContain('settled')

    await close(f)
  })

  test('refused while a payment is awaiting confirmation', async ({ browser }) => {
    const f = await fixture(browser, 'cancelawaiting')
    // Recorded but deliberately not confirmed.
    const settle = await f.recip.request.post(`${API}/settlements`, {
      data: { groupId: f.group.id, toUserId: f.payerId, amount: 100, fromAccountId: f.recipAcct.id },
    })
    expect(settle.ok()).toBeTruthy()

    const res = await f.payer.request.delete(`${API}/transactions/splits/${f.splitId}`)
    expect(res.status()).toBe(409)
    expect((await res.json()).error).toContain('awaiting confirmation')

    await close(f)
  })

  test('the payer cancels from the Shared page', async ({ browser }) => {
    const f = await fixture(browser, 'cancelui')

    await f.payer.goto('/wallet/shared')
    const row = f.payer.getByTestId('split-row').first()
    await expect(row).toBeVisible()

    await row.getByTestId('claim-cancel').click()
    await f.payer.getByTestId('claim-cancel-confirm').click()

    // With the only claim withdrawn there is nothing left between these two, so
    // the section itself goes rather than sitting there empty.
    await expect(f.payer.getByTestId('splits-section')).toHaveCount(0)
    const after = await f.recip.request.get(`${API}/transactions/splits/mine`).then((r) => r.json()) as unknown[]
    expect(after).toHaveLength(0)

    await close(f)
  })

  test('the recipient is never offered it — reject is their lever', async ({ browser }) => {
    const f = await fixture(browser, 'cancelrecip')

    await f.recip.goto('/wallet/shared')
    const row = f.recip.getByTestId('split-row').first()
    await expect(row).toBeVisible()
    await expect(row.getByTestId('claim-reject')).toBeVisible()
    await expect(row.getByTestId('claim-cancel')).toHaveCount(0)

    await close(f)
  })
})

test.describe('54 — The review row itself', () => {
  test('carries the description, which is what the claim is judged by', async ({ browser }) => {
    const f = await fixture(browser, 'desc', {
      merchant: 'GRAB',
      description: 'airport run, split the fare',
    })

    await f.recip.goto('/wallet/shared')
    const row = f.recip.getByTestId('split-row').first()
    await expect(row.getByTestId('split-row-link')).toHaveText('GRAB')
    await expect(row.getByTestId('split-row-description')).toHaveText('airport run, split the fare')

    await close(f)
  })

  test('falls back to the description when there is no merchant', async ({ browser }) => {
    const f = await fixture(browser, 'nomerch', { merchant: '', description: 'shared taxi' })

    await f.recip.goto('/wallet/shared')
    await expect(f.recip.getByTestId('split-row-link').first()).toHaveText('shared taxi')
    // Not repeated underneath once it is already the title.
    await expect(f.recip.getByTestId('split-row-description')).toHaveCount(0)

    await close(f)
  })

  // The bug: `truncate` was on an inline <Link>, where it does nothing — a long
  // merchant ran out of its column and printed over the amount to its right.
  test('a long merchant does not run over the amount', async ({ browser }) => {
    const f = await fixture(browser, 'overlap', {
      merchant: 'Restoran Nasi Kandar Pelita Jalan Ampang Kuala Lumpur Cabang Utama',
    })

    await f.recip.goto('/wallet/shared')
    const row = f.recip.getByTestId('split-row').first()
    await expect(row).toBeVisible()

    const link = await row.getByTestId('split-row-link').boundingBox()
    const amount = await row.getByTestId('split-row-amount').boundingBox()
    expect(link).not.toBeNull()
    expect(amount).not.toBeNull()
    // Allow a pixel of rounding; anything more is the text sitting on the money.
    expect(link!.x + link!.width).toBeLessThanOrEqual(amount!.x + 1)

    await close(f)
  })
})

test.describe('54 — Settlement history', () => {
  test('shows when it happened, what state it is in, and the note', async ({ browser }) => {
    const f = await fixture(browser, 'histrow')
    await settleAndConfirm(f, 100)

    await f.payer.goto('/wallet/shared')
    const row = f.payer.getByTestId('settlement-row').first()
    await expect(row).toBeVisible()
    await expect(row.getByTestId('settlement-row-status')).toHaveText('Confirmed')
    await expect(row.getByTestId('settlement-row-note')).toContainText('bank transfer')
    // dd MMM yyyy, HH:mm
    await expect(row.getByTestId('settlement-row-date')).toContainText(/\d{2} \w{3} \d{4}, \d{2}:\d{2}/)

    await close(f)
  })

  test('an unconfirmed payment is labelled as such', async ({ browser }) => {
    const f = await fixture(browser, 'histpending')
    await f.recip.request.post(`${API}/settlements`, {
      data: { groupId: f.group.id, toUserId: f.payerId, amount: 100, fromAccountId: f.recipAcct.id },
    })

    await f.recip.goto('/wallet/shared')
    await expect(f.recip.getByTestId('settlement-row-status').first()).toHaveText('Awaiting confirmation')

    await close(f)
  })
})

test.describe('54 — The undo window is a week', () => {
  test('undoable six days later', async ({ browser }) => {
    const f = await fixture(browser, 'undo6')
    const id = await settleAndConfirm(f, 100)

    const aged = await f.recip.request.post(`${API}/test/backdate-settlement`, { data: { id, days: 6 } })
    expect(aged.ok()).toBeTruthy()

    // The debtor paid, so the undo is theirs to make.
    const res = await f.recip.request.delete(`${API}/settlements/${id}`)
    expect(res.status()).toBe(204)

    // The claim is back, and back as agreed rather than unreviewed.
    const claims = await f.recip.request.get(`${API}/transactions/splits/mine?state=approved`)
      .then((r) => r.json()) as unknown[]
    expect(claims).toHaveLength(1)

    await close(f)
  })

  test('refused eight days later, and the message says the window', async ({ browser }) => {
    const f = await fixture(browser, 'undo8')
    const id = await settleAndConfirm(f, 100)

    await f.recip.request.post(`${API}/test/backdate-settlement`, { data: { id, days: 8 } })

    const res = await f.recip.request.delete(`${API}/settlements/${id}`)
    expect(res.status()).toBe(409)
    expect((await res.json()).error).toContain('within 7 days')

    await close(f)
  })

  test('the Undo button is not offered on a settlement past the window', async ({ browser }) => {
    const f = await fixture(browser, 'undoui')
    const id = await settleAndConfirm(f, 100)
    await f.recip.request.post(`${API}/test/backdate-settlement`, { data: { id, days: 20 } })

    await f.recip.goto('/wallet/shared')
    const row = f.recip.getByTestId('settlement-row').first()
    await expect(row).toBeVisible()
    await expect(row.getByRole('button', { name: 'Undo' })).toHaveCount(0)

    await close(f)
  })
})

test.describe('54 — State bar', () => {
  test('draws each direction over the states its money is in', async ({ browser }) => {
    const f = await fixture(browser, 'bar')

    // Creditor's side: one unreviewed claim for the full 100.
    await f.payer.goto('/wallet/shared')
    const bar = f.payer.getByTestId('state-bar-owed-to-me')
    await expect(bar).toBeVisible()
    const segment = bar.getByTestId('split-state-segment')
    await expect(segment).toHaveCount(1)
    await expect(segment).toHaveAttribute('data-state', 'pending')
    await expect(bar.getByTestId('split-state-legend')).toContainText('To review')
    await expect(bar.getByTestId('split-state-legend')).toContainText('100.00')

    // Hover names the state and who the money is with.
    await segment.hover()
    const tip = bar.getByTestId('split-state-tooltip')
    await expect(tip).toBeVisible()
    await expect(tip).toContainText('To review')
    await expect(tip).toContainText('rec_bar')

    await close(f)
  })

  test('splits into two segments once part of the money is agreed', async ({ browser }) => {
    const f = await fixture(browser, 'bar2')

    // A second transaction so the two states can coexist.
    const txn2 = await f.payer.request.post(`${API}/transactions`, {
      data: { accountId: f.payerAcct.id, date: businessToday(), merchant: 'M_bar2b', amount: 40, type: 'expense', tag: '[]' },
    }).then((r) => r.json()) as { id: string }
    const rows = await f.payer.request.post(`${API}/transactions/${txn2.id}/split`, {
      data: { recipientId: f.recipientId, splitMode: 'none' },
    }).then((r) => r.json()) as { id: string; user_id: string }[]
    const second = rows.find((r) => r.user_id === f.recipientId)!.id
    await f.recip.request.post(`${API}/transactions/splits/${second}/approve`, { data: {} })

    await f.payer.goto('/wallet/shared')
    const bar = f.payer.getByTestId('state-bar-owed-to-me')
    await expect(bar.getByTestId('split-state-segment')).toHaveCount(2)
    // Lifecycle order, left to right.
    await expect(bar.getByTestId('split-state-segment').nth(0)).toHaveAttribute('data-state', 'pending')
    await expect(bar.getByTestId('split-state-segment').nth(1)).toHaveAttribute('data-state', 'approved')

    await close(f)
  })

  // GET /transactions/splits/mine matches on ts.user_id alone, so an equal split
  // hands the payer back their own share row. Summed naively it reads as the
  // payer owing themselves half of their own transaction.
  test('the payer does not owe themselves their half of an equal split', async ({ browser }) => {
    const f = await fixture(browser, 'barself')
    // Replace the 100% claim with a 50/50 one, which writes a payer row.
    await f.payer.request.post(`${API}/transactions/${f.txn.id}/split`, {
      data: { recipientId: f.recipientId, splitMode: 'equal' },
    })

    await f.payer.goto('/wallet/shared')
    await expect(f.payer.getByTestId('state-bar-owed-to-me')).toBeVisible()
    await expect(f.payer.getByTestId('state-bar-owed-to-me').getByTestId('state-bar-total'))
      .toHaveText(/50\.00/)
    // Nothing flows the other way at all, so that bar should not exist.
    await expect(f.payer.getByTestId('state-bar-i-owe')).toHaveCount(0)

    await close(f)
  })

  test('settled money is a caption, not a segment that swallows the bar', async ({ browser }) => {
    const f = await fixture(browser, 'barsettled')
    await settleAndConfirm(f, 100)

    await f.payer.goto('/wallet/shared')
    const bar = f.payer.getByTestId('state-bar-owed-to-me')
    await expect(bar).toBeVisible()
    await expect(bar.getByTestId('split-state-segment')).toHaveCount(0)
    await expect(bar.getByTestId('split-state-settled')).toContainText('100.00')

    await close(f)
  })
})
