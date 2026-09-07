/**
 * Course membership rules, shared by the browser app and both workers so a
 * session is "yours" by exactly the same test everywhere (P3-01).
 *
 * A sheet's Groups cell may contain: explicit tokens ("2", "Group 3"),
 * comma/semicolon/slash lists ("1, 2, 3"), inclusive numeric ranges
 * ("1-10", en/em dashes tolerated), an all-groups form ("all",
 * "all groups"), or free text we don't recognise. Unrecognised text is
 * matched only by literal equality and reported in `unknown` — membership
 * is never invented from an unparseable string.
 */

const RANGE_CAP = 200
const ALL_RE = /^(all|all groups|everyone)$/i

const normalToken = (t) => {
  const trimmed = String(t).trim().replace(/\s+/g, ' ').toLowerCase()
  const num = trimmed.match(/^0*(\d{1,4})$/)
  return num ? String(parseInt(num[1], 10)) : trimmed
}

/** Parse one Groups cell. Empty = unrestricted (the source contract: "sessions
 *  with no group set apply to everyone"). */
export function parseGroupExpression(raw) {
  const text = String(raw ?? '').trim()
  if (!text) return { all: true, empty: true, tokens: [], unknown: [] }
  if (ALL_RE.test(text)) return { all: true, empty: false, tokens: [], unknown: [] }
  const tokens = []
  const unknown = []
  for (const part of text.split(/[,;/]+/)) {
    const token = part.trim().replace(/\s+/g, ' ')
    if (!token) continue
    if (ALL_RE.test(token)) return { all: true, empty: false, tokens: [], unknown: [] }
    const range = token.match(/^(?:groups?\s*)?(\d{1,7})\s*[-–—]\s*(?:groups?\s*)?(\d{1,7})$/i)
    if (range) {
      const from = parseInt(range[1], 10)
      const to = parseInt(range[2], 10)
      if (to >= from && to - from <= RANGE_CAP) {
        for (let n = from; n <= to; n++) tokens.push(String(n))
      } else {
        // Reversed or unbounded ranges are not expanded — literal match only.
        unknown.push(token)
        tokens.push(normalToken(token))
      }
      continue
    }
    const single = token.match(/^(?:groups?\s*)?0*(\d{1,4})$/i)
    if (single) {
      tokens.push(String(parseInt(single[1], 10)))
      continue
    }
    unknown.push(token)
    tokens.push(normalToken(token))
  }
  return { all: false, empty: false, tokens: [...new Set(tokens)], unknown }
}

/** Does a Groups cell include any of the user's chosen groups?
 *  No chosen groups = everything matches (the user hasn't narrowed). */
export function groupMatches(raw, myGroups) {
  const mine = (myGroups ?? []).map(normalToken).filter(Boolean)
  if (mine.length === 0) return true
  const expr = parseGroupExpression(raw)
  if (expr.all) return true
  return expr.tokens.some((t) => mine.includes(t))
}

/** Distinct joinable group tokens across sessions, ranges expanded, for the
 *  "My group" picker. All-group and empty cells contribute nothing. */
export function expandGroupOptions(rawList) {
  const out = new Set()
  for (const raw of rawList ?? []) {
    const expr = parseGroupExpression(raw)
    if (expr.all) continue
    for (const t of expr.tokens) out.add(t)
  }
  return [...out].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
}

/** Membership test for one session: chosen specialisms (empty = all) and
 *  chosen groups (empty = all). Display filters play no part here. */
export function sessionInMembership(s, { specialisms, groups } = {}) {
  if ((specialisms?.length ?? 0) > 0 && s.specialismName && !specialisms.includes(s.specialismName)) return false
  return groupMatches(s.groups ?? '', groups)
}

/** Worker-config adapter: the same test, keyed by the subscribe payload shape. */
export function filterSessionsForMembership(sessions, config) {
  const membership = { specialisms: config?.spec ?? [], groups: config?.groups ?? [] }
  return sessions.filter((s) => sessionInMembership(s, membership))
}
