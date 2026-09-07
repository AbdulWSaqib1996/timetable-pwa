import { MAX_COUNT, MAX_DAYS_PER_BATCH, QUEUE_RETENTION_DAYS } from './analytics-contracts.js'

/**
 * Transactional telemetry queue core (A2 / ADM-05..08). Storage-agnostic:
 * every operation is a pure synchronous mutation over the queue's full row
 * map, applied atomically by an adapter — a Map in unit tests, one IndexedDB
 * readwrite transaction in the browser. The rules live HERE once, so node
 * tests exercise exactly the logic the app runs.
 *
 * Model:
 *  - `seg:<id>` rows accumulate counters for one UTC observed date under one
 *    consent generation. The OPEN segment for a date is the one with no
 *    batchId; claiming stamps a batchId and freezes it (immutable batch) —
 *    events recorded during a send land in a NEW open segment and can never
 *    be lost by an acknowledgement they were not part of (ADM-05).
 *  - `meta:lease` serialises sending across tabs (ADM-06): a claim while
 *    another live lease exists returns null; an expired lease can be taken
 *    over and the SAME batchId is resent, which the server deduplicates.
 *  - `meta:gen` is the consent generation (ADM-07): clearing on opt-out
 *    deletes every segment and bumps the generation, so stale in-flight
 *    work can neither survive nor mark the new generation as sent.
 *  - Segments older than the retention horizon are dropped at claim time and
 *    counted in `meta:dropped` (a local coarse diagnostic only).
 */

const SEG_PREFIX = 'seg:'
const LEASE_KEY = 'meta:lease'
const GEN_KEY = 'meta:gen'
const DROPPED_KEY = 'meta:dropped'

export const LEASE_MS = 2 * 60_000

const segRows = (rows) => [...rows.entries()].filter(([k]) => k.startsWith(SEG_PREFIX))
const genOf = (rows) => rows.get(GEN_KEY) ?? 0
const clampCount = (n) => Math.min(MAX_COUNT, Math.max(0, Math.round(n)))

/** Mutation: record `n` uses of `event` on `date`. No-ops are the adapter's
 *  concern only when consent is off — the queue itself always records. */
export function recordEvent(rows, { date, event, n = 1 }) {
  return bump(rows, date, (seg) => {
    seg.counts[event] = clampCount((seg.counts[event] ?? 0) + n)
    if (seg.counts[event] === 0) delete seg.counts[event]
  })
}

/** Mutation: record one foreground open on `date`. */
export function recordOpen(rows, { date }) {
  return bump(rows, date, (seg) => {
    seg.opens = clampCount(seg.opens + 1)
  })
}

/** Mutation: attach context (standalone/platform/setup) to `date`'s segment. */
export function setDayContext(rows, { date, standalone, platform, setup }) {
  return bump(rows, date, (seg) => {
    if (typeof standalone === 'boolean') seg.standalone = standalone
    if (platform) seg.platform = platform
    if (setup && typeof setup === 'object') seg.setup = { ...seg.setup, ...setup }
  })
}

function bump(rows, date, apply) {
  const gen = genOf(rows)
  const open = segRows(rows).find(([, s]) => s.date === date && s.gen === gen && s.batchId === null)
  const id = open ? open[0] : `${SEG_PREFIX}${Math.random().toString(16).slice(2, 10)}${Date.now().toString(16)}`
  const seg = open ? { ...open[1], counts: { ...open[1].counts } } : { date, gen, batchId: null, claimedAt: null, opens: 0, counts: {} }
  apply(seg)
  return { set: [[id, seg]] }
}

/**
 * Mutation: claim work for sending. Result is null when another tab holds a
 * live lease; otherwise the lease moves to `owner` and the result is either
 * the oldest PREVIOUSLY claimed batch (unacknowledged — resend with the SAME
 * batchId) or a fresh batch of up to 7 oldest dated open segments.
 */
export function claim(rows, { now, owner, batchId, leaseMs = LEASE_MS, retentionDays = QUEUE_RETENTION_DAYS }) {
  const lease = rows.get(LEASE_KEY)
  if (lease && lease.owner !== owner && lease.until > now) return { result: null }
  const set = []
  const del = []
  const withLease = (result) => {
    // The lease exists only while there is genuinely a batch in flight — an
    // empty claim must not lock other tabs (or the next app start) out.
    if (result) set.push([LEASE_KEY, { owner, until: now + leaseMs }])
    else if (lease) del.push(LEASE_KEY)
    return { set, del, result }
  }

  // Expire segments beyond retention (both open and claimed): the data can no
  // longer be faithfully reported and is discarded, counted locally.
  const gen = genOf(rows)
  let dropped = 0
  const live = []
  for (const [k, s] of segRows(rows)) {
    // Whole calendar days: a date is expired only once it is MORE than
    // retentionDays behind the current UTC date (floor, not round — a
    // mid-day clock must not shave a day off the horizon).
    const ageDays = Math.floor((now - Date.parse(s.date + 'T00:00:00Z')) / 86400000)
    if (ageDays > retentionDays || s.gen !== gen) {
      del.push(k)
      dropped++
    } else {
      live.push([k, s])
    }
  }
  if (dropped > 0) set.push([DROPPED_KEY, (rows.get(DROPPED_KEY) ?? 0) + dropped])

  // An unacknowledged claimed batch is resent as-is, oldest first.
  const claimed = live.filter(([, s]) => s.batchId !== null)
  if (claimed.length > 0) {
    const oldest = claimed.reduce((a, b) => (a[1].claimedAt <= b[1].claimedAt ? a : b))[1].batchId
    const batch = claimed.filter(([, s]) => s.batchId === oldest)
    return withLease({ batchId: oldest, days: buildDays(batch.map(([, s]) => s)) })
  }

  const open = live
    .filter(([, s]) => s.batchId === null && (Object.keys(s.counts).length > 0 || s.opens > 0 || s.setup))
    .sort((a, b) => a[1].date.localeCompare(b[1].date))
  if (open.length === 0) return withLease(null)
  const dates = [...new Set(open.map(([, s]) => s.date))].slice(0, MAX_DAYS_PER_BATCH)
  const chosen = open.filter(([, s]) => dates.includes(s.date))
  for (const [k, s] of chosen) set.push([k, { ...s, batchId, claimedAt: now }])
  return withLease({ batchId, days: buildDays(chosen.map(([, s]) => s)) })
}

/** Segments in a batch merge per date into the wire shape. */
function buildDays(segs) {
  const byDate = new Map()
  for (const s of segs) {
    const day = byDate.get(s.date) ?? { date: s.date, opens: 0, counts: {} }
    day.opens = clampCount(day.opens + s.opens)
    for (const [k, n] of Object.entries(s.counts)) day.counts[k] = clampCount((day.counts[k] ?? 0) + n)
    if (typeof s.standalone === 'boolean') day.standalone = s.standalone
    if (s.platform) day.platform = s.platform
    if (s.setup) day.setup = { ...day.setup, ...s.setup }
    byDate.set(s.date, day)
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
}

/** Mutation: a durable server acknowledgement deletes EXACTLY that batch's
 *  segments (never newer ones) and releases the lease if `owner` holds it. */
export function ack(rows, { batchId, owner }) {
  const del = segRows(rows)
    .filter(([, s]) => s.batchId === batchId)
    .map(([k]) => k)
  const set = []
  const lease = rows.get(LEASE_KEY)
  if (lease && lease.owner === owner) del.push(LEASE_KEY)
  return { set, del }
}

/** Mutation: a failed send releases the lease so any tab may retry; the
 *  claimed batch stays intact for an identical resend. */
export function release(rows, { owner }) {
  const lease = rows.get(LEASE_KEY)
  if (lease && lease.owner === owner) return { del: [LEASE_KEY] }
  return {}
}

/** Mutation: consent switched off — delete everything, bump the generation.
 *  Anything in flight belongs to the old generation and can never come back. */
export function clearAll(rows, { now }) {
  const del = segRows(rows).map(([k]) => k)
  del.push(LEASE_KEY, DROPPED_KEY)
  return { set: [[GEN_KEY, now]], del }
}

export function pendingSummary(rows) {
  const gen = genOf(rows)
  let openSegments = 0
  let claimedSegments = 0
  for (const [, s] of segRows(rows)) {
    if (s.gen !== gen) continue
    if (s.batchId === null) openSegments++
    else claimedSegments++
  }
  return { openSegments, claimedSegments, dropped: rows.get(DROPPED_KEY) ?? 0 }
}
