import { useEffect, useState } from 'react'

// Matches data.css's `@media (max-width: 680px)` breakpoint, where `.lhead`
// is already hidden. Reports cards use it to drop columns that don't fit a
// phone rather than scroll them sideways.
const MOBILE_QUERY = '(max-width: 680px)'

export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(() => (typeof window !== 'undefined' ? window.matchMedia(MOBILE_QUERY).matches : false))
  useEffect(() => {
    const mql = window.matchMedia(MOBILE_QUERY)
    const onChange = () => setIsMobile(mql.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])
  return isMobile
}
