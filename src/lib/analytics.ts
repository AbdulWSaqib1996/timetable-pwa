import { isIOS, isStandalone } from './platform'
import { flushTelemetry } from './telemetry'
import type { TelemetryContext } from './telemetry'

/**
 * Anonymous usage reporting, self-hosted on the push worker (no third-party
 * analytics). v2 (A2): coarse counters accumulate in a local transactional
 * queue under their UTC observed date and travel as immutable batches that
 * the worker deduplicates — a failed or repeated send can neither lose nor
 * double-count a day. The payload stays coarse: a random browser token
 * (tied to nothing), standalone mode, platform class, build id and known
 * setup flags. No location, no identity, no sheet. Off switch in Settings.
 */

const DEVICE_KEY = 'timetable.device.v1'

function deviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_KEY)
    if (!id) {
      id = [...crypto.getRandomValues(new Uint8Array(9))].map((b) => b.toString(16).padStart(2, '0')).join('')
      localStorage.setItem(DEVICE_KEY, id)
    }
    return id
  } catch {
    return ''
  }
}

function platform(): string {
  if (isIOS()) return 'ios'
  if (/Android/i.test(navigator.userAgent)) return 'android'
  return 'desktop'
}

/** Coarse setup-adoption flags (booleans only), computed by the caller from settings. */
export interface SetupFlags {
  push: boolean
  location: boolean
  home: boolean
  keyDates: boolean
  sync: boolean
  placements: boolean
}

/** Flush pending telemetry batches (consent-gated inside; safe to call often). */
export async function sendTelemetry(base: string, setup: SetupFlags): Promise<void> {
  const context: TelemetryContext = { standalone: isStandalone(), platform: platform(), setup: { ...setup } }
  await flushTelemetry(base, deviceId(), context)
}
