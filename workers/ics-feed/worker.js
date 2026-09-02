/**
 * ics-feed worker — serves a subscribable ICS calendar feed for a public Google Sheet timetable.
 *
 * GET /?id=<sheetId>&gid=<tabGid>&spec=Music,PE&selfstudy=0&kdid=<sheetId>&kdgid=<tabGid>
 *   id        (required) Google Sheet ID — the sheet must be "anyone with the link can view"
 *   gid       (optional) tab gid
 *   spec      (optional) comma-separated specialism names to keep; other specialisms are dropped
 *   selfstudy (optional) "0" to drop Self Study rows
 *   kdid/kdgid (optional) key-dates tab — its rows are added as 📌 all-day events
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

const esc = (v) => v.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')

function fold(line) {
  if (line.length <= 74) return line
  const parts = []
  let rest = line
  while (rest.length > 74) { parts.push(rest.slice(0, 74)); rest = ' ' + rest.slice(74) }
  parts.push(rest)
  return parts.join('\r\n')
}

function buildICS(sessions) {
  const now = new Date()
  const stamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`
  const dt = (dateISO, time) => `${dateISO.replace(/-/g, '')}T${time.replace(':', '')}00`
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//timetable-pwa ics-feed//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:My Timetable']
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
  async fetch(request) {
    const url = new URL(request.url)
    const id = url.searchParams.get('id')
    if (!id || !/^[a-zA-Z0-9_-]{20,}$/.test(id)) {
      return new Response('Missing or invalid ?id=<sheetId>', { status: 400 })
    }
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
    if (spec.length > 0) {
      sessions = sessions.filter((s) => !s.specialismName || spec.includes(s.specialismName))
    }
    if (dropSelfStudy) sessions = sessions.filter((s) => !s.isSelfStudy)

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

    return new Response(buildICS(sessions), {
      headers: {
        'content-type': 'text/calendar; charset=utf-8',
        'cache-control': 'public, max-age=900',
        'access-control-allow-origin': '*',
      },
    })
  },
}
