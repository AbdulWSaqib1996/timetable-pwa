import { fetchGvizTable } from './gviz'
import type { GvizCell } from './gviz'

/**
 * Cohort notices: a "Notices" tab in the same spreadsheet (Date, Message, Link)
 * rendered as dismissible banners — a broadcast channel for cohort reps with no
 * backend at all. Rows are shown newest-first; dismissals stick per device.
 */

export interface Notice {
  id: string
  dateISO?: string
  message: string
  link?: string
}

const cellText = (c: GvizCell | null | undefined): string =>
  !c ? '' : c.f != null && c.f !== '' ? String(c.f).trim() : c.v == null ? '' : String(c.v).trim()

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
}
const pad = (n: number) => String(n).padStart(2, '0')

function parseDate(c: GvizCell | null | undefined): string | undefined {
  if (!c) return undefined
  const g = typeof c.v === 'string' && c.v.match(/^Date\((\d+),(\d+),(\d+)/)
  if (g) return `${g[1]}-${pad(+g[2] + 1)}-${pad(+g[3])}`
  const t = cellText(c)
  let m = t.match(/^(\d{1,2})[-/ ]([A-Za-z]{3,})[-/ ](\d{4})$/)
  if (m) {
    const mo = MONTHS[m[2].slice(0, 3).toLowerCase()]
    if (mo !== undefined) return `${m[3]}-${pad(mo + 1)}-${pad(+m[1])}`
  }
  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  return m ? `${m[3]}-${pad(+m[2])}-${pad(+m[1])}` : undefined
}

/** Stable id so a dismissal survives refetches (djb2 over date+message). */
function noticeId(dateISO: string | undefined, message: string): string {
  let hash = 5381
  for (const ch of `${dateISO ?? ''}|${message}`) hash = ((hash * 33) ^ ch.charCodeAt(0)) >>> 0
  return 'n' + hash.toString(36)
}

export async function fetchNotices(sheetId: string, gid: string | null): Promise<Notice[]> {
  const table = await fetchGvizTable(sheetId, gid)
  // Header row: any row containing a "message"/"notice" cell.
  let headerIndex = -1
  let msgCol = -1
  let dateCol = -1
  let linkCol = -1
  for (let r = 0; r < Math.min(table.rows.length, 10); r++) {
    const cells = table.rows[r].c
    for (let i = 0; i < cells.length; i++) {
      const t = cellText(cells[i]).toLowerCase()
      if (t === 'message' || t === 'notice' || t === 'announcement') {
        headerIndex = r
        msgCol = i
      } else if (t === 'date') dateCol = i
      else if (t === 'link' || t === 'url') linkCol = i
    }
    if (headerIndex !== -1) break
  }
  if (headerIndex === -1) throw new Error('No “Message” column found — the notices tab needs Date/Message/Link headers.')
  const notices: Notice[] = []
  for (let r = headerIndex + 1; r < table.rows.length; r++) {
    const cells = table.rows[r].c
    const message = cellText(cells[msgCol]).slice(0, 500)
    if (!message) continue
    const linkText = linkCol >= 0 ? cellText(cells[linkCol]) : ''
    const dateISO = dateCol >= 0 ? parseDate(cells[dateCol]) : undefined
    notices.push({
      id: noticeId(dateISO, message),
      dateISO,
      message,
      link: /^https?:\/\//i.test(linkText) ? linkText : undefined,
    })
  }
  // Newest first: later rows are newer; dated rows sort by date within that.
  return notices.reverse().sort((a, b) => (b.dateISO ?? '9999').localeCompare(a.dateISO ?? '9999'))
}

const DISMISSED_KEY = 'timetable.notices.dismissed.v1'

export function loadDismissedNotices(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? '[]') as string[])
  } catch {
    return new Set()
  }
}

export function dismissNotice(id: string): void {
  try {
    const list = [...loadDismissedNotices(), id].slice(-100)
    localStorage.setItem(DISMISSED_KEY, JSON.stringify(list))
  } catch {
    /* ignore */
  }
}
