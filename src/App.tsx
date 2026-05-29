import { useEffect, useState } from 'react'
import { RouterProvider } from 'react-router-dom'
import { router } from './router'
import { api } from '@/lib/api'
import { useAppStore } from '@/stores/app.store'

export default function App() {
  const [error, setError] = useState<string | null>(null)
  const dbReady = useAppStore((s) => s.dbReady)
  const setDbReady = useAppStore((s) => s.setDbReady)
  const theme = useAppStore((s) => s.theme)
  const setTheme = useAppStore((s) => s.setTheme)

  useEffect(() => {
    api
      .get<{ key: string; value: string }[]>('/settings')
      .then((settings) => {
        setDbReady(true)
        const saved = settings.find((s) => s.key === 'theme')?.value
        if (saved === 'light' || saved === 'dark' || saved === 'system') {
          setTheme(saved)
        }
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : 'Unknown error'
        console.error('Server connection failed:', err)
        setError(message)
      })
  }, [setDbReady, setTheme])

  // Apply dark class based on theme setting
  useEffect(() => {
    const root = document.documentElement
    if (theme === 'dark') {
      root.classList.add('dark')
    } else if (theme === 'light') {
      root.classList.remove('dark')
    } else {
      const mq = window.matchMedia('(prefers-color-scheme: dark)')
      mq.matches ? root.classList.add('dark') : root.classList.remove('dark')
      const handler = (e: MediaQueryListEvent) => {
        e.matches ? root.classList.add('dark') : root.classList.remove('dark')
      }
      mq.addEventListener('change', handler)
      return () => mq.removeEventListener('change', handler)
    }
  }, [theme])

  if (error) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50">
        <div className="max-w-md rounded-xl bg-white p-8 shadow-lg">
          <h1 className="text-lg font-bold text-red-600">Database Error</h1>
          <p className="mt-2 text-sm text-gray-600">{error}</p>
          <button
            className="mt-4 rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600"
            onClick={() => window.location.reload()}
          >
            Retry
          </button>
        </div>
      </div>
    )
  }

  if (!dbReady) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
          <p className="text-sm text-gray-500">Loading Daybook...</p>
        </div>
      </div>
    )
  }

  return <RouterProvider router={router} />
}
