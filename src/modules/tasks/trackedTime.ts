/** Pure helpers for tracked-time display (migration 0031). */

/** "45m", "1h 12m", "2h" — minutes banked on a task or summed over a group. */
export function formatTrackedMinutes(minutes: number): string {
  const m = Math.max(0, Math.round(minutes))
  const h = Math.floor(m / 60)
  const rem = m % 60
  if (h === 0) return `${rem}m`
  return rem === 0 ? `${h}h` : `${h}h ${rem}m`
}

/** Live timer readout: "m:ss" under an hour, "h:mm:ss" from one hour up. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const ss = String(s).padStart(2, '0')
  if (h === 0) return `${m}:${ss}`
  return `${h}:${String(m).padStart(2, '0')}:${ss}`
}

/**
 * Epoch ms of a server `timer_started_at` — SQLite's `datetime('now')` form,
 * 'YYYY-MM-DD HH:MM:SS' in UTC with no zone marker, which `Date.parse` would
 * otherwise read as local time. Returns NaN for anything malformed.
 */
export function parseServerUtc(value: string): number {
  return Date.parse(`${value.replace(' ', 'T')}Z`)
}
