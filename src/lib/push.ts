import { adminSummary } from './admin'
import type { Settings } from '../types'

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const normalised = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(normalised)
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)))
}

const trim = (base: string) => base.replace(/\/+$/, '')

/**
 * Subscribe this device to background push via the deployed push worker
 * (workers/push). The worker stores the subscription plus enough config to
 * compute reminders server-side.
 */
const CONFIG_SENT_KEY = 'timetable.pushcfg.v1'

export async function subscribePush(
  base: string,
  settings: Settings,
  profileId?: string,
  opts?: { force?: boolean }
): Promise<void> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    throw new Error('Background push isn’t supported in this browser.')
  }
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new Error('Notification permission was not granted.')
  const reg = await navigator.serviceWorker.ready
  const vapidRes = await fetch(`${trim(base)}/vapid`)
  if (!vapidRes.ok) throw new Error('Could not reach the push server.')
  const { publicKey } = (await vapidRes.json()) as { publicKey?: string }
  if (!publicKey) throw new Error('The push server returned no key.')
  const subscription = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey).buffer as ArrayBuffer,
  })
  const config = {
    // Owning profile for notification routing (P3-05).
    profileId,
    sheetId: settings.sheetId,
    gid: settings.gid,
    kdSheetId: settings.keyDatesSheetId,
    kdGid: settings.keyDatesGid,
    noticesSheetId: settings.noticesSheetId,
    noticesGid: settings.noticesGid,
    quietFrom: settings.quietFrom,
    quietTo: settings.quietTo,
    spec: settings.hideOtherSpecialisms !== false ? settings.mySpecialisms ?? [] : [],
    groups: settings.myGroups ?? [],
    reminderOffsets: settings.reminderOffsets ?? [],
    // Explicit reminder participation (P3-01): independent of display filters.
    remindOptional: settings.remindOptional !== false,
    attendancePrompts: settings.attendancePrompts === true,
    keyDateReminderDays: settings.keyDateReminderDays ?? [],
    travelMode: settings.travelMode ?? 'walking',
    briefing: settings.morningBriefing !== false,
    changeAlerts: settings.changeAlerts !== false,
    fridayDigest: settings.fridayDigest !== false,
    // Outstanding-admin counts for the Friday digest (as of the last app open).
    adminSummary: profileId ? adminSummary(profileId) : undefined,
    bgLeave: settings.bgLeaveAlerts === true,
    leaveAlertOffsets: settings.leaveAlertOffsets ?? [],
    // Placement details (school + geocoded coords) so the worker can name the
    // school in briefings/reminders and route background leave alerts to it.
    placements: Object.fromEntries(
      Object.entries(settings.placements ?? {})
        .filter(([, p]) => p.school || (p.lat != null && p.lng != null))
        .map(([tag, p]) => [tag, { school: p.school, lat: p.lat, lng: p.lng }])
    ),
    base: trim(base),
  }
  // Config re-syncs fire from several places (toggles, placement edits, admin
  // changes); skip the request entirely when nothing actually changed, so
  // Cloudflare only sees real updates. The explicit Enable button forces.
  const configHash = JSON.stringify(config)
  if (!opts?.force) {
    try {
      if (localStorage.getItem(CONFIG_SENT_KEY) === configHash) return
    } catch {
      /* storage unavailable — just send */
    }
  }
  const save = await fetch(`${trim(base)}/subscribe`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ subscription: subscription.toJSON(), config }),
  })
  if (!save.ok) throw new Error('The push server rejected the subscription.')
  try {
    localStorage.setItem(CONFIG_SENT_KEY, configHash)
  } catch {
    /* ignore */
  }
}

/**
 * Report the device's current location to the push worker (opt-in, for background
 * leave alerts). Throttled by the caller; stored against this device's subscription.
 */
export async function reportLocation(base: string, lat: number, lng: number): Promise<void> {
  if (!('serviceWorker' in navigator)) return
  const reg = await navigator.serviceWorker.ready
  const subscription = await reg.pushManager.getSubscription()
  if (!subscription) return
  await fetch(`${trim(base)}/location`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ endpoint: subscription.endpoint, lat, lng }),
  })
}

export const ATTENDANCE_REPORT_VERSION = 2

export type AttendanceReportResult =
  | { status: 'accepted' }
  /** no service worker / no subscription on this device — pending, never acknowledged */
  | { status: 'unavailable' }
  /** 429 / 5xx / network — keep pending and retry with backoff */
  | { status: 'retryable'; retryAfterMs: number; reason: string }
  /** 400 / 404 — a registration or contract problem that a retry will not fix */
  | { status: 'configuration'; reason: string }
  /** the worker holds a newer snapshot for this scope — re-read and resend */
  | { status: 'stale'; serverRev: number }

/** `navigator.serviceWorker.ready` never settles when no worker will ever control the page — bound it. */
function readyWithin(ms: number): Promise<ServiceWorkerRegistration | null> {
  return Promise.race([
    navigator.serviceWorker.ready.then((r) => r as ServiceWorkerRegistration | null),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ])
}

/** Non-reversible fingerprint of the push endpoint (identity for acknowledgements; never logged raw). */
export async function subscriptionFingerprint(): Promise<string | null> {
  if (!('serviceWorker' in navigator)) return null
  try {
    const reg = await readyWithin(3000)
    if (!reg) return null
    const subscription = await reg.pushManager.getSubscription()
    if (!subscription) return null
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(subscription.endpoint))
    return [...new Uint8Array(digest)].slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join('')
  } catch {
    return null
  }
}

/**
 * Tell the push worker which of ONE profile's sessions on ONE course day are
 * already answered (attended/absent), as an authoritative snapshot with a
 * revision, so its end-of-session "did you attend?" push stays silent for
 * them and a cleared answer becomes promptable again (FA-01/02/03). Keys
 * only — no notes, no attendance value. Only a 2xx is "accepted".
 */
export async function reportAttendanceMarks(
  base: string,
  report: { profileId: string; day: string; rev: number; keys: string[] }
): Promise<AttendanceReportResult> {
  if (!('serviceWorker' in navigator)) return { status: 'unavailable' }
  let endpoint: string
  try {
    const reg = await readyWithin(3000)
    if (!reg) return { status: 'unavailable' }
    const subscription = await reg.pushManager.getSubscription()
    if (!subscription) return { status: 'unavailable' }
    endpoint = subscription.endpoint
  } catch {
    return { status: 'unavailable' }
  }
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 15_000)
  try {
    const res = await fetch(`${trim(base)}/attendance`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ v: ATTENDANCE_REPORT_VERSION, endpoint, profileId: report.profileId, day: report.day, rev: report.rev, keys: report.keys.slice(0, 300) }),
      signal: ctrl.signal,
    })
    if (res.ok) {
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean }
      return json.ok === true ? { status: 'accepted' } : { status: 'configuration', reason: 'unexpected response' }
    }
    if (res.status === 409) {
      const json = (await res.json().catch(() => ({}))) as { rev?: number }
      return { status: 'stale', serverRev: Number(json.rev) || 0 }
    }
    if (res.status === 429 || res.status >= 500) {
      const after = Number(res.headers.get('retry-after'))
      return { status: 'retryable', retryAfterMs: Number.isFinite(after) && after > 0 ? after * 1000 : 60_000, reason: `HTTP ${res.status}` }
    }
    const json = (await res.json().catch(() => ({}))) as { error?: string }
    return { status: 'configuration', reason: json.error ?? `HTTP ${res.status}` }
  } catch (error) {
    return { status: 'retryable', retryAfterMs: 60_000, reason: (error as Error)?.name === 'AbortError' ? 'timed out' : 'network' }
  } finally {
    clearTimeout(t)
  }
}

export async function unsubscribePush(base: string): Promise<void> {
  if (!('serviceWorker' in navigator)) return
  const reg = await navigator.serviceWorker.ready
  const subscription = await reg.pushManager.getSubscription()
  if (!subscription) return
  try {
    await fetch(`${trim(base)}/unsubscribe`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ endpoint: subscription.endpoint }),
    })
  } catch {
    /* best effort */
  }
  await subscription.unsubscribe()
}
