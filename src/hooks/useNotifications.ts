import { useEffect, useRef } from 'react'
import type { Coords, TravelMode } from '../lib/campus'
import {
  TRAVEL_MODE_PHRASE,
  estimateTravel,
  estimateTravelToCoords,
} from '../lib/campus'
import { DEFAULT_PUSH_BASE } from '../lib/config'
import { sessionKey } from '../lib/diff'
import { localTodayISO } from '../lib/filters'
import {
  daysUntil,
  formatRemaining,
  isPlacementSession,
  placementTag,
  shortenRoom,
  toMinutes,
} from '../lib/format'
import { showReminder } from '../lib/notify'
import { reportLocation } from '../lib/push'
import { loadNotified, saveNotified } from '../lib/storage'
import { cachedRouteMinutes, tflRoute } from '../lib/tfl'
import type { TflDisruption } from '../lib/tfl'
import { cachedWeatherForHour, weatherForHour } from '../lib/weather'
import type { MetaMap, Session, Settings } from '../types'

interface Options {
  settings: Settings | null
  /** sessions with the user's filters applied, all dates */
  exportSessions: Session[]
  allKeyDates: Session[]
  /** per-session meta, to skip attendance prompts for already-ticked sessions */
  metaMap: MetaMap
  coords: Coords | null
  travelMode: TravelMode
  locationEnabled: boolean
  tubeStatus: TflDisruption[]
  /** apply a "✓ Attended"/"✗ Absent" tap that arrived via a notification action */
  onMark: (key: string, kind: 'attended' | 'absent') => void
}

/**
 * In-app notifications while the app is open/installed: session reminders,
 * leave alerts, key-date reminders (30s check loop), notification-action relay
 * from the service worker, and background-leave location reporting.
 */
export function useNotifications({
  settings,
  exportSessions,
  allKeyDates,
  metaMap,
  coords,
  travelMode,
  locationEnabled,
  tubeStatus,
  onMark,
}: Options) {
  const exportRef = useRef(exportSessions)
  exportRef.current = exportSessions
  const metaRef = useRef(metaMap)
  metaRef.current = metaMap
  const keyDatesRef = useRef(allKeyDates)
  keyDatesRef.current = allKeyDates
  const travelRef = useRef({ coords, travelMode, locationEnabled })
  travelRef.current = { coords, travelMode, locationEnabled }
  const tubeStatusRef = useRef(tubeStatus)
  tubeStatusRef.current = tubeStatus
  const placementsRef = useRef(settings?.placements)
  placementsRef.current = settings?.placements
  const onMarkRef = useRef(onMark)
  onMarkRef.current = onMark
  const snoozeUrlRef = useRef<string | undefined>(undefined)
  snoozeUrlRef.current = settings?.pushEnabled ? settings.pushServerBase ?? DEFAULT_PUSH_BASE : undefined

  // Notification action buttons: the service worker relays "attended"/"snooze"
  // taps to an open window via postMessage.
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    const onMessage = (event: MessageEvent) => {
      const msg = event.data as { type?: string; action?: string; key?: string; title?: string; body?: string }
      if (msg?.type !== 'timetable-action' || !msg.key) return
      if (msg.action === 'attended' || msg.action === 'absent') {
        onMarkRef.current(msg.key, msg.action)
      } else if (msg.action === 'snooze' && msg.title) {
        setTimeout(() => showReminder(msg.title!, msg.body ?? '', msg.key, snoozeUrlRef.current), 10 * 60_000)
      }
    }
    navigator.serviceWorker.addEventListener('message', onMessage)
    return () => navigator.serviceWorker.removeEventListener('message', onMessage)
  }, [])

  // Background leave alerts: cache the latest app-open location to the push worker,
  // throttled to every 15 minutes or a ~300 m move.
  const bgLeaveOn = settings?.bgLeaveAlerts === true && settings?.pushEnabled === true
  useEffect(() => {
    if (!bgLeaveOn || !coords) return
    try {
      const last = JSON.parse(localStorage.getItem('timetable.locreport.v1') ?? 'null') as {
        lat: number
        lng: number
        at: number
      } | null
      const moved =
        !last ||
        Math.abs(last.lat - coords.lat) > 0.003 ||
        Math.abs(last.lng - coords.lng) > 0.005 ||
        Date.now() - last.at > 15 * 60_000
      if (!moved) return
      localStorage.setItem(
        'timetable.locreport.v1',
        JSON.stringify({ lat: coords.lat, lng: coords.lng, at: Date.now() })
      )
      void reportLocation(settings?.pushServerBase ?? DEFAULT_PUSH_BASE, coords.lat, coords.lng).catch(() => {})
    } catch {
      /* storage unavailable */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bgLeaveOn, coords?.lat, coords?.lng])

  // Session reminders + leave alerts: checked every 30s while the app is running.
  // Multiple offsets are supported (e.g. 60 and 15 → two notifications); when several
  // offsets are due at once (say the app was just opened), only one fires per session.
  const offsetsKey = JSON.stringify(settings?.reminderOffsets ?? [])
  const leaveKey = JSON.stringify(settings?.leaveAlertOffsets ?? [])
  const kdDaysKey = JSON.stringify(settings?.keyDateReminderDays ?? [])
  const attendancePrompts = settings?.attendancePrompts === true
  const quietRef = useRef({ from: settings?.quietFrom, to: settings?.quietTo })
  quietRef.current = { from: settings?.quietFrom, to: settings?.quietTo }
  useEffect(() => {
    const offsets = (JSON.parse(offsetsKey) as number[]).sort((a, b) => a - b)
    const leaveOffsets = (JSON.parse(leaveKey) as number[]).sort((a, b) => a - b)
    const kdDays = (JSON.parse(kdDaysKey) as number[]).sort((a, b) => a - b)
    if (
      (offsets.length === 0 && leaveOffsets.length === 0 && kdDays.length === 0 && !attendancePrompts) ||
      typeof Notification === 'undefined'
    )
      return
    const notify = (title: string, body: string, key?: string) =>
      showReminder(title, body, key, snoozeUrlRef.current)
    const check = () => {
      if (Notification.permission !== 'granted') return
      const now = new Date()
      // Quiet hours: skip without marking anything notified, so alerts still
      // relevant afterwards fire on the first check outside the window.
      const { from: qFrom, to: qTo } = quietRef.current
      if (typeof qFrom === 'number' && typeof qTo === 'number' && qFrom !== qTo) {
        const h = now.getHours()
        if (qFrom < qTo ? h >= qFrom && h < qTo : h >= qFrom || h < qTo) return
      }
      const today = localTodayISO()
      const nowMins = now.getHours() * 60 + now.getMinutes()
      const notified = loadNotified()
      let dirty = false
      const { coords: here, travelMode: mode, locationEnabled: locEnabled } = travelRef.current
      for (const s of exportRef.current) {
        if (s.dateISO !== today || !s.start) continue
        const start = toMinutes(s.start)
        if (start === null) continue
        const delta = start - nowMins
        if (delta <= 0) continue

        // Fixed "before the session" reminders.
        const due = offsets.filter((m) => delta <= m && !notified[`${sessionKey(s)}#${m}`])
        if (due.length > 0) {
          notify(
            s.title,
            `Starts ${s.start} (in ${formatRemaining(delta)})${s.room && !s.isSelfStudy ? ` · ${shortenRoom(s.room)}` : ''}`,
            sessionKey(s)
          )
          for (const m of due) notified[`${sessionKey(s)}#${m}`] = Date.now()
          dirty = true
        }

        // "Time to leave" alerts: leave-by = start − live travel estimate; alert with head start.
        if (leaveOffsets.length > 0 && locEnabled && here && (s.room || isPlacementSession(s)) && !s.isSelfStudy) {
          void weatherForHour(today, Math.floor(start / 60)) // warm the forecast cache
          let est = estimateTravel(s.room, here, mode)
          if (est.minutes === null && isPlacementSession(s)) {
            const placement = placementsRef.current?.[placementTag(s.title)]
            if (placement?.lat != null && placement?.lng != null) {
              est = estimateTravelToCoords(
                { lat: placement.lat, lng: placement.lng },
                here,
                mode,
                placement.school || 'placement school'
              )
            }
          }
          if (est.minutes !== null) {
            // In transit mode, prefer the live TfL journey time (cache warmed here, used
            // next tick) so disruptions automatically make the alert fire earlier.
            let travelMins = est.minutes
            let liveLabel = ''
            if (mode === 'transit' && est.location) {
              void tflRoute(here, est.location)
              const live = cachedRouteMinutes(here, est.location)
              if (live !== null) {
                travelMins = live
                liveLabel = ' (live TfL)'
              }
            }
            const untilLeave = delta - travelMins
            const leaveDue = leaveOffsets.filter(
              (m) => untilLeave <= m && !notified[`${sessionKey(s)}#leave#${m}`]
            )
            if (leaveDue.length > 0) {
              const disruptionNote =
                mode === 'transit' && tubeStatusRef.current.length > 0
                  ? ` · ⚠ TfL: ${tubeStatusRef.current
                      .slice(0, 2)
                      .map((d) => `${d.line} ${d.status.toLowerCase()}`)
                      .join(', ')}`
                  : ''
              const forecast = cachedWeatherForHour(today, Math.floor(start / 60))
              const weatherNote =
                forecast && forecast.rainProb >= 50 ? ` · 🌧 ${forecast.rainProb}% rain — allow extra time` : ''
              notify(
                untilLeave <= 0 ? `Time to leave — ${s.title}` : `Leave in ${formatRemaining(untilLeave)} — ${s.title}`,
                `≈ ${formatRemaining(travelMins)} ${TRAVEL_MODE_PHRASE[mode]}${liveLabel} to ${est.building ?? shortenRoom(s.room)} · starts ${s.start}${disruptionNote}${weatherNote}`,
                sessionKey(s)
              )
              for (const m of leaveDue) notified[`${sessionKey(s)}#leave#${m}`] = Date.now()
              dirty = true
            }
          }
        }
      }
      // End-of-session attendance prompts: fire once within 30 min of each end time,
      // skipping sessions already ticked. A push-worker copy may also arrive; the
      // shared notification tag makes it replace this one instead of doubling up.
      if (attendancePrompts) {
        for (const s of exportRef.current) {
          if (s.dateISO !== today || s.isSelfStudy || s.isKeyDate || !s.end) continue
          const end = toMinutes(s.end)
          if (end === null) continue
          const since = nowMins - end
          const key = sessionKey(s)
          const marked = metaRef.current[key]?.attended || metaRef.current[key]?.absent
          if (since < 0 || since > 30 || notified[`${key}#att`] || marked) continue
          showReminder(`Did you attend ${s.title}?`, 'Tap ✓ Attended to log it.', key, snoozeUrlRef.current, `att-${key}`)
          notified[`${key}#att`] = Date.now()
          dirty = true
        }
      }
      // Key-date reminders: N days before each deadline (one notification per offset).
      if (kdDays.length > 0) {
        const today = localTodayISO()
        for (const kd of keyDatesRef.current) {
          if (kd.dateISO < today) continue
          const days = daysUntil(kd.dateISO, today)
          const due = kdDays.filter((d) => days <= d && !notified[`${sessionKey(kd)}#kd#${d}`])
          if (due.length === 0) continue
          notify(
            `📌 ${kd.title}`,
            days === 0
              ? `Due today${kd.start ? ` at ${kd.start}` : ''}`
              : `Due in ${days} day${days === 1 ? '' : 's'} (${kd.dateISO.split('-').reverse().join('/')})`,
            sessionKey(kd)
          )
          for (const d of due) notified[`${sessionKey(kd)}#kd#${d}`] = Date.now()
          dirty = true
        }
      }
      if (dirty) saveNotified(notified)
    }
    check()
    const t = setInterval(check, 30_000)
    return () => clearInterval(t)
  }, [offsetsKey, leaveKey, kdDaysKey, attendancePrompts])
}
