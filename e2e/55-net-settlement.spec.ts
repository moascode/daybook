import { test, expect } from '@playwright/test'
import type { Browser, BrowserContext, Page } from '@playwright/test'

// Settling when two people owe each other.
//
// Only the difference moves; the rest is netted off. Before this, POST
// /settlements looked one direction at a time on that direction's gross — so
// Kakon owed RM30 and owing RM15 could only be cleared by sending RM30 one way
// and RM15 the other, RM45 of cash for a RM15 debt, and the "no outstanding
// balance" guard refused everything once the net hit zero.
//
// The anchor case below asserts the whole accounting table, because the trap
// here is not whether it settles — it is whether the books survive it.

test.describe.configure({ mode: 'serial' })

const API = 'http://localhost:5173/api'

function businessToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kuala_Lumpur', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
}

/** `days` back from today, in the business timezone. */
function daysAgo(days: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kuala_Lumpur', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(Date.now() - days * 86_400_000))
}

/** formatMYR's output, tolerant of the ICU space between symbol and digits, and
 *  of the explicit '+' the Net tile prepends when it is not negative. */
function money(n: number): RegExp {
  const sign = n < 0 ? '-' : '\\+?'
  return new RegExp(`^${sign}RM\\s*${Math.abs(n).toFixed(2).replace('.', '\\.')}$`)
}

interface Person {
  ctx: BrowserContext
  page: Page
  id: string
  name: string
  accountId: string
  /** Their OWN category ids, by name. Categories are seeded per user, so the
   *  two people have different ids for the same fifteen names — using one
   *  person's id on the other's transaction is rejected outright. */
  cat: Record<string, string>
}

interface Pair {
  kakon: Person
  tumpa: Person
  groupId: string
}

async function signUp(browser: Browser, name: string): Promise<Person> {
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  await page.request.post(`${API}/auth/signup`, { data: { username: name, password: 'test-password' } })
  const id = await page.request.get(`${API}/auth/me`).then((r) => r.json())
    .then((m: { user: { id: string } }) => m.user.id)
  const account = await page.request.post(`${API}/accounts`, {
    data: { name: `${name} card`, type: 'card', currency: 'MYR', color: '#1D9E75', icon: 'wallet', openingBalance: 0 },
  }).then((r) => r.json()) as { id: string }
  const rows = await page.request.get(`${API}/categories`).then((r) => r.json()) as
    { id: string; name: string }[]
  const cat = Object.fromEntries(rows.map((r) => [r.name, r.id]))
  return { ctx, page, id, name, accountId: account.id, cat }
}

/** Two people in one group, each with an account and the seeded categories. */
async function pair(browser: Browser, tag: string): Promise<Pair> {
  const ts = Date.now()
  const kakon = await signUp(browser, `k_${tag}_${ts}`)
  const tumpa = await signUp(browser, `t_${tag}_${ts}`)

  const group = await kakon.page.request.post(`${API}/groups`, { data: { name: `G_${tag}` } })
    .then((r) => r.json()) as { id: string }
  await kakon.page.request.post(`${API}/groups/${group.id}/invites`, { data: { username: tumpa.name } })
  const invites = await tumpa.page.request.get(`${API}/invites`).then((r) => r.json()) as { id: string }[]
  await tumpa.page.request.post(`${API}/invites/${invites[0].id}/accept`)

  return { kakon, tumpa, groupId: group.id }
}

/** `who` pays `amount` in category `catName` and splits it all onto `other`. */
async function spendFor(
  who: Person, other: Person, merchant: string, amount: number, catName: string, date = businessToday(),
): Promise<string> {
  const created = await who.page.request.post(`${API}/transactions`, {
    data: {
      accountId: who.accountId, date, merchant, amount, type: 'expense',
      categoryId: who.cat[catName], tag: '[]',
    },
  })
  // Asserted, not assumed: a failure here used to surface as a 404 from the
  // split below, which reads as a routing problem rather than a bad payload.
  expect(created.status(), await created.text()).toBe(201)
  const txn = await created.json() as { id: string }
  const res = await who.page.request.post(`${API}/transactions/${txn.id}/split`, {
    data: { recipientId: other.id, splitMode: 'none' },
  })
  expect(res.status(), await res.text()).toBe(201)
  return txn.id
}

/** What each category actually cost this person this month. */
async function spending(p: Person): Promise<Record<string, number>> {
  const rows = await p.page.request
    .get(`${API}/budgets/spending?month=${businessToday().slice(0, 7)}`)
    .then((r) => r.json()) as { categoryId: string; spent: number }[]
  return Object.fromEntries(rows.map((r) => [r.categoryId, Math.round(r.spent * 100) / 100]))
}

async function balanceOf(p: Person): Promise<number> {
  const rows = await p.page.request.get(`${API}/accounts/balances`).then((r) => r.json()) as
    { id: string; balance: number }[]
  return Math.round((rows.find((r) => r.id === p.accountId)!.balance) * 100) / 100
}

async function balances(p: Person, groupId: string) {
  return await p.page.request.get(`${API}/groups/${groupId}/balances`).then((r) => r.json()) as
    { fromUserId: string; toUserId: string; amount: number }[]
}

async function close(f: Pair) {
  await f.kakon.ctx.close()
  await f.tumpa.ctx.close()
}

test.describe('55 — Netting: the RM30 / RM15 case', () => {
  // Kakon pays RM30 that is entirely Tumpa's. Tumpa pays RM15 that is entirely
  // Kakon's. Net: Tumpa owes RM15.
  //
  // Ground truth afterwards: Kakon bore RM15 (Tumpa's Aeon run, which he
  // consumed), Tumpa bore RM30 (his Tesco run) — RM45 total, which is what left
  // the household. Every assertion below is one line of that.
  test('one payment clears both claims, and the books still add up', async ({ browser }) => {
    const f = await pair(browser, 'anchor')
        await spendFor(f.kakon, f.tumpa, 'TESCO EXTRA', 30, 'Food & Drink')
    await spendFor(f.tumpa, f.kakon, 'AEON', 15, 'Personal Care')

    // The netted view, before anything is recorded.
    const preview = await f.tumpa.page.request.post(`${API}/settlements/preview`, {
      data: { groupId: f.groupId, counterpartyId: f.kakon.id },
    }).then((r) => r.json()) as {
      theyOweYou: number; youOweThem: number; offset: number; net: number
      payerId: string; applied: number
    }
    expect(preview.youOweThem).toBeCloseTo(30, 2)
    expect(preview.theyOweYou).toBeCloseTo(15, 2)
    expect(preview.offset).toBeCloseTo(15, 2)
    expect(preview.net).toBeCloseTo(-15, 2)
    expect(preview.payerId).toBe(f.tumpa.id)
    // The default is the whole net — "settle everything" is one click.
    expect(preview.applied).toBeCloseTo(15, 2)

    // Tumpa records it (no amount ⇒ the full net), Kakon confirms.
    const settle = await f.tumpa.page.request.post(`${API}/settlements`, {
      data: { groupId: f.groupId, toUserId: f.kakon.id, fromAccountId: f.tumpa.accountId },
    })
    expect(settle.status()).toBe(201)
    const settlementId = (await settle.json()).id as string
    const confirm = await f.kakon.page.request.post(`${API}/settlements/${settlementId}/confirm`, {
      data: { accountId: f.kakon.accountId },
    })
    expect(confirm.ok()).toBeTruthy()

    // ── Both claims settled, nothing outstanding ──
    expect(await balances(f.kakon, f.groupId)).toEqual([])
    const kakonClaims = await f.kakon.page.request
      .get(`${API}/transactions/splits/mine?role=creditor&state=settled`)
      .then((r) => r.json()) as unknown[]
    const tumpaClaims = await f.tumpa.page.request
      .get(`${API}/transactions/splits/mine?role=creditor&state=settled`)
      .then((r) => r.json()) as unknown[]
    expect(kakonClaims).toHaveLength(1)
    expect(tumpaClaims).toHaveLength(1)

    // ── Spending: right totals AND right categories ──
    // This is the assertion the whole design turns on. Booking the netted debt
    // nowhere would leave Kakon's RM30 reading as costing him nothing and drop
    // RM30 of real household spending off both sets of books.
    const kakonSpend = await spending(f.kakon)
    expect(kakonSpend[f.kakon.cat['Food & Drink']] ?? 0).toBeCloseTo(0, 2)   // Tesco was entirely Tumpa's
    expect(kakonSpend[f.kakon.cat['Personal Care']]).toBeCloseTo(15, 2)       // he consumed Aeon goods
    const tumpaSpend = await spending(f.tumpa)
    expect(tumpaSpend[f.tumpa.cat['Personal Care']] ?? 0).toBeCloseTo(0, 2)   // Aeon was entirely Kakon's
    expect(tumpaSpend[f.tumpa.cat['Food & Drink']]).toBeCloseTo(30, 2)       // 15 netted + 15 cash

    // ── Balances: the netted leg must not move money ──
    expect(await balanceOf(f.kakon)).toBeCloseTo(-15, 2)   // −30 out, +15 back
    expect(await balanceOf(f.tumpa)).toBeCloseTo(-30, 2)   // −15 out, −15 paid

    await close(f)
  })

  test('a netted leg is a real expense that moved no money', async ({ browser }) => {
    const f = await pair(browser, 'legs')
    await spendFor(f.kakon, f.tumpa, 'TESCO', 30, 'Food & Drink')
    await spendFor(f.tumpa, f.kakon, 'AEON', 15, 'Personal Care')

    const id = await f.tumpa.page.request.post(`${API}/settlements`, {
      data: { groupId: f.groupId, toUserId: f.kakon.id, fromAccountId: f.tumpa.accountId },
    }).then((r) => r.json()).then((s: { id: string }) => s.id)
    await f.kakon.page.request.post(`${API}/settlements/${id}/confirm`, {
      data: { accountId: f.kakon.accountId },
    })

    const rows = await f.kakon.page.request.get(`${API}/transactions`).then((r) => r.json()) as
      { description: string; amount: number; type: string; is_non_cash: number; is_balance_only: number }[]
    const netted = rows.find((r) => r.description.startsWith('Settled by netting'))!
    expect(netted).toBeTruthy()
    expect(netted.amount).toBeCloseTo(15, 2)
    expect(netted.type).toBe('expense')
    expect(netted.is_non_cash).toBe(1)
    // Not balance-only: that flag is the opposite case — money that moved but is
    // not an expense. This is an expense that moved no money.
    expect(netted.is_balance_only).toBe(0)

    await close(f)
  })
})

test.describe('55 — Netting in the UI', () => {
  test('the dialog states what nets off, and a settled row says how it cleared', async ({ browser }) => {
    const f = await pair(browser, 'ui')
    await spendFor(f.kakon, f.tumpa, 'TESCO', 30, 'Food & Drink')
    await spendFor(f.tumpa, f.kakon, 'AEON', 15, 'Personal Care')

    await f.tumpa.page.goto('/wallet/shared')
    await f.tumpa.page.getByRole('button', { name: /Settle Up/ }).click()

    const netting = f.tumpa.page.getByTestId('settle-netting')
    await expect(netting).toBeVisible()
    await expect(netting).toContainText('Netted off')
    await expect(netting).toContainText('15.00')
    // The amount box is pre-filled with the net, so clearing it is one click.
    await expect(f.tumpa.page.getByRole('dialog').locator('input[type=number]')).toHaveValue('15')

    const dialog = f.tumpa.page.getByRole('dialog')
    await dialog.locator('select').selectOption({ index: 1 })
    await dialog.getByRole('button', { name: 'Record Settlement' }).click()
    await expect(dialog).toBeHidden()

    // Kakon confirms, then reads how his claim cleared.
    const id = await f.kakon.page.request.get(`${API}/settlements`).then((r) => r.json())
      .then((rows: { id: string }[]) => rows[0].id)
    await f.kakon.page.request.post(`${API}/settlements/${id}/confirm`, {
      data: { accountId: f.kakon.accountId },
    })

    await f.kakon.page.goto('/wallet/shared')
    await f.kakon.page.getByTestId('direction-owed-to-me').click()
    await f.kakon.page.getByTestId('split-tab-settled').click()
    await expect(f.kakon.page.getByTestId('split-row-hint').first())
      .toContainText(/15\.00 paid, RM\s?15\.00 netted/)

    await close(f)
  })

  // The headline figures on the main Transactions page are the one place these
  // numbers are read casually, so they must agree with the books. The summary
  // used to sum the RAW ledger amount: a transaction split entirely onto someone
  // else showed "your share RM 0.00" on its own row while still adding its full
  // amount to the Expense total directly above it, and the creditor's
  // balance-only settlement leg was counted as income.
  test('the summary row reports what the viewer bore, not the ledger gross', async ({ browser }) => {
    const f = await pair(browser, 'summary')
    await spendFor(f.kakon, f.tumpa, 'TESCO', 30, 'Food & Drink')
    await spendFor(f.tumpa, f.kakon, 'AEON', 15, 'Personal Care')

    const id = await f.tumpa.page.request.post(`${API}/settlements`, {
      data: { groupId: f.groupId, toUserId: f.kakon.id, fromAccountId: f.tumpa.accountId },
    }).then((r) => r.json()).then((s: { id: string }) => s.id)
    await f.kakon.page.request.post(`${API}/settlements/${id}/confirm`, {
      data: { accountId: f.kakon.accountId },
    })

    // Ground truth, from the same server-side EFFECTIVE_AMOUNT_SQL the dashboard,
    // reports and budgets already go through. Everything in this fixture is dated
    // today, so the month view and all-time see the same rows.
    const bore = Object.values(await spending(f.kakon)).reduce((a, b) => a + b, 0)
    expect(bore).toBeCloseTo(15, 2)

    await f.kakon.page.goto('/wallet?view=all&range=all')
    await expect(f.kakon.page.getByTestId('summary-expense')).toHaveText(money(bore))
    // The incoming settlement leg moved money but is not income.
    await expect(f.kakon.page.getByTestId('summary-income')).toHaveText(money(0))
    await expect(f.kakon.page.getByTestId('summary-net')).toHaveText(money(-bore))

    // And the row it is summing still shows the ledger amount it was paid at —
    // the summary nets down, the row does not.
    await expect(f.kakon.page.getByText('TESCO')).toBeVisible()

    await close(f)
  })
})

test.describe('55 — Netting: edges', () => {
  test('a dead-even pair settles with no cash at all', async ({ browser }) => {
    const f = await pair(browser, 'even')
    await spendFor(f.kakon, f.tumpa, 'TESCO', 20, 'Food & Drink')
    await spendFor(f.tumpa, f.kakon, 'AEON', 20, 'Personal Care')

    const preview = await f.kakon.page.request.post(`${API}/settlements/preview`, {
      data: { groupId: f.groupId, counterpartyId: f.tumpa.id },
    }).then((r) => r.json()) as { offset: number; net: number; payerId: string | null }
    expect(preview.offset).toBeCloseTo(20, 2)
    expect(preview.net).toBeCloseTo(0, 2)
    expect(preview.payerId).toBeNull()

    const settle = await f.kakon.page.request.post(`${API}/settlements`, {
      data: { groupId: f.groupId, toUserId: f.tumpa.id, fromAccountId: f.kakon.accountId },
    })
    expect(settle.status()).toBe(201)
    const id = (await settle.json()).id as string
    // Still needs the other person's agreement: it writes off their claims too.
    await expect(f.tumpa.page.request.post(`${API}/settlements/${id}/confirm`, {
      data: { accountId: f.tumpa.accountId },
    })).resolves.toBeTruthy()

    expect(await balances(f.kakon, f.groupId)).toEqual([])
    // Nobody sent anything, so neither balance moved.
    expect(await balanceOf(f.kakon)).toBeCloseTo(-20, 2)
    expect(await balanceOf(f.tumpa)).toBeCloseTo(-20, 2)
    // But both bore what they consumed.
    expect((await spending(f.kakon))[f.kakon.cat['Personal Care']]).toBeCloseTo(20, 2)
    expect((await spending(f.tumpa))[f.tumpa.cat['Food & Drink']]).toBeCloseTo(20, 2)

    await close(f)
  })

  test('rejecting restores both directions untouched', async ({ browser }) => {
    const f = await pair(browser, 'reject')
    await spendFor(f.kakon, f.tumpa, 'TESCO', 30, 'Food & Drink')
    await spendFor(f.tumpa, f.kakon, 'AEON', 15, 'Personal Care')

    const id = await f.tumpa.page.request.post(`${API}/settlements`, {
      data: { groupId: f.groupId, toUserId: f.kakon.id, fromAccountId: f.tumpa.accountId },
    }).then((r) => r.json()).then((s: { id: string }) => s.id)
    const rejected = await f.kakon.page.request.post(`${API}/settlements/${id}/reject`, {
      data: { reason: 'never arrived' },
    })
    expect(rejected.ok()).toBeTruthy()

    // Both debts stand, in full, in both directions.
    const rows = await balances(f.kakon, f.groupId)
    expect(rows).toHaveLength(1)
    expect(rows[0].amount).toBeCloseTo(15, 2)
    // And nothing was netted off either claim.
    const claims = await f.tumpa.page.request
      .get(`${API}/transactions/splits/mine?state=pending,approved`)
      .then((r) => r.json()) as { share_amount: number; settled_amount: number; offset_amount: number }[]
    expect(claims).toHaveLength(1)
    expect(claims[0].settled_amount).toBeCloseTo(0, 2)
    expect(claims[0].offset_amount).toBeCloseTo(0, 2)
    // The payer's legs are gone — neither the cash nor the netted expense happened.
    const txns = await f.tumpa.page.request.get(`${API}/transactions`).then((r) => r.json()) as
      { description: string }[]
    expect(txns.filter((t) => t.description.startsWith('Settle'))).toHaveLength(0)

    await close(f)
  })

  test('undo gives back the cash AND the netting', async ({ browser }) => {
    const f = await pair(browser, 'undo')
    await spendFor(f.kakon, f.tumpa, 'TESCO', 30, 'Food & Drink')
    await spendFor(f.tumpa, f.kakon, 'AEON', 15, 'Personal Care')

    const id = await f.tumpa.page.request.post(`${API}/settlements`, {
      data: { groupId: f.groupId, toUserId: f.kakon.id, fromAccountId: f.tumpa.accountId },
    }).then((r) => r.json()).then((s: { id: string }) => s.id)
    await f.kakon.page.request.post(`${API}/settlements/${id}/confirm`, {
      data: { accountId: f.kakon.accountId },
    })
    expect(await balances(f.kakon, f.groupId)).toEqual([])

    const undone = await f.tumpa.page.request.delete(`${API}/settlements/${id}`)
    expect(undone.status()).toBe(204)

    // Back to RM30 and RM15 outstanding, netting to RM15 again.
    const rows = await balances(f.kakon, f.groupId)
    expect(rows).toHaveLength(1)
    expect(rows[0].amount).toBeCloseTo(15, 2)
    // Every ledger leg is gone from both sides — including the netted ones.
    for (const p of [f.kakon, f.tumpa]) {
      const txns = await p.page.request.get(`${API}/transactions`).then((r) => r.json()) as
        { description: string }[]
      expect(txns.filter((t) => t.description.startsWith('Settle'))).toHaveLength(0)
    }
    expect(await balanceOf(f.kakon)).toBeCloseTo(-30, 2)
    expect(await balanceOf(f.tumpa)).toBeCloseTo(-15, 2)

    await close(f)
  })

  test('a date scope settles only what is inside it', async ({ browser }) => {
    const f = await pair(browser, 'scope')
    const old = daysAgo(60)
    await spendFor(f.kakon, f.tumpa, 'OLD', 40, 'Food & Drink', old)
    await spendFor(f.kakon, f.tumpa, 'RECENT', 25, 'Food & Drink')

    // Only the recent one is in scope.
    const settle = await f.tumpa.page.request.post(`${API}/settlements`, {
      data: {
        groupId: f.groupId, toUserId: f.kakon.id, fromAccountId: f.tumpa.accountId,
        dateFrom: daysAgo(7), dateTo: businessToday(),
      },
    })
    expect(settle.status()).toBe(201)
    const id = (await settle.json()).id as string
    await f.kakon.page.request.post(`${API}/settlements/${id}/confirm`, {
      data: { accountId: f.kakon.accountId },
    })

    // The old RM40 is still owed in full.
    const rows = await balances(f.kakon, f.groupId)
    expect(rows).toHaveLength(1)
    expect(rows[0].amount).toBeCloseTo(40, 2)
    const settled = await f.kakon.page.request
      .get(`${API}/transactions/splits/mine?role=creditor&state=settled`)
      .then((r) => r.json()) as { merchant: string }[]
    expect(settled.map((s) => s.merchant)).toEqual(['RECENT'])

    await close(f)
  })

  test('a partial payment still nets the mutual debt in full', async ({ browser }) => {
    const f = await pair(browser, 'partial')
    await spendFor(f.kakon, f.tumpa, 'TESCO', 30, 'Food & Drink')
    await spendFor(f.tumpa, f.kakon, 'AEON', 15, 'Personal Care')

    // Net is 15; Tumpa pays 5 of it.
    const id = await f.tumpa.page.request.post(`${API}/settlements`, {
      data: { groupId: f.groupId, toUserId: f.kakon.id, amount: 5, fromAccountId: f.tumpa.accountId },
    }).then((r) => r.json()).then((s: { id: string }) => s.id)
    await f.kakon.page.request.post(`${API}/settlements/${id}/confirm`, {
      data: { accountId: f.kakon.accountId },
    })

    // 15 netted + 5 paid = 20 of Tumpa's 30 discharged; 10 left.
    const rows = await balances(f.kakon, f.groupId)
    expect(rows).toHaveLength(1)
    expect(rows[0].fromUserId).toBe(f.tumpa.id)
    expect(rows[0].amount).toBeCloseTo(10, 2)
    // Kakon's side is fully cleared by the netting.
    const kakonOwes = await f.kakon.page.request
      .get(`${API}/transactions/splits/mine?state=pending,approved`)
      .then((r) => r.json()) as unknown[]
    expect(kakonOwes).toHaveLength(0)

    await close(f)
  })

  test('overpaying is capped at the net, not at one side of it', async ({ browser }) => {
    const f = await pair(browser, 'cap')
    await spendFor(f.kakon, f.tumpa, 'TESCO', 30, 'Food & Drink')
    await spendFor(f.tumpa, f.kakon, 'AEON', 15, 'Personal Care')

    const res = await f.tumpa.page.request.post(`${API}/settlements`, {
      data: { groupId: f.groupId, toUserId: f.kakon.id, amount: 500, fromAccountId: f.tumpa.accountId },
    })
    expect(res.status()).toBe(201)
    const body = await res.json() as { id: string; message?: string }
    expect(body.message).toContain('15.00')
    await f.kakon.page.request.post(`${API}/settlements/${body.id}/confirm`, {
      data: { accountId: f.kakon.accountId },
    })
    // Capped at the net: Tumpa is out 15, not 500.
    expect(await balanceOf(f.tumpa)).toBeCloseTo(-30, 2)

    await close(f)
  })
})
