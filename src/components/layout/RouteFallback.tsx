/**
 * Shown while a route's code chunk downloads (v3 P3).
 *
 * Its own file because router.tsx exports `router`, not a component, and
 * react-refresh/only-export-components forbids mixing the two — Fast Refresh
 * cannot hot-swap a component that lives beside a non-component export.
 *
 * The copy matches the app's existing loading treatment (CaptureInbox,
 * SharedPage) rather than introducing a spinner nothing else uses.
 */
export function RouteFallback() {
  return (
    <p className="py-12 text-center text-sm text-fg-subtle" data-testid="route-loading">
      Loading…
    </p>
  )
}
