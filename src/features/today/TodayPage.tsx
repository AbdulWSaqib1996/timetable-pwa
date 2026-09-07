import { useEffect, useState } from 'react'
import { estimateTravel, estimateTravelToCoords } from '../../lib/campus'
import type { Coords, TravelMode } from '../../lib/campus'
import { sessionKey } from '../../lib/diff'
import { daysUntil, formatRemaining, isPlacementSession, placementTag, toMinutes } from '../../lib/format'
import { parseLocation, shortBuildingName } from '../../lib/location'
import { freshnessLabel } from '../../../shared/travel-state.js'
import { cachedRouteInfo } from '../../lib/tfl'
import { TRAVEL_MODE_PHRASE } from '../../lib/campus'
import { Card, EmptyState, IconBell, IconRefresh, IconSettings, PageHeader } from '../../components/ui'
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
 * Today (P4-02): date header, at most one urgent item, next/current session
 * hero with a prominent room, the rest of the day with meaningful gaps, the
 * journey-home entry, and a restrained tomorrow preview.
 */
export function TodayPage({
  profileName,
  todayISO,
  fetchedAt,
  refreshing,
  demo,
  onRefresh,
  courseSessions,
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
  onOpenTasks,
  onOpenSchedule,
  onOpenHomeJourney,
}: Props) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000)
    return () => clearInterval(t)
  }, [])
  const nowMins = now.getHours() * 60 + now.getMinutes()

  const todays = courseSessions.filter((s) => s.dateISO === todayISO && !s.isKeyDate)
  const current = todays.find((s) => {
    const start = toMinutes(s.start)
    const end = toMinutes(s.end)
    return start !== null && end !== null && start <= nowMins && nowMins < end
  })
  const upcoming = todays.filter((s) => {
    const start = toMinutes(s.start)
    return start !== null && start > nowMins
  })
  const hero = current ?? upcoming[0] ?? null
  const rest = todays.filter((s) => s !== hero && (toMinutes(s.start) ?? 0) > (hero ? toMinutes(hero.start) ?? 0 : nowMins))
  const dayFinished = todays.length > 0 && !hero

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
  const tomorrowISO = (() => {
    const [y, m, d] = todayISO.split('-').map(Number)
    const t = new Date(y, m - 1, d + 1)
    return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`
  })()

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

  return (
    <div className="page page-today">
      <PageHeader
        title="Today"
        subtitle={
          <>
            {longDate(todayISO)} · {profileName}
            {demo ? ' · demo data' : fetchedAt ? ` · updated ${formatAge(fetchedAt)}` : ''}
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
            <button type="button" className="btn-icon" onClick={onOpenSettings} aria-label="Settings" title="Settings">
              <IconSettings />
            </button>
          </>
        }
      />

      {urgent}

      {hero && (
        <section className="today-hero" aria-label={current ? 'Current session' : 'Next session'}>
          <span className="today-hero-label">{heroLabel}</span>
          <span className="today-hero-time">
            {hero.start}
            {hero.end && hero.end !== hero.start ? `–${hero.end}` : ''}
            {hero.subject && hero.subject !== hero.title ? ` · ${hero.subject}` : ''}
          </span>
          <h2 className="today-hero-title">{hero.title}</h2>
          {(heroRoom.room || heroRoom.building) && (
            <div className="today-hero-room">
              {heroRoom.room && <span className="today-hero-room-name">{heroRoom.room}</span>}
              {heroRoom.building && <span className="today-hero-building">{heroRoom.building}</span>}
            </div>
          )}
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

      {todays.length === 0 && (
        <EmptyState
          title="Nothing on today"
          hint={
            nextDay
              ? nextDay.dateISO === tomorrowISO
                ? `Tomorrow: ${nextDaySessions.length} session${nextDaySessions.length === 1 ? '' : 's'}, first at ${nextDaySessions[0]?.start}.`
                : `Next sessions: ${longDate(nextDay.dateISO)}.`
              : 'No upcoming sessions found in this timetable.'
          }
          action={
            <div className="btn-row">
              <button type="button" className="btn-secondary" onClick={onOpenSchedule}>
                Open Schedule
              </button>
              <button type="button" className="btn-secondary" onClick={onOpenTasks}>
                Open Tasks
              </button>
            </div>
          }
        />
      )}

      {dayFinished && !homePromoted && (
        <Card tone="accent" className="today-finished">
          <p className="today-finished-title">That's the day done 🎉</p>
        </Card>
      )}

      {rest.length > 0 && (
        <section aria-label="Rest of today">
          <h3 className="subheading">Rest of today</h3>
          <div className="today-rest">
            {rest.map((s, i) => {
              const prev = i === 0 ? hero : rest[i - 1]
              const gap =
                prev && toMinutes(prev.end) !== null && toMinutes(s.start) !== null
                  ? toMinutes(s.start)! - toMinutes(prev.end)!
                  : 0
              const loc = roomLines(s)
              return (
                <div key={s.id}>
                  {gap >= 30 && <div className="free-gap">☕ {formatRemaining(gap)} break</div>}
                  <button type="button" className="today-row" onClick={() => onSelect(s)}>
                    <span className="today-row-time">{s.start}</span>
                    <span className="today-row-body">
                      <span className="today-row-title">{s.title}</span>
                      <span className="today-row-meta">
                        {[loc.room, loc.building, s.end ? `ends ${s.end}` : '']
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </span>
                  </button>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {nextDeadline && (
        <button type="button" className="keydate-strip" onClick={onOpenTasks}>
          <span className="keydate-title">📌 {nextDeadline.title}</span>
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
                ✕
              </button>
            )}
          </div>
        </Card>
      )}

      {todays.length > 0 && nextDay && (
        <p className="filter-hint today-tomorrow">
          {nextDay.dateISO === tomorrowISO
            ? `Tomorrow: ${nextDaySessions.length} session${nextDaySessions.length === 1 ? '' : 's'}, first at ${nextDaySessions[0]?.start} — ${nextDaySessions[0]?.title}.`
            : `Next sessions: ${longDate(nextDay.dateISO)} (${nextDaySessions.length}).`}
        </p>
      )}
    </div>
  )
}
