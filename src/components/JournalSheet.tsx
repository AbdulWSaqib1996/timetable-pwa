import { useEffect, useMemo, useState } from 'react'
import { useModalA11y } from '../lib/a11y'
import type { AdminFile } from '../lib/admin'
import { readAttachments } from '../lib/attachments'
import { sessionKey } from '../lib/diff'
import { downloadFile } from '../lib/files'
import { printEvidenceBundle } from '../lib/printBundle'
import { trackUse } from '../lib/usage'
import { TEACHERS_STANDARDS, standardLabel } from '../lib/standards'
import type { MetaMap, Session } from '../types'

interface Props {
  /** sessions with the user's filters applied, all dates (key dates included) */
  sessions: Session[]
  metaMap: MetaMap
  /** active profile id, for reading photos into the print bundle */
  profileId: string
  /** PGCE admin file — reflections, lessons, targets and observations join the journal */
  admin?: AdminFile
  onSelect: (session: Session) => void
  onClose: () => void
}

type EntryType = 'session' | 'reflection' | 'lesson' | 'target' | 'observation'

interface Entry {
  id: string
  key: string
  type: EntryType
  dateISO: string
  title: string
  room?: string
  session?: Session
  marker?: string
  note?: string
  captions: string[]
  photos: number
  standards: string[]
}

const TYPE_LABEL: Record<EntryType, string> = {
  session: 'Session notes',
  reflection: 'Reflections',
  lesson: 'Lessons',
  target: 'Targets',
  observation: 'Observations',
}

function formatShortDate(dateISO: string): string {
  const [y, m, d] = dateISO.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function buildMarkdown(entries: Entry[]): string {
  const lines = [
    '# Evidence journal',
    '',
    `Exported ${new Date().toLocaleDateString('en-GB')} from My Timetable. Photos referenced here are stored in the app (Settings → Backup includes them).`,
  ]
  for (const ts of [...TEACHERS_STANDARDS, { id: 'Untagged', label: 'Not yet tagged to a standard' }]) {
    const mine = entries.filter((e) =>
      ts.id === 'Untagged' ? e.standards.length === 0 : e.standards.includes(ts.id)
    )
    if (mine.length === 0) continue
    lines.push('', `## ${ts.id === 'Untagged' ? ts.label : `${ts.id} — ${ts.label}`}`, '')
    for (const e of mine) {
      const bits = [`**${formatShortDate(e.dateISO)} · ${e.title}**`, e.room ? `(${e.room})` : '']
        .filter(Boolean)
        .join(' ')
      lines.push(`- ${bits}`)
      if (e.note) lines.push(`  ${e.note.replace(/\n/g, '\n  ')}`)
      for (const c of e.captions) lines.push(`  📷 ${c}`)
      if (e.photos > 0) lines.push(`  _${e.photos} photo${e.photos === 1 ? '' : 's'} recorded; check availability on this device_`)
    }
  }
  return lines.join('\n') + '\n'
}

interface JournalContext {
  query: string
  standard: string | null
  untagged: boolean
  types: EntryType[]
  from: string
  to: string
}

const CONTEXT_KEY = 'timetable.journalctx.v1'
const defaultContext: JournalContext = { query: '', standard: null, untagged: false, types: [], from: '', to: '' }

/**
 * Evidence journal with search (P5-04): query, date range, record type,
 * standards and Untagged filters over session notes, photo captions,
 * reflections, lesson evaluations, targets and observations. The index is a
 * deterministic computed selector keyed by stable record identity; search
 * context survives Back via sessionStorage.
 */
export function JournalSheet({ sessions, metaMap, profileId, admin, onSelect, onClose }: Props) {
  const dialogRef = useModalA11y<HTMLDivElement>(onClose)
  const [ctx, setCtx] = useState<JournalContext>(() => {
    try {
      return { ...defaultContext, ...(JSON.parse(sessionStorage.getItem(CONTEXT_KEY) ?? '{}') as Partial<JournalContext>) }
    } catch {
      return defaultContext
    }
  })
  const update = (patch: Partial<JournalContext>) =>
    setCtx((prev) => {
      const next = { ...prev, ...patch }
      try {
        sessionStorage.setItem(CONTEXT_KEY, JSON.stringify(next))
      } catch {
        /* context restore is best-effort */
      }
      return next
    })

  // Photo captions, indexed by owner key (updated when the sheet opens).
  const [captionsByKey, setCaptionsByKey] = useState<Map<string, string[]>>(new Map())
  useEffect(() => {
    let live = true
    void readAttachments('photos')
      .then((all) => {
        if (!live) return
        const map = new Map<string, string[]>()
        for (const p of all) {
          const [pid, key] = [p.owner.slice(0, p.owner.indexOf('|')), p.owner.slice(p.owner.indexOf('|') + 1)]
          const caption = (p as { caption?: string }).caption
          if (pid !== profileId || !caption) continue
          map.set(key, [...(map.get(key) ?? []), caption])
        }
        setCaptionsByKey(map)
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [profileId])

  const entries = useMemo(() => {
    const seen = new Set<string>()
    const out: Entry[] = []
    for (const s of sessions) {
      const key = sessionKey(s)
      if (seen.has(key)) continue
      const m = metaMap[key]
      const captions = captionsByKey.get(key) ?? []
      if ((!m || (!m.note && !(m.photos ?? 0) && !(m.standards ?? []).length)) && captions.length === 0) continue
      seen.add(key)
      out.push({
        id: key,
        key,
        type: 'session',
        dateISO: s.dateISO,
        title: s.title,
        room: s.room,
        session: s,
        note: m?.note,
        captions,
        photos: m?.photos ?? 0,
        standards: m?.standards ?? [],
      })
    }
    // Older notes remain discoverable even if their source event vanished before identity migration.
    for (const [key, m] of Object.entries(metaMap)) {
      if (seen.has(key) || m.deleted || (!m.note && !m.photos)) continue
      const [dateISO, , title] = key.split('|')
      out.push({
        id: key,
        key,
        type: 'session',
        dateISO: /^\d{4}-\d{2}-\d{2}$/.test(dateISO) ? dateISO : '1970-01-01',
        title: 'Saved record · ' + (title || key),
        note: m.note,
        captions: captionsByKey.get(key) ?? [],
        photos: m.photos ?? 0,
        standards: m.standards ?? [],
      })
    }
    for (const r of admin?.reflections ?? []) {
      out.push({
        id: `refl-${r.id}`,
        key: `refl-${r.id}`,
        type: 'reflection',
        dateISO: r.weekISO,
        title: `Weekly reflection (w/c ${formatShortDate(r.weekISO)})`,
        marker: '📔',
        note: [r.wentWell && `Went well: ${r.wentWell}`, r.challenges && `Challenges: ${r.challenges}`, r.focus && `Next focus: ${r.focus}`]
          .filter(Boolean)
          .join(' · '),
        captions: [],
        photos: 0,
        standards: r.standards,
      })
    }
    for (const l of admin?.lessons ?? []) {
      if (!l.evaluation && l.standards.length === 0) continue
      out.push({
        id: `les-${l.id}`,
        key: `les-${l.id}`,
        type: 'lesson',
        dateISO: l.dateISO,
        title: `Lesson taught: ${l.subject}${l.classGroup ? ` (${l.classGroup})` : ''}`,
        marker: '🍎',
        note: l.evaluation,
        captions: [],
        photos: 0,
        standards: l.standards,
      })
    }
    for (const t of admin?.targets ?? []) {
      out.push({
        id: `tgt-${t.id}`,
        key: `tgt-${t.id}`,
        type: 'target',
        dateISO: t.metISO ?? t.setISO,
        title: `Target ${t.status === 'met' ? '(met)' : t.status === 'progress' ? '(in progress)' : '(open)'}`,
        marker: '🎯',
        note: t.text,
        captions: [],
        photos: 0,
        standards: t.standards,
      })
    }
    for (const o of admin?.observations ?? []) {
      if (!o.strengths && !o.development) continue
      out.push({
        id: `obs-${o.id}`,
        key: `obs-${o.id}`,
        type: 'observation',
        dateISO: o.dateISO,
        title: `Observation: ${o.subject || 'Lesson'}${o.observer ? ` · ${o.observer}` : ''}`,
        marker: '👀',
        note: [o.strengths && `Strengths: ${o.strengths}`, o.development && `Development: ${o.development}`]
          .filter(Boolean)
          .join(' · '),
        captions: [],
        photos: 0,
        standards: [],
      })
    }
    return out.sort((a, b) => b.dateISO.localeCompare(a.dateISO))
  }, [sessions, metaMap, admin, captionsByKey])

  const counts = useMemo(() => {
    const map = new Map<string, number>()
    for (const e of entries) for (const ts of e.standards) map.set(ts, (map.get(ts) ?? 0) + 1)
    return map
  }, [entries])
  const untaggedCount = entries.filter((e) => e.standards.length === 0).length

  const shown = useMemo(() => {
    const q = ctx.query.trim().toLowerCase()
    return entries.filter((e) => {
      if (ctx.standard && !e.standards.includes(ctx.standard)) return false
      if (ctx.untagged && e.standards.length > 0) return false
      if (ctx.types.length > 0 && !ctx.types.includes(e.type)) return false
      if (ctx.from && e.dateISO < ctx.from) return false
      if (ctx.to && e.dateISO > ctx.to) return false
      if (q) {
        const haystack = [e.title, e.note ?? '', ...e.captions].join(' ').toLowerCase()
        if (!haystack.includes(q)) return false
      }
      return true
    })
  }, [entries, ctx])

  const filtersActive =
    ctx.query.trim() !== '' || ctx.standard !== null || ctx.untagged || ctx.types.length > 0 || ctx.from !== '' || ctx.to !== ''

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        ref={dialogRef}
        className="modal-card sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Evidence journal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet-header">
          <h2>Evidence journal</h2>
          <button type="button" className="btn-icon" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="searchbar">
          <input
            type="search"
            placeholder="Search notes, captions, reflections, targets…"
            aria-label="Search evidence"
            value={ctx.query}
            onChange={(e) => update({ query: e.target.value })}
          />
          <span className="search-count">{shown.length}</span>
        </div>
        <div className="journal-range">
          <label className="ui-field">
            <span className="ui-field-label">From</span>
            <input type="date" className="date-input" value={ctx.from} onChange={(e) => update({ from: e.target.value })} />
          </label>
          <label className="ui-field">
            <span className="ui-field-label">To</span>
            <input type="date" className="date-input" value={ctx.to} onChange={(e) => update({ to: e.target.value })} />
          </label>
        </div>
        <div className="chip-grid">
          {(Object.keys(TYPE_LABEL) as EntryType[]).map((t) => (
            <button
              key={t}
              type="button"
              className={`chip chip-small${ctx.types.includes(t) ? ' chip-on' : ''}`}
              aria-pressed={ctx.types.includes(t)}
              onClick={() =>
                update({ types: ctx.types.includes(t) ? ctx.types.filter((x) => x !== t) : [...ctx.types, t] })
              }
            >
              {TYPE_LABEL[t]}
            </button>
          ))}
        </div>
        <div className="chip-grid">
          {TEACHERS_STANDARDS.map((ts) => (
            <button
              key={ts.id}
              type="button"
              className={`chip chip-small${ctx.standard === ts.id ? ' chip-on' : ''}`}
              aria-pressed={ctx.standard === ts.id}
              title={ts.label}
              onClick={() => update({ standard: ctx.standard === ts.id ? null : ts.id, untagged: false })}
            >
              {ts.id} ({counts.get(ts.id) ?? 0})
            </button>
          ))}
          <button
            type="button"
            className={`chip chip-small${ctx.untagged ? ' chip-on' : ''}`}
            aria-pressed={ctx.untagged}
            onClick={() => update({ untagged: !ctx.untagged, standard: null })}
          >
            Untagged ({untaggedCount})
          </button>
        </div>
        {ctx.standard && <p className="filter-hint">{standardLabel(ctx.standard)}</p>}
        {shown.length === 0 ? (
          <div className="empty-state">
            {entries.length === 0 ? (
              'No evidence yet — add a note or photo to any session, then tag it with TS chips.'
            ) : (
              <>
                Nothing matches these filters — you have {entries.length} evidence record
                {entries.length === 1 ? '' : 's'} in total.{' '}
                <button type="button" className="travel-link" onClick={() => update(defaultContext)}>
                  Clear filters
                </button>
              </>
            )}
          </div>
        ) : (
          <ul className="journal-list">
            {shown.map((e) => {
              const body = (
                <>
                  <span className="journal-head">
                    <span className="journal-date">{formatShortDate(e.dateISO)}</span>
                    <span className="journal-title">
                      {e.marker ? `${e.marker} ` : ''}
                      {e.title}
                    </span>
                  </span>
                  {e.note && <span className="journal-note">{e.note}</span>}
                  {e.captions.length > 0 && <span className="journal-note">📷 {e.captions.join(' · ')}</span>}
                  <span className="journal-tags">
                    {e.standards.map((ts) => (
                      <span className="badge badge-standard" key={ts} title={standardLabel(ts)}>
                        {ts}
                      </span>
                    ))}
                    {e.photos > 0 && <span className="badge badge-note">📷 {e.photos}</span>}
                  </span>
                </>
              )
              return (
                <li key={e.id}>
                  {e.session ? (
                    <button type="button" className="journal-entry" onClick={() => onSelect(e.session!)}>
                      {body}
                    </button>
                  ) : (
                    <div className="journal-entry journal-static">{body}</div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
        <div className="modal-actions">
          <button
            type="button"
            className="btn-primary"
            disabled={shown.length === 0}
            onClick={() => {
              trackUse('evidenceprint')
              return void printEvidenceBundle(
                profileId,
                (filtersActive ? shown : entries).map((e) => ({
                  key: e.key,
                  dateISO: e.dateISO,
                  title: e.title,
                  room: e.room,
                  note: e.note,
                  photos: e.photos,
                  standards: e.standards,
                }))
              )
            }}
          >
            🖨 Print / PDF ({filtersActive ? `${shown.length} filtered` : 'all'})
          </button>
          <button
            type="button"
            className="btn-secondary"
            disabled={entries.length === 0}
            onClick={() => downloadFile('evidence-journal.md', buildMarkdown(entries), 'text/markdown;charset=utf-8')}
          >
            Export .md
          </button>
          <button type="button" className="btn-ghost" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
