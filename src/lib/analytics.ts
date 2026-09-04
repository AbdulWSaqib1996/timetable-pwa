import { isIOS, isStandalone } from './platform'

/**
 * Anonymous usage ping, self-hosted on the push worker (no third-party
 * analytics). At most once per day, the app sends: a random device token
 * (generated locally, tied to nothing), whether it runs installed, a coarse
 * platform class, and the app version. No location, no identity, no sheet.
 * Off switch in Settings.
 */

const DEVICE_KEY = 'timetable.device.v1'
const LASTPING_KEY = 'timetable.lastping.v1'

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
    localStorage.setItem(LASTPING_KEY, today)
    await fetch(`${base.replace(/\/+$/, '')}/ping`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ d: id, i: isStandalone(), p: platform(), v: appVersion }),
    })
  } catch {
    /* best effort — never bothers the user */
  }
}
