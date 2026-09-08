import type { AdminFile } from './admin'
import { getPhotos } from './photos'
import { TEACHERS_STANDARDS } from './standards'
import type { MetaMap, Session } from '../types'
import { sessionKey } from './diff'
import { attendanceSummary, placementDaySummary } from '../../shared/eligibility.js'

/**
 * The full PGCE binder in one print: attendance & placement days, evidence per
 * Teachers' Standard (session notes/photos + reflections + lesson evaluations),
 * weekly reflections, targets, mentor meetings, observations, lessons and
 * audits. Uses the same hidden #print-bundle mechanism as the evidence bundle.
 */

export interface BinderOptions {
  fromISO?: string
  toISO?: string
  /** included sections; omit for all */
  sections?: BinderSection[]
  /** evidence keys chosen in the journal (session keys, `refl-<id>`, `les-<id>`) — only these print (R5a / NF-08) */
  selection?: string[]
  /** photo captions (default on) */
  includeCaptions?: boolean
  /** observer names on observation records (default on) */
  includeObserverNames?: boolean
}

export type BinderSection =
  | 'attendance'
  | 'evidence'
  | 'targets'
  | 'meetings'
  | 'observations'
  | 'lessons'
  | 'audits'

interface BinderInput {
  profileId: string
  profileName: string
  sessions: Session[]
  metaMap: MetaMap
  admin: AdminFile
  placementTargetDays?: number
  todayISO: string
  options?: BinderOptions
}

const fmt = (dateISO: string) => {
  const [y, m, d] = dateISO.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function el(tag: string, className: string | null, text?: string): HTMLElement {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

export async function printBinder(input: BinderInput): Promise<void> {
  const { profileId, metaMap, admin, todayISO } = input
  const opts = input.options ?? {}
  const inRange = (d: string) => (!opts.fromISO || d >= opts.fromISO) && (!opts.toISO || d <= opts.toISO)
  const has = (sec: BinderSection) => !opts.sections || opts.sections.includes(sec)
  const sessions = input.sessions.filter((s) => inRange(s.dateISO))
  const root = el('div', null)
  root.id = 'print-bundle'
  const objectUrls: string[] = []

  root.appendChild(el('h1', null, 'PGCE file'))
  root.appendChild(
    el('p', 'pb-sub', `${input.profileName} · exported ${new Date().toLocaleDateString('en-GB')} from My Timetable`)
  )

  // ---- Attendance & placement days ----
  if (has('attendance')) {
  root.appendChild(el('h2', null, 'Attendance & placement days'))
  // Same shared definition as Stats and Settings (P3-06): eligible completed
  // sessions with attended / absent / unrecorded kept separate.
  const attendance = attendanceSummary(sessions, (s) => metaMap[sessionKey(s)], todayISO)
  const placementDays = placementDaySummary(sessions, (s) => metaMap[sessionKey(s)])
  const summary = el('div', 'pb-entry')
  summary.appendChild(
    el(
      'p',
      null,
      `${attendance.sentence} ` +
        `School days logged: ${placementDays.attendedDays}${input.placementTargetDays ? ` of ${input.placementTargetDays} required` : ''}` +
        (placementDays.blocks.length > 0
          ? ` (${placementDays.blocks
              .map((b) => `${b.tag} ${b.attended}/${b.total}${b.inferred > 0 ? `, ${b.inferred} inferred` : ''}`)
              .join(' · ')}).`
          : '.')
    )
  )
  root.appendChild(summary)
  }

  // ---- Evidence per standard (session notes/photos + reflections + lesson evaluations) ----
  const selected = opts.selection ? new Set(opts.selection) : null
  interface Ev {
    key: string
    dateISO: string
    heading: string
    note?: string
    photosKey?: string
    photos: number
    standards: string[]
  }
  const evidence: Ev[] = []
  const seen = new Set<string>()
  for (const s of sessions) {
    const key = sessionKey(s)
    if (seen.has(key)) continue
    const m = metaMap[key]
    if (!m || (!m.note && !(m.photos ?? 0) && !(m.standards ?? []).length)) continue
    seen.add(key)
    evidence.push({
      key,
      dateISO: s.dateISO,
      heading: s.title,
      note: m.note,
      photosKey: key,
      photos: m.photos ?? 0,
      standards: m.standards ?? [],
    })
  }
  for (const r of admin.reflections.filter((r) => inRange(r.weekISO))) {
    evidence.push({
      key: `refl-${r.id}`,
      dateISO: r.weekISO,
      heading: `Weekly reflection (w/c ${fmt(r.weekISO)})`,
      note: [r.wentWell && `Went well: ${r.wentWell}`, r.challenges && `Challenges: ${r.challenges}`, r.focus && `Next focus: ${r.focus}`]
        .filter(Boolean)
        .join('\n'),
      photos: 0,
      standards: r.standards,
    })
  }
  for (const l of admin.lessons.filter((l) => inRange(l.dateISO))) {
    if (!l.evaluation && l.standards.length === 0) continue
    evidence.push({
      key: `les-${l.id}`,
      dateISO: l.dateISO,
      heading: `Lesson taught: ${l.subject}${l.classGroup ? ` (${l.classGroup})` : ''}`,
      note: l.evaluation,
      photos: 0,
      standards: l.standards,
    })
  }
  if (has('evidence')) {
  root.appendChild(el('h2', null, 'Evidence against the Teachers’ Standards'))
  for (const ts of [...TEACHERS_STANDARDS, { id: '', label: 'Not yet tagged' }]) {
    const mine = evidence
      .filter((e) => !selected || selected.has(e.key))
      .filter((e) => (ts.id === '' ? e.standards.length === 0 : e.standards.includes(ts.id)))
      .sort((a, b) => a.dateISO.localeCompare(b.dateISO))
    if (mine.length === 0) continue
    root.appendChild(el('h3', 'pb-ts', ts.id === '' ? ts.label : `${ts.id} — ${ts.label}`))
    for (const e of mine) {
      const item = el('div', 'pb-entry')
      item.appendChild(el('h3', null, `${fmt(e.dateISO)} · ${e.heading}`))
      if (e.note) item.appendChild(el('p', null, e.note))
      if (e.photos > 0 && e.photosKey) {
        const grid = el('div', 'pb-photos')
        let localCount = 0
        try {
          for (const photo of await getPhotos(profileId, e.photosKey)) {
            localCount++
            const url = URL.createObjectURL(photo.blob)
            objectUrls.push(url)
            const figure = el('figure', 'pb-figure')
            const img = document.createElement('img')
            img.src = url
            figure.appendChild(img)
            const caption = (photo as { caption?: string }).caption
            if (caption && opts.includeCaptions !== false) figure.appendChild(el('figcaption', 'pb-caption', caption))
            grid.appendChild(figure)
          }
        } catch {
          /* print without photos */
        }
        if (grid.childElementCount > 0) item.appendChild(grid)
        // Never imply a complete pack: files on another device are labelled.
        if (e.photos > localCount) {
          item.appendChild(
            el('p', 'pb-missing', `⚠ ${e.photos - localCount} photo${e.photos - localCount === 1 ? '' : 's'} recorded on another device — not embedded here.`)
          )
        }
      }
      root.appendChild(item)
    }
  }
  }

  // ---- Targets ----
  if (has('targets') && admin.targets.filter((t) => inRange(t.setISO)).length > 0) {
    root.appendChild(el('h2', null, 'Targets'))
    for (const t of [...admin.targets].filter((t) => inRange(t.setISO)).sort((a, b) => a.setISO.localeCompare(b.setISO))) {
      const item = el('div', 'pb-entry')
      item.appendChild(
        el(
          'h3',
          null,
          `${fmt(t.setISO)} · ${t.status === 'met' ? `✓ met${t.metISO ? ` ${fmt(t.metISO)}` : ''}` : t.status === 'progress' ? '◐ in progress' : '○ open'}${t.standards.length ? ` · ${t.standards.join(', ')}` : ''}`
        )
      )
      item.appendChild(el('p', null, t.text))
      root.appendChild(item)
    }
  }

  // ---- Mentor meetings ----
  if (has('meetings') && admin.meetings.filter((m) => inRange(m.dateISO)).length > 0) {
    root.appendChild(el('h2', null, 'Mentor meetings'))
    for (const m of [...admin.meetings].filter((m) => inRange(m.dateISO)).sort((a, b) => a.dateISO.localeCompare(b.dateISO))) {
      const item = el('div', 'pb-entry')
      item.appendChild(el('h3', null, fmt(m.dateISO)))
      if (m.discussed) item.appendChild(el('p', null, m.discussed))
      for (const a of m.actions) item.appendChild(el('p', null, `${a.done ? '☑' : '☐'} ${a.text}`))
      root.appendChild(item)
    }
  }

  // ---- Observations ----
  if (has('observations') && admin.observations.filter((o) => inRange(o.dateISO)).length > 0) {
    root.appendChild(el('h2', null, 'Observation records'))
    for (const o of [...admin.observations].filter((o) => inRange(o.dateISO)).sort((a, b) => a.dateISO.localeCompare(b.dateISO))) {
      const item = el('div', 'pb-entry')
      item.appendChild(el('h3', null, `${fmt(o.dateISO)} · ${o.subject || 'Lesson'}${o.observer && opts.includeObserverNames !== false ? ` · observed by ${o.observer}` : ''}`))
      if (o.focus) item.appendChild(el('p', null, `Focus: ${o.focus}`))
      if (o.strengths) item.appendChild(el('p', null, `Strengths: ${o.strengths}`))
      if (o.development) item.appendChild(el('p', null, `Development points: ${o.development}`))
      root.appendChild(item)
    }
  }

  // ---- Lessons taught ----
  const lessonsInRange = admin.lessons.filter((l) => inRange(l.dateISO))
  if (has('lessons') && lessonsInRange.length > 0) {
    root.appendChild(el('h2', null, `Lessons taught (${lessonsInRange.length})`))
    for (const l of [...lessonsInRange].sort((a, b) => a.dateISO.localeCompare(b.dateISO))) {
      const item = el('div', 'pb-entry')
      item.appendChild(el('h3', null, `${fmt(l.dateISO)} · ${l.subject}${l.classGroup ? ` (${l.classGroup})` : ''}`))
      if (l.evaluation) item.appendChild(el('p', null, `Evaluation: ${l.evaluation}`))
      root.appendChild(item)
    }
  }

  // ---- Subject-knowledge audits ----
  if (has('audits') && admin.audits.filter((a) => inRange(a.dateISO)).length > 0) {
    root.appendChild(el('h2', null, 'Subject-knowledge audits'))
    for (const a of [...admin.audits].filter((a) => inRange(a.dateISO)).sort((a, b) => a.subject.localeCompare(b.subject) || a.dateISO.localeCompare(b.dateISO))) {
      const item = el('div', 'pb-entry')
      item.appendChild(el('h3', null, `${a.subject} · ${a.stage} · ${fmt(a.dateISO)}`))
      if (a.note) item.appendChild(el('p', null, a.note))
      root.appendChild(item)
    }
  }

  document.body.appendChild(root)
  document.body.classList.add('printing-bundle')
  await Promise.all(
    [...root.querySelectorAll('img')].map((img) => img.decode?.().catch(() => {}) ?? Promise.resolve())
  )
  const cleanup = () => {
    document.body.classList.remove('printing-bundle')
    root.remove()
    for (const url of objectUrls) URL.revokeObjectURL(url)
    window.removeEventListener('afterprint', cleanup)
  }
  window.addEventListener('afterprint', cleanup)
  window.print()
  setTimeout(cleanup, 60_000)
}
