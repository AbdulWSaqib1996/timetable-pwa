import type { HomeworkRec } from './admin'
import type { MetaMap, Session } from '../types'

/**
 * Homework on the existing pipelines (owner request, 15 September 2026).
 * A homework record is presented as a synthetic key-date session on its due
 * date, so the Tasks screen, the Schedule, search and the key-date reminders
 * all show it with no new machinery — and its completion has exactly ONE
 * owner: the record. Writes never touch session metadata.
 */

export const homeworkEventKey = (h: Pick<HomeworkRec, 'id'>) => `homework:${h.id}`
export const homeworkSessionId = (h: Pick<HomeworkRec, 'id'>) => `hw-${h.id}`
/** The record id behind a projected session, or null for anything else. */
export const homeworkIdOf = (session: Pick<Session, 'id'>): string | null => (session.id.startsWith('hw-') ? session.id.slice('hw-'.length) : null)

export function homeworkToSession(h: HomeworkRec): Session {
  return {
    id: homeworkSessionId(h),
    calendarUid: homeworkSessionId(h),
    eventKey: homeworkEventKey(h),
    title: `Homework: ${h.title}`,
    day: '',
    dateISO: h.dueISO,
    start: '',
    end: '',
    room: '',
    groups: '',
    tutor: '',
    subject: h.title,
    isSpecialism: false,
    isSelfStudy: false,
    isOptional: false,
    isKeyDate: true,
  }
}

/** Homework status/notes merged over session metadata for display consumers only. */
export function overlayHomeworkMeta(metaMap: MetaMap, homework: HomeworkRec[]): MetaMap {
  if (homework.length === 0) return metaMap
  const out = { ...metaMap }
  for (const h of homework) {
    out[homeworkEventKey(h)] = { ...out[homeworkEventKey(h)], status: h.status, note: h.details, at: h.at }
  }
  return out
}
