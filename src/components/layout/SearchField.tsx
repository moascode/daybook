import { Search } from 'lucide-react'

/**
 * The app bar's global search field — shell only in R2 (design spec §3). It
 * grows and lifts on focus via the already-ported `.appbar .search:focus-within`
 * rules; there is no results dropdown and no keyboard shortcut wired to it yet
 * (that's R17), so it deliberately shows no `.kbd` shortcut hint here — a hint
 * pointing at a key that does nothing would be a false promise.
 */
export function SearchField() {
  return (
    <div className="search">
      <Search className="icon-sm" size={15} aria-hidden="true" />
      <input
        type="text"
        placeholder="Search Daybook…"
        aria-label="Search across all modules"
        onKeyDown={(e) => {
          if (e.key === 'Escape') e.currentTarget.blur()
        }}
      />
    </div>
  )
}
