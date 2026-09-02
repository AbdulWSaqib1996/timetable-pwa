import { useEffect, useState } from 'react'
import { formatRemaining, shortenRoom, toMinutes } from '../lib/format'
import { weatherEmoji, weatherForHour } from '../lib/weather'
import type { HourWeather } from '../lib/weather'
import type { Session } from '../types'

interface Props {
  /** filtered sessions across all dates, sorted by date+start */
  sessions: Session[]
  onSelect: (session: Session) => void
}

function localISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function whenLabel(session: Session, now: Date): string {
  const todayISO = localISO(now)
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
  if (session.dateISO === todayISO) {
    const start = toMinutes(session.start)
    const nowMins = now.getHours() * 60 + now.getMinutes()
    const inMins = start !== null ? start - nowMins : null
    return inMins !== null && inMins > 0
      ? `today ${session.start} · in ${formatRemaining(inMins)}`
      : `today ${session.start}`
  }
  if (session.dateISO === localISO(tomorrow)) return `tomorrow ${session.start}`
  const [y, m, d] = session.dateISO.split('-').map(Number)
  return `${new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })} ${session.start}`
}

export function NowNextCard({ sessions, onSelect }: Props) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000)
    return () => clearInterval(t)
  }, [])

  const todayISO = localISO(now)
  const nowMins = now.getHours() * 60 + now.getMinutes()

  const current = sessions.find((s) => {
    if (s.dateISO !== todayISO) return false
    const start = toMinutes(s.start)
    const end = toMinutes(s.end)
    return start !== null && end !== null && start <= nowMins && nowMins < end
  })

  const next = sessions.find((s) => {
    if (s.dateISO < todayISO) return false
    if (s.dateISO > todayISO) return true
    const start = toMinutes(s.start)
    return start !== null && start > nowMins
  })

  const session = current ?? next
  const sessionDate = session?.dateISO
  const sessionHour = session ? toMinutes(session.start) : null
  const [weather, setWeather] = useState<HourWeather | null>(null)
  useEffect(() => {
    setWeather(null)
    if (!sessionDate || sessionHour === null) return
    let cancelled = false
    void weatherForHour(sessionDate, Math.floor(sessionHour / 60)).then((w) => {
      if (!cancelled) setWeather(w)
    })
    return () => {
      cancelled = true
    }
  }, [sessionDate, sessionHour])

  if (!session) return null

  const endMins = current ? toMinutes(current.end) : null
  const label = current
    ? endMins !== null
      ? `Now · ends ${current.end} (${formatRemaining(endMins - nowMins)} left)`
      : 'Now'
    : `Next · ${whenLabel(session, now)}`

  return (
    <button type="button" className="nownext" onClick={() => onSelect(session)}>
      <span className="nownext-label">{label}</span>
      <span className="nownext-title">{session.title}</span>
      <span className="nownext-meta">
        {!session.isSelfStudy && session.room && <span>{shortenRoom(session.room)}</span>}
        {session.tutor && session.tutor !== 'Self Study' && <span>{session.tutor}</span>}
        {weather && (
          <span title={`Forecast at ${session.start}`}>
            {weatherEmoji(weather.code)} {Math.round(weather.tempC)}°
            {weather.rainProb >= 30 ? ` · ${weather.rainProb}% rain` : ''}
          </span>
        )}
      </span>
    </button>
  )
}
