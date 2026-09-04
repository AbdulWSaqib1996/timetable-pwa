import { isIOS, isStandalone } from './platform'

/**
 * Anonymous usage ping, self-hosted on the push worker (no third-party
 * analytics). At most once per day, the app sends: a random device token
 * (generated locally, tied to nothing), whether it runs installed, a coarse
 * platform class, and the app version. No location, no identity, no sheet.
 * Off switch in Settings.
 */

const DEVICE_KEY = 'timetable.device.v1'
// v2: v1 marked the day as pinged BEFORE sending, so one failed request
// silenced the ping for the whole day. v2 only marks after a 2xx response.
const LASTPING_KEY = 'timetable.lastping.v2'

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

export async function maybePing(base: string, appVersion: number): Promise<void> {
  try {
    const id = deviceId()
    if (!id) return
    const today = new Date().toISOString().slice(0, 10)
    if (localStorage.getItem(LASTPING_KEY) === today) return
    const res = await fetch(`${base.replace(/\/+$/, '')}/ping`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ d: id, i: isStandalone(), p: platform(), v: appVersion }),
    })
    // Only mark the day done on success — a failed attempt retries on the
    // next open/resume instead of going silent until tomorrow.
    if (res.ok) localStorage.setItem(LASTPING_KEY, today)
  } catch {
    /* best effort — never bothers the user; retried on next open */
  }
}

/** The last day a ping was confirmed sent from this device (yyyy-mm-dd), or null. */
export function lastPingDate(): string | null {
  try {
    return localStorage.getItem(LASTPING_KEY)
  } catch {
    return null
  }
}
