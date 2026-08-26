import { useEffect, useMemo, useState } from 'react'
import { Plane, MapPin } from 'lucide-react'
import { useWallet } from '@/hooks/useWallet'
import { useToastStore } from '@/stores/toast.store'
import { errorMessage, formatMYR, todayISO } from '@/lib/utils'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { travelSummary } from '@/modules/trips/insights'
import type { Transaction } from '@/types/wallet.types'

/** First day of the current calendar year, local date parts — never
 *  toISOString() (CLAUDE.md §16 trap 1). */
function startOfYearISO(): string {
  return `${todayISO().slice(0, 4)}-01-01`
}

/**
 * Trips — the fourth tab's landing page (R6,
 * docs/v2/trips/02-design-adoption.md). Makes the tab defensible before the
 * `trips` schema exists (R12): the top figure is real, computed from
 * transactions already in the ledger, and everything below it is an honest
 * "nothing yet" rather than a half-built module.
 */
export function TripsPage() {
  const { loadAccounts, loadCategories, loadTransactions, accounts, categories } = useWallet()
  const addToast = useToastStore((s) => s.addToast)

  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    Promise.all([
      loadAccounts(),
      loadCategories(),
      loadTransactions({ dateFrom: startOfYearISO(), dateTo: todayISO() }),
    ])
      .then(([, , txns]) => {
        if (cancelled) return
        setTransactions(txns)
      })
      .catch((err) => {
        if (cancelled) return
        // A failed load must never render as a confident RM0.00 — that's a
        // false figure, not an absence of one (CLAUDE.md rule 13: "a broken
        // service and a service with nothing to return render identically").
        setLoadFailed(true)
        addToast({ message: errorMessage(err, 'Could not load your travel spending.') })
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [loadAccounts, loadCategories, loadTransactions, addToast])

  const summary = useMemo(
    () => travelSummary(transactions, accounts, categories),
    [transactions, accounts, categories],
  )

  return (
    <div className="content">
      <div className="page-head">
        <div>
          <h1 className="page-title">Trips</h1>
          <p className="page-sub">Travel as a category of your life.</p>
        </div>
      </div>

      <div className="card card-pad mb-4" data-testid="trips-travel-band">
        {loading ? (
          <p className="text-sm text-fg-subtle">Loading your travel spending…</p>
        ) : loadFailed ? (
          <p className="text-sm text-fg-subtle" data-testid="trips-travel-band-error">
            Couldn't load your travel spending — try reloading the page.
          </p>
        ) : (
          <div className="band">
            <div className="band-main">
              <div className="band-fig">
                <span className="v" data-testid="trips-travel-total">
                  {formatMYR(summary.travelTotal)}
                </span>
                <span className="k">spent on travel this year</span>
              </div>
            </div>
            <div className="band-stats">
              <div className="band-stat">
                <p className="k">Of everything you spent</p>
                <p className="v" data-testid="trips-travel-pct">
                  {summary.pctOfSpend.toFixed(1)}%
                </p>
              </div>
              <div className="band-stat">
                <p className="k">Days away</p>
                <p className="v" data-testid="trips-travel-days">
                  {summary.daysAway}
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="dash">
        <section className="c6">
          <div className="card card-pad h-full">
            <EmptyState
              icon={<Plane className="h-10 w-10" />}
              title="No active trip"
              description="When you're on a trip, it shows here with a live budget burn-down."
              action={
                <div>
                  <Button size="sm" disabled title="Coming in R12" data-testid="trips-plan-a-trip">
                    Plan a trip
                  </Button>
                  <p className="mt-2 text-xs text-fg-subtle" data-testid="trips-plan-a-trip-reason">
                    Coming in R12
                  </p>
                </div>
              }
            />
          </div>
        </section>
        <section className="c6">
          <div className="card card-pad h-full">
            <EmptyState
              icon={<MapPin className="h-10 w-10" />}
              title="Nothing upcoming, past, or on the wishlist"
              description="Trips you plan, take, and dream about all land here once trips are trackable."
            />
          </div>
        </section>
      </div>
    </div>
  )
}
