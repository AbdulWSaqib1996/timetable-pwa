import type { Filters, Settings } from '../types'

interface SharePayload {
  u: string
  i: string
  g: string | null
  s?: string[]
  h?: boolean
  gr?: string[]
  /** term start, travel mode, filters, key-dates tab — so a shared setup is complete */
  t?: string
  tm?: Settings['travelMode']
  f?: Filters
  ki?: string
  kg?: string | null
  ku?: string
}

function b64urlEncode(text: string): string {
  return btoa(unescape(encodeURIComponent(text))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function b64urlDecode(text: string): string {
  return decodeURIComponent(escape(atob(text.replace(/-/g, '+').replace(/_/g, '/'))))
}

/** A link that opens the app fully configured (sheet + specialism/group choices). */
export function buildShareUrl(settings: Settings): string {
  const payload: SharePayload = {
    u: settings.sheetUrl,
    i: settings.sheetId,
    g: settings.gid,
    s: settings.mySpecialisms,
    h: settings.hideOtherSpecialisms,
    gr: settings.myGroups,
    t: settings.termStartISO,
    tm: settings.travelMode,
    f: settings.filters,
    ki: settings.keyDatesSheetId,
    kg: settings.keyDatesGid,
    ku: settings.keyDatesUrl,
  }
  return `${location.origin}${import.meta.env.BASE_URL}#setup=${b64urlEncode(JSON.stringify(payload))}`
}

/** Parse a #setup=… hash into ready-to-use settings, or null if absent/invalid. */
export function parseShareHash(hash: string): Settings | null {
  const m = hash.match(/#setup=([A-Za-z0-9_-]+)/)
  if (!m) return null
  try {
    const p = JSON.parse(b64urlDecode(m[1])) as SharePayload
    if (!p.i || !/^[a-zA-Z0-9_-]{20,}$/.test(p.i)) return null
    return {
      sheetUrl: p.u ?? '',
      sheetId: p.i,
      gid: p.g ?? null,
      mySpecialisms: Array.isArray(p.s) ? p.s.filter((x) => typeof x === 'string') : [],
      hideOtherSpecialisms: p.h !== false,
      myGroups: Array.isArray(p.gr) ? p.gr.filter((x) => typeof x === 'string') : [],
      specialismsChosen: true,
      termStartISO: typeof p.t === 'string' ? p.t : undefined,
      travelMode: p.tm === 'transit' || p.tm === 'driving' ? p.tm : undefined,
      filters: p.f && typeof p.f === 'object' ? p.f : undefined,
      keyDatesSheetId: typeof p.ki === 'string' ? p.ki : undefined,
      keyDatesGid: typeof p.kg === 'string' ? p.kg : undefined,
      keyDatesUrl: typeof p.ku === 'string' ? p.ku : undefined,
    }
  } catch {
    return null
  }
}
