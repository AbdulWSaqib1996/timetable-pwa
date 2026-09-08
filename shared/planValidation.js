/**
 * Work-plan item validation (R1 / TT-10), shared by the editor, backup
 * import and sync ingestion so the same rule holds at every boundary.
 * Errors name the field so the UI can focus it.
 */

export const MAX_EFFORT_MINS = 6000
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^\d{2}:\d{2}$/

export function realDate(iso) {
  if (typeof iso !== 'string' || !DATE_RE.test(iso)) return false
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
}

const validTime = (t) => typeof t === 'string' && TIME_RE.test(t) && Number(t.slice(0, 2)) < 24 && Number(t.slice(3)) < 60

/** Returns { ok, errors: { field: message } } — never throws. */
export function validatePlanChild(rec) {
  const errors = {}
  const r = rec && typeof rec === 'object' ? rec : {}
  if (typeof r.title !== 'string' || r.title.trim().length === 0) errors.title = 'Give it a title.'
  if (!['subtask', 'milestone', 'block'].includes(r.kind)) errors.kind = 'Choose a type.'
  if (r.effortMins !== undefined) {
    if (!Number.isInteger(r.effortMins) || r.effortMins < 0 || r.effortMins > MAX_EFFORT_MINS) {
      errors.effortMins = `Effort must be a whole number of minutes up to ${MAX_EFFORT_MINS}.`
    }
  }
  if (r.kind === 'milestone' && !realDate(r.dateISO)) errors.dateISO = 'Pick a real date.'
  if (r.kind === 'block') {
    if (!realDate(r.dateISO)) errors.dateISO = 'Pick a real date for the study block.'
    if (!validTime(r.startTime)) errors.startTime = 'Pick a start time.'
    if (!validTime(r.endTime)) errors.endTime = 'Pick an end time.'
    if (validTime(r.startTime) && validTime(r.endTime) && r.endTime <= r.startTime) {
      errors.endTime = 'A block must end after it starts.'
    }
  }
  if (r.kind === 'subtask' && r.dateISO !== undefined && r.dateISO !== '' && !realDate(r.dateISO)) {
    errors.dateISO = 'Pick a real date.'
  }
  return { ok: Object.keys(errors).length === 0, errors }
}

/** A legacy record that would not validate today: shown as "Needs scheduling",
 *  kept in place, never turned into a timed calendar entry. */
export function needsScheduling(rec) {
  return !validatePlanChild(rec).ok
}
