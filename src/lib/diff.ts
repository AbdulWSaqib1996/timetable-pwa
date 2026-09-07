import { eventKey } from '../../shared/identity.js'
import { describeRoomChange } from './location'
import type { Session, SessionChange } from '../types'

/** Stable identity for a session across refreshes (row indexes shift when rows are added). */
export function sessionKey(s: Session): string {
  return eventKey(s)
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
    if (oldS.dateISO !== newS.dateISO || oldS.start !== newS.start) details.push(`Rescheduled: ${oldS.dateISO} ${oldS.start} → ${newS.dateISO} ${newS.start}`)
    if (oldS.title !== newS.title) details.push(`Title: ${oldS.title} → ${newS.title}`)
    if (oldS.room !== newS.room) details.push(describeRoomChange(oldS.room, newS.room))
    if (oldS.tutor !== newS.tutor) details.push(`Tutor changed: ${oldS.tutor || '—'} → ${newS.tutor || '—'}`)
    if (oldS.end !== newS.end) details.push(`End time changed: ${oldS.end || '—'} → ${newS.end || '—'}`)
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
