import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Eye,
  Flag,
  HelpCircle,
  LogOut,
  Settings,
  Shield,
  SlidersHorizontal,
  Tag,
  Upload,
  Users,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { api } from '@/lib/api'
import { useAppStore } from '@/stores/app.store'
import { useHouseholdStore } from '@/stores/household.store'
import { useToastStore } from '@/stores/toast.store'
import { modules } from './modules'

type Pane = 'root' | 'settings'

/**
 * Two-pane account menu (design spec §5) — root pane (profile card, groups,
 * flat actions) and a settings pane that slides in with a back arrow.
 *
 * Owns its own trigger (the avatar button) rather than taking an open/onClose
 * prop, so the outside-click listener can watch one `.pop-anchor` ref that
 * contains both the trigger and the panel: clicking the trigger while open is
 * then "inside" that ref and only the trigger's own onClick toggles it, instead
 * of the click both closing (outside-click) and reopening (toggle) on the same
 * mousedown/click pair.
 */
export function AccountMenu() {
  const [open, setOpen] = useState(false)
  const [pane, setPane] = useState<Pane>('root')
  const containerRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  const addToast = useToastStore((s) => s.addToast)
  const user = useAppStore((s) => s.user)
  const setUser = useAppStore((s) => s.setUser)
  const setDbReady = useAppStore((s) => s.setDbReady)
  const groups = useHouseholdStore((s) => s.groups)

  const close = useCallback(() => {
    setOpen(false)
    setPane('root')
  }, [])

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
    (path: string) => {
      navigate(path)
      close()
    },
    [navigate, close],
  )

  const handleLogout = useCallback(async () => {
    // Same call SettingsPage's logout button makes — one logout path, not two.
    await api.post('/auth/logout')
    setDbReady(false)
    setUser(null)
  }, [setDbReady, setUser])

  const handleReportProblem = useCallback(() => {
    // No report-a-problem flow exists yet (out of scope for R2) — a toast beats
    // a click that silently does nothing (CLAUDE.md §2 rule 13).
    addToast({ message: "Reporting a problem isn't wired up yet — please reach out directly for now." })
    close()
  }, [addToast, close])

  const initial = (user?.username ?? '?').charAt(0).toUpperCase()

  return (
    <div className="pop-anchor" ref={containerRef}>
      <button
        type="button"
        className="avatar-btn"
        onClick={() => setOpen((v) => !v)}
        aria-label="Account menu"
        aria-expanded={open}
        aria-haspopup="true"
        data-testid="account-menu-button"
      >
        <span className="avatar">{initial}</span>
        <span className="caret">
          <ChevronDown />
        </span>
      </button>

      <div className={cn('menu-panel', open && 'open')}>
        {/* ── Root pane ─────────────────────────────────────────── */}
        <div className={cn('pane', pane === 'root' && 'show')}>
          <div className="menu-card">
            {/* Profile page doesn't exist yet — Settings is the closest real
                destination, so this never dead-ends. */}
            <button type="button" className="menu-you" onClick={() => goTo('/settings')}>
              <span className="avatar">{initial}</span>
              <div>
                <div className="menu-you-name">{user?.username ?? 'You'}</div>
                <div className="menu-you-sub">View your profile</div>
              </div>
            </button>

            {groups.length > 0 && (
              <>
                <div className="menu-hr" />
                {groups.map((g) => (
                  <div key={g.id} className="menu-wide">
                    <span className="bubble">
                      <Users className="icon" />
                    </span>
                    <div>
                      <div>{g.name}</div>
                      <div className="sub">{g.role === 'owner' ? 'Owner' : 'Member'}</div>
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>

          <div className="menu-hr" />

          <button
            type="button"
            className="menu-wide"
            onClick={() => setPane('settings')}
            data-testid="account-menu-settings"
          >
            <span className="bubble">
              <Settings className="icon" />
            </span>
            Settings &amp; privacy
            <ChevronRight className="chev" size={16} />
          </button>
          <button type="button" className="menu-wide" onClick={() => goTo('/help')}>
            <span className="bubble">
              <HelpCircle className="icon" />
            </span>
            Help &amp; support
          </button>
          <button type="button" className="menu-wide" onClick={() => setPane('settings')}>
            <span className="bubble">
              <Eye className="icon" />
            </span>
            Display &amp; accessibility
            <ChevronRight className="chev" size={16} />
          </button>
          <button type="button" className="menu-wide" onClick={handleReportProblem}>
            <span className="bubble">
              <Flag className="icon" />
            </span>
            Report a problem
          </button>
          <button type="button" className="menu-wide" onClick={handleLogout}>
            <span className="bubble">
              <LogOut className="icon" />
            </span>
            Log out
          </button>

          <div className="menu-foot">Daybook · On your hardware</div>
        </div>

        {/* ── Settings pane ─────────────────────────────────────── */}
        <div className={cn('pane', pane === 'settings' && 'show')}>
          <div className="menu-head">
            <button type="button" className="icon-btn" onClick={() => setPane('root')} aria-label="Back">
              <ChevronLeft className="icon" size={18} />
            </button>
            <span className="title">Settings &amp; privacy</span>
          </div>

          <button type="button" className="menu-wide" onClick={() => goTo('/settings')}>
            <span className="bubble">
              <SlidersHorizontal className="icon" />
            </span>
            Preferences
          </button>
          <button type="button" className="menu-wide" onClick={() => goTo('/settings')}>
            <span className="bubble">
              <Shield className="icon" />
            </span>
            Privacy &amp; data
          </button>
          <button type="button" className="menu-wide" onClick={() => goTo('/settings/sharing')}>
            <span className="bubble">
              <Users className="icon" />
            </span>
            Household
          </button>

          <div className="menu-hr" />
          {/* D-14 + design spec §4: "Import CSV leaves the sidebar... becomes
              a button on the Transactions page and *Import & export data* in
              the profile menu" — the Transactions-page button is a separate,
              out-of-scope-for-R2 page change, but without this group
              /wallet/import and /wallet/canonicalize-merchants would have NO
              UI entry point at all once the sidebar link is gone. */}
          <div className="menu-label">Import &amp; export data</div>
          <button type="button" className="menu-wide" onClick={() => goTo('/wallet/import')} data-testid="account-menu-import-csv">
            <span className="bubble">
              <Upload className="icon" />
            </span>
            Import CSV
          </button>
          <button type="button" className="menu-wide" onClick={() => goTo('/wallet/canonicalize-merchants')}>
            <span className="bubble">
              <Tag className="icon" />
            </span>
            Merchant names
          </button>

          <div className="menu-hr" />
          <div className="menu-label">Module settings</div>
          {modules.map((m) => (
            // No per-module settings page exists yet (out of scope) — every
            // row lands on the general Settings page rather than 404ing.
            <button key={m.id} type="button" className="menu-wide" onClick={() => goTo('/settings')}>
              <span className="bubble">
                <m.icon className="icon" />
              </span>
              <div>
                <div>{m.label}</div>
                <div className="sub">{m.settingsBlurb}</div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
