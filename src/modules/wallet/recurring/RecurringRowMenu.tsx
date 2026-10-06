import { useCallback, useEffect, useRef, useState } from 'react'
import { MoreHorizontal, RefreshCw, Pencil, Pause, Play, Trash2 } from 'lucide-react'
import type { RecurringTransaction } from '@/types/wallet.types'

interface RecurringRowMenuProps {
  rule: RecurringTransaction
  onPostNow: () => void
  onEdit: () => void
  onTogglePause: () => void
  onDelete: () => void
}

/** The ⋯ menu on a recurring row — same focus/Esc/outside-click pattern as goals/GoalCard.tsx. */
export function RecurringRowMenu({ rule, onPostNow, onEdit, onTogglePause, onDelete }: RecurringRowMenuProps) {
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const firstItemRef = useRef<HTMLButtonElement>(null)
  const itemRefs = useRef<HTMLButtonElement[]>([])
  const menuId = `recurring-menu-${rule.id}`
  const name = rule.merchant || 'recurring rule'

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false)
    if (returnFocus) triggerRef.current?.focus()
  }, [])

  useEffect(() => {
    // Focus the first NON-disabled item — "Post now" is disabled when the
    // rule is paused, and focusing a disabled control strands keyboard focus.
    if (open) (itemRefs.current.find((el) => !el.disabled) ?? firstItemRef.current)?.focus()
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        close(true)
        return
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const items = itemRefs.current.filter((el) => !el.disabled)
        const idx = items.indexOf(document.activeElement as HTMLButtonElement)
        const next = e.key === 'ArrowDown' ? (idx + 1) % items.length : (idx - 1 + items.length) % items.length
        items[next]?.focus()
      }
    }
    const onClickOutside = (e: MouseEvent) => {
      if (anchorRef.current && !anchorRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('mousedown', onClickOutside)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('mousedown', onClickOutside)
    }
  }, [open, close])

  const setItemRef = (i: number) => (el: HTMLButtonElement | null) => {
    if (el) itemRefs.current[i] = el
  }

  return (
    <div className="pop-anchor" ref={anchorRef} style={{ position: 'relative' }}>
      <button
        ref={triggerRef}
        type="button"
        className="icon-btn"
        aria-label={`More actions for ${name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((o) => !o)}
      >
        <MoreHorizontal className="h-3.5 w-3.5" />
      </button>
      <div id={menuId} className={`menu${open ? ' open' : ''}`} role="menu" style={{ right: 0, top: 'calc(100% + 4px)' }}>
        <button
          ref={(el) => { firstItemRef.current = el; setItemRef(0)(el) }}
          type="button"
          role="menuitem"
          className="menu-item"
          disabled={rule.paused}
          onClick={() => { close(false); onPostNow() }}
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Post now
        </button>
        <button
          ref={setItemRef(1)}
          type="button"
          role="menuitem"
          className="menu-item"
          onClick={() => { close(false); onEdit() }}
          aria-label={`Edit ${name}`}
        >
          <Pencil className="h-3.5 w-3.5" />
          Edit {name}
        </button>
        <button
          ref={setItemRef(2)}
          type="button"
          role="menuitem"
          className="menu-item"
          onClick={() => { close(false); onTogglePause() }}
          aria-label={`${rule.paused ? 'Resume' : 'Pause'} ${name}`}
        >
          {rule.paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
          {rule.paused ? 'Resume' : 'Pause'} {name}
        </button>
        <button
          ref={setItemRef(3)}
          type="button"
          role="menuitem"
          className="menu-item"
          onClick={() => { close(false); onDelete() }}
          aria-label={`Delete ${name}`}
        >
          <Trash2 className="h-3.5 w-3.5" />
          Delete {name}
        </button>
      </div>
    </div>
  )
}
