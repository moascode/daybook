import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { ConfirmDeleteModal } from '@/components/ui/ConfirmDeleteModal'
import { useToastStore } from '@/stores/toast.store'
import { api, ApiError } from '@/lib/api'

interface MerchantCanonical {
  current: string
  canonical: string
  transactionCount: number
}

interface CanonicalizePreviewResponse {
  merchants: MerchantCanonical[]
  totalAffected: number
}

interface CanonicalizeApplyResponse {
  updated: number
  skipped: number
}

/**
 * One-time admin tool: finds merchant names that a canonicalisation pass
 * would clean up (e.g. trimming noise, fixing casing) and lets the user
 * apply the rewrite in bulk across their existing transactions.
 *
 * The backend only exposes a single POST route
 * (`worker/routes/wallet.ts` — `POST /api/merchants/canonicalize`) that
 * branches on `preview`/`confirm` query params; there is no separate GET
 * endpoint, so both the initial scan and the apply step go through POST.
 */
export function CanonicalizeMerchantsPage() {
  const navigate = useNavigate()
  const { addToast } = useToastStore()

  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [applying, setApplying] = useState(false)
  const [merchants, setMerchants] = useState<MerchantCanonical[] | null>(null)
  const [result, setResult] = useState<CanonicalizeApplyResponse | null>(null)
  const [showConfirm, setShowConfirm] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function loadPreview() {
      setLoading(true)
      setLoadError(false)
      try {
        const res = await api.post<CanonicalizePreviewResponse>('/merchants/canonicalize?preview=true')
        if (cancelled) return
        const sorted = [...res.merchants].sort((a, b) => b.transactionCount - a.transactionCount)
        setMerchants(sorted)
      } catch (err) {
        if (cancelled) return
        const message = err instanceof ApiError ? err.message : 'Failed to load merchants to clean up.'
        addToast({ message })
        setLoadError(true)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    loadPreview()
    return () => {
      cancelled = true
    }
  }, [addToast])

  const totalAffected = merchants?.reduce((sum, m) => sum + m.transactionCount, 0) ?? 0

  function handleApplyClick() {
    if (!merchants || merchants.length === 0) return
    setShowConfirm(true)
  }

  async function confirmApply() {
    setShowConfirm(false)
    setApplying(true)
    try {
      const res = await api.post<CanonicalizeApplyResponse>(
        '/merchants/canonicalize?preview=false&confirm=true',
      )
      setResult(res)
      addToast({ message: `Updated ${res.updated} transaction${res.updated === 1 ? '' : 's'}.` })
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to apply merchant cleanup.'
      addToast({ message })
    } finally {
      setApplying(false)
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <p className="text-sm text-fg-subtle">Checking for merchant names to clean up…</p>
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <p className="text-sm text-fg-muted">Couldn’t load merchants to clean up. Try again from Wallet.</p>
        <Button variant="secondary" className="mt-4" onClick={() => navigate('/wallet')}>
          Return to wallet
        </Button>
      </div>
    )
  }

  if (result) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <h1 className="text-lg font-semibold text-fg">Merchant cleanup complete</h1>
        <p className="mt-2 text-sm text-fg-muted">
          Updated {result.updated} transaction{result.updated === 1 ? '' : 's'}
          {result.skipped > 0 ? ` (${result.skipped} skipped)` : ''}.
        </p>
        <Button variant="secondary" className="mt-4" onClick={() => navigate('/wallet')}>
          Return to wallet
        </Button>
      </div>
    )
  }

  if (!merchants || merchants.length === 0) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <p className="text-sm text-fg-muted">No merchants to clean up.</p>
        <Button variant="secondary" className="mt-4" onClick={() => navigate('/wallet')}>
          Return to wallet
        </Button>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-lg font-semibold text-fg">Clean up merchant names</h1>
      <p className="mt-1 text-sm text-fg-muted">
        {merchants.length} merchant{merchants.length === 1 ? '' : 's'} can be cleaned up, affecting{' '}
        {totalAffected} transaction{totalAffected === 1 ? '' : 's'}.
      </p>

      <div className="mt-6 overflow-x-auto rounded-lg border border-line">
        <table className="w-full text-sm" data-testid="canonicalize-merchants-table">
          <thead>
            <tr className="border-b border-line bg-surface-sunken">
              <th
                scope="col"
                className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-fg-subtle"
              >
                Current merchant
              </th>
              <th
                scope="col"
                className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-fg-subtle"
              >
                Canonical form
              </th>
              <th
                scope="col"
                className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-fg-subtle"
              >
                Count
              </th>
            </tr>
          </thead>
          <tbody>
            {merchants.map((m) => (
              <tr
                key={m.current}
                data-testid="canonicalize-merchant-row"
                className="border-b border-line-subtle last:border-0"
              >
                <td className="px-3 py-2 text-fg">{m.current}</td>
                <td className="px-3 py-2 text-fg-muted">{m.canonical}</td>
                <td className="px-3 py-2 text-right tabular-nums text-fg-muted">{m.transactionCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-6 flex items-center gap-3">
        <Button variant="primary" onClick={handleApplyClick} loading={applying}>
          Apply
        </Button>
        <Button variant="ghost" onClick={() => navigate('/wallet')} disabled={applying}>
          Cancel
        </Button>
      </div>

      <ConfirmDeleteModal
        open={showConfirm}
        onOpenChange={setShowConfirm}
        title="Canonicalize merchant names"
        description={`This will update ${totalAffected} transaction${totalAffected === 1 ? '' : 's'}. The merchant names will be cleaned to remove card numbers, reference codes, and location details. This cannot be undone.`}
        onConfirm={confirmApply}
        confirmLabel="Canonicalize"
      />
    </div>
  )
}
