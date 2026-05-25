import { useRef, useLayoutEffect, useCallback, type KeyboardEvent } from 'react'
import { cn } from '@/lib/utils'

interface BulletEditorProps {
  taskId: string
  content: string
  isCompleted: boolean
  onUpdate: (id: string, content: string) => void
  onEnter: (id: string) => void
  onBackspaceEmpty: (id: string) => void
  onIndent: (id: string) => void
  onOutdent: (id: string) => void
  onToggleComplete: (id: string) => void
  onToggleCollapse: (id: string) => void
  autoFocus?: boolean
}

/**
 * Save the caret offset relative to the element's text content.
 * Returns -1 if there is no selection in this element.
 */
function getCaretOffset(el: HTMLElement): number {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return -1

  const range = sel.getRangeAt(0)
  // Only measure if the selection is inside our element
  if (!el.contains(range.startContainer)) return -1

  const preRange = document.createRange()
  preRange.selectNodeContents(el)
  preRange.setEnd(range.startContainer, range.startOffset)
  return preRange.toString().length
}

/**
 * Restore the caret to a specific text offset inside the element.
 */
function setCaretOffset(el: HTMLElement, offset: number) {
  const sel = window.getSelection()
  if (!sel) return

  const range = document.createRange()

  // Walk text nodes to find the right position
  let remaining = offset
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  let node = walker.nextNode()

  while (node) {
    const len = node.textContent?.length ?? 0
    if (remaining <= len) {
      range.setStart(node, remaining)
      range.collapse(true)
      sel.removeAllRanges()
      sel.addRange(range)
      return
    }
    remaining -= len
    node = walker.nextNode()
  }

  // If offset exceeds content, place caret at end
  range.selectNodeContents(el)
  range.collapse(false)
  sel.removeAllRanges()
  sel.addRange(range)
}

export function BulletEditor({
  taskId,
  content,
  isCompleted,
  onUpdate,
  onEnter,
  onBackspaceEmpty,
  onIndent,
  onOutdent,
  onToggleComplete,
  onToggleCollapse,
  autoFocus,
}: BulletEditorProps) {
  const ref = useRef<HTMLDivElement>(null)
  const caretRef = useRef<number>(-1)

  // Save and restore caret position across re-renders.
  // This is CRITICAL for contenteditable — without it, the cursor jumps on every keystroke.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return

    // Only sync textContent if it actually differs from React state
    // (e.g. after an external store update).
    if (el.textContent !== content) {
      el.textContent = content
    }

    // Restore caret if we have a saved position
    if (caretRef.current >= 0 && document.activeElement === el) {
      setCaretOffset(el, caretRef.current)
    }
  }, [content])

  // Auto-focus on mount when requested
  useLayoutEffect(() => {
    if (autoFocus && ref.current) {
      ref.current.focus()
      // Place caret at end
      const range = document.createRange()
      range.selectNodeContents(ref.current)
      range.collapse(false)
      const sel = window.getSelection()
      if (sel) {
        sel.removeAllRanges()
        sel.addRange(range)
      }
    }
  }, [autoFocus])

  const handleInput = useCallback(() => {
    const el = ref.current
    if (!el) return

    // Save caret position before the state update triggers a re-render
    caretRef.current = getCaretOffset(el)

    const newContent = el.textContent ?? ''
    onUpdate(taskId, newContent)
  }, [taskId, onUpdate])

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      const el = ref.current
      if (!el) return

      const isMod = e.metaKey || e.ctrlKey

      // Ctrl/Cmd + Enter → toggle complete
      if (isMod && e.key === 'Enter') {
        e.preventDefault()
        onToggleComplete(taskId)
        return
      }

      // Ctrl/Cmd + . → toggle collapse
      if (isMod && e.key === '.') {
        e.preventDefault()
        onToggleCollapse(taskId)
        return
      }

      // Enter → create new sibling below
      if (e.key === 'Enter' && !e.shiftKey && !isMod) {
        e.preventDefault()
        onEnter(taskId)
        return
      }

      // Tab → indent
      if (e.key === 'Tab' && !e.shiftKey) {
        e.preventDefault()
        onIndent(taskId)
        return
      }

      // Shift+Tab → outdent
      if (e.key === 'Tab' && e.shiftKey) {
        e.preventDefault()
        onOutdent(taskId)
        return
      }

      // Backspace on empty → delete
      if (e.key === 'Backspace') {
        const text = el.textContent ?? ''
        if (text.length === 0) {
          e.preventDefault()
          onBackspaceEmpty(taskId)
          return
        }
      }
    },
    [taskId, onEnter, onBackspaceEmpty, onIndent, onOutdent, onToggleComplete, onToggleCollapse],
  )

  // Prevent pasting rich text — paste as plain text only
  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLDivElement>) => {
      e.preventDefault()
      const text = e.clipboardData.getData('text/plain')
      document.execCommand('insertText', false, text)
    },
    [],
  )

  return (
    <div
      ref={ref}
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      aria-label="Task content"
      className={cn(
        'flex-1 outline-none text-sm text-gray-900 leading-6 min-w-0 break-words',
        'focus:bg-white focus:rounded px-1 -mx-1',
        isCompleted && 'line-through text-gray-400',
      )}
      onInput={handleInput}
      onKeyDown={handleKeyDown}
      onPaste={handlePaste}
    />
  )
}
