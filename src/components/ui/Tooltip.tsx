import * as RadixTooltip from '@radix-ui/react-tooltip'

interface TooltipProps {
  label: string
  children: React.ReactNode
  side?: 'top' | 'right' | 'bottom' | 'left'
}

/**
 * Thin wrapper over Radix Tooltip for icon buttons. Self-contained: it brings
 * its own Provider so a caller can drop a single <Tooltip> anywhere without a
 * global provider. Delay is short so hovering an icon reveals its label quickly.
 */
export function Tooltip({ label, children, side = 'bottom' }: TooltipProps) {
  return (
    <RadixTooltip.Provider delayDuration={200}>
      <RadixTooltip.Root>
        <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
        <RadixTooltip.Portal>
          <RadixTooltip.Content
            side={side}
            sideOffset={6}
            className="z-50 rounded-md bg-surface-inverted px-2 py-1 text-xs font-medium text-fg-inverted shadow-md"
          >
            {label}
            <RadixTooltip.Arrow className="fill-surface-inverted" />
          </RadixTooltip.Content>
        </RadixTooltip.Portal>
      </RadixTooltip.Root>
    </RadixTooltip.Provider>
  )
}
