/**
 * Wallet — Dashboard end-to-end tests.
 *
 * The dashboard is a COMPARISON view: every figure is shown against a baseline
 * built from the preceding months. So the fixture seeds three prior months as
 * well as the current one — without history there is nothing to compare and the
 * comparison panels correctly hide themselves.
 *
 * Every seeded row is dated the 1st. The baseline cuts prior months to the same
 * day of the month as today (comparing 4 days against 31 would be meaningless),
 * so day-01 rows are the only ones guaranteed to count no matter which day the
 * suite happens to run on.
 */

import { test, expect, type Browser, type Page } from '@playwright/test'
import {
  newAppPage,
  accountCardFor,
  fillAccountForm,
  fillTransactionForm,
  businessToday,
  navTo,
  openBlankTransactionForm,
} from './helpers'

test.describe.configure({ mode: 'serial' })

let page: Page

/** 'YYYY-MM' shifted by whole months from the current business month. */
function monthOffset(offset: number): string {
  const today = businessToday()
  const d = new Date(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1 + offset, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/**
 * Inclusive day count between two ISO dates, mirroring insights.ts's
 * `daysBetween` locally rather than importing app code into the e2e process.
 * The app's monthly-average divisor is exact days ÷ 30 (not a whole-month
 * count), so the expected figure below has to be computed from whichever day
 * the suite happens to run on — a hardcoded value would only be right on one
 * day of the month and silently wrong every other day.
 */
function daysBetweenLocal(dateFrom: string, dateTo: string): number {
  const toIndex = (iso: string) =>
    Math.round(
      new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))).getTime() / 86_400_000,
    )
  return toIndex(dateTo) - toIndex(dateFrom) + 1
}

/** Expected "spend-monthly-average" text for a given total and window, loose on whitespace the same way the rest of this file is. */
function monthlyAverageRegex(total: number, dateFrom: string, dateTo: string): RegExp {
  const value = total / (daysBetweenLocal(dateFrom, dateTo) / 30)
  return new RegExp(`RM\\s*${value.toFixed(2)}/mo average`)
}

function addDaysLocal(iso: string, n: number): string {
  const d = new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)) + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  page = await newAppPage(browser, '/wallet/accounts')
  await page.getByRole('button', { name: 'Add Account' }).first().click()
  await fillAccountForm(page, { name: 'Dashboard Bank', type: 'bank' })
  await expect(accountCardFor(page, 'Dashboard Bank')).toBeVisible()

  await navTo(page, 'transactions')
  await expect(page.getByLabel('Add a transaction')).toBeVisible()

  const thisMonth = monthOffset(0)

  // Baseline: the same two categories in each of the three prior months, so
  // Food & Drink averages 30 and Transport averages 300.
  const baseline: [string, string, string, string][] = []
  for (const back of [1, 2, 3]) {
    const m = monthOffset(-back)
    baseline.push([`${m}-01`, '30', 'Kopitiam', 'Food & Drink'])
    baseline.push([`${m}-01`, '300', 'Petronas', 'Transport'])
  }

  // Current month. Against the baseline above this makes Food & Drink and
  // Shopping run OVER and Transport run UNDER, so both directions of the
  // "what changed" chart are exercised. The last row is deliberately left
  // uncategorised — it has to show up as its own row rather than vanishing.
  const current: [string, string, string, string | undefined][] = [
    [`${thisMonth}-01`, '80', 'Grab Food', 'Food & Drink'],
    [`${thisMonth}-01`, '150', 'Petronas', 'Transport'],
    [`${thisMonth}-01`, '60', 'Netflix', 'Entertainment'],
    [`${thisMonth}-01`, '200', 'Giant Mall', 'Shopping'],
    [`${thisMonth}-01`, '40', 'Mystery Shop', undefined],
  ]

  for (const [date, amount, merchant, category] of [...baseline, ...current]) {
    await openBlankTransactionForm(page)
    await fillTransactionForm(page, { type: 'Expense', date, amount, account: 'Dashboard Bank', merchant, category })
  }

  for (const [date, amount, merchant, category] of [
    [`${thisMonth}-01`, '6000', 'Salary Corp', 'Salary'],
    [`${thisMonth}-01`, '500', 'Freelance Client', 'Freelance'],
  ] as const) {
    await openBlankTransactionForm(page)
    await fillTransactionForm(page, { type: 'Income', date, amount, account: 'Dashboard Bank', merchant, category })
  }

  await navTo(page, 'dashboard')
  await expect(page).toHaveURL(/\/wallet\/dashboard$/)
})

test.afterAll(async () => {
  await page.context().close()
})

// ── Shell ───────────────────────────────────────────────────────────────

test('shows "This Month" as the default date range', async () => {
  await expect(page.getByRole('button', { name: 'This Month' })).toBeVisible()
})

test('every date-range preset is offered, and Custom reveals inline pickers', async () => {
  for (const label of ['This month', 'Last month', 'Last 3 months', 'Last 12 months', 'All time', 'Custom…']) {
    await expect(page.getByRole('button', { name: label, exact: true })).toBeVisible()
  }
  await page.getByRole('button', { name: 'Custom…' }).click()
  // Scoped by role, not bare getByLabel: the pace chart's aria-label prose
  // ("...usual total.") contains "to" as a substring and collides otherwise.
  await expect(page.getByRole('textbox', { name: 'From' })).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'To' })).toBeVisible()
  // Custom stays on the dashboard now — Reports is offered separately for the
  // one thing it does that this page doesn't: year-on-year monthly bars.
  await expect(page.getByRole('link', { name: /Year-on-year comparison/i })).toBeVisible()
  // Leave the control the way the rest of the suite expects it.
  await page.getByRole('button', { name: 'This month', exact: true }).click()
})

// ── Hero: spend against its baseline ────────────────────────────────────

test('hero shows the period spend', async () => {
  // 80 + 150 + 60 + 200 + 40 = 530
  await expect(page.getByTestId('spend-hero')).toHaveText(/RM\s*530\.00/)
})

test('hero compares the spend against the usual, not against nothing', async () => {
  // Baseline per month is 30 + 300 = 330. 530 − 330 = 200 over.
  const delta = page.getByTestId('spend-delta')
  await expect(delta).toBeVisible()
  await expect(delta).toContainText(/RM\s*200\.00\s*more than usual/i)
})

test('an in-progress month projects where it lands, once enough of it has passed', async () => {
  // The projection is withheld for the first week: a run-rate off three days
  // describes one purchase, not the month. Which branch shows depends on the
  // day the suite runs, so assert the correct one rather than pinning a date.
  const day = Number(businessToday().slice(8, 10))
  if (day >= 7) {
    await expect(page.getByTestId('pace-projection')).toContainText(/closes at about/i)
    await expect(page.getByTestId('pace-too-early')).toHaveCount(0)
  } else {
    await expect(page.getByTestId('pace-too-early')).toContainText(/too early/i)
    await expect(page.getByTestId('pace-projection')).toHaveCount(0)
  }
})

test('pace chart exposes an accessible summary', async () => {
  await expect(page.getByRole('img', { name: /cumulative spending through/i })).toBeVisible()
})

// ── Stat tiles ──────────────────────────────────────────────────────────

test('stat tiles show income and net', async () => {
  await expect(page.getByTestId('tile-income')).toContainText(/6,500\.00/)
  // Net = 6,500 − 530 = 5,970, with an explicit + so the sign is not colour-only.
  await expect(page.getByTestId('tile-net')).toContainText(/\+\s*RM\s*5,970\.00/)
})

test('committed and discretionary tiles split the spending', async () => {
  // Petronas is the one merchant present in 3+ trailing months, so it is the
  // committed half (150); everything else this month is discretionary (380).
  await expect(page.getByTestId('tile-committed')).toContainText(/RM\s*150\.00/)
  await expect(page.getByTestId('tile-discretionary')).toContainText(/RM\s*380\.00/)
})

// ── What changed ────────────────────────────────────────────────────────

test('what changed ranks categories against their own baseline', async () => {
  const panel = page.getByTestId('what-changed')
  await expect(panel).toBeVisible()
  // Shopping had no baseline at all → +200, the biggest mover, so it sorts first.
  await expect(panel.getByTestId('what-changed-row').first()).toContainText('Shopping')
  await expect(panel.getByTestId('what-changed-row').first()).toContainText(/▲ \+200\.00/)
})

test('what changed reports categories that fell as well as rose', async () => {
  // Transport: 150 against a 300 baseline → 150 under.
  const transport = page.getByTestId('what-changed-row').filter({ hasText: 'Transport' })
  await expect(transport).toContainText(/▼ −150\.00/)
})

test('the movers sum to the headline difference', async () => {
  // +200 Shopping, +60 Entertainment, +50 Food & Drink, +40 Uncategorised,
  // −150 Transport = +200, which is exactly the headline difference. The panel
  // states the total so the arithmetic is checkable against the hero.
  await expect(page.getByText(/The bars add up to \+RM\s*200\.00/)).toBeVisible()
})

// ── Where it goes ───────────────────────────────────────────────────────

test('category donut legend lists every category with its amount and share', async () => {
  const rows = page.getByTestId('category-donut-legend-row')
  await expect(rows.filter({ hasText: 'Shopping' })).toContainText(/RM\s*200\.00/)
  await expect(rows.filter({ hasText: 'Shopping' })).toContainText(/%/)
  await expect(rows.filter({ hasText: 'Transport' })).toContainText(/RM\s*150\.00/)
})

test('uncategorised spending is a visible legend row, not a silent omission', async () => {
  // The old pie dropped these rows, so it never summed to the expense total.
  const uncategorised = page
    .getByTestId('category-donut-legend-row')
    .filter({ hasText: 'Uncategorised' })
  await expect(uncategorised).toContainText(/RM\s*40\.00/)
})

test('the donut states the period total in words, matching the headline', async () => {
  await expect(page.getByTestId('category-donut')).toHaveAccessibleName(/RM\s*530\.00/)
})

test('the breakdown reconciles to the headline figure', async () => {
  await expect(page.getByText(/Totals to\s*RM\s*530\.00/)).toBeVisible()
})

test('a category legend row opens the transactions behind it', async () => {
  await page
    .getByTestId('category-donut-legend-row')
    .filter({ hasText: 'Shopping' })
    .getByRole('link')
    .click()
  await expect(page).toHaveURL(/\/wallet\?.*category=/)
  await expect(page.getByText('Giant Mall')).toBeVisible()
  await page.goBack()
  await expect(page.getByTestId('spend-hero')).toBeVisible()
})

test('the Uncategorised row filters to only unfiled transactions, not everything', async () => {
  await page
    .getByTestId('category-donut-legend-row')
    .filter({ hasText: 'Uncategorised' })
    .getByRole('link')
    .click()
  await expect(page).toHaveURL(/category=__uncategorised__/)
  await expect(page.getByText('Mystery Shop')).toBeVisible()
  // A categorised row from the same period must NOT show up under this filter —
  // this is the bug: the filter used to resolve to "no category filter at all".
  await expect(page.getByText('Giant Mall')).toHaveCount(0)
  await page.goBack()
  await expect(page.getByTestId('spend-hero')).toBeVisible()
})

test('a What-changed row opens a window wide enough to show its baseline, not just the current period', async () => {
  // Transport has one current-month row (Petronas, 150) and three baseline-month
  // rows (Petronas, 300 each) — the delta shown is computed across all four, so
  // the destination must show all four or the number on screen is unverifiable.
  await page.getByTestId('what-changed-row').filter({ hasText: 'Transport' }).click()
  await expect(page).toHaveURL(/\/wallet\?.*category=/)
  await expect(page.getByText('Petronas').first()).toBeVisible()
  await expect(page.getByText('Petronas')).toHaveCount(4)
  await page.goBack()
  await expect(page.getByTestId('spend-hero')).toBeVisible()
})

// ── Pattern panels ──────────────────────────────────────────────────────

test('weekday rhythm renders with an accessible summary', async () => {
  await expect(page.getByTestId('week-rhythm')).toBeVisible()
  await expect(page.getByRole('img', { name: /average spend by weekday/i })).toBeVisible()
})

test('committed vs discretionary split is shown', async () => {
  await expect(page.getByTestId('committed-split')).toBeVisible()
  await expect(page.getByRole('img', { name: /committed .* discretionary/i })).toBeVisible()
})

test('merchant table reports count and average, not just total', async () => {
  const row = page.getByTestId('merchant-table-row').filter({ hasText: 'Giant Mall' })
  await expect(row).toContainText(/RM\s*200\.00/)
  await expect(page.getByTestId('merchant-table')).toContainText('Times')
  await expect(page.getByTestId('merchant-table')).toContainText('Average')
})

test('a merchant seen every month is labelled as such', async () => {
  const petronas = page.getByTestId('merchant-table-row').filter({ hasText: 'Petronas' })
  await expect(petronas).toContainText(/every month/i)
})

// ── Removed panels stay removed ─────────────────────────────────────────

test('the account chart is gone; the category donut is the R7 design', async () => {
  // R7 (2026-09-02): the owner reversed the earlier "bars, not a pie" call —
  // "Where it goes" is a donut again, on purpose. Spending by account is still
  // a bookkeeping fact rather than a behaviour, so that one stays gone.
  await expect(page.getByTestId('category-donut').locator('.recharts-pie')).toHaveCount(1)
  await expect(page.getByText('Spending by Account')).toHaveCount(0)
})

// ── Date range switching ────────────────────────────────────────────────

test('switching to Last Month re-scopes every panel', async () => {
  await page.getByRole('button', { name: 'Last Month' }).click()
  // Last month's seeded spend is 30 + 300 = 330.
  await expect(page.getByTestId('spend-hero')).toHaveText(/RM\s*330\.00/)
  // A finished month has nothing left to project.
  await expect(page.getByTestId('pace-projection')).toHaveCount(0)
})

test('switching back to This Month restores the current figures', async () => {
  await page.getByRole('button', { name: 'This Month' }).click()
  await expect(page.getByTestId('spend-hero')).toHaveText(/RM\s*530\.00/)
})

test('Last 3 months re-scopes the dashboard without a pace notch', async () => {
  await page.getByRole('button', { name: 'Last 3 months', exact: true }).click()
  // Total across the 3 in-window months (this + 2 back) is 530 + 330 + 330 = 1190.
  // The monthly average divides by exact days spanned ÷ 30, not by "3 months",
  // so its expected value depends on which day of the month the suite runs.
  const from = `${monthOffset(-2)}-01`
  const today = businessToday()
  await expect(page.getByTestId('spend-hero')).toHaveText(/RM\s*1,190\.00/)
  await expect(page.getByTestId('spend-monthly-average')).toContainText(monthlyAverageRegex(1190, from, today))
  // A multi-month range has no single "day of the month" to race against —
  // the budget meters drop the pace notch and its wording entirely.
  await expect(page.getByText(/% of the month gone/)).toHaveCount(0)
  await expect(page.getByTestId('category-breakdown')).toBeVisible()
  await expect(page.getByTestId('week-rhythm')).toBeVisible()
})

test('All time shows a monthly average alongside the total, with no baseline claimed', async () => {
  await page.getByRole('button', { name: 'All time', exact: true }).click()
  // There is nothing before "all time" to compare against — no delta chip,
  // no "usual" line, but the total still gets a monthly average of its own.
  await expect(page.getByTestId('what-changed')).toHaveCount(0)
  await expect(page.getByTestId('spend-delta')).toHaveCount(0)
  // Total across all 4 seeded months (this + 3 back): 530 + 330*3 = 1520,
  // spanning at least 90 days (comfortably past the 60-day floor), so the
  // average always renders here regardless of which day the suite runs on.
  const earliest = `${monthOffset(-3)}-01`
  const today = businessToday()
  await expect(page.getByTestId('spend-hero')).toHaveText(/RM\s*1,520\.00/)
  await expect(page.getByTestId('spend-monthly-average')).toContainText(monthlyAverageRegex(1520, earliest, today))
  await page.getByRole('button', { name: 'This month', exact: true }).click()
  await expect(page.getByTestId('spend-hero')).toHaveText(/RM\s*530\.00/)
  // A single-month period has no separate "average" to show; it would only
  // repeat the total already visible above it.
  await expect(page.getByTestId('spend-monthly-average')).toHaveCount(0)
})

test('a short custom range shows no monthly average, even across a month boundary', async () => {
  // Regression test: the average divisor is exact days ÷ 30, not "calendar
  // months touched". A 5-day custom range can touch two different months
  // (e.g. the 30th to the 3rd) while spanning nowhere near the 60-day floor —
  // dividing by "months touched" would have shown one here, off by roughly
  // 6x, for a window far too short for "per month" to mean anything.
  await page.getByRole('button', { name: 'Custom…' }).click()
  const today = businessToday()
  await page.getByRole('textbox', { name: 'From' }).fill(addDaysLocal(today, -4))
  await page.getByRole('textbox', { name: 'To' }).fill(today)
  await expect(page.getByTestId('spend-hero')).toBeVisible()
  await expect(page.getByTestId('spend-monthly-average')).toHaveCount(0)
  await page.getByRole('button', { name: 'This month', exact: true }).click()
})

// ── Goals ──────────────────────────────────────────────────────────────

test('the Goals panel is always visible, even with none set', async () => {
  await expect(page.getByRole('heading', { name: 'Goals', exact: true })).toBeVisible()
  await expect(page.getByText('No goals set yet.')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Manage' }).last()).toBeVisible()
})
