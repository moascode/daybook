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


/**
 * Debtor records the payment, creditor confirms it. Since W4 this is the only
 * way a debt actually clears — and neither side needs the other's account.
 */
async function settleAndConfirm(
  f: Awaited<ReturnType<typeof splitFixture>>,
  amount: number,
  debtorAccountId: string,
  creditorAccountId: string,
) {
  const payerId = await f.payer.request.get(`${API}/auth/me`).then((r) => r.json())
    .then((m: { user: { id: string } }) => m.user.id)
  const settle = await f.recip.request.post(`${API}/settlements`, {
    data: { groupId: f.group.id, toUserId: payerId, amount, fromAccountId: debtorAccountId },
  })
  expect(settle.ok()).toBeTruthy()
  const id = (await settle.json()).id as string
  const confirm = await f.payer.request.post(`${API}/settlements/${id}/confirm`, {
    data: { accountId: creditorAccountId },
  })
  expect(confirm.ok()).toBeTruthy()
  return id
}

test.describe('53 — Split review (W1: visibility)', () => {
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
test.describe('53 — Split review (W2: money semantics)', () => {
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



    // ── Settle RM50, through the W4 handshake ──
    await settleAndConfirm(f, 50, recipAcct.id, f.acct.id)

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
    await settleAndConfirm(f, 100, recipAcct.id, f.acct.id)

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
test.describe('53 — Split review (W3: reject)', () => {
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
    const claims = await f.recip.request.get(`${API}/transactions/splits/mine?status=pending`)
      .then((r) => r.json()) as { id: string }[]
    await settleAndConfirm(f, 100, recipAcct.id, f.acct.id)

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

    await expect(f.recip.getByTestId('split-row')).toHaveCount(1)
    await f.recip.getByTestId('claim-reject').click()
    await f.recip.getByTestId('claim-reject-confirm').click()

    // The badge is refreshed by the reject itself, not by the sidebar's 60s
    // poll — a queue that empties has to say so before the next minute.
    await expect(f.recip.getByTestId('pending-claims-badge')).toHaveCount(0, { timeout: 10_000 })

    await f.payerCtx.close()
    await f.recipCtx.close()
  })
})

// ── W4: two-step settlement (docs/split-settlement-plan.md §2, §5.2) ────
//
// The debtor's payment is a claim; the creditor confirms it and books their own
// leg into their own account. Neither party moves the other's books, and — the
// whole point — no account sharing is required for either side to be recorded.
test.describe('53 — Split review (W4: two-step settlement)', () => {
  const expenseOf = async (page: import('@playwright/test').Page) => {
    const rows = await page.request.get(`${API}/transactions`).then((r) => r.json()) as
      { type: string; effective_amount: number; is_balance_only: number }[]
    return Math.round(rows
      .filter((t) => t.type === 'expense' && !t.is_balance_only)
      .reduce((s, t) => s + t.effective_amount, 0) * 100) / 100
  }
  const balanceOf = async (page: import('@playwright/test').Page, acct: string) =>
    page.request.get(`${API}/accounts/${acct}/balance`).then((r) => r.json())
      .then((b: { balance: number }) => Math.round(b.balance * 100) / 100)

  test('the four numbers come out right with NO account sharing', async ({ browser }) => {
    const f = await splitFixture(browser, 'twostep', priorMonthDate(), 100)
    await f.payer.request.post(`${API}/transactions/${f.txn.id}/split`, {
      data: { recipientId: f.recipientId, splitMode: 'equal' },
    })
    const payerId = await f.payer.request.get(`${API}/auth/me`).then((r) => r.json())
      .then((m: { user: { id: string } }) => m.user.id)
    const recipAcct = await f.recip.request.post(`${API}/accounts`, {
      data: { name: 'Recip Card', type: 'card', currency: 'MYR', color: '#1D9E75', icon: 'wallet', openingBalance: 0 },
    }).then((r) => r.json()) as { id: string }

    // The debtor records the payment. No toAccountId, and crucially no
    // account_shares anywhere — the old flow could not book the creditor's leg
    // at all in this situation, which is exactly the live production state.
    const settle = await f.recip.request.post(`${API}/settlements`, {
      data: { groupId: f.group.id, toUserId: payerId, amount: 50, fromAccountId: recipAcct.id },
    })
    expect(settle.ok()).toBeTruthy()
    const settlementId = (await settle.json()).id as string

    // Awaiting confirmation: her cash is gone, his books have not moved, and the
    // debt is still outstanding.
    expect(await expenseOf(f.recip)).toBe(50)
    expect(await balanceOf(f.recip, recipAcct.id)).toBe(-50)
    expect(await expenseOf(f.payer)).toBe(100)
    const balancesMid = await f.recip.request.get(`${API}/groups/${f.group.id}/balances`)
      .then((r) => r.json()) as { amount: number }[]
    expect(balancesMid.length).toBe(1)

    // He confirms, into an account he picks himself.
    const confirm = await f.payer.request.post(`${API}/settlements/${settlementId}/confirm`, {
      data: { accountId: f.acct.id },
    })
    expect(confirm.ok()).toBeTruthy()

    // The §3 table — now reachable without either of them sharing an account.
    expect(await expenseOf(f.payer)).toBe(50)
    expect(await expenseOf(f.recip)).toBe(50)
    expect(await balanceOf(f.payer, f.acct.id)).toBe(-50)
    expect(await balanceOf(f.recip, recipAcct.id)).toBe(-50)
    expect(await f.recip.request.get(`${API}/groups/${f.group.id}/balances`)
      .then((r) => r.json())).toHaveLength(0)

    await f.payerCtx.close()
    await f.recipCtx.close()
  })

  test('the debtor cannot clear the debt alone', async ({ browser }) => {
    const f = await splitFixture(browser, 'noselfclear', priorMonthDate(), 100)
    const payerId = await f.payer.request.get(`${API}/auth/me`).then((r) => r.json())
      .then((m: { user: { id: string } }) => m.user.id)
    const recipAcct = await f.recip.request.post(`${API}/accounts`, {
      data: { name: 'R', type: 'card', currency: 'MYR', color: '#1D9E75', icon: 'wallet', openingBalance: 0 },
    }).then((r) => r.json()) as { id: string }
    const id = await f.recip.request.post(`${API}/settlements`, {
      data: { groupId: f.group.id, toUserId: payerId, amount: 100, fromAccountId: recipAcct.id },
    }).then((r) => r.json()).then((x: { id: string }) => x.id)

    // Only the creditor may confirm — the debtor gets 404, not 403, so a
    // settlement id cannot be probed for existence.
    expect((await f.recip.request.post(`${API}/settlements/${id}/confirm`, {
      data: { accountId: recipAcct.id },
    })).status()).toBe(404)
    // And the payer's expense is untouched until he acts.
    expect(await expenseOf(f.payer)).toBe(100)

    await f.payerCtx.close()
    await f.recipCtx.close()
  })

  test('the creditor can reject a payment that never arrived', async ({ browser }) => {
    const f = await splitFixture(browser, 'rejectpay', priorMonthDate(), 100)
    const payerId = await f.payer.request.get(`${API}/auth/me`).then((r) => r.json())
      .then((m: { user: { id: string } }) => m.user.id)
    const recipAcct = await f.recip.request.post(`${API}/accounts`, {
      data: { name: 'R', type: 'card', currency: 'MYR', color: '#1D9E75', icon: 'wallet', openingBalance: 0 },
    }).then((r) => r.json()) as { id: string }
    const id = await f.recip.request.post(`${API}/settlements`, {
      data: { groupId: f.group.id, toUserId: payerId, amount: 100, fromAccountId: recipAcct.id },
    }).then((r) => r.json()).then((x: { id: string }) => x.id)

    const rej = await f.payer.request.post(`${API}/settlements/${id}/reject`, {
      data: { reason: 'nothing arrived' },
    })
    expect(rej.ok()).toBeTruthy()

    // Debt outstanding again, the debtor's payment entry withdrawn.
    expect(await expenseOf(f.recip)).toBe(0)
    expect(await balanceOf(f.recip, recipAcct.id)).toBe(0)
    expect(await expenseOf(f.payer)).toBe(100)
    const claims = await f.recip.request.get(`${API}/transactions/splits/mine?status=pending`)
      .then((r) => r.json()) as unknown[]
    expect(claims).toHaveLength(1)

    // Confirming after rejection is not a second bite.
    expect((await f.payer.request.post(`${API}/settlements/${id}/confirm`, {
      data: { accountId: f.acct.id },
    })).status()).toBe(409)

    await f.payerCtx.close()
    await f.recipCtx.close()
  })

  // §9.7: so the debtor's food budget sees food.
  test('the payment inherits the original category', async ({ browser }) => {
    const f = await splitFixture(browser, 'cat', priorMonthDate(), 100)
    const cats = await f.payer.request.get(`${API}/categories`).then((r) => r.json()) as
      { id: string; name: string }[]
    const food = cats.find((c) => c.name === 'Food & Drink')!
    await f.payer.request.patch(`${API}/transactions/${f.txn.id}`, { data: { categoryId: food.id } })

    const payerId = await f.payer.request.get(`${API}/auth/me`).then((r) => r.json())
      .then((m: { user: { id: string } }) => m.user.id)
    const recipAcct = await f.recip.request.post(`${API}/accounts`, {
      data: { name: 'R', type: 'card', currency: 'MYR', color: '#1D9E75', icon: 'wallet', openingBalance: 0 },
    }).then((r) => r.json()) as { id: string }
    await f.recip.request.post(`${API}/settlements`, {
      data: { groupId: f.group.id, toUserId: payerId, amount: 100, fromAccountId: recipAcct.id },
    })

    const rows = await f.recip.request.get(`${API}/transactions`).then((r) => r.json()) as
      { merchant: string; category_id: string | null }[]
    const leg = rows.find((t) => t.merchant === 'Settlement')
    // The recipient's category ids are their own seeded set, so compare by name.
    const recipCats = await f.recip.request.get(`${API}/categories`).then((r) => r.json()) as
      { id: string; name: string }[]
    expect(leg).toBeTruthy()
    expect(leg?.category_id).toBeTruthy()
    expect(recipCats.concat(cats).find((c) => c.id === leg?.category_id)?.name).toBe('Food & Drink')

    await f.payerCtx.close()
    await f.recipCtx.close()
  })
})

// ── W5: the review queue (docs/split-settlement-plan.md §6, §7) ────────
test.describe('53 — Split review (W5: review queue)', () => {
  // A balance is one number standing in for a pile of splits. The bug that
  // started all this was being shown that number with no route to its contents.
  test('a balance opens into the transactions behind it, both directions', async ({ browser }) => {
    const f = await splitFixture(browser, 'breakdown', priorMonthDate(), 100)

    // Debtor's side: the claim is on the page, no disclosure needed.
    await f.recip.goto('/wallet/shared')
    await expect(f.recip.locator('main')).toBeVisible({ timeout: 20_000 })
    await expect(f.recip.getByTestId('splits-section')).toBeVisible({ timeout: 10_000 })
    await expect(f.recip.getByTestId('split-row')).toHaveCount(1)
    await expect(f.recip.getByTestId('splits-section')).toContainText(f.merchant)

    // Creditor's side: the same underlying transaction, read from the other end.
    await f.payer.goto('/wallet/shared')
    await expect(f.payer.locator('main')).toBeVisible({ timeout: 20_000 })
    await expect(f.payer.getByTestId('splits-section')).toBeVisible({ timeout: 10_000 })
    await expect(f.payer.getByTestId('splits-section')).toContainText(f.merchant)

    await f.payerCtx.close()
    await f.recipCtx.close()
  })

  // The queue must not repeat the original bug: it starts at All time, and
  // narrowing is a deliberate act.
  test('the review queue starts at all time and can be narrowed', async ({ browser }) => {
    const f = await splitFixture(browser, 'bdrange', priorMonthDate(), 100)
    await f.recip.goto('/wallet/shared')
    await expect(f.recip.locator('main')).toBeVisible({ timeout: 20_000 })
    // Visible by default even though the transaction is two months old.
    await expect(f.recip.getByTestId('split-row')).toHaveCount(1, { timeout: 10_000 })

    // Narrowing to this month hides it, and says so rather than showing nothing.
    await f.recip.getByTestId('splits-section').getByTestId('filter-this-month').click()
    await expect(f.recip.getByTestId('split-list-empty')).toBeVisible({ timeout: 10_000 })

    await f.payerCtx.close()
    await f.recipCtx.close()
  })

  // §6: the ledger amount stays visible; the share is shown beneath it.
  test('a split row shows both the ledger amount and your share', async ({ browser }) => {
    const f = await splitFixture(browser, 'shareline', priorMonthDate(), 100)
    await f.payer.request.post(`${API}/transactions/${f.txn.id}/split`, {
      data: { recipientId: f.recipientId, splitMode: 'equal' },
    })
    const recipAcct = await f.recip.request.post(`${API}/accounts`, {
      data: { name: 'R', type: 'card', currency: 'MYR', color: '#1D9E75', icon: 'wallet', openingBalance: 0 },
    }).then((r) => r.json()) as { id: string }
    await settleAndConfirm(f, 50, recipAcct.id, f.acct.id)

    await f.payer.goto('/wallet?range=all')
    await expect(f.payer.getByText(f.merchant)).toBeVisible({ timeout: 15_000 })
    const row = f.payer.locator('[data-testid="transaction-row"]').filter({ hasText: f.merchant })
    // Ledger figure is never hidden — it is what left the account.
    await expect(row).toContainText('100.00')
    await expect(row.getByTestId('effective-amount')).toContainText('50.00')

    await f.payerCtx.close()
    await f.recipCtx.close()
  })
})

// ── R1: one list, tabs, notes, deep links (docs/shared-review-implementation-plan.md §2)
//
// The three renderers that used to draw the same rows in three shapes are one
// component now. These assert what that unification is *for*, not that it
// happened: a claim looks the same wherever you meet it, carries the payer's
// reason, and leads back to the transaction it came from.
test.describe('53 — Split review (R1: unified list)', () => {
  // The note is the payer's explanation. Before R1 the column existed, the API
  // returned it, and nothing ever wrote it — the recipient got a merchant, a
  // date and an amount, with no way to tell an agreed cost from a mistake.
  test('a note written at split time reaches the recipient', async ({ browser }) => {
    const f = await splitFixture(browser, 'note', priorMonthDate(), 100)
    await f.payer.request.post(`${API}/transactions/${f.txn.id}/split`, {
      data: { recipientId: f.recipientId, splitMode: 'none', note: 'half the weekly shop' },
    })

    await f.recip.goto('/wallet/shared')
    await expect(f.recip.locator('main')).toBeVisible({ timeout: 20_000 })
    await expect(f.recip.getByTestId('split-row-note')).toContainText('half the weekly shop', {
      timeout: 10_000,
    })

    await f.payerCtx.close()
    await f.recipCtx.close()
  })

  // Tabs are the claim's life, left to right. A rejected claim leaves the review
  // queue but stays reachable — the reason is the payer's only feedback, and
  // before R1 it was written to a column nothing rendered.
  test('a rejected claim moves out of To review and into Rejected, with its reason', async ({ browser }) => {
    const f = await splitFixture(browser, 'tabs', priorMonthDate(), 100)

    await f.recip.goto('/wallet/shared')
    await expect(f.recip.locator('main')).toBeVisible({ timeout: 20_000 })
    await expect(f.recip.getByTestId('split-row')).toHaveCount(1, { timeout: 10_000 })

    await f.recip.getByTestId('claim-reject').click()
    await f.recip.locator('#reject-reason').fill('this one was mine alone')
    await f.recip.getByTestId('claim-reject-confirm').click()

    // Gone from the default tab...
    await expect(f.recip.getByTestId('split-list-empty')).toBeVisible({ timeout: 10_000 })
    // ...and present, with the reason, under Rejected.
    await f.recip.getByTestId('split-tab-rejected').click()
    await expect(f.recip.getByTestId('split-row-rejected')).toContainText('this one was mine alone', {
      timeout: 10_000,
    })

    await f.payerCtx.close()
    await f.recipCtx.close()
  })

  // Every row leads back to its transaction. The link carries view=all&range=all
  // because the list defaults to the current month and to your own rows — a
  // claim from an earlier month, on someone else's transaction, would otherwise
  // land on an empty page, which is the bug this workstream started from.
  test('a claim row links to the transaction behind it', async ({ browser }) => {
    const f = await splitFixture(browser, 'deeplink', priorMonthDate(), 100)

    await f.recip.goto('/wallet/shared')
    await expect(f.recip.locator('main')).toBeVisible({ timeout: 20_000 })
    await expect(f.recip.getByTestId('split-row-link')).toBeVisible({ timeout: 10_000 })
    await f.recip.getByTestId('split-row-link').click()

    // Lands on a populated list — not the empty state a month filter would give.
    const row = f.recip.locator('[data-testid="transaction-row"]').filter({ hasText: f.merchant })
    await expect(row).toBeVisible({ timeout: 15_000 })
    await expect(row).toHaveAttribute('data-highlighted', 'true')

    await f.payerCtx.close()
    await f.recipCtx.close()
  })

  // A partly-paid claim used to show its full share in the review queue: the
  // paid figure existed only inside the balance breakdown, so the queue said
  // RM100 for a claim with RM40 left on it.
  test('a partly-paid claim shows what is left and what is paid', async ({ browser }) => {
    const f = await splitFixture(browser, 'partial', priorMonthDate(), 100)
    const recipAcct = await f.recip.request.post(`${API}/accounts`, {
      data: { name: 'R', type: 'card', currency: 'MYR', color: '#1D9E75', icon: 'wallet', openingBalance: 0 },
    }).then((r) => r.json()) as { id: string }
    await settleAndConfirm(f, 60, recipAcct.id, f.acct.id)

    await f.recip.goto('/wallet/shared')
    await expect(f.recip.locator('main')).toBeVisible({ timeout: 20_000 })
    const row = f.recip.getByTestId('split-row').first()
    await expect(row.getByTestId('split-row-amount')).toContainText('40.00', { timeout: 10_000 })
    await expect(row.getByTestId('split-row-paid')).toContainText('60.00')

    await f.payerCtx.close()
    await f.recipCtx.close()
  })
})
