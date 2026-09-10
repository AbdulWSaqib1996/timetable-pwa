import { useSyncExternalStore } from 'react'

/**
 * Attention items for Settings (V-04): the routine backup nudge no longer sits
 * above every page heading; it becomes a dot on the Settings action, a line
 * on the Settings index and the real prompt inside Data & devices. Items are
 * set by the app from real state and cleared only when that state changes or
 * the person explicitly snoozes — never by merely opening a screen. Pending
 * SAVE failures are not attention items: they stay global alerts.
 */

export interface AttentionItem {
  key: string
  message: string
  /** settings section that resolves it */
  section: 'data'
}

let items: AttentionItem[] = []
const listeners = new Set<() => void>()

function emit() {
  for (const l of listeners) l()
}

export function setAttention(item: AttentionItem): void {
  const next = [...items.filter((i) => i.key !== item.key), item]
  if (JSON.stringify(next) === JSON.stringify(items)) return
  items = next
  emit()
}

export function clearAttention(key: string): void {
  if (!items.some((i) => i.key === key)) return
  items = items.filter((i) => i.key !== key)
  emit()
}

export function useAttention(): AttentionItem[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => items,
    () => items
  )
}
