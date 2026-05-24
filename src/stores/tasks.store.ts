import { create } from 'zustand'
import type { Task } from '@/types/tasks.types'

interface TasksState {
  tasks: Task[]
  rootId: string | null
  hideCompleted: boolean

  setTasks: (tasks: Task[]) => void
  setRootId: (id: string | null) => void
  setHideCompleted: (hide: boolean) => void
  updateTask: (id: string, updates: Partial<Task>) => void
  removeTask: (id: string) => void
  addTask: (task: Task) => void
}

export const useTasksStore = create<TasksState>((set) => ({
  tasks: [],
  rootId: null,
  hideCompleted: false,

  setTasks: (tasks) => set({ tasks }),
  setRootId: (id) => set({ rootId: id }),
  setHideCompleted: (hide) => set({ hideCompleted: hide }),

  updateTask: (id, updates) =>
    set((s) => ({
      tasks: s.tasks.map((t) => (t.id === id ? { ...t, ...updates } : t)),
    })),

  removeTask: (id) =>
    set((s) => ({
      tasks: s.tasks.filter((t) => t.id !== id),
    })),

  addTask: (task) =>
    set((s) => ({
      tasks: [...s.tasks, task],
    })),
}))
