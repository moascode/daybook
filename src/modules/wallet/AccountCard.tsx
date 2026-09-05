import { useNavigate } from 'react-router-dom'
import { Wallet, Pencil, Trash2, Share2 } from 'lucide-react'
import { cn, formatMYR, todayISO } from '@/lib/utils'
import { Button } from '@/components/ui/Button'
import { ACCOUNT_TYPE_LABELS, ICON_MAP } from '@/lib/accountDisplay'
import {
  TYPE_ACCENT_VAR, formatLastActivity, formatStatementDate, SPARKLINE_WIDTH, SPARKLINE_HEIGHT, type AccountMonthChange,
} from '@/modules/wallet/accounts/insights'
import type { Account } from '@/types/wallet.types'

interface AccountCardProps {
  account: Account
  // §1.4: supplied by the page from one batched balances call — null while loading.
  balance: number | null
  onEdit: (account: Account) => void
  onDelete: (account: Account) => void
  onShare?: (account: Account) => void
  sharesCount?: number
  /**
   * Renders the mockup's dark `.acct-feature` gradient card instead of the
   * plain `.acct` card — set on exactly one card (the highest-balance own
   * account), the same treatment and rule Overview uses for its one
   * featured account. `.acct-feature`'s own CSS already recolours
   * `.acct-sub`/`.acct-foot`/`.acct-mark` for the dark background, so the
   * per-type accent inline style is skipped here rather than fighting it.
   */
  featured?: boolean
  /**
   * Shows the share/edit/delete icons. Off by default so the card matches
   * the mockup's plain `.acct` — no action icons at all — until the page's
   * "Manage" toggle turns this on for every card.
   */
  showActions?: boolean
  /** Real month-to-date movement (reconstructed from the ledger) — null hides the foot-row change label. */
  monthChange?: AccountMonthChange | null
  /** Most recent date a transaction touched this account — null renders "No activity yet". */
  lastActivityDate?: string | null
  /** SVG path `d` for the 12-month sparkline (`sparklinePath`, insights.ts) — real reconstructed balances, not a decorative curve. Empty string hides it. */
  sparklinePath?: string
}

/**
 * Literal port of the mockup's `.acct` card — icon mark, name, "{type} ·
 * {currency}" sub-line, balance, foot row. No colour-accent bar and no type
 * badge pill; those predate the mockup rebuild and never appeared in it —
 * matching the same plain acct-sub format Overview's featured-account card
 * already uses (`src/modules/wallet/Dashboard.tsx`) so every account card in
 * the app reads the same way.
 */
export function AccountCard({
  account, balance, onEdit, onDelete, onShare, sharesCount, featured, showActions, monthChange, lastActivityDate,
  sparklinePath,
}: AccountCardProps) {
  const navigate = useNavigate()
  const IconComponent = ICON_MAP[account.icon] ?? Wallet
  const accent = TYPE_ACCENT_VAR[account.type]

  // Investment accounts read as a % return; everything else as a plain amount —
  // same distinction the mockup draws between its bank/cash cards and its
  // index-fund card. Falls back to the amount if the % isn't computable
  // (start-of-month balance was ~0, so a percent would be meaningless).
  const changeValue = monthChange && (account.type === 'investment' && monthChange.percent !== null
    ? { text: `${monthChange.percent >= 0 ? '+' : ''}${monthChange.percent.toFixed(1)}%`, positive: monthChange.percent >= 0 }
    : { text: `${monthChange.amount >= 0 ? '+' : '−'}${formatMYR(Math.abs(monthChange.amount))}`, positive: monthChange.amount >= 0 })

  // Credit cards read as "how much room is left", not a balance trend — the
  // one type the mockup swaps its sparkline for a utilization bar. Only when
  // a limit is actually set; a card with none falls back to the sparkline
  // like every other account rather than showing a bar with nothing to show.
  const utilization = account.type === 'card' && account.creditLimit
    ? Math.min(100, (Math.abs(balance ?? 0) / account.creditLimit) * 100)
    : null

  // "Last updated" is about activity, which isn't the useful question for a
  // credit card — "when do I need to pay" is. Falls back to last-activity
  // when no statement day is set yet, rather than showing nothing.
  const footLeftLabel = account.type === 'card' && account.statementDay
    ? formatStatementDate(account.statementDay, todayISO())
    : formatLastActivity(lastActivityDate ?? null, todayISO())

  function handleCardClick() {
    navigate(`/wallet?account=${account.id}`)
  }

  function handleCardKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    // Nested action buttons handle their own keys; only act on the card itself.
    if (e.target !== e.currentTarget) return
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      handleCardClick()
    }
  }

  return (
    <div
      data-testid="account-card"
      role="button"
      tabIndex={0}
      aria-label={`View transactions for ${account.name}`}
      className={cn(
        'acct group cursor-pointer',
        featured && 'acct-feature',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2'
      )}
      onClick={handleCardClick}
      onKeyDown={handleCardKeyDown}
    >
      <div className="acct-top justify-between">
        <div className="flex items-center gap-3">
          <div
            className="acct-mark"
            style={featured ? undefined : { background: `rgb(var(${accent.bg}))`, color: `rgb(var(${accent.fg}))` }}
          >
            <IconComponent className="h-5 w-5" />
          </div>
          <div>
            <h3 className="acct-name">{account.name}</h3>
            <span className="acct-sub">
              <span data-testid="account-card-type">{ACCOUNT_TYPE_LABELS[account.type]}</span>
              {' · '}
              <span>{account.currency}</span>
              {account.isShared && account.sharedByUsername && ` · shared by ${account.sharedByUsername}`}
              {!account.isShared && sharesCount !== undefined && sharesCount > 0 && ` · shared with ${sharesCount}`}
            </span>
          </div>
        </div>

        {/* Actions — hidden until the page's "Manage" toggle turns them on (B6 still holds once shown: no hover-only reveal). */}
        {showActions && (
          <div
            className={cn(
              'flex gap-1 transition-colors',
              featured ? 'text-white/70 hover:text-white' : 'text-fg-faint hover:text-fg-muted',
            )}
            onClick={(e) => e.stopPropagation()}
          >
            {/* U-2: share button — only shown for own (non-shared-in) accounts */}
            {!account.isShared && onShare && (
              <Button
                variant="ghost"
                size="sm"
                className="min-h-[40px] min-w-[40px] md:min-h-0 md:min-w-0"
                onClick={() => onShare(account)}
                aria-label="Manage sharing"
                title="Manage sharing"
              >
                <Share2 className="h-3.5 w-3.5 text-purple-500" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="min-h-[40px] min-w-[40px] md:min-h-0 md:min-w-0"
              onClick={() => onEdit(account)}
              aria-label="Edit account"
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            {/* Delete is owner-only — a shared-in account can never be deleted here. */}
            {!account.isShared && (
              <Button
                variant="ghost"
                size="sm"
                className="min-h-[40px] min-w-[40px] md:min-h-0 md:min-w-0"
                onClick={() => onDelete(account)}
                aria-label="Delete account"
              >
                <Trash2 className="h-3.5 w-3.5 text-red-500" />
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Description */}
      {account.description && (
        <p className={cn('text-sm line-clamp-1', featured ? 'opacity-70' : 'text-fg-subtle')}>
          {account.description}
        </p>
      )}

      {/* Balance */}
      <p
        data-testid="account-card-balance"
        className={cn(
          'acct-bal',
          featured
            ? balance !== null && balance < 0 && 'text-red-300'
            : (
              balance === null
                ? 'text-fg-faint'
                : balance >= 0
                  ? 'text-fg'
                  : 'text-red-600'
            )
        )}
      >
        {balance === null ? '...' : formatMYR(balance)}
      </p>
      {utilization !== null ? (
        // Credit limit utilization — same `.track` bar the mockup's own credit-card row uses.
        <div>
          <div className="track" style={{ marginTop: 'var(--s1)' }}>
            <i style={{ width: `${utilization}%`, background: `rgb(var(--neg))` }} />
          </div>
          <p className={cn('text-xs', featured ? 'opacity-70' : 'text-fg-subtle')} style={{ marginTop: 'var(--s1)' }}>
            {utilization.toFixed(0)}% of {formatMYR(account.creditLimit!)} limit
          </p>
        </div>
      ) : (
        /* 12-month sparkline — real reconstructed balances (`sparklinePath`, insights.ts), matching the mockup's own `<svg viewBox="0 0 220 34">` account cards. */
        sparklinePath && (
          <svg
            viewBox={`0 0 ${SPARKLINE_WIDTH} ${SPARKLINE_HEIGHT}`}
            preserveAspectRatio="none"
            style={{ height: 34, width: '100%' }}
            aria-hidden="true"
          >
            <path
              d={sparklinePath}
              fill="none"
              strokeWidth={1.6}
              strokeLinejoin="round"
              stroke={featured ? 'rgb(255 255 255 / .75)' : `rgb(var(${accent.fg}))`}
            />
          </svg>
        )
      )}
      <p className="acct-foot">
        <span>{footLeftLabel}</span>
        {changeValue && (
          <span
            className={
              featured
                ? changeValue.positive ? 'text-emerald-300' : 'text-red-300'
                : changeValue.positive ? 'text-pos-fg' : 'text-neg-fg'
            }
          >
            {changeValue.text} this month
          </span>
        )}
      </p>
    </div>
  )
}
