import type { AdminFile } from './admin'
import { getPhotos } from './photos'
import { TEACHERS_STANDARDS } from './standards'
import type { MetaMap, Session } from '../types'
import { sessionKey } from './diff'
import { isPlacementSession, placementTag } from './format'

/**
 * The full PGCE binder in one print: attendance & placement days, evidence per
 * Teachers' Standard (session notes/photos + reflections + lesson evaluations),
 * weekly reflections, targets, mentor meetings, observations, lessons and
 * audits. Uses the same hidden #print-bundle mechanism as the evidence bundle.
 */

interface BinderInput {
  profileId: string
  profileName: string
  sessions: Session[]
  metaMap: MetaMap
  admin: AdminFile
  placementTargetDays?: number
  todayISO: string
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
  const { profileId, sessions, metaMap, admin, todayISO } = input
  const root = el('div', null)
  root.id = 'print-bundle'
  const objectUrls: string[] = []

  root.appendChild(el('h1', null, 'PGCE file'))
  root.appendChild(
    el('p', 'pb-sub', `${input.profileName} · exported ${new Date().toLocaleDateString('en-GB')} from My Timetable`)
  )

  // ---- Attendance & placement days ----
  root.appendChild(el('h2', null, 'Attendance & placement days'))
  const past = sessions.filter((s) => s.dateISO <= todayISO && !s.isSelfStudy && !s.isKeyDate)
  const attended = past.filter((s) => metaMap[sessionKey(s)]?.attended).length
  const absent = past.filter((s) => metaMap[sessionKey(s)]?.absent).length
  const byTag = new Map<string, { total: Set<string>; done: Set<string> }>()
  for (const s of sessions) {
    if (s.isKeyDate || !isPlacementSession(s)) continue
    const tag = placementTag(s.title)
    const e = byTag.get(tag) ?? { total: new Set<string>(), done: new Set<string>() }
    e.total.add(s.dateISO)
    if (metaMap[sessionKey(s)]?.attended) e.done.add(s.dateISO)
    byTag.set(tag, e)
  }
  const daysDone = [...byTag.values()].reduce((n, e) => n + e.done.size, 0)
  const summary = el('div', 'pb-entry')
  summary.appendChild(
    el(
      'p',
      null,
      `${attended} of ${past.length} past sessions attended, ${absent} recorded absence${absent === 1 ? '' : 's'}. ` +
        `School days logged: ${daysDone}${input.placementTargetDays ? ` of ${input.placementTargetDays} required` : ''}` +
        ([...byTag.entries()].length > 0
          ? ` (${[...byTag.entries()].map(([t, e]) => `${t} ${e.done.size}/${e.total.size}`).join(' · ')}).`
          : '.')
    )
  )
  root.appendChild(summary)

  // ---- Evidence per standard (session notes/photos + reflections + lesson evaluations) ----
  interface Ev {
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
      dateISO: s.dateISO,
      heading: s.title,
      note: m.note,
      photosKey: key,
      photos: m.photos ?? 0,
      standards: m.standards ?? [],
    })
  }
  for (const r of admin.reflections) {
    evidence.push({
      dateISO: r.weekISO,
      heading: `Weekly reflection (w/c ${fmt(r.weekISO)})`,
      note: [r.wentWell && `Went well: ${r.wentWell}`, r.challenges && `Challenges: ${r.challenges}`, r.focus && `Next focus: ${r.focus}`]
        .filter(Boolean)
        .join('\n'),
      photos: 0,
      standards: r.standards,
    })
  }
  for (const l of admin.lessons) {
    if (!l.evaluation && l.standards.length === 0) continue
    evidence.push({
      dateISO: l.dateISO,
      heading: `Lesson taught: ${l.subject}${l.classGroup ? ` (${l.classGroup})` : ''}`,
      note: l.evaluation,
      photos: 0,
      standards: l.standards,
    })
  }
  root.appendChild(el('h2', null, 'Evidence against the Teachers’ Standards'))
  for (const ts of [...TEACHERS_STANDARDS, { id: '', label: 'Not yet tagged' }]) {
    const mine = evidence
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
        try {
          for (const photo of await getPhotos(profileId, e.photosKey)) {
            const url = URL.createObjectURL(photo.blob)
            objectUrls.push(url)
            const img = document.createElement('img')
            img.src = url
            grid.appendChild(img)
          }
        } catch {
          /* print without photos */
        }
        if (grid.childElementCount > 0) item.appendChild(grid)
      }
      root.appendChild(item)
    }
  }

  // ---- Targets ----
  if (admin.targets.length > 0) {
    root.appendChild(el('h2', null, 'Targets'))
    for (const t of [...admin.targets].sort((a, b) => a.setISO.localeCompare(b.setISO))) {
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
  if (admin.meetings.length > 0) {
    root.appendChild(el('h2', null, 'Mentor meetings'))
    for (const m of [...admin.meetings].sort((a, b) => a.dateISO.localeCompare(b.dateISO))) {
      const item = el('div', 'pb-entry')
      item.appendChild(el('h3', null, fmt(m.dateISO)))
      if (m.discussed) item.appendChild(el('p', null, m.discussed))
      for (const a of m.actions) item.appendChild(el('p', null, `${a.done ? '☑' : '☐'} ${a.text}`))
      root.appendChild(item)
    }
  }

  // ---- Observations ----
  if (admin.observations.length > 0) {
    root.appendChild(el('h2', null, 'Observation records'))
    for (const o of [...admin.observations].sort((a, b) => a.dateISO.localeCompare(b.dateISO))) {
      const item = el('div', 'pb-entry')
      item.appendChild(el('h3', null, `${fmt(o.dateISO)} · ${o.subject || 'Lesson'}${o.observer ? ` · observed by ${o.observer}` : ''}`))
      if (o.focus) item.appendChild(el('p', null, `Focus: ${o.focus}`))
      if (o.strengths) item.appendChild(el('p', null, `Strengths: ${o.strengths}`))
      if (o.development) item.appendChild(el('p', null, `Development points: ${o.development}`))
      root.appendChild(item)
    }
  }

  // ---- Lessons taught ----
  if (admin.lessons.length > 0) {
    root.appendChild(el('h2', null, `Lessons taught (${admin.lessons.length})`))
    for (const l of [...admin.lessons].sort((a, b) => a.dateISO.localeCompare(b.dateISO))) {
      const item = el('div', 'pb-entry')
      item.appendChild(el('h3', null, `${fmt(l.dateISO)} · ${l.subject}${l.classGroup ? ` (${l.classGroup})` : ''}`))
      if (l.evaluation) item.appendChild(el('p', null, `Evaluation: ${l.evaluation}`))
      root.appendChild(item)
    }
  }

  // ---- Subject-knowledge audits ----
  if (admin.audits.length > 0) {
    root.appendChild(el('h2', null, 'Subject-knowledge audits'))
    for (const a of [...admin.audits].sort((a, b) => a.subject.localeCompare(b.subject) || a.dateISO.localeCompare(b.dateISO))) {
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
