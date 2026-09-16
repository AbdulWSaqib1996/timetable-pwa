import { useEffect, useMemo, useRef, useState } from 'react'
import { Dialog, Field, FieldGroup, IconClose } from './ui'
import { StaticMap } from './StaticMap'
import { geocodeAddress } from '../lib/geocode'
import { PLACEMENT_CODES, newAdminId, placementForTag, proposePlacementCode, savePlacementSetup } from '../lib/admin'
import type { PlacementCode, PlacementRec, PlacementSetupResult, SchoolLocationRec } from '../lib/admin'
import { locationCurrent, normaliseAddress, placementPolicy, validateWorkingHours } from '../lib/placement'
import { clearDraft, loadDraft, saveDraft } from '../lib/drafts'
import type { Settings } from '../types'

export interface PlacementMirror {
  tags: string[]
  school?: string
  address?: string
  mentor?: string
  lat?: number
  lng?: number
}

interface Props {
  code?: PlacementCode
  placementId?: string
  placements: PlacementRec[]
  schools: SchoolLocationRec[]
  settings: Settings
  blocks: { tag: string; total: number; attended: number }[]
  /** PL-02: drafts are kept per profile + placement (or new-draft id) */
  profileId?: string
  onSave: (next: PlacementSetupResult, mirror: PlacementMirror) => void
  /** PL-02: set the home address inline instead of leaving the flow */
  onSetHome?: (patch: Pick<Settings, 'homeAddress' | 'homeLat' | 'homeLng'>) => void
  onOpenSettings: () => void
  onClose: () => void
}

type Step = 'code' | 'school' | 'people' | 'pattern' | 'mapping'
const STEPS: { id: Step; label: string }[] = [
  { id: 'code', label: 'Placement' },
  { id: 'school', label: 'School' },
  { id: 'people', label: 'People & dates' },
  { id: 'pattern', label: 'Pattern & travel' },
  { id: 'mapping', label: 'Timetable' },
]
const DRAFT_KIND = 'placement-setup'
const GEOCODE_TIMEOUT_MS = 15_000

/** Everything the learner has typed, kept as one draft (PL-02). */
interface FlowDraft {
  step: Step
  placement: PlacementRec
  school: SchoolLocationRec | null
  tags: string[]
  tagsTouched: boolean
  hoursOn: boolean
}

const fmtTime = (ms: number) => new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
const toMins = (t: string) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t)
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
}
const hhmm = (m: number) => {
  const wrapped = ((m % 1440) + 1440) % 1440
  return `${String(Math.floor(wrapped / 60)).padStart(2, '0')}:${String(wrapped % 60).padStart(2, '0')}`
}

/**
 * School setup flow (PG-07A, G1a; placement review Batch 1, Pass 86): choose
 * the placement → school + confirm the map pin → people and dates → working
 * pattern and travel → preview the source-block mapping → save. Saving touches
 * only this placement and its school record. Batch 1 rules: the location is a
 * revisioned object — a changed address drops the old pin and its confirmation
 * (PL-01), and a late geocode reply for another address is ignored; every edit
 * is a resumable draft, so a Settings detour, a reload or Cancel never loses
 * work without asking (PL-02); a changed placement code regenerates the tag
 * proposals unless the learner already edited them (PL-04); a school day must
 * end after it starts (PL-05); the return-destination action is a real button
 * with its own name (UX-02).
 */
export function PlacementSetupFlow({ code, placementId, placements, schools, settings, blocks, profileId, onSave, onSetHome, onOpenSettings, onClose }: Props) {
  const existing = useMemo(
    () => (placementId ? placements.find((p) => p.id === placementId) : code ? placements.find((p) => p.code === code) : undefined),
    [placementId, code, placements]
  )
  const existingSchool = existing?.schoolLocationId ? schools.find((s) => s.id === existing.schoolLocationId) : undefined
  const policy = placementPolicy(settings)
  const proposalsFor = (c: string, current: string) => blocks.map((b) => b.tag).filter((t) => proposePlacementCode(t) === c && !(placementForTag(placements, t) && placementForTag(placements, t)!.id !== current))
  const fresh = (): FlowDraft => {
    const placement: PlacementRec = existing ?? { id: newAdminId(), code: code ?? 'SE1', mappedBlockTags: [], at: 0 }
    return { step: existing ? 'school' : 'code', placement, school: existingSchool ?? null, tags: existing ? existing.mappedBlockTags : proposalsFor(placement.code, placement.id), tagsTouched: !!existing, hoursOn: !!existing?.workingHours }
  }
  const initial = useMemo(fresh, []) // eslint-disable-line react-hooks/exhaustive-deps
  const draftId = initial.placement.id
  const baseRevision = existing?.at ?? 0
  const pending = useMemo(() => (profileId ? loadDraft<FlowDraft>(profileId, DRAFT_KIND, draftId) : null), [profileId, draftId])
  const [offer, setOffer] = useState<{ savedAt: number; base: number; value: FlowDraft } | null>(pending && pending.value && pending.value.placement ? { savedAt: pending.savedAt, base: pending.baseRevision, value: pending.value } : null)

  const [step, setStep] = useState<Step>(initial.step)
  const [placement, setPlacement] = useState<PlacementRec>(initial.placement)
  const [school, setSchool] = useState<SchoolLocationRec | null>(initial.school)
  const [tags, setTags] = useState<string[]>(initial.tags)
  const [tagsTouched, setTagsTouched] = useState(initial.tagsTouched)
  const [hoursOn, setHoursOn] = useState(initial.hoursOn)
  const [geo, setGeo] = useState<'idle' | 'working' | 'ok' | 'fail' | 'timeout'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [hoursError, setHoursError] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [codeChoice, setCodeChoice] = useState<PlacementCode | null>(null)
  const [draftState, setDraftState] = useState<'none' | 'saved' | 'failed'>('none')
  const [home, setHome] = useState({ address: settings.homeAddress ?? '', status: 'idle' as 'idle' | 'working' | 'fail' })
  const geoRequest = useRef(0)

  // PL-02: every change becomes a draft (a failed write is named, never claimed as saved).
  useEffect(() => {
    if (!profileId || !dirty) return
    const ok = saveDraft<FlowDraft>(profileId, DRAFT_KIND, draftId, baseRevision, { step, placement, school, tags, tagsTouched, hoursOn })
    setDraftState(ok ? 'saved' : 'failed')
  }, [profileId, draftId, baseRevision, dirty, step, placement, school, tags, tagsTouched, hoursOn])

  const resumeDraft = () => {
    if (!offer) return
    const v = offer.value
    setStep(v.step)
    setPlacement(v.placement)
    setSchool(v.school)
    setTags(v.tags)
    setTagsTouched(v.tagsTouched)
    setHoursOn(v.hoursOn)
    setDirty(true)
    setOffer(null)
  }
  const discardDraft = () => {
    if (profileId) clearDraft(profileId, DRAFT_KIND, draftId)
    setOffer(null)
  }

  const patch = (p: Partial<PlacementRec>) => {
    setDirty(true)
    setPlacement((x) => ({ ...x, ...p }))
  }
  const patchSchool = (p: Partial<SchoolLocationRec>) => {
    setDirty(true)
    setSchool((s) => ({ ...(s ?? { id: newAdminId(), name: '', at: 0 }), ...p }))
  }
  /** PL-01: a meaningful address change invalidates the pin and its confirmation; a name change does not. */
  const setAddress = (address: string) => {
    setDirty(true)
    setSchool((s) => {
      const base = s ?? { id: newAdminId(), name: '', at: 0 }
      const same = normaliseAddress(address) === normaliseAddress(base.locatedFor ?? base.address)
      if (same || base.lat == null) return { ...base, address }
      const next: SchoolLocationRec = { ...base, address }
      delete next.lat
      delete next.lng
      delete next.confirmedAt
      delete next.locatedFor
      return next
    })
    setGeo('idle')
  }
  const pinStale = !!school && school.lat != null && !locationCurrent(school)

  const idx = STEPS.findIndex((s) => s.id === step)
  const homeSet = settings.homeLat != null && settings.homeLng != null

  /** PL-01: tagged, timed geocode — a reply for another address or an older request is ignored. */
  async function locate() {
    const address = school?.address?.trim()
    if (!address) return
    const id = ++geoRequest.current
    const wanted = normaliseAddress(address)
    setGeo('working')
    const timeout = new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), GEOCODE_TIMEOUT_MS))
    const found = await Promise.race([geocodeAddress(address), timeout])
    if (id !== geoRequest.current) return
    if (found === 'timeout') {
      setGeo('timeout')
      return
    }
    const usable = !!found && Number.isFinite(found.lat) && Number.isFinite(found.lng) && Math.abs(found.lat) <= 90 && Math.abs(found.lng) <= 180
    let applied = false
    setSchool((s) => {
      // The address may have changed while the request was in flight — then this reply is for another place.
      if (!s || normaliseAddress(s.address) !== wanted || !usable) return s
      applied = true
      const next: SchoolLocationRec = { ...s, lat: found!.lat, lng: found!.lng, locatedFor: s.address }
      delete next.confirmedAt
      return next
    })
    if (applied) setDirty(true)
    setGeo(usable ? 'ok' : 'fail')
  }

  async function locateHome() {
    const address = home.address.trim()
    if (!address || !onSetHome) return
    setHome({ ...home, status: 'working' })
    const found = await Promise.race([geocodeAddress(address), new Promise<null>((resolve) => setTimeout(() => resolve(null), GEOCODE_TIMEOUT_MS))])
    if (!found) {
      setHome((h) => ({ ...h, status: 'fail' }))
      return
    }
    onSetHome({ homeAddress: address, homeLat: found.lat, homeLng: found.lng })
    setHome({ address, status: 'idle' })
  }

  const hoursCheck = () => (hoursOn ? validateWorkingHours(placement.workingHours) : null)

  function next() {
    setError(null)
    if (step === 'code' && placements.some((p) => p.code === placement.code && p.id !== placement.id)) {
      setError(`${placement.code} is already set up — open it from the PGCE file to edit it.`)
      return
    }
    if (step === 'people' && placement.startISO && placement.endISO && placement.endISO < placement.startISO) {
      setError('The placement must end after it starts.')
      return
    }
    if (step === 'pattern') {
      const he = hoursCheck()
      setHoursError(he)
      if (he) return
    }
    setStep(STEPS[Math.min(idx + 1, STEPS.length - 1)].id)
  }

  /** PL-04: changing the code regenerates untouched proposals; edited links are a deliberate choice. */
  const changeCode = (c: PlacementCode) => {
    if (c === placement.code) return
    if (!tagsTouched) {
      patch({ code: c })
      setTags(proposalsFor(c, placement.id))
      return
    }
    setCodeChoice(c)
  }

  function save() {
    setError(null)
    if (placement.startISO && placement.endISO && placement.endISO < placement.startISO) {
      setError('The placement must end after it starts.')
      return
    }
    const he = hoursCheck()
    if (he) {
      setHoursError(he)
      setStep('pattern')
      return
    }
    const cleanSchool = school && school.name.trim() ? { ...school, name: school.name.trim() } : null
    if (cleanSchool && !locationCurrent(cleanSchool)) {
      // Never save coordinates that belong to another address.
      delete cleanSchool.lat
      delete cleanSchool.lng
      delete cleanSchool.confirmedAt
      delete cleanSchool.locatedFor
    }
    const rec: PlacementRec = { ...placement, mappedBlockTags: [...tags].sort(), schoolLocationId: cleanSchool?.id }
    if (!rec.schoolLocationId) delete rec.schoolLocationId
    if (!hoursOn) delete rec.workingHours
    for (const k of ['mentorName', 'mentorContact', 'notes', 'startISO', 'endISO', 'label'] as const) if (!rec[k]) delete rec[k]
    const next = savePlacementSetup({ placements, schools }, rec, cleanSchool)
    if (profileId) clearDraft(profileId, DRAFT_KIND, draftId)
    onSave(next, {
      tags: rec.mappedBlockTags,
      school: cleanSchool?.name,
      address: cleanSchool?.address,
      mentor: rec.mentorName,
      lat: cleanSchool?.confirmedAt ? cleanSchool.lat : undefined,
      lng: cleanSchool?.confirmedAt ? cleanSchool.lng : undefined,
    })
  }

  const cancel = () => {
    if (dirty && profileId && !confirmCancel) {
      setConfirmCancel(true)
      return
    }
    onClose()
  }
  const arrivalPreview = (() => {
    const start = toMins(hoursOn ? placement.workingHours?.start ?? policy.start : policy.start)
    if (start === null) return null
    const buffer = placement.arrivalBufferMins ?? settings.arrivalBufferMins ?? 10
    return hhmm(start - buffer)
  })()
  const mappedDays = blocks.filter((b) => tags.includes(b.tag)).reduce((n, b) => n + b.total, 0)
  const addressChangedFromSaved = !!existingSchool && existingSchool.lat != null && !!school && normaliseAddress(school.address) !== normaliseAddress(existingSchool.locatedFor ?? existingSchool.address)

  return (
    <Dialog label={`Set up ${placement.code}`} onClose={cancel} className="sheet-placement-flow">
      <div className="sheet-header">
        <h2>{existing ? `Edit ${placement.code}` : `Set up ${placement.code}`}</h2>
        <button type="button" className="icon-btn" aria-label="Close" onClick={cancel}>
          <IconClose />
        </button>
      </div>
      {offer && (
        <div className="callout callout--amber" role="group" aria-label="Unsaved changes">
          <p>
            You have unsaved changes to {placement.code} from {fmtTime(offer.savedAt)}.
            {offer.base !== baseRevision ? ' The saved placement changed since then (another device, perhaps) — resuming shows your draft over the newer values.' : ''}
          </p>
          <div className="btn-row">
            <button type="button" className="btn-primary" onClick={resumeDraft}>Resume draft</button>
            <button type="button" className="btn-today-reset" onClick={discardDraft}>Discard draft</button>
          </div>
        </div>
      )}
      <ol className="setup-steps" aria-label="Setup steps">
        {STEPS.map((s, i) => (
          <li key={s.id} className={s.id === step ? 'is-current' : i < idx ? 'is-done' : ''} aria-current={s.id === step ? 'step' : undefined}>
            {s.label}
          </li>
        ))}
      </ol>

      {step === 'code' && (
        <>
          <Field label="Which placement?">
            <select className="date-input" value={placement.code} onChange={(e) => changeCode(e.target.value as PlacementCode)} disabled={!!existing}>
              {PLACEMENT_CODES.map((c) => (
                <option key={c} value={c}>
                  {c}
                  {placements.some((p) => p.code === c && p.id !== placement.id) ? ' (already set up)' : ''}
                </option>
              ))}
            </select>
          </Field>
          {codeChoice && (
            <div className="callout callout--amber" role="group" aria-label="Timetable links">
              <p>You changed the placement to {codeChoice} after editing its timetable links. Replace them with {codeChoice}'s suggested blocks, or keep the links you chose?</p>
              <div className="btn-row">
                <button type="button" className="btn-primary" onClick={() => { patch({ code: codeChoice }); setTags(proposalsFor(codeChoice, placement.id)); setTagsTouched(false); setCodeChoice(null) }}>Replace suggestions</button>
                <button type="button" className="btn-today-reset" onClick={() => { patch({ code: codeChoice }); setCodeChoice(null) }}>Keep my links</button>
              </div>
            </div>
          )}
          <p className="filter-hint">Your placements are recorded as SE1, SE2 and SE3. Your timetable's blocks (SE1A, SE1B…) are mapped in the last step.</p>
        </>
      )}

      {step === 'school' && (
        <>
          <Field label="School name">
            <input type="text" className="placement-input" value={school?.name ?? ''} onChange={(e) => patchSchool({ name: e.target.value })} />
          </Field>
          <Field label="Address" hint="Add the postcode for the best match, then locate and confirm the pin.">
            <input type="text" className="placement-input" value={school?.address ?? ''} onChange={(e) => setAddress(e.target.value)} />
          </Field>
          <div className="btn-row">
            <button type="button" className="btn-secondary" onClick={() => void locate()} disabled={!school?.address?.trim() || geo === 'working'}>
              {geo === 'working' ? 'Locating…' : school?.lat != null ? 'Locate again' : geo === 'fail' || geo === 'timeout' ? 'Retry locating' : 'Locate on map'}
            </button>
          </div>
          {geo === 'fail' && <p className="filter-hint" role="alert">Couldn't locate that address — try adding the postcode, or check your connection.</p>}
          {geo === 'timeout' && <p className="filter-hint" role="alert">Locating took too long — check your connection and retry.</p>}
          {school?.lat != null && school.lng != null ? (
            <div className="pin-confirm">
              <StaticMap lat={school.lat} lng={school.lng} label={school.name || 'School'} address={school.address} />
              {school.confirmedAt && !pinStale ? (
                <p className="filter-hint saved-line">
                  Pin confirmed {new Date(school.confirmedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} — journeys use this location.
                </p>
              ) : (
                <div className="callout callout--amber">
                  <p>Is this pin on the school? Check the map, then confirm — journeys and reminders will use it.</p>
                  <button type="button" className="btn-primary" onClick={() => patchSchool({ confirmedAt: Date.now(), locatedFor: school.locatedFor ?? school.address })}>
                    Confirm this pin
                  </button>
                </div>
              )}
            </div>
          ) : (
            <p className="filter-hint" role="status">
              {addressChangedFromSaved
                ? 'The address changed, so the old pin no longer applies — locate and confirm the pin again. Until then the placement shows “School details incomplete” and journeys use no location.'
                : 'No pin yet. Until a pin is confirmed the placement shows “School details incomplete” and journeys are not offered.'}
            </p>
          )}
          <Field label="Entrance note (optional)" hint="Which gate or reception to use — shown before you leave.">
            <input type="text" className="placement-input" value={school?.entranceNote ?? ''} onChange={(e) => patchSchool({ entranceNote: e.target.value })} />
          </Field>
        </>
      )}

      {step === 'people' && (
        <>
          <Field label="Mentor">
            <input type="text" className="placement-input" value={placement.mentorName ?? ''} onChange={(e) => patch({ mentorName: e.target.value })} />
          </Field>
          <Field label="Mentor contact (optional)">
            <input type="text" className="placement-input" value={placement.mentorContact ?? ''} onChange={(e) => patch({ mentorContact: e.target.value })} />
          </Field>
          <div className="task-edit-row">
            <Field label="Starts">
              <input type="date" className="date-input" value={placement.startISO ?? ''} onChange={(e) => patch({ startISO: e.target.value })} />
            </Field>
            <Field label="Ends">
              <input type="date" className="date-input" value={placement.endISO ?? ''} onChange={(e) => patch({ endISO: e.target.value })} />
            </Field>
          </div>
          <Field label="Notes (optional)">
            <textarea className="placement-input" rows={3} value={placement.notes ?? ''} onChange={(e) => patch({ notes: e.target.value })} />
          </Field>
        </>
      )}

      {step === 'pattern' && (
        <>
          <label className="toggle-row">
            <input type="checkbox" checked={hoursOn} onChange={(e) => { setDirty(true); setHoursOn(e.target.checked); setHoursError(null); if (e.target.checked && !placement.workingHours) patch({ workingHours: { start: policy.start, end: policy.end } }) }} />
            Different hours for this placement (default {policy.start}–{policy.end})
          </label>
          {hoursOn && (
            <div className="task-edit-row">
              <Field label="Day starts">
                <input type="time" className="date-input" value={placement.workingHours?.start ?? policy.start} aria-invalid={hoursError ? true : undefined} onChange={(e) => { setHoursError(null); patch({ workingHours: { start: e.target.value || policy.start, end: placement.workingHours?.end ?? policy.end } }) }} />
              </Field>
              <Field label="Day ends">
                <input type="time" className="date-input" value={placement.workingHours?.end ?? policy.end} aria-invalid={hoursError ? true : undefined} onChange={(e) => { setHoursError(null); patch({ workingHours: { start: placement.workingHours?.start ?? policy.start, end: e.target.value || policy.end } }) }} />
              </Field>
            </div>
          )}
          {hoursError && <p className="setup-error" role="alert">{hoursError}</p>}
          <Field label="Arrive early by (minutes)" hint={`Default ${settings.arrivalBufferMins ?? 10} min from Settings → Travel.${arrivalPreview ? ` Effective arrival: ${arrivalPreview}.` : ''}`}>
            <input type="number" className="date-input" min={0} max={180} value={placement.arrivalBufferMins ?? ''} placeholder={String(settings.arrivalBufferMins ?? 10)} onChange={(e) => patch({ arrivalBufferMins: e.target.value === '' ? undefined : Math.max(0, Math.min(180, parseInt(e.target.value, 10) || 0)) })} />
          </Field>
          <label className="toggle-row">
            <input type="checkbox" checked={placement.insetCountsAsSchoolDay ?? policy.insetCounts} onChange={(e) => patch({ insetCountsAsSchoolDay: e.target.checked })} />
            Inset days count as school days here (default {policy.insetCounts ? 'yes' : 'no'})
          </label>
          {/* UX-02: descriptive text plus buttons live in a group, not a label. */}
          <FieldGroup label="Return destination">
            <p className="filter-hint">
              {homeSet ? `Home${settings.homeAddress ? ` · ${settings.homeAddress}` : ''}` : 'No home saved — add your home address here to plan the journey back.'}
            </p>
            {!homeSet && onSetHome && (
              <div className="task-edit-row">
                <input type="text" className="placement-input" aria-label="Home address" placeholder="Home address or postcode" value={home.address} onChange={(e) => setHome({ ...home, address: e.target.value })} />
                <button type="button" className="btn-today-reset" disabled={!home.address.trim() || home.status === 'working'} onClick={() => void locateHome()}>
                  {home.status === 'working' ? 'Locating…' : 'Set return destination'}
                </button>
              </div>
            )}
            {home.status === 'fail' && <p className="filter-hint" role="alert">Couldn't locate that address — add the postcode and retry.</p>}
            <p className="filter-hint">
              <button type="button" className="travel-link" onClick={onOpenSettings}>Open Settings → Travel & home</button> — your changes here are kept as a draft and offered again when you come back.
            </p>
          </FieldGroup>
        </>
      )}

      {step === 'mapping' && (
        <>
          <p className="filter-hint">Which timetable blocks belong to {placement.code}? Sessions in these blocks show “{placement.code} · {school?.name || 'school'}” and count toward its school days.</p>
          {blocks.length === 0 ? (
            <p className="filter-hint">No placement blocks in your timetable yet — you can map them later.</p>
          ) : (
            <ul className="setup-list" aria-label="Timetable blocks">
              {blocks.map((b) => {
                const other = placementForTag(placements, b.tag)
                const takenElsewhere = other && other.id !== placement.id
                return (
                  <li key={b.tag} className="setup-row">
                    <label className="toggle-row">
                      <input
                        type="checkbox"
                        checked={tags.includes(b.tag)}
                        disabled={!!takenElsewhere}
                        onChange={(e) => { setDirty(true); setTagsTouched(true); setTags((t) => (e.target.checked ? [...t, b.tag] : t.filter((x) => x !== b.tag))) }}
                      />
                      <span>
                        <strong>{b.tag}</strong>
                        <span className="filter-hint">
                          {' '}
                          · {b.total} school day{b.total === 1 ? '' : 's'}
                          {takenElsewhere ? ` · mapped to ${other!.code} — open ${other!.code} to release it first` : proposePlacementCode(b.tag) === placement.code && !tags.includes(b.tag) ? ' · proposed' : ''}
                        </span>
                      </span>
                    </label>
                  </li>
                )
              })}
            </ul>
          )}
          <p className="filter-hint" role="status">Saving links {tags.length} block{tags.length === 1 ? '' : 's'} ({mappedDays} school day{mappedDays === 1 ? '' : 's'}) to {placement.code}{school?.name ? ` · ${school.name}` : ''}{school && school.lat != null && school.confirmedAt && !pinStale ? '' : ' — location still needs confirmation'}.</p>
        </>
      )}

      {error && (
        <p className="setup-error" role="alert">
          {error}
        </p>
      )}
      {draftState === 'failed' && <p className="setup-error" role="alert">Your changes could not be kept as a draft on this device — finish and save, or they will be lost if you leave.</p>}
      {confirmCancel && (
        <div className="callout callout--amber" role="group" aria-label="Unsaved changes">
          <p>Keep your unsaved changes as a draft, or discard them? Nothing saved changes either way.</p>
          <div className="btn-row">
            <button type="button" className="btn-primary" onClick={onClose}>Keep draft</button>
            <button type="button" className="btn-today-reset" onClick={() => { if (profileId) clearDraft(profileId, DRAFT_KIND, draftId); onClose() }}>Discard</button>
            <button type="button" className="btn-ghost" onClick={() => setConfirmCancel(false)}>Continue editing</button>
          </div>
        </div>
      )}
      <div className="btn-row setup-nav">
        {idx > 0 && (
          <button type="button" className="btn-today-reset" onClick={() => setStep(STEPS[idx - 1].id)}>
            Back
          </button>
        )}
        {step !== 'mapping' ? (
          <button type="button" className="btn-primary" onClick={next}>
            Next
          </button>
        ) : (
          <button type="button" className="btn-primary" onClick={save}>
            Save placement
          </button>
        )}
        <button type="button" className="btn-ghost" onClick={cancel}>
          Cancel
        </button>
        {dirty && profileId && draftState === 'saved' ? <span className="filter-hint">Draft kept on this device</span> : null}
      </div>
    </Dialog>
  )
}
