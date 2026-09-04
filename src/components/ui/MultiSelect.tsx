import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, Search } from 'lucide-react'
import { cn } from '@/lib/utils'

interface MultiSelectOption {
  value: string
  label: string
}

interface MultiSelectProps {
  label?: string
  options: MultiSelectOption[]
  selected: string[]
  onChange: (values: string[]) => void
  /** Shown on the closed trigger when nothing is selected. Default 'All'. */
  allLabel?: string
  searchPlaceholder?: string
  /** Below ~6 options a search box adds friction without adding value. */
  searchThreshold?: number
}

export function MultiSelect({
  label,
  options,
  selected,
  onChange,
  allLabel = 'All',
  searchPlaceholder = 'Search…',
  searchThreshold = 6,
}: MultiSelectProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  // Reset the search query synchronously during render — on open, and on a
  // reset that happens without closing this panel (e.g. the Filters popup's
  // own "Clear all"), which must also drop a leftover search query or the
  // just-cleared list stays hidden behind a stale filter with no visible
  // cause. Compared against tracked previous values rather than done in an
  // effect, per https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes
  const [prevOpen, setPrevOpen] = useState(open)
  if (open !== prevOpen) {
    setPrevOpen(open)
    if (open) setQuery('')
  }
  const [prevSelectedCount, setPrevSelectedCount] = useState(selected.length)
  if (selected.length !== prevSelectedCount) {
    setPrevSelectedCount(selected.length)
    if (selected.length === 0) setQuery('')
  }

  useEffect(() => {
    if (!open) return
    function handleOutsideMouseDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleOutsideMouseDown)
    return () => document.removeEventListener('mousedown', handleOutsideMouseDown)
  }, [open])

  useEffect(() => {
    if (open) requestAnimationFrame(() => searchInputRef.current?.focus())
  }, [open])

  const filteredOptions = useMemo(() => {
    if (!query) return options
    const q = query.toLowerCase()
    return options.filter((o) => o.label.toLowerCase().includes(q))
  }, [options, query])

  const summary =
    selected.length === 0
      ? allLabel
      : selected.length === 1
        ? (options.find((o) => o.value === selected[0])?.label ?? '1 selected')
        : `${selected.length} selected`

  function toggle(value: string) {
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value])
  }

  return (
    <div className="relative flex flex-col gap-1.5" ref={rootRef}>
      {label && <span className="text-sm font-medium text-fg-muted">{label}</span>}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setOpen(false)
        }}
        aria-expanded={open}
        aria-label={label}
        className={cn(
          'flex items-center justify-between gap-2 rounded-lg border border-line-strong bg-surface px-3 py-2 text-left text-sm',
          'focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20',
          selected.length > 0 ? 'text-fg' : 'text-fg-faint',
        )}
      >
        <span className="truncate">{summary}</span>
        <ChevronDown className={cn('h-3.5 w-3.5 flex-shrink-0 text-fg-faint transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-30 mt-1 w-full min-w-[180px] rounded-lg border border-line bg-surface-raised shadow-xl shadow-line/60">
          {options.length > searchThreshold && (
            <div className="flex items-center gap-2 border-b border-line px-2.5 py-2">
              <Search className="h-3.5 w-3.5 flex-shrink-0 text-fg-faint" aria-hidden="true" />
              <input
                ref={searchInputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={searchPlaceholder}
                aria-label={searchPlaceholder}
                className="w-full bg-transparent text-sm text-fg outline-none placeholder:text-fg-faint"
              />
            </div>
          )}
          <div className="max-h-56 overflow-y-auto py-1">
            {filteredOptions.length === 0 && (
              <p className="px-3 py-2 text-sm text-fg-faint">No matches</p>
            )}
            {filteredOptions.map((opt) => {
              const isChecked = selected.includes(opt.value)
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => toggle(opt.value)}
                  className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-sm text-fg-muted hover:bg-surface-sunken"
                >
                  <span
                    className={cn(
                      'flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border',
                      isChecked ? 'border-brand-600 bg-brand-600 text-white' : 'border-line-strong',
                    )}
                  >
                    {isChecked && <Check className="h-3 w-3" />}
                  </span>
                  <span className="truncate">{opt.label}</span>
                </button>
              )
            })}
          </div>
          {selected.length > 0 && (
            <div className="border-t border-line px-2.5 py-1.5">
              <button
                type="button"
                onClick={() => onChange([])}
                className="text-xs font-medium text-brand-600 hover:underline"
              >
                Clear
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
