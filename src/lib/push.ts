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
export async function subscribePush(base: string, settings: Settings): Promise<void> {
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
    sheetId: settings.sheetId,
    gid: settings.gid,
    kdSheetId: settings.keyDatesSheetId,
    kdGid: settings.keyDatesGid,
    spec: settings.hideOtherSpecialisms !== false ? settings.mySpecialisms ?? [] : [],
    groups: settings.myGroups ?? [],
    reminderOffsets: settings.reminderOffsets ?? [],
    attendancePrompts: settings.attendancePrompts === true,
    keyDateReminderDays: settings.keyDateReminderDays ?? [],
    travelMode: settings.travelMode ?? 'walking',
    briefing: settings.morningBriefing !== false,
    changeAlerts: settings.changeAlerts !== false,
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
  const save = await fetch(`${trim(base)}/subscribe`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ subscription: subscription.toJSON(), config }),
  })
  if (!save.ok) throw new Error('The push server rejected the subscription.')
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
