import { useEffect, useState } from 'react'
import { RouterProvider } from 'react-router-dom'
import { router } from './router'
import { getDB } from '@/db'
import { useAppStore } from '@/stores/app.store'

export default function App() {
  const [error, setError] = useState<string | null>(null)
  const dbReady = useAppStore((s) => s.dbReady)
  const setDbReady = useAppStore((s) => s.setDbReady)

  useEffect(() => {
    getDB()
      .then(() => setDbReady(true))
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : 'Unknown error'
        console.error('DB init failed:', err)
        setError(message)
      })
  }, [setDbReady])

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
