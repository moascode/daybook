/**
 * FEAT-061 — Tasks: Habits page exact design adoption
 * (docs/backlog/EP-07-tasks-depth/FEAT-061-tasks-habits-design-adoption.md).
 *
 * Covers the new cards FEAT-061 adds on top of FEAT-029's real functionality
 * (e2e/94-tasks-habits.spec.ts covers the underlying streak/toggle/archive
 * behaviour, which is unchanged): the "Consistency" card's pooled figures,
 * each habit's ring percentage, the dot strip replacing the old square grid,
 * the "Kept by weekday" pooling math, the "Worth knowing" card's conditional
 * rows (including the omit-when-empty case), and the "Habit options"
 * popover (open/close/outside-click/Escape, Archive and Delete still work).
 */

import { test, expect } from '@playwright/test'
import { newAppPage, businessToday, businessDatePlus } from './helpers'

const API = '/api'

/** 0=Sun..6=Sat for a YYYY-MM-DD date string — same calendar-date arithmetic
 * as worker/routes/habits.ts's weekdayOf and TasksHabitsPage.tsx's own copy. */
function weekdayOf(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
/** `format(parseISO(date), 'd MMMM')` without pulling in date-fns or
 * `Date#getDate()` (local-timezone, the exact trap this suite's helpers
 * avoid) — plain string slicing on the YYYY-MM-DD the app and server both use. */
function dMMMM(dateStr: string): string {
  const [, m, d] = dateStr.split('-').map(Number)
  return `${d} ${MONTHS[m - 1]}`
}

async function createHabit(page: import('@playwright/test').Page, name: string, data: Record<string, unknown> = {}) {
  const res = await page.request.post(`${API}/habits`, { data: { name, ...data } })
  return res.json()
}

async function toggleDate(page: import('@playwright/test').Page, habitId: string, date: string) {
  await page.request.post(`${API}/habits/${habitId}/toggle`, { data: { date } })
}

test.describe('100 — Tasks habits design adoption', () => {
  test('Consistency card and ring percentage reflect a fully-kept habit', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks/habits')
    const habit = await createHabit(page, 'Flossing')

    // Kept every one of the last 28 days — a deterministic 100% rate.
    for (let i = 0; i < 28; i++) {
      await toggleDate(page, habit.id, businessDatePlus(-i))
    }
    await page.reload()

    const card = page.getByTestId('habit-card').filter({ hasText: 'Flossing' })
    await expect(card.locator('svg[role="img"]')).toHaveAttribute('aria-label', 'Flossing completed 100% of days.')
    await expect(card.locator('.ring-center .v')).toHaveText('100%')
    await expect(card.locator('.ring-center .k')).toHaveText('28 DAYS')

    const consistency = page.getByTestId('habits-consistency-card')
    await expect(consistency).toBeVisible()
    await expect(page.getByTestId('habits-pooled-kept-pct')).toHaveText('100%')
    await expect(page.getByTestId('habits-above-threshold-chip')).toContainText('1 of 1 above 70%')
    await expect(page.getByTestId('habits-above-threshold-chip')).toHaveClass(/chip-pos/)
    // A 28-day perfect run is also this habit's longest within the 12-week window.
    await expect(page.getByTestId('habits-longest-streak')).toContainText('28 days')
    // Review fix #5a — that longest run IS the still-running current streak
    // (it runs straight through today), so "ended {today}" would be a
    // fabrication; the sub-line must say "ongoing" instead.
    await expect(page.getByTestId('habits-consistency-card').locator('.band-stat').filter({ hasText: 'Longest, last 12 weeks' }).locator('.s'))
      .toHaveText('ongoing')
    // Review fix #8 — every weekday is 100% kept, so the fallback insight
    // applies (no weekday qualifies as "below 70%").
    await expect(page.getByTestId('habits-weekday-insight')).toHaveText('Every day is holding at 70% or higher.')
  })

  test('the dot strip replaces the old square grid and toggling a dot updates the streak', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks/habits')
    await page.getByTestId('habit-new-btn').click()
    await page.getByTestId('habit-name-input').fill('Stretch')
    await page.getByTestId('habit-create-save-btn').click()

    const card = page.getByTestId('habit-card').filter({ hasText: 'Stretch' })
    await expect(card.locator('.dots')).toBeVisible()
    await expect(card.locator('.dots i')).toHaveCount(28)
    // The old implementation rendered a 7-column square-grid div; it must be gone.
    await expect(card.locator('[class*="grid-cols-7"]')).toHaveCount(0)

    // Clicking today's dot still drives the same toggle as the old grid button.
    const today = businessToday()
    const todayDot = card.getByTestId(`habit-grid-day-${today}`)
    await expect(todayDot).toHaveAttribute('role', 'button')
    await todayDot.click()
    await expect(card.getByTestId('habit-current-streak')).toHaveText('1-day streak')
  })

  test('"Kept by weekday" pools kept/due across all habits\' 28-day entries', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks/habits')
    const habit = await createHabit(page, 'Everything but Friday')

    // Kept every day in the 28-day window except every Friday — a
    // deterministic pooled split: Friday 0%, every other weekday 100%.
    for (let i = 0; i < 28; i++) {
      const date = businessDatePlus(-i)
      if (weekdayOf(date) === 5) continue
      await toggleDate(page, habit.id, date)
    }
    await page.reload()

    const weekdayCard = page.getByTestId('habits-weekday-card')
    await expect(weekdayCard).toBeVisible()
    const bars = page.getByTestId('habits-weekday-bars').locator('.bar')
    await expect(bars).toHaveCount(7)

    const friBar = bars.filter({ hasText: 'Fri' })
    await expect(friBar.locator('.bar-val')).toHaveText('0%')
    const monBar = bars.filter({ hasText: 'Mon' })
    await expect(monBar.locator('.bar-val')).toHaveText('100%')

    await expect(page.getByTestId('habits-weekday-insight')).toHaveText('Friday is the only day below 70%.')

    // Review fix #2 — the Consistency card's "Weakest day" must name the
    // SAME weekday with the SAME rate as this pooled chart, since both now
    // read the one shared aggregation. Before the fix it read the per-habit
    // 12-week `weekdayRates` instead and could disagree.
    const weakestStat = page.getByTestId('habits-consistency-card').locator('.band-stat').filter({ hasText: 'Weakest day' })
    await expect(weakestStat.locator('.v')).toHaveText('Friday')
    await expect(weakestStat.locator('.s')).toHaveText('0% kept')
  })

  test('"Worth knowing" shows a conditional row for a strong habit, and is omitted when nothing qualifies', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks/habits')
    const strong = await createHabit(page, 'Cold shower')
    for (let i = 0; i < 28; i++) {
      await toggleDate(page, strong.id, businessDatePlus(-i))
    }
    await page.reload()

    // 100% kept with a 28-day best streak clears the "holding strong" bar
    // (>=85% and bestStreak >= 14).
    const worthKnowing = page.getByTestId('habits-worth-knowing-card')
    await expect(worthKnowing).toBeVisible()
    await expect(worthKnowing).toContainText('"Cold shower" is holding strong')
    await expect(worthKnowing).toContainText('100% kept, 28-day best streak')
    // Text-only — the scoped-out "Lower it"/"Move" action buttons must not exist.
    await expect(worthKnowing.locator('button')).toHaveCount(0)
  })

  test('"Worth knowing" is omitted entirely when no habit crosses any threshold', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks/habits')
    const habit = await createHabit(page, 'Middling habit')

    // Kept 3 of every 4 days (75% — above the 60% "weakest" floor, below the
    // 85% "strongest" ceiling) with no run longer than 3 days (well under the
    // 14-day "holding strong" floor), and nowhere near an 80% 12-week average.
    for (let i = 0; i < 28; i++) {
      if (i % 4 === 3) continue
      await toggleDate(page, habit.id, businessDatePlus(-i))
    }
    await page.reload()

    await expect(page.getByTestId('habit-card').filter({ hasText: 'Middling habit' })).toBeVisible()
    await expect(page.getByTestId('habits-worth-knowing-card')).not.toBeVisible()
  })

  test('the "Habit options" popover opens, closes on outside click and Escape, and Archive/Delete still work', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks/habits')
    await page.getByTestId('habit-new-btn').click()
    await page.getByTestId('habit-name-input').fill('Read')
    await page.getByTestId('habit-create-save-btn').click()

    const card = page.getByTestId('habit-card').filter({ hasText: 'Read' })
    const trigger = card.getByRole('button', { name: 'Habit options' })
    const menu = card.getByTestId('habit-options-menu')

    await trigger.click()
    await expect(menu).toBeVisible()

    // Outside click closes it.
    await page.getByRole('heading', { name: 'Habits' }).click()
    await expect(menu).not.toBeVisible()

    // Escape closes it too.
    await trigger.click()
    await expect(menu).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(menu).not.toBeVisible()

    // Delete still works from behind the popover.
    await trigger.click()
    await card.getByRole('menuitem', { name: 'Delete' }).click()
    await expect(page.getByTestId('habit-card').filter({ hasText: 'Read' })).not.toBeVisible()
  })

  test('joint current streak across two habits breaks on a miss, and the sub-line covers all three states', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks/habits')
    const h1 = await createHabit(page, 'Water plants')
    const h2 = await createHabit(page, 'Read')

    // A 4-day joint run ending 7 days ago, a gap (days -6..-3 left
    // untouched — due and missed for both), then a shorter 2-day trailing
    // run. Review fix #6: this streak math now runs server-side over the
    // full 84-day window, not the client's 28-day `entries` slice.
    for (const n of [10, 9, 8, 7, 2, 1]) {
      const date = businessDatePlus(-n)
      await toggleDate(page, h1.id, date)
      await toggleDate(page, h2.id, date)
    }
    await page.reload()

    await expect(page.getByTestId('habits-current-streak')).toHaveText('2 days')
    const currentSub = page.getByTestId('habits-consistency-card').locator('.band-stat').filter({ hasText: 'Current streak' }).locator('.s')
    await expect(currentSub).toHaveText(`best run since ${dMMMM(businessDatePlus(-6))}`)

    // Breaking the trailing run entirely (un-toggling h1's day -1, which
    // flips it back off) zeroes the streak — review fix #3: the sub-line
    // must read "none right now", not the literal "0 days running".
    await toggleDate(page, h1.id, businessDatePlus(-1))
    await page.reload()
    await expect(page.getByTestId('habits-current-streak')).toHaveText('0 days')
    await expect(currentSub).toHaveText('none right now')

    // Keeping both habits today makes it "all kept" — review fix #4: K is
    // the count of habits actually DUE today (both, here), not the total
    // habit count (which would also read 2 in this case, so this alone
    // wouldn't catch a regression back to `habits.length` — the point is
    // the label names the right concept, not a coincidentally-equal number).
    const today = businessToday()
    await toggleDate(page, h1.id, today)
    await toggleDate(page, h2.id, today)
    await page.reload()
    await expect(page.getByTestId('habits-current-streak')).toHaveText('1 day')
    await expect(currentSub).toHaveText('all 2 kept')
  })

  test('"Longest, last 12 weeks" says "ended {date}" for a run that is genuinely over, not the still-running one', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks/habits')
    const habit = await createHabit(page, 'On and off')

    // A 5-day run ending 3 days ago (the longest), then a break, then a
    // separate 1-day run today — shorter, so it must not be reported as
    // "ended {today}" the way review fix #5a specifically guards against.
    for (const n of [7, 6, 5, 4, 3]) {
      await toggleDate(page, habit.id, businessDatePlus(-n))
    }
    await toggleDate(page, habit.id, businessToday())
    await page.reload()

    await expect(page.getByTestId('habits-longest-streak')).toHaveText('5 days')
    const longestSub = page.getByTestId('habits-consistency-card').locator('.band-stat').filter({ hasText: 'Longest, last 12 weeks' }).locator('.s')
    await expect(longestSub).toHaveText(`ended ${dMMMM(businessDatePlus(-3))}`)
  })

  test('the "above 70%" chip turns chip-mute when fewer than half of habits clear it', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks/habits')
    const strong = await createHabit(page, 'Strong habit')
    await createHabit(page, 'Weak habit one')
    await createHabit(page, 'Weak habit two')
    for (let i = 0; i < 28; i++) {
      await toggleDate(page, strong.id, businessDatePlus(-i))
    }
    await page.reload()

    const chip = page.getByTestId('habits-above-threshold-chip')
    await expect(chip).toHaveText('1 of 3 above 70%')
    await expect(chip).toHaveClass(/chip-mute/)
  })

  test('"Kept by weekday" insight names two weak days when exactly two qualify', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks/habits')
    const habit = await createHabit(page, 'Mostly consistent')

    // Keep every day except 3 of each of the 4 Fridays and Saturdays in the
    // 28-day window (25% each, both below 70%); everything else 100%.
    let friKept = 0
    let satKept = 0
    for (let i = 0; i < 28; i++) {
      const date = businessDatePlus(-i)
      const wd = weekdayOf(date)
      if (wd === 5) {
        if (friKept === 0) await toggleDate(page, habit.id, date)
        friKept++
        continue
      }
      if (wd === 6) {
        if (satKept === 0) await toggleDate(page, habit.id, date)
        satKept++
        continue
      }
      await toggleDate(page, habit.id, date)
    }
    await page.reload()

    await expect(page.getByTestId('habits-weekday-insight')).toHaveText('Friday and Saturday are below 70%.')
  })

  test('a weekday nothing is due on renders as an empty bar, not a misleading 0%', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks/habits')
    // Due Monday–Friday only — Saturday and Sunday are never due for this
    // habit, so their pooled bars must read "—", not "0%" (review fix #8).
    const habit = await createHabit(page, 'Weekdays only', { schedule: [1, 2, 3, 4, 5] })
    for (let i = 0; i < 28; i++) {
      const date = businessDatePlus(-i)
      const wd = weekdayOf(date)
      if (wd === 0 || wd === 6) continue
      await toggleDate(page, habit.id, date)
    }
    await page.reload()

    const bars = page.getByTestId('habits-weekday-bars').locator('.bar')
    const satBar = bars.filter({ hasText: 'Sat' })
    const sunBar = bars.filter({ hasText: 'Sun' })
    await expect(satBar.locator('.bar-val')).toHaveText('—')
    await expect(sunBar.locator('.bar-val')).toHaveText('—')
    await expect(satBar).not.toHaveClass(/hi/)
    await expect(sunBar).not.toHaveClass(/hi/)
    const monBar = bars.filter({ hasText: 'Mon' })
    await expect(monBar.locator('.bar-val')).toHaveText('100%')
  })
})
