/**
 * R5 PR-1 — Today page (docs/roadmap/design-adoption/.flow/R5-foundation-today/flow-plan.md item
 * 10, docs/archive/design-adoption/tasks-design-adoption.md §Today), rewritten for
 * FEAT-054 (docs/backlog/EP-07-tasks-depth/FEAT-054-tasks-today-design-adoption.md):
 * the page head's Mine/Everyone segment + Plan week link, the full Wallet-syntax
 * composer (TaskComposer/parseTaskComposerInput), TaskRow's new `.task-meta`
 * wrapper (list chip, subtasks, recurrence, wallet chip, assignee avatar, kebab
 * menu), the Hide/Show Done-today toggle, and the Lists/Worth-knowing right-rail
 * cards.
 *
 * Covers: the band renders, adding a task via the composer's Enter-to-add,
 * composer parsing of the full syntax, Overdue/Today/Done-today grouping, the
 * reschedule-all button, the Up-next rail, the Mine/Everyone audience filter,
 * Plan week navigation, Lists per-list progress, Worth knowing findings, and the
 * kebab menu's Edit details / Reschedule / Delete actions. Sidebar Lists/Unsorted
 * coverage (plan item 11) lives here too since it's the same page's shell.
 */

import { test, expect } from '@playwright/test'
import type { Browser, Page } from '@playwright/test'
import { newAppPage, waitForApp, businessToday, businessDatePlus } from './helpers'

const API = '/api'

async function currentUserId(page: Page): Promise<string> {
  const res = await page.request.get(`${API}/auth/me`)
  const { user } = await res.json()
  return user.id as string
}

/**
 * Two users sharing a household group, the owner already navigated to
 * `/tasks` — used by the composer-parsing test (needs a real co-member to
 * @-assign) and the Mine/Everyone test (needs a task the viewer neither owns
 * nor is assigned, visible only via a shared list). Mirrors
 * e2e/92-tasks-assigned.spec.ts's `createGroupOfTwo`, duplicated locally per
 * this suite's per-file convention rather than importing across spec files.
 */
async function createHousehold(browser: Browser) {
  const ownerCtx = await browser.newContext()
  const coCtx = await browser.newContext()
  const ownerPage = await ownerCtx.newPage()
  const coPage = await coCtx.newPage()

  const ownerName = `owner_tdy_${Date.now()}`
  const coName = `co_tdy_${Date.now()}`

  await ownerPage.request.post(`${API}/auth/signup`, { data: { username: ownerName, password: 'test-password' } })
  await coPage.request.post(`${API}/auth/signup`, { data: { username: coName, password: 'test-password' } })

  const groupRes = await ownerPage.request.post(`${API}/groups`, { data: { name: 'Today Test Household' } })
  const group = await groupRes.json()
  await ownerPage.request.post(`${API}/groups/${group.id}/invites`, { data: { username: coName } })

  const invites = await (await coPage.request.get(`${API}/invites`)).json()
  const invite = invites.find((i: { group_id: string }) => i.group_id === group.id)
  await coPage.request.post(`${API}/invites/${invite.id}/accept`)

  await ownerPage.goto('/tasks')
  await waitForApp(ownerPage)

  return { ownerPage, coPage, ownerCtx, coCtx, ownerName, coName, group }
}

test.describe('69 — Tasks Today page', () => {
  test('renders the band and an empty Today group with no tasks yet', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks')

    await expect(page.getByTestId('today-band')).toBeVisible()
    await expect(page.getByTestId('today-band')).toContainText('done today')
    await expect(page.getByText('Nothing due today.')).toBeVisible()
    // 7-day load strip renders all seven days.
    await expect(page.getByTestId('load-day')).toHaveCount(7)
  })

  test('adding a task via the composer (Enter) lands it in the Today group', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks')

    // TaskComposer.tsx has no dedicated testid — its input carries a stable
    // aria-label ("Add a task") instead, unique in the app (grepped).
    // The parser sets `dueDate` only when the text itself carries a date
    // word — but TasksTodayPage.tsx's handleCreateTask defaults a null
    // parsed dueDate to today (BUG-009), so even a bare quick-add still
    // lands in the Today group; see the dedicated no-date-word test below.
    // "today" is stripped from the displayed content by the parser here, so
    // the visible task text stays "Water the plants".
    const composer = page.getByRole('textbox', { name: 'Add a task', exact: true })
    await composer.fill('Water the plants today')
    await composer.press('Enter')

    await expect(composer).toHaveValue('')
    await expect(page.getByText('Water the plants')).toBeVisible()
    await expect(page.getByText('Nothing due today.')).not.toBeVisible()
  })

  test('BUG-009: a bare quick-add with no date word still defaults to today and lands in the Today group', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks')

    // No date word at all — parseTaskComposerInput leaves dueDate null, and
    // TasksTodayPage.tsx's handleCreateTask must fall back to today's date
    // (BUG-009) rather than leaving the task dateless and invisible on this
    // date-filtered page.
    const composer = page.getByRole('textbox', { name: 'Add a task', exact: true })
    await composer.fill('Water the plants')
    await composer.press('Enter')

    await expect(composer).toHaveValue('')
    await expect(page.getByText('Water the plants')).toBeVisible()
    await expect(page.getByText('Nothing due today.')).not.toBeVisible()

    const tasks = await (await page.request.get(`${API}/tasks?view=all`)).json()
    const created = tasks.find((t: { content: string }) => t.content === 'Water the plants')
    expect(created).toBeTruthy()
    expect(created.due_date).toBe(businessToday())
  })

  test('composer parsing: list/priority/assignee/date/time all land on the created task', async ({ browser }) => {
    // D-11 example, extended with an @-assignee so every parsed field gets
    // exercised: "pay rent tomorrow 9am #household !high @<co-member>".
    // "#household" matches the default "Household" list every signup seeds
    // (68-tasks-api.spec.ts), so no list needs to be created first.
    const { ownerPage, coPage, ownerCtx, coCtx, coName } = await createHousehold(browser)

    const composer = ownerPage.getByRole('textbox', { name: 'Add a task', exact: true })
    await composer.fill(`pay rent tomorrow 9am #household !high @${coName}`)
    await composer.press('Enter')
    await expect(composer).toHaveValue('')
    await expect(ownerPage.getByText('pay rent')).toBeVisible()

    const lists = await (await ownerPage.request.get(`${API}/task-lists`)).json()
    const householdList = lists.find((l: { name: string }) => l.name === 'Household')
    const coId = await currentUserId(coPage)

    const tasks = await (await ownerPage.request.get(`${API}/tasks?view=all`)).json()
    const created = tasks.find((t: { content: string }) => t.content === 'pay rent')
    expect(created).toBeTruthy()
    expect(created.list_id).toBe(householdList.id)
    expect(created.priority).toBe('high')
    expect(created.assignee_id).toBe(coId)
    expect(created.due_date).toBe(businessDatePlus(1))
    expect(created.due_time).toBe('09:00')

    await ownerCtx.close()
    await coCtx.close()
  })

  test('Mine/Everyone segment toggle filters the task set', async ({ browser }) => {
    // A task the viewer is neither the owner nor the assignee of — only
    // visible via a list the co-member shared into the household group
    // (worker/routes/tasks.ts's visibility clause). That's what makes it a
    // real test of the audience filter rather than of ownership/assignment,
    // both of which already pass the "Mine" filter on their own.
    const { ownerPage, coPage, ownerCtx, coCtx, group } = await createHousehold(browser)

    const list = await (await coPage.request.post(`${API}/task-lists`, { data: { name: 'Co shared list' } })).json()
    await coPage.request.post(`${API}/task-lists/${list.id}/shares`, { data: { groupId: group.id, canWrite: true } })
    const coId = await currentUserId(coPage)
    await coPage.request.post(`${API}/tasks`, {
      data: { content: 'Co-member errand', listId: list.id, assigneeId: coId, dueDate: businessToday() },
    })

    await ownerPage.reload()
    await expect(ownerPage.getByTestId('today-audience-mine')).toHaveAttribute('aria-selected', 'true')
    await expect(ownerPage.getByText('Co-member errand')).not.toBeVisible()

    await ownerPage.getByTestId('today-audience-everyone').click()
    await expect(ownerPage.getByText('Co-member errand')).toBeVisible()

    await ownerPage.getByTestId('today-audience-mine').click()
    await expect(ownerPage.getByText('Co-member errand')).not.toBeVisible()

    await ownerCtx.close()
    await coCtx.close()
  })

  test('composer "Habit" shortcut navigates to Habits and opens the create-habit modal', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks')

    await page.getByRole('button', { name: 'Habit' }).click()

    await expect(page).toHaveURL(/\/tasks\/habits$/)
    // TasksHabitsPage.tsx's nav-state one-shot (`openCreateHabit`) opens the
    // create-habit Modal immediately rather than just landing on the page.
    await expect(page.getByRole('heading', { name: 'New habit' })).toBeVisible()
    await expect(page.getByTestId('habit-name-input')).toBeVisible()
  })

  test('"Plan week" navigates to Upcoming', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks')

    await page.getByTestId('today-plan-week-btn').click()
    await expect(page).toHaveURL(/\/tasks\/upcoming$/)
  })

  test('completing a Today task moves it into the collapsible Done today group', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks')

    // Same "today" requirement as above — a bare quick-add has no due date
    // and would never appear in the Today group to begin with.
    const composer = page.getByRole('textbox', { name: 'Add a task', exact: true })
    await composer.fill('Reply to email today')
    await composer.press('Enter')
    await expect(page.getByText('Reply to email')).toBeVisible()

    const row = page.getByTestId('today-task-row').filter({ hasText: 'Reply to email' })
    await row.getByRole('button', { name: 'Mark complete' }).click()

    // Moves out of Today into Done today, which starts expanded. The group
    // header ("Done today") and the collapse toggle (now a Hide/Show text
    // button, not a bare chevron) are two separate elements.
    const doneHeader = page.locator('.tgroup', { hasText: 'Done today' })
    await expect(doneHeader).toBeVisible()
    const doneToggle = page.getByTestId('done-today-toggle')
    await expect(doneToggle).toBeVisible()
    await expect(doneToggle).toHaveText('Hide')
    await expect(page.getByTestId('today-task-row').filter({ hasText: 'Reply to email' })).toBeVisible()

    // Collapsing hides the row; expanding again shows it.
    await doneToggle.click()
    await expect(doneToggle).toHaveText('Show')
    await expect(page.getByTestId('today-task-row').filter({ hasText: 'Reply to email' })).not.toBeVisible()
    await doneToggle.click()
    await expect(doneToggle).toHaveText('Hide')
    await expect(page.getByTestId('today-task-row').filter({ hasText: 'Reply to email' })).toBeVisible()
  })

  test('an overdue task groups under Overdue, and reschedule moves it to today', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks')
    const yesterday = businessDatePlus(-1)

    // Seed an overdue task directly via the API — this is about the
    // grouping/reschedule behaviour, not the composer's own date parsing
    // (covered above).
    await page.request.post(`${API}/tasks`, { data: { content: 'Overdue thing', dueDate: yesterday } })
    await page.reload()

    const overdueRow = page.getByTestId('today-task-row').filter({ hasText: 'Overdue thing' })
    await expect(overdueRow).toBeVisible()
    // Scoped to the tgroup header — the band card (now also a <section>,
    // per FEAT-054's markup-order fix) has its own "Overdue" stat label, so
    // an unscoped section/getByText match hits both.
    await expect(page.locator('.tgroup').getByText('Overdue', { exact: true })).toBeVisible()

    // Singular label: exactly one overdue task ("Reschedule to today"), not
    // the plural/count forms the page also renders for 2 or 3+.
    const rescheduleBtn = page.getByTestId('reschedule-all-btn')
    await expect(rescheduleBtn).toBeVisible()
    await expect(rescheduleBtn).toHaveText('Reschedule to today')
    await rescheduleBtn.click()

    // Rescheduled to today: the Overdue group (and its button) disappears,
    // and the task now shows in Today.
    await expect(page.getByTestId('reschedule-all-btn')).not.toBeVisible()
    await expect(page.getByTestId('today-task-row').filter({ hasText: 'Overdue thing' })).toBeVisible()
  })

  test('two overdue tasks: reschedule button reads "Reschedule both to today" and moves both', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks')
    const yesterday = businessDatePlus(-1)

    // Exactly 2 overdue tasks — the AC's headline dual-count case, distinct
    // from both the singular (1) and the "N" plural (3+) wording.
    await page.request.post(`${API}/tasks`, { data: { content: 'Overdue one', dueDate: yesterday } })
    await page.request.post(`${API}/tasks`, { data: { content: 'Overdue two', dueDate: yesterday } })
    await page.reload()

    await expect(page.getByTestId('today-task-row').filter({ hasText: 'Overdue one' })).toBeVisible()
    await expect(page.getByTestId('today-task-row').filter({ hasText: 'Overdue two' })).toBeVisible()

    const rescheduleBtn = page.getByTestId('reschedule-all-btn')
    await expect(rescheduleBtn).toBeVisible()
    await expect(rescheduleBtn).toHaveText('Reschedule both to today')
    await rescheduleBtn.click()

    await expect(page.getByTestId('reschedule-all-btn')).not.toBeVisible()
    await expect(page.getByTestId('today-task-row').filter({ hasText: 'Overdue one' })).toBeVisible()
    await expect(page.getByTestId('today-task-row').filter({ hasText: 'Overdue two' })).toBeVisible()
  })

  test('Up next rail lists a future-dated task, tasks-only', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks')
    const nextWeek = businessDatePlus(7)

    await page.request.post(`${API}/tasks`, { data: { content: 'Future thing', dueDate: nextWeek } })
    await page.reload()

    await expect(page.getByText('Nothing scheduled yet.')).not.toBeVisible()
    const upNextRow = page.getByTestId('upnext-row').filter({ hasText: 'Future thing' })
    await expect(upNextRow).toBeVisible()
    // Not grouped into Today/Overdue — it's a week out.
    await expect(page.getByTestId('today-task-row').filter({ hasText: 'Future thing' })).not.toBeVisible()
  })

  test('Lists right-rail card shows real per-list progress', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks')

    const list = await (await page.request.post(`${API}/task-lists`, { data: { name: 'Progress check' } })).json()
    const t1 = await (await page.request.post(`${API}/tasks`, { data: { content: 'One', listId: list.id } })).json()
    await page.request.post(`${API}/tasks`, { data: { content: 'Two', listId: list.id } })
    await page.request.post(`${API}/tasks`, { data: { content: 'Three', listId: list.id } })
    await page.request.post(`${API}/tasks/${t1.id}/complete`)
    await page.reload()

    const progressRow = page.getByTestId(`today-list-progress-${list.id}`)
    await expect(progressRow).toBeVisible()
    await expect(progressRow).toContainText('1/3')
  })

  test('Worth knowing card is absent when nothing is worth surfacing', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks')

    // A brand-new user has no tasks at all: no-due-date count, load
    // imbalance and evening-today count are all zero, so nothing qualifies.
    await expect(page.getByTestId('today-band')).toBeVisible()
    await expect(page.getByTestId('today-worth-knowing-card')).toHaveCount(0)
  })

  test('Worth knowing card surfaces a real finding when the data supports it', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks')

    await page.request.post(`${API}/tasks`, { data: { content: 'No date task one' } })
    await page.request.post(`${API}/tasks`, { data: { content: 'No date task two' } })
    await page.reload()

    const card = page.getByTestId('today-worth-knowing-card')
    await expect(card).toBeVisible()
    await expect(card).toContainText('2 tasks with no due date')
  })

  test('kebab menu: Edit details opens the task detail modal', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks')
    const task = await (
      await page.request.post(`${API}/tasks`, { data: { content: 'Kebab edit target', dueDate: businessToday() } })
    ).json()
    await page.reload()

    const row = page.locator(`[data-task-id="${task.id}"]`)
    await expect(row).toBeVisible()
    await row.getByTestId(`today-task-row-options-${task.id}`).click()
    await page.getByRole('menuitem', { name: 'Edit details' }).click()

    await expect(page.getByTestId('task-detail-modal')).toBeVisible()
    await expect(page.getByTestId('task-detail-name')).toHaveValue('Kebab edit target')
  })

  test('kebab menu: Reschedule moves the task off Today via the inline date picker', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks')
    const task = await (
      await page.request.post(`${API}/tasks`, {
        data: { content: 'Kebab reschedule target', dueDate: businessToday() },
      })
    ).json()
    await page.reload()

    const row = page.locator(`[data-task-id="${task.id}"]`)
    await expect(row).toBeVisible()
    await row.getByTestId(`today-task-row-options-${task.id}`).click()
    await page.getByRole('menuitem', { name: 'Reschedule' }).click()

    const dateInput = page.getByTestId(`today-task-row-due-input-${task.id}`)
    await expect(dateInput).toBeVisible()
    await dateInput.fill(businessDatePlus(5))
    await dateInput.press('Enter')

    // Moving the due date out of "today" drops the row from the Today
    // group and re-derives it into Up next instead — a real, visible effect.
    await expect(page.getByTestId('today-task-row').filter({ hasText: 'Kebab reschedule target' })).not.toBeVisible()
    await expect(page.getByTestId('upnext-row').filter({ hasText: 'Kebab reschedule target' })).toBeVisible()
  })

  test('kebab menu: Delete removes the row', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks')
    const task = await (
      await page.request.post(`${API}/tasks`, { data: { content: 'Kebab delete target', dueDate: businessToday() } })
    ).json()
    await page.reload()

    const row = page.locator(`[data-task-id="${task.id}"]`)
    await expect(row).toBeVisible()
    await row.getByTestId(`today-task-row-options-${task.id}`).click()
    await page.getByRole('menuitem', { name: 'Delete task' }).click()

    await expect(page.locator(`[data-task-id="${task.id}"]`)).toHaveCount(0)
  })

  test('sidebar shows the default Lists plus a fixed Unsorted item', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks')

    // Signup seeds four default lists (68-tasks-api.spec.ts).
    await expect(page.getByTestId('nav-tasks-today')).toBeVisible()
    await expect(page.getByTestId('nav-tasks-list-unsorted')).toBeVisible()
    await expect(page.locator('[data-testid^="nav-tasks-list-"]')).toHaveCount(5) // 4 lists + Unsorted
  })

  // Both nav items were "Coming in R10" disabled placeholders; FEAT-026
  // (docs/backlog/EP-07-tasks-depth/FEAT-026-tasks-upcoming-board.md) and
  // FEAT-027 (docs/backlog/EP-07-tasks-depth/FEAT-027-tasks-assigned-to-me.md)
  // enabled Upcoming and Assigned to me respectively — see
  // e2e/91-tasks-upcoming.spec.ts and e2e/92-tasks-assigned.spec.ts for each
  // page's own behaviour.
  test('Upcoming navigates to its page', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks')

    const upcoming = page.getByTestId('nav-tasks-upcoming')
    await expect(upcoming).not.toHaveAttribute('aria-disabled', 'true')
    await upcoming.click()
    await expect(page).toHaveURL(/\/tasks\/upcoming$/)
  })

  test('Assigned to me navigates to its page', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks')

    const assigned = page.getByTestId('nav-tasks-assigned')
    await expect(assigned).not.toHaveAttribute('aria-disabled', 'true')
    await assigned.click()
    await expect(page).toHaveURL(/\/tasks\/assigned$/)
  })

  test('BUG-013: an overdue row keeps its due-date badge legible when .task-meta wraps to its own row at ≤900px', async ({
    browser,
  }) => {
    // TaskRow.tsx now renders a `.task-meta` wrapper (FEAT-054,
    // docs/backlog/EP-07-tasks-depth/FEAT-054-tasks-today-design-adoption.md)
    // instead of 3 bare children, so it matches `.task:has(.task-meta)` —
    // including the ≤900px rule (src/styles/tasks.css) that gives
    // `.task-meta` (and everything inside it, including the due-date badge)
    // its own row below the title rather than competing with it for the
    // name track. This replaces the old regression check, which asserted
    // TaskRow had NO `.task-meta` and stayed side-by-side at narrow widths
    // (docs/backlog/EP-07-tasks-depth/BUG-013-task-row-grid-not-structurally-fixed.md)
    // — per FEAT-054's own note, that assertion becomes an equivalent
    // invariant check against the NEW two-row layout, not a deletion.
    const page = await newAppPage(browser, '/tasks')

    const taskRes = await page.request.post(`${API}/tasks`, {
      data: { content: 'A reasonably long overdue task name to check for a narrow-viewport squeeze', dueDate: businessDatePlus(-30) },
    })
    const task = await taskRes.json()
    await page.reload()

    const row = page.locator(`[data-task-id="${task.id}"]`)
    await expect(row).toBeVisible()

    for (const width of [700, 375]) {
      await page.setViewportSize({ width, height: 900 })
      const rowBox = await row.boundingBox()
      const titleBox = await row.locator('.task-title').boundingBox()
      // FEAT-054 product-owner review added a second `.task-when` (the plain
      // "Thu 14"/"Today" anchor column, alongside the contextual "3 days
      // late" one) — `.first()` keeps this test pinned to the contextual
      // badge it was always checking.
      const whenBox = await row.locator('.task-when').first().boundingBox()
      expect(rowBox).not.toBeNull()
      expect(titleBox).not.toBeNull()
      expect(whenBox).not.toBeNull()
      // Both stay legible and indented past the 20px checkbox track...
      expect(titleBox!.width).toBeGreaterThan(80)
      expect(whenBox!.width).toBeGreaterThan(20)
      expect(titleBox!.x).toBeGreaterThan(rowBox!.x + 20)
      // ...but now stack into two rows (title, then the due badge inside
      // .task-meta below it) instead of sitting side by side on one row —
      // the inverse of what the old bare-3-child layout did.
      expect(whenBox!.y).toBeGreaterThan(titleBox!.y)
      // And the badge never renders past the row's own right edge.
      expect(whenBox!.x + whenBox!.width).toBeLessThanOrEqual(rowBox!.x + rowBox!.width + 1)
    }
  })
})
