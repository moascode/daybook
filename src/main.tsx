import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { reloadOnceForChunkError } from '@/lib/chunkReload'
import './index.css'

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // SW registration failed — app still works without it
    })
  })
}

// Vite's own signal for an `import()` whose network request failed/404'd —
// see src/lib/chunkReload.ts for the rest of this story. A `lazy()` import
// rejection that React throws during render instead of here is caught by the
// router's `errorElement` (src/components/layout/RouteErrorBoundary.tsx),
// which calls the same guarded reload.
window.addEventListener('vite:preloadError', () => {
  reloadOnceForChunkError()
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
