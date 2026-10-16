import type { LucideIcon } from 'lucide-react'
import { User, Palette, Bell, Smartphone, Sparkles, Users } from 'lucide-react'
import { modules, type ModuleDescriptor } from '@/components/layout/modules'

export type SettingsGroup = 'You' | 'Household' | 'Modules'

export interface SettingsSection {
  id: string
  label: string
  path: string
  group: SettingsGroup
  icon: LucideIcon
  /** Shown under the label where a listing has room (AccountMenu's module
   *  rows, the mobile index list). Module sections source this from
   *  `modules[].settingsBlurb` rather than repeating it here. */
  blurb?: string
  moduleId?: ModuleDescriptor['id']
  disabled?: boolean
  /** Required alongside `disabled: true`. */
  disabledReason?: string
}

/**
 * The ONE settings registry (CLAUDE.md §module-settings). SettingsLayout's
 * left nav, AccountMenu's "Settings & privacy" pane and ModuleSidebar's
 * per-module settings link all read this list — none of them keeps its own
 * copy, so the three entry points cannot drift out of sync with each other.
 *
 * Module rows are derived from `modules` (src/components/layout/modules.ts)
 * rather than duplicated here: id, label and blurb come from there, so a
 * future module rename only has to happen once.
 */
const youSections: SettingsSection[] = [
  { id: 'profile', label: 'Profile & security', path: '/settings/profile', group: 'You', icon: User },
  { id: 'appearance', label: 'Appearance', path: '/settings/appearance', group: 'You', icon: Palette },
  { id: 'notifications', label: 'Notifications', path: '/settings/notifications', group: 'You', icon: Bell },
  { id: 'devices', label: 'Connected devices', path: '/settings/devices', group: 'You', icon: Smartphone },
  { id: 'ai', label: 'AI assistant', path: '/settings/ai', group: 'You', icon: Sparkles },
]

const householdSections: SettingsSection[] = [
  { id: 'sharing', label: 'Sharing', path: '/settings/sharing', group: 'Household', icon: Users },
]

const moduleSections: SettingsSection[] = modules.map((m) => ({
  id: m.id,
  label: m.label,
  path: `/settings/${m.id}`,
  group: 'Modules',
  icon: m.icon,
  blurb: m.settingsBlurb,
  moduleId: m.id,
  // Trips has no settings page yet — listed, but disabled, same pattern as
  // its own nav items (ModuleSidebar) and AppBar's disabled module tab.
  disabled: m.id === 'trips' ? true : undefined,
  disabledReason: m.id === 'trips' ? 'coming later' : undefined,
}))

export const settingsSections: SettingsSection[] = [...youSections, ...householdSections, ...moduleSections]

export const SETTINGS_GROUP_ORDER: SettingsGroup[] = ['You', 'Household', 'Modules']

/**
 * The settings path for a given module's sidebar link (ModuleSidebar's
 * `nav-settings`). Falls back to `/settings` for a module with no settings
 * section, or whose section is disabled (Trips) — never a dead link.
 */
export function settingsPathForModule(moduleId: ModuleDescriptor['id']): string {
  const section = settingsSections.find((s) => s.moduleId === moduleId)
  if (!section || section.disabled) return '/settings'
  return section.path
}
