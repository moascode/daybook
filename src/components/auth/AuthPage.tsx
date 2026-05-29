import { useState } from 'react'
import { api, ApiError } from '@/lib/api'
import { useAppStore, type AuthUser } from '@/stores/app.store'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'

type Mode = 'login' | 'signup'

/**
 * First screen when no session exists. Handles login + signup against the
 * Phase 4 backend; on success it stores the user, which lets App render the app.
 */
export function AuthPage() {
  const setUser = useAppStore((s) => s.setUser)

  const [mode, setMode] = useState<Mode>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!username.trim() || !password) {
      setError('Enter a username and password.')
      return
    }
    setSubmitting(true)
    try {
      const path = mode === 'signup' ? '/auth/signup' : '/auth/login'
      const { user } = await api.post<{ user: AuthUser }>(path, {
        username: username.trim(),
        password,
      })
      setUser(user)
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setError('That username is already taken.')
      } else if (err instanceof ApiError && err.status === 401) {
        setError('Invalid username or password.')
      } else {
        setError('Something went wrong. Please try again.')
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
        <div className="mb-6 text-center">
          <h1 className="text-xl font-bold text-gray-900">Daybook</h1>
          <p className="mt-1 text-sm text-gray-500">
            {mode === 'login' ? 'Sign in to your account' : 'Create your account'}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Input
            label="Username"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
          <Input
            label="Password"
            type="password"
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />

          {error && <p className="text-sm text-red-500">{error}</p>}

          <Button type="submit" size="lg" disabled={submitting}>
            {submitting
              ? 'Please wait…'
              : mode === 'login'
                ? 'Sign in'
                : 'Create account'}
          </Button>
        </form>

        <p className="mt-5 text-center text-sm text-gray-500">
          {mode === 'login' ? "Don't have an account?" : 'Already have an account?'}{' '}
          <button
            type="button"
            className="font-medium text-brand-600 hover:text-brand-700"
            onClick={() => {
              setMode((m) => (m === 'login' ? 'signup' : 'login'))
              setError(null)
            }}
          >
            {mode === 'login' ? 'Sign up' : 'Sign in'}
          </button>
        </p>
      </div>
    </div>
  )
}
