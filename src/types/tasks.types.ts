export interface Task {
  id: string
  parentId: string | null
  content: string
  note: string
  isCompleted: boolean
  isCollapsed: boolean
  sortOrder: number
  dueDate: string | null
  createdAt: string
  updatedAt: string
  children?: Task[]
}
