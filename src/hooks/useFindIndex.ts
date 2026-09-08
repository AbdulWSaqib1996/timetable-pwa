import { useEffect, useMemo, useRef, useState } from 'react'
import { buildFindIndex } from '../../shared/find.js'
import type { AdminFile } from '../lib/admin'
import { readAttachments } from '../lib/attachments'
import { sessionKey } from '../lib/diff'
import { needsScheduling } from '../../shared/planValidation.js'
import { getWalletFiles } from '../lib/wallet'
import type { MetaMap, Session } from '../types'

/** One searchable owner record, as the shared index expects it. */
export interface FindOwner {
  ownerType: 'session' | 'personal' | 'task' | 'plan' | 'pgce' | 'document'
  ownerId: string
  rev: string | number
  contentRev?: string | number
  title: string
  date?: string
  time?: string
  kind: string
  text?: string
  content?: string
  meta?: Record<string, string> | null
}

export interface FindIndexState {
  index: ReturnType<typeof buildFindIndex> | null
  /** the timetable has not loaded yet — cached results are not "no results" */
  pending: boolean
}

interface Input {
  profileId: string
  /** imported course sessions (all dates, membership only) — null while loading */
  sessions: Session[] | null
  admin: AdminFile
  metaMap: MetaMap
  /** opt-in: notes, captions and record text join the index (NF-01) */
  includeNotes: boolean
}

/**
 * Lazily built, incrementally refreshed local index over every record type
 * the app owns (R4 / NF-01). Keyed by (profileId, ownerType, ownerId) with
 * the owner's revision; a record that disappears (tombstone) drops out on
 * the next build. Attachments contribute file names (documents) and, only
 * when opted in, photo captions. Nothing leaves the device.
 */
export function useFindIndex({ profileId, sessions, admin, metaMap, includeNotes }: Input): FindIndexState {
  const prevRef = useRef<ReturnType<typeof buildFindIndex> | null>(null)
  const [documents, setDocuments] = useState<{ id: string; name: string; at: number }[]>([])
  const [captions, setCaptions] = useState<Map<string, string[]>>(new Map())

  useEffect(() => {
    let live = true
    void getWalletFiles(profileId)
      .then((files) => live && setDocuments(files.map((f) => ({ id: f.uid ?? String(f.id), name: f.name, at: f.at }))))
      .catch(() => live && setDocuments([]))
    return () => {
      live = false
    }
  }, [profileId, admin.tasks.length])

  useEffect(() => {
    if (!includeNotes) {
      setCaptions(new Map())
      return
    }
    let live = true
    void readAttachments('photos')
      .then((all) => {
        if (!live) return
        const map = new Map<string, string[]>()
        for (const p of all) {
          const sep = p.owner.indexOf('|')
          const [pid, key] = [p.owner.slice(0, sep), p.owner.slice(sep + 1)]
          const caption = (p as { caption?: string }).caption
          if (pid !== profileId || !caption) continue
          map.set(key, [...(map.get(key) ?? []), caption])
        }
        setCaptions(map)
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [profileId, includeNotes, metaMap])

  const index = useMemo(() => {
    if (sessions === null) return prevRef.current && prevRef.current.profileId === profileId ? prevRef.current : null
    const owners: FindOwner[] = []
    for (const s of sessions) {
      const key = sessionKey(s)
      const note = includeNotes ? metaMap[key]?.note ?? '' : ''
      const caps = includeNotes ? captions.get(key) ?? [] : []
      owners.push({
        ownerType: 'session',
        ownerId: key,
        rev: `${s.title}|${s.subject}|${s.room}|${s.tutor}|${s.dateISO}|${s.start}|${s.end}`,
        contentRev: `${note}|${caps.join('|')}`,
        title: s.title,
        date: s.dateISO,
        time: s.start,
        kind: s.isKeyDate ? 'Deadline' : s.isSelfStudy ? 'Self study' : 'Session',
        text: [s.subject, s.room, s.tutor, s.specialismName].filter(Boolean).join(' '),
        content: [note, ...caps].filter(Boolean).join(' · '),
      })
    }
    for (const c of admin.commitments) {
      owners.push({
        ownerType: 'personal',
        ownerId: c.id,
        rev: c.at,
        contentRev: includeNotes ? c.at : 0,
        title: c.title,
        date: c.dateISO,
        time: c.startTime,
        kind: 'Personal event',
        text: [c.kind, c.location].filter(Boolean).join(' '),
        content: includeNotes ? c.notes ?? '' : '',
      })
    }
    const taskById = new Map(admin.tasks.map((t) => [t.id, t]))
    for (const t of admin.tasks) {
      owners.push({
        ownerType: 'task',
        ownerId: t.id,
        rev: t.at,
        contentRev: includeNotes ? t.at : 0,
        title: t.title,
        date: t.dueISO,
        time: t.dueTime ?? '',
        kind: t.status === 'done' ? 'Task · completed' : 'Task',
        text: t.status,
        content: includeNotes ? t.notes ?? '' : '',
      })
    }
    for (const p of admin.plans) {
      const parent = taskById.get(p.parentId)
      if (!parent) continue
      owners.push({
        ownerType: 'plan',
        ownerId: p.id,
        rev: `${p.at}|${parent.at}`,
        title: p.title,
        date: p.dateISO ?? '',
        time: p.startTime ?? '',
        kind: p.kind === 'block' ? (needsScheduling(p) ? 'Study block · needs scheduling' : 'Study block') : p.kind === 'milestone' ? 'Milestone' : 'Subtask',
        text: parent.title,
        meta: { parentId: parent.id },
      })
    }
    const pgce = (id: string, at: number, title: string, date: string, kind: string, tab: string, content: string) =>
      owners.push({ ownerType: 'pgce', ownerId: id, rev: at, contentRev: includeNotes ? at : 0, title, date, kind, text: '', content: includeNotes ? content : '', meta: { tab } })
    for (const r of admin.reflections) pgce(r.id, r.at, `Weekly reflection · week of ${r.weekISO}`, r.weekISO, 'Reflection', 'reflect', [r.wentWell, r.challenges, r.focus].join(' '))
    for (const t of admin.targets) pgce(t.id, t.at, t.text, t.setISO, `Target · ${t.status}`, 'targets', '')
    for (const m of admin.meetings) pgce(m.id, m.at, `Mentor meeting ${m.dateISO}`, m.dateISO, 'Meeting', 'meetings', [m.discussed, ...m.actions.map((a) => a.text)].join(' '))
    for (const o of admin.observations) pgce(o.id, o.at, `${o.subject || 'Observation'} — ${o.observer || 'observer'}`, o.dateISO, 'Observation', 'obs', [o.focus, o.strengths, o.development].join(' '))
    for (const l of admin.lessons) pgce(l.id, l.at, `${l.subject || 'Lesson'} — ${l.classGroup || 'class'}`, l.dateISO, 'Lesson', 'lessons', l.evaluation)
    for (const a of admin.audits) pgce(a.id, a.at, `${a.subject || 'Audit'} (${a.stage})`, a.dateISO, 'Audit', 'audits', a.note)
    for (const d of documents) {
      owners.push({ ownerType: 'document', ownerId: d.id, rev: d.at, title: d.name, date: '', kind: 'Document', text: 'wallet file' })
    }
    const built = buildFindIndex(profileId, owners, prevRef.current)
    prevRef.current = built
    return built
  }, [profileId, sessions, admin, metaMap, includeNotes, captions, documents])

  return { index, pending: sessions === null && index === null }
}
