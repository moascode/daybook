import { useState } from 'react'
import { DatePicker } from './DatePicker'
import { cn, monthRange, dateRangePreset, type DateRangePreset } from '@/lib/utils'

export interface DateRangeValue {
  dateFrom: string
  dateTo: string
}

// The "All time" segment keeps the historical filter-clear-dates test id — it is
// the same action the old pill performed and several specs drive it by that name.
const PRESET_META: Record<DateRangePreset, { label: string; testId: string }> = {
  'this-month': { label: 'This month', testId: 'filter-this-month' },
  'last-month': { label: 'Last month', testId: 'filter-last-month' },
  'all-time': { label: 'All time', testId: 'filter-clear-dates' },
  custom: { label: 'Custom…', testId: 'filter-custom-range' },
}

interface DateRangeControlProps {
  value: DateRangeValue
  onChange: (value: DateRangeValue) => void
  presets?: DateRangePreset[]
  className?: string
}

// §6.4: the one date-range UI, shared by Transactions, Dashboard and Reports.
// Renders a segmented picker that always shows its active value; "Custom…"
// reveals From/To pickers without touching the current range. With a single
// 'custom' preset (Reports) only the From/To pair is rendered.
export function DateRangeControl({
  value,
  onChange,
  presets = ['this-month', 'last-month', 'all-time', 'custom'],
  className,
}: DateRangeControlProps) {
  const derived = dateRangePreset(value)
  const [customOpen, setCustomOpen] = useState(derived === 'custom')
  const customOnly = presets.length === 1 && presets[0] === 'custom'
  const showCustom = presets.includes('custom') && (customOnly || customOpen || derived === 'custom')
  const active: DateRangePreset = showCustom ? 'custom' : derived

  function selectPreset(preset: DateRangePreset) {
    if (preset === 'custom') {
      setCustomOpen(true)
      return
    }
    setCustomOpen(false)
    if (preset === 'all-time') onChange({ dateFrom: '', dateTo: '' })
    else onChange(monthRange(preset === 'this-month' ? 0 : -1))
  }

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {!customOnly && (
        <div className="flex rounded-lg border border-gray-200 bg-white" role="group" aria-label="Date range">
          {presets.map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => selectPreset(preset)}
              data-testid={PRESET_META[preset].testId}
              aria-pressed={active === preset}
              className={cn(
                'px-3 py-2 text-sm font-medium transition-colors first:rounded-l-lg last:rounded-r-lg',
                active === preset ? 'bg-brand-500 text-white' : 'text-gray-600 hover:bg-gray-50',
              )}
            >
              {PRESET_META[preset].label}
            </button>
          ))}
        </div>
      )}
      {showCustom && (
        <div className="flex flex-wrap items-end gap-3">
          <DatePicker
            label="From"
            value={value.dateFrom}
            onChange={(e) => onChange({ ...value, dateFrom: e.target.value })}
          />
          <DatePicker
            label="To"
            value={value.dateTo}
            onChange={(e) => onChange({ ...value, dateTo: e.target.value })}
          />
        </div>
      )}
    </div>
  )
}
