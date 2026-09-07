import type { Session } from '../types'
import { resolveIdentity } from '../lib/identity'
import { loadCache } from '../lib/storage'
import { eventKey } from '../../shared/identity.js'
export function IdentityReview({session,profileId}:{session:Session;profileId:string}) {
  if (!session.identityCandidates?.length && !session.identityWarning) return null
  const history = loadCache(profileId)?.identityHistory ?? []
  return <section className="filter-section"><h3>Review this event’s identity</h3><p>{session.identityWarning || 'More than one saved event could match this row. Your older notes and photos remain separate until you choose.'}</p>
    {session.identityCandidates?.map(key => { const old = history.find(s => eventKey(s) === key); return <button className="btn-secondary" key={key} onClick={() => { if (!window.confirm('Link to this previous event? Its notes and photos will be shown here.')) return; try { resolveIdentity(profileId,session,key); window.location.reload() } catch(error) { window.alert(String(error)) } }}>{old ? `${old.dateISO} ${old.start} · ${old.title}` : key}</button> })}
    <p className="filter-hint">For reliable identity on every device and calendar, add a unique Event ID column to the source sheet and keep its value when rescheduling.</p></section>
}
