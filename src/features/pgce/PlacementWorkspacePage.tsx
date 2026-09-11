import { Card, IconCalendar, IconChevronLeft, IconClock, IconHome, IconPin, IconSchool, IconUser, PageHeader } from '../../components/ui'
import { PLACEMENT_STATE_LABEL, PLACEMENT_TIMING_LABEL, placementSetupState, placementTiming } from '../../lib/admin'
import type { AdminFile, PlacementRec, SchoolLocationRec } from '../../lib/admin'
import { placementBlocks, placementPolicy } from '../../lib/placement'
import { isPlacementSession, placementTag } from '../../lib/format'
import { sessionKey } from '../../lib/diff'
import type { MetaMap, Session, Settings } from '../../types'
import type { AdminTab } from './PGCEPage'

interface Props {
  placement: PlacementRec
  school: SchoolLocationRec | undefined
  settings: Settings
  admin: AdminFile
  /** raw course sessions (before exception filtering) */
  sessions: Session[]
  metaMap: MetaMap
  todayISO: string
  onBack: () => void
  onEdit: () => void
  onJourney: (leg: 'out' | 'back') => void
  onOpenAdmin: (tab: AdminTab) => void
  onOpenJournal: () => void
  /** G1b: open a lesson in the workbench */
  onOpenLesson: (lessonId: string) => void
  onOpenSession: (session: Session) => void
  onAll: () => void
}

const fmtDate = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
}

/**
 * Placement workspace (`#/placement/:id`, G1a): everything that belongs to one
 * school — its lessons, observations, meetings and open actions, experience
 * and attendance for its mapped blocks, evidence on its sessions, resources —
 * each linking back to the record editors. Rows show `SE2 · <school>` from the
 * session's mapping, never from which placement happens to be open.
 */
export function PlacementWorkspacePage({ placement, school, settings, admin, sessions, metaMap, todayISO, onBack, onEdit, onJourney, onOpenAdmin, onOpenJournal, onOpenLesson, onOpenSession, onAll }: Props) {
  const state = placementSetupState(placement, school)
  const timing = placementTiming(placement, todayISO)
  const policy = placementPolicy(settings)
  const hours = placement.workingHours ?? { start: policy.start, end: policy.end }
  const label = `${placement.code}${school?.name ? ` · ${school.name}` : ''}`
  const mapped = new Set(placement.mappedBlockTags)
  const mine = sessions.filter((s) => !s.isKeyDate && isPlacementSession(s) && mapped.has(placementTag(s.title)))
  const blocks = placementBlocks(mine, admin.exceptions, settings, (s) => metaMap[sessionKey(s)]).filter((b) => mapped.has(b.tag))
  const planned = blocks.reduce((n, b) => n + b.plannedDays, 0)
  const logged = blocks.reduce((n, b) => n + b.loggedDays, 0)
  const upcoming = [...mine].filter((s) => s.dateISO >= todayISO).sort((a, b) => (a.dateISO + a.start).localeCompare(b.dateISO + b.start))
  const nextDays = [...new Map(upcoming.map((s) => [s.dateISO, s])).values()].slice(0, 5)
  const evidence = mine.filter((s) => {
    const m = metaMap[sessionKey(s)]
    return m && !m.deleted && (m.note || (m.photos ?? 0) > 0 || (m.standards ?? []).length > 0)
  }).length
  const lessons = admin.lessons.filter((l) => l.placementId === placement.id).sort((a, b) => b.dateISO.localeCompare(a.dateISO))
  const observations = admin.observations.filter((o) => o.placementId === placement.id).sort((a, b) => b.dateISO.localeCompare(a.dateISO))
  const meetings = admin.meetings.filter((m) => m.placementId === placement.id).sort((a, b) => b.dateISO.localeCompare(a.dateISO))
  const openActions = meetings.flatMap((m) => m.actions.filter((a) => !a.done).map((a) => ({ ...a, dateISO: m.dateISO })))
  const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`

  return (
    <div className="page page-placement-workspace">
      <button type="button" className="page-back" onClick={onBack}>
        <IconChevronLeft size={18} /> PGCE file
      </button>
      <PageHeader title={label} subtitle={`${PLACEMENT_STATE_LABEL[state]} · ${PLACEMENT_TIMING_LABEL[timing]}`} />

      <div className="hero hero--placement">
        <div className="hero-details">
          <div className="hero-detail">
            <IconCalendar />
            <span>{placement.startISO && placement.endISO ? `${fmtDate(placement.startISO)} – ${fmtDate(placement.endISO)}` : 'Dates not set'}</span>
          </div>
          <div className="hero-detail">
            <IconClock />
            <span>
              {hours.start}–{hours.end}
              {placement.workingHours ? '' : ' (default hours)'}
            </span>
          </div>
          <div className="hero-detail">
            <IconUser />
            <span>{placement.mentorName ? `Mentor ${placement.mentorName}${placement.mentorContact ? ` · ${placement.mentorContact}` : ''}` : 'Mentor not set'}</span>
          </div>
          <div className="hero-detail">
            <IconPin />
            <span>{school?.address || school?.name || 'School address not set'}{school?.entranceNote ? ` · ${school.entranceNote}` : ''}</span>
          </div>
        </div>
        <div className="btn-row">
          {state === 'ready' ? (
            <>
              <button type="button" className="btn-primary" onClick={() => onJourney('out')}>
                <IconPin size={16} /> To school
              </button>
              <button type="button" className="btn-today-reset" onClick={() => onJourney('back')}>
                <IconHome size={16} /> Back home
              </button>
            </>
          ) : (
            <button type="button" className="btn-primary" onClick={onEdit}>
              Complete setup
            </button>
          )}
          <button type="button" className="btn-today-reset" onClick={onEdit}>
            Edit setup
          </button>
        </div>
      </div>

      <div className="pgce-grid">
        <Card className="pgce-section pgce-section--placement">
          <div className="pgce-section-head">
            <span className="pgce-tile" aria-hidden="true"><IconSchool size={20} /></span>
            <h2>Experience &amp; attendance</h2>
            {planned > 0 && <span className="badge pgce-count">{logged}/{planned} days logged</span>}
          </div>
          <p className="filter-hint">
            {placement.mappedBlockTags.length === 0
              ? 'No timetable blocks mapped to this placement yet — map them in Edit setup.'
              : `${placement.mappedBlockTags.join(', ')} · ${count(planned, 'planned school day')}, ${logged} logged. A logged day is one you ticked Attended on.`}
          </p>
          {nextDays.length > 0 && (
            <ul className="workspace-list" aria-label="Next school days">
              {nextDays.map((s) => (
                <li key={s.dateISO}>
                  <button type="button" className="workspace-row" onClick={() => onOpenSession(s)}>
                    <span>{fmtDate(s.dateISO)}</span>
                    <span className="tag">{label}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="btn-row">
            <button type="button" className="btn-today-reset" onClick={onAll}>Day-by-day log →</button>
          </div>
        </Card>

        <Card className="pgce-section pgce-section--development">
          <div className="pgce-section-head">
            <span className="pgce-tile" aria-hidden="true"><IconUser size={20} /></span>
            <h2>Lessons</h2>
            {lessons.length > 0 && <span className="badge pgce-count">{count(lessons.length, 'lesson')}</span>}
          </div>
          {lessons.length === 0 ? (
            <p className="filter-hint">No lessons linked to {placement.code} yet. Choose “{placement.code}” in the Placement field when you add one.</p>
          ) : (
            <ul className="workspace-list" aria-label="Lessons">
              {lessons.slice(0, 6).map((l) => (
                <li key={l.id}>
                  <button type="button" className="workspace-row" onClick={() => onOpenLesson(l.id)}>
                    <span>{fmtDate(l.dateISO)} · {l.subject || 'Lesson'}{l.classGroup ? ` · ${l.classGroup}` : ''}</span>
                    <span className="tag">{l.stage ?? 'plan'}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="btn-row">
            <button type="button" className="btn-today-reset" onClick={() => onOpenAdmin('lessons')}>Lessons →</button>
          </div>
        </Card>

        <Card className="pgce-section pgce-section--development">
          <div className="pgce-section-head">
            <span className="pgce-tile" aria-hidden="true"><IconUser size={20} /></span>
            <h2>Observations &amp; meetings</h2>
            {observations.length + meetings.length > 0 && <span className="badge pgce-count">{count(observations.length + meetings.length, 'record')}</span>}
          </div>
          <p className="filter-hint">
            {count(observations.length, 'observation')} · {count(meetings.length, 'mentor meeting')}
            {openActions.length > 0 ? ` · ${count(openActions.length, 'open action')}` : ''}
          </p>
          {openActions.length > 0 && (
            <ul className="workspace-list" aria-label="Open actions">
              {openActions.slice(0, 5).map((a) => (
                <li key={a.id}>
                  <button type="button" className="workspace-row" onClick={() => onOpenAdmin('meetings')}>
                    <span>{a.text}</span>
                    <span className="filter-hint">{fmtDate(a.dateISO)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="btn-row">
            <button type="button" className="btn-today-reset" onClick={() => onOpenAdmin('obs')}>Observations →</button>
            <button type="button" className="btn-today-reset" onClick={() => onOpenAdmin('meetings')}>Meetings →</button>
          </div>
        </Card>

        <Card className="pgce-section pgce-section--evidence">
          <div className="pgce-section-head">
            <span className="pgce-tile" aria-hidden="true"><IconCalendar size={20} /></span>
            <h2>Evidence &amp; resources</h2>
            {evidence > 0 && <span className="badge pgce-count">{count(evidence, 'session record')}</span>}
          </div>
          <p className="filter-hint">
            {evidence > 0 ? `${count(evidence, 'session note/photo record')} on ${placement.code} days.` : `No session notes or photos on ${placement.code} days yet.`}
            {placement.notes ? ` Notes: ${placement.notes}` : ''}
          </p>
          <div className="btn-row">
            <button type="button" className="btn-today-reset" onClick={onOpenJournal}>Evidence journal →</button>
            <button type="button" className="btn-today-reset" onClick={onEdit}>Edit notes</button>
          </div>
        </Card>
      </div>
    </div>
  )
}
