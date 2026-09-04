import type { Session } from '../types'

/**
 * The source sheet is built on a rolling TODAY() filter: each day, yesterday's
 * rows vanish from the GViz feed. The app keeps its own history — past days that
 * fall off the sheet survive from the previous cache, so the agenda, stats and
 * attendance marks keep working backwards in time.
 */

/** Merge cached past days that are missing from a fresh fetch into it.
 *  Synthetic placement-day entries (plc-…) are excluded — span expansion runs
 *  after this and regenerates them from the retained marker rows. */
export function retainHistory(
  fresh: Session[],
  cached: Session[] | undefined,
  todayISO: string
): Session[] {
  if (!cached || cached.length === 0) return fresh
  const freshDates = new Set(fresh.map((s) => s.dateISO))
  const retained = cached.filter(
    (s) => s.dateISO < todayISO && !freshDates.has(s.dateISO) && !s.id.startsWith('plc-')
  )
  return retained.length === 0 ? fresh : [...fresh, ...retained]
}

/**
 * One-time back-fill: days lost before history retention shipped can be
 * recovered from the push worker's sheet snapshot (it keeps what it saw).
 * Returns extra past-day sessions not already present.
 */
export async function recoverHistory(
  base: string,
  sheetId: string,
  gid: string | null,
  current: Session[],
  todayISO: string
): Promise<Session[]> {
  try {
    const res = await fetch(
      `${base.replace(/\/+$/, '')}/history?id=${encodeURIComponent(sheetId)}${gid ? `&gid=${encodeURIComponent(gid)}` : ''}`
    )
    if (!res.ok) return []
    const json = (await res.json()) as {
      sessions?: { title: string; dateISO: string; start: string; end: string; room: string; tutor: string; groups: string; specialismName?: string; isSelfStudy: boolean }[]
    }
    const have = new Set(current.map((s) => s.dateISO))
    return (json.sessions ?? [])
      .filter((s) => s.dateISO < todayISO && !have.has(s.dateISO) && s.title && s.dateISO)
      .map(
        (s, i): Session => ({
          id: `hist-${s.dateISO}-${i}`,
          title: s.title,
          day: '',
          dateISO: s.dateISO,
          start: s.start ?? '',
          end: s.end ?? '',
          room: s.room ?? '',
          groups: s.groups ?? '',
          tutor: s.tutor ?? '',
          subject: '',
          isSpecialism: !!s.specialismName,
          specialismName: s.specialismName,
          isSelfStudy: s.isSelfStudy === true,
          isOptional: /\(optional\)/i.test(s.title),
        })
      )
  } catch {
    return []
  }
}

const RECOVERED_KEY = 'timetable.histrecover.v1'

/** Has the one-time snapshot back-fill already run for this profile? */
export function historyRecovered(pid: string): boolean {
  try {
    return (JSON.parse(localStorage.getItem(RECOVERED_KEY) ?? '[]') as string[]).includes(pid)
  } catch {
    return false
  }
}

export function markHistoryRecovered(pid: string): void {
  try {
    const list = JSON.parse(localStorage.getItem(RECOVERED_KEY) ?? '[]') as string[]
    localStorage.setItem(RECOVERED_KEY, JSON.stringify([...new Set([...list, pid])]))
  } catch {
    /* ignore */
  }
}
