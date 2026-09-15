/**
 * Homework (owner request, 15 September 2026). A lesson can set homework, and
 * the learner schedules it against a LATER OCCURRENCE of the same timetable
 * session — "Maths 1 gave me homework; it is due in Maths 2". Nothing here
 * infers anything: the learner picks the occurrence (or a plain date) and the
 * due date is that occurrence's own date. Pure and runtime-neutral.
 *
 * @typedef {{ id: string, title: string, dateISO: string, start: string, isKeyDate?: boolean, isFreeTime?: boolean }} SessionLike
 */

export const HOMEWORK_TITLE_MAX = 200
export const HOMEWORK_DETAILS_MAX = 4000
export const HOMEWORK_STATES = ['todo', 'doing', 'done']

const norm = (t) => String(t ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
const at = (s) => `${s.dateISO}|${s.start || '99:99'}`

/**
 * The family a session title belongs to: "Maths 1" and "Maths 2" share
 * "maths", so a later occurrence of the same lesson can be offered. A title
 * with no trailing number is its own family.
 */
export function titleFamily(title) {
  const n = norm(title)
  // Only a trailing occurrence number that stands on its own ("Maths 2", "English 2a")
  // — never digits glued to a code, so "School Experience SE1a" keeps itself.
  const stripped = n.replace(/[\s·–—-]+\d{1,3}[a-z]?$/, '').trim()
  return stripped || n
}

/** A session that can host homework: a real teaching occurrence, not a deadline pin or free time. */
export const teachableOccurrence = (s) => !!s && !s.isKeyDate && !s.isFreeTime

/**
 * Later occurrences of one family, in date/time order. `after` is the source
 * occurrence — an occurrence on the same day must start later than it.
 * @param {SessionLike[]} sessions
 * @param {string} family
 * @param {{ dateISO: string, start?: string }} after
 */
export function laterOccurrences(sessions, family, after, limit = 40) {
  const fromKey = `${after.dateISO}|${after.start || '00:00'}`
  return sessions
    .filter((s) => teachableOccurrence(s) && titleFamily(s.title) === family && at(s) > fromKey)
    .sort((a, b) => at(a).localeCompare(at(b)))
    .slice(0, limit)
}

/**
 * Every upcoming teaching occurrence after the source, the source's own family
 * first (each row flagged), so a picker can group "later Maths sessions" ahead
 * of everything else without hiding the rest.
 */
export function upcomingOccurrences(sessions, family, after, limit = 60) {
  const fromKey = `${after.dateISO}|${after.start || '00:00'}`
  return sessions
    .filter((s) => teachableOccurrence(s) && at(s) > fromKey)
    .sort((a, b) => at(a).localeCompare(at(b)))
    .map((s) => ({ session: s, sameFamily: titleFamily(s.title) === family }))
    .slice(0, limit)
}

/** Homework due in one occurrence (by session key). */
export function homeworkForSession(homework, sessionRef) {
  if (!sessionRef) return []
  return sortHomework((homework ?? []).filter((h) => h.dueSessionRef === sessionRef))
}

/** Homework a lesson set. */
export function homeworkOfLesson(homework, lessonId) {
  if (!lessonId) return []
  return sortHomework((homework ?? []).filter((h) => h.lessonId === lessonId))
}

/** Outstanding first by due date, then completed with the most recent first. */
export function sortHomework(list) {
  const done = (h) => h.status === 'done'
  return [...list].sort((a, b) => {
    if (done(a) !== done(b)) return done(a) ? 1 : -1
    return done(a) ? (b.completedISO ?? b.dueISO).localeCompare(a.completedISO ?? a.dueISO) : a.dueISO.localeCompare(b.dueISO)
  })
}

/**
 * Build one homework record. `target` is the chosen later occurrence (with its
 * session key) or null when the learner picks a plain date instead — in which
 * case `dueISO` must be given.
 */
export function makeHomework({ id, title, details, lesson, sourceRef, target, dueISO, todayISO, now }) {
  const clean = String(title ?? '').trim().slice(0, HOMEWORK_TITLE_MAX)
  if (!clean) throw new Error('Homework needs a title.')
  const due = target ? target.session.dateISO : dueISO
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(due ?? ''))) throw new Error('Homework needs a due date or a session to be due in.')
  return {
    id,
    title: clean,
    ...(details && details.trim() ? { details: details.trim().slice(0, HOMEWORK_DETAILS_MAX) } : {}),
    ...(lesson?.id ? { lessonId: lesson.id } : {}),
    ...(sourceRef ? { setSessionRef: sourceRef } : {}),
    setISO: todayISO,
    ...(target ? { dueSessionRef: target.key, dueTitle: target.session.title } : {}),
    dueISO: due,
    status: 'todo',
    at: now,
  }
}
