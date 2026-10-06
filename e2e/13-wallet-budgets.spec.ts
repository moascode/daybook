/**
 * Wallet: budget tracking — Tier 2 feature.
 * Set monthly spend limits per category; view progress bars; get over-budget
 * alerts; a day-of-month pace notch (FEAT-017, EP-06) on each row and a
 * summary-band pace instruction.
 *
 * FEAT-066 (EP-06) rebuilt the page to mock parity: a `.dash` grid, a richer
 * month band (Left to spend / Projected finish / On track N of M), a
 * per-category TABLE with a Status chip in place of the old card list's
 * "Over budget" badge, and a restyled Suggestions card with a 4th
 * (roll-forward) suggestion type. The tests below were updated in step —
 * `budget-pace-instruction` and `over-budget-alert` no longer exist (the
 * band/row concepts they tested were superseded, not just restyled; see
 * FEAT-066's revision note) — and a new describe block covers what's new.
 */

import { test, expect } from '@playwright/test'
import type { Browser, Page } from '@playwright/test'
import { newAppPage, fillAccountForm, fillTransactionForm, navItem, openBlankTransactionForm, businessToday, businessDatePlus } from './helpers'

test.describe.configure({ mode: 'serial' })

let page: Page

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  page = await newAppPage(browser, '/wallet/accounts')
  await page.getByRole('button', { name: 'Add Account' }).first().click()
  await fillAccountForm(page, { name: 'Budget Bank', type: 'bank' })
})

test.afterAll(async () => {
  await page.context().close()
})

// ── Navigation ─────────────────────────────────────────────────────────

test('wallet navigation contains a "Budgets" link', async () => {
  await expect(navItem(page, 'budgets')).toBeVisible()
})

test('navigating to /wallet/budgets shows the Budgets page', async () => {
  await page.goto('/wallet/budgets')
  await expect(page).toHaveURL(/\/wallet\/budgets$/)
  await expect(page.locator('main').getByRole('heading', { name: 'Budgets', exact: true })).toBeVisible()
})

// ── Empty state ────────────────────────────────────────────────────────

test('shows empty state when no budgets have been set', async () => {
  await expect(page.getByText(/No budgets|Set your first budget/i)).toBeVisible()
})

// ── Create budget ──────────────────────────────────────────────────────

test('"Add Budget" button opens the budget form dialog', async () => {
  await page.getByRole('button', { name: /Add Budget|New Budget/i }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
})

test('budget form has Category and Amount/Limit fields and notes the monthly period', async () => {
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByLabel(/Category/i)).toBeVisible()
  await expect(dialog.getByLabel(/Amount|Limit/i)).toBeVisible()
  // Budgets are monthly-only; the form states this rather than offering a
  // fake period selector with a single option.
  await expect(dialog.getByText(/reset.*monthly/i)).toBeVisible()
})

test('save a budget: Food & Drink at MYR 500/month', async () => {
  const dialog = page.getByRole('dialog')
  await dialog.locator('#budget-category, [name="category"]').selectOption('Food & Drink')
  await dialog.getByLabel(/Amount|Limit/i).fill('500')
  await dialog.getByRole('button', { name: /Save|Create/i }).click()
  await expect(page.getByTestId('budget-row').filter({ hasText: 'Food & Drink' })).toBeVisible()
})

// ── Budget row display ─────────────────────────────────────────────────

test('budget row shows category name and monthly limit amount', async () => {
  const row = page.getByTestId('budget-row').filter({ hasText: 'Food & Drink' })
  // FEAT-066's table row has a "Left" column (limit minus spent) alongside the
  // category's own "$X limit" subtext — with nothing spent yet, both read
  // "RM 500.00", so a plain `row.getByText(/500/)` is ambiguous (strict-mode
  // violation: two matches). The `.tsub` subtext is specifically the limit,
  // so assert against it directly rather than loosening the regex.
  await expect(row.locator('.tsub')).toHaveText(/500|MYR 500/)
})

test('budget row contains a progress bar element', async () => {
  const row = page.getByTestId('budget-row').filter({ hasText: 'Food & Drink' })
  await expect(row.locator('[data-testid="budget-progress"]')).toBeVisible()
})

// ── Progress reflects actual spending ─────────────────────────────────

test('budget progress updates after adding a Food & Drink expense', async () => {
  // Add a transaction in the current month
  await page.goto('/wallet')
  await openBlankTransactionForm(page)
  await fillTransactionForm(page, {
    type: 'Expense',
    amount: '120',
    account: 'Budget Bank',
    merchant: 'Mamak',
    category: 'Food & Drink',
  })
  await page.goto('/wallet/budgets')
  const row = page.getByTestId('budget-row').filter({ hasText: 'Food & Drink' })
  // Spent amount should appear (120 out of 500)
  await expect(row.getByText(/120|RM 120/)).toBeVisible()
})

// ── Pace marker (FEAT-017) ──────────────────────────────────────────────

test('budget row shows a pace notch reflecting day-of-month elapsed', async () => {
  const row = page.getByTestId('budget-row').filter({ hasText: 'Food & Drink' })
  await expect(row.getByTestId('budget-pace-notch')).toBeVisible()
  await expect(row.getByTestId('budget-progress')).toHaveAttribute('aria-label', /of the month elapsed/)
})

test('month summary band\'s "Left to spend" reflects budgeted minus spent', async () => {
  // Flat subtraction (RM500 limit − RM120 spent so far), unlike the old
  // pace-instruction text this replaces — no day-of-month dependency (the
  // "one clock" trap, CLAUDE.md §3), so this isn't sensitive to which day
  // the suite happens to run on.
  await page.goto('/wallet/budgets')
  const stat = page.locator('.band-stat').filter({ hasText: 'Left to spend' })
  await expect(stat).toContainText('RM 380.00')
})

// ── Status chip (FEAT-066) ──────────────────────────────────────────────

test('status chip reads "Over pace" once spending exceeds the limit', async () => {
  // Spend an additional 450 to exceed the 500 limit (570 total). Spending
  // past the limit outright is the `spent > effectiveLimit` branch of
  // budgetStatus() (insights.ts) — true regardless of today's day-of-month,
  // unlike the aheadPts-percentage branches.
  await page.goto('/wallet')
  await openBlankTransactionForm(page)
  await fillTransactionForm(page, {
    type: 'Expense',
    amount: '450',
    account: 'Budget Bank',
    merchant: 'Supermarket',
    category: 'Food & Drink',
  })
  await page.goto('/wallet/budgets')
  const row = page.getByTestId('budget-row').filter({ hasText: 'Food & Drink' })
  await expect(row.getByTestId('budget-status-chip')).toHaveText('Over pace')
})

// ── Edit budget ────────────────────────────────────────────────────────

test('edit button opens the budget form pre-filled', async () => {
  const row = page.getByTestId('budget-row').filter({ hasText: 'Food & Drink' })
  await row.getByRole('button', { name: /Edit/i }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByLabel(/Amount|Limit/i)).toHaveValue('500')
})

test('updating the limit saves the new value', async () => {
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel(/Amount|Limit/i).fill('800')
  await dialog.getByRole('button', { name: /Save|Update/i }).click()
  const row = page.getByTestId('budget-row').filter({ hasText: 'Food & Drink' })
  await expect(row.getByText(/800|MYR 800/)).toBeVisible()
})

// ── Delete budget ──────────────────────────────────────────────────────

test('delete button with confirmation removes the budget row', async () => {
  const row = page.getByTestId('budget-row').filter({ hasText: 'Food & Drink' })
  await row.getByRole('button', { name: /Delete|Remove/i }).click()
  await page.getByRole('button', { name: /Confirm|Yes/i }).click()
  await expect(page.getByTestId('budget-row').filter({ hasText: 'Food & Drink' })).not.toBeVisible()
})

// ═══════════════════════════════════════════════════════════════════════
// FEAT-066 — design adoption: .dash grid, status chips, roll-forward,
// restyled Suggestions. Its own fixture (fresh account + categories via the
// API, like e2e/89), independent of the serial flow above.
// ═══════════════════════════════════════════════════════════════════════

test.describe('13b — Budgets design adoption (FEAT-066)', () => {
  const API = '/api'

  /** This-month-relative 'YYYY-MM' key, `offset` months away. Business timezone (CLAUDE.md §3's "one clock" trap), not the runner's local clock. */
  function monthKeyOffset(offset: number): string {
    const [y, m] = businessToday().split('-').map(Number)
    const d = new Date(y, m - 1 + offset, 1)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  }

  async function mkCategory(p: Page, name: string) {
    return (await p.request.post(`${API}/categories`, {
      data: { name, type: 'expense', icon: 'tag', color: '#378ADD' },
    })).json()
  }

  async function spend(p: Page, accountId: string, categoryId: string, date: string, amount: number) {
    await p.request.post(`${API}/transactions`, {
      data: { accountId, categoryId, date, merchant: 'Store', amount, type: 'expense', tag: '[]' },
    })
  }

  let fp: Page
  let accountId: string

  test.beforeAll(async ({ browser }) => {
    fp = await newAppPage(browser, '/wallet/budgets')
    const account = await (await fp.request.post(`${API}/accounts`, {
      data: { name: 'FEAT066 Cash', type: 'cash', currency: 'MYR', color: '#1D9E75', icon: 'wallet', openingBalance: 0 },
    })).json()
    accountId = account.id
  })

  test.afterAll(async () => {
    await fp.context().close()
  })

  test('the Budgets page renders the .dash 12-column grid', async () => {
    const cat = await mkCategory(fp, 'Dash Layout Cat')
    await fp.request.post(`${API}/budgets`, { data: { categoryId: cat.id, limitAmount: 100 } })
    await fp.goto('/wallet/budgets')
    await expect(fp.locator('.dash')).toBeVisible()
  })

  test('a budget spent well past its limit shows the "Over pace" status chip', async () => {
    const cat = await mkCategory(fp, 'Clearly Over')
    await fp.request.post(`${API}/budgets`, { data: { categoryId: cat.id, limitAmount: 500 } })
    // RM600 of a RM500 limit — the `spent > effectiveLimit` branch of
    // budgetStatus() fires regardless of elapsedFraction, so this isn't
    // sensitive to which day of the month the suite runs on.
    await spend(fp, accountId, cat.id, `${monthKeyOffset(0)}-05`, 600)
    await fp.goto('/wallet/budgets')
    const row = fp.getByTestId('budget-row').filter({ hasText: 'Clearly Over' })
    await expect(row.getByTestId('budget-status-chip')).toHaveText('Over pace')
  })

  test('a budget barely touched shows the "On track" status chip', async () => {
    const cat = await mkCategory(fp, 'Clearly OnTrack')
    await fp.request.post(`${API}/budgets`, { data: { categoryId: cat.id, limitAmount: 1000 } })
    // RM50 of a RM1000 limit (5% used) stays "on track" at every possible
    // elapsedFraction (1/31 .. 31/31) — picked well clear of the 8/20-point
    // and 70%-ratio thresholds (insights.ts budgetStatus()), not at an edge.
    await spend(fp, accountId, cat.id, `${monthKeyOffset(0)}-05`, 50)
    await fp.goto('/wallet/budgets')
    const row = fp.getByTestId('budget-row').filter({ hasText: 'Clearly OnTrack' })
    await expect(row.getByTestId('budget-status-chip')).toHaveText('On track')
  })

  test('Suggestions card renders restyled rows with .sug/.tavatar/.sug-title', async () => {
    // Real spend with no budget at all is the cheapest reliable way to get a
    // suggestion row without depending on the reallocate/right-size engine's
    // percentage thresholds against whatever other budgets this fixture has
    // already seeded above.
    const cat = await mkCategory(fp, 'Unbudgeted Spend')
    await spend(fp, accountId, cat.id, `${monthKeyOffset(0)}-05`, 40)
    await fp.goto('/wallet/budgets')
    await expect(fp.getByTestId('budget-suggestions')).toBeVisible()
    const row = fp.getByTestId('suggestion-row').filter({ hasText: 'Unbudgeted Spend' })
    await expect(row.locator('.tavatar')).toBeVisible()
    await expect(row.locator('.sug-title')).toContainText('Unbudgeted Spend')
  })

  test('enabling rollover from a suggestion raises the effective limit', async () => {
    const cat = await mkCategory(fp, 'RolloverCat')
    await fp.request.post(`${API}/budgets`, { data: { categoryId: cat.id, limitAmount: 100 } })
    // RM20 of a RM100 limit in each of the engine's 3-month window (this
    // month included) — RM80 positive leftover every month, so the
    // roll-forward rule (insights.ts rollForwardSuggestions) fires.
    for (const offset of [-2, -1, 0]) {
      await spend(fp, accountId, cat.id, `${monthKeyOffset(offset)}-05`, 20)
    }
    await fp.goto('/wallet/budgets')
    const suggestion = fp.getByTestId('suggestion-row').filter({ hasText: 'RolloverCat' })
    await expect(suggestion).toBeVisible()
    await suggestion.getByRole('button', { name: 'Enable' }).click()
    await expect(fp.getByTestId('suggestion-row').filter({ hasText: 'RolloverCat' })).toHaveCount(0)

    // effectiveLimit() now folds in LAST month's RM80 leftover: RM180 total
    // this month, RM20 spent → RM160 left — not the raw RM100 limit's RM80.
    await fp.goto('/wallet/budgets')
    const row = fp.getByTestId('budget-row').filter({ hasText: 'RolloverCat' })
    await expect(row).toContainText('RM 160.00')
  })
})

// ═══════════════════════════════════════════════════════════════════════
// FEAT-066 fix pass (Gate 2 review) — F2/F5: the Rolling 30d toggle had no
// coverage at all, and the new `from`/`to` route branch on GET
// /budgets/spending (including its validation) was untested. Reuses 13b's
// fixture page/account.
// ═══════════════════════════════════════════════════════════════════════

test.describe('13c — Rolling 30d toggle and the spending range route (fix pass)', () => {
  const API = '/api'

  async function mkCategory(p: Page, name: string) {
    return (await p.request.post(`${API}/categories`, {
      data: { name, type: 'expense', icon: 'tag', color: '#378ADD' },
    })).json()
  }

  async function spend(p: Page, accountId: string, categoryId: string, date: string, amount: number) {
    await p.request.post(`${API}/transactions`, {
      data: { accountId, categoryId, date, merchant: 'Store', amount, type: 'expense', tag: '[]' },
    })
  }

  let fp: Page
  let accountId: string

  test.beforeAll(async ({ browser }) => {
    fp = await newAppPage(browser, '/wallet/budgets')
    const account = await (await fp.request.post(`${API}/accounts`, {
      data: { name: 'FEAT066 Fix Cash', type: 'cash', currency: 'MYR', color: '#1D9E75', icon: 'wallet', openingBalance: 0 },
    })).json()
    accountId = account.id
  })

  test.afterAll(async () => {
    await fp.context().close()
  })

  test('Rolling 30d toggle hides the month-pace UI and the window follows the toggle', async () => {
    const cat = await mkCategory(fp, 'Rolling30 Only')
    await fp.request.post(`${API}/budgets`, { data: { categoryId: cat.id, limitAmount: 1000 } })
    // Inside the trailing 30-day window — counted by Rolling 30d.
    await spend(fp, accountId, cat.id, businessDatePlus(-5), 50)
    // Well outside it (window is [-29, 0]) — must NOT be counted in Rolling
    // 30d, even though it may still land within this calendar month.
    await spend(fp, accountId, cat.id, businessDatePlus(-40), 900)
    await fp.goto('/wallet/budgets')

    await fp.getByRole('tab', { name: 'Rolling 30d' }).click()

    // The band's pace-only stats (Left to spend / Projected finish / On
    // track) and the "N points ahead of pace" chip only exist in month mode.
    await expect(fp.locator('.band-stat')).toHaveCount(0)
    await expect(fp.getByTestId('budget-pace-caption')).toHaveCount(0)

    const row = fp.getByTestId('budget-row').filter({ hasText: 'Rolling30 Only' })
    // The per-row pace notch is month-only too...
    await expect(row.getByTestId('budget-pace-notch')).toHaveCount(0)
    // ...but the status chip is still shown, now computed via statusElapsed
    // (pinned to 1 in Rolling mode) rather than disappearing with the notch.
    await expect(row.getByTestId('budget-status-chip')).toBeVisible()

    // Spent/Left reflect only the in-window RM50, not the RM900 from 40 days
    // ago — proof the row is reading `rollingSpending`, not the calendar
    // month's `spending`.
    await expect(row.locator('.num.money').first()).toHaveText(/50\.00/)
    await expect(row.locator('.num.money').nth(1)).toHaveText(/950\.00/)
  })

  test('GET /budgets/spending?from&to returns per-category spend for a valid range', async () => {
    const cat = await mkCategory(fp, 'Range Route Cat')
    await spend(fp, accountId, cat.id, businessDatePlus(-3), 75)
    // A transaction outside the requested range must not be summed in.
    await spend(fp, accountId, cat.id, businessDatePlus(-20), 999)

    const res = await fp.request.get(
      `${API}/budgets/spending?from=${businessDatePlus(-10)}&to=${businessToday()}`,
    )
    expect(res.status()).toBe(200)
    const rows: { categoryId: string; spent: number }[] = await res.json()
    const row = rows.find((r) => r.categoryId === cat.id)
    expect(row?.spent).toBe(75)
  })

  test('GET /budgets/spending?from&to rejects a missing, malformed, or reversed range with 400', async () => {
    const missingTo = await fp.request.get(`${API}/budgets/spending?from=${businessToday()}`)
    expect(missingTo.status()).toBe(400)

    const badFormat = await fp.request.get(`${API}/budgets/spending?from=not-a-date&to=${businessToday()}`)
    expect(badFormat.status()).toBe(400)

    // from after to — the N8 fix.
    const reversed = await fp.request.get(
      `${API}/budgets/spending?from=${businessToday()}&to=${businessDatePlus(-10)}`,
    )
    expect(reversed.status()).toBe(400)
  })
})
