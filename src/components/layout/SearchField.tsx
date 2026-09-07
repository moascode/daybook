import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, Wallet, CheckSquare, CreditCard } from 'lucide-react'
import { api } from '@/lib/api'
import { errorMessage } from '@/lib/utils'

type Group = 'transactions' | 'tasks' | 'accounts'

interface Hit {
  group: Group
  id: string
  title: string
  subtitle: string
  url: string
}

const GROUP_LABEL: Record<Group, string> = {
  transactions: 'Transactions',
  tasks: 'Tasks',
  accounts: 'Accounts',
}
const GROUP_ICON: Record<Group, typeof Search> = {
  transactions: Wallet,
  tasks: CheckSquare,
  accounts: CreditCard,
}
const ORDER: Group[] = ['transactions', 'tasks', 'accounts']
const MIN_QUERY = 2
const DEBOUNCE_MS = 200

/**
 * The app bar's global search (R17 §1). A shell since R2 — it grew and lifted
 * on focus and did nothing else.
 *
 * Results are grouped by module, per the design. Arrow keys move through the
 * flat list and Enter opens the highlighted hit, because a search you have to
 * reach for the mouse to finish is not much of a shortcut.
 *
 * Debounced rather than fired per keystroke: this hits the database on every
 * change, and `LIKE` over four tables is cheap but not free.
 */
export function SearchField() {
  const [query, setQuery] = useState('')
  // Results are stored WITH the query they answer, so "stale" is derived at
  // render rather than reset in the effect — which is what keeps this clear of
  // react-hooks/set-state-in-effect, and also removes a flicker where the old
  // results showed for a frame against a newly typed query.
  const [results, setResults] = useState<{ q: string; hits: Hit[]; error: string | null } | null>(null)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()

  const close = useCallback(() => {
    setOpen(false)
    setActive(0)
  }, [])

  useEffect(() => {
    const q = query.trim()
    if (q.length < MIN_QUERY) return
    let cancelled = false
    const id = setTimeout(() => {
      api
        .get<{ hits: Hit[] }>(`/search?q=${encodeURIComponent(q)}`)
        .then((res) => {
          if (cancelled) return
          setResults({ q, hits: res.hits, error: null })
          setActive(0)
        })
        // Rule 13: "no results" and "the search broke" must not look the same.
        .catch((err) => {
          if (!cancelled) {
            setResults({ q, hits: [], error: errorMessage(err, "Couldn't search just now.") })
          }
        })
    }, DEBOUNCE_MS)
    return () => {
      cancelled = true
      clearTimeout(id)
    }
  }, [query])

  useEffect(() => {
    if (!open) return
    function onPointerDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) close()
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [open, close])

  const trimmed = query.trim()
  // Only results that answer the CURRENT query count; anything else is stale.
  const fresh = results && results.q === trimmed ? results : null
  const hits = fresh?.hits ?? null
  const error = fresh?.error ?? null

  function go(hit: Hit) {
    navigate(hit.url)
    setQuery('')
    setResults(null)
    close()
    inputRef.current?.blur()
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      if (open && hits) close()
      else e.currentTarget.blur()
      return
    }
    if (!hits || hits.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => (i + 1) % hits.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => (i - 1 + hits.length) % hits.length)
    } else if (e.key === 'Enter' && hits[active]) {
      e.preventDefault()
      go(hits[active])
    }
  }

  const showPanel = open && trimmed.length >= MIN_QUERY
  let flat = -1

  return (
    <div className="pop-anchor" style={{ flex: 1, minWidth: 0 }} ref={containerRef}>
      <div className="search">
        <Search className="icon-sm" size={15} aria-hidden="true" />
        <input
          ref={inputRef}
          type="text"
          placeholder="Search Daybook…"
          aria-label="Search across all modules"
          value={query}
          data-testid="global-search-input"
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
        />
      </div>

      {showPanel && (
        <div
          className="menu open"
          style={{ left: 0, right: 0, top: 'calc(100% + 8px)', maxHeight: '60vh', overflowY: 'auto' }}
          data-testid="search-results"
        >
          {error ? (
            <p className="px-3 py-2 text-xs text-red-600" data-testid="search-error">
              {error}
            </p>
          ) : hits === null ? (
            <p className="px-3 py-2 text-xs text-fg-subtle">Searching…</p>
          ) : hits.length === 0 ? (
            <p className="px-3 py-3 text-xs text-fg-subtle" data-testid="search-empty">
              Nothing matches “{trimmed}”.
            </p>
          ) : (
            ORDER.filter((g) => hits.some((h) => h.group === g)).map((g) => {
              const Icon = GROUP_ICON[g]
              return (
                <div key={g}>
                  <div className="menu-label">{GROUP_LABEL[g]}</div>
                  {hits
                    .filter((h) => h.group === g)
                    .map((hit) => {
                      flat += 1
                      const isActive = flat === active
                      return (
                        <button
                          key={`${hit.group}-${hit.id}`}
                          type="button"
                          className={`menu-item${isActive ? ' active' : ''}`}
                          data-testid="search-hit"
                          data-group={hit.group}
                          onMouseEnter={() => setActive(hits.indexOf(hit))}
                          onClick={() => go(hit)}
                        >
                          <Icon className="icon-sm" size={15} aria-hidden="true" />
                          <span className="flex min-w-0 flex-col">
                            <span className="truncate text-fg">{hit.title}</span>
                            <span className="truncate text-xs text-fg-subtle">{hit.subtitle}</span>
                          </span>
                        </button>
                      )
                    })}
                </div>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}
