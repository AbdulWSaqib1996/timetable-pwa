import type { Session, SessionChange } from '../types'

/** Stable identity for a session across refreshes (row indexes shift when rows are added). */
export function sessionKey(s: Session): string {
  return `${s.dateISO}|${s.start}|${s.title.trim().toLowerCase()}`
}

/** Compare old vs new sessions (future only) and describe what changed. */
export function diffSessions(oldSessions: Session[], newSessions: Session[], todayISO: string): SessionChange[] {
  const future = (list: Session[]) => list.filter((s) => s.dateISO >= todayISO)
  const oldMap = new Map(future(oldSessions).map((s) => [sessionKey(s), s]))
  const newMap = new Map(future(newSessions).map((s) => [sessionKey(s), s]))
  const at = Date.now()
  const out: SessionChange[] = []

  newMap.forEach((s, key) => {
    if (!oldMap.has(key)) {
      out.push({ type: 'added', dateISO: s.dateISO, start: s.start, title: s.title, at, seen: false })
    }
  })
  oldMap.forEach((s, key) => {
    if (!newMap.has(key)) {
      out.push({ type: 'removed', dateISO: s.dateISO, start: s.start, title: s.title, at, seen: false })
    }
  })
  oldMap.forEach((oldS, key) => {
    const newS = newMap.get(key)
    if (!newS) return
    const details: string[] = []
    if (oldS.room !== newS.room) details.push(`room ${oldS.room || '—'} → ${newS.room || '—'}`)
    if (oldS.tutor !== newS.tutor) details.push(`tutor ${oldS.tutor || '—'} → ${newS.tutor || '—'}`)
    if (oldS.end !== newS.end) details.push(`ends ${oldS.end || '—'} → ${newS.end || '—'}`)
    if (details.length > 0) {
      out.push({
        type: 'changed',
        dateISO: newS.dateISO,
        start: newS.start,
        title: newS.title,
        detail: details.join('; '),
        at,
        seen: false,
      })
    }
  })

  out.sort((a, b) => (a.dateISO + a.start).localeCompare(b.dateISO + b.start))
  return out
}
