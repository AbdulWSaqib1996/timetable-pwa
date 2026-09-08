import { useEffect, useState } from 'react'
import { utcToZonedParts } from '../../shared/calendar-time.js'
import { courseZone } from '../lib/course'

export interface CourseClock {
  nowMs: number
  /** course-local calendar date */
  todayISO: string
  /** course-local minutes from midnight */
  nowMins: number
  hhmm: string
  courseZone: string
  deviceZone: string
  /** the device's clock is in a different zone from the course */
  zoneDiffers: boolean
}

function read(nowMs: number): CourseClock {
  const zone = courseZone()
  const wall = utcToZonedParts(nowMs, zone)
  let deviceZone = 'unknown'
  try {
    deviceZone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'unknown'
  } catch {
    /* keep unknown */
  }
  return {
    nowMs,
    todayISO: wall.dateISO,
    nowMins: Number(wall.hhmm.slice(0, 2)) * 60 + Number(wall.hhmm.slice(3, 5)),
    hhmm: wall.hhmm,
    courseZone: zone,
    deviceZone,
    zoneDiffers: deviceZone !== 'unknown' && deviceZone !== zone,
  }
}

/**
 * ONE course clock (R1 / TT-05): "now" and "today" in the course timezone,
 * derived from the UTC instant via the shared conversion helpers. Ticks
 * every 30 s and on visibility resume, so a tab left open stays honest
 * across midnight and after sleep. View code compares course wall minutes
 * against course wall minutes — never device `getHours()`.
 */
export function useCourseClock(): CourseClock {
  const [clock, setClock] = useState(() => read(Date.now()))
  useEffect(() => {
    const tick = () => setClock(read(Date.now()))
    const t = setInterval(tick, 30_000)
    const onVisible = () => {
      if (document.visibilityState === 'visible') tick()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(t)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])
  return clock
}
