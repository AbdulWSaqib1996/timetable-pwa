import { Dialog, IconClose, IconSchool } from './ui'
import { PLACEMENT_CODES, PLACEMENT_STATE_LABEL, placementSetupState, schoolOf } from '../lib/admin'
import type { PlacementCode, PlacementRec, SchoolLocationRec } from '../lib/admin'

interface Props {
  placements: PlacementRec[]
  schools: SchoolLocationRec[]
  blocks: { tag: string; total: number }[]
  onSetUp: (code: PlacementCode, id?: string) => void
  onOpen: (id: string) => void
  onLater: () => void
  onContinue: () => void
}

/**
 * Optional onboarding step (concept A, Pass 88): once the specialism is
 * chosen and the timetable has placement blocks, review the three schools —
 * set one up now, open one you already have, or finish later. Nothing here
 * blocks the timetable: "I'll finish this later" is always available and the
 * review is offered once per profile.
 */
export function PlacementReviewSheet({ placements, schools, blocks, onSetUp, onOpen, onLater, onContinue }: Props) {
  const days = blocks.reduce((n, b) => n + b.total, 0)
  return (
    <Dialog label="Review your placements" onClose={onLater} className="sheet-placement-review">
      <div className="sheet-header">
        <h2>Review your placements</h2>
        <button type="button" className="icon-btn" aria-label="Close" onClick={onLater}>
          <IconClose />
        </button>
      </div>
      <p className="filter-hint">
        Your timetable has {blocks.length} placement block{blocks.length === 1 ? '' : 's'} ({days} school day{days === 1 ? '' : 's'}). Each placement keeps its own school, mentor and dates — set up the ones you know now and come back for the rest.
      </p>
      <ul className="setup-list placement-review-list" aria-label="Placements to review">
        {PLACEMENT_CODES.map((code) => {
          const placement = placements.find((p) => p.code === code)
          const school = schoolOf(placement, schools)
          const state = placementSetupState(placement, school)
          return (
            <li key={code} className="setup-row placement-review-row">
              <span>
                <span className="ui-tile ui-tile--teal" aria-hidden="true"><IconSchool size={16} /></span>{' '}
                <strong>{code}</strong>
                {school?.name ? ` · ${school.name}` : ''} <span className={`tag tag--${state}`}>{PLACEMENT_STATE_LABEL[state]}</span>
              </span>
              <span className="requirement-confirm">
                {placement ? (
                  <>
                    <button type="button" className="travel-link" onClick={() => onOpen(placement.id)}>View or edit {code}</button>
                    {state !== 'ready' && <button type="button" className="travel-link" onClick={() => onSetUp(code, placement.id)}>Continue {code} setup</button>}
                  </>
                ) : (
                  <button type="button" className="travel-link" onClick={() => onSetUp(code)}>Set up {code}</button>
                )}
              </span>
            </li>
          )
        })}
      </ul>
      <div className="modal-actions">
        <button type="button" className="btn-primary" onClick={onContinue}>Continue</button>
        <button type="button" className="btn-ghost" onClick={onLater}>I'll finish this later</button>
      </div>
      <p className="filter-hint">You can always reach every placement from the PGCE file → All placements.</p>
    </Dialog>
  )
}
