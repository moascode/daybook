/**
 * 111 — Today page / shared Tasks UI, v2 mockup parity.
 *
 * Covers the pieces of the Today-page parity pass not already exercised by
 * e2e/69-tasks-today.spec.ts or e2e/99-tasks-detail-modal.spec.ts: TaskRow's
 * fixed-column grid lining every row's cells up at the same x position (and
 * a long title wrapping instead of pushing those columns), an untimed
 * due-today row never reading amber, the composer's "N" focus shortcut,
 * quick add's Habit action, and "Reschedule all" never claiming success for
 * a task it couldn't actually move.
 */

import { test, expect } from '@playwright/test'
import type { Browser } from '@playwright/test'
import { newAppPage, businessToday, businessDatePlus } from './helpers'

const API = '/api'

/** Two users sharing a household group — needed only by the reschedule-shortfall test. */
async function createHousehold(browser: Browser) {
  const ownerCtx = await browser.newContext()
  const memberCtx = await browser.newContext()
  const ownerPage = await ownerCtx.newPage()
  const memberPage = await memberCtx.newPage()

  const ownerName = `owner_111_${Date.now()}`
  const memberName = `member_111_${Date.now()}`

  await ownerPage.request.post(`${API}/auth/signup`, { data: { username: ownerName, password: 'test-password' } })
  await memberPage.request.post(`${API}/auth/signup`, { data: { username: memberName, password: 'test-password' } })

  const group = await (
    await ownerPage.request.post(`${API}/groups`, { data: { name: '111 Household' } })
  ).json()
  await ownerPage.request.post(`${API}/groups/${group.id}/invites`, { data: { username: memberName } })

  const invites = await (await memberPage.request.get(`${API}/invites`)).json()
  const invite = invites.find((i: { group_id: string }) => i.group_id === group.id)
  await memberPage.request.post(`${API}/invites/${invite.id}/accept`)

  return { ownerPage, memberPage, ownerCtx, memberCtx }
}

async function currentUserId(page: import('@playwright/test').Page): Promise<string> {
  const res = await page.request.get(`${API}/auth/me`)
  const { user } = await res.json()
  return user.id as string
}

test.describe('111 — Today page parity', () => {
  test('every row\'s exact/relative/avatar/actions columns line up at the same x position, and a long title wraps', async ({
    browser,
  }) => {
    const page = await newAppPage(browser, '/tasks')
    const today = businessToday()

    await page.request.post(`${API}/tasks`, { data: { content: 'Short', dueDate: today } })
    await page.request.post(`${API}/tasks`, {
      data: {
        content:
          'A genuinely very long task title that should wrap onto a second line instead of pushing the date and avatar columns out of alignment',
        dueDate: today,
      },
    })
    await page.reload()

    const rows = page.getByTestId('today-task-row')
    await expect(rows).toHaveCount(2)

    const shortRow = rows.filter({ hasText: 'Short' })
    const longRow = rows.filter({ hasText: 'genuinely very long' })

    // The long title actually wraps (taller row), not an ellipsis/overflow.
    const shortBox = await shortRow.boundingBox()
    const longBox = await longRow.boundingBox()
    expect(longBox!.height).toBeGreaterThan(shortBox!.height)

    // Every row's trailing columns (relative date, exact date, actions) sit
    // at the same x regardless of how tall the title track got.
    const shortActions = await shortRow.locator('.trow-actions').boundingBox()
    const longActions = await longRow.locator('.trow-actions').boundingBox()
    expect(Math.round(longActions!.x)).toBe(Math.round(shortActions!.x))

    const shortWhen = await shortRow.locator('.task-when').first().boundingBox()
    const longWhen = await longRow.locator('.task-when').first().boundingBox()
    expect(Math.round(longWhen!.x)).toBe(Math.round(shortWhen!.x))
  })

  test('an untimed due-today task reads "Anytime" and is never tinted amber', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks')
    await page.request.post(`${API}/tasks`, { data: { content: 'Untimed today task', dueDate: businessToday() } })
    await page.reload()

    const row = page.getByTestId('today-task-row').filter({ hasText: 'Untimed today task' })
    await expect(row).toBeVisible()
    await expect(row.locator('.task-when').first()).toHaveText('Anytime')
    await expect(row.locator('.task-when.soon')).toHaveCount(0)
    await expect(row.locator('.task-when.late')).toHaveCount(0)
  })

  test('pressing "N" anywhere on the page focuses the composer, but typing "n" inside a field just types', async ({
    browser,
  }) => {
    const page = await newAppPage(browser, '/tasks')
    const composer = page.getByTestId('today-composer-input')
    await expect(composer).not.toBeFocused()

    // Focus is elsewhere (the body) — "N" should jump focus to the composer.
    await page.locator('body').click({ position: { x: 5, y: 5 } })
    await page.keyboard.press('n')
    await expect(composer).toBeFocused()

    // Having focused it via the shortcut, typing a word containing "n" must
    // reach the input normally rather than being swallowed as another "N" —
    // the guard only needs to ignore the key while some OTHER field is
    // focused, not block it forever once the composer itself has focus.
    await page.keyboard.type('Plan night')
    await expect(composer).toHaveValue('Plan night')
  })

  test('quick add Habit navigates to Habits and opens the create-habit modal', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks')

    await page.getByTestId('quick-add').click()
    await page.locator('[data-testid="quick-add-item"][data-action="habit"]').click()

    await expect(page).toHaveURL(/\/tasks\/habits/)
    await expect(page.getByTestId('habit-name-input')).toBeVisible()
  })

  test('reschedule all also moves an overdue task someone else handed you', async ({ browser }) => {
    // An assignee may reschedule a task they were handed (same access as
    // completing it), so "Reschedule both" moves both rows — none is left
    // stuck in Overdue behind a success toast.
    const { ownerPage, memberPage, ownerCtx, memberCtx } = await createHousehold(browser)
    const ownerId = await currentUserId(ownerPage)
    const yesterday = businessDatePlus(-1)

    await ownerPage.request.post(`${API}/tasks`, { data: { content: 'Owner overdue task', dueDate: yesterday } })
    const memberTask = await (
      await memberPage.request.post(`${API}/tasks`, { data: { content: 'Member overdue task', dueDate: yesterday } })
    ).json()
    await memberPage.request.patch(`${API}/tasks/${memberTask.id}`, { data: { assigneeId: ownerId } })

    await ownerPage.goto('/tasks')
    const rescheduleBtn = ownerPage.getByTestId('reschedule-all-btn')
    await expect(rescheduleBtn).toHaveText('Reschedule both to today')
    await rescheduleBtn.click()

    await expect(ownerPage.getByText('Rescheduled 2 tasks to today.')).toBeVisible()
    await expect(ownerPage.getByTestId('reschedule-all-btn')).toHaveCount(0)
    await expect(ownerPage.getByTestId('today-task-row').filter({ hasText: 'Member overdue task' })).toBeVisible()

    await ownerCtx.close()
    await memberCtx.close()
  })
})
