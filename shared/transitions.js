/**
 * E04 (audit D1, Pass 83): moving from one placement to the next without
 * carrying the wrong school, mentor, travel destination or access forward.
 * Runtime-neutral.
 *
 * A transition record holds the learner's checklist state and what they
 * reviewed (the school pin, the shared packs) — never a copy of the placement.
 * Every item below is DERIVED from canonical records on each read: a tick the
 * learner made is kept, but it goes stale when what it was about changes
 * (the school pin moves, a pack is shared or unshared). Nothing here changes
 * mentor access, moves evidence between placements or invents pupil data.
 */

export const TRANSITION_STATES = ['open', 'done']
export const TRANSITION_CONTEXT_MAX = 2000

export const TRANSITION_GROUPS = [
  {
    id: 'school',
    label: 'School & travel',
    items: [
      { id: 'school-confirmed', label: 'School named and its map pin confirmed' },
      { id: 'travel-reviewed', label: 'Outward and return journeys previewed' },
      { id: 'return-set', label: 'Return destination decided' },
    ],
  },
  {
    id: 'context',
    label: 'Teaching context',
    items: [
      { id: 'context-noted', label: 'Teaching context noted — year group, subjects, timetable pattern (never pupil details)' },
      { id: 'hours-set', label: 'Working hours checked' },
      { id: 'resources-ready', label: 'School resources to hand — handbook, entrance instructions, what to bring' },
    ],
  },
  {
    id: 'mentor',
    label: 'Mentor & access',
    items: [
      { id: 'mentor-recorded', label: 'Mentor recorded on this placement' },
      { id: 'shares-reviewed', label: 'Who can still see which review packs — reviewed' },
    ],
  },
  {
    id: 'carry',
    label: 'Carry forward',
    items: [
      { id: 'goals-chosen', label: 'Open goals chosen to carry forward as references' },
      { id: 'first-day', label: 'First school day confirmed' },
    ],
  },
]

export const TRANSITION_ITEM_IDS = TRANSITION_GROUPS.flatMap((g) => g.items.map((i) => i.id))

export function makeTransition(fromPlacementId, toPlacementId, id, now) {
  return { id, ...(fromPlacementId ? { fromPlacementId } : {}), toPlacementId, state: 'open', at: now }
}

const samePin = (a, b) => !!a && !!b && a.lat === b.lat && a.lng === b.lng
const sameSet = (a, b) => a.length === b.length && [...a].sort().every((x, i) => x === [...b].sort()[i])

/** Pack ids currently visible to mentors: shared and not since unshared. */
export function sharedPackIds(reviewPacks) {
  return (reviewPacks ?? []).filter((p) => p.sharing && !p.sharing.unsharedAt).map((p) => p.id)
}

/**
 * The checklist as it stands now. `ctx` carries the canonical records the
 * items are about: the destination placement, its school, the review packs,
 * whether a global home address exists, and the default working hours.
 * States: 'done' | 'todo' | 'stale' (a tick that no longer holds).
 */
export function transitionItems(transition, ctx) {
  const { placement, school, reviewPacks, hasHome, defaultHours } = ctx
  const t = transition ?? {}
  const pin = school && school.lat != null && school.lng != null ? { lat: school.lat, lng: school.lng } : null
  const shared = sharedPackIds(reviewPacks)
  const out = []
  const deferredOf = (id) => (t.deferred ?? {})[id]
  // NF-01 (Pass 89): "not known yet" with a follow-up date is its own state — it never blocks app use.
  const add = (id, state, detail) => {
    const d = deferredOf(id)
    const final = state !== 'done' && d ? 'deferred' : state
    const text = final === 'deferred' ? `Not known yet${d.followUpISO ? ` — follow up ${d.followUpISO}` : ''}${d.note ? ` · ${d.note}` : ''}` : detail
    out.push({ id, state: final, detail: text, group: TRANSITION_GROUPS.find((g) => g.items.some((i) => i.id === id)).id, label: TRANSITION_GROUPS.flatMap((g) => g.items).find((i) => i.id === id).label })
  }

  // School & travel
  if (school?.name && pin && school.confirmedAt) add('school-confirmed', 'done', `${school.name} · pin confirmed`)
  else if (school?.name) add('school-confirmed', 'todo', `${school.name} — the map pin is not confirmed yet`)
  else add('school-confirmed', 'todo', 'No school set up for this placement yet')

  if (!pin) add('travel-reviewed', 'todo', 'Needs a confirmed school pin first')
  else if (t.travelReviewed && samePin(t.travelReviewed, pin)) add('travel-reviewed', 'done', 'Journeys previewed against the current school pin')
  else if (t.travelReviewed) add('travel-reviewed', 'stale', 'The school pin changed since you previewed the journeys — look again')
  else add('travel-reviewed', 'todo', 'Preview To school and Back home before the first day')

  if (placement?.returnPlace) add('return-set', 'done', `${placement.returnPlace.label} — set for this placement`)
  else if (hasHome) add('return-set', 'done', 'Home — your saved home address (the fallback for every placement)')
  else add('return-set', 'todo', 'No home address saved — set one in Settings → Travel times, or choose a place for this placement')

  // Teaching context
  if ((t.contextNote ?? '').trim()) add('context-noted', 'done', 'Noted')
  else add('context-noted', 'todo', 'Write what you know about the classes you will teach')
  const hours = placement?.workingHours ?? defaultHours
  if (hours) add('hours-set', 'done', `${hours.start}–${hours.end}${placement?.workingHours ? ' for this placement' : ' (your default)'}`)
  else add('hours-set', 'todo', 'No working hours set')

  // Mentor & access
  const resources = placement?.resources ?? []
  if (resources.length) add('resources-ready', 'done', `${resources.length} resource${resources.length === 1 ? '' : 's'} on the placement`)
  else add('resources-ready', 'todo', 'Add the handbook, entrance instructions or anything to bring on the placement page')

  if (placement?.mentorName) add('mentor-recorded', 'done', placement.mentorName)
  else add('mentor-recorded', 'todo', 'Add the mentor to the placement setup')
  if (t.sharesReviewed && sameSet(t.sharesReviewed.packIds ?? [], shared)) add('shares-reviewed', 'done', shared.length ? `${shared.length} pack${shared.length === 1 ? '' : 's'} still shared` : 'Nothing is shared with mentors')
  else if (t.sharesReviewed) add('shares-reviewed', 'stale', 'What is shared changed since you reviewed it — look again')
  else add('shares-reviewed', 'todo', shared.length ? `${shared.length} pack${shared.length === 1 ? '' : 's'} currently shared` : 'Nothing is shared with mentors')

  // Carry forward
  if (Array.isArray(t.carryTargetIds)) add('goals-chosen', 'done', t.carryTargetIds.length ? `${t.carryTargetIds.length} goal${t.carryTargetIds.length === 1 ? '' : 's'} carried forward as references` : 'None carried forward')
  else add('goals-chosen', 'todo', 'Choose which open goals still apply — evidence stays with the placement it came from')
  if (t.confirmedStartISO) add('first-day', 'done', t.confirmedStartISO)
  else add('first-day', 'todo', placement?.startISO ? `Placement dates say ${placement.startISO}` : 'No start date on the placement')

  return out
}

export function transitionProgress(items) {
  const done = items.filter((i) => i.state === 'done').length
  const deferred = items.filter((i) => i.state === 'deferred').length
  const stale = items.filter((i) => i.state === 'stale').length
  return { done, deferred, total: items.length, stale, complete: done + deferred === items.length }
}

/** NF-01: mark an item "not known yet" (with an optional follow-up date) or clear that. */
export function withDeferral(transition, itemId, deferral, now) {
  const next = { ...(transition.deferred ?? {}) }
  if (deferral) next[itemId] = { ...deferral, at: now }
  else delete next[itemId]
  return { ...transition, deferred: next, at: now }
}
