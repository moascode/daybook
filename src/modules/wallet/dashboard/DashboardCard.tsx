import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { cn } from '@/lib/utils'

interface DashboardCardProps {
  title: string
  /** One line under the title explaining what the panel measures. */
  subtitle?: string
  /** Optional "go deeper" link in the top-right corner. */
  action?: { label: string; to: string }
  className?: string
  children: ReactNode
}

export function DashboardCard({ title, subtitle, action, className, children }: DashboardCardProps) {
  return (
    <section className={cn('rounded-xl border border-line bg-surface p-5', className)}>
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-semibold text-fg">{title}</h3>
        {action && (
          <Link
            to={action.to}
            className="shrink-0 text-xs font-medium text-brand-600 hover:text-brand-700 hover:underline"
          >
            {action.label} →
          </Link>
        )}
      </div>
      {subtitle && <p className="mt-1 text-xs text-fg-subtle">{subtitle}</p>}
      <div className="mt-4">{children}</div>
    </section>
  )
}
