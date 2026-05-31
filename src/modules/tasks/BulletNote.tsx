import { useState, useCallback } from 'react'
import { Textarea } from '@/components/ui/Textarea'
import { cn } from '@/lib/utils'

interface BulletNoteProps {
  taskId: string
  note: string
  depth: number
  onSave: (id: string, note: string) => void
}

export function BulletNote({ taskId, note, depth, onSave }: BulletNoteProps) {
  const [value, setValue] = useState(note)
  const [prevNote, setPrevNote] = useState(note)

  // Sync the editor when the note changes upstream (React-endorsed pattern:
  // adjust state during render rather than in an effect).
  if (note !== prevNote) {
    setPrevNote(note)
    setValue(note)
  }

  const handleBlur = useCallback(() => {
    if (value !== note) {
      onSave(taskId, value)
    }
  }, [taskId, value, note, onSave])

  return (
    <div
      className={cn('mt-0.5 mb-1')}
      style={{ paddingLeft: depth * 24 + 44 }}
    >
      <Textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={handleBlur}
        placeholder="Add a note..."
        className="min-h-[60px] bg-gray-50 text-xs text-gray-600 border-gray-200 focus:bg-white"
        onKeyDown={(e) => {
          // Prevent Enter from bubbling up to create a new task
          e.stopPropagation()
        }}
      />
    </div>
  )
}
