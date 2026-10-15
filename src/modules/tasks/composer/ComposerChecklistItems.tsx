import { useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'

export interface ComposerChecklistItemsProps {
  items: string[]
  onChange: (items: string[]) => void
  /** Escape in any item exits checklist mode. */
  onExit: () => void
  /** Enter in the title input moves focus here; the parent bumps this to request it. */
  focusFirstSignal: number
  disabled?: boolean
}

/**
 * The item list under the checklist title (FEAT-056). Enter in an item adds
 * the next one directly below and focuses it; Backspace on an EMPTY item
 * removes it (never the last remaining one) and focuses the previous.
 */
export function ComposerChecklistItems({ items, onChange, onExit, focusFirstSignal, disabled }: ComposerChecklistItemsProps) {
  const refs = useRef<(HTMLInputElement | null)[]>([])
  const pendingFocus = useRef<number | null>(null)

  useEffect(() => {
    if (pendingFocus.current !== null) {
      refs.current[pendingFocus.current]?.focus()
      pendingFocus.current = null
    }
  })

  useEffect(() => {
    if (focusFirstSignal > 0) refs.current[0]?.focus()
  }, [focusFirstSignal])

  function setItem(i: number, value: string) {
    onChange(items.map((it, idx) => (idx === i ? value : it)))
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>, i: number) {
    if (e.key === 'Enter') {
      e.preventDefault()
      pendingFocus.current = i + 1
      onChange([...items.slice(0, i + 1), '', ...items.slice(i + 1)])
    } else if (e.key === 'Backspace' && items[i] === '' && items.length > 1) {
      e.preventDefault()
      pendingFocus.current = Math.max(0, i - 1)
      onChange(items.filter((_, idx) => idx !== i))
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onExit()
    }
  }

  return (
    <ul className="mt-3 flex flex-col gap-1.5" data-testid="composer-checklist-items">
      {items.map((item, i) => (
        <li key={i} className="flex items-center gap-2">
          <span className="h-4 w-4 flex-shrink-0 rounded border border-line-strong" aria-hidden="true" />
          <input
            ref={(node) => {
              refs.current[i] = node
            }}
            type="text"
            value={item}
            onChange={(e) => setItem(i, e.target.value)}
            onKeyDown={(e) => handleKeyDown(e, i)}
            placeholder={i === 0 ? 'First item' : 'Next item'}
            aria-label={`Checklist item ${i + 1}`}
            data-testid="composer-checklist-item"
            disabled={disabled}
            className={cn(
              'min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-2 py-1.5 text-sm',
              'hover:bg-surface-hover focus:border-brand-500 focus:bg-surface focus:outline-none focus:ring-2 focus:ring-brand-500/20',
            )}
          />
        </li>
      ))}
    </ul>
  )
}
