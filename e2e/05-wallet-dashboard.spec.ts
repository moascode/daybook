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
 *
 * R7 (docs/v2) rewrote Overview as a literal mockup port. That removed the
 * Income/Net/Committed/Discretionary stat tiles, "What changed", "Locked in
 * vs. up to you" and Goals entirely, and changed the remaining panels' DOM
 * and test ids (see src/modules/wallet/dashboard/*.tsx). This file was
 * updated to match; tests for removed panels/behaviour were deleted rather
 * than faked, and are called out below where that happened.
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
  // Shopping run OVER and Transport run UNDER. The last row is deliberately
  // left uncategorised — it has to show up as its own row rather than
  // vanishing.
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
//
// The page header no longer uses DateRangeControl at all — that whole
// this-month/last-month/last-3-months/last-12-months/all-time/custom preset
// row and the "Year-on-year comparison" link are gone. Dashboard.tsx now
// renders a plain two-tab "Month" / "Year" segmented control instead (Month
// → the current calendar month, Year → a trailing 12-month window), and this
// happened after the task that produced this test file was scoped, so it's
// called out here rather than silently assumed. There is no more "Last
// month", "Last 3 months", "All time" or "Custom" view reachable from this
// page's UI, so the tests that used to exercise those presets were dropped
// along with the tabs — see the "Date range switching" section below.

test('shows "Month" selected by default', async () => {
  await expect(page.getByRole('tab', { name: 'Month' })).toHaveAttribute('aria-selected', 'true')
})

test('the header offers Month and Year views', async () => {
  await expect(page.getByRole('tab', { name: 'Month' })).toBeVisible()
  await expect(page.getByRole('tab', { name: 'Year' })).toBeVisible()
})

// ── Hero: spend against its baseline ────────────────────────────────────
//
// The old "spend-hero"/"spend-delta" test ids lived on the (now deleted)
// stat-tile row and the Spend pace headline; neither exists any more. The
// period's expense figure is still on screen — as hero-money-out, which is
// the same `summary.expense` value the Spend pace card renders — so these
// tests read it there, and the pace comparison chip is checked directly on
// the Spend pace card.

test('hero shows the period spend (money out)', async () => {
  // 80 + 150 + 60 + 200 + 40 = 530
  await expect(page.getByTestId('hero-money-out')).toHaveText(/RM\s*530\.00/)
})

test('spend pace compares the period spend against the usual, not against nothing', async () => {
  // Baseline per month is 30 + 300 = 330. 530 − 330 = 200 over.
  const spendCard = page.locator('.card').filter({ hasText: 'Spend pace' })
  await expect(spendCard.locator('.chip')).toContainText(/RM\s*200\.00\s*above usual/i)
})

test('the greeting is time-of-day aware and compares NET (income included), not just the expense side', async () => {
  // Deliberately NOT the same figure as the spend-pace chip above — that chip
  // compares EXPENSE only (530 vs a 330 baseline, "200 above usual"). The
  // greeting compares NET, and this fixture's current month has real income
  // the baseline months don't (Salary 6000 + Freelance 500 = 6500, seeded
  // only in the current month): current net = 6500 − 530 = 5970, baseline
  // net = 0 − 330 = −330/month → delta = 5970 − (−330) = 6300 ahead. Both
  // figures are individually correct and honest about what each one is
  // measuring — this test exists to catch the two drifting to disagree about
  // the SAME metric, not to assert they're equal (they aren't measuring the
  // same thing).
  const greeting = page.getByTestId('hero-greeting')
  await expect(greeting).toBeVisible()
  await expect(greeting).toContainText(/Good (morning|afternoon|evening)/)
  await expect(greeting).toContainText('👋')
  await expect(greeting).toContainText(/RM\s*6,300\.00\s*ahead of usual/i)
})

test('an in-progress month projects where it lands, once enough of it has passed', async () => {
  // The projection is withheld for the first week: a run-rate off three days
  // describes one purchase, not the month. Which branch shows depends on the
  // day the suite runs, so assert the correct one rather than pinning a date.
  // Neither branch has a test id of its own any more — the "too early"
  // paragraph (formerly "pace-too-early") was dropped from SpendPace.tsx
  // along with the projection callout's test id, so both sides are asserted
  // by their text instead.
  const day = Number(businessToday().slice(8, 10))
  if (day >= 7) {
    await expect(page.getByText(/tracking to/i)).toBeVisible()
  } else {
    await expect(page.getByText(/tracking to/i)).toHaveCount(0)
  }
})

test('pace chart exposes an accessible summary', async () => {
  await expect(page.getByRole('img', { name: /cumulative spending through/i })).toBeVisible()
})

// NOTE: the old "stat tiles show income and net" and "committed and
// discretionary tiles split the spending" tests were deleted, not rewritten.
// StatTiles.tsx (tile-income/tile-net/tile-committed/tile-discretionary) and
// CommittedSpend.tsx were both removed from the Overview page by the R7
// mockup port — there is no committed/discretionary split shown anywhere on
// this page any more, so there is nothing left to assert.

// NOTE: the old "What changed" section ("what changed ranks categories...",
// "...reports categories that fell as well as rose", "the movers sum to the
// headline difference") was deleted. WhatChanged.tsx no longer exists on the
// Overview page.

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

test('the donut centre displays the period total, matching the headline', async () => {
  // The donut's own <svg role="img"> aria-label only lists per-slice shares
  // (CategoryBreakdown.tsx's `ariaLabel`), not the total — the total is shown
  // as plain visible text in the donut's centre instead, so this checks
  // rendered text rather than the accessible name.
  await expect(page.getByTestId('category-donut')).toContainText(/RM\s*530\.00/)
})

// NOTE: "the breakdown reconciles to the headline figure" (the "Totals to
// RM..." sentence) and the two legend-row click-through tests ("a category
// legend row opens the transactions behind it", "the Uncategorised row
// filters to only unfiled transactions") were deleted. CategoryBreakdown.tsx
// no longer renders that reconciliation sentence, and legend rows are plain
// divs now, not <Link>s — R7 made "Where it goes" a read-only summary, with
// "Full report" (→ /wallet/reports) as the only way off the card.

// ── Pattern panels ──────────────────────────────────────────────────────

test('week rhythm renders with an accessible summary', async () => {
  // Renamed from "Your week" and rebuilt to show the literal last 7 calendar
  // days rather than a 3-month weekday average — its aria-label text changed
  // to match (see WeekRhythm.tsx).
  await expect(page.getByTestId('week-rhythm')).toBeVisible()
  await expect(page.getByRole('img', { name: /daily spend, last 7 days/i })).toBeVisible()
})

// NOTE: "committed vs discretionary split is shown" was deleted —
// CommittedSpend.tsx no longer exists on the Overview page (see above).

test('merchant table reports visit count and average, not just total', async () => {
  // "Top merchants" (was "Who you paid") is a plain .prow list now, not a
  // <table> with Merchant/Total/Times/Average/sparkline columns — each row's
  // subtext carries the count and average inline instead.
  const row = page.getByTestId('merchant-table-row').filter({ hasText: 'Giant Mall' })
  await expect(row).toContainText(/RM\s*200\.00/)
  await expect(row).toContainText(/1 visit/)
  await expect(row).toContainText(/RM\s*200\.00 avg/)
})

// NOTE: "a merchant seen every month is labelled as such" was deleted. The
// new MerchantTable has no per-row "regular merchant" badge — its only
// footer callout is a "most frequent vs. most expensive" sentence, which
// requires a merchant with 2+ visits inside a single period. This fixture's
// current-month rows are all single transactions (merchantSpend scopes counts
// to the CURRENT month only, unlike the old "seen in N trailing months" test,
// so Petronas's baseline-month history no longer makes it "regular" here),
// so there is no equivalent assertion to make without reshaping the shared
// fixture — left as a known gap rather than forced.

// ── Removed panels stay removed ─────────────────────────────────────────

test('the account chart is gone; the category donut is a hand-drawn SVG, not Recharts', async () => {
  // R7 rebuilt "Where it goes" as raw <circle> elements with stroke-dasharray
  // (CategoryBreakdown.tsx), replacing the earlier Recharts PieChart/Cell
  // implementation entirely. Spending by account was already removed and
  // stays removed.
  const donut = page.getByTestId('category-donut')
  await expect(donut.locator('svg circle')).not.toHaveCount(0)
  await expect(donut.locator('.recharts-pie')).toHaveCount(0)
  await expect(page.getByText('Spending by Account')).toHaveCount(0)
})

// ── Date range switching ────────────────────────────────────────────────
//
// With DateRangeControl gone (see the Shell section above), the only other
// view reachable from this page is the "Year" tab — a trailing 12-month
// window. It plays the same role the old "Last 3 months"/"All time" preset
// tests exercised (a multi-month period with no single "day of the month" to
// race against, and — since this fixture's data spans only ~4 months — no
// comparison window before it either), so this section covers both in one
// pass rather than inventing separate multi-month cases the UI has no way to
// reach.

test('the Year tab re-scopes the dashboard to a trailing 12-month window, with no baseline claimed', async () => {
  await page.getByRole('tab', { name: 'Year' }).click()
  await expect(page.getByRole('tab', { name: 'Year' })).toHaveAttribute('aria-selected', 'true')

  // Total across all 4 seeded months (this + 3 back): 530 + 330*3 = 1520.
  await expect(page.getByTestId('hero-money-out')).toHaveText(/RM\s*1,520\.00/)

  // There is nothing before this fixture's data to compare against — no
  // delta chip on the Spend pace card, and the "no earlier period" note
  // shows instead. A multi-month period also has no single "day of the
  // month" to race against, so Budget pace's per-row pace caption (already
  // gone entirely in R7 — see BudgetPace.tsx) stays absent here too.
  const spendCard = page.locator('.card').filter({ hasText: 'Spend pace' })
  await expect(spendCard.locator('.chip')).toHaveCount(0)
  await expect(spendCard.getByText(/no earlier period to compare against/i)).toBeVisible()
  await expect(page.getByText(/% of the month gone/)).toHaveCount(0)
  await expect(page.getByTestId('category-breakdown')).toBeVisible()
  await expect(page.getByTestId('week-rhythm')).toBeVisible()

  await page.getByRole('tab', { name: 'Month' }).click()
  await expect(page.getByTestId('hero-money-out')).toHaveText(/RM\s*530\.00/)
})

// NOTE: "the Goals panel is always visible, even with none set" was deleted.
// The Goals section was removed from the Overview page entirely by R7;
// Goals still exists as its own page (/wallet/goals), which is out of scope
// for this file.

// ── Hero greeting, no history ────────────────────────────────────────────

test('with no baseline history, the greeting shows plainly — no comparison it can\'t back up', async ({ browser }: { browser: Browser }) => {
  const freshPage = await newAppPage(browser, '/wallet/accounts')
  await freshPage.getByRole('button', { name: 'Add Account' }).first().click()
  await fillAccountForm(freshPage, { name: 'Fresh Bank', type: 'bank' })

  await freshPage.goto('/wallet/dashboard')
  const greeting = freshPage.getByTestId('hero-greeting')
  await expect(greeting).toBeVisible()
  await expect(greeting).toContainText(/Good (morning|afternoon|evening)/)
  // No "ahead of"/"behind usual" clause — there's no earlier period to
  // compare against yet, same gate the spend-pace comparison chip uses.
  await expect(greeting).not.toContainText(/usual/i)
  await freshPage.context().close()
})
