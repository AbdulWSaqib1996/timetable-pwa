import { useModalA11y } from '../lib/a11y'
import { matchBuilding } from '../lib/campus'
import { sessionKey } from '../lib/diff'
import { baseSubject, isPlacementSession, placementTag, shortenRoom, toMinutes } from '../lib/format'
import type { MetaMap, Session } from '../types'

interface Props {
  sessions: Session[]
  metaMap: MetaMap
  todayISO: string
  /** merged key dates (sheet + personal), for the deadlines tile */
  keyDates?: Session[]
  /** course requirement for assessed school days, from Settings */
  placementTargetDays?: number
  /** counts from the PGCE admin file */
  adminCounts?: { observations: number; lessons: number }
  onClose: () => void
}

function mondayOf(dateISO: string): string {
  const [y, m, d] = dateISO.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7))
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function computeStats(
  sessions: Session[],
  metaMap: MetaMap,
  todayISO: string,
  keyDates: Session[],
  placementTargetDays?: number
) {
  // Placement (school-experience) days count separately from taught hours.
  const placementSessions = sessions.filter((s) => !s.isKeyDate && isPlacementSession(s))
  const taught = sessions.filter((s) => !s.isSelfStudy && !s.isKeyDate && !isPlacementSession(s))
  const hours = (s: Session) => {
    const start = toMinutes(s.start)
    const end = toMinutes(s.end)
    return start !== null && end !== null && end > start ? (end - start) / 60 : 0
  }
  const totalHours = taught.reduce((n, s) => n + hours(s), 0)
  const past = taught.filter((s) => s.dateISO <= todayISO)
  const attended = past.filter((s) => metaMap[sessionKey(s)]?.attended).length
  const absent = past.filter((s) => metaMap[sessionKey(s)]?.absent).length

  const byWeek = new Map<string, number>()
  for (const s of taught) byWeek.set(mondayOf(s.dateISO), (byWeek.get(mondayOf(s.dateISO)) ?? 0) + hours(s))
  const busiest = [...byWeek.entries()].sort((a, b) => b[1] - a[1])[0]

  const byBuilding = new Map<string, number>()
  for (const s of taught) {
    if (!s.room) continue
    const name = matchBuilding(s.room)?.name ?? shortenRoom(s.room)
    byBuilding.set(name, (byBuilding.get(name) ?? 0) + 1)
  }
  const topBuilding = [...byBuilding.entries()].sort((a, b) => b[1] - a[1])[0]

  const bySubject = new Map<string, number>()
  for (const s of taught) bySubject.set(s.subject || s.title, (bySubject.get(s.subject || s.title) ?? 0) + 1)
  const topSubject = [...bySubject.entries()].sort((a, b) => b[1] - a[1])[0]

  const starts = taught.map((s) => toMinutes(s.start)).filter((n): n is number => n !== null && n > 0)
  const earliest = starts.length > 0 ? Math.min(...starts) : null

  // Placement days: unique dates per block; attended via the ✓ tick on any of the day's entries.
  const placementByTag = new Map<string, { total: Set<string>; attended: Set<string> }>()
  for (const s of placementSessions) {
    const tag = placementTag(s.title)
    const e = placementByTag.get(tag) ?? { total: new Set<string>(), attended: new Set<string>() }
    e.total.add(s.dateISO)
    if (metaMap[sessionKey(s)]?.attended) e.attended.add(s.dateISO)
    placementByTag.set(tag, e)
  }
  const placementBlocks = [...placementByTag.entries()]
    .map(([tag, e]) => ({ tag, attended: e.attended.size, total: e.total.size }))
    .sort((a, b) => a.tag.localeCompare(b.tag))
  const placementAttended = placementBlocks.reduce((n, b) => n + b.attended, 0)

  const deadlinesDone = keyDates.filter((k) => metaMap[sessionKey(k)]?.status === 'done').length

  return {
    totalSessions: taught.length,
    totalHours: Math.round(totalHours),
    pastCount: past.length,
    attended,
    attendancePct: past.length > 0 ? Math.round((attended / past.length) * 100) : null,
    absent,
    busiestWeek: busiest
      ? {
          label: new Date(busiest[0]).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
          hours: Math.round(busiest[1]),
        }
      : null,
    topBuilding: topBuilding ? { name: topBuilding[0], count: topBuilding[1] } : null,
    topSubject: topSubject ? { name: topSubject[0], count: topSubject[1] } : null,
    earliestStart: earliest !== null ? `${String(Math.floor(earliest / 60)).padStart(2, '0')}:${String(earliest % 60).padStart(2, '0')}` : null,
    placementAttended,
    placementTarget: placementTargetDays,
    placementBlocks,
    deadlinesDone,
    deadlinesTotal: keyDates.length,
  }
}

function buildTiles(stats: ReturnType<typeof computeStats>): { big: string; small: string }[] {
  const tiles: { big: string; small: string }[] = [
    { big: `${stats.totalSessions}`, small: 'sessions on the timetable' },
    { big: `${stats.totalHours}h`, small: 'of taught time' },
  ]
  if (stats.attendancePct !== null)
    tiles.push({ big: `${stats.attendancePct}%`, small: `attendance (${stats.attended}/${stats.pastCount} marked)` })
  if (stats.absent > 0) tiles.push({ big: `${stats.absent}`, small: 'absences recorded' })
  if (stats.placementBlocks.length > 0)
    tiles.push({
      big: `${stats.placementAttended}${stats.placementTarget ? `/${stats.placementTarget}` : ''}`,
      small: 'school days at placement',
    })
  if (stats.deadlinesTotal > 0)
    tiles.push({ big: `${stats.deadlinesDone}/${stats.deadlinesTotal}`, small: 'deadlines submitted' })
  if (stats.busiestWeek) tiles.push({ big: `${stats.busiestWeek.hours}h`, small: `busiest week (w/c ${stats.busiestWeek.label})` })
  if (stats.topBuilding) tiles.push({ big: `${stats.topBuilding.count}×`, small: `most-visited: ${stats.topBuilding.name}` })
  if (stats.topSubject) tiles.push({ big: `${stats.topSubject.count}×`, small: `top subject: ${stats.topSubject.name}` })
  if (stats.earliestStart) tiles.push({ big: stats.earliestStart, small: 'earliest start' })
  return tiles
}

async function shareStatsImage(tiles: { big: string; small: string }[]): Promise<void> {
  const width = 620
  const height = 120 + tiles.length * 72 + 48
  const canvas = document.createElement('canvas')
  canvas.width = width * 2
  canvas.height = height * 2
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.scale(2, 2)
  const gradient = ctx.createLinearGradient(0, 0, width, height)
  gradient.addColorStop(0, '#1a1f36')
  gradient.addColorStop(1, '#101322')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, width, height)
  ctx.fillStyle = '#8da2f0'
  ctx.font = '700 15px -apple-system, "Segoe UI", Roboto, sans-serif'
  ctx.fillText('MY TIMETABLE · TERM SO FAR', 36, 52)
  tiles.forEach(({ big, small }, i) => {
    const y = 120 + i * 72
    ctx.fillStyle = '#ffffff'
    ctx.font = '800 34px -apple-system, "Segoe UI", Roboto, sans-serif'
    ctx.fillText(big, 36, y)
    ctx.fillStyle = '#9aa1b5'
    ctx.font = '500 15px -apple-system, "Segoe UI", Roboto, sans-serif'
    ctx.fillText(small, 200, y - 6)
  })
  ctx.fillStyle = '#5b6178'
  ctx.font = '400 12px -apple-system, "Segoe UI", Roboto, sans-serif'
  ctx.fillText('made with My Timetable', 36, height - 24)

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) return
  const file = new File([blob], 'my-term.png', { type: 'image/png' })
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'My term so far' })
      return
    } catch {
      /* cancelled */
    }
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'my-term.png'
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export function StatsSheet({ sessions, metaMap, todayISO, keyDates = [], placementTargetDays, adminCounts, onClose }: Props) {
  const dialogRef = useModalA11y<HTMLDivElement>(onClose)
  const stats = computeStats(sessions, metaMap, todayISO, keyDates, placementTargetDays)

  // Sessions per subject: "Maths 1" and "Maths 2" both count as Maths.
  const subjectGroups = (() => {
    const bySubject = new Map<string, { count: number; hours: number; attended: number; past: number }>()
    for (const s of sessions) {
      const base = baseSubject(s)
      if (!base) continue
      const g = bySubject.get(base) ?? { count: 0, hours: 0, attended: 0, past: 0 }
      g.count++
      const start = toMinutes(s.start)
      const end = toMinutes(s.end)
      if (start !== null && end !== null && end > start) g.hours += (end - start) / 60
      if (s.dateISO <= todayISO) {
        g.past++
        if (metaMap[sessionKey(s)]?.attended) g.attended++
      }
      bySubject.set(base, g)
    }
    const all = [...bySubject.entries()].sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]))
    // Sentence-length names are calendar notes (holidays, deferred-assessment
    // rows), not subjects — bucket them with the one-offs.
    const isSubjectish = ([name, g]: (typeof all)[number]) => g.count >= 2 && name.length <= 40
    return {
      main: all.filter(isSubjectish),
      oneOffs: all.filter((e) => !isSubjectish(e)).length,
    }
  })()
  const tiles = buildTiles(stats)
  if (adminCounts?.lessons) tiles.push({ big: `${adminCounts.lessons}`, small: 'lessons taught (logged)' })
  if (adminCounts?.observations) tiles.push({ big: `${adminCounts.observations}`, small: 'observations received' })

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        ref={dialogRef}
        className="modal-card sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Term stats"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet-header">
          <h2>Term so far</h2>
          <button type="button" className="btn-icon" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="stats-grid">
          {tiles.map((t, i) => (
            <div className="stat-tile" key={i}>
              <span className="stat-big">{t.big}</span>
              <span className="stat-small">{t.small}</span>
            </div>
          ))}
        </div>
        {stats.placementBlocks.length > 0 && (
          <p className="filter-hint">
            Placement blocks:{' '}
            {stats.placementBlocks.map((b) => `${b.tag} ${b.attended}/${b.total}`).join(' · ')} — tick
            “Attended” on a placement day to log it.
          </p>
        )}
        {subjectGroups.main.length > 0 && (
          <>
            <h3 className="subheading">Sessions by subject</h3>
            <p className="filter-hint">
              Numbered sessions count as one subject — Maths 1 and Maths 2 are both Maths.
            </p>
            <ul className="subject-count-list">
              {subjectGroups.main.map(([name, g]) => (
                <li key={name}>
                  <span className="subject-count-name">{name}</span>
                  <span className="subject-count-nums">
                    {g.count} session{g.count === 1 ? '' : 's'}
                    {g.hours > 0 && ` · ${Math.round(g.hours)}h`}
                    {g.past > 0 && ` · ${g.attended}/${g.past} attended`}
                  </span>
                </li>
              ))}
            </ul>
            {subjectGroups.oneOffs > 0 && (
              <p className="filter-hint">
                + {subjectGroups.oneOffs} one-off entries (audits, admin days…) not listed.
              </p>
            )}
          </>
        )}
        <div className="modal-actions">
          <button type="button" className="btn-primary" onClick={() => void shareStatsImage(tiles)}>
            📸 Share as image
          </button>
          <button type="button" className="btn-ghost" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
