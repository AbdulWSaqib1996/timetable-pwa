/**
 * timetable-push worker — background Web Push for My Timetable.
 *
 * Endpoints (CORS-open):
 *   GET  /vapid        → { publicKey }  (ES256 keypair auto-generated into KV on first call)
 *   POST /subscribe    → { subscription, config } stored in KV
 *   POST /unsubscribe  → { endpoint } removed
 *   POST /snooze       → { endpoint, title, body, key, fireAt } re-delivered by the cron
 *
 * Cron (every 10 min): for each subscription, fetch its sheet, compute due
 * session reminders (offset minutes before start, London time) and key-date
 * reminders (N days before, sent on the ~07:00 London run), send Web Push
 * (VAPID + RFC 8291 aes128gcm). Dedupe via KV keys with a 2-day TTL.
 *
 * Deploy: create a KV namespace, put its id in wrangler.toml, `npx wrangler deploy`.
 */

/* ---------- base64url helpers ---------- */
const b64url = (buf) =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const b64urlDecode = (str) => {
  const pad = '='.repeat((4 - (str.length % 4)) % 4)
  const raw = atob((str + pad).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)))
}
const utf8 = (s) => new TextEncoder().encode(s)
const concat = (...parts) => {
  const total = parts.reduce((n, p) => n + p.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const p of parts) {
    out.set(p, offset)
    offset += p.length
  }
  return out
}

/* ---------- VAPID keys (auto-generated into KV) ---------- */
async function getVapid(env) {
  const stored = await env.PUSH.get('vapid', 'json')
  if (stored) return stored
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign'])
  const publicRaw = await crypto.subtle.exportKey('raw', pair.publicKey)
  const vapid = {
    publicKey: b64url(publicRaw),
    privateJwk: await crypto.subtle.exportKey('jwk', pair.privateKey),
  }
  await env.PUSH.put('vapid', JSON.stringify(vapid))
  return vapid
}

async function vapidJwt(audience, vapid) {
  const key = await crypto.subtle.importKey('jwk', vapid.privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
  const header = b64url(utf8(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
  const payload = b64url(
    utf8(JSON.stringify({ aud: audience, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: 'mailto:abdulwsaqib@gmail.com' }))
  )
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, utf8(`${header}.${payload}`))
  return `${header}.${payload}.${b64url(signature)}`
}

/* ---------- RFC 8291 aes128gcm payload encryption ---------- */
async function hkdf(salt, ikm, info, length) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits'])
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8))
}

async function encryptPayload(payload, p256dh, auth) {
  const clientPub = b64urlDecode(p256dh)
  const authSecret = b64urlDecode(auth)
  const local = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])
  const clientKey = await crypto.subtle.importKey('raw', clientPub, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: clientKey }, local.privateKey, 256))
  const localPub = new Uint8Array(await crypto.subtle.exportKey('raw', local.publicKey))
  const prk = await hkdf(authSecret, shared, concat(utf8('WebPush: info\0'), clientPub, localPub), 32)
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const cek = await hkdf(salt, prk, utf8('Content-Encoding: aes128gcm\0'), 16)
  const nonce = await hkdf(salt, prk, utf8('Content-Encoding: nonce\0'), 12)
  const record = concat(utf8(payload), new Uint8Array([2]))
  const aesKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt'])
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aesKey, record))
  const header = concat(salt, new Uint8Array([0, 0, 16, 0]), new Uint8Array([localPub.length]), localPub)
  return concat(header, ciphertext)
}

async function sendPushDetailed(env, subscription, payload) {
  try {
    const vapid = await getVapid(env)
    const audience = new URL(subscription.endpoint).origin
    const jwt = await vapidJwt(audience, vapid)
    const body = await encryptPayload(JSON.stringify(payload), subscription.keys.p256dh, subscription.keys.auth)
    const res = await fetch(subscription.endpoint, {
      method: 'POST',
      headers: {
        TTL: '3600',
        Urgency: 'high',
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        Authorization: `vapid t=${jwt},k=${vapid.publicKey}`,
      },
      body,
    })
    return { status: res.status, detail: (await res.text()).slice(0, 300) }
  } catch (err) {
    return { status: 0, detail: String(err).slice(0, 300) }
  }
}

async function sendPush(env, subscription, payload) {
  const { status } = await sendPushDetailed(env, subscription, payload)
  if (status === 404 || status === 410) return 'gone'
  return status >= 200 && status < 300 ? 'ok' : 'fail'
}

/* ---------- sheet parsing (compact copy of the app's parser) ---------- */
const HEADER_MAP = {
  title: 'title', day: 'day', date: 'date', start: 'start', 'start time': 'start', end: 'end',
  'end time': 'end', room: 'room', location: 'room', groups: 'groups', group: 'groups',
  tutor: 'tutor', tutors: 'tutor', subject: 'subject', link: 'link', url: 'link', moodle: 'link',
}
const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 }
const pad = (n) => String(n).padStart(2, '0')
const cellText = (c) => (!c ? '' : c.f != null && c.f !== '' ? String(c.f).trim() : c.v == null ? '' : String(c.v).trim())
const gvizDate = (s) => {
  const m = typeof s === 'string' && s.match(/^Date\((\d+),(\d+),(\d+)(?:,(\d+),(\d+))?/)
  return m ? { y: +m[1], mo: +m[2], d: +m[3], h: m[4] !== undefined ? +m[4] : undefined, min: m[5] !== undefined ? +m[5] : undefined } : null
}
function parseDateCell(cell) {
  if (!cell) return null
  const g = gvizDate(cell.v)
  if (g) return `${g.y}-${pad(g.mo + 1)}-${pad(g.d)}`
  const t = cellText(cell)
  let m = t.match(/^(\d{1,2})[-/ ]([A-Za-z]{3,})[-/ ](\d{4})$/)
  if (m) {
    const mo = MONTHS[m[2].slice(0, 3).toLowerCase()]
    if (mo !== undefined) return `${m[3]}-${pad(mo + 1)}-${pad(+m[1])}`
  }
  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  return m ? `${m[3]}-${pad(+m[2])}-${pad(+m[1])}` : null
}
function parseTimeCell(cell) {
  if (!cell) return ''
  if (Array.isArray(cell.v) && cell.v.length >= 2) return `${pad(cell.v[0])}:${pad(cell.v[1])}`
  const g = gvizDate(cell.v)
  if (g && g.h !== undefined) return `${pad(g.h)}:${pad(g.min ?? 0)}`
  const m = cellText(cell).match(/^(\d{1,2})[:.](\d{2})/)
  return m ? `${pad(+m[1])}:${m[2]}` : ''
}
async function fetchSessions(sheetId, gid) {
  const url = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:json&headers=0${gid ? `&gid=${encodeURIComponent(gid)}` : ''}`
  const res = await fetch(url)
  if (!res.ok) return []
  const text = await res.text()
  const a = text.indexOf('{')
  const b = text.lastIndexOf('}')
  let table
  try {
    table = JSON.parse(text.slice(a, b + 1)).table
  } catch {
    return []
  }
  if (!table) return []
  let headerIndex = -1
  const colMap = {}
  for (let r = 0; r < Math.min(table.rows.length, 10); r++) {
    const map = {}
    let matches = 0
    table.rows[r].c.forEach((cell, i) => {
      const f = HEADER_MAP[cellText(cell).toLowerCase()]
      if (f && map[f] === undefined) {
        map[f] = i
        matches++
      }
    })
    if (matches >= 3) {
      headerIndex = r
      Object.assign(colMap, map)
      break
    }
  }
  if (headerIndex === -1 || colMap.title === undefined) return []
  const width = Math.max(table.cols.length, ...table.rows.map((r) => r.c.length), 0)
  const taken = new Set(Object.values(colMap))
  const sniff = (i, test) => {
    let hits = 0
    let nonEmpty = 0
    for (let r = headerIndex + 1; r < Math.min(table.rows.length, headerIndex + 40); r++) {
      const cell = table.rows[r].c[i]
      if (!cell || cell.v == null) continue
      nonEmpty++
      if (test(cell)) hits++
    }
    return nonEmpty > 0 && hits / nonEmpty > 0.5
  }
  const findCol = (types, test) => {
    for (let i = 0; i < width; i++) if (!taken.has(i) && types.includes(table.cols[i]?.type ?? '')) return i
    for (let i = 0; i < width; i++) if (!taken.has(i) && sniff(i, test)) return i
    return undefined
  }
  for (const [f, types, test] of [
    ['date', ['date'], (c) => parseDateCell(c) !== null],
    ['start', ['datetime', 'timeofday'], (c) => parseTimeCell(c) !== ''],
    ['end', ['datetime', 'timeofday'], (c) => parseTimeCell(c) !== ''],
  ]) {
    if (colMap[f] === undefined) {
      const i = findCol(types, test)
      if (i !== undefined) {
        colMap[f] = i
        taken.add(i)
      }
    }
  }
  if (colMap.date === undefined) return []
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
    const specMatch = title.match(/^specialism\s*\d*\s*[-–—:]\s*(.+)$/i)
    sessions.push({
      title,
      dateISO,
      start: colMap.start !== undefined ? parseTimeCell(cells[colMap.start]) : '',
      end: colMap.end !== undefined ? parseTimeCell(cells[colMap.end]) : '',
      room: get('room'),
      tutor: get('tutor'),
      groups: get('groups'),
      specialismName: specMatch ? specMatch[1].trim() : undefined,
      isSelfStudy: /^self[- ]?study$/i.test(title),
    })
  }
  return sessions
}

/* ---------- placement (school experience) parity with the app ---------- */
const isPlacementTitle = (t) => /school experience|placement|\bSE ?\d[a-z]?\b/i.test(t || '')
const placementTagOf = (t) => {
  const m = (t || '').match(/SE ?\d[a-z]?/i)
  return m ? m[0].replace(/\s/g, '').toUpperCase() : 'PLACEMENT'
}
const PLACEMENT_MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 }
function parsePlacementRange(title) {
  const m = (title || '').match(
    /\((\d{1,2})(?:st|nd|rd|th)?(?:\s+([A-Za-z]+))?\s*[-–—]\s*(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)\s+(\d{4})\)/
  )
  if (!m) return null
  const [, d1, m1name, d2, m2name, year] = m
  const mo2 = PLACEMENT_MONTHS[m2name.slice(0, 3).toLowerCase()]
  if (mo2 === undefined) return null
  const mo1 = m1name !== undefined ? PLACEMENT_MONTHS[m1name.slice(0, 3).toLowerCase()] : mo2
  if (mo1 === undefined) return null
  const iso = (y, mo, d) => `${y}-${pad(mo + 1)}-${pad(d)}`
  const from = iso(+year, mo1, +d1)
  const to = iso(+year, mo2, +d2)
  return from <= to ? { from, to } : null
}
/**
 * Same expansion the app does: marker rows like "SE1a begins (28th Sept - 2nd Oct 2026)"
 * become one placement day per weekday in the span, so background reminders/briefings/
 * leave alerts cover placement mornings. Synthesized entries never enter the change diff.
 */
function expandPlacements(sessions) {
  const out = sessions.slice()
  const seenSpans = new Set()
  for (const s of sessions) {
    if (!isPlacementTitle(s.title)) continue
    const range = parsePlacementRange(s.title)
    if (!range) continue
    const tag = placementTagOf(s.title)
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
          title: `${tag} placement day`,
          dateISO,
          start,
          end,
          room: '',
          tutor: '',
          groups: '',
          isSelfStudy: false,
          placementTag: tag,
        })
      }
      cursor.setUTCDate(cursor.getUTCDate() + 1)
    }
  }
  return out.sort((a, b) => (a.dateISO + (a.start || '99')).localeCompare(b.dateISO + (b.start || '99')))
}

/** School name for a placement session, when the subscriber has entered one. */
function placementSchool(session, config) {
  if (!isPlacementTitle(session.title)) return null
  const p = config.placements?.[session.placementTag ?? placementTagOf(session.title)]
  return p?.school || null
}

/* ---------- cohort notices (Date/Message/Link tab) ---------- */
function noticeHash(dateText, message) {
  let hash = 5381
  for (const ch of `${dateText}|${message}`) hash = ((hash * 33) ^ ch.charCodeAt(0)) >>> 0
  return 'n' + hash.toString(36)
}
/** Fetch a notices tab's rows; matches the app's parser (header row with a Message column). */
async function fetchNoticeRows(sheetId, gid) {
  const url = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:json&headers=0${gid ? `&gid=${encodeURIComponent(gid)}` : ''}`
  const res = await fetch(url)
  if (!res.ok) return null
  const text = await res.text()
  let table
  try {
    table = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)).table
  } catch {
    return null
  }
  if (!table) return null
  let headerIndex = -1
  let msgCol = -1
  let dateCol = -1
  for (let r = 0; r < Math.min(table.rows.length, 10); r++) {
    const cells = table.rows[r].c
    for (let i = 0; i < cells.length; i++) {
      const t = cellText(cells[i]).toLowerCase()
      if (t === 'message' || t === 'notice' || t === 'announcement') {
        headerIndex = r
        msgCol = i
      } else if (t === 'date') dateCol = i
    }
    if (headerIndex !== -1) break
  }
  if (headerIndex === -1) return null
  const rows = []
  for (let r = headerIndex + 1; r < table.rows.length; r++) {
    const cells = table.rows[r].c
    const message = cellText(cells[msgCol]).slice(0, 500)
    if (!message) continue
    const dateText = dateCol >= 0 ? cellText(cells[dateCol]) : ''
    rows.push({ id: noticeHash(dateText, message), message })
  }
  return rows
}

/* ---------- quiet hours ---------- */
function inQuietHours(hour, from, to) {
  if (typeof from !== 'number' || typeof to !== 'number' || from === to) return false
  return from < to ? hour >= from && hour < to : hour >= from || hour < to
}

/* ---------- travel estimation for background leave alerts ---------- */
const BUILDINGS = [
  { name: 'IOE — 20 Bedford Way', keywords: ['bedford way'], lat: 51.5227, lng: -0.1276 },
  { name: 'Darwin Building', keywords: ['darwin'], lat: 51.5238, lng: -0.1319 },
  { name: 'Cruciform Building', keywords: ['cruciform'], lat: 51.5246, lng: -0.1339 },
  { name: 'Wilkins Building', keywords: ['wilkins', 'main quad', 'octagon', 'gustave tuck'], lat: 51.5248, lng: -0.1336 },
  { name: 'Senate House', keywords: ['senate house'], lat: 51.5213, lng: -0.1287 },
  { name: 'Institute of Archaeology', keywords: ['archaeology'], lat: 51.5249, lng: -0.131 },
  { name: 'Chandler House', keywords: ['chandler'], lat: 51.5253, lng: -0.1228 },
  { name: 'Roberts Building', keywords: ['roberts'], lat: 51.523, lng: -0.1322 },
  { name: 'Christopher Ingold Building', keywords: ['ingold'], lat: 51.5253, lng: -0.1325 },
  { name: 'Medical Sciences / Anatomy', keywords: ['anatomy', 'medical sciences'], lat: 51.5237, lng: -0.1334 },
  { name: 'Bentham House', keywords: ['bentham'], lat: 51.5257, lng: -0.1307 },
  { name: 'Foster Court', keywords: ['foster court'], lat: 51.5243, lng: -0.1329 },
  { name: '25 Gordon Street', keywords: ['gordon street', 'gordon house'], lat: 51.5245, lng: -0.1317 },
  { name: 'Medawar Building', keywords: ['medawar'], lat: 51.5238, lng: -0.1326 },
  { name: '1–19 Torrington Place', keywords: ['torrington'], lat: 51.5218, lng: -0.1343 },
  { name: 'Tavistock Square area', keywords: ['tavistock'], lat: 51.5253, lng: -0.1289 },
  { name: 'Birkbeck / Malet Street', keywords: ['birkbeck', 'malet street'], lat: 51.5217, lng: -0.1303 },
  { name: 'Student Centre', keywords: ['student centre'], lat: 51.5246, lng: -0.1325 },
  { name: 'Drayton House', keywords: ['drayton'], lat: 51.525, lng: -0.132 },
  { name: 'Gordon Square', keywords: ['gordon square'], lat: 51.5244, lng: -0.13 },
  { name: 'UCL (IOE)', keywords: ['ioe'], lat: 51.5227, lng: -0.1276 },
]
const matchBuilding = (room) => {
  const key = (room || '').toLowerCase()
  return BUILDINGS.find((b) => b.keywords.some((k) => key.includes(k))) ?? null
}
const haversineM = (a, b) => {
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * 6371000 * Math.asin(Math.sqrt(h))
}
const MODE_PARAMS = {
  walking: { rf: 1.25, mpm: 83.3, over: 0, phrase: 'walk' },
  transit: { rf: 1.3, mpm: 250, over: 8, phrase: 'by public transport' },
  driving: { rf: 1.4, mpm: 333, over: 5, phrase: 'drive' },
}
function heuristicMinutes(from, to, mode) {
  const p = MODE_PARAMS[mode] ?? MODE_PARAMS.walking
  return Math.max(1, Math.ceil((haversineM(from, to) * p.rf) / p.mpm + p.over))
}
async function tflJourneyMinutes(from, to, cache) {
  const key = `${from.lat.toFixed(3)},${from.lng.toFixed(3)}|${to.lat},${to.lng}`
  if (cache.has(key)) return cache.get(key)
  let mins = null
  try {
    const res = await fetch(`https://api.tfl.gov.uk/Journey/JourneyResults/${from.lat},${from.lng}/to/${to.lat},${to.lng}`)
    if (res.ok) {
      const json = await res.json()
      const d = json.journeys?.[0]?.duration
      if (typeof d === 'number' && d > 0) mins = d
    }
  } catch {
    /* fall back to heuristic */
  }
  cache.set(key, mins)
  return mins
}

/* ---------- TfL morning status (strikes, closures, severe delays) ---------- */
async function fetchTflSevereStatus() {
  try {
    const res = await fetch('https://api.tfl.gov.uk/Line/Mode/tube,elizabeth-line,overground,dlr/Status')
    if (!res.ok) return []
    const lines = await res.json()
    const items = []
    for (const line of lines) {
      const worst = (line.lineStatuses ?? []).reduce(
        (acc, s) => (((s && s.statusSeverity) ?? 11) < ((acc && acc.statusSeverity) ?? 11) ? s : acc),
        null
      )
      if (!worst || worst.statusSeverity === undefined || !line.name) continue
      const reason = worst.reason || ''
      const isStrike = /strike|industrial action/i.test(reason)
      // severity <= 6 covers Severe Delays, Part/Planned Closure, Suspended, Closed
      if (worst.statusSeverity <= 6 || isStrike) {
        items.push({ line: line.name, status: worst.statusSeverityDescription || 'Disrupted', isStrike })
      }
    }
    return items
  } catch {
    return []
  }
}

/* ---------- morning weather (campus, Open-Meteo) ---------- */
async function fetchMorningWeather() {
  try {
    const res = await fetch(
      'https://api.open-meteo.com/v1/forecast?latitude=51.523&longitude=-0.13&hourly=temperature_2m,precipitation_probability,weather_code&forecast_days=1&timezone=Europe%2FLondon'
    )
    if (!res.ok) return null
    const json = await res.json()
    const hours = new Map()
    ;(json.hourly?.time ?? []).forEach((t, i) => {
      hours.set(t, {
        tempC: json.hourly.temperature_2m?.[i] ?? 0,
        rainProb: json.hourly.precipitation_probability?.[i] ?? 0,
        code: json.hourly.weather_code?.[i] ?? 0,
      })
    })
    return hours
  } catch {
    return null
  }
}

function weatherEmoji(code) {
  if (code === 0) return '☀️'
  if (code <= 2) return '🌤️'
  if (code === 3) return '☁️'
  if (code <= 48) return '🌫️'
  if (code <= 67) return '🌧️'
  if (code <= 77) return '🌨️'
  if (code <= 86) return '🌧️'
  return '⛈️'
}

function shortRoom(room) {
  return (room || '')
    .replace(/^IOE\s*[-–]\s*/i, '')
    .replace(/\s*\(\d+\)\s*/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s*[-–]\s*(?=\d)/g, ' ')
    .trim()
}

/* ---------- reminder computation (Europe/London) ---------- */
function londonNow() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'short',
  }).formatToParts(new Date())
  const get = (type) => parts.find((p) => p.type === type)?.value ?? '0'
  return {
    dateISO: `${get('year')}-${get('month')}-${get('day')}`,
    minutes: parseInt(get('hour'), 10) * 60 + parseInt(get('minute'), 10),
    hour: parseInt(get('hour'), 10),
    weekday: get('weekday'),
  }
}
const addDaysISO = (iso, days) => {
  const [y, m, d] = iso.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d + days))
  return date.toISOString().slice(0, 10)
}
const toMinutes = (t) => {
  const m = t.match(/^(\d{1,2}):(\d{2})$/)
  return m ? +m[1] * 60 + +m[2] : null
}
const daysBetween = (a, b) => {
  const t = (iso) => {
    const [y, m, d] = iso.split('-').map(Number)
    return Date.UTC(y, m - 1, d)
  }
  return Math.round((t(a) - t(b)) / 86400000)
}
/* ---------- timetable change detection (per-sheet snapshots in KV) ---------- */
const snapKey = (id, gid) => `snap:${id}|${gid ?? ''}`

function diffSheets(oldSessions, newSessions, todayISO) {
  const future = (list) => list.filter((s) => s.dateISO >= todayISO)
  const keyOf = (s) => `${s.dateISO}|${s.start}|${s.title.trim().toLowerCase()}`
  const oldMap = new Map(future(oldSessions).map((s) => [keyOf(s), s]))
  const newMap = new Map(future(newSessions).map((s) => [keyOf(s), s]))
  const out = []
  newMap.forEach((s, k) => {
    if (!oldMap.has(k)) out.push({ type: 'added', s })
  })
  oldMap.forEach((s, k) => {
    if (!newMap.has(k)) out.push({ type: 'removed', s })
  })
  oldMap.forEach((o, k) => {
    const n = newMap.get(k)
    if (!n) return
    const details = []
    if ((o.room || '') !== (n.room || '')) details.push(`room ${o.room || '—'} → ${n.room || '—'}`)
    if ((o.end || '') !== (n.end || '')) details.push(`ends ${o.end || '—'} → ${n.end || '—'}`)
    if ((o.tutor || '') !== (n.tutor || '')) details.push(`tutor ${o.tutor || '—'} → ${n.tutor || '—'}`)
    if (details.length > 0) out.push({ type: 'changed', s: n, detail: details.join('; ') })
  })
  return out
}

function filterForConfig(sessions, config) {
  return sessions.filter((s) => {
    if (config.spec?.length > 0 && s.specialismName && !config.spec.includes(s.specialismName)) return false
    if (config.groups?.length > 0) {
      const tokens = (s.groups || '').split(',').map((t) => t.trim()).filter(Boolean)
      if (tokens.length > 0 && !tokens.some((t) => config.groups.includes(t))) return false
    }
    return true
  })
}

const CRON_MINUTES = 10

async function runScheduled(env) {
  const now = londonNow()

  // Deliver due snoozes first.
  const snoozes = await env.PUSH.list({ prefix: 'snooze:' })
  for (const entry of snoozes.keys) {
    const item = await env.PUSH.get(entry.name, 'json')
    if (!item) continue
    if (item.fireAt <= Date.now()) {
      const record = await env.PUSH.get(item.subKey, 'json')
      if (record?.subscription) {
        await sendPush(env, record.subscription, {
          title: item.title,
          body: item.body,
          key: item.key,
          snoozeUrl: item.snoozeUrl,
        })
      }
      await env.PUSH.delete(entry.name)
    }
  }

  const list = await env.PUSH.list({ prefix: 'sub:' })
  const sheetCache = new Map()
  // Each sheet is fetched once per run; a KV snapshot of its previous state lets us
  // detect changes (rooms, times, tutors, added/cancelled sessions) and push them.
  const getSheetInfo = async (id, gid) => {
    const key = `${id}|${gid ?? ''}`
    if (!sheetCache.has(key)) {
      let sessions = await fetchSessions(id, gid)
      let changes = []
      let hadSnapshot = false
      let failCount = 0
      if (sessions.length > 0) {
        await env.PUSH.delete(`fail:${key}`)
        const old = await env.PUSH.get(snapKey(id, gid), 'json')
        if (old) {
          hadSnapshot = true
          // The sheet drops past rows daily (rolling TODAY() filter); keep the
          // history the snapshot has seen so placement-span markers and past
          // days survive — and snapshots accumulate it through rewrites.
          const freshDates = new Set(sessions.map((s) => s.dateISO))
          const retained = old.filter((s) => s.dateISO < now.dateISO && !freshDates.has(s.dateISO))
          if (retained.length > 0) sessions = sessions.concat(retained)
          changes = diffSheets(old, sessions, now.dateISO)
        }
      } else {
        // Sheet health: count consecutive failing runs so subscribers can be told.
        failCount = parseInt((await env.PUSH.get(`fail:${key}`)) ?? '0', 10) + 1
        await env.PUSH.put(`fail:${key}`, String(failCount), { expirationTtl: 86400 })
      }
      // Snapshots/diffs use the raw sheet; everything user-facing (briefing,
      // reminders, leave alerts) uses the placement-expanded view.
      sheetCache.set(key, { id, gid, sessions, expanded: expandPlacements(sessions), changes, hadSnapshot, failCount })
    }
    return sheetCache.get(key)
  }
  const getSheet = async (id, gid) => (await getSheetInfo(id, gid)).expanded
  const morningWindow = now.hour === 7 && now.minutes % 60 < CRON_MINUTES
  const eveningWindow = now.weekday === 'Sun' && now.hour === 18 && now.minutes % 60 < CRON_MINUTES
  const fridayWindow = now.weekday === 'Fri' && now.hour === 16 && now.minutes % 60 < CRON_MINUTES

  // Notices tabs: fetched once per run; new rows vs the KV seen-set push to subscribers.
  // A tab seen for the first time seeds silently (no backlog flood).
  const noticesCache = new Map()
  const noticesDirty = new Map()
  const getNewNotices = async (id, gid) => {
    const key = `${id}|${gid ?? ''}`
    if (!noticesCache.has(key)) {
      let fresh = []
      const rows = await fetchNoticeRows(id, gid)
      if (rows) {
        const seenKey = `ntcseen:${key}`
        const seen = (await env.PUSH.get(seenKey, 'json')) ?? null
        if (seen === null) {
          noticesDirty.set(seenKey, rows.map((r) => r.id))
        } else {
          fresh = rows.filter((r) => !seen.includes(r.id))
          if (fresh.length > 0) {
            noticesDirty.set(seenKey, [...new Set([...seen, ...rows.map((r) => r.id)])].slice(-200))
          }
        }
      }
      noticesCache.set(key, fresh)
    }
    return noticesCache.get(key)
  }
  const tflIssues = morningWindow && list.keys.length > 0 ? await fetchTflSevereStatus() : []
  let morningWeather = null
  let morningWeatherFetched = false
  const journeyCache = new Map()
  for (const entry of list.keys) {
    const record = await env.PUSH.get(entry.name, 'json')
    if (!record?.subscription?.endpoint || !record?.config?.sheetId) continue
    const { subscription, config } = record
    // Quiet hours: nothing is sent (or marked sent) inside the window; anything
    // still relevant when it ends fires on a later run.
    if (inQuietHours(now.hour, config.quietFrom, config.quietTo)) continue
    const due = []

    // New cohort notices (gated with change alerts — both are "the sheet changed" pushes).
    if (config.noticesSheetId && config.changeAlerts !== false) {
      const fresh = await getNewNotices(config.noticesSheetId, config.noticesGid)
      if (fresh.length > 0) {
        const lines = fresh.slice(0, 2).map((n) => n.message)
        due.push({
          dedupe: `ntc|${fresh.map((n) => n.id).join(',')}`,
          title: fresh.length === 1 ? '📣 Cohort notice' : `📣 ${fresh.length} cohort notices`,
          body: (lines.join(' · ') + (fresh.length > 2 ? ` +${fresh.length - 2} more` : '')).slice(0, 290),
        })
      }
    }

    // Sheet health: after ~1 hour of consecutive failures, tell its subscribers once.
    {
      const info = await getSheetInfo(config.sheetId, config.gid)
      if (info.failCount === 6) {
        due.push({
          dedupe: `srcfail|${now.dateISO}`,
          title: '⚠ Timetable source problem',
          body: 'Your timetable sheet hasn’t loaded for the last hour — check it’s still shared as “anyone with the link can view”.',
        })
      }
    }

    // Timetable-change push: diff of this run vs the stored snapshot, filtered to
    // this subscriber's specialisms/groups, batched into one notification.
    if (config.changeAlerts !== false) {
      const info = await getSheetInfo(config.sheetId, config.gid)
      // A wholesale wipe (>50 removals) is almost certainly a fetch/parse glitch — skip.
      const removals = info.changes.filter((c) => c.type === 'removed').length
      if (info.changes.length > 0 && removals <= 50) {
        const mine = info.changes.filter((c) => filterForConfig([c.s], config).length > 0)
        if (mine.length > 0) {
          const fmtDate = (iso) => {
            const [, m, d] = iso.split('-')
            return `${d}/${m}`
          }
          const lines = mine.slice(0, 3).map((c) =>
            c.type === 'changed'
              ? `${c.s.title} (${fmtDate(c.s.dateISO)}): ${c.detail}`
              : c.type === 'added'
                ? `Added: ${c.s.title} (${fmtDate(c.s.dateISO)} ${c.s.start})`
                : `Cancelled: ${c.s.title} (${fmtDate(c.s.dateISO)})`
          )
          due.push({
            dedupe: `chg|${now.dateISO}|${now.minutes}`,
            title: mine.length === 1 ? '📋 Timetable change' : `📋 ${mine.length} timetable changes`,
            body: (lines.join(' · ') + (mine.length > 3 ? ` +${mine.length - 3} more` : '')).slice(0, 290),
          })
        }
      }
    }

    // Morning briefing: 07:00 London on days with sessions — first session, weather, next deadline.
    if (morningWindow && config.briefing !== false) {
      const sessions = filterForConfig(await getSheet(config.sheetId, config.gid), config)
      const todays = sessions
        .filter((s) => s.dateISO === now.dateISO && !s.isSelfStudy && toMinutes(s.start) !== null)
        .sort((a, b) => a.start.localeCompare(b.start))
      if (todays.length === 0) {
        // First weekday of a week-plus gap: one "enjoy the break" note, so a silent
        // morning is distinguishable from a broken sheet.
        const dow = new Date(`${now.dateISO}T12:00:00Z`).getUTCDay()
        if (dow >= 1 && dow <= 5) {
          const nextDay = sessions
            .filter((s) => s.dateISO > now.dateISO && !s.isSelfStudy)
            .map((s) => s.dateISO)
            .sort()[0]
          const prevWeekdayISO = (() => {
            const d = new Date(`${now.dateISO}T12:00:00Z`)
            d.setUTCDate(d.getUTCDate() - (dow === 1 ? 3 : 1))
            return d.toISOString().slice(0, 10)
          })()
          const hadPrev = sessions.some((s) => s.dateISO === prevWeekdayISO && !s.isSelfStudy)
          if (nextDay && hadPrev && daysBetween(nextDay, now.dateISO) >= 7) {
            const [ny, nm, nd] = nextDay.split('-').map(Number)
            const nextLabel = new Date(Date.UTC(ny, nm - 1, nd)).toLocaleDateString('en-GB', {
              weekday: 'short',
              day: 'numeric',
              month: 'short',
              timeZone: 'UTC',
            })
            due.push({
              dedupe: `break|${nextDay}`,
              title: '🏖 Term break',
              body: `No sessions until ${nextLabel} — enjoy the break! The morning briefing pauses until then.`,
            })
          }
        }
      }
      if (todays.length > 0) {
        const first = todays[0]
        let body = `First: ${first.start} ${first.title}`
        const school = placementSchool(first, config)
        if (school) body += ` · ${school}`
        else if (first.room) body += ` · ${shortRoom(first.room)}`
        if (!morningWeatherFetched) {
          morningWeatherFetched = true
          morningWeather = await fetchMorningWeather()
        }
        const w = morningWeather?.get(`${now.dateISO}T${first.start.slice(0, 2)}:00`)
        if (w) {
          body += ` · ${weatherEmoji(w.code)} ${Math.round(w.tempC)}°${w.rainProb >= 30 ? ` ${w.rainProb}% rain` : ''}`
        }
        if (config.kdGid || config.kdSheetId) {
          const keyDates = await getSheet(config.kdSheetId || config.sheetId, config.kdGid)
          const next = keyDates
            .map((kd) => ({ kd, days: daysBetween(kd.dateISO, now.dateISO) }))
            .filter((x) => x.days >= 0 && x.days <= 7)
            .sort((a, b) => a.days - b.days)[0]
          if (next) {
            body += ` · 📌 ${next.kd.title} ${next.days === 0 ? 'today' : `in ${next.days}d`}`
          }
        }
        due.push({
          dedupe: `brief|${now.dateISO}`,
          title: `Good morning — ${todays.length} session${todays.length === 1 ? '' : 's'} today`,
          body: body.slice(0, 290),
        })
      }
    }

    // Strike-day / severe-disruption alert: 07:00 London, transit users, days with sessions.
    if (tflIssues.length > 0 && (config.travelMode === 'transit' || config.travelMode === undefined)) {
      const sessions = filterForConfig(await getSheet(config.sheetId, config.gid), config)
      if (sessions.some((s) => s.dateISO === now.dateISO && !s.isSelfStudy)) {
        const strike = tflIssues.some((i) => i.isStrike)
        due.push({
          dedupe: `tfl|${now.dateISO}`,
          title: strike ? '🚨 Strike action on TfL today' : '⚠ TfL disruption this morning',
          body:
            tflIssues.slice(0, 4).map((i) => `${i.line}: ${i.status}`).join(' · ') +
            (tflIssues.length > 4 ? ` +${tflIssues.length - 4} more` : '') +
            ' — allow extra time',
        })
      }
    }

    // Background leave alerts: session start − travel from the cached last-app-open
    // location (live TfL journey when the mode is transit), with the chosen head start.
    const loc = record.loc
    const locFresh = loc && Date.now() - loc.at < 18 * 3600 * 1000
    if (config.bgLeave === true && (config.leaveAlertOffsets ?? []).length > 0 && locFresh) {
      const sessions = filterForConfig(await getSheet(config.sheetId, config.gid), config)
      for (const s of sessions) {
        if (s.dateISO !== now.dateISO || s.isSelfStudy) continue
        const start = toMinutes(s.start)
        if (start === null || start <= now.minutes) continue
        let building = matchBuilding(s.room)
        // Placement days have no campus room — route to the geocoded school instead.
        if (!building && isPlacementTitle(s.title)) {
          const p = config.placements?.[s.placementTag ?? placementTagOf(s.title)]
          if (p && typeof p.lat === 'number' && typeof p.lng === 'number') {
            building = { name: p.school || 'placement school', lat: p.lat, lng: p.lng }
          }
        }
        if (!building) continue
        const mode = config.travelMode ?? 'walking'
        let travelMins = heuristicMinutes(loc, building, mode)
        let liveLabel = ''
        if (mode === 'transit') {
          const live = await tflJourneyMinutes(loc, building, journeyCache)
          if (live !== null) {
            travelMins = live
            liveLabel = ' (live TfL)'
          }
        }
        const untilLeave = start - now.minutes - travelMins
        for (const offset of config.leaveAlertOffsets) {
          if (untilLeave > offset - CRON_MINUTES && untilLeave <= offset) {
            const ageH = Math.round((Date.now() - loc.at) / 3600000)
            due.push({
              dedupe: `leave|${s.dateISO}|${s.start}|${s.title}|${offset}`,
              key: `${s.dateISO}|${s.start}|${s.title.trim().toLowerCase()}`,
              title:
                untilLeave <= 2 ? `Time to leave — ${s.title}` : `Leave in ~${untilLeave}m — ${s.title}`,
              body:
                `≈ ${travelMins}m ${MODE_PARAMS[mode]?.phrase ?? 'journey'}${liveLabel} to ${building.name} · starts ${s.start}` +
                (ageH >= 2 ? ` · location from ${ageH}h ago` : ''),
            })
          }
        }
      }
    }

    // End-of-session attendance prompts: a "did you attend?" push carrying the session
    // key, so the notification's ✓ Attended action logs it without opening the app.
    if (config.attendancePrompts === true) {
      const sessions = filterForConfig(await getSheet(config.sheetId, config.gid), config)
      for (const s of sessions) {
        if (s.dateISO !== now.dateISO || s.isSelfStudy) continue
        const end = toMinutes(s.end)
        if (end === null) continue
        const since = now.minutes - end
        if (since >= 0 && since < CRON_MINUTES) {
          const sKey = `${s.dateISO}|${s.start}|${s.title.trim().toLowerCase()}`
          due.push({
            dedupe: `att|${s.dateISO}|${s.end}|${s.title}`,
            key: sKey,
            tag: `att-${sKey}`,
            title: `Did you attend ${s.title}?`,
            body: 'Tap ✓ Attended to log it — it counts toward attendance and placement days.',
          })
        }
      }
    }

    // Friday 16:00 admin digest: outstanding PGCE admin, from counts the app syncs
    // on use (so "as of your last app open"). Only sent when something's outstanding.
    if (fridayWindow && config.fridayDigest !== false && config.adminSummary) {
      const a = config.adminSummary
      const parts = []
      if (a.openTargets > 0) parts.push(`🎯 ${a.openTargets} open target${a.openTargets === 1 ? '' : 's'}`)
      if (a.openActions > 0) parts.push(`☐ ${a.openActions} mentor action${a.openActions === 1 ? '' : 's'} to tick off`)
      // Reflection missing this week — only nag if the week actually had sessions.
      const weekMonday = (() => {
        const d = new Date(`${now.dateISO}T12:00:00Z`)
        d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7))
        return d.toISOString().slice(0, 10)
      })()
      if ((a.lastReflectionWeek || '') < weekMonday) {
        const sessions = filterForConfig(await getSheet(config.sheetId, config.gid), config)
        if (sessions.some((s) => s.dateISO >= weekMonday && s.dateISO <= now.dateISO && !s.isSelfStudy)) {
          parts.push('✍️ no reflection logged this week')
        }
      }
      if (parts.length > 0) {
        due.push({
          dedupe: `fri|${now.dateISO}`,
          title: '📋 Friday admin check',
          body: (parts.join(' · ') + ' — five minutes now saves the Sunday scramble.').slice(0, 290),
        })
      }
    }

    // Sunday 18:00 week-ahead briefing: the week's shape, plus a warning when a
    // placement block starts (the morning people most want a day's notice for).
    if (eveningWindow && config.briefing !== false) {
      const sessions = filterForConfig(await getSheet(config.sheetId, config.gid), config)
      const weekFrom = addDaysISO(now.dateISO, 1)
      const weekTo = addDaysISO(now.dateISO, 7)
      const week = sessions.filter((s) => s.dateISO >= weekFrom && s.dateISO <= weekTo && !s.isSelfStudy)
      if (week.length > 0) {
        const days = new Set(week.map((s) => s.dateISO)).size
        let body = `${week.length} session${week.length === 1 ? '' : 's'} over ${days} day${days === 1 ? '' : 's'}`
        if (config.kdGid || config.kdSheetId) {
          const keyDates = await getSheet(config.kdSheetId || config.sheetId, config.kdGid)
          const dueCount = keyDates.filter((kd) => kd.dateISO >= weekFrom && kd.dateISO <= weekTo).length
          if (dueCount > 0) body += ` · 📌 ${dueCount} deadline${dueCount === 1 ? '' : 's'}`
        }
        const placementStart = week
          .filter((s) => isPlacementTitle(s.title))
          .sort((a, b) => a.dateISO.localeCompare(b.dateISO))
          .find((s) => {
            const tag = s.placementTag ?? placementTagOf(s.title)
            return !sessions.some(
              (x) =>
                x.dateISO < s.dateISO &&
                x.dateISO >= addDaysISO(s.dateISO, -3) &&
                isPlacementTitle(x.title) &&
                (x.placementTag ?? placementTagOf(x.title)) === tag
            )
          })
        if (placementStart) {
          const [py, pm, pd] = placementStart.dateISO.split('-').map(Number)
          const dayName = new Date(Date.UTC(py, pm - 1, pd)).toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' })
          const tag = placementStart.placementTag ?? placementTagOf(placementStart.title)
          const school = config.placements?.[tag]?.school
          body += ` · 🏫 ${tag} starts ${dayName}${school ? ` — ${school}` : ''}`
        }
        due.push({
          dedupe: `week|${now.dateISO}`,
          title: '📅 Your week ahead',
          body: body.slice(0, 290),
        })
      }
    }

    if ((config.reminderOffsets ?? []).length > 0) {
      const sessions = filterForConfig(await getSheet(config.sheetId, config.gid), config)
      for (const s of sessions) {
        if (s.dateISO !== now.dateISO || s.isSelfStudy) continue
        const start = toMinutes(s.start)
        if (start === null) continue
        const delta = start - now.minutes
        for (const offset of config.reminderOffsets) {
          if (delta > offset - CRON_MINUTES && delta <= offset) {
            const school = placementSchool(s, config)
            due.push({
              dedupe: `${s.dateISO}|${s.start}|${s.title}|${offset}`,
              key: `${s.dateISO}|${s.start}|${s.title.trim().toLowerCase()}`,
              title: s.title,
              body: `Starts ${s.start}${school ? ` · ${school}` : s.room ? ` · ${s.room}` : ''}`,
            })
          }
        }
      }
    }

    if ((config.keyDateReminderDays ?? []).length > 0 && (config.kdGid || config.kdSheetId) && morningWindow) {
      const keyDates = await getSheet(config.kdSheetId || config.sheetId, config.kdGid)
      for (const kd of keyDates) {
        const days = daysBetween(kd.dateISO, now.dateISO)
        for (const d of config.keyDateReminderDays) {
          if (days === d) {
            due.push({
              dedupe: `kd|${kd.dateISO}|${kd.title}|${d}`,
              key: `${kd.dateISO}|${kd.start}|${kd.title.trim().toLowerCase()}`,
              title: `📌 ${kd.title}`,
              body: days === 0 ? 'Due today' : `Due in ${days} day${days === 1 ? '' : 's'}`,
            })
          }
        }
      }
    }

    // Digest batching: several due items in one run arrive as a single notification.
    const unsent = []
    for (const item of due) {
      const sentKey = `sent:${entry.name.slice(4)}:${item.dedupe}`
      if (await env.PUSH.get(sentKey)) continue
      unsent.push({ ...item, sentKey })
    }
    if (unsent.length === 0) continue
    const payload =
      unsent.length === 1
        ? { title: unsent[0].title, body: unsent[0].body, key: unsent[0].key, tag: unsent[0].tag, snoozeUrl: record.base }
        : {
            title: `${unsent.length} timetable updates`,
            body: unsent
              .map((i) => i.title)
              .join(' · ')
              .slice(0, 290),
          }
    const result = await sendPush(env, subscription, payload)
    if (result === 'gone') {
      await env.PUSH.delete(entry.name)
      continue
    }
    if (result === 'ok') {
      for (const item of unsent) await env.PUSH.put(item.sentKey, '1', { expirationTtl: 172800 })
    }
  }

  // Persist snapshots (first seeding, or after real changes) so the next run diffs
  // against today's state.
  for (const info of sheetCache.values()) {
    if (info.sessions.length > 0 && (!info.hadSnapshot || info.changes.length > 0)) {
      await env.PUSH.put(snapKey(info.id, info.gid), JSON.stringify(info.sessions))
    }
  }
  for (const [seenKey, ids] of noticesDirty) {
    await env.PUSH.put(seenKey, JSON.stringify(ids))
  }
}

/* ---------- HTTP ---------- */
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
}
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json', ...CORS } })

async function endpointKey(endpoint) {
  const digest = await crypto.subtle.digest('SHA-256', utf8(endpoint))
  return `sub:${b64url(digest)}`
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS })
    if (request.method === 'GET' && url.pathname === '/vapid') {
      const vapid = await getVapid(env)
      return json({ publicKey: vapid.publicKey })
    }
    // Sheet history from the cron's snapshot (the sheet itself drops past rows) —
    // the app back-fills days it lost before local retention shipped. The sheet
    // is public by definition here, so this exposes nothing new.
    if (request.method === 'GET' && url.pathname === '/history') {
      const id = url.searchParams.get('id') ?? ''
      if (!/^[a-zA-Z0-9_-]{20,}$/.test(id)) return json({ error: 'invalid id' }, 400)
      const gid = url.searchParams.get('gid')
      const snap = await env.PUSH.get(snapKey(id, gid || null), 'json')
      return json({ sessions: snap ?? [] })
    }
    if (request.method === 'POST' && url.pathname === '/subscribe') {
      const body = await request.json().catch(() => null)
      if (!body?.subscription?.endpoint || !body?.subscription?.keys?.p256dh || !body?.config?.sheetId) {
        return json({ error: 'invalid subscription' }, 400)
      }
      const subKey = await endpointKey(body.subscription.endpoint)
      const existing = await env.PUSH.get(subKey, 'json')
      await env.PUSH.put(
        subKey,
        JSON.stringify({ subscription: body.subscription, config: body.config, base: url.origin, loc: existing?.loc })
      )
      return json({ ok: true })
    }
    if (request.method === 'POST' && url.pathname === '/snooze') {
      const body = await request.json().catch(() => null)
      if (!body?.endpoint || !body?.title || typeof body?.fireAt !== 'number') {
        return json({ error: 'invalid snooze' }, 400)
      }
      const subKey = await endpointKey(body.endpoint)
      if (!(await env.PUSH.get(subKey))) return json({ error: 'unknown subscription' }, 404)
      await env.PUSH.put(
        `snooze:${subKey.slice(4)}:${Date.now()}`,
        JSON.stringify({
          subKey,
          title: String(body.title).slice(0, 120),
          body: String(body.body ?? '').slice(0, 300),
          key: body.key,
          fireAt: body.fireAt,
          snoozeUrl: url.origin,
        }),
        { expirationTtl: 86400 }
      )
      return json({ ok: true })
    }
    if (request.method === 'POST' && url.pathname === '/test') {
      // throttled: at most one test broadcast per 10 minutes
      if (await env.PUSH.get('testlock')) return json({ error: 'try again in a few minutes' }, 429)
      await env.PUSH.put('testlock', '1', { expirationTtl: 600 })
      const list = await env.PUSH.list({ prefix: 'sub:' })
      const results = []
      for (const entry of list.keys) {
        const record = await env.PUSH.get(entry.name, 'json')
        if (!record?.subscription?.endpoint) continue
        const r = await sendPushDetailed(env, record.subscription, {
          title: '✅ Test notification',
          body: 'Background push is working. This came from the timetable-push worker.',
        })
        results.push({ endpointHost: new URL(record.subscription.endpoint).hostname, ...r })
      }
      return json({ results })
    }
    /* ---------- study groups: shared free-slot codes (times only, no session details) ---------- */
    const cleanSlots = (slots) =>
      Array.isArray(slots)
        ? slots
            .filter(
              (s) =>
                s &&
                /^\d{4}-\d{2}-\d{2}$/.test(s.d) &&
                Number.isInteger(s.from) &&
                Number.isInteger(s.to) &&
                s.from >= 0 &&
                s.to > s.from &&
                s.to <= 1440
            )
            .slice(0, 120)
        : []
    const cleanName = (n) => String(n ?? '').trim().slice(0, 24)
    if (request.method === 'POST' && url.pathname === '/group') {
      const body = await request.json().catch(() => null)
      const name = cleanName(body?.name)
      if (!name) return json({ error: 'missing name' }, 400)
      const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
      let code = ''
      for (const b of crypto.getRandomValues(new Uint8Array(6))) code += chars[b % chars.length]
      await env.PUSH.put(
        `grp:${code}`,
        JSON.stringify({ createdAt: Date.now(), members: { [name]: { slots: cleanSlots(body?.slots), at: Date.now() } } }),
        { expirationTtl: 21 * 86400 }
      )
      return json({ code })
    }
    if (request.method === 'POST' && url.pathname === '/group/join') {
      const body = await request.json().catch(() => null)
      const name = cleanName(body?.name)
      const code = String(body?.code ?? '').toUpperCase().trim()
      if (!name || !/^[A-Z2-9]{4,8}$/.test(code)) return json({ error: 'invalid request' }, 400)
      const group = await env.PUSH.get(`grp:${code}`, 'json')
      if (!group) return json({ error: 'unknown group' }, 404)
      if (!group.members[name] && Object.keys(group.members).length >= 12) {
        return json({ error: 'group is full' }, 403)
      }
      group.members[name] = { slots: cleanSlots(body?.slots), at: Date.now() }
      await env.PUSH.put(`grp:${code}`, JSON.stringify(group), { expirationTtl: 21 * 86400 })
      return json({ ok: true })
    }
    if (request.method === 'GET' && url.pathname === '/group') {
      const code = String(url.searchParams.get('code') ?? '').toUpperCase().trim()
      const group = code ? await env.PUSH.get(`grp:${code}`, 'json') : null
      if (!group) return json({ error: 'unknown group' }, 404)
      const members = Object.entries(group.members).map(([name, m]) => ({ name, at: m.at, slots: m.slots }))
      return json({ members })
    }
    if (request.method === 'POST' && url.pathname === '/group/leave') {
      const body = await request.json().catch(() => null)
      const code = String(body?.code ?? '').toUpperCase().trim()
      const name = cleanName(body?.name)
      const group = code ? await env.PUSH.get(`grp:${code}`, 'json') : null
      if (group && name && group.members[name]) {
        delete group.members[name]
        if (Object.keys(group.members).length === 0) await env.PUSH.delete(`grp:${code}`)
        else await env.PUSH.put(`grp:${code}`, JSON.stringify(group), { expirationTtl: 21 * 86400 })
      }
      return json({ ok: true })
    }
    /* ---------- anonymous usage analytics (self-hosted; a random token per device) ---------- */
    if (request.method === 'POST' && url.pathname === '/ping') {
      const body = await request.json().catch(() => null)
      const d = String(body?.d ?? '')
      if (!/^[0-9a-f]{8,32}$/.test(d)) return json({ error: 'invalid ping' }, 400)
      const date = new Date().toISOString().slice(0, 10)
      const rec = {
        i: body?.i === true,
        p: ['ios', 'android', 'desktop'].includes(body?.p) ? body.p : 'other',
        v: Number(body?.v) || 0,
      }
      await env.PUSH.put(`aping:${date}:${d}`, JSON.stringify(rec), { expirationTtl: 90 * 86400 })
      if (!(await env.PUSH.get(`adev:${d}`))) await env.PUSH.put(`adev:${d}`, date)
      return json({ ok: true })
    }
    if (request.method === 'GET' && url.pathname === '/stats') {
      // Owner-only: when a 'statskey' exists in KV, ?key= must match it.
      const requiredKey = await env.PUSH.get('statskey')
      if (requiredKey && url.searchParams.get('key') !== requiredKey) {
        return json({ error: 'unauthorized' }, 401)
      }
      const days = Math.min(62, Math.max(1, parseInt(url.searchParams.get('days') ?? '31', 10) || 31))
      // First-seen dates per device → new-device counts and retention.
      const firstSeen = new Map()
      const devList = await env.PUSH.list({ prefix: 'adev:' })
      for (const k of devList.keys) {
        firstSeen.set(k.name.slice(5), await env.PUSH.get(k.name))
      }
      const daily = []
      const activeWeek = new Set()
      const activeMonth = new Set()
      const deviceDays = new Map()
      const versions = {}
      for (let i = 0; i < days; i++) {
        const date = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10)
        const list = await env.PUSH.list({ prefix: `aping:${date}:` })
        let installed = 0
        let newDevices = 0
        const platforms = {}
        for (const k of list.keys) {
          const rec = await env.PUSH.get(k.name, 'json')
          const dev = k.name.split(':')[2]
          if (rec?.i) installed++
          const p = rec?.p ?? 'other'
          platforms[p] = (platforms[p] ?? 0) + 1
          if (firstSeen.get(dev) === date) newDevices++
          if (i < 7) activeWeek.add(dev)
          if (i < 30) activeMonth.add(dev)
          deviceDays.set(dev, (deviceDays.get(dev) ?? 0) + 1)
          if (i === 0 && rec?.v) versions[rec.v] = (versions[rec.v] ?? 0) + 1
        }
        daily.push({ date, active: list.keys.length, installed, newDevices, platforms })
      }
      // Stickiness: how many distinct days each device appeared in the window.
      let d1 = 0, d2to4 = 0, d5plus = 0
      for (const n of deviceDays.values()) {
        if (n >= 5) d5plus++
        else if (n >= 2) d2to4++
        else d1++
      }
      return json({
        generatedAt: new Date().toISOString(),
        windowDays: days,
        totalDevicesEver: devList.keys.length,
        activeLast7Days: activeWeek.size,
        activeLast30Days: activeMonth.size,
        todayVersions: versions,
        retention: { oneDay: d1, twoToFourDays: d2to4, fivePlusDays: d5plus },
        daily,
      })
    }
    /* ---------- cross-device sync: opaque encrypted blobs keyed by a hash of the code ---------- */
    if (request.method === 'POST' && url.pathname === '/sync') {
      const body = await request.json().catch(() => null)
      const id = String(body?.id ?? '')
      if (
        !/^[0-9a-f]{64}$/.test(id) ||
        typeof body?.blob !== 'string' ||
        body.blob.length > 400000 ||
        typeof body?.at !== 'number'
      ) {
        return json({ error: 'invalid sync payload' }, 400)
      }
      await env.PUSH.put(`sync:${id}`, JSON.stringify({ blob: body.blob, at: body.at }), {
        expirationTtl: 90 * 86400,
      })
      return json({ ok: true })
    }
    if (request.method === 'GET' && url.pathname === '/sync') {
      const id = String(url.searchParams.get('id') ?? '')
      const rec = /^[0-9a-f]{64}$/.test(id) ? await env.PUSH.get(`sync:${id}`, 'json') : null
      if (!rec) return json({ error: 'not found' }, 404)
      return json(rec)
    }
    if (request.method === 'POST' && url.pathname === '/sync/delete') {
      const body = await request.json().catch(() => null)
      const id = String(body?.id ?? '')
      if (!/^[0-9a-f]{64}$/.test(id)) return json({ error: 'invalid id' }, 400)
      await env.PUSH.delete(`sync:${id}`)
      return json({ ok: true })
    }
    if (request.method === 'POST' && url.pathname === '/location') {
      const body = await request.json().catch(() => null)
      const lat = Number(body?.lat)
      const lng = Number(body?.lng)
      if (!body?.endpoint || !isFinite(lat) || !isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
        return json({ error: 'invalid location' }, 400)
      }
      const subKey = await endpointKey(body.endpoint)
      const record = await env.PUSH.get(subKey, 'json')
      if (!record) return json({ error: 'unknown subscription' }, 404)
      record.loc = { lat, lng, at: Date.now() }
      await env.PUSH.put(subKey, JSON.stringify(record))
      return json({ ok: true })
    }
    if (request.method === 'POST' && url.pathname === '/unsubscribe') {
      const body = await request.json().catch(() => null)
      if (!body?.endpoint) return json({ error: 'missing endpoint' }, 400)
      await env.PUSH.delete(await endpointKey(body.endpoint))
      return json({ ok: true })
    }
    return json({ error: 'not found' }, 404)
  },
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(runScheduled(env))
  },
}
