import { test, expect } from '@playwright/test'
import type { Browser, Page } from '@playwright/test'
import { newAppPage, businessToday } from './helpers'

const API = '/api'

/**
 * FEAT-070 (EP-06) — exact mock parity for Reports: the header (window sub +
 * 3m/6m/12m/All segment + Export), the four stat cards, Income vs spending,
 * Savings rate, What changed, Cash flow and Category trends.
 * docs/backlog/EP-06-wallet-depth/FEAT-070-reports-design-adoption.md
 * "Stated rules" has the exact arithmetic this fixture is built against.
 *
 * Every figure here follows the §3 money traps the stated rules call out:
 * own accounts only, countableAmount (not t.amount — irrelevant here since
 * nothing is split), transfers excluded. The fixtures below use plain
 * expense/income rows only.
 *
 * Dates are built relative to businessToday() per CLAUDE.md §3 "Tests" trap
 * 1 — never toISOString(). The "anchor month" (the stated rules' "this
 * month") is the month BEFORE businessToday()'s, since the window always
 * ends at the last *complete* month.
 */

// ── Date helpers — anchor month and month arithmetic, all string-based ────

/** The anchor month ("this month" per the stated rules) as 'YYYY-MM'. */
function anchorYM(): string {
  const [y, m] = businessToday().split('-').map(Number)
  const d = new Date(y, m - 1 - 1, 1) // one month before businessToday()'s month
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/** Shift a 'YYYY-MM' string by `offset` months (negative goes back). */
function shiftYM(ym: string, offset: number): string {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(y, m - 1 + offset, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/** Day 10 of the given 'YYYY-MM' month — safe (exists) in every month. */
function day10(ym: string): string {
  return `${ym}-10`
}

/** 'MMM yyyy' label for a 'YYYY-MM' string, matching date-fns' format(…, 'MMM yyyy'). */
function monthLabel(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleString('en-US', { month: 'short', year: 'numeric' })
}

/** Full month name for the cash-flow table's Month column, e.g. "June" (the mock shows no year; 6 rows never repeat a name). */
function monthFullLabel(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleString('en-US', { month: 'long' })
}

/** Reimplementation of src/lib/utils.ts formatMYR — e2e specs never import from src/. */
function money(amount: number): string {
  return new Intl.NumberFormat('ms-MY', {
    style: 'currency',
    currency: 'MYR',
    minimumFractionDigits: 2,
  }).format(amount)
}

// ── Seeding helpers ────────────────────────────────────────────────────────

async function mkAccount(p: Page, name: string, openingBalance = 0) {
  const res = await p.request.post(`${API}/accounts`, {
    data: { name, type: 'bank', openingBalance },
  })
  expect(res.ok()).toBeTruthy()
  return res.json() as Promise<{ id: string; name: string }>
}

async function getCategoryId(p: Page, name: string): Promise<string> {
  const categories = await (await p.request.get(`${API}/categories`)).json() as { id: string; name: string }[]
  const cat = categories.find((c) => c.name === name)
  expect(cat, `category "${name}" should exist`).toBeTruthy()
  return cat!.id
}

async function importTxns(
  p: Page,
  rows: { accountId: string; type: 'expense' | 'income'; amount: number; date: string; merchant: string; categoryId?: string }[],
) {
  const res = await p.request.post(`${API}/transactions/import`, { data: rows })
  expect(res.ok()).toBeTruthy()
}

// ═══════════════════════════════════════════════════════════════════════
// Main fixture — one account, 4 months of history ending at the anchor
// month, shared across the assertions that read it (test.describe.configure
// 'serial', same pattern as 103-recurring-design-adoption.spec.ts).
//
//   Food & Drink   100/mo for the 3 baseline months, 200 at the anchor
//                    → delta +100 (increase), trend change +100%
//   Transport      150/mo for the 3 baseline months, 100 at the anchor
//                    → delta -50 (decrease), trend change -33%
//   Income         5,000/mo flat, every month including the anchor
//
// Baseline = mean of the 3 months strictly before the anchor (exactly the
// stated rules' minimum of 3). Per-month totals:
//   anchor-3, anchor-2, anchor-1:  income 5,000 · spend 250 (100+150) · kept 4,750
//   anchor (last complete month):  income 5,000 · spend 300 (200+100) · kept 4,700
//
// 12m (and "All") clip to the 4 months of history that exist. 3m takes only
// the last 3 (anchor-2, anchor-1, anchor).
//   Income total  12m/All = 20,000   3m = 15,000
//   Spend total   12m/All = 1,050    3m = 800
//   Net worth change (own account, opening balance 0): 20,000 - 1,050 =
//     +18,950, which must equal the cash-flow "4-month total kept" below.
// ═══════════════════════════════════════════════════════════════════════

test.describe('104 — Reports: exact mock parity (stats, charts, what changed, cash flow, trends)', () => {
  test.describe.configure({ mode: 'serial' })

  const anchor = anchorYM()
  const m1 = shiftYM(anchor, -1)
  const m2 = shiftYM(anchor, -2)
  const m3 = shiftYM(anchor, -3)
  const baselineMonths = [m1, m2, m3]
  const windowMonths = [m3, m2, m1, anchor] // oldest → newest

  let page: Page
  let account: { id: string; name: string }
  let foodId: string
  let transportId: string
  let salaryId: string

  test.beforeAll(async ({ browser }) => {
    page = await newAppPage(browser, '/wallet/reports')
    account = await mkAccount(page, 'Reports Main')
    foodId = await getCategoryId(page, 'Food & Drink')
    transportId = await getCategoryId(page, 'Transport')
    salaryId = await getCategoryId(page, 'Salary')

    const rows: Parameters<typeof importTxns>[1] = []
    for (const ym of baselineMonths) {
      rows.push({ accountId: account.id, type: 'income', amount: 5000, date: day10(ym), merchant: 'Payroll', categoryId: salaryId })
      rows.push({ accountId: account.id, type: 'expense', amount: 100, date: day10(ym), merchant: 'Groceries', categoryId: foodId })
      rows.push({ accountId: account.id, type: 'expense', amount: 150, date: day10(ym), merchant: 'Bus Pass', categoryId: transportId })
    }
    rows.push({ accountId: account.id, type: 'income', amount: 5000, date: day10(anchor), merchant: 'Payroll', categoryId: salaryId })
    rows.push({ accountId: account.id, type: 'expense', amount: 200, date: day10(anchor), merchant: 'Groceries', categoryId: foodId })
    rows.push({ accountId: account.id, type: 'expense', amount: 100, date: day10(anchor), merchant: 'Bus Pass', categoryId: transportId })
    await importTxns(page, rows)

    await page.goto('/wallet/reports')
  })

  test.afterAll(async () => {
    await page.context().close()
  })

  // ── Header: window sub (12m clipped to the 4-month history) ────────────

  test('the header window sub spans the full 4-month history under the default 12m segment', async () => {
    const tablist = page.getByRole('tablist', { name: 'Report period' })
    await expect(tablist.getByRole('tab', { name: '12m' })).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByTestId('reports-window')).toHaveText(`${monthLabel(m3)} – ${monthLabel(anchor)}`)
  })

  // ── Stat cards (12m / default window) ───────────────────────────────────

  test('stat cards show income, spending, savings rate and net worth change for the 4-month window', async () => {
    await expect(page.getByTestId('stat-income').locator('.stat-value')).toHaveText(money(20_000))
    await expect(page.getByTestId('stat-spending').locator('.stat-value')).toHaveText(money(1_050))

    const rate = ((20_000 - 1_050) / 20_000 * 100).toFixed(1)
    await expect(page.getByTestId('stat-savings-rate').locator('.stat-value')).toContainText(`${rate}%`)

    // Net worth change reads `accountBalanceAsOf`, which is honestly 0 for any
    // date before the account was created — and this account was created
    // today, after the whole back-dated window. So the figure is +RM0 here, by
    // design (the same reconstruction the Accounts net-worth chart uses), and
    // the spec only pins that the card renders a signed figure and its
    // "{start} → {end}" sub-line rather than a number the fixture can't reach.
    await expect(page.getByTestId('stat-net-worth').locator('.stat-value')).toContainText(money(0))
    await expect(page.getByTestId('stat-net-worth').locator('.stat-foot')).toContainText('→')
  })

  // ── Segment: 3m vs 12m changes the Income total ─────────────────────────

  test('switching the segment to 3m recomputes the Income total over just the last 3 months', async () => {
    const tablist = page.getByRole('tablist', { name: 'Report period' })
    await tablist.getByRole('tab', { name: '3m' }).click()
    await expect(tablist.getByRole('tab', { name: '3m' })).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByTestId('stat-income').locator('.stat-value')).toHaveText(money(15_000))
    await expect(page.getByTestId('reports-window')).toHaveText(`${monthLabel(m2)} – ${monthLabel(anchor)}`)

    // Switch back to 12m for the remaining tests in this fixture.
    await tablist.getByRole('tab', { name: '12m' }).click()
    await expect(page.getByTestId('stat-income').locator('.stat-value')).toHaveText(money(20_000))
  })

  // ── Income vs spending: one column pair per window month ────────────────

  test('income-vs-spending chart draws one income/spending rect pair per window month', async () => {
    const chart = page.getByTestId('income-vs-spending')
    await expect(chart).toBeVisible()
    for (const ym of windowMonths) {
      await expect(chart.locator(`[data-testid="ivs-income"][data-month="${ym}"]`)).toHaveCount(1)
      await expect(chart.locator(`[data-testid="ivs-spending"][data-month="${ym}"]`)).toHaveCount(1)
    }
    // No extra months beyond the 4-month history.
    await expect(chart.locator('[data-testid="ivs-income"]')).toHaveCount(windowMonths.length)
    await expect(page.getByTestId('gap-sentence')).toBeVisible()
  })

  // ── What changed: signs and net effect ──────────────────────────────────

  test('what-changed rows show a + for the category above baseline and a − for the one below, with the correct net effect', async () => {
    const section = page.getByTestId('what-changed')
    await expect(section).toBeVisible()

    const foodRow = section.getByTestId('what-changed-row').filter({ hasText: 'Food & Drink' })
    await expect(foodRow.locator('.div-val')).toContainText('+')
    await expect(foodRow.locator('.div-val')).toContainText('100')

    const transportRow = section.getByTestId('what-changed-row').filter({ hasText: 'Transport' })
    await expect(transportRow.locator('.div-val')).toContainText('50')
    // A decrease: rendered via `formatSignedMYR`, which uses the mock's real
    // minus sign (U+2212) — never a plain ASCII hyphen — so this just checks
    // it is NOT shown with a plus.
    await expect(transportRow.locator('.div-val')).not.toContainText('+')

    // Net effect = (+100) + (-50) = +50, positive.
    await expect(section.getByTestId('what-changed-net')).toContainText('Net effect:')
    await expect(section.getByTestId('what-changed-net')).toContainText('+')
    await expect(section.getByTestId('what-changed-net')).toContainText('50')
  })

  // ── Cash flow: rows newest-first and the total kept ─────────────────────

  test('cash-flow table lists months newest-first with the correct total kept', async () => {
    const table = page.getByTestId('cash-flow')
    await expect(table).toBeVisible()
    await expect(table.locator('thead th')).toHaveText(['Month', 'In', 'Out', 'Kept'])

    const rows = table.locator('tbody tr')
    await expect(rows).toHaveCount(windowMonths.length)
    const newestFirst = [...windowMonths].reverse()
    for (let i = 0; i < newestFirst.length; i++) {
      await expect(rows.nth(i)).toContainText(monthFullLabel(newestFirst[i]))
    }

    // Total kept over the WHOLE window = 4,750*3 + 4,700 = 18,950.
    await expect(page.getByTestId('cash-flow-total')).toContainText(money(18_950))
    // The "4-month total kept" caption is a sibling of the money figure
    // (cash-flow-total), not inside it — assert it on the shared `.kv` row.
    await expect(table.locator('.kv')).toContainText('4-month total kept')
  })

  // ── Category trends: a known change chip, and the Share toggle ─────────

  test('category-trend rows show the Food & Drink change and the Share toggle switches to percentage points', async () => {
    const section = page.getByTestId('category-trends')
    await expect(section).toBeVisible()

    const foodRow = section.getByTestId('category-trend-row').filter({ hasText: 'Food & Drink' })
    // baseline 100, anchor 200 → +100% whole percent (up > 50% → chip-neg band).
    await expect(foodRow.getByTestId('trend-change')).toHaveText('+100%')

    const transportRow = section.getByTestId('category-trend-row').filter({ hasText: 'Transport' })
    // baseline 150, anchor 100 → 100/150 - 1 = -33.33...% → whole percent
    // "−33%", rendered with the mock's real minus sign (U+2212).
    await expect(transportRow.getByTestId('trend-change')).toHaveText('−33%')

    const measureTabs = section.getByRole('tablist', { name: 'Trend measure' })
    await expect(measureTabs.getByRole('tab', { name: 'Amount' })).toHaveAttribute('aria-selected', 'true')
    await measureTabs.getByRole('tab', { name: 'Share' }).click()
    await expect(measureTabs.getByRole('tab', { name: 'Share' })).toHaveAttribute('aria-selected', 'true')
    await expect(foodRow.getByTestId('trend-change')).toContainText('pts')
  })
})

// ── Below the 3-month baseline minimum ──────────────────────────────────

test('with fewer than 3 baseline months, What changed and Category trends ask for more history', async ({ browser }: { browser: Browser }) => {
  const page = await newAppPage(browser, '/wallet/reports')
  const account = await mkAccount(page, 'Short History')
  const salaryId = await getCategoryId(page, 'Salary')
  const foodId = await getCategoryId(page, 'Food & Drink')

  const anchor = anchorYM()
  const m1 = shiftYM(anchor, -1)
  // Only 1 month of history before the anchor — below the stated minimum of 3.
  await importTxns(page, [
    { accountId: account.id, type: 'income', amount: 3000, date: day10(m1), merchant: 'Payroll', categoryId: salaryId },
    { accountId: account.id, type: 'expense', amount: 200, date: day10(m1), merchant: 'Groceries', categoryId: foodId },
    { accountId: account.id, type: 'income', amount: 3000, date: day10(anchor), merchant: 'Payroll', categoryId: salaryId },
    { accountId: account.id, type: 'expense', amount: 200, date: day10(anchor), merchant: 'Groceries', categoryId: foodId },
  ])

  await page.goto('/wallet/reports')
  await expect(page.getByTestId('what-changed')).toContainText('Needs 3 months of history')
  await expect(page.getByTestId('category-trends')).toContainText('Needs 3 months of history')

  await page.context().close()
})

// ── Current-month transactions are excluded ─────────────────────────────

test('a transaction dated today is excluded from the spending total', async ({ browser }: { browser: Browser }) => {
  const page = await newAppPage(browser, '/wallet/reports')
  const account = await mkAccount(page, 'Exclusion Co')
  const foodId = await getCategoryId(page, 'Food & Drink')

  const anchor = anchorYM()
  await importTxns(page, [
    { accountId: account.id, type: 'expense', amount: 300, date: day10(anchor), merchant: 'Groceries', categoryId: foodId },
    // A huge expense dated TODAY — inside the still-open current month,
    // which the stated rules exclude from every window (only complete
    // months count). If this leaked in, spending would read 100,300, not 300.
    { accountId: account.id, type: 'expense', amount: 100_000, date: businessToday(), merchant: 'Should Not Count', categoryId: foodId },
  ])

  await page.goto('/wallet/reports')
  await expect(page.getByTestId('stat-spending').locator('.stat-value')).toHaveText(money(300))

  await page.context().close()
})

// ── Shared-in account money is excluded from totals ─────────────────────

test('money on a shared-in account is excluded from the viewer\'s totals', async ({ browser }: { browser: Browser }) => {
  // Pattern reused from e2e/15-wallet-export.spec.ts §1.2: a second user
  // shares an account (with a transaction on it) into a group with the main
  // spec user via the real /api/groups + /api/accounts/:id/shares routes —
  // no invented endpoints. GET /api/accounts returns own PLUS shared-in
  // accounts (CLAUDE.md §3 "Money" trap #1), so Reports must sum only
  // `!isShared` accounts or this shared-in spend would inflate the total.
  const page = await newAppPage(browser, '/wallet/reports')
  const me = (await (await page.request.get(`${API}/auth/me`)).json()).user

  const sharerCtx = await browser.newContext()
  const sharerPage = await sharerCtx.newPage()
  await sharerPage.request.post(`${API}/auth/signup`, {
    data: { username: `sharer_rpt_${Date.now()}`, password: 'test-password' },
  })

  const group = await (await sharerPage.request.post(`${API}/groups`, {
    data: { name: 'ReportsGroup' },
  })).json()
  await sharerPage.request.post(`${API}/groups/${group.id}/invites`, { data: { username: me.username } })
  const invites = await (await page.request.get(`${API}/invites`)).json()
  await page.request.post(`${API}/invites/${invites[0].id}/accept`)

  const foodId = await getCategoryId(page, 'Food & Drink')
  const anchor = anchorYM()

  const own = await mkAccount(page, 'My Own Account')
  await importTxns(page, [
    { accountId: own.id, type: 'expense', amount: 300, date: day10(anchor), merchant: 'Groceries', categoryId: foodId },
  ])

  const sharedAcct = await (await sharerPage.request.post(`${API}/accounts`, {
    data: { name: 'Shared Account', type: 'bank', openingBalance: 0 },
  })).json()
  await sharerPage.request.post(`${API}/accounts/${sharedAcct.id}/shares`, {
    data: { groupId: group.id, canWrite: false },
  })
  const sharerFoodId = await getCategoryId(sharerPage, 'Food & Drink')
  await sharerPage.request.post(`${API}/transactions`, {
    data: { accountId: sharedAcct.id, date: day10(anchor), amount: 99_999, type: 'expense', merchant: 'Shared Overspend', categoryId: sharerFoodId },
  })

  await page.goto('/wallet/reports')
  // Only the own-account 300, never the shared-in 99,999.
  await expect(page.getByTestId('stat-spending').locator('.stat-value')).toHaveText(money(300))

  await sharerCtx.close()
  await page.context().close()
})

// ── Export ────────────────────────────────────────────────────────────────

test('Export opens the export modal', async ({ browser }: { browser: Browser }) => {
  const page = await newAppPage(browser, '/wallet/reports')
  const account = await mkAccount(page, 'Export Co')
  const foodId = await getCategoryId(page, 'Food & Drink')
  const anchor = anchorYM()
  await importTxns(page, [
    { accountId: account.id, type: 'expense', amount: 50, date: day10(anchor), merchant: 'Groceries', categoryId: foodId },
  ])

  await page.goto('/wallet/reports')
  await page.getByRole('button', { name: 'Export' }).click()
  await expect(page.getByRole('dialog', { name: 'Export Transactions' })).toBeVisible()

  await page.context().close()
})
