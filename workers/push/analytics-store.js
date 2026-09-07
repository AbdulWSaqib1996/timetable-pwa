import { ACTION_CATALOGUE, CAPABILITY_VERSION, DEDUPE_HORIZON_DAYS } from '../../shared/analytics-contracts.js'

/**
 * Analytics coordinator Durable Object (A2 / ADM-06, 08, 17): a single
 * transactional owner for v2 telemetry, isolated from SyncStore/GroupStore.
 * KV read-then-put is NOT atomic under eventual consistency, so acceptance,
 * deduplication and aggregation happen here.
 *
 * Storage layout (all analytics-owned; nothing shared with push/sync/group):
 *   dp:<token>:<batchId>  -> expiry ms          (idempotence records)
 *   day:<date>:<token>    -> per-token day row  (bounded counters + context)
 *   seen:<token>          -> first v2-observed date
 *
 * Scale note (measured against the project's actual cohort, ~150 tokens):
 * a single coordinator handles this comfortably — one DO write batch per
 * accepted batch, one bounded scan per snapshot. If the token population
 * ever grows by orders of magnitude, partition by day prefix and merge
 * distinct-token sets explicitly; do NOT sum per-shard uniques.
 */

const RAW_RETENTION_DAYS = 90
const AGGREGATE_WINDOW_DAYS = 31

const json = (obj, status = 200) => Response.json(obj, { status })
const dayISO = (ms) => new Date(ms).toISOString().slice(0, 10)
const hex = (bytes) =>
  [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, '0')).join('')

export class AnalyticsStore {
  constructor(state) {
    this.state = state
  }

  async fetch(request) {
    const url = new URL(request.url)
    if (request.method === 'POST' && url.pathname === '/v2/batch') {
      const batch = await request.json().catch(() => null)
      if (!batch?.batchId || !batch?.token || !Array.isArray(batch.days)) return json({ error: 'invalid batch' }, 400)
      return this.state.storage.transaction(async (tx) => {
        const dedupeKey = `dp:${batch.token}:${batch.batchId}`
        // A replay returns the SAME successful acknowledgement without
        // touching a single counter — acks are idempotent by construction.
        if (await tx.get(dedupeKey)) return json({ ok: true, acked: batch.batchId, duplicate: true })
        for (const day of batch.days) {
          const key = `day:${day.date}:${batch.token}`
          const row = (await tx.get(key)) ?? { opens: 0, counts: {} }
          // Counts ADD exactly once per accepted batch; context fields adopt
          // the newest observation without erasing earlier counts (ADM-06).
          row.opens = Math.min(9999, row.opens + (day.opens ?? 0))
          for (const [k, n] of Object.entries(day.counts ?? {})) {
            row.counts[k] = Math.min(9999, (row.counts[k] ?? 0) + n)
          }
          const standalone = typeof day.standalone === 'boolean' ? day.standalone : batch.standalone
          if (typeof standalone === 'boolean') row.standalone = standalone
          if (day.platform ?? batch.platform) row.platform = day.platform ?? batch.platform
          if (day.setup) row.setup = { ...row.setup, ...day.setup }
          row.buildId = batch.buildId
          row.capabilityVersion = batch.capabilityVersion
          await tx.put(key, row)
        }
        if (!(await tx.get(`seen:${batch.token}`))) {
          await tx.put(`seen:${batch.token}`, batch.days.map((d) => d.date).sort()[0])
        }
        // v2 measurement start: the first accepted batch's earliest day, kept
        // forever so adoption figures can say when collection began (§7.3 —
        // never silently backdated).
        if (!(await tx.get('meta:start'))) {
          await tx.put('meta:start', batch.days.map((d) => d.date).sort()[0])
        }
        await tx.put(dedupeKey, Date.now() + DEDUPE_HORIZON_DAYS * 86400000)
        // The acknowledgement is produced INSIDE the transaction: it exists
        // only if the counters durably committed with it.
        return json({ ok: true, acked: batch.batchId })
      })
    }

    if (request.method === 'POST' && url.pathname === '/v2/aggregate') {
      return this.aggregate()
    }

    return json({ error: 'not found' }, 404)
  }

  /** Build the complete /stats/v2 snapshot from v2 event-day rows, and prune
   *  expired raw rows/dedupe records (analytics-owned keys only). */
  async aggregate() {
    const now = Date.now()
    const today = dayISO(now)
    const collectionStart = (await this.state.storage.get('meta:start')) ?? null
    const seenEntries = await this.state.storage.list({ prefix: 'seen:' })
    const firstSeen = new Map()
    for (const [k, v] of seenEntries) firstSeen.set(k.slice(5), v)

    const daily = []
    const active7 = new Set()
    const active30 = new Set()
    const featureUses = {}
    const featureTokens = {}
    const tokenCapability = new Map()
    let observedThrough = null
    let standaloneTodayYes = 0
    let standaloneTodayKnown = 0
    let activeToday = 0

    for (let i = 0; i < AGGREGATE_WINDOW_DAYS; i++) {
      const date = dayISO(now - i * 86400000)
      const rows = await this.state.storage.list({ prefix: `day:${date}:` })
      let active = 0
      let newTokens = 0
      let returning = 0
      for (const [key, row] of rows) {
        const token = key.slice(`day:${date}:`.length)
        active++
        if (firstSeen.get(token) === date) newTokens++
        else if (firstSeen.has(token)) returning++
        if (i < 7) {
          active7.add(token)
          tokenCapability.set(token, Math.max(tokenCapability.get(token) ?? 1, row.capabilityVersion ?? 1))
          for (const [f, n] of Object.entries(row.counts ?? {})) {
            if (!(Number(n) > 0)) continue
            featureUses[f] = (featureUses[f] ?? 0) + Number(n)
            ;(featureTokens[f] = featureTokens[f] ?? new Set()).add(token)
          }
        }
        if (i < 30) active30.add(token)
        if (i === 0) {
          activeToday++
          if (typeof row.standalone === 'boolean') {
            standaloneTodayKnown++
            if (row.standalone) standaloneTodayYes++
          }
        }
      }
      if (active > 0 && observedThrough === null) observedThrough = date
      daily.push({
        date,
        active: count(active, 'distinct tokens with a valid v2 event-day observation'),
        new: count(newTokens, 'tokens first observed under v2 collection on this date'),
        returning: count(returning, 'active tokens first observed under v2 collection on an earlier date'),
      })
    }
    daily.reverse()

    // Prune analytics-owned raw rows past retention and expired dedupe records.
    const horizon = dayISO(now - RAW_RETENTION_DAYS * 86400000)
    const allDays = await this.state.storage.list({ prefix: 'day:' })
    for (const key of allDays.keys()) {
      const date = key.slice(4, 14)
      if (date < horizon) await this.state.storage.delete(key)
    }
    const dedupes = await this.state.storage.list({ prefix: 'dp:' })
    for (const [key, expiry] of dedupes) {
      if (Number(expiry) < now) await this.state.storage.delete(key)
    }

    const eligibleFor = (since) =>
      [...active7].filter((t) => (tokenCapability.get(t) ?? 1) >= since).length
    const features = Object.entries(ACTION_CATALOGUE).map(([id, def]) => {
      const collected = def.since <= CAPABILITY_VERSION
      const eligible = collected ? eligibleFor(def.since) : 0
      const tokens = featureTokens[id]?.size ?? 0
      return {
        id,
        contractVersion: def.since,
        collectionStartedAt: collected ? collectionStart : null,
        measurement: collected ? 'available' : 'not-collected',
        adoption: {
          value: collected && eligible > 0 ? Math.round((tokens / eligible) * 100) : null,
          status: collected ? (eligible > 0 ? 'complete' : 'unavailable') : 'unavailable',
          definition: `distinct eligible active tokens (7d) with a positive ${id} count / eligible active tokens`,
          numerator: collected ? tokens : null,
          denominator: collected ? eligible : null,
          eligibleCoverage: collected ? { eligible, active: active7.size } : null,
        },
        uses: {
          value: collected ? featureUses[id] ?? 0 : null,
          status: collected ? 'complete' : 'unavailable',
          definition: `sum of deduplicated ${id} counts by observed UTC date, last 7 days`,
        },
      }
    })

    return json({
      schemaVersion: 2,
      snapshotId: hex(8),
      generatedAt: new Date(now).toISOString(),
      observedThrough,
      period: { from: dayISO(now - (AGGREGATE_WINDOW_DAYS - 1) * 86400000), to: today, timezone: 'UTC', includesPartialToday: true },
      source: 'event-day-v2',
      completeness: { status: 'complete', missingRows: 0, invalidRows: 0, scanComplete: true, reasons: [] },
      metrics: {
        activeTokens7: count(active7.size, 'distinct tokens with a v2 event-day observation in the fixed last 7 UTC days (incl. partial today)'),
        activeTokens30: count(active30.size, 'distinct tokens with a v2 event-day observation in the fixed last 30 UTC days (incl. partial today)'),
        activeToday: { ...count(activeToday, 'distinct tokens observed on the current UTC date'), status: 'partial' },
        standaloneToday: {
          value: standaloneTodayKnown > 0 ? Math.round((standaloneTodayYes / standaloneTodayKnown) * 100) : null,
          status: standaloneTodayKnown > 0 ? 'partial' : 'unavailable',
          definition: 'tokens reporting standalone display mode today / tokens with a known mode today',
          numerator: standaloneTodayYes,
          denominator: standaloneTodayKnown,
          eligibleCoverage: { eligible: standaloneTodayKnown, active: activeToday },
        },
      },
      daily,
      features,
    })
  }
}

function count(value, definition) {
  return { value, status: 'complete', definition }
}
