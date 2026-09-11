import { useMemo, useState } from 'react'
import { Dialog, Field, IconClose } from './ui'
import { StaticMap } from './StaticMap'
import { geocodeAddress } from '../lib/geocode'
import { PLACEMENT_CODES, newAdminId, placementForTag, proposePlacementCode, savePlacementSetup } from '../lib/admin'
import type { PlacementCode, PlacementRec, PlacementSetupResult, SchoolLocationRec } from '../lib/admin'
import { placementPolicy } from '../lib/placement'
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
  onSave: (next: PlacementSetupResult, mirror: PlacementMirror) => void
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

/**
 * School setup flow (PG-07A, G1a): choose the placement → school + confirm the
 * map pin → people and dates → working pattern and travel preferences (with the
 * profile defaults visible) → preview the source-block mapping → save. Saving
 * touches only this placement and its school record — the other placements are
 * the same objects afterwards. An address alone is never "verified": the pin
 * must be confirmed by the learner before journeys are offered.
 */
export function PlacementSetupFlow({ code, placementId, placements, schools, settings, blocks, onSave, onOpenSettings, onClose }: Props) {
  const existing = useMemo(
    () => (placementId ? placements.find((p) => p.id === placementId) : code ? placements.find((p) => p.code === code) : undefined),
    [placementId, code, placements]
  )
  const existingSchool = existing?.schoolLocationId ? schools.find((s) => s.id === existing.schoolLocationId) : undefined
  const policy = placementPolicy(settings)
  const [step, setStep] = useState<Step>(existing ? 'school' : 'code')
  const [placement, setPlacement] = useState<PlacementRec>(
    () =>
      existing ?? {
        id: newAdminId(),
        code: code ?? 'SE1',
        mappedBlockTags: [],
        at: 0,
      }
  )
  const [school, setSchool] = useState<SchoolLocationRec | null>(existingSchool ?? null)
  const [geo, setGeo] = useState<'idle' | 'working' | 'ok' | 'fail'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [hoursOn, setHoursOn] = useState(!!existing?.workingHours)
  // Mapping preview: this placement's tags plus, for a new placement, the prefix proposals.
  const [tags, setTags] = useState<string[]>(() => {
    if (existing) return existing.mappedBlockTags
    return blocks.map((b) => b.tag).filter((t) => proposePlacementCode(t) === (code ?? 'SE1') && !placementForTag(placements, t))
  })

  const patch = (p: Partial<PlacementRec>) => setPlacement((x) => ({ ...x, ...p }))
  const patchSchool = (p: Partial<SchoolLocationRec>) =>
    setSchool((s) => ({ ...(s ?? { id: newAdminId(), name: '', at: 0 }), ...p }))

  const idx = STEPS.findIndex((s) => s.id === step)
  const homeSet = settings.homeLat != null && settings.homeLng != null

  async function locate() {
    if (!school?.address?.trim()) return
    setGeo('working')
    const found = await geocodeAddress(school.address)
    if (found) {
      patchSchool({ lat: found.lat, lng: found.lng, confirmedAt: undefined })
      setGeo('ok')
    } else setGeo('fail')
  }

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
    setStep(STEPS[Math.min(idx + 1, STEPS.length - 1)].id)
  }

  function save() {
    setError(null)
    if (placement.startISO && placement.endISO && placement.endISO < placement.startISO) {
      setError('The placement must end after it starts.')
      return
    }
    const cleanSchool = school && school.name.trim() ? { ...school, name: school.name.trim() } : null
    const rec: PlacementRec = { ...placement, mappedBlockTags: [...tags].sort(), schoolLocationId: cleanSchool?.id }
    if (!rec.schoolLocationId) delete rec.schoolLocationId
    if (!hoursOn) delete rec.workingHours
    for (const k of ['mentorName', 'mentorContact', 'notes', 'startISO', 'endISO', 'label'] as const) if (!rec[k]) delete rec[k]
    const next = savePlacementSetup({ placements, schools }, rec, cleanSchool)
    onSave(next, {
      tags: rec.mappedBlockTags,
      school: cleanSchool?.name,
      address: cleanSchool?.address,
      mentor: rec.mentorName,
      lat: cleanSchool?.confirmedAt ? cleanSchool.lat : undefined,
      lng: cleanSchool?.confirmedAt ? cleanSchool.lng : undefined,
    })
  }

  return (
    <Dialog label={`Set up ${placement.code}`} onClose={onClose} className="sheet-placement-flow">
      <div className="sheet-header">
        <h2>Set up {placement.code}</h2>
        <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
          <IconClose />
        </button>
      </div>
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
            <select className="date-input" value={placement.code} onChange={(e) => patch({ code: e.target.value as PlacementCode })} disabled={!!existing}>
              {PLACEMENT_CODES.map((c) => (
                <option key={c} value={c}>
                  {c}
                  {placements.some((p) => p.code === c && p.id !== placement.id) ? ' (already set up)' : ''}
                </option>
              ))}
            </select>
          </Field>
          <p className="filter-hint">Your placements are recorded as SE1, SE2 and SE3. Your timetable's blocks (SE1A, SE1B…) are mapped in the last step.</p>
        </>
      )}

      {step === 'school' && (
        <>
          <Field label="School name">
            <input type="text" className="placement-input" value={school?.name ?? ''} onChange={(e) => patchSchool({ name: e.target.value })} />
          </Field>
          <Field label="Address" hint="Add the postcode for the best match, then locate and confirm the pin.">
            <input type="text" className="placement-input" value={school?.address ?? ''} onChange={(e) => patchSchool({ address: e.target.value })} />
          </Field>
          <div className="btn-row">
            <button type="button" className="btn-secondary" onClick={() => void locate()} disabled={!school?.address?.trim() || geo === 'working'}>
              {geo === 'working' ? 'Locating…' : school?.lat != null ? 'Locate again' : 'Locate on map'}
            </button>
          </div>
          {geo === 'fail' && <p className="filter-hint">Couldn't locate that address — try adding the postcode, or check your connection.</p>}
          {school?.lat != null && school.lng != null ? (
            <div className="pin-confirm">
              <StaticMap lat={school.lat} lng={school.lng} label={school.name || 'School'} address={school.address} />
              {school.confirmedAt ? (
                <p className="filter-hint saved-line">
                  Pin confirmed {new Date(school.confirmedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} — journeys use this location.
                </p>
              ) : (
                <div className="callout callout--amber">
                  <p>Is this pin on the school? Check the map, then confirm — journeys and reminders will use it.</p>
                  <button type="button" className="btn-primary" onClick={() => patchSchool({ confirmedAt: Date.now() })}>
                    Confirm this pin
                  </button>
                </div>
              )}
            </div>
          ) : (
            <p className="filter-hint">No pin yet. Until a pin is confirmed the placement shows “School details incomplete” and journeys are not offered.</p>
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
            <input type="checkbox" checked={hoursOn} onChange={(e) => { setHoursOn(e.target.checked); if (e.target.checked && !placement.workingHours) patch({ workingHours: { start: policy.start, end: policy.end } }) }} />
            Different hours for this placement (default {policy.start}–{policy.end})
          </label>
          {hoursOn && (
            <div className="task-edit-row">
              <Field label="Day starts">
                <input type="time" className="date-input" value={placement.workingHours?.start ?? policy.start} onChange={(e) => patch({ workingHours: { start: e.target.value || policy.start, end: placement.workingHours?.end ?? policy.end } })} />
              </Field>
              <Field label="Day ends">
                <input type="time" className="date-input" value={placement.workingHours?.end ?? policy.end} onChange={(e) => patch({ workingHours: { start: placement.workingHours?.start ?? policy.start, end: e.target.value || policy.end } })} />
              </Field>
            </div>
          )}
          <Field label="Arrive early by (minutes)" hint={`Default ${settings.arrivalBufferMins ?? 10} min from Settings → Travel.`}>
            <input type="number" className="date-input" min={0} max={180} value={placement.arrivalBufferMins ?? ''} placeholder={String(settings.arrivalBufferMins ?? 10)} onChange={(e) => patch({ arrivalBufferMins: e.target.value === '' ? undefined : Math.max(0, Math.min(180, parseInt(e.target.value, 10) || 0)) })} />
          </Field>
          <label className="toggle-row">
            <input type="checkbox" checked={placement.insetCountsAsSchoolDay ?? policy.insetCounts} onChange={(e) => patch({ insetCountsAsSchoolDay: e.target.checked })} />
            Inset days count as school days here (default {policy.insetCounts ? 'yes' : 'no'})
          </label>
          <Field label="Return destination">
            <p className="filter-hint">
              {homeSet ? `Home${settings.homeAddress ? ` · ${settings.homeAddress}` : ''}` : 'No home saved — set your home in Settings → Travel & home to plan the journey back.'}
            </p>
            {!homeSet && (
              <button type="button" className="btn-today-reset" onClick={onOpenSettings}>
                Set return destination
              </button>
            )}
          </Field>
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
                        onChange={(e) => setTags((t) => (e.target.checked ? [...t, b.tag] : t.filter((x) => x !== b.tag)))}
                      />
                      <span>
                        <strong>{b.tag}</strong>
                        <span className="filter-hint">
                          {' '}
                          · {b.total} school day{b.total === 1 ? '' : 's'}
                          {takenElsewhere ? ` · mapped to ${other!.code}` : proposePlacementCode(b.tag) === placement.code && !tags.includes(b.tag) ? ' · proposed' : ''}
                        </span>
                      </span>
                    </label>
                  </li>
                )
              })}
            </ul>
          )}
        </>
      )}

      {error && (
        <p className="setup-error" role="alert">
          {error}
        </p>
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
        <button type="button" className="btn-ghost" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Dialog>
  )
}
