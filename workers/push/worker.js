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
    utf8(JSON.stringify({ aud: audience, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: 'mailto:push@timetable.invalid' }))
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

async function sendPush(env, subscription, payload) {
  try {
    const vapid = await getVapid(env)
    const audience = new URL(subscription.endpoint).origin
    const jwt = await vapidJwt(audience, vapid)
    const body = await encryptPayload(JSON.stringify(payload), subscription.keys.p256dh, subscription.keys.auth)
    const res = await fetch(subscription.endpoint, {
      method: 'POST',
      headers: {
        TTL: '3600',
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        Authorization: `vapid t=${jwt}, k=${vapid.publicKey}`,
      },
      body,
    })
    if (res.status === 404 || res.status === 410) return 'gone'
    return res.ok ? 'ok' : 'fail'
  } catch {
    return 'fail'
  }
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
      room: get('room'),
      groups: get('groups'),
      specialismName: specMatch ? specMatch[1].trim() : undefined,
      isSelfStudy: /^self[- ]?study$/i.test(title),
    })
  }
  return sessions
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
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date())
  const get = (type) => parts.find((p) => p.type === type)?.value ?? '0'
  return {
    dateISO: `${get('year')}-${get('month')}-${get('day')}`,
    minutes: parseInt(get('hour'), 10) * 60 + parseInt(get('minute'), 10),
    hour: parseInt(get('hour'), 10),
  }
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
  const getSheet = async (id, gid) => {
    const key = `${id}|${gid ?? ''}`
    if (!sheetCache.has(key)) sheetCache.set(key, await fetchSessions(id, gid))
    return sheetCache.get(key)
  }
  const morningWindow = now.hour === 7 && now.minutes % 60 < CRON_MINUTES
  const tflIssues = morningWindow && list.keys.length > 0 ? await fetchTflSevereStatus() : []
  let morningWeather = null
  let morningWeatherFetched = false
  for (const entry of list.keys) {
    const record = await env.PUSH.get(entry.name, 'json')
    if (!record?.subscription?.endpoint || !record?.config?.sheetId) continue
    const { subscription, config } = record
    const due = []

    // Morning briefing: 07:00 London on days with sessions — first session, weather, next deadline.
    if (morningWindow && config.briefing !== false) {
      const sessions = filterForConfig(await getSheet(config.sheetId, config.gid), config)
      const todays = sessions
        .filter((s) => s.dateISO === now.dateISO && !s.isSelfStudy && toMinutes(s.start) !== null)
        .sort((a, b) => a.start.localeCompare(b.start))
      if (todays.length > 0) {
        const first = todays[0]
        let body = `First: ${first.start} ${first.title}`
        if (first.room) body += ` · ${shortRoom(first.room)}`
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

    if ((config.reminderOffsets ?? []).length > 0) {
      const sessions = filterForConfig(await getSheet(config.sheetId, config.gid), config)
      for (const s of sessions) {
        if (s.dateISO !== now.dateISO || s.isSelfStudy) continue
        const start = toMinutes(s.start)
        if (start === null) continue
        const delta = start - now.minutes
        for (const offset of config.reminderOffsets) {
          if (delta > offset - CRON_MINUTES && delta <= offset) {
            due.push({
              dedupe: `${s.dateISO}|${s.start}|${s.title}|${offset}`,
              key: `${s.dateISO}|${s.start}|${s.title.trim().toLowerCase()}`,
              title: s.title,
              body: `Starts ${s.start}${s.room ? ` · ${s.room}` : ''}`,
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

    for (const item of due) {
      const sentKey = `sent:${entry.name.slice(4)}:${item.dedupe}`
      if (await env.PUSH.get(sentKey)) continue
      const result = await sendPush(env, subscription, {
        title: item.title,
        body: item.body,
        key: item.key,
        snoozeUrl: record.base,
      })
      if (result === 'gone') {
        await env.PUSH.delete(entry.name)
        break
      }
      if (result === 'ok') await env.PUSH.put(sentKey, '1', { expirationTtl: 172800 })
    }
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
    if (request.method === 'POST' && url.pathname === '/subscribe') {
      const body = await request.json().catch(() => null)
      if (!body?.subscription?.endpoint || !body?.subscription?.keys?.p256dh || !body?.config?.sheetId) {
        return json({ error: 'invalid subscription' }, 400)
      }
      await env.PUSH.put(
        await endpointKey(body.subscription.endpoint),
        JSON.stringify({ subscription: body.subscription, config: body.config, base: url.origin })
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
