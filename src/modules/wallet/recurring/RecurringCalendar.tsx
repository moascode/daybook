import { formatMYR } from '@/lib/utils'
import { occurrencesInMonth } from '@/modules/wallet/recurring/insights'
import type { Category, RecurringTransaction } from '@/types/wallet.types'

interface RecurringCalendarProps {
  rules: RecurringTransaction[]
  categories: Category[]
  today: string
  monthName: string
}

const DOW_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

interface DayCell {
  date: string
  dayOfMonth: number
  inMonth: boolean
  isToday: boolean
}

function buildMonthGrid(year: number, month: number, today: string): DayCell[] {
  const firstOfMonth = new Date(year, month - 1, 1)
  // Mon-first: JS getDay() is 0=Sun..6=Sat; shift so Monday is 0.
  const leadingBlank = (firstOfMonth.getDay() + 6) % 7
  const daysInMonth = new Date(year, month, 0).getDate()
  const cells: DayCell[] = []

  for (let i = leadingBlank; i > 0; i--) {
    const d = new Date(year, month - 1, 1 - i)
    cells.push({ date: toISO(d), dayOfMonth: d.getDate(), inMonth: false, isToday: false })
  }
  for (let day = 1; day <= daysInMonth; day++) {
    const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    cells.push({ date, dayOfMonth: day, inMonth: true, isToday: date === today })
  }
  while (cells.length % 7 !== 0) {
    const last = cells[cells.length - 1]
    const [ly, lm, ld] = last.date.split('-').map(Number)
    // `new Date(last.date)` parses 'YYYY-MM-DD' as UTC midnight, which lands
    // on the wrong local day in negative-UTC-offset timezones — build the
    // local Date from components instead (CLAUDE.md §3 Tests trap).
    const d = new Date(ly, lm - 1, ld)
    d.setDate(d.getDate() + 1)
    cells.push({ date: toISO(d), dayOfMonth: d.getDate(), inMonth: false, isToday: false })
  }
  return cells
}

function toISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** "{Month}" calendar — every active recurring charge, on the day it lands. Mon-first, current month only (FEAT-068). */
export function RecurringCalendar({ rules, categories, today, monthName }: RecurringCalendarProps) {
  const [year, month] = today.split('-').map(Number)
  const cells = buildMonthGrid(year, month, today)

  const activeRules = rules.filter((r) => !r.paused)
  const categoryColor = (categoryId: string | null): string =>
    categoryId ? categories.find((c) => c.id === categoryId)?.color ?? 'rgb(var(--fg-subtle))' : 'rgb(var(--fg-subtle))'

  // date -> { expenseDots: color[], expenseTotal, incomeTotal }
  const byDate = new Map<string, { dots: string[]; expenseTotal: number; incomeTotal: number }>()
  for (const rule of activeRules) {
    for (const date of occurrencesInMonth(rule, year, month, today)) {
      if (!byDate.has(date)) byDate.set(date, { dots: [], expenseTotal: 0, incomeTotal: 0 })
      const entry = byDate.get(date)!
      if (rule.type === 'income') {
        entry.dots.push('rgb(var(--pos))')
        entry.incomeTotal += rule.amount
      } else {
        entry.dots.push(categoryColor(rule.categoryId))
        entry.expenseTotal += rule.amount
      }
    }
  }

  const categoriesPresent = [...new Set(activeRules.filter((r) => r.type === 'expense' && r.categoryId).map((r) => r.categoryId!))]
    .map((id) => categories.find((c) => c.id === id))
    .filter((c): c is Category => !!c)
  const hasUncategorised = activeRules.some((r) => r.type === 'expense' && !r.categoryId)
  const hasIncome = activeRules.some((r) => r.type === 'income')

  return (
    <section className="card card-pad c12" data-testid="recurring-calendar">
      <div className="card-head">
        <div>
          <div className="card-title">{monthName}</div>
          <div className="card-sub">Every recurring charge, on the day it lands</div>
        </div>
        <div className="legend" style={{ marginLeft: 'auto' }}>
          {categoriesPresent.map((c) => (
            <span key={c.id}>
              <i style={{ background: c.color, width: 8, height: 8, borderRadius: 99 }} />{c.name}
            </span>
          ))}
          {hasUncategorised && (
            <span>
              <i style={{ background: 'rgb(var(--fg-subtle))', width: 8, height: 8, borderRadius: 99 }} />Uncategorised
            </span>
          )}
          {hasIncome && (
            <span>
              <i style={{ background: 'rgb(var(--pos))', width: 8, height: 8, borderRadius: 99 }} />Income
            </span>
          )}
        </div>
      </div>

      <div className="cal" style={{ marginBottom: 6 }}>
        {DOW_LABELS.map((label) => <div className="cal-dow" key={label}>{label}</div>)}
      </div>
      <div className="cal">
        {cells.map((cell) => {
          const entry = byDate.get(cell.date)
          return (
            <div
              key={cell.date}
              className={`cal-day${cell.inMonth ? '' : ' muted'}${cell.isToday ? ' today' : ''}`}
              data-testid="recurring-cal-day"
            >
              <span className="cal-n">{cell.dayOfMonth}</span>
              {entry && entry.dots.length > 0 && (
                <>
                  <span className="cal-dots">
                    {entry.dots.map((color, i) => <i key={i} style={{ background: color }} />)}
                  </span>
                  {entry.expenseTotal > 0 && <span className="cal-amt">{formatMYR(entry.expenseTotal)}</span>}
                  {entry.incomeTotal > 0 && (
                    <span className="cal-amt" style={{ color: 'rgb(var(--pos-fg))' }}>+{formatMYR(entry.incomeTotal)}</span>
                  )}
                </>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
