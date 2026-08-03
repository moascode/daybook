import { useNavigate } from 'react-router-dom'
import { HelpCircle } from 'lucide-react'
import { Tooltip } from '@/components/ui/Tooltip'

/**
 * Right-aligned "?" action in the top bar. Opens the in-app user guide.
 * Shared by the desktop TopBar and the mobile top bar in AppShell.
 */
export function HelpButton() {
  const navigate = useNavigate()
  return (
    <Tooltip label="Help">
      <button
        type="button"
        onClick={() => navigate('/help')}
        aria-label="Help & Guide"
        className="flex h-9 w-9 items-center justify-center rounded-md text-fg-faint transition-colors hover:bg-surface-hover hover:text-fg-muted"
      >
        <HelpCircle className="h-[18px] w-[18px]" />
      </button>
    </Tooltip>
  )
}
