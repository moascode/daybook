import { useRef, useLayoutEffect, useCallback, useEffect, type KeyboardEvent } from 'react'
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

  // Offset exceeds content — place caret at end
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
  // Track current content locally — avoids triggering re-renders on every keystroke.
  // The store is only updated via debounce (on typing pause) or flush (on blur / action keys).
  const localContent = useRef(content)
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Saved caret position for restoring after external content sync
  const caretRef = useRef<number>(-1)

  // ── Sync from store to DOM ───────────────────────────────────────────────
  // Only overwrite the DOM when the editor is NOT focused (i.e. an external
  // update arrived — e.g. another component updated the task).
  // While the user is actively typing we NEVER touch textContent, which is
  // the root cause of the cursor-jump / blinking bug.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return

    if (document.activeElement !== el) {
      if (el.textContent !== content) {
        // Preserve caret if somehow we are about to clobber while focused
        const savedCaret = caretRef.current
        el.textContent = content
        if (savedCaret >= 0 && document.activeElement === el) {
          setCaretOffset(el, savedCaret)
        }
      }
      localContent.current = content
    }
    // If focused → user is actively editing. Don't touch the DOM at all.
  }, [content])

  // ── Auto-focus on mount ──────────────────────────────────────────────────
  useLayoutEffect(() => {
    if (autoFocus && ref.current) {
      ref.current.focus()
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

  // ── Cleanup debounce on unmount ──────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current)
    }
  }, [])

  // ── Flush pending update to the store immediately ────────────────────────
  const flushUpdate = useCallback(() => {
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current)
      debounceTimer.current = null
    }
    onUpdate(taskId, localContent.current)
  }, [taskId, onUpdate])

  // ── Input handler — debounce DB writes ──────────────────────────────────
  const handleInput = useCallback(() => {
    const el = ref.current
    if (!el) return

    caretRef.current = getCaretOffset(el)
    localContent.current = el.textContent ?? ''

    // Debounce: write to DB only after 400 ms of inactivity.
    // This eliminates the re-render cascade that caused blinking.
    if (debounceTimer.current) clearTimeout(debounceTimer.current)
    debounceTimer.current = setTimeout(() => {
      onUpdate(taskId, localContent.current)
    }, 400)
  }, [taskId, onUpdate])

  // ── Blur handler — flush immediately when the user leaves the field ──────
  const handleBlur = useCallback(() => {
    flushUpdate()
  }, [flushUpdate])

  // ── Keyboard handler ─────────────────────────────────────────────────────
  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      const el = ref.current
      if (!el) return

      const isMod = e.metaKey || e.ctrlKey

      // Cmd/Ctrl + Enter → toggle complete
      if (isMod && e.key === 'Enter') {
        e.preventDefault()
        flushUpdate()
        onToggleComplete(taskId)
        return
      }

      // Cmd/Ctrl + . → toggle collapse
      if (isMod && e.key === '.') {
        e.preventDefault()
        flushUpdate()
        onToggleCollapse(taskId)
        return
      }

      // Enter → create new sibling below
      if (e.key === 'Enter' && !e.shiftKey && !isMod) {
        e.preventDefault()
        flushUpdate() // save before creating sibling
        onEnter(taskId)
        return
      }

      // Tab → indent
      if (e.key === 'Tab' && !e.shiftKey) {
        e.preventDefault()
        flushUpdate()
        onIndent(taskId)
        return
      }

      // Shift+Tab → outdent
      if (e.key === 'Tab' && e.shiftKey) {
        e.preventDefault()
        flushUpdate()
        onOutdent(taskId)
        return
      }

      // Backspace on empty → delete task
      if (e.key === 'Backspace') {
        const text = el.textContent ?? ''
        if (text.length === 0) {
          e.preventDefault()
          flushUpdate()
          onBackspaceEmpty(taskId)
          return
        }
      }
    },
    [taskId, onEnter, onBackspaceEmpty, onIndent, onOutdent, onToggleComplete, onToggleCollapse, flushUpdate],
  )

  // Prevent rich-text paste — plain text only
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
        'flex-1 outline-none text-sm text-gray-900 leading-6 min-w-0 break-words cursor-text',
        'px-1 -mx-1 rounded',
        'focus:bg-blue-50/40',
        isCompleted && 'line-through text-gray-400',
      )}
      onInput={handleInput}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
      onPaste={handlePaste}
    />
  )
}
