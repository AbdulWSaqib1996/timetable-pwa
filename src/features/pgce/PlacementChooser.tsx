import { Card, IconArrowRight, IconHome, IconPin, IconSchool } from '../../components/ui'
import { PLACEMENT_CODES, PLACEMENT_STATE_LABEL, PLACEMENT_TIMING_LABEL, placementSetupState, placementTiming, schoolOf } from '../../lib/admin'
import type { PlacementCode, PlacementRec, SchoolLocationRec } from '../../lib/admin'
import { placementPolicy } from '../../lib/placement'
import type { Settings } from '../../types'

interface Props {
  placements: PlacementRec[]
  schools: SchoolLocationRec[]
  settings: Settings
  todayISO: string
  /** imported block tags with their day counts (App placementStats) */
  blocks: { tag: string; total: number; attended: number }[]
  onOpen: (id: string) => void
  onSetUp: (code: PlacementCode, id?: string) => void
  onJourney: (id: string, leg: 'out' | 'back') => void
  onAll: () => void
  onReviewMapping: () => void
}

const fmtDate = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

/**
 * PG-07A placement chooser (G1a): one card per placement recorded on the
 * course — SE1, SE2, SE3 — with its school, dates, setup state and timing,
 * mentor and hours, and ONE primary action for the state. The accent per card
 * is identity only (indigo/teal/violet), never a judgement. Journeys are only
 * offered once the school pin is confirmed ("Ready to plan").
 */
export function PlacementChooser({ placements, schools, settings, todayISO, blocks, onOpen, onSetUp, onJourney, onAll, onReviewMapping }: Props) {
  const policy = placementPolicy(settings)
  return (
    <div className="placement-chooser">
      <ul className="placement-chooser-list" aria-label="Your placements">
        {PLACEMENT_CODES.map((code, i) => {
          const placement = placements.find((p) => p.code === code)
          const school = schoolOf(placement, schools)
          const state = placementSetupState(placement, school)
          const timing = placementTiming(placement, todayISO)
          const mapped = placement?.mappedBlockTags ?? []
          const days = blocks.filter((b) => mapped.includes(b.tag)).reduce((n, b) => n + b.total, 0)
          const hours = placement?.workingHours ?? { start: policy.start, end: policy.end }
          const hoursNote = placement?.workingHours ? '' : ' (default)'
          return (
            <li key={code}>
              <Card className={`placement-card placement-card--${i + 1} placement-card--${state}`}>
                <div className="placement-card-head">
                  <span className={`ui-tile ui-tile--${['blue', 'teal', 'violet'][i]} placement-card-tile`} aria-hidden="true">
                    <IconSchool size={20} />
                  </span>
                  <div className="placement-card-title">
                    <h3>
                      {code}
                      {school?.name ? <span className="placement-card-school"> · {school.name}</span> : null}
                    </h3>
                    <p className="placement-card-state">
                      <span className={`tag tag--${state}`}>{PLACEMENT_STATE_LABEL[state]}</span>
                      {placement && <span className="tag">{PLACEMENT_TIMING_LABEL[timing]}</span>}
                    </p>
                  </div>
                </div>
                {placement ? (
                  <dl className="kv placement-card-facts">
                    <div>
                      <dt>Dates</dt>
                      <dd>{placement.startISO && placement.endISO ? `${fmtDate(placement.startISO)} – ${fmtDate(placement.endISO)}` : 'Not set'}</dd>
                    </div>
                    <div>
                      <dt>Mentor</dt>
                      <dd>{placement.mentorName || 'Not set'}</dd>
                    </div>
                    <div>
                      <dt>Hours</dt>
                      <dd>
                        {hours.start}–{hours.end}
                        {hoursNote}
                      </dd>
                    </div>
                    <div>
                      <dt>Timetable</dt>
                      <dd>{mapped.length ? `${mapped.join(', ')} · ${days} school day${days === 1 ? '' : 's'}` : 'No blocks mapped'}</dd>
                    </div>
                  </dl>
                ) : (
                  <p className="filter-hint">Add the school, mentor and dates for {code} to plan journeys and link your records to it.</p>
                )}
                {state === 'incomplete' && school && !school.confirmedAt && (
                  <p className="filter-hint placement-card-hint">The school pin has not been confirmed yet — journeys need a confirmed location, not just an address.</p>
                )}
                <div className="btn-row">
                  {!placement ? (
                    <button type="button" className="btn-primary" onClick={() => onSetUp(code)}>
                      Set up {code}
                    </button>
                  ) : state === 'incomplete' ? (
                    <>
                      <button type="button" className="btn-primary" onClick={() => onSetUp(code, placement.id)}>
                        Complete setup
                      </button>
                      <button type="button" className="btn-today-reset" onClick={() => onOpen(placement.id)}>
                        Open placement
                      </button>
                    </>
                  ) : (
                    <>
                      <button type="button" className="btn-primary" onClick={() => onOpen(placement.id)}>
                        Open placement
                      </button>
                      <button type="button" className="btn-today-reset" onClick={() => onJourney(placement.id, 'out')}>
                        <IconPin size={16} /> To school
                      </button>
                      <button type="button" className="btn-today-reset" onClick={() => onJourney(placement.id, 'back')}>
                        <IconHome size={16} /> Back home
                      </button>
                    </>
                  )}
                </div>
              </Card>
            </li>
          )
        })}
      </ul>
      <div className="btn-row placement-chooser-links">
        <button type="button" className="btn-today-reset" onClick={onAll}>
          All placements <IconArrowRight size={14} />
        </button>
        {blocks.length > 0 && (
          <button type="button" className="btn-today-reset" onClick={onReviewMapping}>
            Review block mapping
          </button>
        )}
      </div>
    </div>
  )
}
