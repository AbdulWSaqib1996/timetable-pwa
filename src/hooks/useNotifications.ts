import { useEffect, useRef } from 'react'
import type { Coords, TravelMode } from '../lib/campus'
import {
  TRAVEL_MODE_PHRASE,
  estimateTravel,
  estimateTravelToCoords,
} from '../lib/campus'
import { DEFAULT_PUSH_BASE } from '../lib/config'
import { sessionKey } from '../lib/diff'
import {
  daysUntil,
  formatRemaining,
  isPlacementSession,
  placementTag,
  shortenRoom,
  toMinutes,
} from '../lib/format'
import { leavePlanFor } from '../lib/journeyPlanner'
import { showReminder } from '../lib/notify'
import { ATTENDANCE_REPORT_VERSION, reportAttendanceMarks, reportLocation, subscriptionFingerprint } from '../lib/push'
import { alreadyAtDestination } from '../../shared/travel-state.js'
import { utcToZonedParts } from '../../shared/calendar-time.js'
import { courseZone } from '../lib/course'
import { useCourseClock } from './useCourseClock'
import { loadNotified, saveNotified } from '../lib/storage'
import { cachedRouteMinutes, tflRoute } from '../lib/tfl'
import type { TflDisruption } from '../lib/tfl'
import { cachedWeatherForHour, weatherForHour } from '../lib/weather'
import type { MetaMap, Session, Settings } from '../types'

interface Options {
  /** Do not notify before this profile's saved completion state has loaded. */
  metaReady: boolean
  /** owning profile id, stamped into every notification payload (P3-05) */
  profileId: string | null
  settings: Settings | null
  /** reminder-eligible sessions: course membership + the explicit optional/
   *  self-study reminder preferences — display filters play no part */
  reminderSessions: Session[]
  allKeyDates: Session[]
  /** per-session meta, to skip attendance prompts for already-ticked sessions */
  metaMap: MetaMap
  coords: Coords | null
  travelMode: TravelMode
  locationEnabled: boolean
  tubeStatus: TflDisruption[]
  /** apply an attendance/task action that arrived via a notification, scoped
   *  to its owning profile */
  onMark: (key: string, kind: 'attended' | 'absent' | 'done', profileId?: string) => void
}

/**
 * In-app notifications while the app is open/installed: session reminders,
 * leave alerts, key-date reminders (30s check loop), notification-action relay
 * from the service worker, and background-leave location reporting.
 */
export function useNotifications({
  metaReady,
  profileId,
  settings,
  reminderSessions,
  allKeyDates,
  metaMap,
  coords,
  travelMode,
  locationEnabled,
  tubeStatus,
  onMark,
}: Options) {
  const exportRef = useRef(reminderSessions)
  exportRef.current = reminderSessions
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
  const profileIdRef = useRef(profileId)
  profileIdRef.current = profileId

  // Notification action buttons: the service worker relays "attended"/"snooze"
  // taps to an open window via postMessage.
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    const onMessage = (event: MessageEvent) => {
      const msg = event.data as {
        type?: string
        action?: string
        key?: string
        title?: string
        body?: string
        profileId?: string
        kind?: string
      }
      if (msg?.type !== 'timetable-action' || !msg.key) return
      if (msg.action === 'attended' || msg.action === 'absent' || msg.action === 'done') {
        onMarkRef.current(msg.key, msg.action, msg.profileId)
      } else if (msg.action === 'snooze' && msg.title) {
        setTimeout(
          () =>
            showReminder(msg.title!, msg.body ?? '', {
              key: msg.key,
              profileId: msg.profileId ?? profileIdRef.current ?? undefined,
              kind: msg.kind === 'task' ? 'task' : 'session',
              snoozeUrl: snoozeUrlRef.current,
            }),
          10 * 60_000
        )
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
      !metaReady ||
      (offsets.length === 0 && leaveOffsets.length === 0 && kdDays.length === 0 && !attendancePrompts) ||
      typeof Notification === 'undefined'
    )
      return
    const notify = (title: string, body: string, key?: string, kind: 'session' | 'task' = 'session') =>
      showReminder(title, body, {
        key,
        kind,
        profileId: profileIdRef.current ?? undefined,
        snoozeUrl: snoozeUrlRef.current,
      })
    const check = () => {
      if (Notification.permission !== 'granted') return
      // The COURSE clock (FA-04): sessions, leave alerts, attendance windows and
      // quiet hours all read course wall time, exactly as Today does — a device
      // in another zone reminds on course time, never its own.
      const wall = utcToZonedParts(Date.now(), courseZone())
      const hour = Number(wall.hhmm.slice(0, 2))
      // Quiet hours: skip without marking anything notified, so alerts still
      // relevant afterwards fire on the first check outside the window.
      const { from: qFrom, to: qTo } = quietRef.current
      if (typeof qFrom === 'number' && typeof qTo === 'number' && qFrom !== qTo) {
        const h = hour
        if (qFrom < qTo ? h >= qFrom && h < qTo : h >= qFrom || h < qTo) return
      }
      const today = wall.dateISO
      const nowMins = hour * 60 + Number(wall.hhmm.slice(3, 5))
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
          // Already at the session's location: no "time to leave" (owner
          // request, 9 Sep 2026). Nothing is marked notified, so the alert
          // still fires if they leave again before the session.
          const alreadyThere = est.location ? alreadyAtDestination(here, est.location) : false
          if (est.minutes !== null && !alreadyThere) {
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
            let untilLeave = delta - travelMins
            // A date-specific plan viewed in Travel & map owns the departure:
            // the reminder fires on the SAME itinerary the screen shows, and a
            // changed buffer/time replaced the plan wholesale (P6-01).
            const plan = leavePlanFor(profileIdRef.current ?? '', sessionKey(s))
            if (plan) {
              untilLeave = Math.round((plan.leaveByMs - Date.now()) / 60_000)
              travelMins = plan.durationMins
              liveLabel = ' (planned TfL)'
            }
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
          showReminder(`Did you attend ${s.title}?`, '✓ Attended or ✗ Absent — or tap to answer in the app.', {
            key,
            profileId: profileIdRef.current ?? undefined,
            snoozeUrl: snoozeUrlRef.current,
            tag: `att-${key}`,
            kind: 'attendance',
          })
          notified[`${key}#att`] = Date.now()
          dirty = true
        }
      }
      // Key-date reminders: N days before each deadline (one notification per offset).
      if (kdDays.length > 0) {
        for (const kd of keyDatesRef.current) {
          if (kd.dateISO < today || metaRef.current[sessionKey(kd)]?.status === 'done') continue
          const days = daysUntil(kd.dateISO, today)
          const due = kdDays.filter((d) => days <= d && !notified[`${sessionKey(kd)}#kd#${d}`])
          if (due.length === 0) continue
          notify(
            `📌 ${kd.title}`,
            days === 0
              ? `Due today${kd.start ? ` at ${kd.start}` : ''}`
              : `Due in ${days} day${days === 1 ? '' : 's'} (${kd.dateISO.split('-').reverse().join('/')})`,
            sessionKey(kd),
            'task' // deadlines get task actions (Open / Mark done / Snooze), never "Attended"
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
  }, [metaReady, offsetsKey, leaveKey, kdDaysKey, attendancePrompts])

  // The push worker cannot see attendance marks, so it is told which of
  // today's sessions are already answered (keys only) as an authoritative
  // per-profile/course-day snapshot (FA-01/02/03). An acknowledgement is
  // recorded ONLY for an accepted 2xx and is keyed by server origin +
  // endpoint fingerprint + profile + course day + protocol version, so a
  // new subscription, server, profile or day is reported afresh; failures
  // stay pending (bounded backoff, online/foreground retry); a late reply
  // for a superseded identity is ignored.
  const marksOn = settings?.pushEnabled === true && attendancePrompts
  const pushBase = settings?.pushServerBase ?? DEFAULT_PUSH_BASE
  const courseToday = useCourseClock().todayISO
  const inflightRef = useRef<string | null>(null)
  useEffect(() => {
    if (!marksOn || !metaReady || !profileId) return
    let cancelled = false
    let retry: ReturnType<typeof setTimeout> | null = null
    const run = async (attempt = 0) => {
      const day = courseToday
      const keys = exportRef.current
        .filter((s) => s.dateISO === day && !s.isKeyDate && !s.isSelfStudy)
        .map((s) => sessionKey(s))
        .filter((k) => metaRef.current[k]?.attended || metaRef.current[k]?.absent)
        .sort()
      const snapshot = JSON.stringify(keys)
      const fp = await subscriptionFingerprint()
      if (cancelled) return
      if (!fp) {
        writeAttendancePending({ profileId, day, status: 'unavailable', reason: 'no push subscription on this device', at: Date.now() })
        return
      }
      const identity = `${new URL(pushBase).origin}|${fp}|${profileId}|${day}|v${ATTENDANCE_REPORT_VERSION}`
      const acks = readAttendanceAcks()
      if (acks[identity]?.snapshot === snapshot) {
        clearAttendancePending()
        return
      }
      if (inflightRef.current === identity) return
      inflightRef.current = identity
      const rev = (acks[identity]?.rev ?? 0) + 1
      const result = await reportAttendanceMarks(pushBase, { profileId, day, rev, keys })
      if (inflightRef.current === identity) inflightRef.current = null
      if (cancelled) return
      if (result.status === 'accepted') {
        writeAttendanceAcks({ ...acks, [identity]: { snapshot, rev } })
        clearAttendancePending()
      } else if (result.status === 'stale') {
        writeAttendanceAcks({ ...acks, [identity]: { snapshot: null, rev: result.serverRev } })
        retry = setTimeout(() => void run(attempt), 1000)
      } else if (result.status === 'retryable') {
        writeAttendancePending({ profileId, day, status: 'retryable', reason: result.reason, at: Date.now() })
        if (attempt < 3) retry = setTimeout(() => void run(attempt + 1), Math.min(result.retryAfterMs * 2 ** attempt, 5 * 60_000))
      } else {
        writeAttendancePending({ profileId, day, status: result.status, reason: result.status === 'configuration' ? result.reason : 'no push subscription on this device', at: Date.now() })
      }
    }
    const debounce = setTimeout(() => void run(), 1500)
    const onWake = () => {
      if (document.visibilityState === 'visible') void run()
    }
    window.addEventListener('online', onWake)
    document.addEventListener('visibilitychange', onWake)
    return () => {
      cancelled = true
      clearTimeout(debounce)
      if (retry) clearTimeout(retry)
      window.removeEventListener('online', onWake)
      document.removeEventListener('visibilitychange', onWake)
    }
  }, [marksOn, metaReady, metaMap, pushBase, profileId, courseToday])
}

/* ---------- attendance-report bookkeeping (identity-scoped, FA-01/02) ---------- */
const ACK_KEY = 'timetable.marks-ack.v2'
const PENDING_KEY = 'timetable.marks-pending.v2'
type AckMap = Record<string, { snapshot: string | null; rev: number }>
export interface AttendancePending {
  profileId: string
  day: string
  status: 'unavailable' | 'retryable' | 'configuration'
  reason: string
  at: number
}
function readAttendanceAcks(): AckMap {
  try {
    return (JSON.parse(localStorage.getItem(ACK_KEY) ?? '{}') as AckMap) ?? {}
  } catch {
    return {}
  }
}
function writeAttendanceAcks(acks: AckMap): void {
  // Bounded: keep the 20 most recent identities.
  const entries = Object.entries(acks).slice(-20)
  try {
    localStorage.setItem(ACK_KEY, JSON.stringify(Object.fromEntries(entries)))
  } catch {
    /* ignore */
  }
}
function writeAttendancePending(p: AttendancePending): void {
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify(p))
  } catch {
    /* ignore */
  }
}
function clearAttendancePending(): void {
  try {
    localStorage.removeItem(PENDING_KEY)
  } catch {
    /* ignore */
  }
}
/** For Settings: an unacknowledged report, if any (never claims delivery). */
export function attendanceReportPending(): AttendancePending | null {
  try {
    return JSON.parse(localStorage.getItem(PENDING_KEY) ?? 'null') as AttendancePending | null
  } catch {
    return null
  }
}
