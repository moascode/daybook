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

// ── W2: money semantics (docs/split-settlement-plan.md §3) ─────────────
//
// The four-number table, asserted end to end. This is the wave's whole point:
// after a settlement the payer's expense must FALL by the settled amount, the
// payee's payment must COUNT as their expense, both balances must be right, and
// the household total must equal the real spend — before and after settlement.
test.describe('52 — Split review (W2: money semantics)', () => {
  test('the §3 four-number table holds before and after settlement', async ({ browser }) => {
    // RM100 expense on the payer's card, split so the recipient owes RM50.
    const f = await splitFixture(browser, 'fournum', priorMonthDate(), 100)

    // Re-split 50/50 — the fixture's "none" mode gives the recipient 100%.
    const resplit = await f.payer.request.post(`${API}/transactions/${f.txn.id}/split`, {
      data: { recipientId: f.recipientId, splitMode: 'equal' },
    })
    expect(resplit.status()).toBe(201)

    const summary = async (page: import('@playwright/test').Page) => {
      const rows = await page.request.get(`${API}/transactions`).then((r) => r.json()) as
        { type: string; effective_amount: number; is_balance_only: number }[]
      let expense = 0
      for (const t of rows) {
        if (t.type === 'expense' && !t.is_balance_only) expense += t.effective_amount
      }
      return Math.round(expense * 100) / 100
    }
    const balance = async (page: import('@playwright/test').Page, acct: string) =>
      page.request.get(`${API}/accounts/${acct}/balance`).then((r) => r.json())
        .then((b: { balance: number }) => Math.round(b.balance * 100) / 100)

    // ── Before settlement: it is all on the payer ──
    expect(await summary(f.payer)).toBe(100)
    expect(await summary(f.recip)).toBe(0)
    expect(await balance(f.payer, f.acct.id)).toBe(-100)

    // The recipient needs their own account to pay from (owner decision §9.5).
    const recipAcct = await f.recip.request.post(`${API}/accounts`, {
      data: { name: 'Recip Card', type: 'card', currency: 'MYR', color: '#1D9E75', icon: 'wallet', openingBalance: 0 },
    }).then((r) => r.json()) as { id: string }

    // W2 only changes the money maths, not who picks the accounts — so booking
    // the creditor's leg still requires them to have shared a writable account,
    // which is the ergonomic dead end W4 removes (the creditor will book their
    // own leg on confirmation). Sharing here keeps this test about §3.
    const shared = await f.payer.request.post(`${API}/accounts/${f.acct.id}/shares`, {
      data: { groupId: f.group.id, canWrite: 1 },
    })
    expect(shared.ok()).toBeTruthy()

    // ── Settle RM50 ──
    const payerId = await f.payer.request.get(`${API}/auth/me`).then((r) => r.json())
      .then((m: { user: { id: string } }) => m.user.id)
    const settle = await f.recip.request.post(`${API}/settlements`, {
      data: {
        groupId: f.group.id, toUserId: payerId, amount: 50,
        fromAccountId: recipAcct.id, toAccountId: f.acct.id,
      },
    })
    expect(settle.ok()).toBeTruthy()

    // ── After settlement: the four numbers ──
    // Payer's expense falls by exactly the settled amount…
    expect(await summary(f.payer)).toBe(50)
    // …and the payee's payment is their expense — NOT excluded. Flagging both
    // legs balance-only would make this 0 and the household total half the spend.
    expect(await summary(f.recip)).toBe(50)
    // Balances still count the settlement legs — that is what the flag is for.
    expect(await balance(f.payer, f.acct.id)).toBe(-50)
    expect(await balance(f.recip, recipAcct.id)).toBe(-50)
    // Household total equals the real RM100 spend.
    expect((await summary(f.payer)) + (await summary(f.recip))).toBe(100)

    await f.payerCtx.close()
    await f.recipCtx.close()
  })

  // The creditor's incoming leg must not inflate their income.
  test('the settlement arrival is not counted as the payee\'s income', async ({ browser }) => {
    const f = await splitFixture(browser, 'noincome', priorMonthDate(), 100)
    const recipAcct = await f.recip.request.post(`${API}/accounts`, {
      data: { name: 'R Card', type: 'card', currency: 'MYR', color: '#1D9E75', icon: 'wallet', openingBalance: 0 },
    }).then((r) => r.json()) as { id: string }
    // See the note in the four-number test: W4 removes this requirement.
    await f.payer.request.post(`${API}/accounts/${f.acct.id}/shares`, {
      data: { groupId: f.group.id, canWrite: 1 },
    })
    const payerId = await f.payer.request.get(`${API}/auth/me`).then((r) => r.json())
      .then((m: { user: { id: string } }) => m.user.id)
    await f.recip.request.post(`${API}/settlements`, {
      data: {
        groupId: f.group.id, toUserId: payerId, amount: 100,
        fromAccountId: recipAcct.id, toAccountId: f.acct.id,
      },
    })

    const rows = await f.payer.request.get(`${API}/transactions`).then((r) => r.json()) as
      { type: string; is_balance_only: number; effective_amount: number }[]
    const incomeLeg = rows.find((t) => t.type === 'income')
    expect(incomeLeg).toBeTruthy()
    expect(incomeLeg?.is_balance_only).toBe(1)

    const countedIncome = rows
      .filter((t) => t.type === 'income' && !t.is_balance_only)
      .reduce((s, t) => s + t.effective_amount, 0)
    expect(countedIncome).toBe(0)

    // The debtor's own leg is deliberately NOT flagged.
    const debtorRows = await f.recip.request.get(`${API}/transactions`).then((r) => r.json()) as
      { type: string; is_balance_only: number }[]
    const debtorLeg = debtorRows.find((t) => t.type === 'expense')
    expect(debtorLeg?.is_balance_only).toBe(0)

    await f.payerCtx.close()
    await f.recipCtx.close()
  })

  // A non-owner gets 0 on someone else's transaction: their cost is the payment
  // they book, never a slice of the payer's row. Counting both double-counts.
  test('a recipient\'s effective amount on the payer\'s transaction is 0', async ({ browser }) => {
    const f = await splitFixture(browser, 'noneffective', priorMonthDate(), 100)
    const rows = await f.recip.request.get(`${API}/transactions`).then((r) => r.json()) as
      { id: string; effective_amount: number }[]
    const row = rows.find((t) => t.id === f.txn.id)
    expect(row).toBeTruthy()
    expect(row?.effective_amount).toBe(0)

    await f.payerCtx.close()
    await f.recipCtx.close()
  })
})

// ── W3: reject flow (docs/split-settlement-plan.md §5.2) ───────────────
//
// Rejection is the recipient's review step: no money moves, the claim stops
// existing, and the payer's expense goes back to the full amount.
test.describe('52 — Split review (W3: reject)', () => {
  test('rejecting returns the full expense to the payer and clears the claim', async ({ browser }) => {
    const f = await splitFixture(browser, 'reject', priorMonthDate(), 100)
    await f.payer.request.post(`${API}/transactions/${f.txn.id}/split`, {
      data: { recipientId: f.recipientId, splitMode: 'equal' },
    })

    const claims = await f.recip.request.get(`${API}/transactions/splits/mine?status=pending`)
      .then((r) => r.json()) as { id: string; share_amount: number }[]
    expect(claims).toHaveLength(1)
    expect(claims[0].share_amount).toBe(50)

    const rejected = await f.recip.request.post(`${API}/transactions/splits/${claims[0].id}/reject`, {
      data: { reason: 'this one was yours alone' },
    })
    expect(rejected.ok()).toBeTruthy()

    // The payer carries the whole amount again…
    const payerRows = await f.payer.request.get(`${API}/transactions`).then((r) => r.json()) as
      { id: string; effective_amount: number; has_splits: number }[]
    const row = payerRows.find((t) => t.id === f.txn.id)
    expect(row?.effective_amount).toBe(100)
    // …and the row is no longer badged as split.
    expect(row?.has_splits).toBe(0)

    // The claim is gone from every recipient-facing view.
    expect(await f.recip.request.get(`${API}/transactions/splits/mine?status=pending`)
      .then((r) => r.json())).toHaveLength(0)
    expect(await f.recip.request.get(`${API}/transactions?view=shared-with-me`)
      .then((r) => r.json())).toHaveLength(0)
    expect(await f.recip.request.get(`${API}/transactions`)
      .then((r) => r.json())).toHaveLength(0)

    // The reason is kept — it is the payer's only explanation of what happened.
    const splits = await f.payer.request.get(`${API}/transactions/${f.txn.id}/splits`)
      .then((r) => r.json()) as { status: string; rejected_reason: string; rejected_at: string | null }[]
    const rej = splits.find((s) => s.status === 'rejected')
    expect(rej?.rejected_reason).toBe('this one was yours alone')
    expect(rej?.rejected_at).toBeTruthy()

    await f.payerCtx.close()
    await f.recipCtx.close()
  })

  test('the payer can re-split after a rejection', async ({ browser }) => {
    const f = await splitFixture(browser, 'resplit', priorMonthDate(), 100)
    const claims = await f.recip.request.get(`${API}/transactions/splits/mine?status=pending`)
      .then((r) => r.json()) as { id: string }[]
    await f.recip.request.post(`${API}/transactions/splits/${claims[0].id}/reject`, { data: {} })

    // Re-split at a corrected figure — the loop the state machine promises.
    const resplit = await f.payer.request.post(`${API}/transactions/${f.txn.id}/split`, {
      data: { recipientId: f.recipientId, splitMode: 'custom', shareAmounts: [75, 25] },
    })
    expect(resplit.status()).toBe(201)

    const fresh = await f.recip.request.get(`${API}/transactions/splits/mine?status=pending`)
      .then((r) => r.json()) as { share_amount: number; status: string }[]
    expect(fresh).toHaveLength(1)
    expect(fresh[0].share_amount).toBe(25)
    expect(fresh[0].status).toBe('pending')

    await f.payerCtx.close()
    await f.recipCtx.close()
  })

  // Rejection belongs to the recipient alone — the payer must not be able to
  // clear a claim on their behalf, and a stranger must not see it exists.
  test('only the recipient can reject their own claim', async ({ browser }) => {
    const f = await splitFixture(browser, 'rejectauth', priorMonthDate(), 100)
    const claims = await f.recip.request.get(`${API}/transactions/splits/mine?status=pending`)
      .then((r) => r.json()) as { id: string }[]

    const byPayer = await f.payer.request.post(`${API}/transactions/splits/${claims[0].id}/reject`, { data: {} })
    expect(byPayer.status()).toBe(404) // 404, not 403 — ids must not be probeable

    const stranger = await browser.newContext()
    const sp = await stranger.newPage()
    await sp.request.post(`${API}/auth/signup`, { data: { username: `str_${Date.now()}`, password: 'test-password' } })
    expect((await sp.request.post(`${API}/transactions/splits/${claims[0].id}/reject`, { data: {} })).status()).toBe(404)
    await stranger.close()

    // Still standing.
    expect(await f.recip.request.get(`${API}/transactions/splits/mine?status=pending`)
      .then((r) => r.json())).toHaveLength(1)

    await f.payerCtx.close()
    await f.recipCtx.close()
  })

  // Rejecting a claim that has already been paid would erase a real debt.
  test('a settled claim cannot be rejected', async ({ browser }) => {
    const f = await splitFixture(browser, 'rejectsettled', priorMonthDate(), 100)
    const recipAcct = await f.recip.request.post(`${API}/accounts`, {
      data: { name: 'R Card', type: 'card', currency: 'MYR', color: '#1D9E75', icon: 'wallet', openingBalance: 0 },
    }).then((r) => r.json()) as { id: string }
    await f.payer.request.post(`${API}/accounts/${f.acct.id}/shares`, {
      data: { groupId: f.group.id, canWrite: 1 },
    })
    const payerId = await f.payer.request.get(`${API}/auth/me`).then((r) => r.json())
      .then((m: { user: { id: string } }) => m.user.id)
    const claims = await f.recip.request.get(`${API}/transactions/splits/mine?status=pending`)
      .then((r) => r.json()) as { id: string }[]
    await f.recip.request.post(`${API}/settlements`, {
      data: { groupId: f.group.id, toUserId: payerId, amount: 100, fromAccountId: recipAcct.id, toAccountId: f.acct.id },
    })

    const res = await f.recip.request.post(`${API}/transactions/splits/${claims[0].id}/reject`, { data: {} })
    expect(res.status()).toBe(409)
    expect((await res.json()).error).toContain('settled')

    await f.payerCtx.close()
    await f.recipCtx.close()
  })

  // The badge is what tells the recipient a claim exists at all — the missing
  // piece behind the original report.
  test('the Shared nav badge counts claims and clears on rejection', async ({ browser }) => {
    const f = await splitFixture(browser, 'badge', priorMonthDate(), 100)

    await f.recip.goto('/wallet/shared')
    await expect(f.recip.locator('main')).toBeVisible({ timeout: 20_000 })
    await expect(f.recip.getByTestId('pending-claims-badge')).toHaveText('1', { timeout: 15_000 })

    await expect(f.recip.getByTestId('claims-to-review')).toBeVisible()
    await f.recip.getByTestId('claim-reject').click()
    await f.recip.getByTestId('claim-reject-confirm').click()

    await expect(f.recip.getByTestId('claims-to-review')).toHaveCount(0, { timeout: 10_000 })
    await expect(f.recip.getByTestId('pending-claims-badge')).toHaveCount(0)

    await f.payerCtx.close()
    await f.recipCtx.close()
  })
})
