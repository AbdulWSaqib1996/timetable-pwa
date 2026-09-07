/** Never use row position as ownership. Preserve legacy keys/UIDs on first adoption. */
export const legacyKey = s => `${s.dateISO}|${s.start}|${s.title.trim().toLowerCase()}`
export const eventKey = s => s.eventKey || legacyKey(s)
const normal = s => (s ?? '').trim().toLowerCase()
const scope = s => s.sourceKey ?? ''
export function reconcileEvents(fresh, cached = []) {
  const used = new Set()
  const matches = new Map()
  const sameSource = (a,b) => !scope(a) || !scope(b) || scope(a) === scope(b)
  // Claim exact matches first, so moved rows cannot steal an unchanged occurrence.
  for (const s of fresh) {
    const eligible = cached.filter(c => !used.has(c) && sameSource(s,c))
    const explicit = s.sourceId ? eligible.filter(c => c.sourceId === s.sourceId) : []
    const candidates = explicit.length ? explicit : eligible.filter(c => !(s.sourceId && c.sourceId && s.sourceId !== c.sourceId) && legacyKey(s) === legacyKey(c))
    if (candidates.length) {
      // Key-identical rows are unchanged occurrences — a moved row can never enter
      // this branch, so nothing can be stolen. Duplicated sheet rows (the source
      // repeats some deadline rows verbatim) pair with duplicated history in order
      // instead of deadlocking on a uniqueness check that flagged them forever.
      // Prefer explicitly-resolved identities so a user's resolution sticks.
      candidates.sort((a,b) => ((eventKey(b) !== legacyKey(b)) ? 1 : 0) - ((eventKey(a) !== legacyKey(a)) ? 1 : 0))
      matches.set(s,candidates[0]); used.add(candidates[0])
    }
  }
  return fresh.map(s => {
    let match = matches.get(s)
    // A row whose key twin already exact-matched is a sheet duplicate, not a
    // move — treat it as its own new event rather than asking the user.
    const dupOfMatched = !match && [...matches.keys()].some(f => f !== s && sameSource(f,s) && legacyKey(f) === legacyKey(s))
    const candidates = dupOfMatched ? [] : cached.filter(c => !used.has(c) && sameSource(s,c) && !(s.sourceId && c.sourceId && s.sourceId !== c.sourceId) && normal(c.title) === normal(s.title) && normal(c.groups) === normal(s.groups) && normal(c.tutor) === normal(s.tutor) && Math.abs(Date.parse(c.dateISO)-Date.parse(s.dateISO)) <= 31*86400000)
    const competing = fresh.filter(f => !matches.has(f) && sameSource(f,s) && normal(f.title) === normal(s.title) && normal(f.groups) === normal(s.groups) && normal(f.tutor) === normal(s.tutor))
    if (!match && candidates.length === 1 && competing.length === 1) { match = candidates[0]; used.add(match) }
    const duplicateID = s.sourceId && fresh.filter(f => sameSource(f,s) && f.sourceId === s.sourceId).length > 1
    const changed = !match || ['dateISO','start','end','title','room','tutor','groups'].some(k => s[k] !== match[k])
    const key = match ? eventKey(match) : s.eventKey || (s.sourceId && !duplicateID ? `event:${scope(s)}:${encodeURIComponent(s.sourceId)}` : legacyKey(s))
    return { ...s, identityAt: changed ? Date.now() : match.identityAt ?? 0, eventKey: key, calendarUid: match?.calendarUid || match?.id || s.calendarUid || (s.sourceId && !duplicateID ? key : s.id), identityCandidates: !match ? candidates.map(eventKey) : [], identityWarning: duplicateID ? 'Duplicate Event ID in the source. Give each event a unique ID.' : undefined }
  })
}
