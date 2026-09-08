/**
 * Local "Find anything" index (R4 / NF-01), runtime-neutral so the app and
 * node tests share one implementation. Entries are keyed by
 * (profileId, ownerType, ownerId) with the owner's revision; rebuilding
 * reuses unchanged entries and drops owners that vanished (tombstones).
 * Default scope is title/room/tutor/subject text; notes and captions are a
 * separate opt-in field. Nothing here touches the network.
 */

export const FIND_PAGE_SIZE = 50

/** Lower-case, accent-stripped, punctuation-folded, single-spaced. */
export function normalizeText(value) {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

export const findKey = (profileId, ownerType, ownerId) => `${profileId}|${ownerType}|${ownerId}`

/**
 * Build (or incrementally rebuild) the index from owner records.
 * `owners` is an array of { ownerType, ownerId, rev, title, date?, time?,
 * kind, text, content?, meta? } produced by the app's collectors; `prev`
 * lets unchanged owners keep their normalized entry.
 */
export function buildFindIndex(profileId, owners, prev = null) {
  const previous = prev && prev.profileId === profileId ? prev.byKey : new Map()
  const byKey = new Map()
  const entries = []
  for (const o of owners) {
    if (!o || !o.ownerType || o.ownerId === undefined || o.ownerId === null) continue
    const key = findKey(profileId, o.ownerType, o.ownerId)
    const old = previous.get(key)
    let entry
    if (old && old.rev === o.rev && old.contentRev === (o.contentRev ?? o.rev)) {
      entry = old
    } else {
      entry = {
        key,
        profileId,
        ownerType: o.ownerType,
        ownerId: o.ownerId,
        rev: o.rev,
        contentRev: o.contentRev ?? o.rev,
        title: o.title ?? '',
        date: o.date ?? '',
        time: o.time ?? '',
        kind: o.kind ?? o.ownerType,
        text: normalizeText([o.title, o.text].filter(Boolean).join(' ')),
        content: normalizeText(o.content ?? ''),
        rawContent: o.content ?? '',
        meta: o.meta ?? null,
      }
    }
    byKey.set(key, entry)
    entries.push(entry)
  }
  return { profileId, byKey, entries, size: entries.length }
}

function snippetFor(raw, tokens, width = 90) {
  if (!raw) return ''
  const lower = raw.toLowerCase()
  let at = -1
  for (const t of tokens) {
    at = lower.indexOf(t)
    if (at >= 0) break
  }
  if (at < 0) return raw.slice(0, width)
  const start = Math.max(0, at - Math.floor(width / 3))
  const piece = raw.slice(start, start + width)
  return `${start > 0 ? '…' : ''}${piece}${start + width < raw.length ? '…' : ''}`
}

/**
 * Search: every query token must appear (substring, normalized) in the
 * entry's text — or its opt-in content when `includeContent` is set. Results
 * are ranked title-match first, then by date (newest first for past items,
 * soonest first for future when `todayISO` is given). Paged.
 */
export function searchFindIndex(index, query, { includeContent = false, limit = FIND_PAGE_SIZE, offset = 0, types = null, todayISO = '' } = {}) {
  const q = normalizeText(query)
  const tokens = q.split(' ').filter(Boolean)
  if (tokens.length === 0 || !index) return { results: [], total: 0, tokens }
  const matches = []
  for (const e of index.entries) {
    if (types && !types.includes(e.ownerType)) continue
    let inText = true
    for (const t of tokens) {
      if (!e.text.includes(t)) {
        inText = false
        break
      }
    }
    let inContent = false
    if (!inText && includeContent && e.content) {
      inContent = true
      for (const t of tokens) {
        if (!e.text.includes(t) && !e.content.includes(t)) {
          inContent = false
          break
        }
      }
    }
    if (!inText && !inContent) continue
    const titleHit = normalizeText(e.title).includes(tokens[0])
    matches.push({ entry: e, titleHit, contentHit: inContent })
  }
  matches.sort((a, b) => {
    if (a.titleHit !== b.titleHit) return a.titleHit ? -1 : 1
    const ad = a.entry.date || ''
    const bd = b.entry.date || ''
    if (todayISO) {
      const af = ad >= todayISO
      const bf = bd >= todayISO
      if (af !== bf) return af ? -1 : 1
      if (af) return ad.localeCompare(bd) || a.entry.time.localeCompare(b.entry.time)
    }
    return bd.localeCompare(ad) || a.entry.title.localeCompare(b.entry.title)
  })
  const page = matches.slice(offset, offset + limit).map((m) => ({
    key: m.entry.key,
    ownerType: m.entry.ownerType,
    ownerId: m.entry.ownerId,
    kind: m.entry.kind,
    title: m.entry.title,
    date: m.entry.date,
    time: m.entry.time,
    snippet: m.contentHit ? snippetFor(m.entry.rawContent, tokens) : '',
    matchedIn: m.contentHit ? 'content' : 'text',
    meta: m.entry.meta,
  }))
  return { results: page, total: matches.length, tokens }
}
