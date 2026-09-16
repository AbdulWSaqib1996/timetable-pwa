import { useState } from 'react'
import { Card, IconChevronLeft, PageHeader } from '../../components/ui'
import { newAdminId, placementLabel, placementSetupState, schoolOf } from '../../lib/admin'
import type { AdminFile, PlacementRec, PlacementTransitionRec } from '../../lib/admin'
import type { Settings } from '../../types'
import { geocodeAddress } from '../../lib/geocode'
import { TRANSITION_CONTEXT_MAX, TRANSITION_GROUPS, makeTransition, sharedPackIds, transitionItems, transitionProgress, withDeferral } from '../../../shared/transitions.js'

interface Props {
  /** the placement being prepared for */
  placement: PlacementRec
  /** the placement being left, when there is one (never written here) */
  fromPlacement?: PlacementRec
  admin: AdminFile
  settings: Settings
  todayISO: string
  onUpdateAdmin: (updater: (prev: AdminFile) => AdminFile) => void
  onJourney: (leg: 'out' | 'back') => void
  onEditPlacement: () => void
  onOpenMentorAccess: () => void
  onOpenTravelSettings: () => void
  onBack: () => void
}

const STATE_LABEL: Record<string, string> = { done: 'Done', todo: 'To do', stale: 'Needs another look', deferred: 'Not known yet' }

/**
 * Prepare for the next placement (audit E04, Pass 83). Four checklist groups
 * — School & travel, Teaching context, Mentor & access, Carry forward — each
 * re-derived from the canonical placement, school and review packs so a tick
 * goes stale when what it was about changes (the pin moves, a pack is
 * shared). Endpoints are previewed before the first school day; a return
 * destination can be saved FOR THIS PLACEMENT with the home address as the
 * labelled fallback. This page never writes to the placement being left,
 * never moves evidence and never changes mentor access — that stays an
 * explicit command in Settings.
 */
export function PlacementTransitionPage({ placement, fromPlacement, admin, settings, todayISO, onUpdateAdmin, onJourney, onEditPlacement, onOpenMentorAccess, onOpenTravelSettings, onBack }: Props) {
  const school = schoolOf(placement, admin.schools ?? [])
  const fromSchool = schoolOf(fromPlacement, admin.schools ?? [])
  const transition = (admin.transitions ?? []).find((t) => t.toPlacementId === placement.id)
  const hasHome = settings.homeLat != null && settings.homeLng != null
  const items = transitionItems(transition, { placement, school, reviewPacks: admin.reviewPacks ?? [], hasHome, defaultHours: settings.placementHours })
  const progress = transitionProgress(items)
  const ready = placementSetupState(placement, school) === 'ready'
  const pin = school && school.lat != null && school.lng != null ? { lat: school.lat, lng: school.lng } : null

  const [context, setContext] = useState(transition?.contextNote ?? '')
  const [firstDay, setFirstDay] = useState(transition?.confirmedStartISO ?? placement.startISO ?? '')
  const [carry, setCarry] = useState<string[]>(transition?.carryTargetIds ?? [])
  const [ret, setRet] = useState({ label: placement.returnPlace?.label ?? '', address: placement.returnPlace?.address ?? '' })
  const [deferDate, setDeferDate] = useState<Record<string, string>>({})
  /** NF-01: "not known yet" with a follow-up date — recorded on the transition, never blocking anything. */
  const defer = (itemId: string, on: boolean) =>
    onUpdateAdmin((prev) => {
      const list = prev.transitions ?? []
      const now = Date.now()
      const current = list.find((t) => t.toPlacementId === placement.id) ?? (makeTransition(fromPlacement?.id, placement.id, newAdminId(), now) as PlacementTransitionRec)
      const next = withDeferral(current, itemId, on ? { ...(deferDate[itemId] ? { followUpISO: deferDate[itemId] } : {}) } : null, now) as PlacementTransitionRec
      return { ...prev, transitions: list.some((t) => t.id === current.id) ? list.map((t) => (t.id === current.id ? next : t)) : [...list, next] }
    })
  const [retStatus, setRetStatus] = useState<'working' | 'fail' | null>(null)

  /** Upsert THIS placement's transition record; the record never copies placement fields. */
  const write = (patch: Partial<PlacementTransitionRec>) =>
    onUpdateAdmin((prev) => {
      const list = prev.transitions ?? []
      const now = Date.now()
      const current = list.find((t) => t.toPlacementId === placement.id) ?? (makeTransition(fromPlacement?.id, placement.id, newAdminId(), now) as PlacementTransitionRec)
      const next = { ...current, ...patch, at: now }
      return { ...prev, transitions: list.some((t) => t.id === current.id) ? list.map((t) => (t.id === current.id ? next : t)) : [...list, next] }
    })
  /** The ONLY write to a placement here, and only to the one being prepared. */
  const writeReturnPlace = (returnPlace: PlacementRec['returnPlace'] | undefined) =>
    onUpdateAdmin((prev) => ({
      ...prev,
      placements: (prev.placements ?? []).map((p) => {
        if (p.id !== placement.id) return p
        const next = { ...p, at: Date.now() }
        if (returnPlace) next.returnPlace = returnPlace
        else delete next.returnPlace
        return next
      }),
    }))

  const shared = (admin.reviewPacks ?? []).filter((p) => sharedPackIds([p]).length)
  const openTargets = admin.targets.filter((t) => t.status !== 'met')
  const item = (id: string) => items.find((i) => i.id === id)!
  const outwardOrigin = hasHome ? settings.homeAddress || 'Home' : 'Your location'
  const returnLabel = placement.returnPlace ? `${placement.returnPlace.label} (set for ${placement.code})` : hasHome ? 'Home — your saved home address (the fallback for every placement)' : 'No home address saved'

  const locateReturn = () => {
    const address = ret.address.trim()
    const label = ret.label.trim() || 'Return destination'
    if (!address) return
    setRetStatus('working')
    void geocodeAddress(address).then((located) => {
      if (!located) return setRetStatus('fail')
      writeReturnPlace({ label, address, lat: located.lat, lng: located.lng })
      setRetStatus(null)
    })
  }

  return (
    <div className="page page-pgce page-transition">
      <button type="button" className="page-back" onClick={onBack}>
        <IconChevronLeft size={18} /> All placements
      </button>
      <PageHeader title={`Prepare for ${placement.code}`} subtitle={fromPlacement ? `From ${placementLabel(fromPlacement, admin.schools ?? [])} to ${placementLabel(placement, admin.schools ?? [])}` : placementLabel(placement, admin.schools ?? [])} />
      <p className="pgce-active-state">
        <span className={`tag ${progress.complete && !progress.stale ? 'tag--ready' : 'tag--amber'}`} aria-label="Checklist progress">{progress.done} of {progress.total} done{progress.deferred ? ` · ${progress.deferred} not known yet` : ''}{progress.stale ? ` · ${progress.stale} need${progress.stale === 1 ? 's' : ''} another look` : ''}</span>
        {transition?.state === 'done' ? <span className="tag tag--ready">Marked ready</span> : null}
      </p>
      {fromPlacement ? (
        <p className="filter-hint">{fromPlacement.code}{fromSchool ? ` · ${fromSchool.name}` : ''} keeps everything recorded against it — its school, mentor, lessons and evidence stay as they are. Nothing here writes to it.</p>
      ) : null}

      <Card className="pgce-section">
        <h2 className="subheading">Journeys before the first day</h2>
        <ul className="notif-overview" aria-label="Journey endpoints">
          <li><strong>Outward</strong> — {outwardOrigin} → {school?.name ?? 'school not set up'}{school?.address ? `, ${school.address}` : ''}{pin ? '' : ' (no confirmed pin yet)'}</li>
          <li><strong>Return</strong> — {school?.name ?? 'school'} → {returnLabel}</li>
        </ul>
        <div className="btn-row">
          <button type="button" className="btn-today-reset" disabled={!ready} onClick={() => onJourney('out')}>Preview To school</button>
          <button type="button" className="btn-today-reset" disabled={!ready || (!hasHome && !placement.returnPlace)} onClick={() => onJourney('back')}>Preview Back home</button>
          <button type="button" className="btn-primary" disabled={!pin} onClick={() => write({ travelReviewed: { at: Date.now(), lat: pin!.lat, lng: pin!.lng } })}>
            {item('travel-reviewed').state === 'done' ? 'Journeys reviewed' : 'Mark journeys reviewed'}
          </button>
        </div>
        <details className="transition-return">
          <summary>Return destination for {placement.code}</summary>
          <p className="filter-hint">Optional — e.g. temporary accommodation near the school. Without one, Back home goes to your saved home address.</p>
          <div className="task-edit-row">
            <label className="ui-field"><span className="ui-field-label">Place name</span><input type="text" className="placement-input" value={ret.label} onChange={(e) => setRet({ ...ret, label: e.target.value })} /></label>
          </div>
          <label className="ui-field"><span className="ui-field-label">Address or postcode</span><input type="text" className="placement-input" value={ret.address} onChange={(e) => setRet({ ...ret, address: e.target.value })} /></label>
          <div className="btn-row">
            <button type="button" className="btn-today-reset" disabled={!ret.address.trim()} onClick={locateReturn}>Locate and save for {placement.code}</button>
            {placement.returnPlace ? <button type="button" className="travel-link" onClick={() => { writeReturnPlace(undefined); setRet({ label: '', address: '' }) }}>Use home instead</button> : null}
            {!hasHome ? <button type="button" className="travel-link" onClick={onOpenTravelSettings}>Set a home address</button> : null}
          </div>
          <p className="filter-hint" role={retStatus === 'fail' ? 'alert' : undefined}>
            {retStatus === 'working' ? 'Locating the address…' : retStatus === 'fail' ? 'That address could not be located.' : placement.returnPlace ? `Saved: ${placement.returnPlace.label}, ${placement.returnPlace.address ?? ''}` : 'Not set — home is used.'}
          </p>
        </details>
      </Card>

      {TRANSITION_GROUPS.map((g) => (
        <Card key={g.id} className="pgce-section transition-group">
          <h2 className="subheading">{g.label}</h2>
          <ul className="transition-items" aria-label={g.label}>
            {g.items.map((def) => {
              const it = item(def.id)
              return (
                <li key={def.id} className={`transition-item transition-item--${it.state}`} data-state={it.state}>
                  <div className="cycle-step-head">
                    <span>{def.label}</span>
                    <span className={`tag ${it.state === 'done' ? 'tag--ready' : it.state === 'deferred' ? '' : 'tag--amber'}`}>{STATE_LABEL[it.state]}</span>
                  </div>
                  <p className="filter-hint">{it.detail}</p>
                  {it.state !== 'done' && (
                    <div className="task-edit-row transition-defer">
                      {it.state === 'deferred' ? (
                        <button type="button" className="travel-link" onClick={() => defer(def.id, false)}>I know this now</button>
                      ) : (
                        <>
                          <input type="date" className="date-input" aria-label={`Follow up on: ${def.label}`} value={deferDate[def.id] ?? ''} onChange={(e) => setDeferDate({ ...deferDate, [def.id]: e.target.value })} />
                          <button type="button" className="travel-link" onClick={() => defer(def.id, true)}>Not known yet</button>
                        </>
                      )}
                    </div>
                  )}
                  {(def.id === 'school-confirmed' || def.id === 'hours-set' || def.id === 'mentor-recorded') && (
                    <div className="btn-row"><button type="button" className="travel-link" onClick={onEditPlacement}>Edit {placement.code} setup</button></div>
                  )}
                  {def.id === 'context-noted' && (
                    <label className="ui-field">
                      <span className="ui-field-label">Teaching context</span>
                      <textarea className="placement-input" rows={3} maxLength={TRANSITION_CONTEXT_MAX} value={context} onChange={(e) => setContext(e.target.value)} onBlur={() => { if (context !== (transition?.contextNote ?? '')) write({ contextNote: context }) }} placeholder="Year group, subjects, timetable pattern, routines you have been told about" />
                      <span className="filter-hint">Only what you have been told about the classes — never pupil names or details.</span>
                    </label>
                  )}
                  {def.id === 'shares-reviewed' && (
                    <>
                      {shared.length ? (
                        <ul className="workspace-list" aria-label="Packs shared with mentors">
                          {shared.map((p) => (
                            <li key={p.id} className="workspace-row"><strong>{p.title}</strong> <span className="filter-hint">· shared v{p.sharing!.revision} · {p.sharing!.mentorIds.length} mentor{p.sharing!.mentorIds.length === 1 ? '' : 's'}</span></li>
                          ))}
                        </ul>
                      ) : null}
                      <div className="btn-row">
                        <button type="button" className="btn-today-reset" onClick={() => write({ sharesReviewed: { at: Date.now(), packIds: sharedPackIds(admin.reviewPacks ?? []) } })}>Mark reviewed</button>
                        <button type="button" className="travel-link" onClick={onOpenMentorAccess}>Manage mentor access</button>
                      </div>
                      <p className="filter-hint">Ending or pausing a mentor's access is a separate, explicit step in Settings — nothing here changes it.</p>
                    </>
                  )}
                  {def.id === 'goals-chosen' && (
                    <>
                      {openTargets.length ? (
                        <ul className="workspace-list" aria-label="Open goals">
                          {openTargets.map((t) => (
                            <li key={t.id} className="workspace-row">
                              <label className="cycle-obs">
                                <input type="checkbox" checked={carry.includes(t.id)} onChange={(e) => setCarry(e.target.checked ? [...carry, t.id] : carry.filter((x) => x !== t.id))} aria-label={`Carry forward: ${t.text}`} />
                                <span>{t.text} <span className="filter-hint">· set {t.setISO}</span></span>
                              </label>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="filter-hint">No open goals to carry forward.</p>
                      )}
                      <div className="btn-row"><button type="button" className="btn-today-reset" onClick={() => write({ carryTargetIds: carry })}>Save carried-forward goals</button></div>
                      <p className="filter-hint">References only — the goals and any evidence stay attached to where they were set.</p>
                    </>
                  )}
                  {def.id === 'first-day' && (
                    <div className="task-edit-row">
                      <label className="ui-field"><span className="ui-field-label">First school day</span><input type="date" className="date-input" value={firstDay} min={todayISO < (placement.startISO ?? '') ? undefined : undefined} onChange={(e) => setFirstDay(e.target.value)} /></label>
                      <button type="button" className="btn-today-reset" disabled={!firstDay} onClick={() => write({ confirmedStartISO: firstDay })}>Confirm</button>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        </Card>
      ))}

      <div className="btn-row">
        {transition?.state === 'done' ? (
          <button type="button" className="btn-today-reset" onClick={() => write({ state: 'open', doneAt: undefined })}>Reopen checklist</button>
        ) : (
          <button type="button" className="btn-primary" disabled={!progress.complete || progress.stale > 0} onClick={() => write({ state: 'done', doneAt: Date.now() })}>Mark {placement.code} ready</button>
        )}
      </div>
    </div>
  )
}
