import { useRef } from 'react'
import type { MouseEvent, PointerEvent } from 'react'

/** Further than this between press and release, and it was a drag. */
const DRAG_SLOP_PX = 6

/**
 * A click handler that ignores the click a browser fires at the end of a
 * drag. dnd-kit never suppresses that click, so letting go of a card that
 * was dragged and dropped back over itself (or a waiting row nudged and
 * released) used to open the task's detail modal — which then sat on top of
 * the board and swallowed the next drag.
 *
 * Uses the capture phase so it never displaces dnd-kit's own onPointerDown
 * listener spread onto the same element.
 */
export function useClickUnlessDragged(onClick: () => void) {
  const down = useRef<{ x: number; y: number } | null>(null)
  return {
    onPointerDownCapture: (e: PointerEvent) => {
      down.current = { x: e.clientX, y: e.clientY }
    },
    onClick: (e: MouseEvent) => {
      const start = down.current
      down.current = null
      if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > DRAG_SLOP_PX) return
      onClick()
    },
  }
}
