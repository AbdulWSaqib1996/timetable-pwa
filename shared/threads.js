/**
 * E01 (audit D1, Pass 83): a learning thread — ONE visible line from a lesson
 * plan to the taught lesson, the feedback the learner attached, the
 * improvement they chose and the next attempt. Runtime-neutral.
 *
 * The thread stores REFERENCES (lesson ids, observation ids, a cycle id),
 * never copies: one observation can inform many threads without being cloned,
 * and deleting a source leaves a "source no longer present" step rather than a
 * silent gap. Nothing here turns feedback into a target or a judgement — the
 * next action is the learner's own words, and the states below describe what
 * is MISSING and why, never how well anything went.
 */

export const THREAD_STATES = ['open', 'closed']
export const THREAD_STAGES = ['plan', 'teach', 'feedback', 'next']
export const THREAD_STAGE_LABEL = { plan: 'Plan', teach: 'Teach', feedback: 'Feedback', next: 'Try next' }
export const THREAD_NEXT_ACTION_MAX = 2000
export const THREAD_TITLE_MAX = 200
export const THREAD_REFS_MAX = 50

const byId = (list, id) => (list ?? []).find((x) => x.id === id)

/** Build a thread that starts from one lesson. The lesson keeps its own placement. */
export function makeThread(lesson, id, now, cycleId) {
  return {
    id,
    title: `${lesson.subject || 'Lesson'}${lesson.classGroup ? ` · ${lesson.classGroup}` : ''}`,
    placementId: lesson.placementId,
    lessonIds: [lesson.id],
    observationIds: [],
    cycleId: cycleId ?? lesson.cycleId,
    state: 'open',
    revision: 1,
    at: now,
  }
}

/** The thread a lesson belongs to (a lesson is in at most one thread's lessonIds). */
export function threadOfLesson(threads, lessonId) {
  return (threads ?? []).find((t) => (t.lessonIds ?? []).includes(lessonId)) ?? null
}

/** The lesson the thread started from and the latest attempt (may be the same). */
export function threadLessons(thread, lessons) {
  const ids = thread.lessonIds ?? []
  const first = byId(lessons, ids[0])
  const latest = ids.length > 1 ? byId(lessons, ids[ids.length - 1]) : first
  return { first: first ?? null, latest: latest ?? null, missingIds: ids.filter((id) => !byId(lessons, id)) }
}

/**
 * Plan → Teach → Feedback → Try next as four steps, each 'done', 'missing' or
 * 'gone' (the source record no longer exists) with a short reason the timeline
 * shows. Derived on every read from the canonical records; nothing is cached.
 */
export function threadSteps(thread, admin) {
  const lessons = admin?.lessons ?? []
  const observations = admin?.observations ?? []
  const { first, missingIds } = threadLessons(thread, lessons)
  const steps = []

  if (!first) steps.push({ stage: 'plan', state: 'gone', reason: 'The lesson this thread started from is no longer present.' })
  else if (!first.planRevision) steps.push({ stage: 'plan', state: 'missing', reason: 'No plan saved yet — write the plan in the lesson workbench.', lessonId: first.id })
  else steps.push({ stage: 'plan', state: 'done', reason: `Plan revision ${first.planRevision}`, at: first.planAt, lessonId: first.id })

  if (!first) steps.push({ stage: 'teach', state: 'gone', reason: 'No lesson to teach.' })
  else if (!first.taughtAt) steps.push({ stage: 'teach', state: 'missing', reason: 'Not taught yet — open Teach when you deliver it.', lessonId: first.id })
  else steps.push({ stage: 'teach', state: 'done', reason: `Taught${first.taughtPlanRevision ? ` from plan revision ${first.taughtPlanRevision}` : ''}`, at: first.taughtAt, lessonId: first.id })

  const obsIds = thread.observationIds ?? []
  const present = obsIds.filter((id) => byId(observations, id))
  const goneObs = obsIds.length - present.length
  if (obsIds.length === 0) steps.push({ stage: 'feedback', state: 'missing', reason: 'No feedback attached — choose which observation informs this thread.' })
  else if (present.length === 0) steps.push({ stage: 'feedback', state: 'gone', reason: 'The attached feedback is no longer present.' })
  else steps.push({ stage: 'feedback', state: 'done', reason: `${present.length} observation${present.length === 1 ? '' : 's'} attached${goneObs ? ` · ${goneObs} no longer present` : ''}`, at: Math.max(...present.map((id) => byId(observations, id).at ?? 0)), observationIds: present })

  const nextLesson = thread.nextLessonId ? byId(lessons, thread.nextLessonId) : null
  const action = (thread.nextAction ?? '').trim()
  if (thread.nextLessonId && !nextLesson) steps.push({ stage: 'next', state: 'gone', reason: 'The next attempt is no longer present.' })
  else if (!action && !nextLesson) steps.push({ stage: 'next', state: 'missing', reason: 'Choose what to try next, in your own words.' })
  else if (action && !nextLesson) steps.push({ stage: 'next', state: 'missing', reason: 'Next action chosen — the next practice lesson has not been created yet.' })
  else steps.push({ stage: 'next', state: 'done', reason: action ? `Next attempt planned: ${action}` : 'Next attempt created', at: nextLesson.at, lessonId: nextLesson.id })

  return { steps, missingLessonIds: missingIds, complete: steps.every((s) => s.state === 'done') }
}

/** Attach or detach an observation by reference. Idempotent; never copies the record. */
export function withObservation(thread, observationId, attached, now) {
  const ids = thread.observationIds ?? []
  const has = ids.includes(observationId)
  if (attached === has) return thread
  return { ...thread, observationIds: attached ? [...ids, observationId] : ids.filter((id) => id !== observationId), revision: (thread.revision ?? 0) + 1, at: now }
}

/** Record the chosen improvement — the learner's words, never derived from feedback. */
export function withNextAction(thread, text, now) {
  const next = (text ?? '').slice(0, THREAD_NEXT_ACTION_MAX)
  if (next === (thread.nextAction ?? '')) return thread
  return { ...thread, nextAction: next, revision: (thread.revision ?? 0) + 1, at: now }
}

/**
 * Link the next attempt (a lesson created by `nextAttempt` in practice.js).
 * A cross-placement next attempt keeps the ORIGINAL lesson's placement
 * untouched: only the new lesson carries the new placement id.
 */
export function withNextLesson(thread, lessonId, now) {
  const ids = thread.lessonIds ?? []
  return { ...thread, nextLessonId: lessonId, lessonIds: ids.includes(lessonId) ? ids : [...ids, lessonId], revision: (thread.revision ?? 0) + 1, at: now }
}

/** Threads a given observation informs — proof that one record serves many threads without cloning. */
export function threadsInformedBy(threads, observationId) {
  return (threads ?? []).filter((t) => (t.observationIds ?? []).includes(observationId))
}
