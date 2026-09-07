import { ANALYTICS_SCHEMA_VERSION, CAPABILITY_VERSION } from '../../../shared/analytics-contracts.js'
import {
  ack,
  claim,
  clearAll,
  pendingSummary,
  recordEvent,
  recordOpen,
  release,
  setDayContext,
} from '../../../shared/telemetry-queue.js'
import type { ClaimedBatch } from '../../../shared/telemetry-queue.js'
import { defaultAdapter } from './idb'
import type { QueueAdapter } from './idb'

/**
 * Consent-gated telemetry collector (A2 / ADM-05..08). Every call re-checks
 * the CURRENT consent state — demo profiles and opted-out settings collect
 * nothing, and switching consent off clears the queue and bumps a generation
 * so stale in-flight work cannot resurface. Counters are recorded under
 * their UTC observed date; sending is immutable batches acknowledged by ID.
 */

const hex = (bytes: number) =>
  [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, '0')).join('')

const TAB_ID = hex(6)
const todayUTC = () => new Date().toISOString().slice(0, 10)

let adapter: QueueAdapter = defaultAdapter()
let consentEnabled = false
let retryNotBefore = 0

/** Test hook: swap the storage adapter (never used in production code paths). */
export function _setTelemetryAdapter(a: QueueAdapter): void {
  adapter = a
}

/**
 * Called by App whenever the active profile or its settings change. A
 * transition to disabled clears every pending counter and starts a new
 * consent generation. (Already-transmitted batches cannot be unsent — the
 * Settings copy must never claim otherwise.)
 */
export function configureTelemetry(enabled: boolean): void {
  const wasEnabled = consentEnabled
  consentEnabled = enabled
  if (wasEnabled && !enabled) {
    void adapter.mutate((rows) => clearAll(rows, { now: Date.now() })).catch(() => {})
  }
}

/** Record one feature-use count for today (UTC). No consent → no write. */
export function telemetryTrack(event: string): void {
  if (!consentEnabled) return
  void adapter.mutate((rows) => recordEvent(rows, { date: todayUTC(), event })).catch(() => {})
}

/** Record one foreground open (mount/resume) for today (UTC). */
export function telemetryOpen(): void {
  if (!consentEnabled) return
  void adapter.mutate((rows) => recordOpen(rows, { date: todayUTC() })).catch(() => {})
}

export interface TelemetryContext {
  standalone: boolean
  platform: string
  setup: Record<string, boolean>
}

/**
 * Claim and send pending batches. Safe to call often: a live lease in
 * another tab, empty queue, disabled consent or an active backoff all no-op.
 * The acknowledgement deletes exactly the acknowledged batch; events
 * recorded while the request was in flight stay queued for the next flush.
 */
export async function flushTelemetry(base: string, token: string, context: TelemetryContext): Promise<void> {
  if (!consentEnabled || !token || Date.now() < retryNotBefore) return
  try {
    // Attach today's context so the day segment carries standalone/setup.
    await adapter.mutate((rows) => setDayContext(rows, { date: todayUTC(), ...context }))
    // Drain up to a few batches per flush; each is one claim → send → ack.
    for (let round = 0; round < 3; round++) {
      const batch = (await adapter.mutate((rows) =>
        claim(rows, { now: Date.now(), owner: TAB_ID, batchId: hex(10) })
      )) as ClaimedBatch | null | undefined
      if (!batch) return
      const envelope = {
        schemaVersion: ANALYTICS_SCHEMA_VERSION,
        token,
        batchId: batch.batchId,
        buildId: typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev',
        capabilityVersion: CAPABILITY_VERSION,
        platform: context.platform,
        standalone: context.standalone,
        days: batch.days,
      }
      let res: Response
      try {
        res = await fetch(`${base.replace(/\/+$/, '')}/v2/batch`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(envelope),
        })
      } catch {
        // Network failure: release the lease so ANY tab can retry the same
        // immutable batch later; bounded backoff with jitter, no tight loop.
        await adapter.mutate((rows) => release(rows, { owner: TAB_ID }))
        retryNotBefore = Date.now() + 60_000 + Math.random() * 60_000
        return
      }
      if (res.ok) {
        await adapter.mutate((rows) => ack(rows, { batchId: batch.batchId, owner: TAB_ID }))
        continue
      }
      await adapter.mutate((rows) => release(rows, { owner: TAB_ID }))
      if (res.status === 429) {
        const after = Number(res.headers.get('retry-after'))
        retryNotBefore = Date.now() + (Number.isFinite(after) && after > 0 ? after * 1000 : 120_000)
      } else if (res.status === 400) {
        // Schema rejection: this batch can never succeed — discard it rather
        // than loop; the local dropped-count diagnostic notes the loss.
        await adapter.mutate((rows) => ({ ...ack(rows, { batchId: batch.batchId, owner: TAB_ID }), set: [['meta:dropped', ((rows.get('meta:dropped') as number) ?? 0) + 1]] }))
      } else {
        retryNotBefore = Date.now() + 120_000 + Math.random() * 60_000
      }
      return
    }
  } catch {
    /* telemetry must never interrupt timetable use */
  }
}

/** Local coarse diagnostics for the Settings data page (nothing is sent). */
export async function telemetryPending(): Promise<{ openSegments: number; claimedSegments: number; dropped: number }> {
  try {
    return (
      ((await adapter.mutate((rows) => ({ result: pendingSummary(rows) }))) as ReturnType<typeof pendingSummary>) ?? {
        openSegments: 0,
        claimedSegments: 0,
        dropped: 0,
      }
    )
  } catch {
    return { openSegments: 0, claimedSegments: 0, dropped: 0 }
  }
}
