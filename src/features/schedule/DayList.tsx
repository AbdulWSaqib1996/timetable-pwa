import { IconSchool } from '../../components/ui'
import { SessionCard } from '../../components/SessionCard'
import type { Coords, TravelMode } from '../../lib/campus'
import { sessionKey } from '../../lib/diff'
import { formatRemaining, isPlacementSession, placementTag, toMinutes } from '../../lib/format'
import { keyDateSiblings } from '../../lib/scheduleProjection'
import type { MetaMap, Session } from '../../types'

interface Props {
  /** the selected day's rows (sessions + woven key dates), time-sorted */
  sessions: Session[]
  metaMap: MetaMap
  coords?: Coords | null
  travelMode?: TravelMode
  placements?: Record<string, { school?: string }>
  emptyMessage: string
  onSelect: (s: Session) => void
}

/**
 * One selected day's list (P4-03): session cards with neutral break rows
 * derived from the day's canonical intervals, clash badges for genuine
 * overlaps, and the calm collapsed placement-day block.
 */
export function DayList({ sessions, metaMap, coords, travelMode, placements, emptyMessage, onSelect }: Props) {
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
    return (
      <div className="day-sessions day-list">
        {pins.map((s) => (
          <div key={s.id} className="session-slot">
            <SessionCard session={s} onSelect={onSelect} />
            {group(s)}
          </div>
        ))}
        <button type="button" className="placement-day" onClick={() => onSelect(real[0])}>
          <IconSchool size={16} /> {real[0].title}
          {real.length > 1 ? ` (+${real.length - 1} more)` : ''}
          <span className="placement-sub">
            School experience day
            {placements?.[placementTag(real[0].title)]?.school
              ? ` · ${placements[placementTag(real[0].title)].school}`
              : ' · tap to add school details'}
          </span>
        </button>
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
