import { create } from 'zustand'
import { generateId } from '@/lib/utils'

export interface ToastItem {
  id: string
  message: string
  action?: { label: string; onClick: () => void }
  duration: number
}

interface ToastState {
  toasts: ToastItem[]
  addToast: (toast: Omit<ToastItem, 'id' | 'duration'> & { duration?: number }) => string
  removeToast: (id: string) => void
}

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],

  addToast: (toast) => {
    const id = generateId()
    const duration = toast.duration ?? 4000
    set((s) => ({ toasts: [...s.toasts, { ...toast, id, duration }] }))
    if (duration > 0) {
      setTimeout(() => get().removeToast(id), duration)
    }
    return id
  },

  removeToast: (id) =>
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}))
