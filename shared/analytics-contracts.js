/**
 * Versioned analytics wire contracts (A2 / ADM-05..08, 13, 16): ONE definition
 * of the action catalogue and the v2 batch envelope, consumed by the client
 * queue, the worker validator and the admin labels. Runtime-neutral.
 *
 * Privacy invariants enforced structurally: a batch carries a random browser
 * token, coarse counters by UTC observed date, build/capability identity and
 * known setup booleans — never event text, titles, routes, coordinates,
 * record IDs or profile identity.
 */

export const ANALYTICS_SCHEMA_VERSION = 2

/**
 * The capability version this build can report. Version 1 carries the legacy
 * action names (now recorded by OBSERVED day instead of receipt day).
 * Version 2 (A4) adds route views and SUCCESSFUL-persistence events. The
 * catalogue sits exactly at the 32-events-per-version cap: session detail
 * and search stay measured under their v1 names rather than duplicated.
 */
export const CAPABILITY_VERSION = 2

/** semantics: what a count actually proves. */
export const ACTION_CATALOGUE = {
  // -- capability 1: legacy names, attempt/open semantics --
  detail: { label: 'Session details', semantics: 'view', since: 1 },
  week: { label: 'Week view', semantics: 'view', since: 1 },
  month: { label: 'Month view', semantics: 'view', since: 1 },
  search: { label: 'Search', semantics: 'attempt', since: 1 },
  historyview: { label: 'History toggle', semantics: 'view', since: 1 },
  home: { label: 'Head home', semantics: 'view', since: 1 },
  settings: { label: 'Settings', semantics: 'view', since: 1 },
  filters: { label: 'Filters', semantics: 'view', since: 1 },
  keydates: { label: 'Key dates', semantics: 'view', since: 1 },
  stats: { label: 'Term stats', semantics: 'view', since: 1 },
  journal: { label: 'Evidence journal', semantics: 'view', since: 1 },
  admin: { label: 'My PGCE file', semantics: 'view', since: 1 },
  group: { label: 'Study group', semantics: 'view', since: 1 },
  adddl: { label: 'Add deadline', semantics: 'attempt', since: 1 },
  changes: { label: 'Change log', semantics: 'view', since: 1 },
  photo: { label: 'Photo add attempt', semantics: 'attempt', since: 1 },
  binder: { label: 'Binder export attempt', semantics: 'attempt', since: 1 },
  evidenceprint: { label: 'Evidence print attempt', semantics: 'attempt', since: 1 },
  // -- capability 2 (A4): route views and SUCCESS events --
  view_today: { label: 'Today viewed', semantics: 'view', since: 2 },
  view_schedule: { label: 'Schedule viewed', semantics: 'view', since: 2 },
  view_tasks: { label: 'Tasks viewed', semantics: 'view', since: 2 },
  view_pgce: { label: 'PGCE file viewed', semantics: 'view', since: 2 },
  journey_session_opened: { label: 'Journey to session opened', semantics: 'view', since: 2 },
  journey_home_opened: { label: 'Journey home opened', semantics: 'view', since: 2 },
  journey_planned: { label: 'Journey plan shown', semantics: 'success', since: 2 },
  navigation_link_opened: { label: 'External navigation opened', semantics: 'attempt', since: 2 },
  task_created: { label: 'Task created', semantics: 'success', since: 2 },
  task_completed: { label: 'Task completed', semantics: 'success', since: 2 },
  pgce_record_saved: { label: 'PGCE record saved', semantics: 'success', since: 2 },
  evidence_photo_saved: { label: 'Evidence photo saved', semantics: 'success', since: 2 },
  export_prepared: { label: 'Export prepared', semantics: 'success', since: 2 },
  sync_outcome: { label: 'Sync outcome reported', semantics: 'success', since: 2 },
}

export const SETUP_FLAGS = ['push', 'location', 'home', 'keyDates', 'sync', 'placements']
export const PLATFORMS = ['ios', 'android', 'desktop', 'other']

export const MAX_BATCH_BYTES = 16384
export const MAX_DAYS_PER_BATCH = 7
export const MAX_COUNT = 999
export const MAX_EVENTS_PER_VERSION = 32
/** Segments older than this are expired client-side and rejected server-side. */
export const QUEUE_RETENTION_DAYS = 7
/** Dedupe records must outlive the retry horizon: retention + 1 day skew. */
export const DEDUPE_HORIZON_DAYS = 8
/** Permitted forward clock skew on observed dates. */
export const MAX_FUTURE_SKEW_DAYS = 1

/** Event names a client at `capabilityVersion` may report. */
export function allowedEvents(capabilityVersion) {
  return Object.entries(ACTION_CATALOGUE)
    .filter(([, def]) => def.since <= capabilityVersion)
    .map(([name]) => name)
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const posInt = (n, max) => Number.isInteger(n) && n > 0 && n <= max
const nonNegInt = (n, max) => Number.isInteger(n) && n >= 0 && n <= max

const dayDiff = (fromISO, toISO) =>
  Math.round((Date.parse(toISO + 'T00:00:00Z') - Date.parse(fromISO + 'T00:00:00Z')) / 86400000)

/**
 * Validate a v2 batch envelope. Returns { ok, errors, batch } where `batch`
 * is a CLEAN whitelist rebuild — unknown fields, unknown event names and
 * out-of-bound values cannot pass through. Any invalid day segment fails the
 * WHOLE batch: a batch is acknowledged (and deduplicated) as a unit, so
 * partial acceptance would corrupt idempotence.
 */
export function validateBatch(input, { todayISO } = {}) {
  const errors = []
  const o = input && typeof input === 'object' ? input : {}
  const today = todayISO ?? new Date().toISOString().slice(0, 10)

  if (o.schemaVersion !== ANALYTICS_SCHEMA_VERSION) errors.push('unsupported schemaVersion')
  if (typeof o.token !== 'string' || !/^[0-9a-f]{8,32}$/.test(o.token)) errors.push('invalid token')
  if (typeof o.batchId !== 'string' || !/^[0-9a-f]{16,32}$/.test(o.batchId)) errors.push('invalid batchId')
  const buildId = typeof o.buildId === 'string' && /^[0-9A-Za-z._-]{1,40}$/.test(o.buildId) ? o.buildId : null
  if (!buildId) errors.push('invalid buildId')
  const capV = o.capabilityVersion
  if (!Number.isInteger(capV) || capV < 1 || capV > CAPABILITY_VERSION) errors.push('unsupported capabilityVersion')
  const platform = PLATFORMS.includes(o.platform) ? o.platform : null
  if (!platform) errors.push('invalid platform')
  const standalone = typeof o.standalone === 'boolean' ? o.standalone : null

  const allowed = errors.length === 0 ? new Set(allowedEvents(capV)) : new Set()
  if (allowed.size > MAX_EVENTS_PER_VERSION) errors.push('catalogue exceeds event cap')

  const days = []
  if (!Array.isArray(o.days) || o.days.length < 1 || o.days.length > MAX_DAYS_PER_BATCH) {
    errors.push(`days must be 1–${MAX_DAYS_PER_BATCH} dated segments`)
  } else if (errors.length === 0) {
    const seen = new Set()
    for (const d of o.days) {
      const date = typeof d?.date === 'string' && DATE_RE.test(d.date) && !Number.isNaN(Date.parse(d.date + 'T00:00:00Z')) ? d.date : null
      if (!date) {
        errors.push('invalid day date')
        continue
      }
      if (seen.has(date)) {
        errors.push('duplicate day segment')
        continue
      }
      seen.add(date)
      const ahead = dayDiff(today, date)
      if (ahead > MAX_FUTURE_SKEW_DAYS) errors.push(`day ${date} is in the future beyond permitted skew`)
      if (-ahead > QUEUE_RETENTION_DAYS + MAX_FUTURE_SKEW_DAYS) errors.push(`day ${date} is older than the retention horizon`)
      const opens = d.opens === undefined ? 0 : d.opens
      if (!nonNegInt(opens, MAX_COUNT)) {
        errors.push('invalid opens count')
        continue
      }
      const counts = {}
      if (d.counts !== undefined) {
        if (!d.counts || typeof d.counts !== 'object' || Array.isArray(d.counts)) {
          errors.push('invalid counts object')
          continue
        }
        for (const [k, n] of Object.entries(d.counts)) {
          if (!allowed.has(k)) {
            errors.push(`unknown event ${String(k).slice(0, 40)}`)
            continue
          }
          if (!posInt(n, MAX_COUNT)) {
            errors.push(`invalid count for ${k}`)
            continue
          }
          counts[k] = n
        }
      }
      let setup
      if (d.setup !== undefined) {
        if (!d.setup || typeof d.setup !== 'object' || Array.isArray(d.setup)) {
          errors.push('invalid setup object')
          continue
        }
        setup = {}
        for (const k of SETUP_FLAGS) if (typeof d.setup[k] === 'boolean') setup[k] = d.setup[k]
      }
      days.push({ date, opens, counts, ...(setup && Object.keys(setup).length > 0 ? { setup } : {}) })
    }
  }

  if (errors.length > 0) return { ok: false, errors, batch: null }
  return {
    ok: true,
    errors: [],
    batch: {
      schemaVersion: ANALYTICS_SCHEMA_VERSION,
      token: o.token,
      batchId: o.batchId,
      buildId,
      capabilityVersion: capV,
      platform,
      standalone,
      days,
    },
  }
}

/* ---- /stats/v2 response validation (used by the A3 admin client) ---- */

const validCount = (c) =>
  c &&
  typeof c === 'object' &&
  (c.value === null || (Number.isFinite(c.value) && c.value >= 0)) &&
  ['complete', 'partial', 'unavailable'].includes(c.status) &&
  typeof c.definition === 'string'

const validRatio = (r) =>
  validCount(r) &&
  (r.numerator === null || (Number.isFinite(r.numerator) && r.numerator >= 0)) &&
  (r.denominator === null || (Number.isFinite(r.denominator) && r.denominator >= 0)) &&
  (r.numerator === null || r.denominator === null || r.numerator <= r.denominator)

/** Structural validation of a /stats/v2 envelope; never parse it as HTML. */
export function validateStatsV2(input) {
  const o = input && typeof input === 'object' ? input : null
  if (!o) return false
  if (o.schemaVersion !== 2) return false
  if (typeof o.snapshotId !== 'string' || typeof o.generatedAt !== 'string') return false
  if (o.observedThrough !== null && typeof o.observedThrough !== 'string') return false
  const p = o.period
  if (!p || !DATE_RE.test(p.from ?? '') || !DATE_RE.test(p.to ?? '') || p.from > p.to || p.timezone !== 'UTC') return false
  if (!['event-day-v2', 'legacy-receipt-day', 'mixed'].includes(o.source)) return false
  const c = o.completeness
  if (!c || !['complete', 'partial', 'unavailable'].includes(c.status) || typeof c.scanComplete !== 'boolean') return false
  if (!Number.isInteger(c.missingRows) || !Number.isInteger(c.invalidRows) || !Array.isArray(c.reasons)) return false
  if (!o.metrics || typeof o.metrics !== 'object') return false
  for (const m of Object.values(o.metrics)) {
    if (!(validRatio(m) || validCount(m))) return false
  }
  if (!Array.isArray(o.daily)) return false
  for (const d of o.daily) {
    if (!d || !DATE_RE.test(d.date ?? '') || !validCount(d.active) || !validCount(d.new) || !validCount(d.returning)) return false
  }
  if (!Array.isArray(o.features)) return false
  for (const f of o.features) {
    if (!f || typeof f.id !== 'string' || !['available', 'legacy', 'not-collected'].includes(f.measurement)) return false
    if (!validRatio(f.adoption) || !validCount(f.uses)) return false
  }
  return true
}
