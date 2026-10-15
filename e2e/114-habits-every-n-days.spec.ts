/**
 * Habits that repeat every N days (migration 0030_habit_interval.sql).
 *
 * A fixed cycle anchored on the habit's creation date, mutually exclusive with
 * the weekday schedule. Covers: creating one through the form (card reads
 * "Every 3 days"), today counting as a due day while days off the cycle are
 * neither due nor missed, API + inline validation of the 2..365 range, and
 * switching a weekday habit to an N-day cycle clearing its weekday schedule.
 */

import { test, expect } from '@playwright/test'
import { newAppPage, businessToday, businessDatePlus } from './helpers'

const API = '/api'

type Page = import('@playwright/test').Page

async function createHabit(page: Page, name: string, data: Record<string, unknown> = {}) {
  return page.request.post(`${API}/habits`, { data: { name, ...data } })
}

test.describe('114 — Habits every N days', () => {
  test('creating an every-3-days habit through the form shows "Every 3 days"', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks/habits')

    await page.getByTestId('habit-new-btn').click()
    await page.getByTestId('habit-name-input').fill('Water the plants')
    await page.getByTestId('habit-frequency-interval').click()
    await page.getByTestId('habit-interval-input').fill('3')
    await page.getByTestId('habit-create-save-btn').click()

    const card = page.getByTestId('habit-card').filter({ hasText: 'Water the plants' })
    await expect(card).toBeVisible()
    await expect(card).toContainText('Every 3 days')

    const [habit] = await (await page.request.get(`${API}/habits`)).json()
    expect(habit.interval_days).toBe(3)
    expect(habit.schedule).toBeNull()
    // ceil(7 / 3) due days fit in a week.
    expect(habit.target_per_week).toBe(3)
  })

  test('today counts, and a day off the cycle is neither due nor missed', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks/habits')
    const today = businessToday()
    const created = await createHabit(page, 'Rotate tyres', { intervalDays: 3 })
    expect(created.status()).toBe(201)
    const habit = await created.json()

    // The cycle is anchored on today (the creation date), so today is due.
    const toggled = await (await page.request.post(`${API}/habits/${habit.id}/toggle`, { data: { date: today } })).json()
    expect(toggled.stats.currentStreak).toBe(1)
    const todayEntry = toggled.stats.entries.find((e: { date: string }) => e.date === today)
    expect(todayEntry).toMatchObject({ due: true, done: true })
    // Yesterday predates the anchor: not due, so it cannot be a miss.
    const yesterdayEntry = toggled.stats.entries.find((e: { date: string }) => e.date === businessDatePlus(-1))
    expect(yesterdayEntry).toMatchObject({ due: false, done: false })

    // Ticking tomorrow (off the cycle: 1 % 3 !== 0) must not disturb the streak.
    const ahead = await page.request.post(`${API}/habits/${habit.id}/toggle`, { data: { date: businessDatePlus(1) } })
    expect(ahead.ok()).toBe(true)

    const list = await (await page.request.get(`${API}/habits`)).json()
    expect(list[0].stats.currentStreak).toBe(1)
    expect(list[0].stats.bestStreak).toBe(1)

    await page.reload()
    const card = page.getByTestId('habit-card').filter({ hasText: 'Rotate tyres' })
    await expect(card.getByTestId('habit-current-streak')).toHaveText('1-day streak')
    await expect(card.getByTestId(`habit-grid-day-${businessDatePlus(-1)}`)).toHaveAttribute('aria-label', /not due/)
  })

  test('the API rejects an out-of-range or conflicting interval with 400', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks/habits')

    for (const bad of [1, 0, -3, 366, 2.5, 'three']) {
      const res = await createHabit(page, 'Bad interval', { intervalDays: bad })
      expect(res.status(), `intervalDays=${String(bad)}`).toBe(400)
      expect((await res.json()).error).toMatch(/2 to 365/)
    }
    expect((await createHabit(page, 'Both', { intervalDays: 3, schedule: [1] })).status()).toBe(400)
    expect((await createHabit(page, 'Linked', { intervalDays: 3, linkedKind: 'wallet:no-spend' })).status()).toBe(400)

    const ok = await createHabit(page, 'Fine', { intervalDays: 2 })
    expect(ok.status()).toBe(201)
    const patch = await page.request.patch(`${API}/habits/${(await ok.json()).id}`, { data: { intervalDays: 1 } })
    expect(patch.status()).toBe(400)
  })

  test('the form shows an inline error for an interval of 1 and creates nothing', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks/habits')

    await page.getByTestId('habit-new-btn').click()
    await page.getByTestId('habit-name-input').fill('Too often')
    await page.getByTestId('habit-frequency-interval').click()
    await page.getByTestId('habit-interval-input').fill('1')
    await page.getByTestId('habit-create-save-btn').click()

    await expect(page.getByTestId('habit-interval-error')).toContainText('2 to 365')
    await expect(page.getByTestId('habit-name-input')).toBeVisible()
    expect(await (await page.request.get(`${API}/habits`)).json()).toHaveLength(0)

    // Correcting the value clears the message and saves.
    await page.getByTestId('habit-interval-input').fill('4')
    await expect(page.getByTestId('habit-interval-error')).not.toBeVisible()
    await page.getByTestId('habit-create-save-btn').click()
    await expect(page.getByTestId('habit-card').filter({ hasText: 'Too often' })).toContainText('Every 4 days')
  })

  test('switching a weekday habit to every-N-days clears its weekday schedule', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks/habits')
    await createHabit(page, 'Stretch', { targetPerWeek: 5, schedule: [1, 2, 3, 4, 5] })
    await page.reload()

    const card = page.getByTestId('habit-card').filter({ hasText: 'Stretch' })
    await expect(card).toContainText('Weekdays')
    await card.getByRole('button', { name: 'Habit options' }).click()
    await card.getByRole('menuitem', { name: 'Edit' }).click()

    await expect(page.getByTestId('habit-frequency-days')).toHaveAttribute('aria-pressed', 'true')
    await page.getByTestId('habit-frequency-interval').click()
    await page.getByTestId('habit-interval-input').fill('3')
    await page.getByTestId('habit-create-save-btn').click()

    await expect(page.getByTestId('habit-card').filter({ hasText: 'Stretch' })).toContainText('Every 3 days')
    const [habit] = await (await page.request.get(`${API}/habits`)).json()
    expect(habit.schedule).toBeNull()
    expect(habit.interval_days).toBe(3)

    // And back: choosing specific days drops the interval again.
    const res = await page.request.patch(`${API}/habits/${habit.id}`, { data: { schedule: [0, 6] } })
    const back = await res.json()
    expect(back.interval_days).toBeNull()
    expect(JSON.parse(back.schedule)).toEqual([0, 6])
  })
})
