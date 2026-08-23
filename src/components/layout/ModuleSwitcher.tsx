import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { modules, type ModuleDescriptor } from './modules'

interface ModuleSwitcherProps {
  activeModule: ModuleDescriptor
  onNavigate?: () => void
}

/**
 * Module switcher for the 681-820px gap: the app bar's `.modtabs` hide below
 * 820px (no room next to the search field), and the mobile tab bar / drawer
 * sidebar only engage <=680px, so that band had no way to switch modules at
 * all — only fixed post-R2 (see the PR #130 follow-up).
 *
 * `.modswitch`/`.menu`/`.menu-item` are the ported CSS's own module-switcher
 * classes, dormant since before the app bar existed (a v3-era top-of-sidebar
 * switcher) — reused here rather than inventing new markup for this gap.
 *
 * Always mounted; CSS (`.modswitch-gap`) shows it only in the 681-820px
 * band, same convention as the rest of the shell (`.appbar`/`.tabbar`/
 * `.modtabs` are all always-mounted, CSS-gated). `ModuleSidebar` hides its
 * own `.module-head` in that same band via CSS — this switcher already
 * shows the active module's icon and name, so the two would be redundant
 * side by side.
 */
export function ModuleSwitcher({ activeModule, onNavigate }: ModuleSwitcherProps) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()

  const close = useCallback(() => setOpen(false), [])

  // Mounted only while open — not just CSS-hidden (same fix shape as
  // AccountMenu's own panel, PR #130): a menu of module names sitting
  // permanently in the DOM risks colliding with getByText() lookups
  // elsewhere in the app for those same names.
  useEffect(() => {
    if (!open) return
    function handlePointerDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) close()
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open, close])

  const goTo = useCallback(
    (m: ModuleDescriptor) => {
      navigate(m.path)
      close()
      onNavigate?.()
    },
    [navigate, close, onNavigate],
  )

  return (
    <div className="modswitch-gap pop-anchor" ref={containerRef}>
      <button
        type="button"
        className="modswitch"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="true"
        aria-expanded={open}
        data-testid="modswitch-button"
      >
        <span className="modswitch-mark">
          <activeModule.icon className="icon" size={16} />
        </span>
        <span>
          <span className="modswitch-name">{activeModule.label}</span>
          <span className="modswitch-sub">Switch module</span>
        </span>
        <ChevronDown className="chev" size={16} />
      </button>

      {open && (
        <div className="menu open" data-testid="modswitch-menu">
          <div className="menu-label">Modules</div>
          {modules.map((m: ModuleDescriptor) =>
            m.disabled ? (
              <button
                key={m.id}
                type="button"
                className="menu-item"
                disabled
                aria-label={`${m.label} — coming soon`}
              >
                <m.icon className="icon-sm" size={16} />
                {m.label}
                <span className="trail">Coming soon</span>
              </button>
            ) : (
              <button
                key={m.id}
                type="button"
                className={cn('menu-item', m.id === activeModule.id && 'active')}
                onClick={() => goTo(m)}
              >
                <m.icon className="icon-sm" size={16} />
                {m.label}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  )
}
