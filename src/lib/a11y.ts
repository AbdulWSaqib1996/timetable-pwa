import { useEffect, useRef } from 'react'

/**
 * Dialog behaviour for the bottom sheets: Escape closes, Tab cycles within the
 * sheet, focus moves into the dialog on open and returns to the opener on close.
 * Attach the returned ref to the .modal-card element (alongside aria-modal).
 */
export function useModalA11y<T extends HTMLElement>(onClose: () => void) {
  const ref = useRef<T | null>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const opener = document.activeElement as HTMLElement | null
    // Focus the dialog itself, not its first control — focusing an input would
    // pop the keyboard on mobile.
    el.setAttribute('tabindex', '-1')
    el.focus({ preventScroll: true })
    const focusables = () =>
      [
        ...el.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        ),
      ].filter((f) => !f.hasAttribute('disabled') && f.offsetParent !== null)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onCloseRef.current()
      } else if (e.key === 'Tab') {
        const items = focusables()
        if (items.length === 0) return
        const first = items[0]
        const last = items[items.length - 1]
        if (e.shiftKey && (document.activeElement === first || document.activeElement === el)) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    el.addEventListener('keydown', onKey)
    return () => {
      el.removeEventListener('keydown', onKey)
      opener?.focus?.({ preventScroll: true })
    }
  }, [])
  return ref
}
