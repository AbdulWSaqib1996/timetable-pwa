import type { Route } from './router'

/**
 * Safe navigation state (R1 / TT-08). Hash input is untrusted: a malformed
 * percent-escape, an oversized key or an unknown section must never blank
 * the app. Parsing returns a typed result the shell can render as "This link
 * could not be opened" while keeping Today/Schedule reachable. Nothing here
 * logs the raw hash — a session key can carry a title.
 */

export const MAX_SESSION_KEY_LENGTH = 512
export const SETTINGS_SECTIONS = ['timetable', 'calendars', 'reminders', 'travel', 'appearance', 'data', 'help'] as const
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number]

export type ParsedRoute =
  | { ok: true; route: Route; notice?: string }
  | { ok: false; reason: 'malformed' | 'oversized' | 'unknown' }

/** Decode a hash segment without ever throwing. */
export function safeDecode(segment: string): string | null {
  try {
    return decodeURIComponent(segment)
  } catch {
    return null
  }
}

export function parseRouteSafe(hash: string): ParsedRoute {
  const raw = typeof hash === 'string' ? hash : ''
  if (raw.length > 4096) return { ok: false, reason: 'oversized' }
  const parts = raw.replace(/^#\/?/, '').split('/')
  switch (parts[0]) {
    case '':
    case 'today':
      return { ok: true, route: { name: 'today' } }
    case 'schedule':
      return { ok: true, route: { name: 'schedule' } }
    case 'tasks':
      return { ok: true, route: { name: 'tasks' } }
    case 'pgce':
      return { ok: true, route: { name: 'pgce' } }
    case 'home':
      return { ok: true, route: { name: 'homeJourney' } }
    case 'placement':
      return { ok: true, route: { name: 'placement' } }
    case 'settings': {
      const section = parts[1] ? safeDecode(parts[1]) : null
      if (!parts[1]) return { ok: true, route: { name: 'settings' } }
      if (section && (SETTINGS_SECTIONS as readonly string[]).includes(section)) {
        return { ok: true, route: { name: 'settings', section } }
      }
      // Unknown section: land on the settings index with a small notice
      // instead of an empty page.
      return { ok: true, route: { name: 'settings' }, notice: 'That settings section does not exist — showing all settings.' }
    }
    case 'session': {
      if (!parts[1]) return { ok: true, route: { name: 'today' } }
      if (parts[1].length > MAX_SESSION_KEY_LENGTH * 3) return { ok: false, reason: 'oversized' }
      const key = safeDecode(parts.slice(1).join('/'))
      if (key === null) return { ok: false, reason: 'malformed' }
      if (key.length === 0 || key.length > MAX_SESSION_KEY_LENGTH) return { ok: false, reason: 'oversized' }
      return { ok: true, route: { name: 'session', key } }
    }
    default:
      return { ok: false, reason: 'unknown' }
  }
}

/**
 * Internal return context: Back from a detail should only go back when the
 * previous entry was OURS. `history.length > 1` also counts an external
 * referrer (a notification, a share link, another site), and "back" there
 * leaves the app. We record every in-app navigation instead.
 */
let internalDepth = 0

export function noteInternalNavigation(): void {
  internalDepth++
}

export function hasInternalPredecessor(): boolean {
  return internalDepth > 0
}

export function noteHistoryPop(): void {
  if (internalDepth > 0) internalDepth--
}

/** Test/reset hook. */
export function _resetNavigationState(): void {
  internalDepth = 0
}
