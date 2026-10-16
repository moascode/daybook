import { CaptureTokens } from '../CaptureTokens'

/**
 * Settings → Connected devices. Moved out of the old monolithic SettingsPage
 * (module-based settings) with no behaviour change — `<CaptureTokens/>` is
 * untouched.
 */
export function DevicesSettings() {
  return (
    <div className="mx-auto max-w-lg md:mx-0 md:max-w-xl">
      <h1 className="page-title mb-6">Connected devices</h1>
      <CaptureTokens />
    </div>
  )
}
