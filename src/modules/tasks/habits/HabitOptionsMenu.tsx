import { useEffect, useRef, useState } from 'react'
import { Archive, Edit2, MoreVertical, Trash2 } from 'lucide-react'

/** "Habit options" (⋮) popover — Edit / Archive / Delete. Same outside-click +
 * Escape pattern as `src/components/layout/AccountMenu.tsx`'s own menu, but
 * with its OWN small `.row-menu` styling (review fix #10; renamed from
 * `.habit-menu` by FEAT-062 review fix #9 once `TaskListRow.tsx`'s
 * `RowMoreMenu` started reusing this exact same CSS for tasks, not just
 * habits) rather than reusing that menu's `.menu-panel` — a 328px panel
 * fixed to the account button's own corner of the app bar, which clipped and
 * mispositioned once reused for a small per-card popover anywhere narrower
 * than 1280px. Also carries real popup-menu semantics: `role="menu"`/
 * `"menuitem"`, focus moves into the first item on open and back to the
 * trigger on close.
 *
 * `onDelete` opens the caller's confirmation (`ConfirmDeleteModal`) — it
 * never deletes directly; CLAUDE.md §6's delete-confirmation policy treats a
 * habit delete (loses the habit's whole history, not undo-toast-able the way
 * a single task is) as the high-consequence case. */
export function HabitOptionsMenu({
  onEdit,
  onArchive,
  onDelete,
}: {
  onEdit: () => void
  onArchive: () => void
  onDelete: () => void
}) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const firstItemRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    firstItemRef.current?.focus()
    function handlePointerDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  // Closing by any route (item click, outside click, Escape) returns focus
  // to the trigger — only the item-click path can do so itself (the other
  // two close via state updates with no "this closed" callback), so this
  // effect catches every case including those.
  const wasOpen = useRef(false)
  useEffect(() => {
    if (wasOpen.current && !open) triggerRef.current?.focus()
    wasOpen.current = open
  }, [open])

  return (
    <div className="pop-anchor" ref={containerRef}>
      <button
        type="button"
        ref={triggerRef}
        className="icon-btn"
        aria-label="Habit options"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <MoreVertical className="h-4 w-4" />
      </button>
      {open && (
        <div className="row-menu open" role="menu" aria-label="Habit options" data-testid="habit-options-menu">
          <button
            type="button"
            role="menuitem"
            ref={firstItemRef}
            className="row-menu-item"
            onClick={() => {
              setOpen(false)
              onEdit()
            }}
          >
            <Edit2 className="icon h-4 w-4" />
            Edit
          </button>
          <button
            type="button"
            role="menuitem"
            className="row-menu-item"
            onClick={() => {
              setOpen(false)
              onArchive()
            }}
          >
            <Archive className="icon h-4 w-4" />
            Archive
          </button>
          <button
            type="button"
            role="menuitem"
            className="row-menu-item"
            onClick={() => {
              setOpen(false)
              onDelete()
            }}
          >
            <Trash2 className="icon h-4 w-4" />
            Delete
          </button>
        </div>
      )}
    </div>
  )
}
