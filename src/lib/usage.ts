import { telemetryOpen, telemetryTrack } from './telemetry'

/**
 * Feature-use tracking facade (v2, A2): calls flow into the consent-gated
 * telemetry queue under their UTC observed date (counts only — never any
 * content). The legacy undated localStorage accumulator cannot be faithfully
 * assigned to past days, so it is DISCARDED on upgrade per the documented
 * migration (§7.3) — the v2 measurement start date marks the cutoff; nothing
 * is backdated.
 */

try {
  localStorage.removeItem('timetable.usage.v1')
  localStorage.removeItem('timetable.lastping.v2')
} catch {
  /* storage unavailable */
}

export function trackOpen(): void {
  telemetryOpen()
}

export function trackUse(feature: string): void {
  telemetryTrack(feature)
}
