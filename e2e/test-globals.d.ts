// Types for the DEV/E2E-only hooks the app attaches to `window` (see
// TasksPage.tsx and CsvImport.tsx). Lets specs call them without `any` casts.
export {}

declare global {
  interface TestTask {
    id: string
    parentId: string | null
    content: string
    note: string
    isCompleted: boolean
    isCollapsed: boolean
    sortOrder: number
  }

  interface Window {
    __testIndentTask: (id: string) => void
    __testOutdentTask: (id: string) => void
    __testToggleCollapse: (id: string) => void
    __testGetTasks: () => TestTask[]
    __testUpdateTask: (id: string, updates: Partial<Omit<TestTask, 'id'>>) => void
    __testCsvFileSelect: (file: File) => void
  }
}
