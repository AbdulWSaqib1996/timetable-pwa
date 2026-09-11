/**
 * PG-02 / PG-03 practice model (G1b): lesson plan revisions, next attempts,
 * one-active practice focus, and Today's "next steps". Runtime-neutral.
 * Nothing here sets attendance, standards met or any assessment: a stage is a
 * label on a record, a next step is a suggestion derived from dated work, and
 * a cycle is paused or closed only by the learner — never marked as failed.
 */

export const PLAN_FIELDS = ['sessionRef', 'unitRef', 'intention', 'priorKnowledge', 'misconceptions', 'sequence', 'checks', 'plannedResponses', 'resources']
export const LESSON_STAGES = ['plan', 'rehearse', 'teach', 'review']
export const CYCLE_STATES = ['active', 'paused', 'archived']
export const REVIEW_DECISIONS = ['continue', 'adapt', 'close']
export const PREP_STATES = ['draft', 'held']

export const LESSON_TEMPLATES = [
  {
    id: 'five-part',
    label: 'Five-part lesson',
    sequence: '1. Retrieval starter (5 min)\n2. Explain and model (10 min)\n3. Guided practice (15 min)\n4. Independent practice (15 min)\n5. Review and exit check (5 min)',
    checks: 'Mini-whiteboards after modelling · cold-call during guided practice · exit ticket',
  },
  {
    id: 'enquiry',
    label: 'Enquiry lesson',
    sequence: '1. Hook and big question (5 min)\n2. Activate prior knowledge (5 min)\n3. Investigate in groups (20 min)\n4. Share findings (10 min)\n5. Conclude and connect (10 min)',
    checks: 'Listen in on group talk · targeted questions at the share · one-sentence conclusion from each learner',
  },
]

const canon = (value) => JSON.stringify(value === undefined || value === null ? '' : value)

/** True when any plan field differs (the review side — evaluation/standards — is separate). */
export function planChanged(prev, next) {
  return PLAN_FIELDS.some((f) => canon(prev?.[f]) !== canon(next?.[f]))
}

/**
 * Stamp a plan revision when plan fields changed. Planning and evaluation are
 * distinct versions of one record: the review always names the revision that
 * was taught (`taughtPlanRevision`), so a later plan edit is visible as such.
 */
export function withPlanRevision(prev, next, now) {
  if (!planChanged(prev, next)) return next
  return { ...next, planRevision: (prev?.planRevision ?? 0) + 1, planAt: now }
}

/**
 * Duplicate a lesson for its next attempt: a NEW identity carrying the plan,
 * class, subject, placement and focus — never the outcomes (evaluation,
 * standards, taught/rehearsed/review stamps, feedback links).
 */
export function nextAttempt(lesson, newId, dateISO, now) {
  const out = { id: newId, dateISO, classGroup: lesson.classGroup ?? '', subject: lesson.subject ?? '', evaluation: '', standards: [], stage: 'plan', planRevision: 1, planAt: now, attempt: (lesson.attempt ?? 1) + 1, duplicatedFrom: lesson.id, at: now }
  for (const f of PLAN_FIELDS) if (lesson[f] !== undefined) out[f] = Array.isArray(lesson[f]) ? [...lesson[f]] : lesson[f]
  if (lesson.placementId) out.placementId = lesson.placementId
  if (lesson.cycleId) out.cycleId = lesson.cycleId
  return out
}

/** Make one cycle active; any other active cycle is paused (one focus at a time — a pause, not a failure). */
export function activateCycle(cycles, id, now) {
  return cycles.map((c) => {
    if (c.id === id) return c.state === 'active' ? c : { ...c, state: 'active', pausedReason: undefined, at: now }
    if (c.state === 'active') return { ...c, state: 'paused', pausedReason: 'one-focus', at: now }
    return c
  })
}

const addDays = (iso, n) => {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + n))
  return dt.toISOString().slice(0, 10)
}

/**
 * Today's next steps: at most three, derived ONLY from dated work and the
 * active focus. Nothing undated can be overdue; nothing past is labelled late
 * — a taught lesson without an evaluation is simply "Review", whatever its
 * date. Pinned steps come first; dismissed ones are hidden for that day.
 */
export function nextSteps(admin, todayISO, prefs = {}) {
  const dismissed = new Set((prefs.dismissed ?? []).filter((d) => d.dateISO === todayISO).map((d) => d.id))
  const pinned = new Set(prefs.pinned ?? [])
  const horizon = addDays(todayISO, 7)
  const prepHorizon = addDays(todayISO, 14)
  const steps = []
  const lessons = admin.lessons ?? []
  for (const l of lessons) {
    if (!l.dateISO) continue
    if (l.taughtAt && !l.evaluation) steps.push({ id: `review:${l.id}`, kind: 'review', lessonId: l.id, label: `Review ${l.subject || 'lesson'}`, detail: `taught ${l.dateISO}`, dateISO: l.dateISO })
    else if (l.dateISO >= todayISO && l.dateISO <= horizon) {
      if (!l.intention && !l.sequence) steps.push({ id: `plan:${l.id}`, kind: 'plan', lessonId: l.id, label: `Plan ${l.subject || 'lesson'}`, detail: `for ${l.dateISO}`, dateISO: l.dateISO })
      else if (!l.rehearsedAt && !l.taughtAt) steps.push({ id: `rehearse:${l.id}`, kind: 'rehearse', lessonId: l.id, label: `Rehearse ${l.subject || 'lesson'}`, detail: `for ${l.dateISO}`, dateISO: l.dateISO })
    }
  }
  const active = (admin.cycles ?? []).find((c) => c.state === 'active')
  if (active && !lessons.some((l) => l.cycleId === active.id && !l.taughtAt)) {
    steps.push({ id: `focus:${active.id}`, kind: 'focus', cycleId: active.id, label: `Plan an attempt for your focus`, detail: active.focus, dateISO: null })
  }
  for (const p of admin.preps ?? []) {
    if (p.state === 'draft' && p.dateISO >= todayISO && p.dateISO <= prepHorizon) steps.push({ id: `prep:${p.id}`, kind: 'prep', prepId: p.id, label: 'Prepare for your mentor meeting', detail: `on ${p.dateISO}`, dateISO: p.dateISO })
    if (p.state === 'held' && p.outcome?.nextReviewISO && p.outcome.nextReviewISO >= todayISO && p.outcome.nextReviewISO <= prepHorizon) steps.push({ id: `nextreview:${p.id}`, kind: 'prep', prepId: p.id, label: 'Next review agreed with your mentor', detail: `on ${p.outcome.nextReviewISO}`, dateISO: p.outcome.nextReviewISO })
  }
  const visible = steps.filter((s) => !dismissed.has(s.id)).map((s) => ({ ...s, pinned: pinned.has(s.id) }))
  visible.sort((a, b) => (a.pinned === b.pinned ? (a.dateISO ?? '9999').localeCompare(b.dateISO ?? '9999') : a.pinned ? -1 : 1))
  return visible.slice(0, 3)
}

/** The provenance label shown beside feedback text. Learner-entered can never read as reviewer authorship. */
export function provenanceLabel(sourceType) {
  return sourceType === 'reviewer-authenticated' ? 'Reviewer-authenticated' : sourceType === 'personal-reflection' ? 'Your reflection' : 'Entered by you'
}
