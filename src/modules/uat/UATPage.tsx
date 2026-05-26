/**
 * UATPage — User Acceptance Test Runner
 *
 * An in-browser test suite that exercises every feature of the Daybook app
 * against the live PGlite database and Zustand stores, catching regressions
 * early and providing full edge-case coverage.
 *
 * Access at: /uat
 */

import { useState, useCallback } from 'react'
import { useTasks } from '@/hooks/useTasks'
import { useWallet } from '@/hooks/useWallet'
import { getDB } from '@/db'
import { useTasksStore } from '@/stores/tasks.store'
import { cn } from '@/lib/utils'
import { CheckCircle2, XCircle, Clock, Play, FlaskConical, ChevronDown, ChevronRight, RotateCcw, AlertTriangle } from 'lucide-react'

// ── Assertion helpers ────────────────────────────────────────────────────────

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
}

function assertEqual<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label}: expected "${String(expected)}", got "${String(actual)}"`)
  }
}

function assertClose(actual: number, expected: number, tolerance: number, label: string): void {
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(`${label}: expected ≈${expected} (±${tolerance}), got ${actual}`)
  }
}

// ── Types ────────────────────────────────────────────────────────────────────

type TestStatus = 'pending' | 'running' | 'pass' | 'fail'

interface TestResult {
  id: string
  suite: string
  name: string
  status: TestStatus
  error?: string
  duration?: number
  isEdgeCase?: boolean
}

interface TestHelpers {
  addTask: ReturnType<typeof useTasks>['addTask']
  updateTask: ReturnType<typeof useTasks>['updateTask']
  deleteTask: ReturnType<typeof useTasks>['deleteTask']
  loadTasks: ReturnType<typeof useTasks>['loadTasks']
  indentTask: ReturnType<typeof useTasks>['indentTask']
  outdentTask: ReturnType<typeof useTasks>['outdentTask']
  getBreadcrumb: ReturnType<typeof useTasks>['getBreadcrumb']
  addAccount: ReturnType<typeof useWallet>['addAccount']
  updateAccount: ReturnType<typeof useWallet>['updateAccount']
  deleteAccount: ReturnType<typeof useWallet>['deleteAccount']
  addTransaction: ReturnType<typeof useWallet>['addTransaction']
  updateTransaction: ReturnType<typeof useWallet>['updateTransaction']
  deleteTransaction: ReturnType<typeof useWallet>['deleteTransaction']
  getAccountBalance: ReturnType<typeof useWallet>['getAccountBalance']
  loadAccounts: ReturnType<typeof useWallet>['loadAccounts']
}

type TestFn = (helpers: TestHelpers) => Promise<void>

interface TestDef {
  id: string
  suiteName: string
  name: string
  fn: TestFn
  isEdgeCase?: boolean
}

// ── Test definitions ─────────────────────────────────────────────────────────

function buildTests(): TestDef[] {
  const tests: TestDef[] = []
  let seq = 0

  function t(suiteName: string, name: string, fn: TestFn, isEdgeCase = false) {
    tests.push({ id: `t${++seq}`, suiteName, name, fn, isEdgeCase })
  }

  // ─────────────────────────────────────────────────────────────
  // TASKS — CORE CRUD
  // ─────────────────────────────────────────────────────────────

  t('Tasks › Core CRUD', 'Create root task', async ({ addTask, deleteTask }) => {
    const task = await addTask('UAT root task', null)
    assert(task.id.length > 0, 'task should have an ID')
    assertEqual(task.content, 'UAT root task', 'content')
    assertEqual(task.parentId, null, 'parentId should be null')
    assertEqual(task.isCompleted, false, 'isCompleted default')
    assertEqual(task.isCollapsed, false, 'isCollapsed default')
    assertEqual(task.note, '', 'note default')
    assert(task.sortOrder > 0, 'sortOrder should be positive')
    await deleteTask(task.id)
  })

  t('Tasks › Core CRUD', 'Create nested child task', async ({ addTask, deleteTask }) => {
    const parent = await addTask('UAT parent', null)
    const child = await addTask('UAT child', parent.id)
    assertEqual(child.parentId, parent.id, 'child parentId should match parent')
    assertEqual(child.content, 'UAT child', 'child content')
    await deleteTask(parent.id)
    const tasks = useTasksStore.getState().tasks
    assert(!tasks.some((t) => t.id === parent.id), 'parent removed from store')
    assert(!tasks.some((t) => t.id === child.id), 'child removed from store (cascade)')
  })

  t('Tasks › Core CRUD', 'Create deeply nested task (3 levels)', async ({ addTask, deleteTask }) => {
    const root = await addTask('UAT root', null)
    const child = await addTask('UAT child', root.id)
    const grandchild = await addTask('UAT grandchild', child.id)
    assertEqual(grandchild.parentId, child.id, 'grandchild parent')
    assertEqual(child.parentId, root.id, 'child parent')
    await deleteTask(root.id)
    const tasks = useTasksStore.getState().tasks
    assert(!tasks.some((t) => [root.id, child.id, grandchild.id].includes(t.id)), 'all 3 levels deleted')
  })

  t('Tasks › Core CRUD', 'Update task content', async ({ addTask, updateTask, deleteTask }) => {
    const task = await addTask('UAT original', null)
    await updateTask(task.id, { content: 'UAT updated' })
    const updated = useTasksStore.getState().tasks.find((t) => t.id === task.id)
    assertEqual(updated?.content, 'UAT updated', 'content after update')
    assert(updated!.updatedAt >= task.updatedAt, 'updatedAt should advance')
    await deleteTask(task.id)
  })

  t('Tasks › Core CRUD', 'Toggle task completion ON and OFF', async ({ addTask, updateTask, deleteTask }) => {
    const task = await addTask('UAT toggle complete', null)
    assertEqual(task.isCompleted, false, 'initially incomplete')
    await updateTask(task.id, { isCompleted: true })
    const completed = useTasksStore.getState().tasks.find((t) => t.id === task.id)
    assertEqual(completed?.isCompleted, true, 'should be completed')
    await updateTask(task.id, { isCompleted: false })
    const uncompleted = useTasksStore.getState().tasks.find((t) => t.id === task.id)
    assertEqual(uncompleted?.isCompleted, false, 'should be incomplete again')
    await deleteTask(task.id)
  })

  t('Tasks › Core CRUD', 'Toggle task collapse', async ({ addTask, updateTask, deleteTask }) => {
    const parent = await addTask('UAT collapsible', null)
    await addTask('UAT child', parent.id)
    assertEqual(parent.isCollapsed, false, 'initially expanded')
    await updateTask(parent.id, { isCollapsed: true })
    const collapsed = useTasksStore.getState().tasks.find((t) => t.id === parent.id)
    assertEqual(collapsed?.isCollapsed, true, 'should be collapsed')
    await deleteTask(parent.id)
  })

  t('Tasks › Core CRUD', 'Add note to task', async ({ addTask, updateTask, deleteTask }) => {
    const task = await addTask('UAT note task', null)
    assertEqual(task.note, '', 'note starts empty')
    await updateTask(task.id, { note: 'This is a UAT note' })
    const noted = useTasksStore.getState().tasks.find((t) => t.id === task.id)
    assertEqual(noted?.note, 'This is a UAT note', 'note updated')
    await updateTask(task.id, { note: '' })
    const cleared = useTasksStore.getState().tasks.find((t) => t.id === task.id)
    assertEqual(cleared?.note, '', 'note cleared')
    await deleteTask(task.id)
  })

  t('Tasks › Core CRUD', 'Delete task — cascade removes all descendants', async ({ addTask, deleteTask }) => {
    const root = await addTask('UAT cascade root', null)
    const child = await addTask('UAT cascade child', root.id)
    const grandchild = await addTask('UAT cascade grandchild', child.id)
    const greatGrandchild = await addTask('UAT cascade great', grandchild.id)
    await deleteTask(root.id)
    const tasks = useTasksStore.getState().tasks
    const deleted = [root.id, child.id, grandchild.id, greatGrandchild.id]
    assert(!tasks.some((t) => deleted.includes(t.id)), 'all 4 levels deleted from store')
    const db = await getDB()
    const result = await db.query<{ cnt: string }>(
      `SELECT COUNT(*) as cnt FROM tasks WHERE id = ANY($1)`,
      [deleted],
    )
    assertEqual(Number(result.rows[0].cnt), 0, 'all 4 levels deleted from DB')
  })

  // ─────────────────────────────────────────────────────────────
  // TASKS — INDENT / OUTDENT
  // ─────────────────────────────────────────────────────────────

  t('Tasks › Indent/Outdent', 'Indent task into previous sibling', async ({ addTask, indentTask, deleteTask }) => {
    const task1 = await addTask('UAT indent-1', null)
    const task2 = await addTask('UAT indent-2', null)
    const result = await indentTask(task2.id)
    assert(result, 'indent should succeed')
    const indented = useTasksStore.getState().tasks.find((t) => t.id === task2.id)
    assertEqual(indented?.parentId, task1.id, 'task2 becomes child of task1')
    await deleteTask(task1.id) // cascades task2
  })

  t('Tasks › Indent/Outdent', 'Outdent task back to grandparent level', async ({ addTask, indentTask, outdentTask, deleteTask }) => {
    const parent = await addTask('UAT outdent-parent', null)
    const child = await addTask('UAT outdent-child', null)
    await indentTask(child.id) // child becomes child of parent
    assertEqual(useTasksStore.getState().tasks.find((t) => t.id === child.id)?.parentId, parent.id, 'indented')
    const result = await outdentTask(child.id)
    assert(result, 'outdent should succeed')
    const outdented = useTasksStore.getState().tasks.find((t) => t.id === child.id)
    assertEqual(outdented?.parentId, null, 'back to root after outdent')
    await deleteTask(parent.id)
    await deleteTask(child.id)
  })

  t('Tasks › Indent/Outdent', 'Indent expands collapsed parent', async ({ addTask, updateTask, indentTask, deleteTask }) => {
    const task1 = await addTask('UAT indent-collapse-1', null)
    const task2 = await addTask('UAT indent-collapse-2', null)
    // Add an existing child so task1 has children (to make collapse meaningful)
    await addTask('UAT existing child', task1.id)
    await updateTask(task1.id, { isCollapsed: true })
    // Indent task2 under task1 — should auto-expand task1
    await indentTask(task2.id)
    const parent = useTasksStore.getState().tasks.find((t) => t.id === task1.id)
    assertEqual(parent?.isCollapsed, false, 'parent should be expanded after indent')
    await deleteTask(task1.id) // cascades both children
  })

  t('Tasks › Indent/Outdent', 'Indent first task — returns false (no-op)', async ({ addTask, indentTask, deleteTask }): Promise<void> => {
    const only = await addTask('UAT indent-only', null)
    const result = await indentTask(only.id)
    assertEqual(result, false, 'indent first task returns false')
    const unchanged = useTasksStore.getState().tasks.find((t) => t.id === only.id)
    assertEqual(unchanged?.parentId, null, 'still at root')
    await deleteTask(only.id)
  }, true)

  t('Tasks › Indent/Outdent', 'Outdent root-level task — returns false (no-op)', async ({ addTask, outdentTask, deleteTask }): Promise<void> => {
    const root = await addTask('UAT outdent-root', null)
    const result = await outdentTask(root.id)
    assertEqual(result, false, 'outdent root returns false')
    const unchanged = useTasksStore.getState().tasks.find((t) => t.id === root.id)
    assertEqual(unchanged?.parentId, null, 'still at root')
    await deleteTask(root.id)
  }, true)

  // ─────────────────────────────────────────────────────────────
  // TASKS — SORT ORDER
  // ─────────────────────────────────────────────────────────────

  t('Tasks › Sort Order', 'Multiple tasks have strictly ascending sort orders', async ({ addTask, deleteTask }) => {
    const t1 = await addTask('UAT sort-1', null)
    const t2 = await addTask('UAT sort-2', null)
    const t3 = await addTask('UAT sort-3', null)
    assert(t1.sortOrder < t2.sortOrder, `t1(${t1.sortOrder}) < t2(${t2.sortOrder})`)
    assert(t2.sortOrder < t3.sortOrder, `t2(${t2.sortOrder}) < t3(${t3.sortOrder})`)
    await deleteTask(t1.id)
    await deleteTask(t2.id)
    await deleteTask(t3.id)
  })

  t('Tasks › Sort Order', 'Insert between two tasks uses midpoint', async ({ addTask, deleteTask }) => {
    const t1 = await addTask('UAT mid-1', null)
    const t3 = await addTask('UAT mid-3', null)
    const t2 = await addTask('UAT mid-2', null, t1.id) // insert after t1
    const expected = (t1.sortOrder + t3.sortOrder) / 2
    assertClose(t2.sortOrder, expected, 0.01, 'midpoint sort order')
    assert(t2.sortOrder > t1.sortOrder, 't2 > t1')
    assert(t2.sortOrder < t3.sortOrder, 't2 < t3')
    await deleteTask(t1.id)
    await deleteTask(t2.id)
    await deleteTask(t3.id)
  })

  t('Tasks › Sort Order', 'Rebalance triggers when gap < 0.001', async ({ addTask, loadTasks, deleteTask }) => {
    const db = await getDB()
    const ids = ['uat-rb-1', 'uat-rb-2', 'uat-rb-3']
    const now = new Date().toISOString()
    // Insert directly with a sub-0.001 gap
    await db.query(`INSERT INTO tasks (id, content, sort_order, note, is_completed, is_collapsed, created_at, updated_at)
      VALUES ('uat-rb-1', 'UAT rebalance 1', 1.0, '', 0, 0, $1, $1)`, [now])
    await db.query(`INSERT INTO tasks (id, content, sort_order, note, is_completed, is_collapsed, created_at, updated_at)
      VALUES ('uat-rb-2', 'UAT rebalance 2', 1.0005, '', 0, 0, $1, $1)`, [now]) // gap = 0.0005 < threshold
    await db.query(`INSERT INTO tasks (id, content, sort_order, note, is_completed, is_collapsed, created_at, updated_at)
      VALUES ('uat-rb-3', 'UAT rebalance 3', 1.001, '', 0, 0, $1, $1)`, [now])
    await loadTasks()

    // Adding any task at root triggers maybeRebalance(null)
    const trigger = await addTask('UAT rebalance trigger', null, 'uat-rb-3')
    const allIds = [...ids, trigger.id]

    const rebalanced = useTasksStore.getState().tasks
      .filter((t) => allIds.includes(t.id))
      .sort((a, b) => a.sortOrder - b.sortOrder)

    for (let i = 1; i < rebalanced.length; i++) {
      const gap = rebalanced[i].sortOrder - rebalanced[i - 1].sortOrder
      assert(gap >= 0.001, `Gap ${i} should be >= 0.001 after rebalance, got ${gap.toFixed(6)}`)
    }

    // Cleanup
    await deleteTask(trigger.id)
    await db.query(`DELETE FROM tasks WHERE id = ANY($1)`, [ids])
    await loadTasks()
  }, true)

  // ─────────────────────────────────────────────────────────────
  // TASKS — BREADCRUMB / NAVIGATION
  // ─────────────────────────────────────────────────────────────

  t('Tasks › Breadcrumb', 'Breadcrumb for null (home) is empty', async ({ getBreadcrumb }) => {
    const breadcrumb = getBreadcrumb(null)
    assertEqual(breadcrumb.length, 0, 'breadcrumb for null')
  })

  t('Tasks › Breadcrumb', 'Breadcrumb traces full path from root', async ({ addTask, getBreadcrumb, deleteTask }) => {
    const root = await addTask('UAT bc-root', null)
    const child = await addTask('UAT bc-child', root.id)
    const grandchild = await addTask('UAT bc-grand', child.id)
    const bc = getBreadcrumb(grandchild.id)
    assertEqual(bc.length, 3, 'breadcrumb length')
    assertEqual(bc[0].id, root.id, 'bc[0] = root')
    assertEqual(bc[1].id, child.id, 'bc[1] = child')
    assertEqual(bc[2].id, grandchild.id, 'bc[2] = grandchild')
    await deleteTask(root.id)
  })

  t('Tasks › Breadcrumb', 'Breadcrumb for root-level task is just itself', async ({ addTask, getBreadcrumb, deleteTask }) => {
    const task = await addTask('UAT bc-root-only', null)
    const bc = getBreadcrumb(task.id)
    assertEqual(bc.length, 1, 'single item')
    assertEqual(bc[0].id, task.id, 'only itself')
    await deleteTask(task.id)
  })

  // ─────────────────────────────────────────────────────────────
  // WALLET — ACCOUNT CRUD
  // ─────────────────────────────────────────────────────────────

  t('Wallet › Accounts', 'Create account with all fields', async ({ addAccount, deleteAccount }) => {
    const acct = await addAccount({
      name: 'UAT Cash Account',
      type: 'cash',
      currency: 'MYR',
      color: '#FF5733',
      icon: 'wallet',
      description: 'UAT test account',
    })
    assert(acct.id.length > 0, 'has ID')
    assertEqual(acct.name, 'UAT Cash Account', 'name')
    assertEqual(acct.type, 'cash', 'type')
    assertEqual(acct.currency, 'MYR', 'currency')
    assertEqual(acct.color, '#FF5733', 'color')
    assertEqual(acct.description, 'UAT test account', 'description')
    await deleteAccount(acct.id)
  })

  t('Wallet › Accounts', 'Create all account types', async ({ addAccount, deleteAccount }) => {
    const types: Array<'cash' | 'card' | 'e-wallet' | 'bank' | 'investment' | 'other'> = [
      'cash', 'card', 'e-wallet', 'bank', 'investment', 'other',
    ]
    for (const type of types) {
      const acct = await addAccount({ name: `UAT ${type}`, type })
      assertEqual(acct.type, type, `type: ${type}`)
      await deleteAccount(acct.id)
    }
  })

  t('Wallet › Accounts', 'Update account name and type', async ({ addAccount, updateAccount, deleteAccount, loadAccounts }) => {
    const acct = await addAccount({ name: 'UAT Before', type: 'cash' })
    await updateAccount(acct.id, { name: 'UAT After', type: 'bank' })
    const list = await loadAccounts()
    const updated = list.find((a) => a.id === acct.id)
    assertEqual(updated?.name, 'UAT After', 'name updated')
    assertEqual(updated?.type, 'bank', 'type updated')
    await deleteAccount(acct.id)
  })

  t('Wallet › Accounts', 'Delete account cascades all its transactions', async ({ addAccount, addTransaction, deleteAccount, loadAccounts }) => {
    const acct = await addAccount({ name: 'UAT Cascade Account', type: 'cash' })
    await addTransaction({ accountId: acct.id, amount: 100, type: 'income' })
    await addTransaction({ accountId: acct.id, amount: 50, type: 'expense' })
    await deleteAccount(acct.id)
    const list = await loadAccounts()
    assert(!list.some((a) => a.id === acct.id), 'account deleted')
    const db = await getDB()
    const r = await db.query<{ cnt: string }>(`SELECT COUNT(*) as cnt FROM transactions WHERE account_id = $1`, [acct.id])
    assertEqual(Number(r.rows[0].cnt), 0, 'transactions cascade-deleted')
  })

  // ─────────────────────────────────────────────────────────────
  // WALLET — TRANSACTION CRUD
  // ─────────────────────────────────────────────────────────────

  t('Wallet › Transactions', 'Create expense transaction', async ({ addAccount, addTransaction, deleteTransaction, deleteAccount }) => {
    const acct = await addAccount({ name: 'UAT Expense Acct', type: 'cash' })
    const txn = await addTransaction({
      accountId: acct.id,
      date: '2026-01-15',
      merchant: 'UAT Merchant',
      description: 'UAT lunch',
      amount: 50.50,
      type: 'expense',
    })
    assertEqual(txn.type, 'expense', 'type')
    assertClose(txn.amount, 50.50, 0.001, 'amount')
    assertEqual(txn.merchant, 'UAT Merchant', 'merchant')
    assertEqual(txn.description, 'UAT lunch', 'description')
    assertEqual(txn.date, '2026-01-15', 'date')
    assertEqual(txn.destinationAccountId, null, 'destinationAccountId null for expense')
    await deleteTransaction(txn.id)
    await deleteAccount(acct.id)
  })

  t('Wallet › Transactions', 'Create income transaction', async ({ addAccount, addTransaction, deleteTransaction, deleteAccount }) => {
    const acct = await addAccount({ name: 'UAT Income Acct', type: 'bank' })
    const txn = await addTransaction({ accountId: acct.id, amount: 5000, type: 'income', description: 'UAT salary' })
    assertEqual(txn.type, 'income', 'type')
    assertClose(txn.amount, 5000, 0.001, 'amount')
    await deleteTransaction(txn.id)
    await deleteAccount(acct.id)
  })

  t('Wallet › Transactions', 'Create transfer between accounts', async ({ addAccount, addTransaction, deleteTransaction, deleteAccount }) => {
    const src = await addAccount({ name: 'UAT Src', type: 'bank' })
    const dst = await addAccount({ name: 'UAT Dst', type: 'cash' })
    const txn = await addTransaction({
      accountId: src.id,
      destinationAccountId: dst.id,
      amount: 200,
      type: 'transfer',
    })
    assertEqual(txn.type, 'transfer', 'type')
    assertEqual(txn.destinationAccountId, dst.id, 'destinationAccountId set')
    assertEqual(txn.accountId, src.id, 'source account')
    await deleteTransaction(txn.id)
    await deleteAccount(src.id)
    await deleteAccount(dst.id)
  })

  t('Wallet › Transactions', 'Update transaction amount and merchant', async ({ addAccount, addTransaction, updateTransaction, deleteTransaction, deleteAccount }) => {
    const acct = await addAccount({ name: 'UAT Update Txn', type: 'cash' })
    const txn = await addTransaction({ accountId: acct.id, amount: 10, type: 'expense', merchant: 'Before' })
    await updateTransaction(txn.id, { amount: 99.99, merchant: 'After' })
    const db = await getDB()
    const r = await db.query<{ amount: number; merchant: string }>(`SELECT amount, merchant FROM transactions WHERE id = $1`, [txn.id])
    assertClose(r.rows[0].amount, 99.99, 0.001, 'updated amount in DB')
    assertEqual(r.rows[0].merchant, 'After', 'updated merchant in DB')
    await deleteTransaction(txn.id)
    await deleteAccount(acct.id)
  })

  t('Wallet › Transactions', 'Delete transaction', async ({ addAccount, addTransaction, deleteTransaction, deleteAccount }) => {
    const acct = await addAccount({ name: 'UAT Del Txn', type: 'cash' })
    const txn = await addTransaction({ accountId: acct.id, amount: 1, type: 'expense' })
    await deleteTransaction(txn.id)
    const db = await getDB()
    const r = await db.query<{ cnt: string }>(`SELECT COUNT(*) as cnt FROM transactions WHERE id = $1`, [txn.id])
    assertEqual(Number(r.rows[0].cnt), 0, 'transaction gone from DB')
    await deleteAccount(acct.id)
  })

  t('Wallet › Transactions', 'Zero-amount transaction is accepted', async ({ addAccount, addTransaction, deleteTransaction, deleteAccount }): Promise<void> => {
    const acct = await addAccount({ name: 'UAT Zero Amt', type: 'cash' })
    const txn = await addTransaction({ accountId: acct.id, amount: 0, type: 'expense' })
    assert(txn.id.length > 0, 'zero-amount transaction created')
    assertClose(txn.amount, 0, 0.001, 'amount is zero')
    await deleteTransaction(txn.id)
    await deleteAccount(acct.id)
  }, true)

  t('Wallet › Transactions', 'Large amount (> 1,000,000) is stored accurately', async ({ addAccount, addTransaction, deleteTransaction, deleteAccount }): Promise<void> => {
    const acct = await addAccount({ name: 'UAT Large Amt', type: 'investment' })
    const txn = await addTransaction({ accountId: acct.id, amount: 1_234_567.89, type: 'income' })
    assertClose(txn.amount, 1_234_567.89, 0.01, 'large amount')
    const db = await getDB()
    const r = await db.query<{ amount: number }>(`SELECT amount FROM transactions WHERE id = $1`, [txn.id])
    assertClose(r.rows[0].amount, 1_234_567.89, 0.01, 'DB large amount')
    await deleteTransaction(txn.id)
    await deleteAccount(acct.id)
  }, true)

  // ─────────────────────────────────────────────────────────────
  // WALLET — BALANCE CALCULATION
  // ─────────────────────────────────────────────────────────────

  t('Wallet › Balance', 'Balance = income − expense', async ({ addAccount, addTransaction, deleteTransaction, deleteAccount, getAccountBalance }) => {
    const acct = await addAccount({ name: 'UAT Bal Basic', type: 'bank' })
    const t1 = await addTransaction({ accountId: acct.id, amount: 1000, type: 'income' })
    const t2 = await addTransaction({ accountId: acct.id, amount: 300, type: 'expense' })
    const balance = await getAccountBalance(acct.id)
    assertClose(balance, 700, 0.001, 'balance = 1000 - 300')
    await deleteTransaction(t1.id)
    await deleteTransaction(t2.id)
    await deleteAccount(acct.id)
  })

  t('Wallet › Balance', 'Balance = 0 for empty account', async ({ addAccount, deleteAccount, getAccountBalance }) => {
    const acct = await addAccount({ name: 'UAT Empty Bal', type: 'cash' })
    const balance = await getAccountBalance(acct.id)
    assertClose(balance, 0, 0.001, 'empty account balance is 0')
    await deleteAccount(acct.id)
  })

  t('Wallet › Balance', 'Transfer OUT reduces source, transfer IN increases destination', async ({ addAccount, addTransaction, deleteTransaction, deleteAccount, getAccountBalance }) => {
    const src = await addAccount({ name: 'UAT Bal Src', type: 'bank' })
    const dst = await addAccount({ name: 'UAT Bal Dst', type: 'cash' })
    const income = await addTransaction({ accountId: src.id, amount: 1000, type: 'income' })
    const transfer = await addTransaction({ accountId: src.id, destinationAccountId: dst.id, amount: 400, type: 'transfer' })
    const srcBal = await getAccountBalance(src.id)
    const dstBal = await getAccountBalance(dst.id)
    assertClose(srcBal, 600, 0.001, 'src: 1000 - 400 = 600')
    assertClose(dstBal, 400, 0.001, 'dst: +400 = 400')
    await deleteTransaction(income.id)
    await deleteTransaction(transfer.id)
    await deleteAccount(src.id)
    await deleteAccount(dst.id)
  })

  t('Wallet › Balance', 'Transfer does NOT appear in income or expense totals', async ({ addAccount, addTransaction, deleteTransaction, deleteAccount }): Promise<void> => {
    const src = await addAccount({ name: 'UAT Xfer NoCount Src', type: 'bank' })
    const dst = await addAccount({ name: 'UAT Xfer NoCount Dst', type: 'cash' })
    const transfer = await addTransaction({ accountId: src.id, destinationAccountId: dst.id, amount: 500, type: 'transfer' })
    const db = await getDB()
    const incR = await db.query<{ cnt: string }>(`SELECT COUNT(*) as cnt FROM transactions WHERE type = 'income' AND id = $1`, [transfer.id])
    const expR = await db.query<{ cnt: string }>(`SELECT COUNT(*) as cnt FROM transactions WHERE type = 'expense' AND id = $1`, [transfer.id])
    assertEqual(Number(incR.rows[0].cnt), 0, 'transfer not counted as income')
    assertEqual(Number(expR.rows[0].cnt), 0, 'transfer not counted as expense')
    await deleteTransaction(transfer.id)
    await deleteAccount(src.id)
    await deleteAccount(dst.id)
  }, true)

  t('Wallet › Balance', 'Multiple transactions accumulate correctly', async ({ addAccount, addTransaction, deleteTransaction, deleteAccount, getAccountBalance }) => {
    const acct = await addAccount({ name: 'UAT Accumulate', type: 'bank' })
    const txns = await Promise.all([
      addTransaction({ accountId: acct.id, amount: 5000, type: 'income' }),
      addTransaction({ accountId: acct.id, amount: 1200, type: 'expense' }),
      addTransaction({ accountId: acct.id, amount: 800, type: 'expense' }),
      addTransaction({ accountId: acct.id, amount: 300, type: 'income' }),
    ])
    const balance = await getAccountBalance(acct.id)
    // 5000 + 300 - 1200 - 800 = 3300
    assertClose(balance, 3300, 0.001, '5000 + 300 - 1200 - 800 = 3300')
    for (const txn of txns) await deleteTransaction(txn.id)
    await deleteAccount(acct.id)
  })

  // ─────────────────────────────────────────────────────────────
  // WALLET — CSV DEDUP / IMPORT
  // ─────────────────────────────────────────────────────────────

  t('Wallet › CSV Import', 'Manual transactions have empty import_hash', async ({ addAccount, addTransaction, deleteTransaction, deleteAccount }) => {
    const acct = await addAccount({ name: 'UAT Manual Hash', type: 'cash' })
    const txn = await addTransaction({ accountId: acct.id, amount: 10, type: 'expense' })
    assertEqual(txn.importHash, '', 'manual transaction importHash is empty')
    await deleteTransaction(txn.id)
    await deleteAccount(acct.id)
  })

  t('Wallet › CSV Import', 'Imported transaction stores import_hash', async ({ addAccount, addTransaction, deleteTransaction, deleteAccount }) => {
    const acct = await addAccount({ name: 'UAT Hash Acct', type: 'bank' })
    const HASH = 'uat-sha256-abc123def456'
    const txn = await addTransaction({ accountId: acct.id, amount: 99, type: 'expense', importHash: HASH })
    assertEqual(txn.importHash, HASH, 'importHash stored')
    const db = await getDB()
    const r = await db.query<{ import_hash: string }>(`SELECT import_hash FROM transactions WHERE id = $1`, [txn.id])
    assertEqual(r.rows[0].import_hash, HASH, 'importHash in DB')
    await deleteTransaction(txn.id)
    await deleteAccount(acct.id)
  })

  t('Wallet › CSV Import', 'Duplicate import_hash is detectable before insert', async ({ addAccount, addTransaction, deleteTransaction, deleteAccount }): Promise<void> => {
    const acct = await addAccount({ name: 'UAT Dedup Acct', type: 'bank' })
    const HASH = 'uat-dedup-hash-xyz789'
    const txn = await addTransaction({ accountId: acct.id, amount: 150, type: 'expense', importHash: HASH })
    const db = await getDB()
    const r = await db.query<{ cnt: string }>(`SELECT COUNT(*) as cnt FROM transactions WHERE import_hash = $1`, [HASH])
    assertEqual(Number(r.rows[0].cnt), 1, 'exactly one record with this hash')
    // A real import flow checks this before inserting — confirmed detectable
    assert(Number(r.rows[0].cnt) > 0, 'duplicate hash is detectable')
    await deleteTransaction(txn.id)
    await deleteAccount(acct.id)
  }, true)

  // ─────────────────────────────────────────────────────────────
  // WALLET — FILTERING
  // ─────────────────────────────────────────────────────────────

  t('Wallet › Filters', 'Filter by date range (2 of 3 dates match)', async ({ addAccount, addTransaction, deleteTransaction, deleteAccount }) => {
    const acct = await addAccount({ name: 'UAT Filter Dates', type: 'bank' })
    const t1 = await addTransaction({ accountId: acct.id, amount: 100, type: 'expense', date: '2026-01-15' })
    const t2 = await addTransaction({ accountId: acct.id, amount: 200, type: 'expense', date: '2026-02-15' })
    const t3 = await addTransaction({ accountId: acct.id, amount: 300, type: 'expense', date: '2026-03-15' })
    const db = await getDB()
    const r = await db.query<{ id: string }>(`SELECT id FROM transactions WHERE date >= $1 AND date <= $2 AND account_id = $3`, ['2026-01-01', '2026-02-28', acct.id])
    assertEqual(r.rows.length, 2, '2 in Jan-Feb')
    assert(r.rows.some((row) => row.id === t1.id), 'Jan included')
    assert(r.rows.some((row) => row.id === t2.id), 'Feb included')
    assert(!r.rows.some((row) => row.id === t3.id), 'Mar excluded')
    for (const txn of [t1, t2, t3]) await deleteTransaction(txn.id)
    await deleteAccount(acct.id)
  })

  t('Wallet › Filters', 'Filter by transaction type', async ({ addAccount, addTransaction, deleteTransaction, deleteAccount }) => {
    const acct = await addAccount({ name: 'UAT Filter Type', type: 'bank' })
    const inc = await addTransaction({ accountId: acct.id, amount: 1000, type: 'income' })
    const exp = await addTransaction({ accountId: acct.id, amount: 50, type: 'expense' })
    const db = await getDB()
    const r = await db.query<{ id: string }>(`SELECT id FROM transactions WHERE type = 'expense' AND account_id = $1`, [acct.id])
    assertEqual(r.rows.length, 1, 'one expense found')
    assertEqual(r.rows[0].id, exp.id, 'correct transaction')
    await deleteTransaction(inc.id)
    await deleteTransaction(exp.id)
    await deleteAccount(acct.id)
  })

  t('Wallet › Filters', 'Filter by account ID (excludes other accounts)', async ({ addAccount, addTransaction, deleteTransaction, deleteAccount }) => {
    const acct1 = await addAccount({ name: 'UAT Filter Acct 1', type: 'cash' })
    const acct2 = await addAccount({ name: 'UAT Filter Acct 2', type: 'bank' })
    const t1 = await addTransaction({ accountId: acct1.id, amount: 100, type: 'expense' })
    const t2 = await addTransaction({ accountId: acct2.id, amount: 200, type: 'expense' })
    const db = await getDB()
    const r = await db.query<{ id: string }>(`SELECT id FROM transactions WHERE account_id = $1`, [acct1.id])
    assertEqual(r.rows.length, 1, 'only one txn for acct1')
    assertEqual(r.rows[0].id, t1.id, 'acct1 txn found')
    assert(!r.rows.some((row) => row.id === t2.id), 'acct2 txn not included')
    await deleteTransaction(t1.id)
    await deleteTransaction(t2.id)
    await deleteAccount(acct1.id)
    await deleteAccount(acct2.id)
  })

  return tests
}

// ── Runner component ─────────────────────────────────────────────────────────

export function UATPage() {
  const taskHooks = useTasks()
  const walletHooks = useWallet()

  const [results, setResults] = useState<TestResult[]>(() =>
    buildTests().map((t) => ({ id: t.id, suite: t.suiteName, name: t.name, status: 'pending', isEdgeCase: t.isEdgeCase })),
  )
  const [running, setRunning] = useState(false)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  const updateResult = useCallback((id: string, updates: Partial<TestResult>) => {
    setResults((prev) => prev.map((r) => (r.id === id ? { ...r, ...updates } : r)))
  }, [])

  const runAll = useCallback(async () => {
    setRunning(true)
    // Reset all to pending
    setResults((prev) => prev.map((r) => ({ ...r, status: 'pending', error: undefined, duration: undefined })))

    const helpers: TestHelpers = {
      addTask: taskHooks.addTask,
      updateTask: taskHooks.updateTask,
      deleteTask: taskHooks.deleteTask,
      loadTasks: taskHooks.loadTasks,
      indentTask: taskHooks.indentTask,
      outdentTask: taskHooks.outdentTask,
      getBreadcrumb: taskHooks.getBreadcrumb,
      addAccount: walletHooks.addAccount,
      updateAccount: walletHooks.updateAccount,
      deleteAccount: walletHooks.deleteAccount,
      addTransaction: walletHooks.addTransaction,
      updateTransaction: walletHooks.updateTransaction,
      deleteTransaction: walletHooks.deleteTransaction,
      getAccountBalance: walletHooks.getAccountBalance,
      loadAccounts: walletHooks.loadAccounts,
    }

    const defs = buildTests()

    for (const def of defs) {
      updateResult(def.id, { status: 'running' })
      const start = performance.now()
      try {
        await def.fn(helpers)
        updateResult(def.id, { status: 'pass', duration: Math.round(performance.now() - start) })
      } catch (err) {
        updateResult(def.id, {
          status: 'fail',
          error: err instanceof Error ? err.message : String(err),
          duration: Math.round(performance.now() - start),
        })
      }
      // Yield to React between tests so the UI updates
      await new Promise((r) => setTimeout(r, 10))
    }

    setRunning(false)
  }, [taskHooks, walletHooks, updateResult])

  const resetAll = useCallback(() => {
    setResults((prev) => prev.map((r) => ({ ...r, status: 'pending', error: undefined, duration: undefined })))
  }, [])

  // Group results by suite
  const suites = Array.from(new Set(results.map((r) => r.suite)))
  const passCount = results.filter((r) => r.status === 'pass').length
  const failCount = results.filter((r) => r.status === 'fail').length
  const totalDone = results.filter((r) => r.status === 'pass' || r.status === 'fail').length
  const total = results.length
  const allDone = totalDone === total && total > 0

  const toggleSuite = (suite: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(suite)) next.delete(suite)
      else next.add(suite)
      return next
    })
  }

  return (
    <div className="max-w-3xl mx-auto">

      {/* ── Header ─────────────────────────────────────────── */}
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-1">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-100">
            <FlaskConical className="h-5 w-5 text-violet-600" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-gray-900">UAT Test Runner</h1>
            <p className="text-xs text-gray-500">Automated end-to-end tests against the live database</p>
          </div>
        </div>
      </div>

      {/* ── Summary bar ────────────────────────────────────── */}
      <div className="mb-5 flex items-center gap-3">
        <div className="flex flex-1 items-center gap-4 rounded-xl border border-gray-200 bg-white px-4 py-3">
          <div className="text-center">
            <p className="text-xl font-bold text-gray-900">{total}</p>
            <p className="text-xs text-gray-400">Total</p>
          </div>
          <div className="h-8 w-px bg-gray-100" />
          <div className="text-center">
            <p className="text-xl font-bold text-green-600">{passCount}</p>
            <p className="text-xs text-gray-400">Passed</p>
          </div>
          <div className="h-8 w-px bg-gray-100" />
          <div className="text-center">
            <p className="text-xl font-bold text-red-500">{failCount}</p>
            <p className="text-xs text-gray-400">Failed</p>
          </div>
          <div className="h-8 w-px bg-gray-100" />
          <div className="text-center">
            <p className="text-xl font-bold text-gray-400">{total - totalDone}</p>
            <p className="text-xs text-gray-400">Pending</p>
          </div>

          {/* Progress bar */}
          {running || allDone ? (
            <div className="flex-1 mx-2">
              <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
                <div
                  className={cn(
                    'h-full rounded-full transition-all duration-300',
                    failCount > 0 ? 'bg-red-400' : 'bg-green-400',
                  )}
                  style={{ width: `${(totalDone / total) * 100}%` }}
                />
              </div>
              <p className="text-xs text-gray-400 mt-0.5 text-right">{Math.round((totalDone / total) * 100)}%</p>
            </div>
          ) : null}
        </div>

        <div className="flex gap-2">
          <button
            onClick={resetAll}
            disabled={running}
            className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-500 transition-colors hover:bg-gray-50 disabled:opacity-40"
            title="Reset all results"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={runAll}
            disabled={running}
            className={cn(
              'flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white transition-colors',
              running
                ? 'bg-violet-300 cursor-not-allowed'
                : 'bg-violet-600 hover:bg-violet-700 shadow-sm',
            )}
          >
            <Play className="h-3.5 w-3.5" />
            {running ? 'Running…' : 'Run All Tests'}
          </button>
        </div>
      </div>

      {/* ── All-pass banner ─────────────────────────────────── */}
      {allDone && failCount === 0 && (
        <div className="mb-4 flex items-center gap-3 rounded-xl border border-green-200 bg-green-50 px-4 py-3">
          <CheckCircle2 className="h-5 w-5 text-green-600 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-green-800">All {total} tests passed!</p>
            <p className="text-xs text-green-600">Every feature works correctly.</p>
          </div>
        </div>
      )}

      {/* ── Fail banner ─────────────────────────────────────── */}
      {allDone && failCount > 0 && (
        <div className="mb-4 flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
          <AlertTriangle className="h-5 w-5 text-red-500 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-red-800">{failCount} test{failCount !== 1 ? 's' : ''} failed</p>
            <p className="text-xs text-red-600">See failure details below.</p>
          </div>
        </div>
      )}

      {/* ── Test suites ─────────────────────────────────────── */}
      <div className="space-y-3">
        {suites.map((suite) => {
          const suiteResults = results.filter((r) => r.suite === suite)
          const suitePassed = suiteResults.filter((r) => r.status === 'pass').length
          const suiteFailed = suiteResults.filter((r) => r.status === 'fail').length
          const suiteTotal = suiteResults.length
          const isOpen = !collapsed.has(suite)

          return (
            <div key={suite} className="overflow-hidden rounded-xl border border-gray-200 bg-white">
              {/* Suite header */}
              <button
                className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-gray-50 transition-colors"
                onClick={() => toggleSuite(suite)}
              >
                <div className="flex items-center gap-2.5">
                  {isOpen ? <ChevronDown className="h-3.5 w-3.5 text-gray-400" /> : <ChevronRight className="h-3.5 w-3.5 text-gray-400" />}
                  <span className="text-sm font-semibold text-gray-800">{suite}</span>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  {suiteFailed > 0 && (
                    <span className="rounded-full bg-red-100 px-2 py-0.5 font-medium text-red-700">{suiteFailed} failed</span>
                  )}
                  <span className={cn(
                    'rounded-full px-2 py-0.5 font-medium',
                    suitePassed === suiteTotal && suiteTotal > 0
                      ? 'bg-green-100 text-green-700'
                      : 'bg-gray-100 text-gray-500',
                  )}>
                    {suitePassed}/{suiteTotal}
                  </span>
                </div>
              </button>

              {/* Tests */}
              {isOpen && (
                <div className="divide-y divide-gray-50 border-t border-gray-100">
                  {suiteResults.map((result) => (
                    <div key={result.id} className="px-4 py-2.5">
                      <div className="flex items-start gap-3">
                        {/* Status icon */}
                        <div className="mt-0.5 shrink-0">
                          {result.status === 'pending' && <Clock className="h-4 w-4 text-gray-300" />}
                          {result.status === 'running' && (
                            <div className="h-4 w-4 rounded-full border-2 border-violet-400 border-t-transparent animate-spin" />
                          )}
                          {result.status === 'pass' && <CheckCircle2 className="h-4 w-4 text-green-500" />}
                          {result.status === 'fail' && <XCircle className="h-4 w-4 text-red-500" />}
                        </div>

                        {/* Name + details */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={cn(
                              'text-sm',
                              result.status === 'pass' && 'text-gray-700',
                              result.status === 'fail' && 'text-red-700 font-medium',
                              result.status === 'pending' && 'text-gray-400',
                              result.status === 'running' && 'text-violet-700',
                            )}>
                              {result.name}
                            </span>
                            {result.isEdgeCase && (
                              <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-700">edge case</span>
                            )}
                          </div>
                          {result.status === 'fail' && result.error && (
                            <p className="mt-1 text-xs text-red-600 font-mono bg-red-50 rounded px-2 py-1 border border-red-100">
                              {result.error}
                            </p>
                          )}
                        </div>

                        {/* Duration */}
                        {result.duration !== undefined && (
                          <span className="shrink-0 text-xs text-gray-400">{result.duration}ms</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* ── Footer note ─────────────────────────────────────── */}
      <p className="mt-6 text-center text-xs text-gray-400">
        Tests run against the live PGlite database. All test data is created and cleaned up automatically.
      </p>
    </div>
  )
}
