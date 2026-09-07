import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, TrendingDown, TrendingUp, ArrowRightLeft, CheckSquare, Upload } from 'lucide-react'

interface Action {
  key: string
  label: string
  icon: typeof Plus
  go: () => void
}

/**
 * Quick add (R17) — the app bar's `+`, which until now raised a toast saying it
 * wasn't wired up.
 *
 * Every action routes to a page that already knows how to do the thing, using
 * the one-shot navigation state WalletPage established for its import modal.
 * Nothing here re-implements a form: the point of a global affordance is to be
 * a shortcut into existing paths, not a second way to write a transaction.
 */
export function QuickAddMenu() {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  const close = useCallback(() => setOpen(false), [])

  useEffect(() => {
    if (!open) return
    function onPointerDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) close()
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, close])

  const goWallet = useCallback(
    (state: Record<string, unknown>) => {
      navigate('/wallet', { state })
      close()
    },
    [navigate, close],
  )

  const actions: Action[] = [
    { key: 'expense', label: 'Expense', icon: TrendingDown, go: () => goWallet({ quickAddType: 'expense' }) },
    { key: 'income', label: 'Income', icon: TrendingUp, go: () => goWallet({ quickAddType: 'income' }) },
    { key: 'transfer', label: 'Transfer', icon: ArrowRightLeft, go: () => goWallet({ quickAddType: 'transfer' }) },
    { key: 'task', label: 'Task', icon: CheckSquare, go: () => { navigate('/tasks'); close() } },
    { key: 'import', label: 'Import transactions', icon: Upload, go: () => goWallet({ openImport: true }) },
  ]

  return (
    <div className="pop-anchor" ref={containerRef}>
      <button
        type="button"
        className="circle-btn"
        aria-label="Quick add"
        aria-expanded={open}
        data-testid="quick-add"
        onClick={() => setOpen((v) => !v)}
      >
        <Plus className="icon" />
      </button>

      <div
        className={`menu${open ? ' open' : ''}`}
        style={{ right: 0, top: 'calc(100% + 8px)' }}
        data-testid="quick-add-menu"
      >
        <div className="menu-label">Add</div>
        {actions.map((a) => (
          <button
            key={a.key}
            type="button"
            className="menu-item"
            data-testid="quick-add-item"
            data-action={a.key}
            onClick={a.go}
          >
            <a.icon className="icon-sm" size={15} aria-hidden="true" />
            <span>{a.label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
