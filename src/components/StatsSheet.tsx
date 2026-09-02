import { matchBuilding } from '../lib/campus'
import { sessionKey } from '../lib/diff'
import { shortenRoom, toMinutes } from '../lib/format'
import type { MetaMap, Session } from '../types'

interface Props {
  sessions: Session[]
  metaMap: MetaMap
  todayISO: string
  onClose: () => void
}

function mondayOf(dateISO: string): string {
  const [y, m, d] = dateISO.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7))
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function computeStats(sessions: Session[], metaMap: MetaMap, todayISO: string) {
  const taught = sessions.filter((s) => !s.isSelfStudy && !s.isKeyDate)
  const hours = (s: Session) => {
    const start = toMinutes(s.start)
    const end = toMinutes(s.end)
    return start !== null && end !== null && end > start ? (end - start) / 60 : 0
  }
  const totalHours = taught.reduce((n, s) => n + hours(s), 0)
  const past = taught.filter((s) => s.dateISO <= todayISO)
  const attended = past.filter((s) => metaMap[sessionKey(s)]?.attended).length

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

  return {
    totalSessions: taught.length,
    totalHours: Math.round(totalHours),
    pastCount: past.length,
    attended,
    attendancePct: past.length > 0 ? Math.round((attended / past.length) * 100) : null,
    busiestWeek: busiest
      ? {
          label: new Date(busiest[0]).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
          hours: Math.round(busiest[1]),
        }
      : null,
    topBuilding: topBuilding ? { name: topBuilding[0], count: topBuilding[1] } : null,
    topSubject: topSubject ? { name: topSubject[0], count: topSubject[1] } : null,
    earliestStart: earliest !== null ? `${String(Math.floor(earliest / 60)).padStart(2, '0')}:${String(earliest % 60).padStart(2, '0')}` : null,
  }
}

async function shareStatsImage(stats: ReturnType<typeof computeStats>): Promise<void> {
  const width = 620
  const height = 560
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
  const rows: [string, string][] = []
  rows.push([`${stats.totalSessions}`, 'sessions on the timetable'])
  rows.push([`${stats.totalHours}h`, 'of taught time'])
  if (stats.attendancePct !== null) rows.push([`${stats.attendancePct}%`, `attendance (${stats.attended}/${stats.pastCount} marked)`])
  if (stats.busiestWeek) rows.push([`${stats.busiestWeek.hours}h`, `busiest week (w/c ${stats.busiestWeek.label})`])
  if (stats.topBuilding) rows.push([`${stats.topBuilding.count}×`, `most-visited: ${stats.topBuilding.name}`])
  if (stats.earliestStart) rows.push([stats.earliestStart, 'earliest start'])
  rows.forEach(([big, small], i) => {
    const y = 120 + i * 72
    ctx.fillStyle = '#ffffff'
    ctx.font = '800 34px -apple-system, "Segoe UI", Roboto, sans-serif'
    ctx.fillText(big, 36, y)
    ctx.fillStyle = '#9aa1b5'
    ctx.font = '500 15px -apple-system, "Segoe UI", Roboto, sans-serif'
    ctx.fillText(small, 170, y - 6)
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

export function StatsSheet({ sessions, metaMap, todayISO, onClose }: Props) {
  const stats = computeStats(sessions, metaMap, todayISO)
  const tiles: { big: string; small: string }[] = [
    { big: `${stats.totalSessions}`, small: 'sessions on the timetable' },
    { big: `${stats.totalHours}h`, small: 'of taught time' },
  ]
  if (stats.attendancePct !== null)
    tiles.push({ big: `${stats.attendancePct}%`, small: `attendance (${stats.attended}/${stats.pastCount} marked)` })
  if (stats.busiestWeek) tiles.push({ big: `${stats.busiestWeek.hours}h`, small: `busiest week (w/c ${stats.busiestWeek.label})` })
  if (stats.topBuilding) tiles.push({ big: `${stats.topBuilding.count}×`, small: `most-visited: ${stats.topBuilding.name}` })
  if (stats.topSubject) tiles.push({ big: `${stats.topSubject.count}×`, small: `top subject: ${stats.topSubject.name}` })
  if (stats.earliestStart) tiles.push({ big: stats.earliestStart, small: 'earliest start' })

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card sheet" role="dialog" aria-label="Term stats" onClick={(e) => e.stopPropagation()}>
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
        <div className="modal-actions">
          <button type="button" className="btn-primary" onClick={() => void shareStatsImage(stats)}>
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
