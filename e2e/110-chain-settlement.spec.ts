import { test, expect } from '@playwright/test'
import type { Browser, BrowserContext, Page } from '@playwright/test'
import { businessToday } from './helpers'

// FEAT-024 PR C — three-party ("chain") settlement, backend/API coverage.
// Spec: docs/backlog/EP-06-wallet-depth/FEAT-024-design.md §3, and the exact
// contract in the PR-C spec handed to this session. Case 1 (happy path) is
// exercised via the API here; a UI-driven variant of case 1 is added by the
// client-side pass. Every other case is API-only per the PR-C spec.
//
// Fixture throughout: A, B, C in one group. B's RM40 expense split so A owes
// B 40; C's RM40 expense split so B owes C 40. B nets to zero on that pair
// of edges, so the minimum-transfer plan is one transfer, A -> C 40 — exactly
// the off-graph case PR C exists to execute.

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

/** Seeds the standard A owes B 40, B owes C 40 fixture. */
async function seedChainFixture(browser: Browser, tag: string): Promise<Trio> {
  const f = await trio(browser, tag)
  await spendFor(f.b, f.a, 'TESCO', 40, 'Food & Drink')
  await spendFor(f.c, f.b, 'AEON', 40, 'Personal Care')
  return f
}

async function closeTrio(f: Trio) {
  await f.a.ctx.close()
  await f.b.ctx.close()
  await f.c.ctx.close()
}

interface Chain { id: string }

async function startChain(f: Trio, amount = 40): Promise<string> {
  const res = await f.a.page.request.post(`${API}/settlement-chains`, {
    data: { groupId: f.groupId, payeeId: f.c.id, amount, accountId: f.a.accountId },
  })
  expect(res.status(), await res.text()).toBe(201)
  return ((await res.json()) as Chain).id
}

async function confirmChain(p: Person, chainId: string) {
  return p.page.request.post(`${API}/settlement-chains/${chainId}/confirm`, {
    data: { accountId: p.accountId },
  })
}

interface TxnRow {
  id: string
  description: string
  amount: number
  type: string
  is_non_cash: number
  is_balance_only: number
  account_id: string
}

async function transactionsOf(p: Person): Promise<TxnRow[]> {
  return p.page.request.get(`${API}/transactions`).then((r) => r.json())
}

interface SplitMine {
  id: string
  status: string
  settled_amount: number
  share_amount: number
}

async function creditorSettledSplits(p: Person): Promise<SplitMine[]> {
  return p.page.request
    .get(`${API}/transactions/splits/mine?role=creditor&state=settled`)
    .then((r) => r.json())
}

async function balances(p: Person, groupId: string): Promise<unknown[]> {
  return p.page.request.get(`${API}/groups/${groupId}/balances`).then((r) => r.json())
}

test.describe('110 — chain settlement', () => {
  test('case 1: happy path — A starts, B confirms, C confirms', async ({ browser }) => {
    const f = await seedChainFixture(browser, 'happy')
    const chainId = await startChain(f)

    const bConfirm = await confirmChain(f.b, chainId)
    expect(bConfirm.status(), await bConfirm.text()).toBe(200)
    expect(await bConfirm.json()).toMatchObject({ status: 'awaiting_confirmation' })

    const cConfirm = await confirmChain(f.c, chainId)
    expect(cConfirm.status(), await cConfirm.text()).toBe(200)
    expect(await cConfirm.json()).toMatchObject({ id: chainId, status: 'confirmed' })

    // A: cash expense leg.
    const aTxns = await transactionsOf(f.a)
    const aLeg = aTxns.find((t) => t.description.startsWith('Settlement to'))!
    expect(aLeg).toBeTruthy()
    expect(aLeg.amount).toBeCloseTo(40, 2)
    expect(aLeg.type).toBe('expense')
    expect(aLeg.is_non_cash).toBe(0)
    expect(aLeg.is_balance_only).toBe(0)
    expect(aLeg.account_id).toBe(f.a.accountId)

    // B: non-cash netted expense leg, on B's chosen account.
    const bTxns = await transactionsOf(f.b)
    const bLeg = bTxns.find((t) => t.description.startsWith('Settled by three-way settlement'))!
    expect(bLeg).toBeTruthy()
    expect(bLeg.amount).toBeCloseTo(40, 2)
    expect(bLeg.type).toBe('expense')
    expect(bLeg.is_non_cash).toBe(1)
    expect(bLeg.is_balance_only).toBe(0)
    expect(bLeg.account_id).toBe(f.b.accountId)

    // C: balance-only income leg.
    const cTxns = await transactionsOf(f.c)
    const cLeg = cTxns.find((t) => t.description.startsWith('Settlement from'))!
    expect(cLeg).toBeTruthy()
    expect(cLeg.amount).toBeCloseTo(40, 2)
    expect(cLeg.type).toBe('income')
    expect(cLeg.is_non_cash).toBe(0)
    expect(cLeg.is_balance_only).toBe(1)
    expect(cLeg.account_id).toBe(f.c.accountId)

    // Both splits settled in full.
    const bClaims = await creditorSettledSplits(f.b)
    const cClaims = await creditorSettledSplits(f.c)
    expect(bClaims).toHaveLength(1)
    expect(bClaims[0]).toMatchObject({ status: 'settled', settled_amount: 40, share_amount: 40 })
    expect(cClaims).toHaveLength(1)
    expect(cClaims[0]).toMatchObject({ status: 'settled', settled_amount: 40, share_amount: 40 })

    // No outstanding balance left in the group.
    expect(await balances(f.a, f.groupId)).toEqual([])

    await closeTrio(f)
  })

  test('case 2: partial confirmation does nothing', async ({ browser }) => {
    const f = await seedChainFixture(browser, 'partial')
    const chainId = await startChain(f)

    const bConfirm = await confirmChain(f.b, chainId)
    expect(bConfirm.status()).toBe(200)

    // Balances unchanged — A still owes (via the edges) and nothing executed.
    const bal = await balances(f.a, f.groupId)
    expect(bal).not.toEqual([])

    const bTxns = await transactionsOf(f.b)
    expect(bTxns.find((t) => t.description.startsWith('Settled by three-way settlement'))).toBeFalsy()
    const cTxns = await transactionsOf(f.c)
    expect(cTxns.find((t) => t.description.startsWith('Settlement from'))).toBeFalsy()

    await closeTrio(f)
  })

  test('case 3: reject by C releases everything', async ({ browser }) => {
    const f = await seedChainFixture(browser, 'reject')
    const chainId = await startChain(f)
    await confirmChain(f.b, chainId)

    const reject = await f.c.page.request.post(`${API}/settlement-chains/${chainId}/reject`, {
      data: { reason: 'did not happen' },
    })
    expect(reject.status(), await reject.text()).toBe(200)
    expect(await reject.json()).toMatchObject({ id: chainId, status: 'rejected' })

    // A's cash leg is gone.
    const aTxns = await transactionsOf(f.a)
    expect(aTxns.find((t) => t.description.startsWith('Settlement to'))).toBeFalsy()

    // Splits payable again — a fresh chain can be started.
    const newChainId = await startChain(f)
    expect(newChainId).toBeTruthy()
    expect(newChainId).not.toBe(chainId)

    await closeTrio(f)
  })

  test('case 4: undo after confirm restores everything', async ({ browser }) => {
    const f = await seedChainFixture(browser, 'undo')
    const chainId = await startChain(f)
    await confirmChain(f.b, chainId)
    await confirmChain(f.c, chainId)

    const del = await f.a.page.request.delete(`${API}/settlement-chains/${chainId}`)
    expect(del.status(), await del.text()).toBe(204)

    const aTxns = await transactionsOf(f.a)
    expect(aTxns.find((t) => t.description.startsWith('Settlement to'))).toBeFalsy()
    const bTxns = await transactionsOf(f.b)
    expect(bTxns.find((t) => t.description.startsWith('Settled by three-way settlement'))).toBeFalsy()
    const cTxns = await transactionsOf(f.c)
    expect(cTxns.find((t) => t.description.startsWith('Settlement from'))).toBeFalsy()

    // Splits back to pending/approved, unsettled.
    const bClaims = await creditorSettledSplits(f.b)
    const cClaims = await creditorSettledSplits(f.c)
    expect(bClaims).toHaveLength(0)
    expect(cClaims).toHaveLength(0)

    // Balances restored.
    expect(await balances(f.a, f.groupId)).not.toEqual([])

    await closeTrio(f)
  })

  test('case 5: guards', async ({ browser }) => {
    const f = await seedChainFixture(browser, 'guards')
    const chainId = await startChain(f)

    const outsider = await signUp(browser, `out_${Date.now()}`)

    const getNonMember = await outsider.page.request.get(`${API}/settlement-chains?groupId=${f.groupId}`)
    expect(getNonMember.status()).toBe(404)
    const confirmNonMember = await confirmChain(outsider, chainId)
    expect(confirmNonMember.status()).toBe(404)

    // A is a group member but not a party to A's own chain? No — A IS the
    // payer and therefore a party. Use a second outsider who IS a group
    // member (invite them) but not a party to this chain.
    await f.a.page.request.post(`${API}/groups/${f.groupId}/invites`, { data: { username: outsider.name } })
    const invites = await outsider.page.request.get(`${API}/invites`).then((r) => r.json()) as { id: string }[]
    await outsider.page.request.post(`${API}/invites/${invites[0].id}/accept`)
    const confirmNonParty = await confirmChain(outsider, chainId)
    expect(confirmNonParty.status()).toBe(404)

    // The bilateral endpoints refuse a chained settlement row. Picked
    // specifically as the A->B hop (to_user = B) so /confirm and /reject,
    // which both require the caller to be that hop's to_user, have a row to
    // act on at all before hitting the chain_id guard.
    const hopsRes = await f.b.page.request.get(`${API}/settlements?groupId=${f.groupId}`)
    const hops = (await hopsRes.json()) as {
      id: string; chain_id: string | null; from_user: string; to_user: string
    }[]
    const chainedHop = hops.find(
      (h) => h.chain_id === chainId && h.from_user === f.a.id && h.to_user === f.b.id,
    )!
    expect(chainedHop).toBeTruthy()

    const bilateralConfirm = await f.b.page.request.post(`${API}/settlements/${chainedHop.id}/confirm`, {
      data: { accountId: f.b.accountId },
    })
    expect(bilateralConfirm.status()).toBe(409)
    const bilateralReject = await f.b.page.request.post(`${API}/settlements/${chainedHop.id}/reject`, { data: {} })
    expect(bilateralReject.status()).toBe(409)
    const bilateralUndo = await f.a.page.request.delete(`${API}/settlements/${chainedHop.id}`)
    expect(bilateralUndo.status()).toBe(409)

    // Direct (1-hop) transfer via /settlement-chains -> 400.
    const direct = await f.b.page.request.post(`${API}/settlement-chains`, {
      data: { groupId: f.groupId, payeeId: f.a.id, amount: 10, accountId: f.b.accountId },
    })
    expect(direct.status(), await direct.text()).toBe(400)

    // Amount larger than routable -> 400.
    const tooLarge = await f.a.page.request.post(`${API}/settlement-chains`, {
      data: { groupId: f.groupId, payeeId: f.c.id, amount: 999, accountId: f.a.accountId },
    })
    expect(tooLarge.status(), await tooLarge.text()).toBe(400)

    await closeTrio(f)
    await outsider.ctx.close()
  })

  test('case 6: fault injection — a split is independently settled underneath the chain', async ({ browser }) => {
    const f = await seedChainFixture(browser, 'fault')
    const chainId = await startChain(f)
    await confirmChain(f.b, chainId)

    // The split B->C discharges (B owes C 40) — still unsettled right now,
    // since only the no-op probe ran at creation and B's own confirm just
    // picked an account. Its derived claim_state is 'awaiting_confirmation'
    // (CLAUDE.md §3: lifecycle UI groups on that derived state, never on the
    // raw `status` column) because it is locked into this chain's hop rows.
    const bOwesC = await f.b.page.request
      .get(`${API}/transactions/splits/mine?state=awaiting_confirmation`)
      .then((r) => r.json()) as { id: string; settled_amount: number; share_amount: number }[]
    const victim = bOwesC.find((s) => s.share_amount === 40)!
    expect(victim).toBeTruthy()
    expect(victim.settled_amount).toBeCloseTo(0, 2)

    // Simulate it being independently, fully settled by something else in the
    // gap before C confirms — exactly what the chain's CAS guard
    // (`status IN ('pending','approved')`) exists to catch.
    const forced = await f.b.page.request.post(`${API}/test/force-settle-split`, {
      data: { splitId: victim.id },
    })
    expect(forced.status(), await forced.text()).toBe(200)

    const cConfirm = await confirmChain(f.c, chainId)
    expect(cConfirm.status(), await cConfirm.text()).toBe(409)

    // Nothing the chain's own write set would have added moved: no B/C legs.
    const bTxns = await transactionsOf(f.b)
    expect(bTxns.find((t) => t.description.startsWith('Settled by three-way settlement'))).toBeFalsy()
    const cTxns = await transactionsOf(f.c)
    expect(cTxns.find((t) => t.description.startsWith('Settlement from'))).toBeFalsy()

    // The forced split is exactly as the fault left it — the failed confirm
    // never touched it (it was never a "survivor" to roll back).
    const after = await f.b.page.request
      .get(`${API}/transactions/splits/mine?state=settled`)
      .then((r) => r.json()) as { id: string; settled_amount: number; status: string }[]
    const victimAfter = after.find((s) => s.id === victim.id)!
    expect(victimAfter.settled_amount).toBeCloseTo(40, 2)
    expect(victimAfter.status).toBe('settled')

    // The OTHER split (A->B) was a real survivor inside the failed batch —
    // D1's batch() applies every statement regardless of a sibling CAS miss,
    // so it is explicitly reversed back to unsettled rather than left half-applied.
    const aOwesB = await f.a.page.request
      .get(`${API}/transactions/splits/mine?state=awaiting_confirmation`)
      .then((r) => r.json()) as { settled_amount: number; share_amount: number }[]
    const aSplit = aOwesB.find((s) => s.share_amount === 40)!
    expect(aSplit).toBeTruthy()
    expect(aSplit.settled_amount).toBeCloseTo(0, 2)

    // Chain still awaiting, C still unconfirmed.
    const chainsAfter = await f.c.page.request
      .get(`${API}/settlement-chains?groupId=${f.groupId}`)
      .then((r) => r.json()) as { id: string; status: string; parties: { userId: string; confirmed: boolean }[] }[]
    const chainRow = chainsAfter.find((c) => c.id === chainId)!
    expect(chainRow.status).toBe('awaiting_confirmation')
    expect(chainRow.parties.find((p) => p.userId === f.c.id)!.confirmed).toBe(false)

    await closeTrio(f)
  })
})
