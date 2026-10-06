import { useState, useEffect, useCallback, useMemo } from 'react'
import { Plus, PlusCircle, Target } from 'lucide-react'
import { EmptyState } from '@/components/ui/EmptyState'
import { ConfirmDeleteModal } from '@/components/ui/ConfirmDeleteModal'
import { Button } from '@/components/ui/Button'
import { useWallet, countableAmount, mapTransaction, type TransactionRow } from '@/hooks/useWallet'
import { api } from '@/lib/api'
import { useCrudModal } from '@/hooks/useCrudModal'
import { useToastStore } from '@/stores/toast.store'
import { formatMYR, errorMessage, todayISO } from '@/lib/utils'
import { monthKey, dayOfMonth, daysInMonth } from '@/modules/wallet/dashboard/insights'
import { TransactionForm, type TransactionFormData } from '@/modules/wallet/TransactionForm'
import { GoalsBand, type GoalComputed } from '@/modules/wallet/goals/GoalsBand'
import { GoalCard } from '@/modules/wallet/goals/GoalCard'
import { GoalFormModal, type GoalFormData } from '@/modules/wallet/goals/GoalFormModal'
import { GoalsTrajectoryChart } from '@/modules/wallet/goals/GoalsTrajectoryChart'
import { GoalsMilestones } from '@/modules/wallet/goals/GoalsMilestones'
import {
  goalSaved, fundingRate, addedThisMonth as goalAddedThisMonth, goalStatus, nextMilestones, knockOn, roomForMore,
  type GoalStatus,
} from '@/modules/wallet/goals/projection'
import type { Goal, GoalFlow } from '@/types/wallet.types'

/** The ETA ('YYYY-MM') carried by a status kind that has one, else null — used to pick the "soonest finishing" goal for Room-for-more's target. */
function statusEta(status: GoalStatus | 'unknown'): string | null {
  if (status === 'unknown') return null
  if (status.kind === 'ahead' || status.kind === 'onTrack' || status.kind === 'undated') return status.eta
  return null
}

export function GoalsPage() {
  const {
    goals, accounts, categories, tags,
    loadGoals, loadAccounts, loadCategories, loadTags,
    addGoal, updateGoal, deleteGoal, getAccountBalances, loadGoalFlows, addTransaction,
  } = useWallet()
  const { addToast } = useToastStore()

  const crud = useCrudModal<Goal>()
  const [balances, setBalances] = useState<Record<string, number>>({})
  const [flows, setFlows] = useState<GoalFlow[] | null>(null)
  const [monthIncome, setMonthIncome] = useState(0)
  const [monthExpense, setMonthExpense] = useState(0)
  const [form, setForm] = useState<GoalFormData>({ name: '', targetAmount: '', accountId: '', targetDate: '', note: '' })
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [addMoneyOpen, setAddMoneyOpen] = useState(false)
  const [addMoneyDraft, setAddMoneyDraft] = useState<Partial<TransactionFormData> | undefined>(undefined)

  const today = todayISO()
  const currentMonth = monthKey(today)

  // `POST /goals` rejects a shared-in account (a goal's linked account must
  // be one this user actually owns), so the New/Edit Goal form's Account
  // select only ever offers these — same `ownAccounts` filter Dashboard.tsx
  // and AccountsPage.tsx use for the money traps in §3.
  const ownAccounts = useMemo(() => accounts.filter((a) => !a.isShared), [accounts])

  const reloadBalances = useCallback(() => {
    getAccountBalances()
      .then(setBalances)
      .catch((err) => addToast({ message: errorMessage(err, 'Could not load account balances — figures may be stale.'), duration: 4000 }))
  }, [getAccountBalances, addToast])

  const reloadFlows = useCallback(() => {
    loadGoalFlows()
      .then(setFlows)
      .catch((err) => {
        setFlows(null)
        addToast({ message: errorMessage(err, 'Could not load goal funding history — rates show as "—".'), duration: 4000 })
      })
  }, [loadGoalFlows, addToast])

  // Fetched directly via `api.get`, NOT `useWallet().loadTransactions` — that
  // helper writes its result into the shared wallet.store transaction list,
  // which every other wallet page reads from. This is a page-local figure
  // ("Room for another"), so it stays in page-local state instead of
  // clobbering whatever filtered list Transactions/Dashboard currently hold.
  // Filtered to the viewer's OWN accounts (mirrors Dashboard.tsx/AccountsPage.tsx's
  // `ownAccounts = accounts.filter(a => !a.isShared)`) rather than `view:
  // ['mine']` — "mine" is who CREATED the row, not which account it moved
  // money in, and §3's money trap is specifically about shared accounts.
  const reloadMonthTxns = useCallback(() => {
    const qs = new URLSearchParams({ dateFrom: `${currentMonth}-01`, dateTo: today })
    api.get<TransactionRow[]>(`/transactions?${qs.toString()}`)
      .then((rows) => {
        const ownAccountIds = new Set(accounts.filter((a) => !a.isShared).map((a) => a.id))
        let income = 0
        let expense = 0
        for (const row of rows) {
          const t = mapTransaction(row)
          if (!ownAccountIds.has(t.accountId)) continue
          const amt = countableAmount(t)
          if (t.type === 'income') income += amt
          else if (t.type === 'expense') expense += amt
        }
        setMonthIncome(income)
        setMonthExpense(expense)
      })
      .catch((err) => addToast({ message: errorMessage(err, 'Could not load this month\'s activity — "Room for another" may be unavailable.'), duration: 4000 }))
  }, [accounts, currentMonth, today, addToast])

  useEffect(() => {
    loadAccounts()
    loadCategories()
    loadTags()
    loadGoals()
    reloadBalances()
    reloadFlows()
  }, [loadAccounts, loadCategories, loadTags, loadGoals, reloadBalances, reloadFlows])

  // Separate effect: `reloadMonthTxns` depends on `accounts` (to filter to
  // the viewer's own), so it must re-run once `loadAccounts` above resolves
  // and `accounts` goes from `[]` to the real list — folding it into the
  // effect above would re-trigger loadAccounts/loadCategories/loadTags/loadGoals
  // every time `accounts` changes, since `reloadMonthTxns`'s own identity
  // would then be a dependency of that effect too.
  useEffect(() => {
    reloadMonthTxns()
  }, [reloadMonthTxns])

  const openCreate = useCallback(() => {
    setForm({ name: '', targetAmount: '', accountId: ownAccounts[0]?.id ?? '', targetDate: '', note: '' })
    setFormError(null)
    crud.openCreate()
  }, [ownAccounts, crud])

  const openEdit = useCallback((goal: Goal) => {
    setForm({
      name: goal.name,
      targetAmount: String(goal.targetAmount),
      accountId: goal.accountId,
      targetDate: goal.targetDate ?? '',
      note: goal.note ?? '',
    })
    setFormError(null)
    crud.openEdit(goal)
  }, [crud])

  const handleSubmit = useCallback(async () => {
    const targetAmount = parseFloat(form.targetAmount)
    if (!form.name.trim()) { setFormError('Give the goal a name.'); return }
    if (isNaN(targetAmount) || targetAmount <= 0) { setFormError('Enter a target greater than 0.'); return }
    if (!form.accountId) { setFormError('Choose an account.'); return }
    setFormError(null)
    setSaving(true)
    try {
      const payload = {
        name: form.name.trim(),
        targetAmount,
        accountId: form.accountId,
        targetDate: form.targetDate || null,
        note: form.note.trim() ? form.note.trim().slice(0, 80) : null,
      }
      if (crud.editingItem) {
        await updateGoal(crud.editingItem.id, payload)
      } else {
        await addGoal(payload)
      }
      crud.closeForm(false)
    } catch (err) {
      addToast({ message: errorMessage(err, 'Could not save goal — please try again.'), duration: 4000 })
    } finally {
      setSaving(false)
    }
  }, [form, crud, addGoal, updateGoal, addToast])

  const handleDelete = useCallback(async (id: string) => {
    try {
      await deleteGoal(id)
      crud.closeDelete()
    } catch (err) {
      addToast({ message: errorMessage(err, 'Could not delete goal — please try again.'), duration: 4000 })
    }
  }, [deleteGoal, crud, addToast])

  const flowsReady = flows !== null
  const effFlows = useMemo(() => flows ?? [], [flows])

  const computed: GoalComputed[] = useMemo(() => goals.map((goal) => {
    const saved = goalSaved(goal, balances)
    const rate = flowsReady ? fundingRate(effFlows, goal.accountId, today) : 0
    const status: GoalStatus | 'unknown' = flowsReady ? goalStatus(goal, saved, rate, effFlows, today) : 'unknown'
    return { goal, saved, rate, status }
  }), [goals, balances, flowsReady, effFlows, today])

  const totalTarget = computed.reduce((sum, c) => sum + c.goal.targetAmount, 0)
  const totalSaved = computed.reduce((sum, c) => sum + c.saved, 0)
  const totalRate = flowsReady ? computed.reduce((sum, c) => sum + c.rate, 0) : 0
  // Deduped by accountId for the dollar figure — two goals sharing one
  // linked account must not double-count that account's inflow — but `k` in
  // "across {k} goals" below counts GOALS (every goal whose account got a
  // positive inflow this month counts once, even if its account is shared).
  const uniqueGoalAccountIds = useMemo(() => [...new Set(goals.map((g) => g.accountId))], [goals])
  const addedThisMonthTotal = flowsReady
    ? uniqueGoalAccountIds.reduce((sum, accountId) => sum + goalAddedThisMonth(effFlows, accountId, today), 0)
    : 0
  const contributingGoalCount = flowsReady
    ? goals.filter((g) => goalAddedThisMonth(effFlows, g.accountId, today) > 0).length
    : 0
  const activeCount = computed.filter((c) => c.saved < c.goal.targetAmount).length

  const savedMap = useMemo(() => Object.fromEntries(computed.map((c) => [c.goal.id, c.saved])), [computed])
  const rateMap = useMemo(() => Object.fromEntries(computed.map((c) => [c.goal.id, c.rate])), [computed])
  const statusMap = useMemo(
    () => Object.fromEntries(
      computed.filter((c): c is GoalComputed & { status: GoalStatus } => c.status !== 'unknown').map((c) => [c.goal.id, c.status]),
    ),
    [computed],
  )

  const milestones = flowsReady ? nextMilestones(goals, savedMap, rateMap, statusMap, today) : []

  const knockOnResult = flowsReady
    ? knockOn(
        computed.filter((c): c is GoalComputed & { status: GoalStatus } => c.status !== 'unknown').map((c) => ({ goal: c.goal, status: c.status })),
        today,
      )
    : null

  const elapsedFraction = dayOfMonth(today) / daysInMonth(currentMonth)
  const room = flowsReady
    ? roomForMore({ incomeMtd: monthIncome, expenseMtd: monthExpense, elapsedFraction, addedThisMonth: addedThisMonthTotal })
    : null
  const kept = monthIncome - monthExpense

  const roomTargetGoal = useMemo(() => {
    // "Most behind" includes `overdue` alongside `behind` — a goal whose
    // target date has already passed has no `needed`/`rate` to rank it by,
    // so it's given an effectively-infinite shortfall and always wins.
    const shortfallOf = (status: GoalStatus | 'unknown'): number => {
      if (status === 'unknown') return -Infinity
      if (status.kind === 'overdue') return Infinity
      if (status.kind === 'behind') return status.needed - status.rate
      return -Infinity
    }
    const behind = computed
      .filter((c) => c.status !== 'unknown' && (c.status.kind === 'behind' || c.status.kind === 'overdue'))
      .sort((a, b) => shortfallOf(b.status) - shortfallOf(a.status))
    if (behind.length > 0) return behind[0].goal
    const soonest = computed
      .filter((c) => statusEta(c.status) !== null)
      .sort((a, b) => statusEta(a.status)!.localeCompare(statusEta(b.status)!))
    return soonest[0]?.goal ?? null
  }, [computed])

  const firstIncompleteGoal = computed.find((c) => c.saved < c.goal.targetAmount)?.goal ?? null

  const openAddMoney = useCallback((goal: Goal | null, amount?: number) => {
    const destinationAccountId = goal?.accountId ?? ''
    const sourceCandidate = accounts.find((a) => a.id !== destinationAccountId)
    setAddMoneyDraft({
      type: 'transfer',
      accountId: sourceCandidate?.id ?? accounts[0]?.id ?? '',
      destinationAccountId,
      amount: amount ?? 0,
    })
    setAddMoneyOpen(true)
  }, [accounts])

  const handleAddMoneySubmit = useCallback(async (data: TransactionFormData) => {
    try {
      await addTransaction(data)
    } catch (err) {
      addToast({ message: errorMessage(err, 'Could not save the transfer — please try again.'), duration: 4000 })
      throw err
    }
    reloadBalances()
    reloadFlows()
    reloadMonthTxns()
  }, [addTransaction, addToast, reloadBalances, reloadFlows, reloadMonthTxns])

  return (
    <div className="mx-auto max-w-5xl">
      <div className="page-head">
        <h2 className="page-title">Goals</h2>
        <span className="page-sub hide-mobile" data-testid="goals-subtitle">
          {activeCount} active · {formatMYR(totalSaved)} saved
        </span>
        <div className="page-actions">
          <Button variant="secondary" size="sm" onClick={() => openAddMoney(firstIncompleteGoal)} disabled={!firstIncompleteGoal}>
            <PlusCircle className="h-3.5 w-3.5" />
            Add money
          </Button>
          <Button size="sm" onClick={openCreate}>
            <Plus className="h-3.5 w-3.5" />
            New goal
          </Button>
        </div>
      </div>

      {goals.length === 0 ? (
        <EmptyState
          icon={<Target className="h-10 w-10" />}
          title="No goals yet"
          description="Add a savings goal to track your progress toward a target."
          action={<Button size="sm" onClick={openCreate}>Add your first goal</Button>}
        />
      ) : (
        <div className="dash">
          <GoalsBand
            computed={computed}
            totalTarget={totalTarget}
            totalSaved={totalSaved}
            totalRate={totalRate}
            flowsReady={flowsReady}
            addedThisMonth={addedThisMonthTotal}
            contributingGoalCount={contributingGoalCount}
          />

          {computed.map((c, i) => {
            const account = accounts.find((a) => a.id === c.goal.accountId)
            return (
              <section key={c.goal.id} className="card card-pad c6">
                <GoalCard
                  goal={c.goal}
                  account={account}
                  colorIndex={i}
                  saved={c.saved}
                  status={c.status}
                  onEdit={() => openEdit(c.goal)}
                  onDelete={() => crud.openDelete(c.goal.id)}
                />
              </section>
            )
          })}

          <GoalsTrajectoryChart
            goals={goals}
            balances={balances}
            flows={effFlows}
            flowsReady={flowsReady}
            totalSaved={totalSaved}
            totalTarget={totalTarget}
            totalRate={totalRate}
            today={today}
          />

          <GoalsMilestones
            milestones={milestones}
            knockOn={knockOnResult}
            room={room}
            kept={kept}
            roomTargetGoalName={roomTargetGoal?.name ?? null}
            onAddToRoomTarget={() => openAddMoney(roomTargetGoal, room ?? 0)}
          />
        </div>
      )}

      <GoalFormModal
        open={crud.formOpen}
        onOpenChange={crud.closeForm}
        isEdit={!!crud.editingItem}
        form={form}
        setForm={setForm}
        accounts={ownAccounts}
        formError={formError}
        saving={saving}
        onSubmit={handleSubmit}
      />

      <ConfirmDeleteModal
        open={!!crud.confirmDeleteId}
        onOpenChange={(open) => { if (!open) crud.closeDelete() }}
        title={`Delete ${goals.find((g) => g.id === crud.confirmDeleteId)?.name ?? 'goal'}?`}
        description="This will remove the goal. Your account and transactions are not affected."
        confirmLabel="Delete"
        onConfirm={() => crud.confirmDeleteId && handleDelete(crud.confirmDeleteId)}
      />

      <TransactionForm
        open={addMoneyOpen}
        onOpenChange={setAddMoneyOpen}
        accounts={accounts}
        categories={categories}
        availableTags={tags}
        initialDraft={addMoneyDraft}
        onSubmit={handleAddMoneySubmit}
      />
    </div>
  )
}
