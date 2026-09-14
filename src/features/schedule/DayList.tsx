import { IconSchool } from '../../components/ui'
import { SessionCard } from '../../components/SessionCard'
import type { Coords, TravelMode } from '../../lib/campus'
import { sessionKey } from '../../lib/diff'
import { formatRemaining, isPlacementSession, placementTag, toMinutes } from '../../lib/format'
import { keyDateSiblings } from '../../lib/scheduleProjection'
import type { MetaMap, Session } from '../../types'

/** U03: what the school-day card says about a block — school, hours and where each came from. */
export interface SchoolDayInfo {
  code: string
  school?: string
  hours: { start: string; end: string }
  hoursSource: 'placement' | 'default'
  source: 'canonical' | 'legacy'
  placementId?: string
  /** journeys are offered only once the school pin is confirmed */
  ready: boolean
}

interface Props {
  /** the selected day's rows (sessions + woven key dates), time-sorted */
  sessions: Session[]
  metaMap: MetaMap
  coords?: Coords | null
  travelMode?: TravelMode
  placements?: Record<string, { school?: string }>
  schoolDayFor?: (tag: string) => SchoolDayInfo | null
  onJourney?: (placementId: string, leg: 'out' | 'back') => void
  emptyMessage: string
  onSelect: (s: Session) => void
}

/**
 * One selected day's list (P4-03): session cards with neutral break rows
 * derived from the day's canonical intervals, clash badges for genuine
 * overlaps, and the calm collapsed placement-day card (U03: with the school,
 * its working hours and their source, plus To school / Back home).
 */
export function DayList({ sessions, metaMap, coords, travelMode, placements, schoolDayFor, onJourney, emptyMessage, onSelect }: Props) {
  if (sessions.length === 0) {
    return <p className="week-free day-list-empty">{emptyMessage}</p>
  }

  const real = sessions.filter((s) => !s.isKeyDate)
  const pins = sessions.filter((s) => s.isKeyDate)
  // B09: two genuinely different key dates with one title (different times or rooms) both
  // stay, and each says so — the learner sees the group, not a silent merge.
  const group = (s: Session) => {
    const n = s.isKeyDate ? keyDateSiblings(s, pins) : 1
    return n > 1 ? <span className="filter-hint keydate-group">{n} items with this title today{s.start ? ` · this one at ${s.start}` : ''}</span> : null
  }
  if (real.length > 0 && real.every(isPlacementSession)) {
    const tag = placementTag(real[0].title)
    const info = schoolDayFor?.(tag) ?? null
    const school = info?.school ?? placements?.[tag]?.school
    // The imported block says when the timetable row runs; the placement says the working
    // day — both are shown when they differ, never merged into one invented duration.
    const rowHours = real[0].start && real[0].end ? `${real[0].start}–${real[0].end}` : null
    const dayHours = info ? `${info.hours.start}–${info.hours.end}` : null
    return (
      <div className="day-sessions day-list">
        {pins.map((s) => (
          <div key={s.id} className="session-slot">
            <SessionCard session={s} onSelect={onSelect} />
            {group(s)}
          </div>
        ))}
        <div className="school-day-card ui-card">
          <button type="button" className="placement-day" onClick={() => onSelect(real[0])} aria-label={`Open school day: ${info?.code ?? tag}${school ? ` at ${school}` : ''}`}>
            <IconSchool size={16} /> {info?.code ?? tag} · School day
            {real.length > 1 ? ` (+${real.length - 1} more)` : ''}
            <span className="placement-sub school-day-school">{school ?? 'Tap to add school details'}</span>
            <span className="placement-sub school-day-hours">
              {dayHours ? `Working day ${dayHours}${info?.hoursSource === 'default' ? ' (course default)' : ' (this placement)'}` : rowHours ? `Timetable row ${rowHours}` : 'Hours not set'}
              {dayHours && rowHours && rowHours !== dayHours ? ` · timetable row ${rowHours}` : ''}
              {info ? ` · ${info.source === 'canonical' ? 'from your placement setup' : 'from the timetable only'}` : ''}
            </span>
          </button>
          {info?.placementId && info.ready && onJourney && (
            <div className="btn-row school-day-actions">
              <button type="button" className="btn-today-reset" onClick={() => onJourney(info.placementId!, 'out')}>To school</button>
              <button type="button" className="btn-today-reset" onClick={() => onJourney(info.placementId!, 'back')}>Back home</button>
            </div>
          )}
        </div>
      </div>
    )
  }

  // Genuine overlaps get a clash badge (never a break row inside them).
  const timed = sessions.filter((s) => !s.isKeyDate && !s.isSelfStudy && !s.isFreeTime && toMinutes(s.start) !== null)
  const clashes = new Set<string>()
  for (let i = 0; i < timed.length; i++) {
    for (let j = i + 1; j < timed.length; j++) {
      const aStart = toMinutes(timed[i].start)!
      const aEnd = toMinutes(timed[i].end) ?? aStart + 60
      const bStart = toMinutes(timed[j].start)!
      const bEnd = toMinutes(timed[j].end) ?? bStart + 60
      if (aStart < bEnd && bStart < aEnd) {
        clashes.add(timed[i].id)
        clashes.add(timed[j].id)
      }
    }
  }

  return (
    <div className="day-sessions day-list">
      {sessions.map((s, i) => {
        const prev = i > 0 ? sessions[i - 1] : null
        let gapMins = 0
        if (
          prev &&
          !prev.isKeyDate &&
          !s.isKeyDate &&
          !clashes.has(s.id) &&
          !clashes.has(prev.id) &&
          toMinutes(prev.end) !== null &&
          toMinutes(s.start) !== null
        ) {
          gapMins = toMinutes(s.start)! - toMinutes(prev.end)!
        }
        return (
          <div key={s.id} className="session-slot">
            {gapMins >= 30 && <div className="free-gap">{formatRemaining(gapMins)} break</div>}
            <SessionCard
              session={s}
              meta={metaMap[sessionKey(s)]}
              coords={coords}
              travelMode={travelMode}
              conflict={clashes.has(s.id)}
              onSelect={onSelect}
            />
            {group(s)}
          </div>
        )
      })}
    </div>
  )
}
