import { useLayoutEffect, useRef, useState } from 'react'
import { formatMYR } from '@/lib/utils'
import type { ClaimState, SplitClaim } from '@/types/household.types'

/**
 * The three states outstanding money can be in, in lifecycle order — which is
 * also the order they are drawn, so the bar reads left to right as the claim's
 * life. 'settled' and 'rejected' are deliberately absent: see the caption below.
 *
 * Colours are a validated categorical set (amber-600 / blue-600 / brand green),
 * not a hand-picked one. All three clear the lightness band, the chroma floor,
 * 3:1 against the surface, and — the check that rules most triples out — CVD
 * separation on every adjacent pair, worst case ΔE 25 deutan. An earlier
 * blue/violet pairing failed at ΔE 1.3: indistinguishable to a deuteranope and
 * barely separable with full colour vision.
 */
const STATES: { state: ClaimState; label: string; color: string }[] = [
  { state: 'pending', label: 'To review', color: '#d97706' },
  { state: 'approved', label: 'Agreed', color: '#2563eb' },
  { state: 'awaiting_confirmation', label: 'Paid, unconfirmed', color: '#1D9E75' },
]

interface Segment {
  state: ClaimState
  label: string
  color: string
  amount: number
  /** Who the money is with, largest first. The tooltip's second line. */
  byPerson: { name: string; amount: number }[]
}

interface SplitStateBarProps {
  /** 'Owed to you' or 'You owe'. */
  title: string
  /** Every claim in this direction, any state. */
  claims: SplitClaim[]
  /** Names the counterparty on each row, per direction. */
  personOf: (claim: SplitClaim) => string
  testId: string
}

/**
 * One direction of shared money, drawn as a single proportional bar broken into
 * the states it is sitting in.
 *
 * The line it replaces — "RM21.35 agreed · RM684.80 awaiting their review" —
 * said the right thing but made the reader do the arithmetic to find out that
 * 97% of the money is stuck at the first step. A bar answers that at a glance,
 * which is the whole reason to draw it.
 *
 * Part-to-whole of a single total, so: one horizontal stacked bar, not a pie and
 * not three bars. Horizontal because the category names are long.
 */
export function SplitStateBar({ title, claims, personOf, testId }: SplitStateBarProps) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [trackWidth, setTrackWidth] = useState(0)
  const [hovered, setHovered] = useState<number | null>(null)

  // Inline labels are drawn only where they fit, which cannot be known without
  // the rendered width — the track is fluid and the segments are percentages of
  // it. Measured rather than guessed: the alternative is text spilling out of
  // its own segment, and clipping it with overflow:hidden crops the first
  // characters, which is worse than no label at all.
  useLayoutEffect(() => {
    const el = trackRef.current
    if (!el) return
    setTrackWidth(el.clientWidth)
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(([entry]) => setTrackWidth(entry.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const segments: Segment[] = []
  for (const { state, label, color } of STATES) {
    const inState = claims.filter((c) => c.state === state && c.outstanding > 0.005)
    if (inState.length === 0) continue
    const byName = new Map<string, number>()
    for (const c of inState) byName.set(personOf(c), (byName.get(personOf(c)) ?? 0) + c.outstanding)
    segments.push({
      state,
      label,
      color,
      amount: inState.reduce((sum, c) => sum + c.outstanding, 0),
      byPerson: [...byName]
        .map(([name, amount]) => ({ name, amount }))
        .sort((a, b) => b.amount - a.amount),
    })
  }

  // Gross claims in this direction, not the netted group balance the sections
  // below show.
  //
  // These have to be the same number as the segments, and netting makes them
  // different: with debts running both ways the netted "you owe" collapses to
  // RM0.00 while there is still real money in the To review bucket, so the card
  // printed a zero directly above a bar that disagreed with it. The two
  // directions are separate piles of claims, and this is what each pile is
  // worth; netting is a settlement concern and stays where settling happens.
  const segmentTotal = segments.reduce((sum, s) => sum + s.amount, 0)
  // Cleared money, as a caption rather than a fourth segment. Settled amounts
  // are cumulative and outstanding ones are not, so a settled block would grow
  // without bound and squeeze the three states that can still be acted on down
  // to slivers — the bar would stop answering the question it exists for.
  const settled = claims
    .filter((c) => c.state === 'settled')
    .reduce((sum, c) => sum + c.shareAmount, 0)

  if (segmentTotal < 0.005 && settled < 0.005) return null

  return (
    <div data-testid={testId}>
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-xs font-medium text-gray-600">{title}</p>
        <p className="text-sm font-semibold tabular-nums text-gray-900" data-testid="state-bar-total">
          {formatMYR(segmentTotal)}
        </p>
      </div>

      {segmentTotal > 0.005 && (
        <div className="relative mt-1.5">
          {/* role="img" with the whole breakdown in the label: the bar itself is
              decorative to a screen reader, and the legend below repeats every
              figure in text, so nothing here is gated behind a hover. */}
          <div
            ref={trackRef}
            role="img"
            aria-label={`${title}: ${segments.map((s) => `${s.label} ${formatMYR(s.amount)}`).join(', ')}`}
            className="flex h-7 w-full gap-0.5 rounded-md"
            onMouseLeave={() => setHovered(null)}
          >
            {segments.map((seg, i) => {
              const pct = (seg.amount / segmentTotal) * 100
              // A sliver still has to be hoverable, so it keeps a floor width —
              // at the cost of the bar being very slightly out of proportion
              // when one state is a rounding error next to another.
              const width = (trackWidth * pct) / 100
              const inline = fittingLabel(seg, width)
              return (
                <div
                  key={seg.state}
                  data-testid="split-state-segment"
                  data-state={seg.state}
                  style={{
                    width: `${pct}%`,
                    minWidth: segments.length > 1 ? 10 : undefined,
                    backgroundColor: seg.color,
                    color: inkOn(seg.color),
                  }}
                  className="flex cursor-default items-center justify-center whitespace-nowrap px-2 text-[11px] font-medium first:rounded-l-md last:rounded-r-md"
                  onMouseEnter={() => setHovered(i)}
                >
                  {inline}
                </div>
              )
            })}
          </div>

          {hovered !== null && segments[hovered] && (
            <div
              className="pointer-events-none absolute -top-1 z-10 w-max max-w-full -translate-y-full rounded-lg bg-gray-900 px-3 py-2 text-xs text-white shadow-lg"
              style={{ left: `${tooltipLeft(segments, hovered, segmentTotal)}%` }}
              data-testid="split-state-tooltip"
              aria-hidden="true"
            >
              <p className="font-semibold">
                {segments[hovered].label} · {formatMYR(segments[hovered].amount)}
              </p>
              {segments[hovered].byPerson.map((p) => (
                <p key={p.name} className="mt-0.5 text-gray-300">
                  {p.name} {formatMYR(p.amount)}
                </p>
              ))}
            </div>
          )}
        </div>
      )}

      {/* The legend carries every figure the bar does. That is what lets the
          inline labels drop out when a segment is narrow without any value
          becoming hover-only. */}
      {segments.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1" data-testid="split-state-legend">
          {segments.map((seg) => (
            <li key={seg.state} className="flex items-center gap-1.5 text-[11px] text-gray-600">
              <span
                className="h-2 w-2 shrink-0 rounded-sm"
                style={{ backgroundColor: seg.color }}
                aria-hidden="true"
              />
              {seg.label}
              <span className="font-medium tabular-nums text-gray-900">{formatMYR(seg.amount)}</span>
            </li>
          ))}
        </ul>
      )}

      {settled > 0.005 && (
        <p className="mt-1.5 text-[11px] text-gray-400" data-testid="split-state-settled">
          {formatMYR(settled)} already settled
        </p>
      )}
    </div>
  )
}

/**
 * The most informative label that fits inside a segment, or nothing.
 *
 * Tries "To review · RM684.80", then the amount alone, then gives up and lets
 * the legend and the tooltip carry it. The width estimate is deliberately
 * pessimistic — an 11px medium glyph averages under 6px, so budgeting 6.4 plus
 * 20px of padding errs towards dropping a label that would just have fitted
 * rather than printing one that does not.
 */
function fittingLabel(seg: Segment, width: number): string {
  if (!width) return ''
  const fits = (text: string) => text.length * 6.4 + 20 <= width
  const full = `${seg.label} · ${formatMYR(seg.amount)}`
  if (fits(full)) return full
  const money = formatMYR(seg.amount)
  return fits(money) ? money : ''
}

/** White or near-black on a fill, whichever contrasts more (WCAG relative luminance). */
function inkOn(hex: string): string {
  const channel = (v: number) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
  const [r, g, b] = [1, 3, 5].map((i) => channel(parseInt(hex.slice(i, i + 2), 16) / 255))
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
  return (lum + 0.05) / 0.05 > 1.05 / (lum + 0.05) ? '#111827' : '#ffffff'
}

/**
 * Left edge of the hovered segment, as a percentage of the track. Capped so a
 * tooltip anchored to the last segment does not run off the right-hand side.
 */
function tooltipLeft(segments: Segment[], index: number, total: number): number {
  const before = segments.slice(0, index).reduce((sum, s) => sum + s.amount, 0)
  return Math.min(60, (before / total) * 100)
}
