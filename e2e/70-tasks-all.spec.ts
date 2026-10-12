/**
 * R5 PR-2 — All tasks page (docs/roadmap/design-adoption/.flow/R5-all-tasks/flow-plan.md,
 * docs/archive/design-adoption/tasks-design-adoption.md §All tasks).
 *
 * Covers: stat cards render, filtering by priority and free-text narrows the
 * list with a removable chip, the "No due date" group + "Schedule these"
 * moves a task into a dated group, the Completion and age cards render with
 * seeded data, and the mockup's controls (tasks-all.html) each do something:
 * Open/Done/All, Group by list, the sort menu, Load more, and the age card's
 * Review.
 */

import { test, expect } from '@playwright/test'
import type { Browser } from '@playwright/test'
import { newAppPage, businessDatePlus } from './helpers'

const API = '/api'

/**
 * Two users in the same household group, mirroring e2e/92-tasks-assigned.spec.ts's
 * `createGroupOfTwo` — duplicated locally rather than shared, since that
 * helper lives in a spec file we don't own and this file's lock list doesn't
 * extend to helpers.ts. Needed for the "Schedule these" shortfall test: a
 * task the viewer only sees here as the SECOND user's assignment (not its
 * owner) is exactly the case `POST /tasks/reschedule`'s owner-only scoping
 * (worker/routes/tasks.ts) leaves unmoved.
 */
async function createGroupOfTwo(browser: Browser) {
  const ownerCtx = await browser.newContext()
  const assigneeCtx = await browser.newContext()
  const ownerPage = await ownerCtx.newPage()
  const assigneePage = await assigneeCtx.newPage()

  const ownerName = `owner_all_${Date.now()}`
  const assigneeName = `asnee_all_${Date.now()}`

  await ownerPage.request.post(`${API}/auth/signup`, { data: { username: ownerName, password: 'test-password' } })
  await assigneePage.request.post(`${API}/auth/signup`, { data: { username: assigneeName, password: 'test-password' } })

  const groupRes = await ownerPage.request.post(`${API}/groups`, { data: { name: 'All Tasks Test Household' } })
  const group = await groupRes.json()
  await ownerPage.request.post(`${API}/groups/${group.id}/invites`, { data: { username: assigneeName } })

  const invitesRes = await assigneePage.request.get(`${API}/invites`)
  const invites = await invitesRes.json()
  const invite = invites.find((i: { group_id: string }) => i.group_id === group.id)
  await assigneePage.request.post(`${API}/invites/${invite.id}/accept`)

  return { ownerPage, assigneePage, ownerCtx, assigneeCtx }
}

async function currentUserId(page: import('@playwright/test').Page): Promise<string> {
  const res = await page.request.get(`${API}/auth/me`)
  const { user } = await res.json()
  return user.id
}

test.describe('70 — All tasks page', () => {
  test('sidebar nav item is visible and stat cards render with no tasks yet', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks')

    const navAll = page.getByTestId('nav-tasks-all')
    await expect(navAll).toBeVisible()
    await navAll.click()
    await expect(page).toHaveURL(/\/tasks\/all$/)

    // FEAT-058: the old Open/Overdue/Due-today/No-due-date `.stat-card`s
    // were replaced with the mockup's four `.stat-card`s (Overdue/Due this
    // week/No due date/Done this week) — "Open" was dropped entirely.
    await expect(page.getByTestId('all-tasks-stat-overdue').locator('.stat-value')).toHaveText('0')
    await expect(page.getByTestId('all-tasks-stat-due-this-week').locator('.stat-value')).toHaveText('0')
    await expect(page.getByTestId('all-tasks-stat-no-due-date').locator('.stat-value')).toHaveText('0')
    await expect(page.getByTestId('all-tasks-stat-done-this-week').locator('.stat-value')).toHaveText('0')
  })

  test('filtering by priority narrows the list and shows a removable chip', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks')

    await page.request.post(`${API}/tasks`, { data: { content: 'High prio task', priority: 'high' } })
    await page.request.post(`${API}/tasks`, { data: { content: 'Low prio task', priority: 'low' } })

    await page.goto('/tasks/all')
    await expect(page.getByText('High prio task')).toBeVisible()
    await expect(page.getByText('Low prio task')).toBeVisible()

    await page.getByTestId('all-tasks-filter-toggle').click()
    await page.getByTestId('all-tasks-filter-priority').selectOption('high')

    await expect(page.getByText('High prio task')).toBeVisible()
    await expect(page.getByText('Low prio task')).not.toBeVisible()

    const chip = page.getByTestId('all-tasks-filter-chip')
    await expect(chip).toContainText('Priority: High')

    // Removing the chip restores the full list.
    await chip.getByRole('button', { name: 'Remove filter' }).click()
    await expect(page.getByText('Low prio task')).toBeVisible()
    await expect(page.getByTestId('all-tasks-filter-chip')).toHaveCount(0)
  })

  test('free-text filter narrows the list with a removable chip via Clear all', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks')

    await page.request.post(`${API}/tasks`, { data: { content: 'Buy groceries' } })
    await page.request.post(`${API}/tasks`, { data: { content: 'Book flight' } })

    await page.goto('/tasks/all')
    await page.getByTestId('all-tasks-filter-input').fill('groceries')

    await expect(page.getByText('Buy groceries')).toBeVisible()
    await expect(page.getByText('Book flight')).not.toBeVisible()

    const clearAll = page.getByTestId('all-tasks-filter-clear-all')
    await expect(clearAll).toBeVisible()
    await clearAll.click()

    await expect(page.getByTestId('all-tasks-filter-input')).toHaveValue('')
    await expect(page.getByText('Book flight')).toBeVisible()
  })

  test('"No due date" group renders with a Schedule-these button that moves tasks into today\'s group', async ({
    browser,
  }) => {
    const page = await newAppPage(browser, '/tasks')

    await page.request.post(`${API}/tasks`, { data: { content: 'Someday task' } })
    await page.goto('/tasks/all')

    const undatedGroup = page.getByTestId('all-tasks-no-due-date-group')
    await expect(undatedGroup).toBeVisible()
    await expect(undatedGroup).toContainText('No due date')

    const scheduleBtn = page.getByTestId('schedule-undated-btn')
    await expect(scheduleBtn).toBeVisible()
    await scheduleBtn.click()

    // The undated group disappears and a dated group for today appears with
    // the task now inside it.
    await expect(page.getByTestId('all-tasks-no-due-date-group')).not.toBeVisible()
    const dayHeaders = page.getByTestId('all-tasks-day-header')
    await expect(dayHeaders.filter({ hasText: 'Today ·' })).toBeVisible()
    await expect(page.getByTestId('all-tasks-row').filter({ hasText: 'Someday task' })).toBeVisible()
  })

  test('Completion card and age card render with seeded data', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks')
    // A fresh task shouldn't count; a 100-day-old one should.
    const oldCreatedAt = `${businessDatePlus(-100)} 00:00:00`

    await page.request.post(`${API}/tasks`, { data: { content: 'Fresh task' } })
    await page.request.post(`${API}/tasks`, { data: { content: 'Old task', createdAt: oldCreatedAt } })

    await page.goto('/tasks/all')
    await expect(page.getByTestId('age-breakdown')).toHaveText('1 task older than three months')
    await expect(page.getByTestId('all-tasks-age-week')).toContainText('1')
    await expect(page.getByTestId('all-tasks-age-old')).toContainText('1')
    await expect(page.getByTestId('all-tasks-completion-footnote')).toHaveText(
      'Nothing completed in the last twelve weeks yet.',
    )

    // Complete a task so this week's bar has a data point.
    const row = page.getByTestId('all-tasks-row').filter({ hasText: 'Fresh task' })
    await row.getByRole('button', { name: 'Mark complete' }).click()
    await page.reload()

    await expect(page.getByTestId('all-tasks-completion-bars').locator('rect').last()).toHaveAttribute('data-count', '1')
    await expect(page.getByTestId('all-tasks-completion-footnote')).toHaveText('You finished 1 task in the last four weeks.')
  })

  test('Open / Done / All switch which tasks the list shows', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks')
    await page.request.post(`${API}/tasks`, { data: { content: 'Still open' } })
    const done = await (await page.request.post(`${API}/tasks`, { data: { content: 'Already done' } })).json()
    await page.request.post(`${API}/tasks/${done.id}/complete`)

    await page.goto('/tasks/all')
    await expect(page.getByTestId('all-tasks-counts')).toHaveText('1 open · 1 completed')
    const rows = page.getByTestId('all-tasks-row-title')
    await expect(rows).toHaveText(['Still open'])

    await page.getByTestId('all-tasks-status-done').click()
    await expect(rows).toHaveText(['Already done'])
    await expect(page.getByTestId('all-tasks-group-header')).toContainText('Completed today')

    await page.getByTestId('all-tasks-status-all').click()
    await expect(rows).toHaveText(['Still open', 'Already done'])

    // Un-completing from the Done tab moves it back to Open.
    await page.getByTestId('all-tasks-status-done').click()
    await page.getByTestId('all-tasks-row').getByRole('button', { name: 'Mark incomplete' }).click()
    await expect(page.getByTestId('all-tasks-empty')).toBeVisible()
    await page.getByTestId('all-tasks-status-open').click()
    await expect(rows).toHaveText(['Still open', 'Already done'])
  })

  test('Group by list groups rows under their list, and back', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks')
    const list = await (await page.request.post(`${API}/task-lists`, { data: { name: 'Garden', color: '#16a34a' } })).json()
    await page.request.post(`${API}/tasks`, { data: { content: 'Prune roses', listId: list.id } })
    await page.request.post(`${API}/tasks`, { data: { content: 'Loose end' } })

    await page.goto('/tasks/all')
    const toggle = page.getByTestId('all-tasks-group-toggle')
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-pressed', 'true')
    const headers = page.getByTestId('all-tasks-group-header')
    await expect(headers.filter({ hasText: 'Garden' })).toContainText('1')
    await expect(headers.filter({ hasText: 'Unsorted' })).toContainText('1')

    await toggle.click()
    await expect(page.getByTestId('all-tasks-no-due-date-group')).toContainText('2')
  })

  test('the sort menu reorders rows within a group', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks')
    const day = businessDatePlus(3)
    await page.request.post(`${API}/tasks`, { data: { content: 'Low one', dueDate: day, dueTime: '08:00', priority: 'low' } })
    await page.request.post(`${API}/tasks`, { data: { content: 'High one', dueDate: day, dueTime: '17:00', priority: 'high' } })

    await page.goto('/tasks/all')
    const rows = page.getByTestId('all-tasks-row-title')
    await expect(rows).toHaveText(['Low one', 'High one'])

    await page.getByTestId('all-tasks-sort').click()
    await page.getByTestId('all-tasks-sort-priority').click()
    await expect(page.getByTestId('all-tasks-sort')).toHaveText('Priority')
    await expect(rows).toHaveText(['High one', 'Low one'])
  })

  test('Load more reveals the next page of rows', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks')
    for (let i = 1; i <= 27; i++) {
      await page.request.post(`${API}/tasks`, { data: { content: `Paged task ${i}` } })
    }

    await page.goto('/tasks/all')
    await expect(page.getByTestId('all-tasks-showing')).toHaveText('Showing 25 of 27')
    await expect(page.getByTestId('all-tasks-row')).toHaveCount(25)
    // The group heading counts the whole group, not just the visible slice.
    await expect(page.getByTestId('all-tasks-no-due-date-group')).toContainText('27')

    await page.getByTestId('all-tasks-load-more').click()
    await expect(page.getByTestId('all-tasks-row')).toHaveCount(27)
    await expect(page.getByTestId('all-tasks-showing')).toHaveText('Showing 27 of 27')
    await expect(page.getByTestId('all-tasks-load-more')).toHaveCount(0)
  })

  test("the age card's Review filters the list to tasks older than three months", async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks')
    await page.request.post(`${API}/tasks`, { data: { content: 'Fresh task' } })
    await page.request.post(`${API}/tasks`, {
      data: { content: 'Ancient task', createdAt: `${businessDatePlus(-120)} 00:00:00` },
    })

    await page.goto('/tasks/all')
    await page.getByTestId('all-tasks-age-review').click()
    await expect(page.getByTestId('all-tasks-row-title')).toHaveText(['Ancient task'])
    const chip = page.getByTestId('all-tasks-filter-chip')
    await expect(chip).toHaveText('Older than three months')

    await chip.getByRole('button', { name: 'Remove filter' }).click()
    await expect(page.getByTestId('all-tasks-row')).toHaveCount(2)
  })

  test('a long title wraps instead of truncating, and every column stays put', async ({ browser }) => {
    // The trailing cells are fixed grid tracks (`.task--cols`), so a title
    // running onto several lines must not shift any column on any row.
    const page = await newAppPage(browser, '/tasks')
    await page.setViewportSize({ width: 1400, height: 900 })
    const today = businessDatePlus(0)
    const long =
      'Accounts: savings can be labelled for an account like a piggy bank — travel, bonus, personal and an emergency fund, each with its own target and progress bar'
    await page.request.post(`${API}/tasks`, { data: { content: 'Short one', dueDate: today } })
    await page.request.post(`${API}/tasks`, { data: { content: long, dueDate: today, dueTime: '18:00' } })
    await page.request.post(`${API}/tasks`, { data: { content: 'Late one', dueDate: businessDatePlus(-3) } })

    await page.goto('/tasks/all')
    await expect(page.getByTestId('all-tasks-row')).toHaveCount(3)

    const title = page.getByTestId('all-tasks-row-title').filter({ hasText: 'Accounts:' })
    const oneLine = await page.getByTestId('all-tasks-row-title').filter({ hasText: 'Short one' }).boundingBox()
    const box = await title.boundingBox()
    expect(box!.height).toBeGreaterThan(oneLine!.height * 1.5) // wrapped, not clipped to one line
    await expect(title).toHaveText(long)

    const columnStarts = await page
      .getByTestId('all-tasks-row')
      .evaluateAll((rows) =>
        rows.map((r) => Array.from(r.children, (c) => Math.round(c.getBoundingClientRect().left)).join(',')),
      )
    expect(new Set(columnStarts).size).toBe(1)
  })

  test('deleting a row removes it and Undo restores it', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks')
    await page.request.post(`${API}/tasks`, { data: { content: 'Disposable task' } })

    await page.goto('/tasks/all')
    const row = page.getByTestId('all-tasks-row').filter({ hasText: 'Disposable task' })
    await expect(row).toBeVisible()

    await row.getByRole('button', { name: /More actions/ }).click()
    await page.getByTestId(/all-tasks-row-delete-/).click()

    await expect(page.getByTestId('all-tasks-row').filter({ hasText: 'Disposable task' })).toHaveCount(0)
    const toast = page.getByText('Task deleted')
    await expect(toast).toBeVisible()

    await page.getByRole('button', { name: 'Undo' }).click()
    await expect(page.getByTestId('all-tasks-row').filter({ hasText: 'Disposable task' })).toBeVisible()
  })

  test('"Done this week" matches the Completion chart\'s current-week bar', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks')
    const task = await (await page.request.post(`${API}/tasks`, { data: { content: 'Finish me' } })).json()
    await page.request.post(`${API}/tasks/${task.id}/complete`)

    await page.goto('/tasks/all')
    const nowBar = page.getByTestId('all-tasks-completion-bars').locator('rect').last()
    const nowCount = await nowBar.getAttribute('data-count')

    await expect(page.getByTestId('all-tasks-stat-done-this-week').locator('.stat-value')).toHaveText(nowCount ?? '')
  })

  test('"Schedule these" reports a shortfall when a task belongs to someone else', async ({ browser }) => {
    const { ownerPage, assigneePage, ownerCtx, assigneeCtx } = await createGroupOfTwo(browser)
    const assigneeId = await currentUserId(assigneePage)

    // The SECOND user's own undated task — viewed from their own All tab,
    // this one is theirs (`user_id` matches) and CAN move.
    await assigneePage.request.post(`${API}/tasks`, { data: { content: "Assignee's own task" } })
    // Created and owned by the FIRST user, then handed to the second — it
    // shows up on the second user's All tab too (view=all includes
    // `assignee_id = viewer`), but `POST /tasks/reschedule` is scoped to
    // `user_id = caller` only (worker/routes/tasks.ts, "not sharing-aware"),
    // so the second user's "Schedule these" can't move it.
    const handedOff = await (
      await ownerPage.request.post(`${API}/tasks`, { data: { content: 'Handed off task' } })
    ).json()
    await ownerPage.request.patch(`${API}/tasks/${handedOff.id}`, { data: { assigneeId } })

    await assigneePage.goto('/tasks/all')
    const undatedGroup = assigneePage.getByTestId('all-tasks-no-due-date-group')
    await expect(undatedGroup).toContainText('2')

    await assigneePage.getByTestId('schedule-undated-btn').click()
    await expect(
      assigneePage.getByText(/Scheduled 1 task for today — 1 couldn't move because it belongs to someone else\./),
    ).toBeVisible()
    await expect(assigneePage.getByTestId('all-tasks-row').filter({ hasText: "Assignee's own task" })).toBeVisible()
    await expect(assigneePage.getByTestId('all-tasks-no-due-date-group')).toContainText('1')
    await expect(assigneePage.getByTestId('all-tasks-row').filter({ hasText: 'Handed off task' })).toBeVisible()

    await ownerCtx.close()
    await assigneeCtx.close()
  })

  test('stat cards reflow into pairs instead of overflowing at 375px', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks')
    await page.goto('/tasks/all')
    await page.setViewportSize({ width: 375, height: 800 })

    const cards = page.locator('.dash > .stat-card')
    await expect(cards).toHaveCount(4)
    const boxes = await cards.evaluateAll((els) => els.map((el) => el.getBoundingClientRect()))

    // No card runs past the viewport (the `.dash` grid actually reflowed,
    // not just shrunk its tracks past zero).
    for (const box of boxes) {
      expect(box.right).toBeLessThanOrEqual(375 + 1)
    }
    // Two visually distinct rows — cards pair up two-per-row at this width
    // (layout.css's `.c3 { grid-column: span 6 }` under 680px), not the
    // single desktop row of four `.grid.g4` used to render.
    const tops = new Set(boxes.map((b) => Math.round(b.top)))
    expect(tops.size).toBe(2)
  })
})
