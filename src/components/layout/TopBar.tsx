import { useLocation } from 'react-router-dom'
import { routeTitles } from './routeTitles'
import { HelpButton } from './HelpButton'
import { ThemeToggle } from './ThemeToggle'

export function TopBar() {
  const location = useLocation()
  const title = routeTitles[location.pathname] ?? 'Daybook'

  return (
    <header className="flex h-12 shrink-0 items-center justify-between border-b border-line bg-surface px-6">
      <h1 className="text-sm font-semibold text-fg-muted tracking-wide uppercase">{title}</h1>
      <div className="flex items-center gap-1">
        <ThemeToggle />
        <HelpButton />
      </div>
    </header>
  )
}
