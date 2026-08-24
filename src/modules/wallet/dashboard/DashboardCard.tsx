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
    <section className={cn('card card-pad', className)}>
      <div className="card-head">
        <div className="min-w-0">
          <h3 className="card-title">{title}</h3>
          {subtitle && <p className="card-sub mt-0.5">{subtitle}</p>}
        </div>
        {action && (
          <Link to={action.to} className="section-action">
            {action.label} →
          </Link>
        )}
      </div>
      {children}
    </section>
  )
}
