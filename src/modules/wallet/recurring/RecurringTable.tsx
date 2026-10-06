import { useMemo, useState } from 'react'
import { Search, ArrowUp, Receipt } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { formatMYR } from '@/lib/utils'
import { annualCost, normaliseMerchant, type PriceRise } from '@/modules/wallet/recurring/insights'
import { RecurringRowMenu } from '@/modules/wallet/recurring/RecurringRowMenu'
import type { Account, Category, RecurringTransaction } from '@/types/wallet.types'

interface RecurringTableProps {
  rules: RecurringTransaction[]
  accounts: Account[]
  categories: Category[]
  priceRises: PriceRise[]
  today: string
  onPostNow: (rule: RecurringTransaction) => void
  onEdit: (rule: RecurringTransaction) => void
  onTogglePause: (rule: RecurringTransaction) => void
  onDelete: (rule: RecurringTransaction) => void
}

type SegmentValue = 'active' | 'paused' | 'all'

const ORDINAL_SUFFIX = (day: number): string => {
  if (day >= 11 && day <= 13) return 'th'
  switch (day % 10) {
    case 1: return 'st'
    case 2: return 'nd'
    case 3: return 'rd'
    default: return 'th'
  }
}

function cadenceLabel(rule: RecurringTransaction): string {
  if (rule.frequency === 'weekly') {
    return `Weekly · ${format(parseISO(rule.nextDueDate), 'EEE')}`
  }
  const [y, m, d] = rule.nextDueDate.split('-').map(Number)
  const lastDayOfMonth = new Date(y, m, 0).getDate()
  if (d === lastDayOfMonth) return 'Monthly · last day'
  return `Monthly · ${d}${ORDINAL_SUFFIX(d)}`
}

function nextLabel(rule: RecurringTransaction, today: string): string {
  if (rule.paused) return 'Paused'
  const [ty, tm, td] = today.split('-').map(Number)
  const tomorrow = new Date(ty, tm - 1, td + 1)
  const tomorrowISO = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`
  if (rule.nextDueDate === today) return 'Today'
  if (rule.nextDueDate === tomorrowISO) return 'Tomorrow'
  return format(parseISO(rule.nextDueDate), 'd MMM')
}

/** "All recurring" — filter + Active/Paused/All segment, first-8 collapse, and the per-row ⋯ menu (FEAT-068). */
export function RecurringTable({ rules, accounts, categories, priceRises, today, onPostNow, onEdit, onTogglePause, onDelete }: RecurringTableProps) {
  const [filter, setFilter] = useState('')
  const [segment, setSegment] = useState<SegmentValue>('active')
  const [showAll, setShowAll] = useState(false)

  const pausedCount = rules.filter((r) => r.paused).length

  const priceRiseByRuleId = useMemo(() => new Map(priceRises.map((r) => [r.rule.id, r])), [priceRises])

  const bySegment = useMemo(() => {
    if (segment === 'active') return rules.filter((r) => !r.paused)
    if (segment === 'paused') return rules.filter((r) => r.paused)
    return rules
  }, [rules, segment])

  const filtered = useMemo(() => {
    const q = normaliseMerchant(filter)
    if (q === '') return bySegment
    return bySegment.filter((r) => {
      const account = accounts.find((a) => a.id === r.accountId)
      const category = r.categoryId ? categories.find((c) => c.id === r.categoryId) : undefined
      const haystack = normaliseMerchant(`${r.merchant} ${account?.name ?? ''} ${category?.name ?? ''}`)
      return haystack.includes(q)
    })
  }, [bySegment, filter, accounts, categories])

  const visible = showAll ? filtered : filtered.slice(0, 8)

  return (
    <section className="card card-pad c12" data-testid="recurring-table">
      <div className="card-head">
        <div className="card-title">All recurring</div>
        <div className="filters" style={{ marginLeft: 'auto' }}>
          <label className="filter-field" style={{ maxWidth: 220 }}>
            <Search className="h-3.5 w-3.5" />
            <input
              type="search"
              placeholder={`Filter these ${rules.length}…`}
              aria-label="Filter recurring items"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </label>
          <div className="segment" role="tablist">
            <button role="tab" aria-selected={segment === 'active'} onClick={() => { setSegment('active'); setShowAll(false) }}>Active</button>
            <button role="tab" aria-selected={segment === 'paused'} onClick={() => { setSegment('paused'); setShowAll(false) }}>Paused</button>
            <button role="tab" aria-selected={segment === 'all'} onClick={() => { setSegment('all'); setShowAll(false) }}>All</button>
          </div>
        </div>
      </div>

      <div className="lhead">
        <span>Item</span>
        <span className="col-hide-md">Cadence</span>
        <span className="col-hide-md">Next</span>
        <span className="col-hide-md num">Annual</span>
        <span className="num">Amount</span>
        <span></span>
      </div>

      {visible.map((rule) => {
        const account = accounts.find((a) => a.id === rule.accountId)
        const category = rule.categoryId ? categories.find((c) => c.id === rule.categoryId) : undefined
        const isIncome = rule.type === 'income'
        const rise = priceRiseByRuleId.get(rule.id)
        const subParts = [account?.name, isIncome ? 'income' : (category?.name ?? 'Uncategorised')].filter(Boolean)

        return (
          <div key={rule.id} className="lrow" data-testid="recurring-row">
            <div className="tlead">
              <div
                className="tavatar"
                style={{
                  background: isIncome ? 'rgb(var(--pos-bg))' : `color-mix(in srgb, ${category?.color ?? 'rgb(var(--fg-subtle))'} 16%, transparent)`,
                  color: isIncome ? 'rgb(var(--pos-fg))' : (category?.color ?? 'rgb(var(--fg-subtle))'),
                }}
              >
                {isIncome ? <ArrowUp className="h-3.5 w-3.5" /> : <Receipt className="h-3.5 w-3.5" />}
              </div>
              <div style={{ minWidth: 0 }}>
                <div className="tname">
                  {rule.merchant || '(no merchant)'}
                  {rise && <span className="chip chip-warn" style={{ marginLeft: 4 }}>+{formatMYR(rise.delta)} in {rise.changedMonth}</span>}
                  {rule.paused && <span className="chip chip-mute" style={{ marginLeft: 4 }}>Paused</span>}
                </div>
                <div className="tsub">{subParts.join(' · ')}</div>
              </div>
            </div>
            <div className="tmeta col-hide-md">{cadenceLabel(rule)}</div>
            <div className="tmeta col-hide-md">{nextLabel(rule, today)}</div>
            <div className="tmeta col-hide-md num money">{formatMYR(annualCost(rule))}</div>
            <div className={`num amt money ${isIncome ? 'pos' : 'neg'}`}>
              {isIncome ? '+' : ''}{formatMYR(rule.amount)}
            </div>
            <div className="trow-actions">
              <RecurringRowMenu
                rule={rule}
                onPostNow={() => onPostNow(rule)}
                onEdit={() => onEdit(rule)}
                onTogglePause={() => onTogglePause(rule)}
                onDelete={() => onDelete(rule)}
              />
            </div>
          </div>
        )
      })}

      <div className="divider" />
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s3)' }}>
        <span style={{ fontSize: 'var(--t-sm)', color: 'rgb(var(--fg-subtle))' }}>
          {/* Denominator always matches the current segment + filter, never
              the unfiltered total — "paused" is only appended on the Active
              tab, keeping the AC's literal "Showing 8 of {n} active · {k}
              paused" wording there. */}
          Showing {visible.length} of {filtered.length}
          {segment === 'active' ? ` active · ${pausedCount} paused` : segment === 'paused' ? ' paused' : ''}
        </span>
        {filtered.length > 8 && (
          <button
            className="btn btn-secondary"
            style={{ marginLeft: 'auto' }}
            onClick={() => setShowAll((s) => !s)}
          >
            {showAll ? 'Show fewer' : 'Show all'}
          </button>
        )}
      </div>
    </section>
  )
}
