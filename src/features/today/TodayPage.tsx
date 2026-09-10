import { useState } from 'react'
import { addDaysISO } from '../../../shared/calendar-time.js'
import { classifyNow } from '../../../shared/intervals.js'
import { useCourseClock } from '../../hooks/useCourseClock'
import { estimateTravel, estimateTravelToCoords } from '../../lib/campus'
import type { Coords, TravelMode } from '../../lib/campus'
import { sessionKey } from '../../lib/diff'
import { daysUntil, formatRemaining, isPlacementSession, placementTag, sessionKindLabel, toMinutes } from '../../lib/format'
import { parseLocation, shortBuildingName } from '../../lib/location'
import { freshnessLabel } from '../../../shared/travel-state.js'
import { cachedRouteInfo } from '../../lib/tfl'
import { TRAVEL_MODE_PHRASE } from '../../lib/campus'
import {
  Card,
  EmptyState,
  IconBell,
  IconBook,
  IconChevronRight,
  IconClock,
  IconClose,
  IconHome,
  IconNote,
  IconPin,
  IconRefresh,
  PageHeader,
  SettingsAction,
} from '../../components/ui'
import { AttendancePromptCard } from '../../components/AttendancePrompt'
import type { AttendanceAnswer } from '../../components/AttendancePrompt'
import type { MetaMap, Session, SessionChange, Settings } from '../../types'

interface Props {
  profileName: string
  todayISO: string
  fetchedAt: number | null
  refreshing: boolean
  demo: boolean
  onRefresh: () => void
  /** course-membership sessions, all dates, sorted by date+start */
  courseSessions: Session[]
  /** personal commitments as sessions (R1 / TT-06): shown on Today like any other event */
  personalSessions?: Session[]
  allKeyDates: Session[]
  metaMap: MetaMap
  unseenChanges: number
  latestChange: SessionChange | null
  settings: Settings
  coords: Coords | null
  travelMode: TravelMode
  locationEnabled: boolean
  onSelect: (s: Session) => void
  onOpenChanges: () => void
  onOpenSettings: () => void
  /** quick attendance answer for a session that just ended (9 Sep 2026) */
  onMarkAttendance: (s: Session, answer: AttendanceAnswer) => void
  onOpenTasks: () => void
  onOpenSchedule: () => void
  onOpenHomeJourney: () => void
}

function formatAge(fetchedAt: number): string {
  const mins = Math.round((Date.now() - fetchedAt) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

function longDate(dateISO: string): string {
  const [y, m, d] = dateISO.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
}

/** Room/building split for the hero panel; falls back to the raw string. */
function roomLines(s: Session): { room: string | null; building: string | null } {
  if (s.isSelfStudy || !s.room) return { room: null, building: null }
  const loc = parseLocation(s.room)
  if (loc.building && loc.room) return { room: `Room ${loc.room}`, building: shortBuildingName(loc) }
  if (loc.note) return { room: 'Room TBC', building: null }
  return { room: s.room, building: null }
}

/**
 * V2: a long sheet title such as "PS1 - Exploring Professionalism - Introduction
 * to PS and Teacher Identity" is shown as a heading plus a subtitle. Nothing is
 * deleted: the separator stays in the DOM (visually hidden) so the accessible
 * name and the copied text remain the full title.
 */
export function splitTitle(title: string): { head: string; sep: string; tail: string } | null {
  // Greedy head: split at the LAST separator, so "PS1 - Exploring Professionalism -
  // Introduction…" keeps the module name with its theme in the heading.
  const m = title.match(/^(.{3,})(\s+[-–—:]\s+)(.{3,})$/)
  return m ? { head: m[1], sep: m[2], tail: m[3] } : null
}

const locationLine = (s: Session): string | null => {
  const loc = roomLines(s)
  const parts = [loc.building, loc.room].filter(Boolean)
  return parts.length ? parts.join(' · ') : null
}

/**
 * Today (P4-02 → V2): date header, at most one urgent item, the attendance
 * quick answer, next/current session hero with labelled time and place, the
 * rest of the day as readable cards, an explicit finished-day state with a
 * next action, the journey-home row and a restrained tomorrow preview.
 */
export function TodayPage({
  profileName,
  todayISO,
  fetchedAt,
  refreshing,
  demo,
  onRefresh,
  courseSessions,
  personalSessions = [],
  allKeyDates,
  metaMap,
  unseenChanges,
  latestChange,
  settings,
  coords,
  travelMode,
  locationEnabled,
  onSelect,
  onOpenChanges,
  onOpenSettings,
  onMarkAttendance,
  onOpenTasks,
  onOpenSchedule,
  onOpenHomeJourney,
}: Props) {
  // ONE course clock (TT-05): "now" is course wall time, compared against
  // course wall times — never the device's getHours().
  const clock = useCourseClock()
  const nowMins = clock.nowMins

  // Every relevant record exactly once, classified by IDENTITY (TT-06):
  // course sessions and personal events on the course day.
  // Deduplicated by owner id: the caller may already fold personal events
  // into `courseSessions`; identity, not position, decides membership.
  const todays = (() => {
    const seen = new Set<string>()
    return [...courseSessions, ...personalSessions].filter((s) => {
      if (s.dateISO !== todayISO || s.isKeyDate || seen.has(s.id)) return false
      seen.add(s.id)
      return true
    })
  })()
  const classified = classifyNow(
    todays.map((s) => ({ s, start: toMinutes(s.start), end: toMinutes(s.end), busy: !s.isFreeTime && !s.isSelfStudy })),
    nowMins
  )
  const byStart = (a: { s: Session }, b: { s: Session }) => (a.s.start || '').localeCompare(b.s.start || '')
  const currentAll = [...classified.current].sort(byStart).map((x) => x.s)
  const upcoming = [...classified.upcoming].sort(byStart).map((x) => x.s)
  const finished = [...classified.finished].sort(byStart).map((x) => x.s)
  const untimed = classified.untimed.map((x) => x.s)
  const clashCount = classified.clashCount
  const current = currentAll[0]
  const hero = current ?? upcoming[0] ?? null
  // "Also now": every other active event, never dropped for sharing a start.
  const alsoNow = currentAll.filter((s) => s !== hero)
  const rest = upcoming.filter((s) => s !== hero)
  const [showFinished, setShowFinished] = useState(false)
  // Quick attendance answer: the most recently ended real session (within 30
  // minutes) with no answer yet, only when prompts are on — the same window
  // and rule the notification uses, so an answered session is never asked.
  const promptSession =
    settings.attendancePrompts === true
      ? finished
          .filter((s) => !s.isSelfStudy && !s.isKeyDate && !s.id.startsWith('cmt-') && !s.id.startsWith('plan-') && s.end)
          .filter((s) => {
            const end = toMinutes(s.end)
            const m = metaMap[sessionKey(s)]
            return end !== null && clock.nowMins - end >= 0 && clock.nowMins - end <= 30 && !m?.attended && !m?.absent
          })
          .sort((a, b) => (b.end || '').localeCompare(a.end || ''))[0] ?? null
      : null
  // Day finished = every TIMED record has ended; untimed records don't count.
  const dayFinished = currentAll.length + upcoming.length === 0 && finished.length > 0

  // At most ONE urgent item (P4-02): a fresh timetable change wins, else overdue work.
  const overdue = allKeyDates.filter(
    (k) => k.dateISO < todayISO && metaMap[sessionKey(k)]?.status !== 'done'
  ).length
  const urgent =
    unseenChanges > 0 ? (
      <button type="button" className="urgent-chip" onClick={onOpenChanges}>
        {unseenChanges === 1 && latestChange
          ? `${latestChange.type === 'changed' ? 'Changed' : latestChange.type === 'added' ? 'Added' : 'Cancelled'}: ${latestChange.title}`
          : `${unseenChanges} timetable changes`}{' '}
        · View
      </button>
    ) : overdue > 0 ? (
      <button type="button" className="urgent-chip" onClick={onOpenTasks}>
        {overdue} overdue task{overdue === 1 ? '' : 's'} · View tasks
      </button>
    ) : null

  // Next outstanding deadline strip (kept from the previous UI).
  const nextDeadline = allKeyDates
    .filter((k) => metaMap[sessionKey(k)]?.status !== 'done')
    .sort((a, b) => a.dateISO.localeCompare(b.dateISO))[0]

  // Tomorrow preview: the next date with sessions after today.
  const nextDay = courseSessions.find((s) => s.dateISO > todayISO && !s.isKeyDate)
  const nextDaySessions = nextDay ? courseSessions.filter((s) => s.dateISO === nextDay.dateISO && !s.isKeyDate) : []
  const tomorrowISO = addDaysISO(todayISO, 1)
  const nextDayLine = nextDay
    ? nextDay.dateISO === tomorrowISO
      ? `Tomorrow: ${nextDaySessions.length} session${nextDaySessions.length === 1 ? '' : 's'}, first at ${nextDaySessions[0]?.start} — ${nextDaySessions[0]?.title}.`
      : `Next sessions: ${longDate(nextDay.dateISO)} (${nextDaySessions.length}).`
    : 'No upcoming sessions found in this timetable.'

  const heroTravel = hero
    ? isPlacementSession(hero) &&
      settings.placements?.[placementTag(hero.title)]?.lat != null &&
      settings.placements?.[placementTag(hero.title)]?.lng != null
      ? estimateTravelToCoords(
          {
            lat: settings.placements[placementTag(hero.title)].lat!,
            lng: settings.placements[placementTag(hero.title)].lng!,
          },
          coords,
          travelMode,
          settings.placements[placementTag(hero.title)].school || 'Placement school'
        )
      : hero.room && !hero.isSelfStudy
        ? estimateTravel(hero.room, coords, travelMode)
        : null
    : null

  const heroStart = hero ? toMinutes(hero.start) : null
  const heroLabel = current
    ? `Now · ends ${current.end}${toMinutes(current.end) !== null ? ` (${formatRemaining(toMinutes(current.end)! - nowMins)} left)` : ''}`
    : hero && heroStart !== null && heroStart > nowMins
      ? `Up next · in ${formatRemaining(heroStart - nowMins)}`
      : 'Up next'
  const heroRoom = hero ? roomLines(hero) : { room: null, building: null }
  const heroSplit = hero ? splitTitle(hero.title) : null

  const homeSet = settings.homeLat != null && settings.homeLng != null
  // "Ready to head home?" can be dismissed for the day; the manual action stays.
  const [homeDismissedDay, setHomeDismissedDay] = useState<string | null>(() => {
    try {
      return localStorage.getItem('timetable.homedismiss.v1')
    } catch {
      return null
    }
  })
  const homePromoted = homeSet && dayFinished && homeDismissedDay !== todayISO
  const dismissHome = () => {
    try {
      localStorage.setItem('timetable.homedismiss.v1', todayISO)
    } catch {
      /* per-device convenience only */
    }
    setHomeDismissedDay(todayISO)
  }
  // Freshness-qualified duration for the entry row (P3-08 rules).
  let homeSummary: string | null = null
  if (homeSet && coords) {
    const home = { lat: settings.homeLat!, lng: settings.homeLng! }
    const est = estimateTravelToCoords(home, coords, travelMode, 'Home')
    let minutes = est.minutes
    let basis = 'estimate from distance'
    if (travelMode === 'transit') {
      const info = cachedRouteInfo(coords, home)
      if (info) {
        minutes = info.route.minutes
        basis = freshnessLabel({ basis: 'provider', fetchedAt: info.fetchedAt })
      }
    }
    if (minutes !== null) homeSummary = `≈ ${formatRemaining(minutes)} ${TRAVEL_MODE_PHRASE[travelMode]} (${basis})`
  }

  /** One readable card per later/other session: time, title, place, kind. */
  const row = (s: Session, extra?: string) => {
    const place = locationLine(s)
    return (
      <button key={s.id} type="button" className="today-row" onClick={() => onSelect(s)}>
        <span className="today-row-time">
          <span className="today-row-start">{s.start || '—'}</span>
          {s.end && s.end !== s.start && <span className="today-row-end">{s.end}</span>}
        </span>
        <span className="today-row-body">
          <span className="today-row-title">{s.title}</span>
          {place && (
            <span className="today-row-meta">
              <IconPin size={14} />
              <span>{place}</span>
            </span>
          )}
          <span className="today-row-kind">
            <IconBook size={14} />
            <span>
              {sessionKindLabel(s)}
              {extra ? ` · ${extra}` : ''}
            </span>
          </span>
        </span>
        <span className="today-row-chevron" aria-hidden="true">
          <IconChevronRight />
        </span>
      </button>
    )
  }

  return (
    <div className="page page-today">
      <PageHeader
        title="Today"
        subtitle={
          <>
            {longDate(todayISO)} · {profileName}
            {demo ? ' · demo data' : fetchedAt ? ` · updated ${formatAge(fetchedAt)}` : ''}
            {clock.zoneDiffers && <span className="badge" title={`Course time ${clock.courseZone}; your device is on ${clock.deviceZone}`}> · course time {clock.hhmm}</span>}
          </>
        }
        actions={
          <>
            <button type="button" className="btn-icon btn-bell" onClick={onOpenChanges} aria-label="Changes" title="Changes">
              <IconBell />
              {unseenChanges > 0 && <span className="bell-badge">{unseenChanges}</span>}
            </button>
            <button
              type="button"
              className="btn-icon"
              onClick={onRefresh}
              disabled={refreshing}
              aria-label="Refresh"
              title="Refresh"
            >
              {refreshing ? '…' : <IconRefresh />}
            </button>
            <SettingsAction onOpen={onOpenSettings} />
          </>
        }
      />

      {urgent}

      {promptSession && <AttendancePromptCard session={promptSession} onAnswer={onMarkAttendance} />}

      {hero && (
        <section className="today-hero" aria-label={current ? 'Current session' : 'Next session'}>
          <div className="today-hero-top">
            <span className="today-hero-label">
              <IconClock size={14} />
              {heroLabel}
            </span>
            <span className="badge badge-kind">{sessionKindLabel(hero)}</span>
          </div>
          <h2 className="today-hero-title">
            {heroSplit ? (
              <>
                <span className="today-hero-head">{heroSplit.head}</span>
                <span className="visually-hidden">{heroSplit.sep}</span>
                <span className="today-hero-sub">{heroSplit.tail}</span>
              </>
            ) : (
              hero.title
            )}
          </h2>
          {hero.subject && hero.subject !== hero.title && !heroSplit && <p className="today-hero-subject">{hero.subject}</p>}
          <ul className="today-hero-facts" aria-label="When and where">
            <li className="today-fact">
              <IconClock />
              <span className="today-hero-time">
                {hero.start}
                {hero.end && hero.end !== hero.start ? `–${hero.end}` : ''}
              </span>
            </li>
            {(heroRoom.room || heroRoom.building) && (
              <li className="today-fact today-fact-room">
                <IconPin />
                <span>
                  {heroRoom.building && <span className="today-hero-building">{heroRoom.building}</span>}
                  {heroRoom.building && heroRoom.room ? ' · ' : ''}
                  {heroRoom.room && <span className="today-hero-room-name">{heroRoom.room}</span>}
                </span>
              </li>
            )}
          </ul>
          <div className="today-hero-actions">
            <button type="button" className="btn-primary" onClick={() => onSelect(hero)}>
              Session details
            </button>
            {heroTravel && (
              <a className="btn-secondary btn-link" href={heroTravel.mapsUrl} target="_blank" rel="noopener noreferrer">
                Directions ↗
              </a>
            )}
          </div>
          {heroTravel?.minutes != null && locationEnabled && (
            <p className="filter-hint">≈ {formatRemaining(heroTravel.minutes)} from your location (estimate)</p>
          )}
        </section>
      )}

      {alsoNow.length > 0 && (
        <section className="today-also-now" aria-label="Also now">
          <h3 className="subheading">
            Also now
            {clashCount > 1 && <span className="today-clash"> · {clashCount} at the same time</span>}
          </h3>
          <div className="today-rest">
            {alsoNow.map((s) => row(s, [s.end ? `ends ${s.end}` : '', s.isFreeTime ? 'free — not a clash' : ''].filter(Boolean).join(' · ') || undefined))}
          </div>
        </section>
      )}

      {todays.length === 0 && (
        <EmptyState
          title="Nothing on today"
          hint={nextDayLine}
          action={
            <div className="btn-row">
              <button type="button" className="btn-secondary" onClick={onOpenSchedule}>
                See the week
              </button>
              <button type="button" className="btn-secondary" onClick={onOpenTasks}>
                See deadlines
              </button>
            </div>
          }
        />
      )}

      {dayFinished && !homePromoted && (
        <Card tone="accent" className="today-finished">
          <p className="today-finished-title">That's the day done</p>
          <p className="filter-hint">{nextDayLine}</p>
          <div className="btn-row">
            <button type="button" className="btn-secondary" onClick={onOpenSchedule}>
              See the week
            </button>
            <button type="button" className="btn-secondary" onClick={onOpenTasks}>
              See deadlines
            </button>
          </div>
        </Card>
      )}

      {rest.length > 0 && (
        <section aria-label="Rest of today">
          <div className="today-section-head">
            <h3 className="subheading">Rest of today</h3>
            <button type="button" className="travel-link" onClick={onOpenSchedule}>
              View day →
            </button>
          </div>
          <div className="today-rest">
            {rest.map((s, i) => {
              const prev = i === 0 ? hero : rest[i - 1]
              const gap =
                prev && toMinutes(prev.end) !== null && toMinutes(s.start) !== null
                  ? toMinutes(s.start)! - toMinutes(prev.end)!
                  : 0
              return (
                <div key={s.id}>
                  {gap >= 30 && (
                    <div className="free-gap">
                      <IconClock size={14} /> {formatRemaining(gap)} break
                    </div>
                  )}
                  {row(s)}
                </div>
              )
            })}
          </div>
        </section>
      )}

      {untimed.length > 0 && (
        <section aria-label="Today, no set time">
          <h3 className="subheading">Today, no set time</h3>
          <div className="today-rest">{untimed.map((s) => row(s))}</div>
        </section>
      )}

      {finished.length > 0 && (
        <section aria-label="Finished today">
          <button type="button" className="travel-link" aria-expanded={showFinished} onClick={() => setShowFinished((v) => !v)}>
            {showFinished ? 'Hide finished sessions' : `Show ${finished.length} finished session${finished.length === 1 ? '' : 's'}`}
          </button>
          {showFinished && <div className="today-rest today-rest-finished">{finished.map((s) => row(s, s.end ? `ended ${s.end}` : undefined))}</div>}
        </section>
      )}

      {nextDeadline && (
        <button type="button" className="keydate-strip" onClick={onOpenTasks}>
          <span className="keydate-title">
            <IconNote size={14} /> {nextDeadline.title}
          </span>
          <span className={`kd-chip${daysUntil(nextDeadline.dateISO, todayISO) <= 7 ? ' urgent' : ''}`}>
            {(() => {
              const days = daysUntil(nextDeadline.dateISO, todayISO)
              return days < 0 ? `${Math.abs(days)}d overdue` : days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : `in ${days}d`
            })()}
          </span>
        </button>
      )}

      {homeSet && (
        <Card tone={homePromoted ? 'accent' : 'default'} className="home-row">
          <span className="home-row-icon" aria-hidden="true">
            <IconHome />
          </span>
          <div className="home-row-text">
            <span className="home-row-title">{homePromoted ? 'Ready to head home?' : 'Journey home'}</span>
            <span className="filter-hint">
              {homeSummary ?? (locationEnabled ? 'Live route, departures and map' : 'Route, map and directions home')}
            </span>
          </div>
          <div className="home-row-actions">
            <button type="button" className="btn-secondary" onClick={onOpenHomeJourney}>
              View journey
            </button>
            {homePromoted && (
              <button type="button" className="btn-icon" aria-label="Dismiss for today" onClick={dismissHome}>
                <IconClose />
              </button>
            )}
          </div>
        </Card>
      )}

      {todays.length > 0 && nextDay && !dayFinished && <p className="filter-hint today-tomorrow">{nextDayLine}</p>}
    </div>
  )
}
