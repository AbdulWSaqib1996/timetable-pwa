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

const HEADER_MAP = {
  title: 'title', day: 'day', date: 'date', start: 'start', 'start time': 'start',
  end: 'end', 'end time': 'end', room: 'room', location: 'room', groups: 'groups',
  group: 'groups', tutor: 'tutor', tutors: 'tutor', subject: 'subject',
  link: 'link', url: 'link', moodle: 'link',
}
const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 }
const SPECIALISM_RE = /^specialism\s*\d*\s*[-\u2013\u2014:]\s*(.+)$/i

const cellText = (cell) => {
  if (!cell) return ''
  if (cell.f != null && cell.f !== '') return String(cell.f).trim()
  if (cell.v == null) return ''
  return String(cell.v).trim()
}

const gvizDate = (s) => {
  const m = typeof s === 'string' && s.match(/^Date\((\d+),(\d+),(\d+)(?:,(\d+),(\d+))?/)
  if (!m) return null
  return { y: +m[1], mo: +m[2], d: +m[3], h: m[4] !== undefined ? +m[4] : undefined, min: m[5] !== undefined ? +m[5] : undefined }
}

const pad = (n) => String(n).padStart(2, '0')

function parseDateCell(cell) {
  if (!cell) return null
  const g = gvizDate(cell.v)
  if (g) return `${g.y}-${pad(g.mo + 1)}-${pad(g.d)}`
  const text = cellText(cell)
  if (!text) return null
  let m = text.match(/^(\d{1,2})[-/ ]([A-Za-z]{3,})[-/ ](\d{4})$/)
  if (m) {
    const month = MONTHS[m[2].slice(0, 3).toLowerCase()]
    if (month !== undefined) return `${m[3]}-${pad(month + 1)}-${pad(+m[1])}`
  }
  m = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (m) return `${m[3]}-${pad(+m[2])}-${pad(+m[1])}`
  const parsed = new Date(text)
  if (!isNaN(parsed.getTime())) return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}`
  return null
}

function parseTimeCell(cell) {
  if (!cell) return ''
  if (Array.isArray(cell.v) && cell.v.length >= 2) return `${pad(cell.v[0])}:${pad(cell.v[1])}`
  const g = gvizDate(cell.v)
  if (g && g.h !== undefined) return `${pad(g.h)}:${pad(g.min ?? 0)}`
  const m = cellText(cell).match(/^(\d{1,2})[:.](\d{2})/)
  return m ? `${pad(+m[1])}:${m[2]}` : ''
}

function parseSessions(table) {
  let headerIndex = -1
  let colMap = {}
  const limit = Math.min(table.rows.length, 10)
  for (let r = 0; r < limit; r++) {
    const map = {}
    let matches = 0
    table.rows[r].c.forEach((cell, i) => {
      const field = HEADER_MAP[cellText(cell).toLowerCase()]
      if (field && map[field] === undefined) { map[field] = i; matches++ }
    })
    if (matches >= 3) { headerIndex = r; colMap = map; break }
  }
  if (headerIndex === -1 || colMap.title === undefined) {
    throw new Error('Could not find a usable header row (needs Title and Date columns).')
  }
  // Some sheets leave Date/Start/End header cells blank — infer them from declared column types,
  // then by sniffing cell values.
  const width = Math.max(table.cols.length, ...table.rows.map((r) => r.c.length), 0)
  const taken = new Set(Object.values(colMap))
  const sniff = (i, test) => {
    let hits = 0, nonEmpty = 0
    for (let r = headerIndex + 1; r < Math.min(table.rows.length, headerIndex + 40); r++) {
      const cell = table.rows[r].c[i]
      if (!cell || cell.v == null) continue
      nonEmpty++
      if (test(cell)) hits++
    }
    return nonEmpty > 0 && hits / nonEmpty > 0.5
  }
  const findColumn = (declaredTypes, test) => {
    for (let i = 0; i < width; i++) {
      if (!taken.has(i) && declaredTypes.includes(table.cols[i]?.type ?? '')) return i
    }
    for (let i = 0; i < width; i++) {
      if (!taken.has(i) && sniff(i, test)) return i
    }
    return undefined
  }
  for (const [field, types, test] of [
    ['date', ['date'], (c) => parseDateCell(c) !== null],
    ['start', ['datetime', 'timeofday'], (c) => parseTimeCell(c) !== ''],
    ['end', ['datetime', 'timeofday'], (c) => parseTimeCell(c) !== ''],
  ]) {
    if (colMap[field] === undefined) {
      const i = findColumn(types, test)
      if (i !== undefined) { colMap[field] = i; taken.add(i) }
    }
  }
  if (colMap.date === undefined) {
    throw new Error('Could not find a date column in the sheet.')
  }
  const sessions = []
  let lastDate = null
  for (let r = headerIndex + 1; r < table.rows.length; r++) {
    const cells = table.rows[r].c
    const get = (f) => (colMap[f] !== undefined ? cellText(cells[colMap[f]]) : '')
    const title = get('title')
    let dateISO = parseDateCell(cells[colMap.date])
    if (dateISO) lastDate = dateISO
    else dateISO = lastDate
    if (!title || !dateISO) continue
    const linkText = get('link')
    const specMatch = title.match(SPECIALISM_RE)
    sessions.push({
      id: `${dateISO}-${r}`,
      title,
      dateISO,
      start: colMap.start !== undefined ? parseTimeCell(cells[colMap.start]) : '',
      end: colMap.end !== undefined ? parseTimeCell(cells[colMap.end]) : '',
      room: get('room'),
      groups: get('groups'),
      tutor: get('tutor'),
      subject: get('subject'),
      link: /^https?:\/\//i.test(linkText) ? linkText : undefined,
      specialismName: specMatch ? specMatch[1].trim() : undefined,
      isSelfStudy: /^self[- ]?study$/i.test(title),
    })
  }
  return sessions
}

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
    lines.push('BEGIN:VEVENT', fold(`UID:${s.id}@timetable-pwa`), `DTSTAMP:${stamp}`)
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

export default {
  async fetch(request, env, ctx) {
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

    // The sheet drops past rows daily (rolling TODAY() filter). The feed keeps
    // history in KV so subscribed calendars keep past events. The stored copy is
    // past-from-history + future-from-fresh-ONLY, so a session cancelled on the
    // sheet is dropped from storage immediately and can never resurrect when its
    // day later falls off the sheet.
    if (env?.RATE) {
      try {
        const histKey = `hist:${id}|${gid ?? ''}`
        const keyOf = (s) => `${s.dateISO}|${s.start}|${(s.title || '').trim().toLowerCase()}`
        const todayISO = new Date().toISOString().slice(0, 10)
        const seen = await env.RATE.get(histKey, 'json')
        if (seen) {
          const freshDates = new Set(sessions.map((s) => s.dateISO))
          sessions = sessions.concat(seen.filter((s) => s.dateISO < todayISO && !freshDates.has(s.dateISO)))
        }
        const byKey = new Map((seen ?? []).filter((s) => s.dateISO < todayISO).map((s) => [keyOf(s), s]))
        for (const s of sessions) if (s.dateISO < todayISO) byKey.set(keyOf(s), s)
        const stored = [...byKey.values(), ...sessions.filter((s) => s.dateISO >= todayISO)]
        const seenKeys = new Set((seen ?? []).map(keyOf))
        if (!seen || stored.length !== seen.length || stored.some((s) => !seenKeys.has(keyOf(s)))) {
          ctx.waitUntil(env.RATE.put(histKey, JSON.stringify(stored)))
        }
      } catch {
        /* history is best-effort; the live feed still works */
      }
    }

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
              parseSessions(kdJson.table).map((s) => ({ ...s, id: `kd-${s.id}`, isKeyDate: true }))
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
