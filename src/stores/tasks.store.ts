import { create } from 'zustand'
import type { Task } from '@/types/tasks.types'

export interface DeletedSnapshot {
  task: Task
  descendants: Task[]
}

interface TasksState {
  tasks: Task[]
  rootId: string | null
  hideCompleted: boolean
  lastDeleted: DeletedSnapshot | null

  setTasks: (tasks: Task[]) => void
  setRootId: (id: string | null) => void
  setHideCompleted: (hide: boolean) => void
  updateTask: (id: string, updates: Partial<Task>) => void
  removeTask: (id: string) => void
  addTask: (task: Task) => void
  setLastDeleted: (snapshot: DeletedSnapshot | null) => void
}

export const useTasksStore = create<TasksState>((set) => ({
  tasks: [],
  rootId: null,
  hideCompleted: false,
  lastDeleted: null,

  setTasks: (tasks) => set({ tasks }),
  setRootId: (id) => set({ rootId: id }),
  setHideCompleted: (hide) => set({ hideCompleted: hide }),
  setLastDeleted: (snapshot) => set({ lastDeleted: snapshot }),

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
