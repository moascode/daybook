import { useEffect, useState } from 'react'
import { RouterProvider } from 'react-router-dom'
import { router } from './router'
import { api, ApiError, setUnauthorizedHandler } from '@/lib/api'
import { useAppStore, type AuthUser } from '@/stores/app.store'
import { useWalletStore } from '@/stores/wallet.store'
import { useToastStore } from '@/stores/toast.store'
import { AuthPage } from '@/components/auth/AuthPage'

export default function App() {
  const [error, setError] = useState<string | null>(null)
  const [authChecked, setAuthChecked] = useState(false)
  const dbReady = useAppStore((s) => s.dbReady)
  const setDbReady = useAppStore((s) => s.setDbReady)
  const theme = useAppStore((s) => s.theme)
  const setTheme = useAppStore((s) => s.setTheme)
  const user = useAppStore((s) => s.user)
  const setUser = useAppStore((s) => s.setUser)

  // If the session expires mid-use, any data request 401s — return to login.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      setDbReady(false)
      setUser(null)
    })
    return () => setUnauthorizedHandler(null)
  }, [setDbReady, setUser])

  // Boot: is there a session? Determines whether we show the app or AuthPage.
  useEffect(() => {
    api
      .get<{ user: AuthUser }>('/auth/me')
      .then(({ user }) => setUser(user))
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 401) {
          setUser(null) // not logged in — AuthPage will render
        } else {
          const message = err instanceof Error ? err.message : 'Unknown error'
          console.error('Server connection failed:', err)
          setError(message)
        }
      })
      .finally(() => setAuthChecked(true))
  }, [setUser])

  // Once authenticated, load the user's saved theme and unblock the app.
  useEffect(() => {
    if (!user) {
      setDbReady(false)
      return
    }
    api
      .get<{ key: string; value: string }[]>('/settings')
      .then((settings) => {
        const saved = settings.find((s) => s.key === 'theme')?.value
        if (saved === 'light' || saved === 'dark' || saved === 'system') {
          setTheme(saved)
        }
        setDbReady(true)
        // Post any recurring rules that have come due since the last visit.
        // Fire-and-forget: a failure here must never block the app. When it
        // posts anything, tell the user and invalidate wallet data so any
        // mounted page re-fetches the new transactions/balances.
        api
          .post<{ posted: number }>('/recurring-transactions/process')
          .then(({ posted }) => {
            if (posted > 0) {
              useWalletStore.getState().invalidate()
              useToastStore.getState().addToast({
                message: `Posted ${posted} due recurring transaction${posted === 1 ? '' : 's'}`,
                duration: 5000,
              })
            }
          })
          .catch((err: unknown) => {
            console.error('Failed to process recurring transactions:', err)
          })
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : 'Unknown error'
        console.error('Failed to load settings:', err)
        setError(message)
      })
  }, [user, setDbReady, setTheme])

  // Apply dark class based on theme setting
  useEffect(() => {
    const root = document.documentElement
    if (theme === 'dark') {
      root.classList.add('dark')
    } else if (theme === 'light') {
      root.classList.remove('dark')
    } else {
      const mq = window.matchMedia('(prefers-color-scheme: dark)')
      root.classList.toggle('dark', mq.matches)
      const handler = (e: MediaQueryListEvent) => {
        root.classList.toggle('dark', e.matches)
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

  if (!authChecked || (user && !dbReady)) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
          <p className="text-sm text-gray-500">Loading Daybook...</p>
        </div>
      </div>
    )
  }

  if (!user) {
    return <AuthPage />
  }

  return <RouterProvider router={router} />
}
