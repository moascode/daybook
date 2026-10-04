import { useState, useEffect, useCallback, useMemo } from 'react'
import { format, parseISO } from 'date-fns'
import { Plus, PieChart, Pencil, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { ConfirmDeleteModal } from '@/components/ui/ConfirmDeleteModal'
import { Select } from '@/components/ui/Select'
import { Input } from '@/components/ui/Input'
import { EmptyState } from '@/components/ui/EmptyState'
import { useWallet } from '@/hooks/useWallet'
import { useCrudModal } from '@/hooks/useCrudModal'
import { useToastStore } from '@/stores/toast.store'
import { cn, formatMYR, errorMessage, todayISO } from '@/lib/utils'
import { dayOfMonth, daysInMonth, monthKey, addDaysISO } from '@/modules/wallet/dashboard/insights'
import { AHEAD_OF_PACE_THRESHOLD } from '@/modules/wallet/dashboard/BudgetPace'
import {
  generateBudgetSuggestions, computeBudgetVsActual, effectiveLimit, budgetStatus, topOverspendCategories,
  BUDGET_STATUS_DISPLAY, type CategorySpendHistory, type BudgetSuggestion, type BudgetStatusLevel,
} from '@/modules/wallet/budgets/insights'
import { BudgetSuggestions } from '@/modules/wallet/budgets/BudgetSuggestions'
import { BudgetVsActualChart } from '@/modules/wallet/budgets/BudgetVsActualChart'
import type { Budget } from '@/types/wallet.types'

interface BudgetFormData {
  categoryId: string
  limitAmount: string
}

/** The per-row pace track's fill colour — status-derived (not the category's own colour, which the `.cat-dot` already carries), so the bar itself still reads as a pace signal at a glance. */
const STATUS_TRACK_COLOR: Record<BudgetStatusLevel, string> = {
  over: 'rgb(var(--neg))',
  tight: 'rgb(var(--warn))',
  watch: 'rgb(var(--fg-faint))',
  'on-track': 'rgb(var(--pos))',
}

/** Table grid: Category | Pace | Spent | Left | Status | actions — matches the mock's 5 data columns (budgets.html) plus one trailing slot for the existing Edit/Delete icons, which the read-only mock has no equivalent of. */
const TABLE_COLUMNS = '200px 1fr 108px 108px 100px 64px'

export function BudgetsPage() {
  const {
    budgets, categories, loadBudgets, loadCategories, addBudget, updateBudget, deleteBudget, getBudgetSpending,
    getBudgetSpendingRange, getBudgetSpendingHistory,
  } = useWallet()
  const { addToast } = useToastStore()

  const crud = useCrudModal<Budget>()
  const [form, setForm] = useState<BudgetFormData>({ categoryId: '', limitAmount: '' })
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [period, setPeriod] = useState<'month' | 'rolling30'>('month')
  const [spending, setSpending] = useState<Map<string, number>>(new Map())
  const [rollingSpending, setRollingSpending] = useState<Map<string, number>>(new Map())
  const [spendingHistory, setSpendingHistory] = useState<CategorySpendHistory>(new Map())
  // Bug fix (post-Gate-2 review): `spendingHistory.size > 0` is not a
  // reliable "has it loaded" proxy — a genuinely empty history (no past spend
  // anywhere) is indistinguishable from "hasn't loaded yet" by size alone.
  // An explicit status instead: `effectiveLimit`/`topOverspendCategories`
  // must not apply rollover math against a history that isn't actually in —
  // whether still loading or because the fetch failed — or a rollover
  // budget's limit silently doubles (reads "no data" as "zero spend").
  const [historyStatus, setHistoryStatus] = useState<'loading' | 'loaded' | 'error'>('loading')

  const today = todayISO()
  const currentMonth = monthKey(today)

  useEffect(() => {
    loadCategories()
    loadBudgets()
    // B-15 residual: budget spend must reflect the user's EFFECTIVE share —
    // when they've split an expense, their own share_amount, not the full
    // transaction total. GET /budgets/spending computes this server-side as
    // one aggregate query, scoped to the caller's own transactions and
    // bounded to the current month.
    getBudgetSpending(currentMonth).then(setSpending)
    // FEAT-066: the trailing-30-day window for the "Rolling 30d" toggle —
    // fetched alongside the calendar-month figure above (not on toggle, so
    // switching tabs is instant) rather than lazily, since it's one more
    // cheap aggregate query, not a per-row fan-out.
    // A failed fetch must not render identically to "nothing spent" — say so
    // (CLAUDE.md §2 rule 10), matching the history fetch's convention below.
    getBudgetSpendingRange(addDaysISO(today, -29), today)
      .then(setRollingSpending)
      .catch((err) => addToast({ message: errorMessage(err, 'Could not load the last 30 days of spending — try the month view instead.'), duration: 4000 }))
    // FEAT-018: 6 months of per-category spend — the suggestions engine's
    // only input besides the budgets/categories already loaded above. A
    // failed fetch must not render identically to "no suggestions" — say so.
    getBudgetSpendingHistory(6)
      .then((history) => { setSpendingHistory(history); setHistoryStatus('loaded') })
      .catch((err) => {
        setHistoryStatus('error')
        addToast({ message: errorMessage(err, 'Could not load spending history — suggestions may be incomplete.'), duration: 4000 })
      })
  }, [loadBudgets, loadCategories, getBudgetSpending, getBudgetSpendingRange, getBudgetSpendingHistory, addToast, today, currentMonth])

  // Only true once the history fetch has actually succeeded — `effectiveLimit`
  // and `topOverspendCategories` fall back to the raw, undoubled limit for
  // both the 'loading' and 'error' states (F1 above).
  const historyReady = historyStatus === 'loaded'

  const categoryName = useMemo(() => new Map(categories.map((c) => [c.id, c.name])), [categories])

  const suggestions = useMemo(
    () => generateBudgetSuggestions(budgets, categories, spendingHistory, today),
    [budgets, categories, spendingHistory, today],
  )

  const overspendShare = useMemo(
    () => topOverspendCategories(budgets, categoryName, spending, spendingHistory, currentMonth, historyReady),
    [budgets, categoryName, spending, spendingHistory, currentMonth, historyReady],
  )

  const budgetVsActual = useMemo(
    () => computeBudgetVsActual(budgets, spendingHistory, today),
    [budgets, spendingHistory, today],
  )

  const handleReallocate = useCallback(async (s: Extract<BudgetSuggestion, { type: 'reallocate' }>) => {
    const fromBudget = budgets.find((b) => b.categoryId === s.fromCategoryId)
    const toBudget = budgets.find((b) => b.categoryId === s.toCategoryId)
    // Stale suggestion — its budget was edited/deleted elsewhere since this
    // row was computed. Refresh rather than silently doing nothing.
    if (!fromBudget || !toBudget) {
      addToast({ message: 'That budget has changed — refreshing suggestions.', duration: 4000 })
      loadBudgets()
      return
    }
    try {
      await updateBudget(fromBudget.id, { limitAmount: fromBudget.limitAmount - s.amount })
    } catch (err) {
      // A thrown error here (network/4xx) means the write did NOT apply —
      // safe to tell the user to just retry.
      addToast({ message: errorMessage(err, `Could not reduce ${s.fromCategoryName}'s limit — please try again.`), duration: 4000 })
      return
    }
    try {
      await updateBudget(toBudget.id, { limitAmount: toBudget.limitAmount + s.amount })
    } catch (err) {
      // Unlike the donor write above, we can't assume this one didn't apply
      // (a lost response after the server committed it looks identical to a
      // real failure) — reload from the server rather than trust local state,
      // and tell the user to verify rather than "raise it manually", which
      // would double-apply if the write actually went through.
      await loadBudgets()
      addToast({
        message: errorMessage(
          err,
          `Moved ${formatMYR(s.amount)} out of ${s.fromCategoryName} — check ${s.toCategoryName}'s limit before changing it, the update may not have reached it.`,
        ),
        duration: 6000,
      })
      return
    }
    addToast({ message: `Moved ${formatMYR(s.amount)} from ${s.fromCategoryName} to ${s.toCategoryName}.`, duration: 4000 })
  }, [budgets, updateBudget, addToast, loadBudgets])

  const handleRightSize = useCallback(async (s: Extract<BudgetSuggestion, { type: 'right-size' }>) => {
    const budget = budgets.find((b) => b.categoryId === s.categoryId)
    if (!budget) {
      addToast({ message: 'That budget has changed — refreshing suggestions.', duration: 4000 })
      loadBudgets()
      return
    }
    try {
      await updateBudget(budget.id, { limitAmount: s.suggestedLimit })
      addToast({ message: `${s.categoryName}'s limit is now ${formatMYR(s.suggestedLimit)}.`, duration: 4000 })
    } catch (err) {
      // Reload rather than trust local state — an error here can still mean
      // a lost response after the server actually committed the write.
      await loadBudgets()
      addToast({ message: errorMessage(err, `Could not confirm ${s.categoryName}'s new limit — please check it before changing it again.`), duration: 4000 })
    }
  }, [budgets, updateBudget, addToast, loadBudgets])

  const handleCreateMissing = useCallback(async (s: Extract<BudgetSuggestion, { type: 'create-missing' }>) => {
    try {
      await addBudget({ categoryId: s.categoryId, limitAmount: s.avgMonthlySpend })
      addToast({ message: `Created a ${formatMYR(s.avgMonthlySpend)} budget for ${s.categoryName}.`, duration: 4000 })
    } catch (err) {
      // Reload first — a lost response after the server actually created the
      // budget would otherwise let a retry create a second one for the same category.
      await loadBudgets()
      addToast({ message: errorMessage(err, `Could not confirm the ${s.categoryName} budget was created — check before creating it again.`), duration: 4000 })
    }
  }, [addBudget, addToast, loadBudgets])

  const handleRollForward = useCallback(async (s: Extract<BudgetSuggestion, { type: 'roll-forward' }>) => {
    const budget = budgets.find((b) => b.categoryId === s.categoryId)
    if (!budget) {
      addToast({ message: 'That budget has changed — refreshing suggestions.', duration: 4000 })
      loadBudgets()
      return
    }
    try {
      await updateBudget(budget.id, { rolloverEnabled: true })
      addToast({ message: `${s.categoryName} now rolls its unused limit forward.`, duration: 4000 })
    } catch (err) {
      // Reload rather than trust local state — an error here can still mean
      // a lost response after the server actually committed the write.
      await loadBudgets()
      addToast({ message: errorMessage(err, `Could not confirm rollover was enabled for ${s.categoryName} — please check before trying again.`), duration: 4000 })
    }
  }, [budgets, updateBudget, addToast, loadBudgets])

  const openCreate = useCallback(() => {
    setForm({ categoryId: '', limitAmount: '' })
    setFormError(null)
    crud.openCreate()
  }, [crud])

  const openEdit = useCallback((budget: Budget) => {
    setForm({ categoryId: budget.categoryId, limitAmount: String(budget.limitAmount) })
    setFormError(null)
    crud.openEdit(budget)
  }, [crud])

  const handleSubmit = useCallback(async () => {
    const limit = parseFloat(form.limitAmount)
    // U-04: tell the user why the form won't submit instead of doing nothing.
    if (!form.categoryId) { setFormError('Choose a category.'); return }
    if (isNaN(limit) || limit <= 0) { setFormError('Enter a limit greater than 0.'); return }
    setFormError(null)
    setSaving(true)
    try {
      if (crud.editingItem) {
        await updateBudget(crud.editingItem.id, { limitAmount: limit })
      } else {
        await addBudget({ categoryId: form.categoryId, limitAmount: limit })
      }
      crud.closeForm(false)
    } catch (err) {
      addToast({ message: errorMessage(err, 'Could not save budget — please try again.'), duration: 4000 })
    } finally {
      setSaving(false)
    }
  }, [form, crud, addBudget, updateBudget, addToast])

  const handleDelete = useCallback(async (id: string) => {
    try {
      await deleteBudget(id)
      crud.closeDelete()
    } catch (err) {
      addToast({ message: errorMessage(err, 'Could not delete budget — please try again.'), duration: 4000 })
    }
  }, [deleteBudget, crud, addToast])

  // Pace: where you SHOULD be today, same day-of-month elapsed fraction
  // `BudgetPace` (dashboard/BudgetPace.tsx) uses for its notch — this page is
  // always the current month (no date-range picker), so it's always in
  // progress and never needs that component's multi-month scaling. Rolling
  // 30d has no "day N of the period" to project a pace from (FEAT-066 AC) —
  // the notch, the pace chip and the band's Projected-finish/On-track stats
  // are all gated on `isMonthMode` below.
  const isMonthMode = period === 'month'
  const day = dayOfMonth(today)
  const monthLength = daysInMonth(currentMonth)
  const elapsed = day / monthLength
  const daysRemaining = monthLength - day
  const monthLabel = format(parseISO(`${currentMonth}-01`), 'MMMM')
  const monthLabelShort = format(parseISO(`${currentMonth}-01`), 'MMM')
  const lastDayLabel = `${monthLength} ${monthLabelShort}`

  const activeSpending = isMonthMode ? spending : rollingSpending

  // A 30-day trailing window has no "day N of 31" to be ahead or behind —
  // it's always "complete" by definition. Feeding it the calendar month's
  // elapsed fraction into `budgetStatus` would compare a full rolling sum
  // against a tiny early-month fraction and call almost everything "Over
  // pace" on day 2. Passing 1 instead collapses the pace-dependent tiers
  // (aheadPts is never positive unless genuinely over) to the two that are
  // still honest for a window with no partial-period concept: over the
  // limit, or using most of it ("Watch") — matching the Rolling 30d band's
  // own choice to drop pace/projection entirely (FEAT-066 AC).
  const statusElapsed = isMonthMode ? elapsed : 1

  // Summary-band figures. `effectiveLimit` folds in last month's rollover —
  // every "limit" read here and in the table below goes through it, never
  // raw `limitAmount` (FEAT-066 AC), except the row sub-text which
  // deliberately shows the configured limit so rollover's effect is visible.
  const totalBudgeted = budgets.reduce((sum, b) => sum + effectiveLimit(b, spendingHistory, currentMonth, historyReady), 0)
  const totalSpent = budgets.reduce((sum, b) => sum + (activeSpending.get(b.categoryId) ?? 0), 0)
  const monthPct = totalBudgeted > 0 ? Math.min((totalSpent / totalBudgeted) * 100, 100) : 0

  const leftToSpend = totalBudgeted - totalSpent
  const perDay = daysRemaining > 0 ? leftToSpend / daysRemaining : leftToSpend
  const projected = elapsed > 0 ? totalSpent / elapsed : totalSpent
  const projectedOver = projected > totalBudgeted ? projected - totalBudgeted : null
  const shouldBeAt = totalBudgeted * elapsed

  const statusByBudgetId = new Map(
    budgets.map((b) => [
      b.id,
      budgetStatus(activeSpending.get(b.categoryId) ?? 0, effectiveLimit(b, spendingHistory, currentMonth, historyReady), statusElapsed),
    ]),
  )
  const onTrackCount = budgets.filter((b) => {
    const s = statusByBudgetId.get(b.id)
    return s === 'on-track' || s === 'watch'
  }).length
  const needsAttentionCount = budgets.length - onTrackCount

  const aheadPoints = totalBudgeted > 0 ? Math.round((totalSpent / totalBudgeted - elapsed) * 100) : 0

  // Bug fix (post-Gate-2 review): this was still comparing against the
  // calendar-month `elapsed` fraction, the exact "no pace concept in a
  // trailing 30-day window" problem `statusElapsed` exists to fix for the
  // per-row chips below. In Rolling 30d mode (`statusElapsed` pinned to 1),
  // `monthPct / 100 > 1 + AHEAD_OF_PACE_THRESHOLD` can never be true since
  // monthPct is capped at 100 — so this collapses to the two tiers that are
  // still honest without a partial-period concept: over the limit, or not.
  const fillColor = totalSpent > totalBudgeted
    ? 'rgb(var(--neg))'
    : monthPct / 100 > statusElapsed + AHEAD_OF_PACE_THRESHOLD
      ? 'rgb(var(--warn))'
      : 'rgb(var(--pos))'

  const expenseCategories = categories.filter((c) => c.type === 'expense' || c.type === 'both')
  const usedCategoryIds = new Set(budgets.map((b) => b.categoryId))
  const availableCategories = crud.editingItem
    ? expenseCategories
    : expenseCategories.filter((c) => !usedCategoryIds.has(c.id))

  return (
    <div className="mx-auto max-w-5xl">
      {/* Header */}
      <div className="page-head">
        <h1 className="page-title">Budgets</h1>
        <span className="page-sub hide-mobile">{monthLabel} · {daysRemaining} days left</span>
        <div className="page-actions">
          <div className="segment" role="tablist">
            <button type="button" role="tab" aria-selected={isMonthMode} onClick={() => setPeriod('month')}>
              {monthLabel}
            </button>
            <button type="button" role="tab" aria-selected={!isMonthMode} onClick={() => setPeriod('rolling30')}>
              Rolling 30d
            </button>
          </div>
          <Button
            size="sm"
            onClick={openCreate}
            disabled={availableCategories.length === 0}
            title={availableCategories.length === 0 ? 'Every expense category already has a budget' : undefined}
          >
            <Plus className="h-3.5 w-3.5" />
            Add Budget
          </Button>
        </div>
      </div>

      {budgets.length === 0 ? (
        <EmptyState
          icon={<PieChart className="h-10 w-10" />}
          title="No budgets yet"
          description="Set a monthly spend limit per category to track how much you have left."
          action={
            availableCategories.length > 0
              ? <Button size="sm" onClick={openCreate}>Add your first budget</Button>
              : undefined
          }
        />
      ) : (
        <div className="dash">
          {/* Month summary band */}
          <section className="card card-pad c12">
            <div className="card-head">
              <div>
                <div className="card-title">{isMonthMode ? monthLabel : 'Rolling 30 days'}</div>
                {isMonthMode && (
                  <div className="card-sub">
                    You are {Math.round(elapsed * 100)}% through the month and {Math.round(monthPct)}% through the money
                  </div>
                )}
              </div>
              {isMonthMode && aheadPoints > 0 && (
                <span className="chip chip-warn" style={{ marginLeft: 'auto' }}>{aheadPoints} points ahead of pace</span>
              )}
            </div>

            <div className="band">
              <div className="band-main">
                <div className="band-fig">
                  <span className="v">{formatMYR(totalSpent)}</span>
                  <span className="k">of {formatMYR(totalBudgeted)} budgeted</span>
                </div>
              </div>
              {isMonthMode && (
                <div className="band-stats">
                  <div className="band-stat">
                    <div className="k">Left to spend</div>
                    <div className="v">{formatMYR(leftToSpend)}</div>
                    {daysRemaining > 0 && (
                      // N3 fix: once spend has already passed the total budget,
                      // `perDay` goes negative — "RM -50.00 a day" reads like a
                      // typo, not a rate. Name the overage instead of dividing it.
                      leftToSpend >= 0
                        ? <div className="s">{formatMYR(perDay)} a day for {daysRemaining} days</div>
                        : <div className="s" style={{ color: 'rgb(var(--neg-fg))' }}>{formatMYR(Math.abs(leftToSpend))} over already</div>
                    )}
                  </div>
                  <div className="band-stat">
                    <div className="k">Projected finish</div>
                    <div className="v">{formatMYR(projected)}</div>
                    {/* N2 fix: a favourable projection used to leave this stat's
                        sub-line silently blank — show how much room is left too. */}
                    {projectedOver !== null
                      ? <div className="s" style={{ color: 'rgb(var(--neg-fg))' }}>{formatMYR(projectedOver)} over</div>
                      : <div className="s">{formatMYR(totalBudgeted - projected)} under</div>}
                  </div>
                  <div className="band-stat">
                    <div className="k">On track</div>
                    <div className="v">{onTrackCount} of {budgets.length}</div>
                    {needsAttentionCount > 0 && <div className="s">{needsAttentionCount} need attention</div>}
                  </div>
                </div>
              )}
            </div>

            {isMonthMode ? (
              <>
                <div className="budget-track" style={{ height: 10, marginTop: 'var(--s5)' }}>
                  <div className="budget-fill" style={{ width: `${monthPct}%`, background: fillColor }} />
                  <div className="budget-mark" style={{ left: `${Math.min(99.5, elapsed * 100)}%`, top: -4, bottom: -4, opacity: 1 }} />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 'var(--s2)', fontSize: 'var(--t-xs)', color: 'rgb(var(--fg-subtle))' }}>
                  <span>1 {monthLabelShort}</span>
                  <span style={{ color: 'rgb(var(--fg))', fontWeight: 600 }} data-testid="budget-pace-caption">
                    today — you should be at {formatMYR(shouldBeAt)}
                  </span>
                  <span>{lastDayLabel}</span>
                </div>
              </>
            ) : (
              // FEAT-066 AC: a trailing window has no "day N of the period" to
              // project a pace from — plain fill, no notch, no caption.
              <div className="budget-track" style={{ height: 10, marginTop: 'var(--s5)' }}>
                <div className="budget-fill" style={{ width: `${monthPct}%`, background: fillColor }} />
              </div>
            )}
          </section>

          {/* Per category */}
          <section className="card card-pad c12">
            <div className="card-head">
              <div className="card-title">By category</div>
              {isMonthMode && (
                <div className="card-sub" style={{ marginLeft: 'auto' }}>The line marks where each should be on day {day}</div>
              )}
            </div>

            <div className="lhead" style={{ gridTemplateColumns: TABLE_COLUMNS }}>
              <span>Category</span><span>Pace</span><span className="num">Spent</span><span className="num">Left</span><span className="num">Status</span><span />
            </div>

            {budgets.map((budget) => {
              const category = categories.find((c) => c.id === budget.categoryId)
              const limit = effectiveLimit(budget, spendingHistory, currentMonth, historyReady)
              const spent = activeSpending.get(budget.categoryId) ?? 0
              const left = limit - spent
              const ratio = limit > 0 ? spent / limit : 0
              const pct = Math.min(ratio * 100, 100)
              const status = budgetStatus(spent, limit, statusElapsed)
              const { label, chipClass } = BUDGET_STATUS_DISPLAY[status]

              return (
                <div key={budget.id} data-testid="budget-row" className="lrow" style={{ gridTemplateColumns: TABLE_COLUMNS }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s3)', minWidth: 0 }}>
                    <span className="cat-dot" style={{ background: category?.color ?? 'rgb(var(--fg-faint))' }} />
                    <span style={{ minWidth: 0 }}>
                      <span className="tname" style={{ fontSize: 'var(--t-sm)', display: 'block' }}>{category?.name ?? 'Unknown'}</span>
                      <span className="tsub" style={{ display: 'block' }}>{formatMYR(budget.limitAmount)} limit</span>
                    </span>
                  </div>
                  <div
                    data-testid="budget-progress"
                    className="budget-track"
                    style={{ margin: 0 }}
                    role="img"
                    aria-label={
                      `${category?.name ?? 'This category'}: ${Math.round(ratio * 100)}% of budget used` +
                      (isMonthMode ? `, ${Math.round(elapsed * 100)}% of the month elapsed` : '') +
                      ` — ${label.toLowerCase()}.`
                    }
                  >
                    <div className="budget-fill" style={{ width: `${pct}%`, background: STATUS_TRACK_COLOR[status] }} />
                    {isMonthMode && (
                      <div data-testid="budget-pace-notch" className="budget-mark" style={{ left: `${Math.min(99.5, elapsed * 100)}%` }} />
                    )}
                  </div>
                  <div className="num money" style={{ fontWeight: 600 }}>{formatMYR(spent)}</div>
                  <div className="num money">{formatMYR(left)}</div>
                  <div className="num"><span className={cn('chip', chipClass)} data-testid="budget-status-chip">{label}</span></div>
                  {/* opacity:1 override — `.lrow .trow-actions` defaults to hover-reveal
                      (B6, data.css), but a budget limit is edited/deleted far less
                      often per visit than a transaction row, and this page's old
                      design always showed these icons; hover-only would be a quiet
                      regression, not a style update. */}
                  <div className="trow-actions" style={{ justifyContent: 'flex-end', opacity: 1 }}>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => openEdit(budget)}
                      aria-label={`Edit ${category?.name ?? 'budget'} budget`}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-fg-subtle hover:text-red-600"
                      onClick={() => crud.openDelete(budget.id)}
                      aria-label={`Delete ${category?.name ?? 'budget'} budget`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              )
            })}
          </section>

          <BudgetVsActualChart points={budgetVsActual} className="c7" />

          <BudgetSuggestions
            suggestions={suggestions}
            overspendShare={overspendShare}
            onReallocate={handleReallocate}
            onRightSize={handleRightSize}
            onCreateMissing={handleCreateMissing}
            onRollForward={handleRollForward}
          />
        </div>
      )}

      {/* Add / Edit modal */}
      <Modal
        open={crud.formOpen}
        onOpenChange={crud.closeForm}
        title={crud.editingItem ? 'Edit Budget' : 'New Budget'}
      >
        <div className="flex flex-col gap-4">
          <Select
            label="Category"
            id="budget-category"
            options={availableCategories.map((c) => ({ value: c.id, label: c.name }))}
            placeholder="Select category"
            value={form.categoryId}
            onChange={(e) => setForm((f) => ({ ...f, categoryId: e.target.value }))}
            disabled={!!crud.editingItem}
          />
          <Input
            label="Limit"
            id="limit-amount"
            type="number"
            min="0"
            step="0.01"
            placeholder="500"
            value={form.limitAmount}
            onChange={(e) => setForm((f) => ({ ...f, limitAmount: e.target.value }))}
          />
          <p className="-mt-1 text-xs text-fg-subtle">
            Budgets reset <span className="font-medium text-fg-muted">monthly</span>.
          </p>
          {formError && <p className="-mt-1 text-xs text-red-600">{formError}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" size="sm" onClick={() => crud.closeForm(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleSubmit} loading={saving}>
              {crud.editingItem ? 'Save Changes' : 'Create Budget'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Delete confirm modal */}
      <ConfirmDeleteModal
        open={!!crud.confirmDeleteId}
        onOpenChange={(open) => { if (!open) crud.closeDelete() }}
        title="Delete budget?"
        description="This will remove the monthly limit for this category. Transactions are not affected."
        onConfirm={() => crud.confirmDeleteId && handleDelete(crud.confirmDeleteId)}
      />
    </div>
  )
}
