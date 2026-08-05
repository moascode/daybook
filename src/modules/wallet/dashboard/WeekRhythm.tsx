import { formatMYR } from '@/lib/utils'
import { useAppStore } from '@/stores/app.store'
import { DashboardCard } from './DashboardCard'
import { WEEKDAY_LABELS } from './insights'

interface WeekRhythmProps {
  /** Seven averages, Monday first. */
  averages: number[]
  months: number
}

// Low → high spend, mapped onto Tailwind's `blue` scale. This scale is
// already dark-mode-safe (mirrored through the CSS token layer — see
// tailwind.config.js), so plain classes here need no `dark:` variant.
const HEAT_STEPS = ['bg-blue-100', 'bg-blue-200', 'bg-blue-300', 'bg-blue-400', 'bg-blue-500', 'bg-blue-600']
// Text flips to white once the fill is dark enough that dark text stops
// reading. The mirror pairs each step with its opposite lightness (100<->900,
// 600<->400, ...), so step 4-5 are the darkest fills in LIGHT mode but among
// the LIGHTEST in DARK mode (measured: white-on-step5-dark contrast is
// ~2.5:1, well under the 4.5:1 minimum). The pass/fail boundary lands at the
// same step index in both themes — only which side wants white flips — so the
// comparison direction inverts with resolvedTheme rather than the threshold
// itself. `text-fg` can't stand in for the non-white side in dark mode either:
// it's the theme's normal (light-coloured) text, which is exactly as unreadable
// on a pale dark-mode fill as white is. Both sides need a theme-invariant
// literal here — `text-white` was already one; INK is its dark counterpart,
// deliberately not a semantic token, for the same reason `text-white` isn't.
const LIGHT_TEXT_FROM_STEP = 4
const INK = 'text-slate-900'
const INK_MUTED = 'text-slate-900/70'

/**
 * Average spend by weekday, as a small heatmap strip — the timing axis nothing
 * else in the app touches. Colour-graded rather than columns: seven single
 * numbers are a magnitude comparison, and a heatmap reads that at a glance
 * with a legend doing the rest, rather than asking the reader to compare bar
 * heights against no fixed scale.
 */
export function WeekRhythm({ averages, months }: WeekRhythmProps) {
  const resolvedTheme = useAppStore((s) => s.resolvedTheme)
  const max = Math.max(...averages)
  const min = Math.min(...averages)
  const span = max - min || 1
  const total = averages.reduce((a, b) => a + b, 0)
  const weekend = averages[4] + averages[5] + averages[6]
  const weekendShare = total > 0 ? (weekend / total) * 100 : 0
  const weekendDayShare = (3 / 7) * 100
  const busiest = averages.indexOf(max)

  const stepFor = (value: number) => {
    const t = (value - min) / span
    return Math.min(HEAT_STEPS.length - 1, Math.round(t * (HEAT_STEPS.length - 1)))
  }

  return (
    <DashboardCard
      title="Your week"
      subtitle={`Average spend per weekday over the last ${months} month${months === 1 ? '' : 's'}.`}
    >
      <div
        className="grid grid-cols-7 gap-1 sm:gap-1.5"
        role="img"
        aria-label={`Average spend by weekday. ${WEEKDAY_LABELS.map(
          (d, i) => `${d}: ${formatMYR(averages[i])}`,
        ).join('; ')}.`}
        data-testid="week-rhythm"
      >
        {averages.map((value, i) => {
          const step = stepFor(value)
          const white = resolvedTheme === 'dark' ? step < LIGHT_TEXT_FROM_STEP : step >= LIGHT_TEXT_FROM_STEP
          return (
            <div
              key={WEEKDAY_LABELS[i]}
              className={`flex flex-col items-center justify-center gap-1 rounded-lg py-3 ${HEAT_STEPS[step]} ${
                i === busiest ? 'ring-2 ring-inset ring-brand-500' : ''
              }`}
            >
              <span className={`text-[11px] font-semibold ${white ? 'text-white' : INK}`}>
                {WEEKDAY_LABELS[i]}
              </span>
              <span className={`text-[11px] font-medium tabular-nums ${white ? 'text-white/85' : INK_MUTED}`}>
                {Math.round(value)}
              </span>
            </div>
          )
        })}
      </div>

      <div className="mt-3 flex items-center gap-2 text-[11px] text-fg-faint">
        <span>{formatMYR(min)}</span>
        <span className="flex flex-1 overflow-hidden rounded" aria-hidden="true">
          {HEAT_STEPS.map((step) => (
            <span key={step} className={`h-2 flex-1 ${step}`} />
          ))}
        </span>
        <span>{formatMYR(max)} average per day</span>
      </div>

      {total > 0 && (
        <p className="mt-4 rounded-lg bg-brand-50 px-3 py-2.5 text-xs leading-relaxed text-fg">
          <span className="font-semibold">Fri–Sun is {weekendShare.toFixed(0)}%</span> of your
          weekly spending in {weekendDayShare.toFixed(0)}% of the days.{' '}
          {WEEKDAY_LABELS[busiest]} is your heaviest day at {formatMYR(averages[busiest])} on
          average.
        </p>
      )}
    </DashboardCard>
  )
}
