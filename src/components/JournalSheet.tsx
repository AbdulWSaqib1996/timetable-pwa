import { useMemo, useState } from 'react'
import { useModalA11y } from '../lib/a11y'
import { sessionKey } from '../lib/diff'
import { downloadFile } from '../lib/files'
import { printEvidenceBundle } from '../lib/printBundle'
import { TEACHERS_STANDARDS, standardLabel } from '../lib/standards'
import type { MetaMap, Session } from '../types'

interface Props {
  /** sessions with the user's filters applied, all dates (key dates included) */
  sessions: Session[]
  metaMap: MetaMap
  /** active profile id, for reading photos into the print bundle */
  profileId: string
  onSelect: (session: Session) => void
  onClose: () => void
}

interface Entry {
  session: Session
  note?: string
  photos: number
  standards: string[]
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
      const bits = [
        `**${formatShortDate(e.session.dateISO)} · ${e.session.title}**`,
        e.session.room ? `(${e.session.room})` : '',
      ]
        .filter(Boolean)
        .join(' ')
      lines.push(`- ${bits}`)
      if (e.note) lines.push(`  ${e.note.replace(/\n/g, '\n  ')}`)
      if (e.photos > 0) lines.push(`  _${e.photos} photo${e.photos === 1 ? '' : 's'} attached in the app_`)
    }
  }
  return lines.join('\n') + '\n'
}

export function JournalSheet({ sessions, metaMap, profileId, onSelect, onClose }: Props) {
  const dialogRef = useModalA11y<HTMLDivElement>(onClose)
  const [filter, setFilter] = useState<string | null>(null)

  const entries = useMemo(() => {
    const seen = new Set<string>()
    const out: Entry[] = []
    for (const s of sessions) {
      const key = sessionKey(s)
      if (seen.has(key)) continue
      const m = metaMap[key]
      if (!m || (!m.note && !(m.photos ?? 0) && !(m.standards ?? []).length)) continue
      seen.add(key)
      out.push({ session: s, note: m.note, photos: m.photos ?? 0, standards: m.standards ?? [] })
    }
    return out.sort((a, b) => b.session.dateISO.localeCompare(a.session.dateISO))
  }, [sessions, metaMap])

  const counts = useMemo(() => {
    const map = new Map<string, number>()
    for (const e of entries) for (const ts of e.standards) map.set(ts, (map.get(ts) ?? 0) + 1)
    return map
  }, [entries])

  const shown = filter ? entries.filter((e) => e.standards.includes(filter)) : entries

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
        <p className="filter-hint">
          Every session note and photo, tagged against the Teachers' Standards (tag them in each
          session's details). Export it when compiling your evidence bundle.
        </p>
        <div className="chip-grid">
          <button
            type="button"
            className={`chip${filter === null ? ' chip-on' : ''}`}
            aria-pressed={filter === null}
            onClick={() => setFilter(null)}
          >
            All ({entries.length})
          </button>
          {TEACHERS_STANDARDS.map((ts) => (
            <button
              key={ts.id}
              type="button"
              className={`chip${filter === ts.id ? ' chip-on' : ''}`}
              aria-pressed={filter === ts.id}
              title={ts.label}
              onClick={() => setFilter(filter === ts.id ? null : ts.id)}
            >
              {ts.id} ({counts.get(ts.id) ?? 0})
            </button>
          ))}
        </div>
        {filter && <p className="filter-hint">{standardLabel(filter)}</p>}
        {shown.length === 0 ? (
          <div className="empty-state">
            {entries.length === 0
              ? 'No evidence yet — add a note or photo to any session, then tag it with TS chips.'
              : 'Nothing tagged with this standard yet.'}
          </div>
        ) : (
          <ul className="journal-list">
            {shown.map((e) => (
              <li key={e.session.id}>
                <button type="button" className="journal-entry" onClick={() => onSelect(e.session)}>
                  <span className="journal-head">
                    <span className="journal-date">{formatShortDate(e.session.dateISO)}</span>
                    <span className="journal-title">{e.session.title}</span>
                  </span>
                  {e.note && <span className="journal-note">{e.note}</span>}
                  <span className="journal-tags">
                    {e.standards.map((ts) => (
                      <span className="badge badge-standard" key={ts} title={standardLabel(ts)}>
                        {ts}
                      </span>
                    ))}
                    {e.photos > 0 && <span className="badge badge-note">📷 {e.photos}</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="modal-actions">
          <button
            type="button"
            className="btn-primary"
            disabled={entries.length === 0}
            onClick={() =>
              void printEvidenceBundle(
                profileId,
                entries.map((e) => ({
                  key: sessionKey(e.session),
                  dateISO: e.session.dateISO,
                  title: e.session.title,
                  room: e.session.room,
                  note: e.note,
                  photos: e.photos,
                  standards: e.standards,
                }))
              )
            }
          >
            🖨 Print / PDF (with photos)
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
