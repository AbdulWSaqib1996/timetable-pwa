/**
 * ics-feed worker — serves a subscribable ICS calendar feed for a public Google Sheet timetable.
 *
 * GET /?id=<sheetId>&gid=<tabGid>&spec=Music,PE&selfstudy=0&kdid=<sheetId>&kdgid=<tabGid>&plc=<json>
 *   id        (required) Google Sheet ID — the sheet must be "anyone with the link can view"
 *   gid       (optional) tab gid
 *   spec      (optional) comma-separated specialism names to keep; other specialisms are dropped
 *   selfstudy (optional) "0" to drop Self Study rows
 *   kdid/kdgid (optional) key-dates tab — its rows are added as 📌 all-day events
 *   plc       (optional) placement details JSON {"SE1A":{"s":"School name","a":"Address"}} —
 *             placement marker rows expand into one event per school day, located at the school
 *
 * Deploy (free Cloudflare account):  npx wrangler deploy
 */

import { parseTimetable } from '../../shared/timetable.js'
import { reconcileEvents, eventKey } from '../../shared/identity.js'
const parseSessions = table => parseTimetable(table).sessions
const MONTHS = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11 }
const pad = n => String(n).padStart(2,'0')

/* ---------- placement (school experience) expansion, matching the app ---------- */
const isPlacementTitle = (t) => /school experience|placement|\bSE ?\d[a-z]?\b/i.test(t || '')
const placementTagOf = (t) => {
  const m = (t || '').match(/SE ?\d[a-z]?/i)
  return m ? m[0].replace(/\s/g, '').toUpperCase() : 'PLACEMENT'
}
function parsePlacementRange(title) {
  const m = (title || '').match(
    /\((\d{1,2})(?:st|nd|rd|th)?(?:\s+([A-Za-z]+))?\s*[-\u2013\u2014]\s*(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)\s+(\d{4})\)/
  )
  if (!m) return null
  const [, d1, m1name, d2, m2name, year] = m
  const mo2 = MONTHS[m2name.slice(0, 3).toLowerCase()]
  if (mo2 === undefined) return null
  const mo1 = m1name !== undefined ? MONTHS[m1name.slice(0, 3).toLowerCase()] : mo2
  if (mo1 === undefined) return null
  const iso = (y, mo, d) => `${y}-${pad(mo + 1)}-${pad(d)}`
  const from = iso(+year, mo1, +d1)
  const to = iso(+year, mo2, +d2)
  return from <= to ? { from, to } : null
}
/**
 * Marker rows like "SE1a begins (28th Sept - 2nd Oct 2026)" become one event per
 * weekday in the span, so subscribed calendars show school days too. When the app
 * passed placement details (?plc=), the school becomes each event's location.
 */
function expandPlacements(sessions, plcMap) {
  const out = sessions.slice()
  const seenSpans = new Set()
  const schoolLocation = (tag) => {
    const p = plcMap[tag]
    if (!p || (!p.s && !p.a)) return ''
    return [p.s, p.a].filter(Boolean).join(', ')
  }
  for (const s of sessions) {
    if (!isPlacementTitle(s.title)) continue
    const tag = placementTagOf(s.title)
    // Marker rows themselves get the school as their location when the room is empty.
    if (!s.room) s.room = schoolLocation(tag)
    const range = parsePlacementRange(s.title)
    if (!range) continue
    const spanKey = `${tag}|${range.from}|${range.to}`
    if (seenSpans.has(spanKey)) continue
    seenSpans.add(spanKey)
    const validTime = (t) => t && t !== '00:00'
    const start = validTime(s.start) && s.start !== s.end ? s.start : '08:30'
    const end = validTime(s.end) && s.end !== s.start ? s.end : '15:45'
    const [y, m, d] = range.from.split('-').map(Number)
    const cursor = new Date(Date.UTC(y, m - 1, d))
    for (;;) {
      const dateISO = `${cursor.getUTCFullYear()}-${pad(cursor.getUTCMonth() + 1)}-${pad(cursor.getUTCDate())}`
      if (dateISO > range.to) break
      const dow = cursor.getUTCDay()
      const alreadyMarked = sessions.some(
        (x) => x.dateISO === dateISO && isPlacementTitle(x.title) && placementTagOf(x.title) === tag
      )
      if (dow !== 0 && dow !== 6 && !alreadyMarked) {
        out.push({
          id: `plc-${tag}-${dateISO}`,
          title: `${tag} placement day`,
          dateISO,
          start,
          end,
          room: schoolLocation(tag),
          groups: '',
          tutor: '',
          subject: 'School experience',
          isSelfStudy: false,
        })
      }
      cursor.setUTCDate(cursor.getUTCDate() + 1)
    }
  }
  return out.sort((a, b) => (a.dateISO + (a.start || '99')).localeCompare(b.dateISO + (b.start || '99')))
}

// in-memory per-IP request counter (per isolate; abuse guard, not billing)
const RL = new Map()

const esc = (v) => v.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')

function fold(line) {
  if (line.length <= 74) return line
  const parts = []
  let rest = line
  while (rest.length > 74) { parts.push(rest.slice(0, 74)); rest = ' ' + rest.slice(74) }
  parts.push(rest)
  return parts.join('\r\n')
}

function buildICS(sessions, calName = 'My Timetable') {
  const now = new Date()
  const stamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`
  const dt = (dateISO, time) => `${dateISO.replace(/-/g, '')}T${time.replace(':', '')}00`
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//timetable-pwa ics-feed//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', fold(`X-WR-CALNAME:${esc(calName)}`)]
  for (const s of sessions) {
    lines.push('BEGIN:VEVENT', fold(`UID:${esc(s.calendarUid || s.id)}@timetable-pwa`), `DTSTAMP:${stamp}`)
    if (s.isKeyDate || !s.start) {
      lines.push(`DTSTART;VALUE=DATE:${s.dateISO.replace(/-/g, '')}`)
    } else {
      lines.push(`DTSTART:${dt(s.dateISO, s.start)}`, `DTEND:${s.end ? dt(s.dateISO, s.end) : dt(s.dateISO, s.start)}`)
    }
    lines.push(fold(`SUMMARY:${esc(s.isKeyDate ? `📌 ${s.title}` : s.title)}`))
    if (s.room && !s.isSelfStudy) lines.push(fold(`LOCATION:${esc(s.room)}`))
    const desc = [
      s.tutor && s.tutor !== 'Self Study' ? `Tutor: ${s.tutor}` : '',
      s.subject && s.subject !== s.title ? `Subject: ${s.subject}` : '',
      s.groups ? `Groups: ${s.groups}` : '',
      s.link ? `Moodle: ${s.link}` : '',
    ].filter(Boolean)
    if (desc.length) lines.push(fold(`DESCRIPTION:${esc(desc.join('\n'))}`))
    if (s.link) lines.push(fold(`URL:${s.link}`))
    lines.push('END:VEVENT')
  }
  lines.push('END:VCALENDAR')
  return lines.join('\r\n') + '\r\n'
}

async function retainFeedIdentity(sessions, id, gid, env, ctx, keyDates = false) {
  if (env?.RATE) {
      try {
        const histKey = `hist:${id}|${gid ?? ''}${keyDates ? '|keydates' : ''}`
        const keyOf = eventKey
        const todayISO = new Date().toISOString().slice(0, 10)
        const seen = await env.RATE.get(histKey, 'json')
        sessions = reconcileEvents(sessions.map(s => ({...s, sourceKey:`${id}|${gid ?? ''}`})), seen ?? [])
        const freshKeys = new Set(sessions.map(keyOf))
        if (seen) {
          const freshDates = new Set(sessions.map((s) => s.dateISO))
          sessions = sessions.concat(seen.filter((s) => s.dateISO < todayISO && !freshKeys.has(keyOf(s)) && !freshDates.has(s.dateISO)))
        }
        const byKey = new Map((seen ?? []).filter((s) => s.dateISO < todayISO && !freshKeys.has(keyOf(s))).map((s) => [keyOf(s), s]))
        for (const s of sessions) if (s.dateISO < todayISO) byKey.set(keyOf(s), s)
        const stored = [...byKey.values(), ...sessions.filter((s) => s.dateISO >= todayISO)]
        if (!seen || JSON.stringify(stored) !== JSON.stringify(seen)) {
          ctx.waitUntil(env.RATE.put(histKey, JSON.stringify(stored)))
        }
      } catch {
        /* history is best-effort; the live feed still works */
      }
    }

  return sessions
}

export default {
  async fetch(request, env, ctx) {
    if (request.url.length > 16000) return new Response('Calendar URL is too large.', {status:414})
    const url = new URL(request.url)
    const id = url.searchParams.get('id')
    if (!id || !/^[a-zA-Z0-9_-]{20,}$/.test(id)) {
      return new Response('Missing or invalid ?id=<sheetId>', { status: 400 })
    }

    // Edge cache: calendar apps poll aggressively; a 15-minute cached copy is
    // plenty fresh for a timetable and cuts origin hits (and KV traffic) ~3×.
    const cache = caches.default
    const cachedResponse = await cache.match(request)
    if (cachedResponse) return cachedResponse

    // Per-IP rate limit, in memory (per isolate): abuse guard that costs no KV
    // writes — the old KV counter spent one write per uncached poll, which was
    // the single biggest drain on the account's 1,000 writes/day budget.
    {
      const ip = request.headers.get('cf-connecting-ip') ?? 'unknown'
      const now = Date.now()
      const entry = RL.get(ip)
      if (!entry || now - entry.start > 3600_000) {
        if (RL.size > 5000) RL.clear()
        RL.set(ip, { start: now, n: 1 })
      } else if (++entry.n > 60) {
        return new Response('Rate limit exceeded — try again later.', { status: 429 })
      }
    }

    const calName = (url.searchParams.get('name') || 'My Timetable').slice(0, 60)
    const gid = url.searchParams.get('gid')
    const spec = (url.searchParams.get('spec') || '').split(',').map((s) => s.trim()).filter(Boolean)
    const dropSelfStudy = url.searchParams.get('selfstudy') === '0'

    const gvizUrl = `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:json&headers=0${gid ? `&gid=${encodeURIComponent(gid)}` : ''}`
    const res = await fetch(gvizUrl)
    if (!res.ok) return new Response('Could not fetch the sheet — is it public?', { status: 502 })
    const text = await res.text()
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start < 0 || text.trimStart().startsWith('<')) {
      return new Response('Sheet is not public ("anyone with the link can view" required).', { status: 502 })
    }
    let json
    try { json = JSON.parse(text.slice(start, end + 1)) } catch { return new Response('Bad sheet response.', { status: 502 }) }
    if (!json.table) return new Response('No data in sheet response.', { status: 502 })

    let sessions
    try { sessions = parseSessions(json.table) } catch (e) { return new Response(e.message, { status: 422 }) }

    sessions = await retainFeedIdentity(sessions, id, gid, env, ctx)

    if (spec.length > 0) {
      sessions = sessions.filter((s) => !s.specialismName || spec.includes(s.specialismName))
    }
    if (dropSelfStudy) sessions = sessions.filter((s) => !s.isSelfStudy)

    // Placement spans expand into per-day events (school as location when provided).
    let plcMap = {}
    try {
      const raw = url.searchParams.get('plc')
      if (raw) {
        const parsed = JSON.parse(raw)
        if (parsed && typeof parsed === 'object') {
          for (const [tag, p] of Object.entries(parsed).slice(0, 20)) {
            if (/^[A-Z0-9]{1,12}$/.test(tag) && p && typeof p === 'object') {
              plcMap[tag] = { s: String(p.s ?? '').slice(0, 80), a: String(p.a ?? '').slice(0, 120) }
            }
          }
        }
      }
    } catch {
      plcMap = {}
    }
    sessions = expandPlacements(sessions, plcMap)

    // Optional key-dates tab appended as all-day events; failures there don't break the feed.
    const kdid = url.searchParams.get('kdid') || (url.searchParams.get('kdgid') ? id : null)
    const kdgid = url.searchParams.get('kdgid')
    if (kdid && /^[a-zA-Z0-9_-]{20,}$/.test(kdid)) {
      try {
        const kdUrl = `https://docs.google.com/spreadsheets/d/${kdid}/gviz/tq?tqx=out:json&headers=0${kdgid ? `&gid=${encodeURIComponent(kdgid)}` : ''}`
        const kdRes = await fetch(kdUrl)
        if (kdRes.ok) {
          const kdText = await kdRes.text()
          const a = kdText.indexOf('{')
          const b = kdText.lastIndexOf('}')
          const kdJson = JSON.parse(kdText.slice(a, b + 1))
          if (kdJson.table) {
            sessions = sessions.concat(
              await retainFeedIdentity(parseSessions(kdJson.table).map((s) => ({ ...s, id: `kd-${s.id}`, isKeyDate: true })), kdid, kdgid, env, ctx, true)
            )
          }
        }
      } catch {
        /* skip key dates on error */
      }
    }

    const response = new Response(buildICS(sessions, calName), {
      headers: {
        'content-type': 'text/calendar; charset=utf-8',
        'cache-control': 'public, max-age=900',
        'access-control-allow-origin': '*',
      },
    })
    ctx.waitUntil(cache.put(request, response.clone()))
    return response
  },
}
