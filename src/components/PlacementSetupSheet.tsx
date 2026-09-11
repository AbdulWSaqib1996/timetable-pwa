import { useMemo, useState } from 'react'
import { Dialog, IconClose } from './ui'
import { PLACEMENT_CODES, applyPlacementAssignment, placementForTag, proposePlacementCode } from '../lib/admin'
import type { PlacementCode, PlacementRec, PlacementSetupResult, SchoolLocationRec } from '../lib/admin'
import type { Settings } from '../types'

interface Props {
  blocks: { tag: string; total: number; attended: number }[]
  placements: PlacementRec[]
  schools: SchoolLocationRec[]
  settings: Settings
  onConfirm: (next: PlacementSetupResult) => void
  onClose: () => void
}

/**
 * G0 migration sheet: map the imported timetable's placement block tags
 * (SE1A, SE1B, SE2…) onto the placements recorded on the course (SE1, SE2,
 * SE3). Proposals come from the tag prefix and are shown as proposals; nothing
 * is written until the learner confirms. Re-running with the same choices
 * changes nothing; a block can stay Unassigned; imported school and mentor
 * details are carried across but never removed from Settings.
 */
export function PlacementSetupSheet({ blocks, placements, schools, settings, onConfirm, onClose }: Props) {
  const initial = useMemo(() => {
    const out: Record<string, PlacementCode | ''> = {}
    // Proposals pre-fill the FIRST run only. Once placements exist, a block the
    // learner left Unassigned stays Unassigned on review (the proposal is still
    // shown as text) — a review must never quietly re-apply a rejected guess.
    const firstRun = placements.length === 0
    for (const b of blocks) {
      const mapped = placementForTag(placements, b.tag)
      out[b.tag] = mapped ? (mapped.code as PlacementCode) : firstRun ? proposePlacementCode(b.tag) : ''
    }
    return out
  }, [blocks, placements])
  const [assign, setAssign] = useState(initial)

  const detailsFor = (tag: string) => settings.placements?.[tag]
  const summary = PLACEMENT_CODES.map((code) => ({ code, tags: blocks.map((b) => b.tag).filter((t) => assign[t] === code) }))

  return (
    <Dialog label="Set up placements" onClose={onClose} className="sheet-placement-setup">
      <div className="sheet-header">
        <h2>Set up placements</h2>
        <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
          <IconClose />
        </button>
      </div>
      <p className="filter-hint">
        Your records use SE1, SE2 and SE3. Your timetable labels blocks like SE1A and SE1B. Confirm which placement each block belongs to — a proposal is shown, nothing is saved until you confirm.
      </p>
      {blocks.length === 0 ? (
        <p className="filter-hint">No placement blocks in your timetable yet. Blocks appear here once your timetable includes school experience sessions.</p>
      ) : (
        <ul className="setup-list" aria-label="Placement blocks">
          {blocks.map((b) => {
            const mapped = placementForTag(placements, b.tag)
            const proposal = proposePlacementCode(b.tag)
            const d = detailsFor(b.tag)
            return (
              <li key={b.tag} className="setup-row">
                <div className="setup-row-main">
                  <strong>{b.tag}</strong>
                  <span className="filter-hint">
                    {b.total} school day{b.total === 1 ? '' : 's'}
                    {d?.school ? ` · ${d.school}` : ''}
                    {mapped ? ` · currently ${mapped.code}` : proposal ? ` · proposed ${proposal}` : ' · no proposal'}
                  </span>
                </div>
                <select
                  aria-label={`Placement for ${b.tag}`}
                  value={assign[b.tag] ?? ''}
                  onChange={(e) => setAssign((a) => ({ ...a, [b.tag]: e.target.value as PlacementCode | '' }))}
                >
                  <option value="">Unassigned</option>
                  {PLACEMENT_CODES.map((code) => (
                    <option key={code} value={code}>{code}</option>
                  ))}
                </select>
              </li>
            )
          })}
        </ul>
      )}
      <ul className="setup-summary" aria-label="Placement summary">
        {summary.map(({ code, tags }) => {
          const rec = placements.find((p) => p.code === code)
          const school = rec ? schools.find((s) => s.id === rec.schoolLocationId) : undefined
          return (
            <li key={code}>
              <span className="tag">{code}</span> {tags.length ? tags.join(', ') : 'no blocks'}
              {school?.name ? ` · ${school.name}` : ''}
            </li>
          )
        })}
      </ul>
      <div className="btn-row">
        <button
          type="button"
          className="btn-primary"
          onClick={() => onConfirm(applyPlacementAssignment({ placements, schools }, assign, Object.fromEntries(blocks.map((b) => [b.tag, detailsFor(b.tag)]))))}
        >
          Confirm placements
        </button>
        <button type="button" className="btn-today-reset" onClick={onClose}>Cancel</button>
      </div>
    </Dialog>
  )
}
