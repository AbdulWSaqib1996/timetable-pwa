import { validWorkerConfig } from '../../shared/contracts.js'
import { filterSessionsForMembership } from '../../shared/membership.js'
import { parseTimetable, parseDateCell } from '../../shared/timetable.js'
import { reconcileEvents, eventKey } from '../../shared/identity.js'
export { SyncStore } from './sync-store.js'
export { GroupStore } from './group-store.js'
export { AnalyticsStore } from './analytics-store.js'
import { MAX_BATCH_BYTES, validateBatch } from '../../shared/analytics-contracts.js'
/**
 * timetable-push worker — background Web Push for My Timetable.
 *
 * Endpoints (CORS-open):
 *   GET  /vapid        → { publicKey }  (ES256 keypair auto-generated into KV on first call)
 *   POST /subscribe    → { subscription, config } stored in KV
 *   POST /test-device  → one test, authenticated with this subscription’s keys
 *   POST /test         → 410 (legacy broadcast permanently disabled)
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
    if (!(await validSubscription(subscription))) return { status: 0, detail: 'invalid subscription' }
    const vapid = await getVapid(env)
    const audience = new URL(subscription.endpoint).origin
    const jwt = await vapidJwt(audience, vapid)
    const body = await encryptPayload(JSON.stringify(payload), subscription.keys.p256dh, subscription.keys.auth)
    const res = await fetch(subscription.endpoint, {
      method: 'POST',
      redirect: 'manual',
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
const MONTHS = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11 }
const pad = n => String(n).padStart(2,'0')
const cellText = c => !c ? '' : String(c.f || c.v || '').trim()
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
  try { return parseTimetable(table).sessions.map(s => ({...s, sourceKey:`${sheetId}|${gid ?? ''}`})) } catch { return [] }
}

/* ---------- placement (school experience) parity with the app ---------- */
const isSelfStudyTitle = (t) => /\bself[- ]?study\b/i.test(t || '')
const isPlacementTitle = (t) => !isSelfStudyTitle(t) && /school experience|placement|\bSE ?\d[a-z]?\b/i.test(t || '')
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
/* ---------- attendance answers reported by the app (FA-03) ----------
 * record.attendance = { [profileId]: { [dayISO]: { rev, keys: [...] } } } —
 * an authoritative snapshot per profile and course day with a revision
 * guard. Legacy `record.marks` (a flat union keyed by session key, whose
 * keys start with the course date) is migrated into the subscription's own
 * profile when that profile is unambiguous, else expired. Days older than
 * two days are dropped on every write. Already-delivered prompts stay
 * suppressed by the existing `sent:` keys, so clearing an answer can never
 * cause a second notification for the same session. */
const ATTENDANCE_DAY_RE = /^\d{4}-\d{2}-\d{2}$/
const ATTENDANCE_KEEP_DAYS = 2

function attendanceDayISO(ms) {
  return new Date(ms).toISOString().slice(0, 10)
}

function attendanceKeepDay(day, nowMs) {
  const cutoff = attendanceDayISO(nowMs - ATTENDANCE_KEEP_DAYS * 86400 * 1000)
  return day >= cutoff
}

/** Migrate + prune; returns a fresh object (never mutates the stored one). */
export function normalizeAttendance(record, nowMs = Date.now()) {
  const out = {}
  for (const [pid, days] of Object.entries(record?.attendance ?? {})) {
    for (const [day, snap] of Object.entries(days ?? {})) {
      if (!ATTENDANCE_DAY_RE.test(day) || !attendanceKeepDay(day, nowMs) || !snap || !Array.isArray(snap.keys)) continue
      ;(out[pid] ??= {})[day] = { rev: Number.isInteger(snap.rev) ? snap.rev : 0, keys: [...new Set(snap.keys.filter((k) => typeof k === 'string'))].sort() }
    }
  }
  const legacyProfile = record?.config?.profileId
  for (const [key, at] of Object.entries(record?.marks ?? {})) {
    if (typeof legacyProfile !== 'string' || nowMs - Number(at) >= ATTENDANCE_KEEP_DAYS * 86400 * 1000) continue
    const day = key.slice(0, 10)
    if (!ATTENDANCE_DAY_RE.test(day) || !attendanceKeepDay(day, nowMs)) continue
    const snap = ((out[legacyProfile] ??= {})[day] ??= { rev: 0, keys: [] })
    if (!snap.keys.includes(key)) snap.keys = [...snap.keys, key].sort()
  }
  return out
}

/** Apply one report. Returns { status: 'applied' | 'unchanged' | 'stale', rev, attendance }. */
export function applyAttendanceReport(record, report, nowMs = Date.now()) {
  const attendance = normalizeAttendance(record, nowMs)
  const days = (attendance[report.profileId] ??= {})
  const current = days[report.day]
  const keys = [...new Set(report.keys)].sort()
  if (current && report.rev < current.rev) return { status: 'stale', rev: current.rev, attendance }
  if (current && report.rev === current.rev && JSON.stringify(current.keys) === JSON.stringify(keys)) return { status: 'unchanged', rev: current.rev, attendance }
  days[report.day] = { rev: report.rev, keys }
  return { status: 'applied', rev: report.rev, attendance }
}

/** Session keys answered for a profile on a course day (with legacy migration). */
export function attendanceMarksFor(record, profileId, day, nowMs = Date.now()) {
  return new Set(normalizeAttendance(record, nowMs)[profileId]?.[day]?.keys ?? [])
}

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
/* ---------- location parsing (compact port of the app's src/lib/location.ts) ---------- */
function parseLoc(raw) {
  const text = (raw ?? '').trim()
  if (!text) return { raw: text }
  if (/^tbc$/i.test(text)) return { raw: text, note: 'tbc' }
  if (/^\d{6,}$/.test(text)) return { raw: text, note: 'booking-ref' }
  let m = text.match(/^IOE\s*[-–]\s*(.+?)\s*\((\d+)\)\s*[-–]\s*(.+)$/)
  if (m) {
    const nameMatch = m[3].match(/^([\w.]+)\s*[-–]\s*(.+)$/)
    return {
      building: `IOE · ${m[2]} ${m[1]}`,
      short: 'Bedford Way',
      room: nameMatch ? nameMatch[1] : m[3].trim(),
      roomName: nameMatch ? nameMatch[2].trim() : undefined,
      raw: text,
    }
  }
  m = text.match(/^(Cruciform Building)\s+(.+)$/i)
  if (m) return { building: m[1], short: 'Cruciform', room: m[2].trim(), raw: text }
  m = text.match(/^(Christopher Ingold Building)\s*[-–]\s*(.+)$/i)
  if (m) return { building: m[1], short: 'Christopher Ingold', room: m[2].trim(), raw: text }
  m = text.match(/^([A-Z]?\d+\w*)\s+Darwin(?:\s+(.*))?$/i)
  if (m) {
    const rest = (m[2] || '').trim()
    return {
      building: 'Darwin Building',
      short: 'Darwin',
      room: m[1],
      roomName: rest.toUpperCase() === 'LT' ? 'Lecture Theatre' : rest || undefined,
      raw: text,
    }
  }
  return { raw: text }
}

/** Human sentence for a location change (mirrors the app's describeRoomChange). */
function describeRoomChange(oldRoom, newRoom) {
  const a = parseLoc(oldRoom)
  const b = parseLoc(newRoom)
  const roomLabel = (p) => (p.room ? `${p.room}${p.roomName ? ` (${p.roomName})` : ''}` : p.raw || '—')
  const full = (p) => (p.building ? `${p.short} Rm ${roomLabel(p)}` : p.note ? 'TBC' : p.raw || '—')
  if (a.note && b.building) return `Room confirmed: ${full(b)} (was TBC)`
  if (b.note && a.building) return `Room now TBC (was ${full(a)})`
  if (a.building && b.building) {
    const sameBuilding = a.building === b.building
    const sameRoom = roomLabel(a) === roomLabel(b)
    if (sameBuilding && !sameRoom) return `Room changed: ${roomLabel(a)} → ${roomLabel(b)}`
    if (!sameBuilding && sameRoom) return `Building changed: ${a.short} → ${b.short} (Rm ${roomLabel(b)})`
    if (!sameBuilding) return `Building & room changed: ${full(a)} → ${full(b)}`
  }
  return `Location changed: ${a.raw || '—'} → ${b.raw || '—'}`
}

/* ---------- timetable change detection (per-sheet snapshots in KV) ---------- */
const snapKey = (id, gid) => `snap:${id}|${gid ?? ''}`

function diffSheets(oldSessions, newSessions, todayISO) {
  const future = (list) => list.filter((s) => s.dateISO >= todayISO)
  const keyOf = eventKey
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
    if ((o.room || '') !== (n.room || '')) details.push(describeRoomChange(o.room || '', n.room || ''))
    if ((o.end || '') !== (n.end || '')) details.push(`End time changed: ${o.end || '—'} → ${n.end || '—'}`)
    if ((o.tutor || '') !== (n.tutor || '')) details.push(`Tutor changed: ${o.tutor || '—'} → ${n.tutor || '—'}`)
    if (details.length > 0) out.push({ type: 'changed', s: n, detail: details.join('; ') })
  })
  return out
}

// Membership filtering is the shared module, so the worker and the browser
// agree byte-for-byte on group ranges ("1-10"), lists and all-group forms.
const filterForConfig = (sessions, config) => filterSessionsForMembership(sessions, config)

const CRON_MINUTES = 10

async function runScheduled(env) {
  const now = londonNow()

  // Deliver due snoozes first.
  const snoozeKeys = await listAllKeys(env.PUSH, { prefix: 'snooze:' })
  for (const entry of snoozeKeys) {
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

  const list = { keys: await listAllKeys(env.PUSH, { prefix: 'sub:' }) }
  const sheetCache = new Map()
  // Each sheet is fetched once per run; a KV snapshot of its previous state lets us
  // detect changes (rooms, times, tutors, added/cancelled sessions) and push them.
  const getSheetInfo = async (id, gid) => {
    const key = `${id}|${gid ?? ''}`
    if (!sheetCache.has(key)) {
      let sessions = await fetchSessions(id, gid)
      let changes = []
      let hadSnapshot = false
      let identityChanged = false
      let failCount = 0
      if (sessions.length > 0) {
        await env.PUSH.delete(`fail:${key}`)
        const old = await env.PUSH.get(snapKey(id, gid), 'json')
        sessions = reconcileEvents(sessions, old ?? [])
        identityChanged = !!old && old.some(s => !s.eventKey || !s.calendarUid)
        if (old) {
          hadSnapshot = true
          // The sheet drops past rows daily (rolling TODAY() filter); keep the
          // history the snapshot has seen so placement-span markers and past
          // days survive — and snapshots accumulate it through rewrites.
          const freshDates = new Set(sessions.map((s) => s.dateISO))
          const keys = new Set(sessions.map(eventKey))
          const retained = old.filter((s) => s.dateISO < now.dateISO && !keys.has(eventKey(s)) && !freshDates.has(s.dateISO))
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
      sheetCache.set(key, { id, gid, sessions, expanded: expandPlacements(sessions), changes, hadSnapshot, identityChanged, failCount })
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
        if (s.isOptional && config.remindOptional === false) continue
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
        // Already at the session's location on a recent fix: no "time to
        // leave" (owner request, 9 Sep 2026). Mirrors shared/travel-state.js.
        if (haversineM(loc, building) <= 150 && Date.now() - loc.at <= 3 * 3600 * 1000) continue
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
              key: eventKey(s),
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
      const answered = attendanceMarksFor(record, config.profileId, now.dateISO)
      for (const s of sessions) {
        if (s.dateISO !== now.dateISO || s.isSelfStudy) continue
        if (s.isOptional && config.remindOptional === false) continue
        const end = toMinutes(s.end)
        if (end === null) continue
        const since = now.minutes - end
        if (since >= 0 && since < CRON_MINUTES) {
          const sKey = eventKey(s)
          // Already answered in the app (reported via /attendance): stay silent.
          if (answered.has(sKey)) continue
          due.push({
            dedupe: `att|${s.dateISO}|${s.end}|${s.title}`,
            key: sKey,
            kind: 'attendance',
            tag: `att-${sKey}`,
            title: `Did you attend ${s.title}?`,
            body: '✓ Attended or ✗ Absent — or tap to answer in the app. It counts toward attendance and placement days.',
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
        if (s.isOptional && config.remindOptional === false) continue
        const start = toMinutes(s.start)
        if (start === null) continue
        const delta = start - now.minutes
        for (const offset of config.reminderOffsets) {
          if (delta > offset - CRON_MINUTES && delta <= offset) {
            const school = placementSchool(s, config)
            due.push({
              dedupe: `${s.dateISO}|${s.start}|${s.title}|${offset}`,
              key: eventKey(s),
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
            const kdKey = eventKey(kd)
            due.push({
              dedupe: `kd|${kd.dateISO}|${kd.title}|${d}`,
              key: kdKey,
              kind: 'task', // deadlines get task actions, never "Attended"
              tag: `task-${kdKey}`,
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
        ? {
            title: unsent[0].title,
            body: unsent[0].body,
            key: unsent[0].key,
            kind: unsent[0].kind,
            tag: unsent[0].tag,
            profileId: config.profileId,
            snoozeUrl: record.base,
          }
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
    if (info.sessions.length > 0 && (!info.hadSnapshot || info.identityChanged || info.changes.length > 0)) {
      await env.PUSH.put(snapKey(info.id, info.gid), JSON.stringify(info.sessions))
    }
  }
  for (const [seenKey, ids] of noticesDirty) {
    await env.PUSH.put(seenKey, JSON.stringify(ids))
  }

  await publishAnalyticsSnapshot(env)
  await runAnalyticsRetention(env)
}

/** Reason count for an attempt the worker refused (A5). The work runs after
 *  the response via ctx.waitUntil — a bare dangling promise is cancelled
 *  when a Worker request handler returns, and the count would be lost. */
function reportOutcome(env, reason, ctx) {
  if (!env.ANALYTICS) return
  try {
    const stub = env.ANALYTICS.get(env.ANALYTICS.idFromName('analytics-v2'))
    const work = stub
      .fetch(new Request('https://analytics/v2/outcome', { method: 'POST', body: JSON.stringify({ reason }), headers: { 'content-type': 'application/json' } }))
      .catch(() => {})
    if (ctx?.waitUntil) ctx.waitUntil(work)
  } catch {
    /* diagnostics never affect the request */
  }
}

const LAST_SEEN_TTL_S = 200 * 86400
/**
 * Prospective last-seen ledger (A5 / ADM-20): `alast:<token>` = last observed
 * UTC date, self-expiring after 200 days. Written at most weekly per token
 * to protect the KV write budget. This is the basis for the PROPOSED
 * bounded first-seen retention; recording it is non-destructive.
 */
async function touchLastSeen(env, token, today) {
  try {
    const prev = await env.PUSH.get(`alast:${token}`)
    if (prev && prev >= new Date(Date.parse(today + 'T00:00:00Z') - 7 * 86400000).toISOString().slice(0, 10)) return
    await env.PUSH.put(`alast:${token}`, today, { expirationTtl: LAST_SEEN_TTL_S })
  } catch {
    /* best effort */
  }
}

export const RETENTION_GRACE_DAYS = 30
export const FIRST_SEEN_RETENTION_DAYS = 180
/**
 * Pure retention rule (A5 / §7.3): a first-seen token expires when its
 * first-seen date is older than 180 days AND no last-seen record exists —
 * and only once the policy has been recording last-seen for the grace
 * period, so an active-but-old token cannot be swept on day one. Returns
 * the tokens to delete; the caller deletes ONLY `adev:` rows.
 */
export function expiredFirstSeenTokens(firstSeen, lastSeen, todayISO, activationISO) {
  if (!activationISO || !/^\d{4}-\d{2}-\d{2}$/.test(activationISO)) return []
  const dayMs = 86400000
  const today = Date.parse(todayISO + 'T00:00:00Z')
  if (today < Date.parse(activationISO + 'T00:00:00Z') + RETENTION_GRACE_DAYS * dayMs) return []
  const cutoff = new Date(today - FIRST_SEEN_RETENTION_DAYS * dayMs).toISOString().slice(0, 10)
  const out = []
  for (const [token, first] of firstSeen) {
    if (typeof first === 'string' && first < cutoff && !lastSeen.has(token)) out.push(token)
  }
  return out
}

/**
 * Scoped, DORMANT retention job: runs only when the owner has set the KV
 * flag `analytics:retention-policy` to the ISO activation date. Touches
 * `adev:` rows only — never vapid/sub/sync/group/aping — and at most 200 per
 * run so a single tick cannot mass-delete.
 */
async function runAnalyticsRetention(env) {
  try {
    const activation = await env.PUSH.get('analytics:retention-policy')
    if (!activation) return
    const today = new Date().toISOString().slice(0, 10)
    const scan = await listAllKeysChecked(env.PUSH, { prefix: 'adev:' })
    if (!scan.complete) return // never act on a partial view of the ledger
    const firstSeen = new Map()
    for (const k of scan.keys) {
      const v = await env.PUSH.get(k.name)
      if (v) firstSeen.set(k.name.slice(5), v)
    }
    const lastSeen = new Set((await listAllKeysChecked(env.PUSH, { prefix: 'alast:' })).keys.map((k) => k.name.slice(6)))
    const expired = expiredFirstSeenTokens(firstSeen, lastSeen, today, activation).slice(0, 200)
    for (const token of expired) await env.PUSH.delete(`adev:${token}`)
  } catch {
    /* retention must never break the scheduled run */
  }
}

/**
 * Publish the v2 analytics aggregate (A2): the DO computes a complete
 * snapshot; /stats/v2 serves the PUBLISHED copy instead of scanning raw
 * rows per refresh. A failed aggregation keeps the last valid snapshot
 * (staleness is visible via its generatedAt). The KV write is skipped when
 * nothing but the timestamp changed, protecting the daily write budget.
 */
export async function publishAnalyticsSnapshot(env) {
  if (!env.ANALYTICS) return false
  try {
    const stub = env.ANALYTICS.get(env.ANALYTICS.idFromName('analytics-v2'))
    const res = await stub.fetch(new Request('https://analytics/v2/aggregate', { method: 'POST' }))
    if (!res.ok) return false
    const snapshot = await res.json()
    if (snapshot?.schemaVersion !== 2) return false
    const previous = await env.PUSH.get('astats:latest', 'json')
    // "Unchanged" means the WHOLE published shape is identical apart from the
    // per-run stamps — any new section (cohorts, reliability, builds…) or
    // counter movement must republish, or readers keep an old shape forever.
    const essence = (x) => {
      const { generatedAt: _g, snapshotId: _s, ...rest } = x ?? {}
      return JSON.stringify(rest)
    }
    if (previous && essence(previous) === essence(snapshot)) return false
    await env.PUSH.put('astats:latest', JSON.stringify(snapshot))
    return true
  } catch {
    // Keep the previous snapshot on any failure; never publish a partial one.
    return false
  }
}

/* ---------- per-user rate limiting (in-memory, per isolate) ----------
 * Protects the free tier without spending KV writes on counters. Best-effort
 * (resets when the isolate recycles, per-colo) — fine as an abuse guard, since
 * legitimate app traffic sits far below these caps. */
const RL = new Map()
function rateLimited(request, name, max, windowMs = 60_000) {
  const ip = request.headers.get('cf-connecting-ip') ?? 'unknown'
  const key = `${name}:${ip}`
  const now = Date.now()
  const entry = RL.get(key)
  if (!entry || now - entry.start > windowMs) {
    if (RL.size > 5000) RL.clear()
    RL.set(key, { start: now, n: 1 })
    return false
  }
  entry.n++
  return entry.n > max
}
// requests per minute per IP, by endpoint
const RATE_CAPS = {
  '/subscribe': 10,
  '/test-device': 3,
  '/unsubscribe': 10,
  '/snooze': 10,
  '/location': 10,
  '/attendance': 10,
  '/ping': 6,
  '/sync': 10,
  '/sync-v2': 20,
  '/sync-v2/delete': 6,
  '/sync/delete': 6,
  '/group': 10,
  '/group/join': 10,
  '/group/leave': 10,
  '/group/propose': 10,
  '/group/proposal/respond': 10,
  '/stats': 20,
  '/stats/v2': 20,
  '/v2/batch': 20,
  '/history': 10,
}

/* Subscription keys act as a device capability. Never log or return them. */
async function validSubscription(sub) {
  try {
    const u = new URL(sub.endpoint)
    const allowed = ['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com'].includes(u.hostname)
      || u.hostname.endsWith('.notify.windows.com')
    if (!allowed || u.protocol !== 'https:' || u.port || u.username || u.password || u.hash || sub.endpoint.length > 2048) return false
    const { auth, p256dh } = sub.keys
    if (typeof auth !== 'string' || !/^[A-Za-z0-9_-]{22}$/.test(auth)
      || typeof p256dh !== 'string' || !/^[A-Za-z0-9_-]{87}$/.test(p256dh)) return false
    const pub = b64urlDecode(p256dh)
    if (b64urlDecode(auth).length !== 16 || pub.length !== 65 || pub[0] !== 4) return false
    await crypto.subtle.importKey('raw', pub, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
    return true
  } catch { return false }
}

function sameSubscription(a, b) {
  if (!a || !b || a.endpoint !== b.endpoint) return false
  // Compare fixed-length secret material without a character-dependent early exit.
  const left = `${a.keys?.auth}:${a.keys?.p256dh}`
  const right = `${b.keys?.auth}:${b.keys?.p256dh}`
  if (left.length !== right.length) return false
  let mismatch = 0
  for (let i = 0; i < left.length; i++) mismatch |= left.charCodeAt(i) ^ right.charCodeAt(i)
  return mismatch === 0
}

async function boundedJSON(request, limit) {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json') || !request.body) return null
  const reader = request.body.getReader()
  const chunks = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.length
      if (size > limit) { await reader.cancel(); return null }
      chunks.push(value)
    }
    return JSON.parse(new TextDecoder().decode(concat(...chunks)))
  } catch { return null }
  finally { reader.releaseLock() }
}

/* ---------- HTTP ---------- */
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type, authorization',
}
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json', ...CORS } })

async function endpointKey(endpoint) {
  const digest = await crypto.subtle.digest('SHA-256', utf8(endpoint))
  return `sub:${b64url(digest)}`
}

/** KV list with full cursor pagination (P3-07): a first-page-only list would
 *  silently skip subscriptions/records past 1,000 keys. Bounded so a runaway
 *  prefix cannot pin a request forever. */
export async function listAllKeys(kv, options, maxPages = 50) {
  const keys = []
  let cursor
  for (let page = 0; page < maxPages; page++) {
    const res = await kv.list(cursor ? { ...options, cursor } : options)
    keys.push(...res.keys)
    if (res.list_complete) return keys
    cursor = res.cursor
  }
  return keys
}

/** Analytics-only scan that says whether pagination actually finished —
 *  a capped scan must surface as incomplete, never as a smaller total. */
export async function listAllKeysChecked(kv, options, maxPages = 50) {
  const keys = []
  let cursor
  for (let page = 0; page < maxPages; page++) {
    const res = await kv.list(cursor ? { ...options, cursor } : options)
    keys.push(...res.keys)
    if (res.list_complete) return { keys, complete: true }
    cursor = res.cursor
  }
  return { keys, complete: false }
}

/* Constant-time credential comparison — no early exit on length or prefix. */
const constantEquals = (a, b) => {
  const left = String(a ?? '')
  const right = String(b ?? '')
  if (left.length !== right.length) return false
  let mismatch = 0
  for (let i = 0; i < left.length; i++) mismatch |= left.charCodeAt(i) ^ right.charCodeAt(i)
  return mismatch === 0
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url)
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS })
    const cap = RATE_CAPS[url.pathname]
    if (cap && rateLimited(request, url.pathname, cap)) {
      if (url.pathname === '/v2/batch') reportOutcome(env, 'rateLimited', ctx)
      return json({ error: 'rate limited — try again in a minute' }, 429)
    }
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
      const body = await boundedJSON(request, 32768)
      if (!(await validSubscription(body?.subscription)) || !validWorkerConfig(body?.config)) {
        return json({ error: 'invalid subscription' }, 400)
      }
      const subKey = await endpointKey(body.subscription.endpoint)
      const existing = await env.PUSH.get(subKey, 'json')
      if (existing && !sameSubscription(existing.subscription, body.subscription)) return json({ error: 'subscription credentials do not match' }, 403)
      await env.PUSH.put(
        subKey,
        JSON.stringify({ subscription: body.subscription, config: body.config, base: url.origin, loc: existing?.loc, marks: existing?.marks })
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
    if (url.pathname === '/test') {
      return json({ error: 'Broadcast tests are disabled. Update the app to test this device.' }, 410)
    }
    if (request.method === 'POST' && url.pathname === '/test-device') {
      const body = await boundedJSON(request, 4096)
      if (!(await validSubscription(body?.subscription))) return json({ error: 'invalid subscription credentials' }, 400)
      const subKey = await endpointKey(body.subscription.endpoint)
      const record = await env.PUSH.get(subKey, 'json')
      if (!sameSubscription(record?.subscription, body.subscription)) return json({ error: 'subscription credentials do not match' }, 403)
      const lock = `testlock:${subKey.slice(4)}`
      if (await env.PUSH.get(lock)) return json({ error: 'try again in a few minutes' }, 429)
      await env.PUSH.put(lock, '1', { expirationTtl: 600 })
      const result = await sendPushDetailed(env, record.subscription, {
        title: '✅ Test notification',
        body: 'Background push is working on this device.',
      })
      // No provider response bodies, endpoints or credentials in the response.
      if (result.status < 200 || result.status >= 300) return json({ error: 'push delivery failed; try enabling push again' }, 502)
      return json({ ok: true, sent: 1 })
    }
    /* ---------- study groups (times only, no session details) ----------
     * Served by the GroupStore Durable Object: stable member ids + capability
     * tokens, transactional join/update/leave, legacy KV records imported on
     * first access. Old name-keyed clients keep working. */
    const groupFetch = async (code, path, method, body) => {
      const target = new URL(url)
      target.pathname = path
      target.searchParams.set('code', code)
      const stub = env.GROUPS.get(env.GROUPS.idFromName(code))
      const response = await stub.fetch(
        new Request(target, {
          method,
          ...(body ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } } : {}),
        })
      )
      return { status: response.status, body: await response.json() }
    }
    if (request.method === 'POST' && url.pathname === '/group') {
      const body = await boundedJSON(request, 32768)
      const name = String(body?.name ?? '').trim()
      if (!name) return json({ error: 'missing name' }, 400)
      const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
      for (let attempt = 0; attempt < 3; attempt++) {
        let code = ''
        for (const b of crypto.getRandomValues(new Uint8Array(6))) code += chars[b % chars.length]
        const res = await groupFetch(code, '/group', 'POST', body)
        if (res.status !== 409) {
          return json(res.status === 200 ? { code, ...res.body } : res.body, res.status)
        }
      }
      return json({ error: 'could not create the group — try again' }, 503)
    }
    if (
      request.method === 'POST' &&
      ['/group/join', '/group/leave', '/group/propose', '/group/proposal/respond'].includes(url.pathname)
    ) {
      const body = await boundedJSON(request, 32768)
      const code = String(body?.code ?? '').toUpperCase().trim()
      if (!/^[A-Z2-9]{4,8}$/.test(code)) return json({ error: 'invalid request' }, 400)
      const res = await groupFetch(code, url.pathname, 'POST', body)
      return json(res.body, res.status)
    }
    if (request.method === 'GET' && url.pathname === '/group') {
      const code = String(url.searchParams.get('code') ?? '').toUpperCase().trim()
      if (!/^[A-Z2-9]{4,8}$/.test(code)) return json({ error: 'unknown group' }, 404)
      const res = await groupFetch(code, '/group', 'GET')
      return json(res.body, res.status)
    }
    /* ---------- anonymous usage analytics (self-hosted; a random token per device) ---------- */
    /* ---------- v2 telemetry (A2): validated batches, atomic DO dedupe ---------- */
    if (request.method === 'POST' && url.pathname === '/v2/batch') {
      const raw = await boundedJSON(request, MAX_BATCH_BYTES)
      if (!raw) {
        reportOutcome(env, 'oversize', ctx)
        return json({ error: 'invalid or oversized batch' }, 400)
      }
      const { ok, errors, batch } = validateBatch(raw)
      // Any invalid day fails the WHOLE batch before a single write — the
      // batch is the idempotence unit, so partial acceptance is forbidden.
      if (!ok || !batch) {
        reportOutcome(env, 'rejected', ctx)
        return json({ error: 'invalid batch', reasons: errors.slice(0, 5) }, 400)
      }
      // Keep the legacy first-seen union: v2 uses the SAME token namespace,
      // so one browser never counts twice across contracts.
      if (!(await env.PUSH.get(`adev:${batch.token}`))) {
        await env.PUSH.put(`adev:${batch.token}`, batch.days.map((d) => d.date).sort()[0])
      }
      await touchLastSeen(env, batch.token, new Date().toISOString().slice(0, 10))
      const stub = env.ANALYTICS.get(env.ANALYTICS.idFromName('analytics-v2'))
      const res = await stub.fetch(
        new Request('https://analytics/v2/batch', {
          method: 'POST',
          body: JSON.stringify(batch),
          headers: { 'content-type': 'application/json' },
        })
      )
      return json(await res.json(), res.status)
    }
    if (request.method === 'GET' && url.pathname === '/stats/v2') {
      const noStore = (obj, status = 200) =>
        new Response(JSON.stringify(obj), {
          status,
          headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...CORS },
        })
      // Same fail-closed authentication as /stats; Bearer only.
      const requiredKey = await env.PUSH.get('statskey')
      if (!requiredKey || !String(requiredKey).trim()) return noStore({ error: 'configuration unavailable' }, 503)
      const auth = request.headers.get('authorization') ?? ''
      const bearer = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : ''
      if (!constantEquals(bearer, requiredKey)) return noStore({ error: 'unauthorized' }, 401)
      const section = url.searchParams.get('section') ?? 'overview'
      if (!['overview', 'adoption', 'returning'].includes(section)) {
        return noStore({ error: 'unknown section' }, 400)
      }
      // Serve the PUBLISHED aggregate — never a full raw scan per refresh
      // (ADM-17). Absent snapshot = aggregation not run yet, a typed 503.
      const snapshot = await env.PUSH.get('astats:latest', 'json')
      if (!snapshot) return noStore({ error: 'aggregate unavailable' }, 503)
      return noStore(snapshot)
    }
    if (request.method === 'POST' && url.pathname === '/ping') {
      // ADM-16 (bounds): a ping is tiny — anything oversized or non-JSON is
      // rejected before parsing; every stored number is a clamped finite int.
      const body = await boundedJSON(request, 8192)
      if (!body) return json({ error: 'invalid ping' }, 400)
      const d = String(body?.d ?? '')
      if (!/^[0-9a-f]{8,32}$/.test(d)) return json({ error: 'invalid ping' }, 400)
      const date = new Date().toISOString().slice(0, 10)
      const clampInt = (n, max) => (Number.isFinite(Number(n)) ? Math.max(0, Math.min(max, Math.round(Number(n)))) : 0)
      // Feature-use counters: whitelisted names, small ints — counts only, never content.
      const FEATURES = [
        'detail', 'week', 'month', 'search', 'historyview', 'home', 'settings', 'filters',
        'keydates', 'stats', 'journal', 'admin', 'group', 'adddl', 'changes', 'photo',
        'binder', 'evidenceprint',
      ]
      const u = {}
      if (body?.u && typeof body.u === 'object') {
        // ADM-12: keep only counters that are still positive after clamping —
        // a negative or zero value must never mint a feature adopter.
        for (const k of FEATURES) {
          const n = clampInt(body.u[k], 999)
          if (n > 0) u[k] = n
        }
      }
      const s = {}
      if (body?.s && typeof body.s === 'object') {
        // ADM-12: store only flags the client actually reported as booleans.
        // An empty setup object must not fabricate six "false" answers.
        for (const k of ['push', 'location', 'home', 'keyDates', 'sync', 'placements']) {
          if (typeof body.s[k] === 'boolean') s[k] = body.s[k]
        }
      }
      const rec = {
        i: body?.i === true,
        p: ['ios', 'android', 'desktop'].includes(body?.p) ? body.p : 'other',
        v: Number(body?.v) || 0,
        o: clampInt(body?.o, 999),
        h: Array.isArray(body?.h) ? body.h.slice(0, 6).map((n) => clampInt(n, 999)) : undefined,
        u,
        s,
      }
      await env.PUSH.put(`aping:${date}:${d}`, JSON.stringify(rec), { expirationTtl: 90 * 86400 })
      if (!(await env.PUSH.get(`adev:${d}`))) await env.PUSH.put(`adev:${d}`, date)
      await touchLastSeen(env, d, date)
      return json({ ok: true })
    }
    if (request.method === 'GET' && url.pathname === '/stats') {
      // ADM-03: every stats response — success or error — is no-store.
      const noStore = (obj, status = 200) =>
        new Response(JSON.stringify(obj), {
          status,
          headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...CORS },
        })
      // ADM-01: fail CLOSED. No configured key means the endpoint is
      // unavailable — never open. Nothing is scanned before authentication.
      const requiredKey = await env.PUSH.get('statskey')
      if (!requiredKey || !String(requiredKey).trim()) {
        return noStore({ error: 'configuration unavailable' }, 503)
      }
      // ADM-03: Authorization: Bearer is the ONLY credential (the legacy
      // ?key= window closed with the A2 deploy). Never logged.
      const auth = request.headers.get('authorization') ?? ''
      const bearer = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : ''
      if (!constantEquals(bearer, requiredKey)) return noStore({ error: 'unauthorized' }, 401)

      const days = Math.min(62, Math.max(1, parseInt(url.searchParams.get('days') ?? '31', 10) || 31))
      // Completeness metadata (ADM-10/11): rows that vanished or failed to
      // parse are reported, never silently counted or dropped into totals.
      let missingRows = 0
      let invalidRows = 0
      // First-seen dates per device -> new-device counts and retention.
      const devScan = await listAllKeysChecked(env.PUSH, { prefix: 'adev:' })
      let scanComplete = devScan.complete
      const firstSeen = new Map()
      for (const k of devScan.keys) {
        const v = await env.PUSH.get(k.name)
        if (v === null) missingRows++
        else firstSeen.set(k.name.slice(5), v)
      }
      const daily = []
      const activeWeek = new Set()
      const activeMonth = new Set()
      const deviceDays = new Map()
      const versions = {}
      // Fixed-window aggregates: feature adoption, engagement and setup flags.
      const featureUses = {}
      const featureDevices = {}
      let opens7 = 0
      const dayparts = [0, 0, 0, 0, 0, 0]
      const setupCounts = {}
      const setupKnown = {}
      let setupDevices = 0
      // ADM-09: the figures NAMED 7-day/30-day always scan their own fixed
      // windows, however short the requested chart range is.
      const scanDays = Math.max(30, days)
      for (let i = 0; i < scanDays; i++) {
        const date = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10)
        const scan = await listAllKeysChecked(env.PUSH, { prefix: `aping:${date}:` })
        if (!scan.complete) scanComplete = false
        let active = 0
        let installed = 0
        let newDevices = 0
        const platforms = {}
        for (const k of scan.keys) {
          const rec = await env.PUSH.get(k.name, 'json')
          const dev = k.name.split(':')[2]
          // ADM-10: only a successfully read, plausible row is activity. A
          // listed key whose read returns null is completeness metadata.
          if (rec === null) {
            missingRows++
            continue
          }
          if (typeof rec !== 'object' || Array.isArray(rec)) {
            invalidRows++
            continue
          }
          active++
          if (rec.i === true) installed++
          const p = typeof rec.p === 'string' ? rec.p : 'other'
          platforms[p] = (platforms[p] ?? 0) + 1
          if (firstSeen.get(dev) === date) newDevices++
          if (i < 7) {
            activeWeek.add(dev)
            opens7 += Number(rec.o) > 0 ? Math.round(Number(rec.o)) : 0
            if (Array.isArray(rec.h)) rec.h.slice(0, 6).forEach((n, b) => (dayparts[b] += Number(n) > 0 ? Math.round(Number(n)) : 0))
            for (const [f, n] of Object.entries(rec.u ?? {})) {
              // ADM-12: only a POSITIVE count makes an adopter; zero or
              // garbage never contributes a device or a use.
              const uses = Number(n)
              if (!Number.isFinite(uses) || uses <= 0) continue
              featureUses[f] = (featureUses[f] ?? 0) + Math.round(uses)
              featureDevices[f] = featureDevices[f] ?? new Set()
              featureDevices[f].add(dev)
            }
          }
          if (i === 0 && rec.s && typeof rec.s === 'object') {
            // ADM-12: unknown is not false — each flag gets its own
            // known-value denominator; absent flags count nowhere.
            let known = 0
            for (const [flag, v] of Object.entries(rec.s)) {
              if (typeof v !== 'boolean') continue
              known++
              setupKnown[flag] = (setupKnown[flag] ?? 0) + 1
              if (v) setupCounts[flag] = (setupCounts[flag] ?? 0) + 1
            }
            if (known > 0) setupDevices++
          }
          if (i < 30) activeMonth.add(dev)
          if (i < days) deviceDays.set(dev, (deviceDays.get(dev) ?? 0) + 1)
          if (i === 0 && rec.v) versions[rec.v] = (versions[rec.v] ?? 0) + 1
        }
        if (i < days) daily.push({ date, active, listed: scan.keys.length, installed, newDevices, platforms })
      }
      const features = Object.fromEntries(
        Object.entries(featureUses).map(([f, uses]) => [f, { uses, devices: featureDevices[f]?.size ?? 0 }])
      )
      // Return frequency: distinct observed days per device in the REQUESTED window.
      let d1 = 0
      let d2to4 = 0
      let d5plus = 0
      for (const n of deviceDays.values()) {
        if (n >= 5) d5plus++
        else if (n >= 2) d2to4++
        else d1++
      }
      return noStore({
        generatedAt: new Date().toISOString(),
        windowDays: days,
        timezone: 'UTC',
        includesPartialToday: true,
        completeness: { scanComplete, missingRows, invalidRows },
        totalDevicesEver: devScan.keys.length,
        activeLast7Days: activeWeek.size,
        activeLast30Days: activeMonth.size,
        todayVersions: versions,
        retention: { oneDay: d1, twoToFourDays: d2to4, fivePlusDays: d5plus },
        // fixed-last-7-days usage shape (independent of windowDays)
        features,
        opensLast7Days: opens7,
        dayparts,
        setup: { devices: setupDevices, counts: setupCounts, known: setupKnown },
        daily,
      })
    }
    /* ---------- cross-device sync: opaque encrypted blobs keyed by a hash of the code ---------- */
    if (url.pathname === '/sync-v2' || url.pathname === '/sync-v2/delete') {
      if (!['GET','POST'].includes(request.method)) return json({ error: 'method not allowed' }, 405)
      let body
      if (request.method === 'POST') {
        try { body = await boundedJSON(request, 420000) } catch { return json({error:'invalid or oversized sync request'},400) }
      }
      if (request.method === 'POST' && !body) return json({error:'invalid sync payload'},400)
      const id = String(body?.id ?? url.searchParams.get('id') ?? '')
      if (!/^[0-9a-f]{64}$/.test(id)) return json({error:'invalid id'},400)
      const target = new URL(url); target.searchParams.set('id',id)
      const response = await env.SYNC.get(env.SYNC.idFromName(id)).fetch(new Request(target, {method:request.method, ...(body ? {body:JSON.stringify(body),headers:{'content-type':'application/json'}} : {})}))
      return json(await response.json(), response.status)
    }
    // Old clients must upgrade instead of bypassing revision protection.
    if (url.pathname === '/sync' || url.pathname === '/sync/delete') return json({error:'Update My Timetable to continue syncing safely.'}, 426)
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
      // Skip the KV write when the stored location is fresh and barely moved —
      // saves the daily write budget without hurting leave-alert accuracy.
      if (record.loc && Date.now() - record.loc.at < 5 * 60_000 && haversineM(record.loc, { lat, lng }) < 100) {
        return json({ ok: true, skipped: true })
      }
      record.loc = { lat, lng, at: Date.now() }
      await env.PUSH.put(subKey, JSON.stringify(record))
      return json({ ok: true })
    }
    if (request.method === 'POST' && url.pathname === '/attendance') {
      // Authoritative snapshot of ONE profile's answered sessions on ONE course
      // day (keys only, no values/notes) with a revision guard (FA-03).
      const body = await request.json().catch(() => null)
      const valid =
        body?.v === 2 && body.endpoint && typeof body.profileId === 'string' && /^[\w-]{1,100}$/.test(body.profileId) &&
        typeof body.day === 'string' && ATTENDANCE_DAY_RE.test(body.day) && Number.isInteger(body.rev) && body.rev >= 0 &&
        Array.isArray(body.keys) && body.keys.length <= 300 && body.keys.every((k) => typeof k === 'string' && k.length <= 200 && k.startsWith(body.day))
      if (!valid) return json({ error: 'invalid attendance report' }, 400)
      const subKey = await endpointKey(body.endpoint)
      const record = await env.PUSH.get(subKey, 'json')
      if (!record) return json({ error: 'unknown subscription' }, 404)
      const result = applyAttendanceReport(record, body)
      if (result.status === 'stale') return json({ error: 'stale report', rev: result.rev }, 409)
      const before = JSON.stringify(record.attendance ?? {})
      const after = JSON.stringify(result.attendance)
      if (result.status === 'unchanged' && before === after && !record.marks) return json({ ok: true, skipped: true, rev: result.rev })
      record.attendance = result.attendance
      delete record.marks // migrated
      await env.PUSH.put(subKey, JSON.stringify(record))
      return json({ ok: true, rev: result.rev })
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
