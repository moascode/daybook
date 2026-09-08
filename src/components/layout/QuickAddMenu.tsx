import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, TrendingDown, TrendingUp, ArrowRightLeft, CheckSquare, Upload } from 'lucide-react'

interface Action {
  key: string
  label: string
  icon: typeof Plus
  go: () => void
}

interface QuickAddMenuProps {
  /**
   * `appbar` is the desktop `+` in the right-hand cluster; `fab` is the phone's
   * floating button, which the app bar's copy hides for (shell.css). R17 wired
   * only the app bar, so on a phone — where the app bar's `+` is hidden — quick
   * add was still the R2 placeholder toast and the feature simply did not exist.
   * One component, two triggers, so they cannot drift again.
   */
  variant?: 'appbar' | 'fab'
}

/**
 * Quick add (R17) — the `+`, which until R17 raised a toast saying it wasn't
 * wired up.
 *
 * Every action routes to a page that already knows how to do the thing, using
 * the one-shot navigation state WalletPage established for its import modal.
 * Nothing here re-implements a form: the point of a global affordance is to be
 * a shortcut into existing paths, not a second way to write a transaction.
 */
export function QuickAddMenu({ variant = 'appbar' }: QuickAddMenuProps = {}) {
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

  const isFab = variant === 'fab'

  return (
    <div className={isFab ? undefined : 'pop-anchor'} ref={containerRef}>
      <button
        type="button"
        className={isFab ? 'fab' : 'circle-btn quick-add-btn'}
        aria-label="Quick add"
        aria-expanded={open}
        data-testid={isFab ? 'fab-quick-add' : 'quick-add'}
        onClick={() => setOpen((v) => !v)}
      >
        <Plus className="icon" />
      </button>

      {/* Both variants are in the DOM at every width — AppShell renders the
          desktop and mobile chrome together and lets CSS choose (a convention
          the suite already relies on), so their testids must not collide or
          every strict-mode locator in spec 84 resolves to two nodes.

          The FAB is `position: fixed`, so its menu has to be too — an absolute
          menu would anchor to a zero-height wrapper sitting wherever the tab
          bar happens to fall in flow, not to the button on screen. It opens
          upward from just above the FAB (bottom 72px + its own 52px height). */}
      <div
        className={`menu${open ? ' open' : ''}`}
        style={
          isFab
            ? { position: 'fixed', right: 'var(--s4, 16px)', bottom: 'calc(132px + env(safe-area-inset-bottom))' }
            : { right: 0, top: 'calc(100% + 8px)' }
        }
        data-testid={isFab ? 'fab-quick-add-menu' : 'quick-add-menu'}
      >
        <div className="menu-label">Add</div>
        {actions.map((a) => (
          <button
            key={a.key}
            type="button"
            className="menu-item"
            data-testid={isFab ? 'fab-quick-add-item' : 'quick-add-item'}
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
