import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import { api } from '@/lib/api'
import { useAppStore } from '@/stores/app.store'
import { cn } from '@/lib/utils'

interface WelcomeCardProps {
  /**
   * Per-user settings key that records dismissal, e.g.
   * 'onboarding_dismissed_tasks'. When set to '1' the card never shows again.
   */
  settingKey: string
  icon: ReactNode
  title: string
  children: ReactNode
  className?: string
}

/**
 * U-16: a lightweight, dismissible first-run orientation card. Rendered at the
 * top of an empty module so a brand-new account gets a nudge instead of a blank
 * screen. Dismissal persists per user via the settings key, so it only ever
 * shows once. Loading of the dismissed state happens once at boot (App.tsx),
 * so there is no flash-then-hide.
 */
export function WelcomeCard({ settingKey, icon, title, children, className }: WelcomeCardProps) {
  const dismissed = useAppStore((s) => s.onboardingDismissed[settingKey])
  const markOnboardingDismissed = useAppStore((s) => s.markOnboardingDismissed)

  if (dismissed) return null

  const handleDismiss = () => {
    // Hide immediately; persist in the background. A failed write is harmless —
    // worst case the card reappears on the next login.
    markOnboardingDismissed(settingKey)
    api.put(`/settings/${settingKey}`, { value: '1' }).catch(() => {})
  }

  return (
    <div
      data-testid={`welcome-card-${settingKey}`}
      className={cn(
        'relative rounded-xl border border-brand-200 bg-brand-50 p-4 pr-10',
        className,
      )}
    >
      <button
        type="button"
        onClick={handleDismiss}
        aria-label="Dismiss"
        className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-md text-brand-600/70 transition-colors hover:bg-brand-100 hover:text-brand-700"
      >
        <X className="h-4 w-4" />
      </button>
      <div className="flex gap-3">
        <div className="mt-0.5 shrink-0 text-brand-600">{icon}</div>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-fg">{title}</h3>
          <div className="mt-1 text-sm text-fg-muted">{children}</div>
        </div>
      </div>
    </div>
  )
}
