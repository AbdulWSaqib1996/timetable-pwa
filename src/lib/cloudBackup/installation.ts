/**
 * Installation identity for cloud snapshots (R5b): a random id per
 * installation so retention only ever touches this device's own snapshots,
 * plus a coarse device label for the snapshot list. Neither identifies the
 * person; both live only on this device.
 */

const KEY = 'timetable.installation.v1'

export function installationId(): string {
  try {
    const existing = localStorage.getItem(KEY)
    if (existing && /^[a-f0-9]{32}$/.test(existing)) return existing
    const bytes = crypto.getRandomValues(new Uint8Array(16))
    const id = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
    localStorage.setItem(KEY, id)
    return id
  } catch {
    return 'unknown-installation'
  }
}

export function deviceLabel(): string {
  const ua = navigator.userAgent
  const device = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Macintosh/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'Device'
  const browser = /CriOS|Chrome/.test(ua) && !/Edg/.test(ua) ? 'Chrome' : /Edg/.test(ua) ? 'Edge' : /Firefox|FxiOS/.test(ua) ? 'Firefox' : /Safari/.test(ua) ? 'Safari' : 'Browser'
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches ? ' · installed' : ''
  return `${device} · ${browser}${standalone}`
}

/** Random opaque id for a snapshot — the provider-visible filename never carries a name. */
export function newBackupId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12))
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}
