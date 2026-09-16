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
export function makeHomework({ id, title, details, lesson, sourceRef, source, target, dueISO, todayISO, now }) {
  const problem = validateHomeworkInput({ title, details })
  if (problem) throw new Error(problem)
  const clean = String(title ?? '').trim()
  const due = target ? target.session.dateISO : dueISO
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(due ?? ''))) throw new Error('Homework needs a due date or a session to be due in.')
  return {
    id,
    title: clean,
    ...(details && details.trim() ? { details: details.trim() } : {}),
    ...(lesson?.id ? { lessonId: lesson.id } : {}),
    ...(sourceRef ? { setSessionRef: sourceRef } : {}),
    // HW-04: what the source looked like, so it can still be named if it leaves the timetable.
    ...(source ? { sourceSnapshot: snapshotOf(source, now) } : {}),
    setISO: todayISO,
    // HW-03: the due intent is explicit — a session (followed when it moves, on the learner's say-so) or a fixed date.
    dueMode: target ? 'session' : 'date',
    ...(target ? { dueSessionRef: target.key, dueTitle: target.session.title, dueSnapshot: snapshotOf(target.session, now) } : {}),
    dueISO: due,
    status: 'todo',
    at: now,
  }
}

/** HW-05: a validation message instead of silent truncation. */
export function validateHomeworkInput({ title, details }) {
  const t = String(title ?? '').trim()
  if (!t) return 'Homework needs a title.'
  if (t.length > HOMEWORK_TITLE_MAX) return `The title is ${t.length - HOMEWORK_TITLE_MAX} characters over the ${HOMEWORK_TITLE_MAX}-character limit.`
  const d = String(details ?? '')
  if (d.length > HOMEWORK_DETAILS_MAX) return `The details are ${d.length - HOMEWORK_DETAILS_MAX} characters over the ${HOMEWORK_DETAILS_MAX}-character limit.`
  return null
}

const snapshotOf = (s, now) => ({ dateISO: s.dateISO, ...(s.start ? { start: s.start } : {}), title: s.title, at: now })
const findByKey = (sessions, key, keyOf) => (key ? (sessions ?? []).find((s) => keyOf(s) === key) ?? null : null)

/**
 * HW-03: where and when homework is due NOW. Every consumer reads this —
 * nothing copies a date any more. `keyOf` is the app's session key.
 *  - fixed: a plain date the learner typed; the timetable never moves it
 *  - current: the linked occurrence still matches the last confirmed snapshot
 *  - changed: the linked occurrence moved or was retitled — the last confirmed
 *    deadline stands until the learner follows it or keeps the date
 *  - missing: no occurrence carries the reference any more (cancelled or removed)
 * The effective date is always the last confirmed one; a change is a question, never a guess.
 */
export function resolveDue(hw, sessions, keyOf) {
  const mode = hw.dueMode ?? (hw.dueSessionRef ? 'session' : 'date')
  if (mode === 'date' || !hw.dueSessionRef) return { state: 'fixed', effectiveISO: hw.dueISO, effectiveStart: '', session: null }
  const session = findByKey(sessions, hw.dueSessionRef, keyOf)
  const confirmed = hw.dueSnapshot ?? { dateISO: hw.dueISO, title: hw.dueTitle ?? '' }
  if (!session) return { state: 'missing', effectiveISO: hw.dueISO, effectiveStart: confirmed.start ?? '', session: null, confirmed }
  const moved = session.dateISO !== confirmed.dateISO || (confirmed.start && session.start && session.start !== confirmed.start)
  const retitled = norm(session.title) !== norm(confirmed.title)
  if (moved || retitled) return { state: 'changed', effectiveISO: hw.dueISO, effectiveStart: confirmed.start ?? '', session, confirmed, change: { fromISO: confirmed.dateISO, fromStart: confirmed.start ?? '', fromTitle: confirmed.title, toISO: session.dateISO, toStart: session.start ?? '', toTitle: session.title, moved, retitled } }
  return { state: 'current', effectiveISO: hw.dueISO, effectiveStart: session.start ?? '', session, confirmed }
}

/** HW-04: the occurrence homework was set in, or its saved snapshot when it left the timetable. */
export function resolveSource(hw, sessions, keyOf) {
  const session = findByKey(sessions, hw.setSessionRef, keyOf)
  if (session) return { state: 'current', session, snapshot: hw.sourceSnapshot ?? null }
  if (hw.sourceSnapshot) return { state: 'missing', session: null, snapshot: hw.sourceSnapshot }
  return { state: 'none', session: null, snapshot: null }
}

const withHistory = (hw, entry) => ({ ...hw, dueHistory: [...(hw.dueHistory ?? []), entry].slice(-100) })

/** HW-03: follow the moved occurrence — the deadline becomes its new date; the old one is history. */
export function followSession(hw, session, now) {
  return withHistory({ ...hw, dueMode: 'session', dueISO: session.dateISO, dueTitle: session.title, dueSnapshot: snapshotOf(session, now), at: now }, { at: now, fromISO: hw.dueISO, toISO: session.dateISO, reason: 'follow' })
}

/** HW-03: keep the original date — the homework becomes a fixed date and stops following the session. */
export function keepDate(hw, now) {
  return withHistory({ ...hw, dueMode: 'date', at: now }, { at: now, fromISO: hw.dueISO, toISO: hw.dueISO, reason: 'keep' })
}

/** HW-02: reschedule on the same record — to another occurrence or to a fixed date. Identity and status are untouched. */
export function rescheduleHomework(hw, { target, dueISO }, now) {
  if (target) {
    if (!teachableOccurrence(target.session)) throw new Error('Homework can only be due in a teaching session, not a deadline or free time.')
    return withHistory({ ...hw, dueMode: 'session', dueSessionRef: target.key, dueTitle: target.session.title, dueSnapshot: snapshotOf(target.session, now), dueISO: target.session.dateISO, at: now }, { at: now, fromISO: hw.dueISO, toISO: target.session.dateISO, reason: 'edit' })
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dueISO ?? ''))) throw new Error('Choose a session or a date for the homework to be due.')
  const next = { ...hw, dueMode: 'date', dueISO, at: now }
  delete next.dueSessionRef
  delete next.dueTitle
  delete next.dueSnapshot
  return withHistory(next, { at: now, fromISO: hw.dueISO, toISO: dueISO, reason: 'edit' })
}

/** HW-02: edit the words on the same record. */
export function editHomework(hw, { title, details }, now) {
  const problem = validateHomeworkInput({ title, details })
  if (problem) throw new Error(problem)
  const next = { ...hw, title: String(title).trim(), at: now }
  if (details && details.trim()) next.details = details.trim()
  else delete next.details
  return next
}
