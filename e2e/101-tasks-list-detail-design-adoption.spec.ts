/**
 * FEAT-062 — Tasks: List detail page exact design adoption
 * (docs/backlog/EP-07-tasks-depth/FEAT-062-tasks-list-detail-design-adoption.md).
 *
 * Covers: the List-view composer creates a task pre-scoped to the current
 * list and it appears in "Open" immediately; the band's Recurring/Linked to
 * Wallet stats compute real counts (with the "of N still open" denominator);
 * a row's wallet chip renders the real resolved text for both `recurring:`
 * and `goal:` refs; the assignee control appears and works in List view; the
 * "More" menu opens/closes (outside-click, Escape) and Delete actually
 * removes the task with an undo toast; the page-sub shows the real open
 * count.
 */

import { test, expect } from '@playwright/test'
import type { Browser } from '@playwright/test'
import { newAppPage, businessDatePlus } from './helpers'

const API = '/api'

async function createGroupOfTwo(browser: Browser) {
  const ownerCtx = await browser.newContext()
  const memberCtx = await browser.newContext()
  const ownerPage = await ownerCtx.newPage()
  const memberPage = await memberCtx.newPage()

  const ownerName = `owner_f62_${Date.now()}`
  const memberName = `mbr_f62_${Date.now()}`

  await ownerPage.request.post(`${API}/auth/signup`, { data: { username: ownerName, password: 'test-password' } })
  await memberPage.request.post(`${API}/auth/signup`, { data: { username: memberName, password: 'test-password' } })

  const groupRes = await ownerPage.request.post(`${API}/groups`, { data: { name: 'FEAT-062 Household' } })
  const group = await groupRes.json()
  await ownerPage.request.post(`${API}/groups/${group.id}/invites`, { data: { username: memberName } })

  const invitesRes = await memberPage.request.get(`${API}/invites`)
  const invites = await invitesRes.json()
  const invite = invites.find((i: { group_id: string }) => i.group_id === group.id)
  await memberPage.request.post(`${API}/invites/${invite.id}/accept`)

  return { ownerPage, memberPage, ownerName, memberName, group, ownerCtx, memberCtx }
}

test.describe('101 — Tasks list detail design adoption (FEAT-062)', () => {
  test('page-sub shows the real open count, dropping the static description', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks')

    const created = await page.request.post(`${API}/task-lists`, { data: { name: 'Errands', color: '#3b82f6' } })
    const list = await created.json()
    await page.request.post(`${API}/tasks`, { data: { content: 'Pick up dry cleaning', listId: list.id } })
    await page.request.post(`${API}/tasks`, { data: { content: 'Buy stamps', listId: list.id } })

    await page.goto(`/tasks/lists/${list.id}`)
    await expect(page.getByTestId('list-detail-sub')).toHaveText('2 open')
  })

  test('composer in List view creates a task pre-scoped to the current list, appearing in Open immediately', async ({
    browser,
  }) => {
    const page = await newAppPage(browser, '/tasks')

    const created = await page.request.post(`${API}/task-lists`, { data: { name: 'Groceries', color: '#10b981' } })
    const list = await created.json()

    await page.goto(`/tasks/lists/${list.id}`)
    await page.getByTestId('list-view-list').click()

    const input = page.getByTestId('today-composer-input')
    await input.fill('Buy milk')
    await input.press('Enter')

    await expect(page.getByText('Buy milk')).toBeVisible()
    await expect(page.getByTestId('list-detail-open-header')).toContainText('1')
    await expect(page.getByTestId('list-detail-sub')).toHaveText('1 open')

    // Pre-scoped to this list, not Unsorted — persisted server-side.
    const tasksRes = await page.request.get(`${API}/tasks?view=list&list=${list.id}`)
    const tasks = await tasksRes.json()
    expect(tasks.some((t: { content: string }) => t.content === 'Buy milk')).toBe(true)
  })

  test('composer in List view falls back to the Unsorted pseudo-list (listId null)', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks/lists/unsorted')
    await page.getByTestId('list-view-list').click()

    const input = page.getByTestId('today-composer-input')
    await input.fill('Water the plants')
    await input.press('Enter')

    await expect(page.getByText('Water the plants')).toBeVisible()
  })

  test('band stats: Recurring and Linked to Wallet count only openTasks, with "of the N still open"', async ({
    browser,
  }) => {
    const page = await newAppPage(browser, '/tasks')

    const created = await page.request.post(`${API}/task-lists`, { data: { name: 'Bills', color: '#f97316' } })
    const list = await created.json()

    const accountRes = await page.request.post(`${API}/accounts`, {
      data: { name: 'Main', type: 'bank', openingBalance: 0 },
    })
    const account = await accountRes.json()
    const billRes = await page.request.post(`${API}/recurring-transactions`, {
      data: { accountId: account.id, amount: 50, merchant: 'Electric', frequency: 'monthly', nextDueDate: businessDatePlus(3) },
    })
    const bill = await billRes.json()

    const recurringRes = await page.request.post(`${API}/tasks`, {
      data: { content: 'Water the lawn', listId: list.id, recurrence: 'daily' },
    })
    const recurringTask = await recurringRes.json()
    expect(recurringTask.recurrence).toBe('daily')

    const walletTaskRes = await page.request.post(`${API}/tasks`, {
      data: { content: 'Pay electric bill', listId: list.id, walletRef: `recurring:${bill.id}` },
    })
    const walletTask = await walletTaskRes.json()
    expect(walletTask.wallet_ref ?? walletTask.walletRef).toBeTruthy()

    await page.request.post(`${API}/tasks`, { data: { content: 'Plain open task', listId: list.id } })

    // A completed task must NOT count toward either band stat or its
    // denominator — only openTasks does. (A plain, non-recurring task is
    // used here — completing a RECURRING one spawns its next open instance,
    // which would change the open count out from under this assertion.)
    const doneRes = await page.request.post(`${API}/tasks`, {
      data: { content: 'Already done, plain', listId: list.id },
    })
    const doneTask = await doneRes.json()
    await page.request.post(`${API}/tasks/${doneTask.id}/complete`, { data: {} })

    await page.goto(`/tasks/lists/${list.id}`)
    await page.getByTestId('list-view-list').click()

    // 3 open tasks total: Water the lawn (recurring), Pay electric bill (wallet), Plain open task.
    await expect(page.getByTestId('list-detail-stat-recurring')).toContainText('Recurring')
    await expect(page.getByTestId('list-detail-stat-recurring')).toContainText('1')
    await expect(page.getByTestId('list-detail-stat-recurring')).toContainText('of the 3 still open')

    await expect(page.getByTestId('list-detail-stat-wallet')).toContainText('Linked to Wallet')
    await expect(page.getByTestId('list-detail-stat-wallet')).toContainText('1')
    await expect(page.getByTestId('list-detail-stat-wallet')).toContainText('of the 3 still open')

    // No fabricated "Members" stat.
    await expect(page.getByTestId('list-detail-band')).not.toContainText('Members')
  })

  test('a row shows the real resolved wallet chip for a recurring: ref', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks')

    const created = await page.request.post(`${API}/task-lists`, { data: { name: 'Bills2', color: '#ef4444' } })
    const list = await created.json()

    const accountRes = await page.request.post(`${API}/accounts`, {
      data: { name: 'Main', type: 'bank', openingBalance: 0 },
    })
    const account = await accountRes.json()
    const tomorrow = businessDatePlus(1)
    const billRes = await page.request.post(`${API}/recurring-transactions`, {
      data: { accountId: account.id, amount: 89.9, merchant: 'Internet', frequency: 'monthly', nextDueDate: tomorrow },
    })
    const bill = await billRes.json()
    await page.request.post(`${API}/tasks`, {
      data: { content: 'Pay the internet bill', listId: list.id, walletRef: `recurring:${bill.id}` },
    })

    await page.goto(`/tasks/lists/${list.id}`)
    await page.getByTestId('list-view-list').click()

    const row = page.locator('[data-task-id]').filter({ hasText: 'Pay the internet bill' })
    const chip = row.getByTestId('all-tasks-row-wallet-chip')
    await expect(chip).toBeVisible()
    await expect(chip).toContainText('Wallet ·')
    await expect(chip).toContainText(/RM\s*89\.90/)
    await expect(chip).toContainText('due tomorrow')
  })

  test('a row shows the real resolved wallet chip for a goal: ref', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks')

    const created = await page.request.post(`${API}/task-lists`, { data: { name: 'Savings list', color: '#6366f1' } })
    const list = await created.json()

    const accountRes = await page.request.post(`${API}/accounts`, {
      data: { name: 'Savings', type: 'bank', openingBalance: 500 },
    })
    const account = await accountRes.json()
    const goalRes = await page.request.post(`${API}/goals`, {
      data: { name: 'New laptop', targetAmount: 1000, accountId: account.id },
    })
    const goal = await goalRes.json()
    await page.request.post(`${API}/tasks`, {
      data: { content: 'Save for a laptop', listId: list.id, walletRef: `goal:${goal.id}` },
    })

    await page.goto(`/tasks/lists/${list.id}`)
    await page.getByTestId('list-view-list').click()

    const row = page.locator('[data-task-id]').filter({ hasText: 'Save for a laptop' })
    const chip = row.getByTestId('all-tasks-row-wallet-chip')
    await expect(chip).toBeVisible()
    await expect(chip).toContainText('Wallet goal · 50% funded')
  })

  test('the assignee control appears in List view and persists a real assignment', async ({ browser }) => {
    const { ownerPage, memberName, ownerCtx, memberCtx } = await createGroupOfTwo(browser)

    const created = await ownerPage.request.post(`${API}/task-lists`, { data: { name: 'Shared chores', color: '#14b8a6' } })
    const list = await created.json()
    const taskRes = await ownerPage.request.post(`${API}/tasks`, { data: { content: 'Take out recycling', listId: list.id } })
    const task = await taskRes.json()

    await ownerPage.goto(`/tasks/lists/${list.id}`)
    await ownerPage.getByTestId('list-view-list').click()

    const assigneeSelect = ownerPage.getByTestId(`task-row-assignee-${task.id}`)
    await expect(assigneeSelect).toBeVisible()
    await assigneeSelect.selectOption({ label: memberName })

    const verifyRes = await ownerPage.request.get(`${API}/tasks?view=list&list=${list.id}`)
    const tasks = await verifyRes.json()
    const updated = tasks.find((t: { id: string }) => t.id === task.id)
    expect(updated.assignee_id).toBeTruthy()

    await ownerCtx.close()
    await memberCtx.close()
  })

  test('the "More" menu opens/closes (outside click, Escape) and Delete removes the task with an undo toast', async ({
    browser,
  }) => {
    const page = await newAppPage(browser, '/tasks')

    const created = await page.request.post(`${API}/task-lists`, { data: { name: 'Temp list', color: '#8b5cf6' } })
    const list = await created.json()
    const taskRes = await page.request.post(`${API}/tasks`, { data: { content: 'Disposable task', listId: list.id } })
    const task = await taskRes.json()

    await page.goto(`/tasks/lists/${list.id}`)
    await page.getByTestId('list-view-list').click()
    await expect(page.getByText('Disposable task')).toBeVisible()

    const moreBtn = page.getByTestId(`task-row-more-${task.id}`)
    const menu = page.getByTestId(`task-row-more-menu-${task.id}`)

    // Opens.
    await moreBtn.click()
    await expect(menu).toBeVisible()

    // Escape closes it.
    await page.keyboard.press('Escape')
    await expect(menu).not.toBeVisible()

    // Outside click closes it too.
    await moreBtn.click()
    await expect(menu).toBeVisible()
    await page.getByTestId('list-detail-title').click()
    await expect(menu).not.toBeVisible()

    // Delete — undo-toast policy (CLAUDE.md §6), not a confirm modal.
    await moreBtn.click()
    await menu.getByRole('menuitem', { name: 'Delete' }).click()

    await expect(page.getByText('Disposable task')).not.toBeVisible()
    await expect(page.getByText('Task deleted')).toBeVisible()
    await expect(page.getByTestId('list-detail-open-empty')).toBeVisible()

    const afterDeleteRes = await page.request.get(`${API}/tasks?view=list&list=${list.id}`)
    expect((await afterDeleteRes.json()).length).toBe(0)

    // Undo restores it.
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect(page.getByText('Disposable task')).toBeVisible()

    const afterUndoRes = await page.request.get(`${API}/tasks?view=list&list=${list.id}`)
    expect((await afterUndoRes.json()).length).toBe(1)
  })

  // ── FEAT-062 review-fix regression coverage ────────────────────────────

  test('undo restores a composer-created task\'s list, priority, assignee and due date (review fix #1)', async ({
    browser,
  }) => {
    const { ownerPage, memberName, ownerCtx, memberCtx } = await createGroupOfTwo(browser)

    const created = await ownerPage.request.post(`${API}/task-lists`, { data: { name: 'Projects', color: '#3b82f6' } })
    const list = await created.json()

    await ownerPage.goto(`/tasks/lists/${list.id}`)
    await ownerPage.getByTestId('list-view-list').click()

    const input = ownerPage.getByTestId('today-composer-input')
    await input.fill(`Ship the report !high @${memberName} tomorrow`)
    await input.press('Enter')
    await expect(ownerPage.getByText('Ship the report')).toBeVisible()

    const beforeRes = await ownerPage.request.get(`${API}/tasks?view=list&list=${list.id}`)
    const before = (await beforeRes.json()).find((t: { content: string }) => t.content.includes('Ship the report'))
    expect(before.priority).toBe('high')
    expect(before.assignee_id).toBeTruthy()
    expect(before.due_date).toBeTruthy()

    const moreBtn = ownerPage.getByTestId(`task-row-more-${before.id}`)
    await moreBtn.click()
    await ownerPage.getByTestId(`task-row-more-menu-${before.id}`).getByRole('menuitem', { name: 'Delete' }).click()
    await expect(ownerPage.getByText('Ship the report')).not.toBeVisible()

    await ownerPage.getByRole('button', { name: 'Undo' }).click()
    await expect(ownerPage.getByText('Ship the report')).toBeVisible()

    const afterRes = await ownerPage.request.get(`${API}/tasks?view=list&list=${list.id}`)
    const after = (await afterRes.json()).find((t: { content: string }) => t.content.includes('Ship the report'))
    expect(after.list_id).toBe(list.id)
    expect(after.priority).toBe('high')
    expect(after.assignee_id).toBe(before.assignee_id)
    expect(after.due_date).toBe(before.due_date)

    await ownerCtx.close()
    await memberCtx.close()
  })

  test('deleting a parent removes its subtask rows too, not just the parent (review fix #2)', async ({ browser }) => {
    const page = await newAppPage(browser, '/tasks')

    const created = await page.request.post(`${API}/task-lists`, { data: { name: 'Cascade list', color: '#eab308' } })
    const list = await created.json()
    const parentRes = await page.request.post(`${API}/tasks`, { data: { content: 'Plan the trip', listId: list.id } })
    const parent = await parentRes.json()
    await page.request.post(`${API}/tasks`, {
      data: { content: 'Book flights', listId: list.id, parentId: parent.id },
    })

    await page.goto(`/tasks/lists/${list.id}`)
    await page.getByTestId('list-view-list').click()
    await expect(page.getByText('Plan the trip')).toBeVisible()
    await expect(page.getByText('Book flights')).toBeVisible()

    const moreBtn = page.getByTestId(`task-row-more-${parent.id}`)
    await moreBtn.click()
    await page.getByTestId(`task-row-more-menu-${parent.id}`).getByRole('menuitem', { name: 'Delete' }).click()

    await expect(page.getByText('Plan the trip')).not.toBeVisible()
    await expect(page.getByText('Book flights')).not.toBeVisible()
    await expect(page.getByTestId('list-detail-open-empty')).toBeVisible()

    const afterRes = await page.request.get(`${API}/tasks?view=list&list=${list.id}`)
    expect((await afterRes.json()).length).toBe(0)
  })

  test('deleting a task the viewer does not own — in a list shared to their group — actually removes it (review fix #3)', async ({
    browser,
  }) => {
    const { ownerPage, memberPage, group, ownerCtx, memberCtx } = await createGroupOfTwo(browser)

    const created = await ownerPage.request.post(`${API}/task-lists`, { data: { name: 'Shared bills', color: '#059669' } })
    const list = await created.json()
    await ownerPage.request.post(`${API}/task-lists/${list.id}/shares`, { data: { groupId: group.id, canWrite: true } })

    const taskRes = await ownerPage.request.post(`${API}/tasks`, {
      data: { content: 'Owner task in shared list', listId: list.id },
    })
    const task = await taskRes.json()

    // The member never owns this task (user_id is the owner's) and it was
    // never loaded into the member's outliner store — exactly the case the
    // old store-backed `deleteTask` silently no-oped on.
    await memberPage.goto(`/tasks/lists/${list.id}`)
    await memberPage.getByTestId('list-view-list').click()
    await expect(memberPage.getByText('Owner task in shared list')).toBeVisible()

    const moreBtn = memberPage.getByTestId(`task-row-more-${task.id}`)
    await moreBtn.click()
    await memberPage.getByTestId(`task-row-more-menu-${task.id}`).getByRole('menuitem', { name: 'Delete' }).click()
    await expect(memberPage.getByText('Owner task in shared list')).not.toBeVisible()

    // Confirms the server actually deleted it, not just the member's local UI.
    const afterRes = await ownerPage.request.get(`${API}/tasks?view=list&list=${list.id}`)
    expect((await afterRes.json()).length).toBe(0)

    await ownerCtx.close()
    await memberCtx.close()
  })

  test('an explicit #tag in the composer lands the task in that list, not the page\'s current list (review fix #4)', async ({
    browser,
  }) => {
    const page = await newAppPage(browser, '/tasks')

    const createdA = await page.request.post(`${API}/task-lists`, { data: { name: 'ListA', color: '#3b82f6' } })
    const listA = await createdA.json()
    const createdB = await page.request.post(`${API}/task-lists`, { data: { name: 'ListB', color: '#ef4444' } })
    const listB = await createdB.json()

    await page.goto(`/tasks/lists/${listA.id}`)
    await page.getByTestId('list-view-list').click()

    const input = page.getByTestId('today-composer-input')
    await input.fill('Buy paint #ListB')
    await input.press('Enter')

    // Confirms where it actually landed — also the sync point for the
    // in-flight create+PATCH below, since the empty "Open" state alone never
    // changes either way and wouldn't wait for them to finish.
    await expect(page.getByText('Added to ListB.')).toBeVisible()
    // Not on ListA's page — it was filed under ListB instead, per the explicit tag.
    await expect(page.getByTestId('list-detail-open-empty')).toBeVisible()

    const tasksRes = await page.request.get(`${API}/tasks?view=list&list=${listB.id}`)
    const tasks = await tasksRes.json()
    expect(tasks.some((t: { content: string }) => t.content === 'Buy paint')).toBe(true)
  })

  test('the "New task" modal\'s List dropdown defaults to the current list, and an explicit pick is honoured (review fix #4)', async ({
    browser,
  }) => {
    const page = await newAppPage(browser, '/tasks')

    const createdA = await page.request.post(`${API}/task-lists`, { data: { name: 'Current list', color: '#8b5cf6' } })
    const listA = await createdA.json()
    const createdB = await page.request.post(`${API}/task-lists`, { data: { name: 'Other list', color: '#f97316' } })
    const listB = await createdB.json()

    await page.goto(`/tasks/lists/${listA.id}`)
    await page.getByTestId('list-view-list').click()

    await page.getByTestId('today-composer-input').fill('Something to triage')
    await page.getByRole('button', { name: 'Task' }).click()

    // The dropdown's default is honest about where a blank-looking submit lands.
    await expect(page.getByTestId('task-form-list')).toHaveValue(listA.id)

    // Explicitly picking the other list is honoured, not discarded.
    await page.getByTestId('task-form-list').selectOption({ label: 'Other list' })
    await page.getByTestId('task-form-submit').click()
    // The modal's own `handleSubmit` only closes it after `onSubmit` (which
    // includes the follow-up PATCH setting listId) resolves — waiting for it
    // to disappear avoids racing that in-flight request with the GET below.
    await expect(page.getByTestId('task-form-modal')).not.toBeVisible()

    const tasksRes = await page.request.get(`${API}/tasks?view=list&list=${listB.id}`)
    const tasks = await tasksRes.json()
    expect(tasks.some((t: { content: string }) => t.content === 'Something to triage')).toBe(true)
  })

  test('the "Linked to Wallet" band stat does not count a dangling walletRef that fails to resolve (review fix #5)', async ({
    browser,
  }) => {
    const page = await newAppPage(browser, '/tasks')

    const created = await page.request.post(`${API}/task-lists`, { data: { name: 'Dangling refs', color: '#ec4899' } })
    const list = await created.json()

    const accountRes = await page.request.post(`${API}/accounts`, {
      data: { name: 'Main', type: 'bank', openingBalance: 0 },
    })
    const account = await accountRes.json()
    const billRes = await page.request.post(`${API}/recurring-transactions`, {
      data: { accountId: account.id, amount: 20, merchant: 'Gym', frequency: 'monthly', nextDueDate: businessDatePlus(2) },
    })
    const bill = await billRes.json()
    await page.request.post(`${API}/tasks`, {
      data: { content: 'Pay gym membership', listId: list.id, walletRef: `recurring:${bill.id}` },
    })
    // Delete the bill out from under the task — its walletRef now dangles.
    await page.request.delete(`${API}/recurring-transactions/${bill.id}`)

    await page.goto(`/tasks/lists/${list.id}`)
    await page.getByTestId('list-view-list').click()
    await expect(page.getByText('Pay gym membership')).toBeVisible()

    const row = page.locator('[data-task-id]').filter({ hasText: 'Pay gym membership' })
    await expect(row.getByTestId('all-tasks-row-wallet-chip')).not.toBeVisible()
    await expect(page.getByTestId('list-detail-stat-wallet')).toContainText('0')
  })

  test('an empty list shows honest band-stat copy instead of "0 of the 0 still open" (review fix #10a)', async ({
    browser,
  }) => {
    const page = await newAppPage(browser, '/tasks')
    const created = await page.request.post(`${API}/task-lists`, { data: { name: 'Empty list', color: '#6b7280' } })
    const list = await created.json()

    await page.goto(`/tasks/lists/${list.id}`)
    await page.getByTestId('list-view-list').click()

    await expect(page.getByTestId('list-detail-stat-recurring')).toContainText('No tasks open')
    await expect(page.getByTestId('list-detail-stat-recurring')).not.toContainText('of the 0')
    await expect(page.getByTestId('list-detail-stat-wallet')).toContainText('No tasks open')
  })

  test('deleting a task from "Done this week" (not just Open) removes it with an undo toast (review fix #11)', async ({
    browser,
  }) => {
    const page = await newAppPage(browser, '/tasks')

    const created = await page.request.post(`${API}/task-lists`, { data: { name: 'Done list', color: '#10b981' } })
    const list = await created.json()
    const taskRes = await page.request.post(`${API}/tasks`, { data: { content: 'Finished chore', listId: list.id } })
    const task = await taskRes.json()
    await page.request.post(`${API}/tasks/${task.id}/complete`, { data: {} })

    await page.goto(`/tasks/lists/${list.id}`)
    await page.getByTestId('list-view-list').click()
    await expect(page.getByTestId('list-detail-done-toggle')).toBeVisible()
    await expect(page.getByText('Finished chore')).toBeVisible()

    const moreBtn = page.getByTestId(`task-row-more-${task.id}`)
    await moreBtn.click()
    await page.getByTestId(`task-row-more-menu-${task.id}`).getByRole('menuitem', { name: 'Delete' }).click()

    await expect(page.getByText('Finished chore')).not.toBeVisible()
    await expect(page.getByText('Task deleted')).toBeVisible()

    await page.getByRole('button', { name: 'Undo' }).click()
    await expect(page.getByText('Finished chore')).toBeVisible()
  })
})
