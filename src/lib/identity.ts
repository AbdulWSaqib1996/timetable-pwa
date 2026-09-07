import { eventKey } from '../../shared/identity.js'
import { loadCache, loadMeta, saveCache } from './storage'
import type { Session } from '../types'
export function identityHistory(previous: Session[], fresh: Session[]): Session[] {
  const map = new Map(previous.map(s => [eventKey(s),s]))
  for (const s of fresh) map.set(eventKey(s),s)
  return [...map.values()]
}
/** Keep the previous owner, so photos, notes and reminder bookkeeping need no destructive migration. */
export function resolveIdentity(pid: string, session: Session, previousKey: string) {
  const cache = loadCache(pid)
  if (!cache) throw new Error('Refresh the timetable first.')
  const previous = cache.identityHistory?.find(s => eventKey(s) === previousKey)
  if (!previous || !session.identityCandidates?.includes(previousKey)) throw new Error('This candidate is no longer available. Refresh and retry.')
  const record = loadMeta(pid)[eventKey(session)]
  if (record && !record.deleted) throw new Error('This new event already has saved records. Export a backup and keep the records separate until you have reviewed both.')
  const resolved = { ...session, eventKey:previousKey, calendarUid:previous.calendarUid ?? previous.id, identityCandidates:[], identityAt:Date.now() }
  const replace = (s: Session) => s.id === session.id && s.sourceKey === session.sourceKey ? resolved : s
  saveCache(pid, { ...cache, sessions:cache.sessions.map(replace),keyDates:cache.keyDates?.map(replace),identityHistory:identityHistory(cache.identityHistory ?? [],[resolved]) })
}
