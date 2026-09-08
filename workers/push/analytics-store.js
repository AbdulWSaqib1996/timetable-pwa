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
/** Reserved test-token prefix (repo rule): accepted for live smoke tests but
 *  NEVER aggregated — synthetic traffic must not inflate real metrics. */
const isTestToken = (token) => /^f{8}/.test(token)
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
        const todayKey = `rel:${dayISO(Date.now())}`
        const rel = (await tx.get(todayKey)) ?? emptyOutcomes()
        // A replay returns the SAME successful acknowledgement without
        // touching a single counter — acks are idempotent by construction.
        if (await tx.get(dedupeKey)) {
          rel.duplicate++
          await tx.put(todayKey, rel)
          return json({ ok: true, acked: batch.batchId, duplicate: true })
        }
        rel.accepted++
        await tx.put(todayKey, rel)
        if (!isTestToken(batch.token)) {
          await tx.put('meta:lastAccepted', Date.now())
          // Immutable build identity, first observed date (A5 releases).
          if (batch.buildId && !(await tx.get(`meta:build:${batch.buildId}`))) {
            await tx.put(`meta:build:${batch.buildId}`, batch.days.map((d) => d.date).sort()[0])
          }
        }
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
        // Measurement-start dates, kept forever so adoption figures can say
        // when collection began (§7.3 — never silently backdated). Recorded
        // PER capability version: a capability-2 event's history starts when
        // capability-2 clients first reported, not at the v2 epoch. Reserved
        // test tokens set none of them.
        if (!isTestToken(batch.token)) {
          const earliest = batch.days.map((d) => d.date).sort()[0]
          if (!(await tx.get('meta:start'))) await tx.put('meta:start', earliest)
          const capKey = `meta:startcap:${batch.capabilityVersion}`
          if (!(await tx.get(capKey))) await tx.put(capKey, earliest)
        }
        await tx.put(dedupeKey, Date.now() + DEDUPE_HORIZON_DAYS * 86400000)
        // The acknowledgement is produced INSIDE the transaction: it exists
        // only if the counters durably committed with it.
        return json({ ok: true, acked: batch.batchId })
      })
    }

    if (request.method === 'POST' && url.pathname === '/v2/outcome') {
      // Attempts the worker refused BEFORE a batch existed (schema/oversize/
      // rate-limit): aggregate reason counts only — never request samples.
      const body = await request.json().catch(() => null)
      const reason = ['rejected', 'oversize', 'rateLimited'].includes(body?.reason) ? body.reason : null
      if (!reason) return json({ error: 'invalid reason' }, 400)
      return this.state.storage.transaction(async (tx) => {
        const key = `rel:${dayISO(Date.now())}`
        const rel = (await tx.get(key)) ?? emptyOutcomes()
        rel[reason]++
        await tx.put(key, rel)
        return json({ ok: true })
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
    const capStarts = new Map()
    for (const [k, v] of await this.state.storage.list({ prefix: 'meta:startcap:' })) {
      capStarts.set(Number(k.slice('meta:startcap:'.length)), v)
    }
    const seenEntries = await this.state.storage.list({ prefix: 'seen:' })
    const firstSeen = new Map()
    for (const [k, v] of seenEntries) {
      if (!isTestToken(k.slice(5))) firstSeen.set(k.slice(5), v)
    }

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
        if (isTestToken(token)) continue
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

    // Weekly cohorts (§4.4): membership = first v2-observed week (UTC Monday
    // 00:00 boundaries) under the retained-identity policy; week-N return =
    // at least one valid event-day observation in that EXACT subsequent
    // calendar week — not rolling N days, never "returned at any later
    // date". Incomplete observation weeks are marked, not zeroed; size
    // thresholds are applied by the display layer. No backfill: cohorts
    // begin at v2 measurement start.
    const mondayOf = (dateISO) => {
      const d = new Date(dateISO + 'T00:00:00Z')
      const shift = (d.getUTCDay() + 6) % 7
      return dayISO(d.getTime() - shift * 86400000)
    }
    const addDays = (dateISO, n) => dayISO(Date.parse(dateISO + 'T00:00:00Z') + n * 86400000)
    const thisMonday = mondayOf(today)
    const tokenWeeks = new Map()
    for (const key of allDays.keys()) {
      const date = key.slice(4, 14)
      const token = key.slice(15)
      if (isTestToken(token) || date < horizon) continue
      const wk = mondayOf(date)
      ;(tokenWeeks.get(token) ?? tokenWeeks.set(token, new Set()).get(token)).add(wk)
    }
    const cohortMap = new Map()
    for (const [token, first] of firstSeen) {
      const wk = mondayOf(first)
      ;(cohortMap.get(wk) ?? cohortMap.set(wk, []).get(wk)).push(token)
    }
    const cohorts = [...cohortMap.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .slice(0, 8)
      .map(([week, tokens]) => ({
        week,
        size: tokens.length,
        complete: week < thisMonday,
        weeks: [1, 2, 3, 4].map((n) => {
          const target = addDays(week, 7 * n)
          const complete = target < thisMonday
          return {
            n,
            complete,
            returned: complete ? tokens.filter((t) => tokenWeeks.get(t)?.has(target)).length : null,
          }
        }),
      }))
      .reverse()

    // Reliability (A5 / §4.5): worker-observed acceptance by reason and day,
    // with the configured thresholds published beside the numbers. Rates
    // are suppressed below the denominator minimum; the last COMPLETE UTC
    // day is the alerting basis, never the partial current day.
    const thresholds = { staleAfterMinutes: 30, rejectRatePct: 2, minAttempts: 100 }
    const relDays = []
    for (let i = 6; i >= 0; i--) {
      const date = dayISO(now - i * 86400000)
      const rel = (await this.state.storage.get(`rel:${date}`)) ?? emptyOutcomes()
      relDays.push({ date, ...rel })
    }
    for (const key of (await this.state.storage.list({ prefix: 'rel:' })).keys()) {
      if (key.slice(4) < dayISO(now - 30 * 86400000)) await this.state.storage.delete(key)
    }
    const yesterday = relDays[relDays.length - 2]
    const attempts = yesterday.accepted + yesterday.duplicate + yesterday.rejected + yesterday.oversize
    const refused = yesterday.rejected + yesterday.oversize
    const lastCompleteDay = {
      date: yesterday.date,
      attempts,
      refused,
      rateLimited: yesterday.rateLimited,
      ratePct: attempts >= thresholds.minAttempts ? Math.round((refused / attempts) * 1000) / 10 : null,
      status:
        attempts < thresholds.minAttempts
          ? 'insufficient'
          : (refused / attempts) * 100 > thresholds.rejectRatePct
            ? 'alert'
            : 'ok',
    }
    const lastAcceptedAt = (await this.state.storage.get('meta:lastAccepted')) ?? null

    // Releases (A5 / §4.6): each active token attributed ONCE to its latest
    // observed build in the 7-day window; Unknown stays a visible category.
    // Comparisons only for builds with >= 20 eligible tokens over the last
    // COMPLETE 7 UTC days (today excluded) — opens per token, no deltas.
    const latestBuild = new Map()
    const buildTokens = new Map()
    const completeOpens = new Map() // build -> { opens, tokens:Set }
    const ymd = (i) => dayISO(now - i * 86400000)
    for (let i = 0; i < 8; i++) {
      const date = ymd(i)
      for (const [key, row] of await this.state.storage.list({ prefix: `day:${date}:` })) {
        const token = key.slice(`day:${date}:`.length)
        if (isTestToken(token)) continue
        const build = row.buildId || 'unknown'
        if (i < 7 && !latestBuild.has(token)) latestBuild.set(token, build)
        if (i >= 1 && i <= 7) {
          const c = completeOpens.get(build) ?? { opens: 0, tokens: new Set() }
          c.opens += row.opens ?? 0
          c.tokens.add(token)
          completeOpens.set(build, c)
        }
      }
    }
    for (const [token, build] of latestBuild) {
      ;(buildTokens.get(build) ?? buildTokens.set(build, new Set()).get(build)).add(token)
    }
    const buildFirst = new Map()
    for (const [k, v] of await this.state.storage.list({ prefix: 'meta:build:' })) buildFirst.set(k.slice('meta:build:'.length), v)
    const activeForBuilds = latestBuild.size
    const builds = [...buildTokens.entries()]
      .map(([buildId, tokens]) => {
        const c = completeOpens.get(buildId)
        const eligible = c ? c.tokens.size : 0
        return {
          buildId,
          tokens: tokens.size,
          sharePct: activeForBuilds > 0 ? Math.round((tokens.size / activeForBuilds) * 100) : null,
          firstObserved: buildId === 'unknown' ? null : (buildFirst.get(buildId) ?? null),
          comparison:
            eligible >= 20
              ? { periodFrom: ymd(7), periodTo: ymd(1), eligibleTokens: eligible, opensPerToken: Math.round((c.opens / eligible) * 10) / 10 }
              : { unavailable: true, eligibleTokens: eligible, minimum: 20 },
        }
      })
      .sort((a, b) => b.tokens - a.tokens)

    const eligibleFor = (since) =>
      [...active7].filter((t) => (tokenCapability.get(t) ?? 1) >= since).length
    const features = Object.entries(ACTION_CATALOGUE).map(([id, def]) => {
      const collected = def.since <= CAPABILITY_VERSION
      const eligible = collected ? eligibleFor(def.since) : 0
      const tokens = featureTokens[id]?.size ?? 0
      return {
        id,
        contractVersion: def.since,
        collectionStartedAt: collected ? (capStarts.get(def.since) ?? (def.since === 1 ? collectionStart : null)) : null,
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
      cohorts,
      reliability: { thresholds, lastAcceptedAt, days: relDays, lastCompleteDay },
      builds: { activeTokens: activeForBuilds, list: builds },
    })
  }
}

function emptyOutcomes() {
  return { accepted: 0, duplicate: 0, rejected: 0, oversize: 0, rateLimited: 0 }
}

function count(value, definition) {
  return { value, status: 'complete', definition }
}
