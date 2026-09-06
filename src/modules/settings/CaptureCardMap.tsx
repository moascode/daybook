import { useEffect, useState } from 'react'
import { CreditCard } from 'lucide-react'
import { api } from '@/lib/api'
import { errorMessage } from '@/lib/utils'
import { useWallet } from '@/hooks/useWallet'
import { useToastStore } from '@/stores/toast.store'
import { Select } from '@/components/ui/Select'
import { parseCardMap, CARD_MAP_KEY, type CardMap } from '@/lib/captures'

interface CaptureStatus {
  pending: number
  lastCaptureAt: string | null
  cards: number
}

const LOAD_FAILED = "Couldn't load your capture settings."

function ageText(iso: string | null): string {
  if (!iso) return 'Nothing captured yet.'
  const then = new Date(iso.replace(' ', 'T') + 'Z').getTime()
  if (Number.isNaN(then)) return `Last capture received ${iso}.`
  const days = Math.floor((Date.now() - then) / 86_400_000)
  if (days <= 0) return 'Last capture received today.'
  if (days === 1) return 'Last capture received yesterday.'
  return `Last capture received ${days} days ago.`
}

/**
 * Card → account mapping, plus the silence detector
 * (docs/v2/wallet/feature-capture-inbox.md §5.4, §8).
 *
 * A capture arrives carrying an issuer card string ("Visa •••• 1234"); this is
 * what turns that into an account. An unmapped card is not an error — the row
 * still lands, flagged, and gets filed to the fallback account until it is
 * mapped here.
 *
 * The "last capture received" line is the only thing in the whole feature that
 * can notice an automation that quietly STOPPED. The phone cannot report an
 * event that never happened.
 */
export function CaptureCardMap() {
  const { accounts, loadAccounts } = useWallet()
  const { addToast } = useToastStore()
  const [status, setStatus] = useState<CaptureStatus | null>(null)
  const [cards, setCards] = useState<string[]>([])
  const [map, setMap] = useState<CardMap>({})
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    Promise.all([
      api.get<CaptureStatus>('/captures/status'),
      api.get<string[]>('/captures/cards'),
      api.get<{ key: string; value: string }[]>('/settings'),
      loadAccounts(),
    ])
      .then(([st, seenCards, settings]) => {
        if (cancelled) return
        setStatus(st)
        setCards(seenCards)
        setMap(parseCardMap(settings.find((s) => s.key === CARD_MAP_KEY)?.value))
        setLoadError(null)
      })
      .catch((err) => {
        if (!cancelled) setLoadError(errorMessage(err, LOAD_FAILED))
      })
    return () => {
      cancelled = true
    }
  }, [loadAccounts])

  const writable = accounts.filter((a) => !a.isShared || a.canWrite === 1)

  async function assign(card: string, accountId: string) {
    const next = { ...map }
    if (accountId) next[card] = accountId
    else delete next[card]
    setMap(next)
    try {
      await api.put(`/settings/${CARD_MAP_KEY}`, { value: JSON.stringify(next) })
    } catch (err) {
      // Put the old value back rather than leaving the UI claiming a mapping
      // the server never accepted.
      setMap(map)
      addToast({ message: errorMessage(err, 'Could not save that card mapping.'), duration: 4000 })
    }
  }

  // Cards seen in captures, plus any already mapped (a card can be mapped
  // before its first capture, and a mapping outlives the captures that
  // prompted it).
  const knownCards = [...new Set([...cards, ...Object.keys(map)])].sort()

  return (
    <section className="rounded-xl border border-line bg-surface p-5" data-testid="capture-cards-section">
      <div className="mb-4 flex items-center gap-2">
        <CreditCard className="h-4 w-4 text-fg-faint" />
        <h3 className="text-sm font-semibold text-fg">Captured cards</h3>
      </div>

      {loadError ? (
        <p className="text-xs text-red-600" data-testid="capture-cards-error">
          {loadError}
        </p>
      ) : (
        <>
          <p className="text-sm text-fg-muted">
            Which account each card's payments belong to. A card that isn't mapped still gets
            captured — the row is flagged in the inbox so you can pick an account there.
          </p>
          <p className="mt-1 text-xs text-fg-subtle" data-testid="capture-last-seen">
            {ageText(status?.lastCaptureAt ?? null)}
            {status && status.pending > 0 && ` ${status.pending} waiting in your inbox.`}
          </p>

          {knownCards.length === 0 ? (
            <p className="mt-4 text-xs text-fg-subtle">
              No cards seen yet. They appear here the first time a device captures a payment.
            </p>
          ) : (
            <ul className="mt-4 divide-y divide-line-subtle border-t border-line-subtle">
              {knownCards.map((card) => (
                <li key={card} className="flex items-center gap-3 py-2.5" data-testid="capture-card-row">
                  <span className="min-w-0 flex-1 truncate text-sm text-fg">{card}</span>
                  <Select
                    value={map[card] ?? ''}
                    onChange={(e) => void assign(card, e.target.value)}
                    options={[
                      { value: '', label: 'Not mapped' },
                      ...writable.map((a) => ({ value: a.id, label: a.name })),
                    ]}
                    className="w-44 text-xs"
                    aria-label={`Account for ${card}`}
                    data-testid="capture-card-account"
                  />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  )
}
