import { useCallback, useEffect, useRef, useState } from 'react'
import { MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { formatMYR } from '@/lib/utils'
import { goalColor, type GoalStatus } from '@/modules/wallet/goals/projection'
import type { Account, Goal } from '@/types/wallet.types'

interface GoalCardProps {
  goal: Goal
  account?: Account
  colorIndex: number
  saved: number
  /** `'unknown'` when /goals/flows failed to load — rate-derived text shows "—", not a chip. */
  status: GoalStatus | 'unknown'
  onEdit: () => void
  onDelete: () => void
}

const monthLabel = (monthKeyOrDate: string) => format(parseISO(`${monthKeyOrDate}-01`), 'MMM yyyy')

/** The status chip + sub-line text, exactly per FEAT-067's "Status copy" table. */
function statusDisplay(status: GoalStatus | 'unknown'): { chip: string | null; chipClass: string; sub: string } {
  if (status === 'unknown') return { chip: null, chipClass: '', sub: '—' }
  switch (status.kind) {
    case 'funded':
      return { chip: 'Funded', chipClass: 'chip-pos', sub: '' }
    case 'paused':
      return {
        chip: 'Paused',
        chipClass: 'chip-mute',
        sub: status.since ? `no contribution since ${format(parseISO(`${status.since}-01`), 'MMM yyyy')}` : 'no contributions yet',
      }
    case 'ahead':
      return {
        chip: 'Ahead',
        chipClass: 'chip-pos',
        sub: `done ${status.monthsEarly} month${status.monthsEarly === 1 ? '' : 's'} early`,
      }
    case 'onTrack':
      return { chip: 'On track', chipClass: 'chip-pos', sub: `full by ${monthLabel(status.eta)} · ${formatMYR(status.rate)}/mo` }
    case 'behind':
      return { chip: 'Behind', chipClass: 'chip-warn', sub: `needs ${formatMYR(status.needed)}/mo, getting ${formatMYR(status.rate)}` }
    case 'overdue':
      return { chip: 'Behind', chipClass: 'chip-warn', sub: `target was ${format(parseISO(status.targetDate), 'MMM yyyy')}` }
    case 'undated':
      return { chip: null, chipClass: '', sub: `full by ${monthLabel(status.eta)} · ${formatMYR(status.rate)}/mo` }
    case 'noFunding':
      return { chip: null, chipClass: '', sub: 'no current funding' }
  }
}

/** One goal card — SVG ring, status chip, note, and the ⋯ Edit/Delete menu (FEAT-067). */
export function GoalCard({ goal, account, colorIndex, saved, status, onEdit, onDelete }: GoalCardProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const anchorRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const editItemRef = useRef<HTMLButtonElement>(null)
  const deleteItemRef = useRef<HTMLButtonElement>(null)
  const menuId = `goal-menu-${goal.id}`

  const closeMenu = useCallback((returnFocus: boolean) => {
    setMenuOpen(false)
    if (returnFocus) triggerRef.current?.focus()
  }, [])

  // Focus the first item the moment the menu opens — a mouse click on the
  // trigger leaves focus there otherwise, so a keyboard user tabbing in
  // right after a click would skip straight past the menu.
  useEffect(() => {
    if (menuOpen) editItemRef.current?.focus()
  }, [menuOpen])

  useEffect(() => {
    if (!menuOpen) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        closeMenu(true)
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        // Only two items — Up/Down both just toggle focus between them.
        e.preventDefault()
        const onEditItem = document.activeElement === editItemRef.current
        ;(onEditItem ? deleteItemRef : editItemRef).current?.focus()
      }
    }
    const onClickOutside = (e: MouseEvent) => {
      if (anchorRef.current && !anchorRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('mousedown', onClickOutside)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('mousedown', onClickOutside)
    }
  }, [menuOpen, closeMenu])

  // Floored, not rounded, below target — a goal at 99.6% must never display
  // "100%" until it is actually funded (`saved >= targetAmount`).
  const pct = goal.targetAmount <= 0 ? 0 : saved >= goal.targetAmount ? 100 : Math.floor((saved / goal.targetAmount) * 100)
  const color = goalColor(colorIndex)
  const circumference = 251.3
  const dash = (pct / 100) * circumference
  const { chip, chipClass, sub } = statusDisplay(status)

  return (
    <div className="goal" data-testid="goal-card">
      <div className="ring" data-testid="goal-progress">
        <svg viewBox="0 0 92 92" role="img" aria-label={`${goal.name} is ${pct}% funded.`}>
          <circle cx="46" cy="46" r="40" stroke="rgb(var(--surface-hover))" />
          <circle cx="46" cy="46" r="40" stroke={color} strokeDasharray={`${dash} ${circumference}`} />
        </svg>
        <div className="ring-center">
          <span className="v">{pct}%</span>
          <span className="k">FUNDED</span>
        </div>
      </div>
      <div className="goal-main">
        <div className="goal-name">{goal.name}</div>
        {goal.note && <div className="goal-sub" data-testid="goal-note">{goal.note}</div>}
        {!goal.note && account && <div className="goal-sub">{account.name}</div>}
        <div className="goal-fig">{formatMYR(saved)} <span>of {formatMYR(goal.targetAmount)}</span></div>
        <div className="stat-foot">
          {chip && <span className={`chip ${chipClass}`} data-testid="goal-status">{chip}</span>}
          <span data-testid="goal-status-sub">{sub}</span>
        </div>
      </div>
      <div className="pop-anchor" ref={anchorRef}>
        <button
          ref={triggerRef}
          type="button"
          className="icon-btn"
          aria-label={`More actions for ${goal.name}`}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-controls={menuId}
          onClick={() => setMenuOpen((o) => !o)}
        >
          <MoreHorizontal className="h-3.5 w-3.5" />
        </button>
        <div
          id={menuId}
          className={`menu${menuOpen ? ' open' : ''}`}
          role="menu"
          style={{ right: 0, top: 'calc(100% + 4px)' }}
        >
          <button
            ref={editItemRef}
            type="button"
            role="menuitem"
            className="menu-item"
            onClick={() => { closeMenu(false); onEdit() }}
            aria-label={`Edit ${goal.name}`}
          >
            <Pencil className="h-3.5 w-3.5" />
            Edit
          </button>
          <button
            ref={deleteItemRef}
            type="button"
            role="menuitem"
            className="menu-item"
            onClick={() => { closeMenu(false); onDelete() }}
            aria-label={`Delete ${goal.name}`}
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete
          </button>
        </div>
      </div>
    </div>
  )
}
