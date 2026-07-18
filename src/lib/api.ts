/**
 * Thin REST client for the Daybook backend (Phase 4).
 *
 * All requests go through Vite's `/api` proxy → the Node server. `credentials:
 * 'include'` is set ahead of the Phase 4 auth stage, where the server issues a
 * session cookie.
 */

const BASE = '/api'

class ApiError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

// App registers a handler so that a 401 on any data request (i.e. the session
// expired mid-use) re-gates to the login screen instead of failing silently.
// Auth endpoints are excluded — their 401s are expected and handled locally.
let onUnauthorized: (() => void) | null = null
export function setUnauthorizedHandler(fn: (() => void) | null): void {
  onUnauthorized = fn
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'include',
  })

  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/auth')) {
      onUnauthorized?.()
    }
    // C12's error middleware returns `{error: string}`; surface that message
    // when present, falling back to a generic one for non-JSON failures.
    let message = `API ${method} ${path} failed: ${res.status}`
    try {
      const body: unknown = await res.json()
      if (body && typeof body === 'object' && 'error' in body && typeof body.error === 'string') {
        message = body.error
      }
    } catch {
      // response body wasn't JSON — keep the generic message
    }
    throw new ApiError(res.status, message)
  }

  if (res.status === 204) return undefined as T
  const text = await res.text()
  return (text ? JSON.parse(text) : undefined) as T
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  delete: (path: string) => request<void>('DELETE', path),
}

export { ApiError }
