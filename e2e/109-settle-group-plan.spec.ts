import { test, expect } from '@playwright/test'
import type { Browser, BrowserContext, Page } from '@playwright/test'
import { businessToday } from './helpers'

// FEAT-024 PR B — GET /groups/:id/settle-plan + the "Settle the group" card.
//
// The card only earns its place when the minimum-transfer plan is SHORTER
// than the pairwise balance list (design.md "value today": for two people
// the plan IS the bilateral net, so it never renders there). Every scenario
// below is sized so the transfer count differs from the pairwise edge count
// by hand-derived amounts, not by chance — see each test's comment for the
// arithmetic.

test.describe.configure({ mode: 'serial' })

const API = '/api'

interface Person {
  ctx: BrowserContext
  page: Page
  id: string
  name: string
  accountId: string
  cat: Record<string, string>
}

interface Trio {
  a: Person
  b: Person
  c: Person
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

/** Three people in one group: `a` creates it, `b` and `c` are invited and accept. */
async function trio(browser: Browser, tag: string): Promise<Trio> {
  const ts = Date.now()
  const a = await signUp(browser, `a_${tag}_${ts}`)
  const b = await signUp(browser, `b_${tag}_${ts}`)
  const c = await signUp(browser, `c_${tag}_${ts}`)

  const group = await a.page.request.post(`${API}/groups`, { data: { name: `G_${tag}` } })
    .then((r) => r.json()) as { id: string }
  for (const member of [b, c]) {
    await a.page.request.post(`${API}/groups/${group.id}/invites`, { data: { username: member.name } })
    const invites = await member.page.request.get(`${API}/invites`).then((r) => r.json()) as { id: string }[]
    await member.page.request.post(`${API}/invites/${invites[0].id}/accept`)
  }
  return { a, b, c, groupId: group.id }
}

/** Two people in one group (for case b). */
async function pair(browser: Browser, tag: string) {
  const ts = Date.now()
  const a = await signUp(browser, `pa_${tag}_${ts}`)
  const b = await signUp(browser, `pb_${tag}_${ts}`)
  const group = await a.page.request.post(`${API}/groups`, { data: { name: `GP_${tag}` } })
    .then((r) => r.json()) as { id: string }
  await a.page.request.post(`${API}/groups/${group.id}/invites`, { data: { username: b.name } })
  const invites = await b.page.request.get(`${API}/invites`).then((r) => r.json()) as { id: string }[]
  await b.page.request.post(`${API}/invites/${invites[0].id}/accept`)
  return { a, b, groupId: group.id }
}

/** `who` pays `amount`, entirely split onto `other` (so `other` owes `who`). */
async function spendFor(
  who: Person, other: Person, merchant: string, amount: number, catName: string, date = businessToday(),
): Promise<string> {
  const created = await who.page.request.post(`${API}/transactions`, {
    data: {
      accountId: who.accountId, date, merchant, amount, type: 'expense',
      categoryId: who.cat[catName], tag: '[]',
    },
  })
  expect(created.status(), await created.text()).toBe(201)
  const txn = await created.json() as { id: string }
  const res = await who.page.request.post(`${API}/transactions/${txn.id}/split`, {
    data: { recipientId: other.id, splitMode: 'none' },
  })
  expect(res.status(), await res.text()).toBe(201)
  return txn.id
}

interface SettleTransfer {
  fromUserId: string; fromUsername: string; toUserId: string; toUsername: string
  amount: number; direct: boolean
}
interface SettlePlan { transfers: SettleTransfer[]; pairwiseCount: number }

async function getSettlePlan(p: Person, groupId: string): Promise<SettlePlan> {
  const res = await p.page.request.get(`${API}/groups/${groupId}/settle-plan`)
  expect(res.status(), await res.text()).toBe(200)
  return res.json()
}

async function closeTrio(f: Trio) {
  await f.a.ctx.close()
  await f.b.ctx.close()
  await f.c.ctx.close()
}

test.describe('109 — settle-plan: the chain collapses, off-graph stays disabled', () => {
  // A owes B 40 (B's expense), B owes C 40 (C's expense). B nets to zero, so
  // the minimum plan is one transfer, A -> C 40 — but A and C share no split,
  // so it is NOT on today's bilateral graph (direct: false). pairwiseCount
  // is 2 (the A:B and B:C edges); the plan has 1 transfer, which is why the
  // card renders at all.
  test('three-person chain: one transfer, non-direct, card shows it disabled', async ({ browser }) => {
    const f = await trio(browser, 'chain')
    await spendFor(f.b, f.a, 'TESCO', 40, 'Food & Drink')
    await spendFor(f.c, f.b, 'AEON', 40, 'Personal Care')

    const plan = await getSettlePlan(f.a, f.groupId)
    expect(plan.pairwiseCount).toBe(2)
    expect(plan.transfers).toHaveLength(1)
    expect(plan.transfers[0]).toMatchObject({
      fromUserId: f.a.id, toUserId: f.c.id, amount: 40, direct: false,
    })

    await f.a.page.goto('/wallet/shared')
    const card = f.a.page.getByTestId('settle-plan')
    await expect(card).toBeVisible()
    const rows = card.getByTestId('settle-plan-row')
    await expect(rows).toHaveCount(1)
    await expect(rows.first()).toContainText(`${f.a.name} pays ${f.c.name}`)
    await expect(rows.first()).toContainText('RM 40.00')
    // A is the payer on this non-direct transfer, so FEAT-024 PR C's client
    // half gives them an enabled "Start three-way settle" button rather than
    // the old disabled "Settle" placeholder.
    await expect(rows.first().getByRole('button', { name: 'Start three-way settle' })).toBeEnabled()

    await closeTrio(f)
  })

  test('two-person group with a split debt: no settle-plan card', async ({ browser }) => {
    const f = await pair(browser, 'two')
    await spendFor(f.a, f.b, 'TESCO', 25, 'Food & Drink')

    const plan = await getSettlePlan(f.a, f.groupId)
    // For two people the plan IS the bilateral net: 1 transfer, 1 pairwise
    // edge — never shorter, so the card must not render.
    expect(plan.pairwiseCount).toBe(1)
    expect(plan.transfers).toHaveLength(1)

    await f.a.page.goto('/wallet/shared')
    await expect(f.a.page.getByTestId('settle-plan')).toHaveCount(0)

    await f.a.ctx.close()
    await f.b.ctx.close()
  })

  test('a non-member gets 404 from the settle-plan endpoint', async ({ browser }) => {
    const f = await trio(browser, 'member-check')
    await spendFor(f.b, f.a, 'TESCO', 40, 'Food & Drink')
    await spendFor(f.c, f.b, 'AEON', 40, 'Personal Care')

    const outsider = await signUp(browser, `out_${Date.now()}`)
    const res = await outsider.page.request.get(`${API}/groups/${f.groupId}/settle-plan`)
    expect(res.status()).toBe(404)

    await closeTrio(f)
    await outsider.ctx.close()
  })

  // A owes B 60, B owes C 30, C owes A 20 — a genuine 3-cycle (no subset but
  // the full set sums to zero: {A}=-40,{B}=+30,{C}=+10, none individually
  // zero, so k=1 and the exact solver needs n-k = 3-1 = 2 transfers).
  // pairwiseCount = 3 (three distinct raw edges, none reversed so none net
  // against each other). Greedy settles largest-magnitude creditor first:
  // debtor A(-40) against creditor B(+30) before C(+10) (30 > 10, no
  // magnitude tie, so this ordering does not depend on user-id randomness).
  //   - A pays B: amount = min(40,30) = 30. A already owes B 60 on the raw
  //     graph (60 >= 30) -> direct: true.
  //   - remaining A(-10) pays C(+10): amount = 10. A owes C 0 on the raw
  //     graph (the only A/C edge runs C -> A) -> direct: false.
  // So the plan is [A->B 30 direct, A->C 10 non-direct], length 2 < 3.
  test('3-cycle with a direct transfer: Settle opens the existing dialog for the right counterparty', async ({ browser }) => {
    const f = await trio(browser, 'cycle')
    await spendFor(f.b, f.a, 'SHELL', 60, 'Transport')
    await spendFor(f.c, f.b, 'TESCO', 30, 'Food & Drink')
    await spendFor(f.a, f.c, 'AEON', 20, 'Personal Care')

    const plan = await getSettlePlan(f.a, f.groupId)
    expect(plan.pairwiseCount).toBe(3)
    expect(plan.transfers).toHaveLength(2)
    const direct = plan.transfers.find((t) => t.direct)
    const nonDirect = plan.transfers.find((t) => !t.direct)
    expect(direct).toMatchObject({ fromUserId: f.a.id, toUserId: f.b.id, amount: 30 })
    expect(nonDirect).toMatchObject({ fromUserId: f.a.id, toUserId: f.c.id, amount: 10 })

    await f.a.page.goto('/wallet/shared')
    const card = f.a.page.getByTestId('settle-plan')
    await expect(card).toBeVisible()
    const rows = card.getByTestId('settle-plan-row')
    await expect(rows).toHaveCount(2)

    const directRow = rows.filter({ hasText: `${f.a.name} pays ${f.b.name}` })
    await expect(directRow).toContainText('RM 30.00')
    await directRow.getByRole('button', { name: 'Settle' }).click()

    const dialog = f.a.page.getByRole('dialog', { name: 'Settle Up' })
    await expect(dialog).toBeVisible()
    // The debtor-side copy names the counterparty the dialog opened for.
    await expect(dialog).toContainText(f.b.name)
    await expect(dialog.locator('input[type=number]')).toHaveValue('30')

    await closeTrio(f)
  })
})
