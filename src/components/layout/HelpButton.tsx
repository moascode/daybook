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
        className="flex h-9 w-9 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
      >
        <HelpCircle className="h-[18px] w-[18px]" />
      </button>
    </Tooltip>
  )
}
