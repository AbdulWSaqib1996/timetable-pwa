import { useMemo, useState } from 'react'
import { Dialog, Field, IconClose } from './ui'
import { EXPERIENCE_LAYERS, EXPERIENCE_TYPES, buildExperienceText, compareToRequirement, experienceSummary, isDuplicateExperience, plannedNumber } from '../../shared/evidence.js'
import { newAdminId, placementLabel } from '../lib/admin'
import type { AdminFile, ExperienceLogRec } from '../lib/admin'
import { placementBlocks, placementPolicy } from '../lib/placement'
import { isPlacementSession, placementTag } from '../lib/format'
import { sessionKey } from '../lib/diff'
import { downloadFile } from '../lib/files'
import type { MetaMap, Session, Settings } from '../types'

interface Props {
  admin: AdminFile
  settings: Settings
  sessions: Session[]
  metaMap: MetaMap
  todayISO: string
  onUpdateAdmin: (updater: (prev: AdminFile) => AdminFile) => void
  onClose: () => void
}

const TYPE_LABEL: Record<string, string> = { 'mentor-meeting': 'Mentor meeting', observation: 'Observation', teaching: 'Teaching', itap: 'Provider-designated ITAP', other: 'Other' }
const LAYER_LABEL: Record<string, string> = { planned: 'Planned', 'learner-logged': 'Logged by you', 'discussed-reviewed': 'Discussed / reviewed', 'provider-outcome-reference': 'Provider outcome (referenced)' }
const fmt = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

/**
 * Experience ledger (PG-07, G3), per placement. Four layers kept apart —
 * planned, logged by the learner, discussed/reviewed, provider outcome
 * referenced — never summed. Durations are only what was entered (nothing is
 * inferred); the same date, type and source is refused as a double count.
 * The timetable's planned school days and attendance ticks are shown from the
 * existing placement code, whole-day ticks and minute corrections still
 * distinguishable. Comparisons run only against a requirement the learner
 * has confirmed; otherwise totals stand without a deficit.
 */
export function ExperienceSheet({ admin, settings, sessions, metaMap, todayISO, onUpdateAdmin, onClose }: Props) {
  const [placementId, setPlacementId] = useState<string>(admin.placements[0]?.id ?? '')
  const [entry, setEntry] = useState<{ dateISO: string; type: ExperienceLogRec['type']; layer: ExperienceLogRec['layer']; duration: string; sourceRef: string; sourceLabel: string; note: string }>({ dateISO: todayISO, type: 'teaching', layer: 'learner-logged', duration: '', sourceRef: '', sourceLabel: '', note: '' })
  const [error, setError] = useState<string | null>(null)
  const [compareId, setCompareId] = useState('')
  const placement = admin.placements.find((p) => p.id === placementId)
  const label = placement ? placementLabel(placement, admin.schools) : 'All placements'
  const summary = useMemo(() => experienceSummary(admin.experience, placementId || null), [admin.experience, placementId])
  const timetable = useMemo(() => {
    if (!placement) return null
    const mapped = new Set(placement.mappedBlockTags)
    const mine = sessions.filter((s) => !s.isKeyDate && isPlacementSession(s) && mapped.has(placementTag(s.title)))
    const blocks = placementBlocks(mine, admin.exceptions, settings, (s) => metaMap[sessionKey(s)]).filter((b) => mapped.has(b.tag))
    const days = blocks.flatMap((b) => b.days)
    return { planned: days.filter((d) => !d.excluded).length, ticked: days.filter((d) => d.loggedFrom === 'day-tick').length, corrected: days.filter((d) => d.loggedFrom === 'correction').length, excluded: days.filter((d) => d.excluded).length, inset: days.filter((d) => d.exception?.kind === 'inset').length, policy: placementPolicy(settings) }
  }, [placement, sessions, admin.exceptions, settings, metaMap])
  const entries = admin.experience.filter((e) => !placementId || e.placementId === placementId).sort((a, b) => b.dateISO.localeCompare(a.dateISO))
  const sources = [
    ...admin.lessons.filter((l) => l.dateISO === entry.dateISO).map((l) => ({ id: l.id, label: `Lesson · ${l.subject || 'Lesson'}` })),
    ...admin.meetings.filter((m) => m.dateISO === entry.dateISO).map((m) => ({ id: m.id, label: 'Mentor meeting record' })),
    ...admin.observations.filter((o) => o.dateISO === entry.dateISO).map((o) => ({ id: o.id, label: `Feedback · ${o.observer || 'Observation'}` })),
  ]
  const confirmed = admin.requirements.filter((r) => r.verification === 'confirmed' && plannedNumber(r.plannedValue) !== null)
  const comparison = compareId ? compareToRequirement(summary.layers['learner-logged'].days, admin.requirements.find((r) => r.id === compareId)) : null
  const exportText = () => buildExperienceText(summary, label, comparison ? [comparison] : [])

  const add = () => {
    setError(null)
    const rec: ExperienceLogRec = { id: newAdminId(), dateISO: entry.dateISO, type: entry.type, layer: entry.layer, at: Date.now() }
    if (placementId) rec.placementId = placementId
    if (entry.duration.trim()) rec.durationMins = Math.max(0, Math.min(1440, parseInt(entry.duration, 10) || 0))
    if (entry.sourceRef) rec.sourceRef = entry.sourceRef
    if (entry.sourceLabel.trim()) rec.sourceLabel = entry.sourceLabel.trim()
    if (entry.note.trim()) rec.note = entry.note.trim()
    if (entry.layer === 'provider-outcome-reference' && !rec.sourceLabel) { setError('A provider outcome needs its source (who said it, where).'); return }
    if (isDuplicateExperience(admin.experience, rec)) { setError('Already in the ledger: same date, type, layer and source — not counted twice.'); return }
    onUpdateAdmin((prev) => ({ ...prev, experience: [...prev.experience, rec] }))
    setEntry({ ...entry, duration: '', sourceRef: '', sourceLabel: '', note: '' })
  }

  return (
    <Dialog label="Experience ledger" onClose={onClose} className="sheet-experience">
      <div className="sheet-header">
        <h2>Experience ledger</h2>
        <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}><IconClose /></button>
      </div>
      <Field label="Placement">
        <select className="date-input" aria-label="Ledger placement" value={placementId} onChange={(e) => setPlacementId(e.target.value)}>
          <option value="">All placements</option>
          {admin.placements.map((p) => (
            <option key={p.id} value={p.id}>{placementLabel(p, admin.schools)}</option>
          ))}
        </select>
      </Field>
      {timetable && (
        <p className="filter-hint" aria-label="Timetable and attendance">
          From your timetable and attendance ticks (not the ledger): {timetable.planned} planned school day{timetable.planned === 1 ? '' : 's'} · {timetable.ticked} whole-day tick{timetable.ticked === 1 ? '' : 's'} · {timetable.corrected} minute correction{timetable.corrected === 1 ? '' : 's'} · {timetable.excluded} excluded (holiday/cancelled{timetable.policy.insetCounts ? '' : '/inset'}) · {timetable.inset} inset day{timetable.inset === 1 ? '' : 's'} ({timetable.policy.insetCounts ? 'counted' : 'not counted'} under your policy).
        </p>
      )}
      <dl className="kv" aria-label="Ledger summary">
        {EXPERIENCE_LAYERS.map((layer) => {
          const l = summary.layers[layer]
          return (
            <div key={layer}>
              <dt>{LAYER_LABEL[layer]}</dt>
              <dd>
                {l.count} entr{l.count === 1 ? 'y' : 'ies'} on {l.days} day{l.days === 1 ? '' : 's'}
                {EXPERIENCE_TYPES.filter((t) => l.byType[t].count).map((t) => ` · ${TYPE_LABEL[t]} ${l.byType[t].count}${l.byType[t].mins ? ` (${l.byType[t].mins} min entered)` : ''}${l.byType[t].untimed ? ` (${l.byType[t].untimed} untimed)` : ''}`).join('')}
              </dd>
            </div>
          )
        })}
      </dl>
      <Field label="Compare logged days against a confirmed requirement" hint="Only requirements you confirmed can be compared; otherwise the total stands on its own.">
        <select className="date-input" aria-label="Compare against" value={compareId} onChange={(e) => setCompareId(e.target.value)}>
          <option value="">No comparison</option>
          {confirmed.map((r) => (
            <option key={r.id} value={r.id}>{r.title} — {r.plannedValue}</option>
          ))}
        </select>
        {comparison && <p className="filter-hint" aria-label="Comparison">{comparison.sentence}</p>}
        {confirmed.length === 0 && <p className="filter-hint">No confirmed numeric requirement yet — {summary.layers['learner-logged'].days} logged day{summary.layers['learner-logged'].days === 1 ? '' : 's'} recorded, no deficit shown.</p>}
      </Field>

      <h3 className="subheading">Add to the ledger</h3>
      <div className="task-edit-row">
        <input type="date" className="date-input" aria-label="Entry date" value={entry.dateISO} onChange={(e) => setEntry({ ...entry, dateISO: e.target.value, sourceRef: '' })} />
        <select className="date-input" aria-label="Entry type" value={entry.type} onChange={(e) => setEntry({ ...entry, type: e.target.value as ExperienceLogRec['type'] })}>
          {EXPERIENCE_TYPES.map((t) => (
            <option key={t} value={t}>{TYPE_LABEL[t]}</option>
          ))}
        </select>
        <select className="date-input" aria-label="Entry layer" value={entry.layer} onChange={(e) => setEntry({ ...entry, layer: e.target.value as ExperienceLogRec['layer'] })}>
          {EXPERIENCE_LAYERS.filter((l) => l !== 'planned').map((l) => (
            <option key={l} value={l}>{LAYER_LABEL[l]}</option>
          ))}
        </select>
      </div>
      <div className="task-edit-row">
        <input type="number" className="date-input" aria-label="Duration (minutes, optional)" placeholder="Minutes (optional)" min={0} max={1440} value={entry.duration} onChange={(e) => setEntry({ ...entry, duration: e.target.value })} />
        <select className="date-input" aria-label="Source record" value={entry.sourceRef} onChange={(e) => setEntry({ ...entry, sourceRef: e.target.value })}>
          <option value="">No source record</option>
          {sources.map((s) => (
            <option key={s.id} value={s.id}>{s.label}</option>
          ))}
        </select>
      </div>
      {entry.layer === 'provider-outcome-reference' && <input type="text" className="placement-input" aria-label="Provider source" placeholder="Source of the provider outcome (who, where, when)" value={entry.sourceLabel} onChange={(e) => setEntry({ ...entry, sourceLabel: e.target.value })} />}
      <input type="text" className="placement-input" aria-label="Entry note" placeholder="Note (optional)" value={entry.note} onChange={(e) => setEntry({ ...entry, note: e.target.value })} />
      {error && <p className="setup-error" role="alert">{error}</p>}
      <div className="btn-row">
        <button type="button" className="btn-primary" onClick={add}>Add entry</button>
        <button type="button" className="btn-today-reset" onClick={() => downloadFile(`experience-${label.replace(/[^\w-]+/g, '-').toLowerCase()}.txt`, exportText(), 'text/plain')}>Export for a provider conversation</button>
      </div>
      {entries.length > 0 && (
        <ul className="workspace-list" aria-label="Ledger entries">
          {entries.map((e) => (
            <li key={e.id} className="workspace-row"><span><span className="tag">{LAYER_LABEL[e.layer]}</span> {fmt(e.dateISO)} · {TYPE_LABEL[e.type]}{Number.isFinite(e.durationMins) ? ` · ${e.durationMins} min` : ' · no duration entered'}{e.sourceLabel ? ` · source: ${e.sourceLabel}` : ''}{e.note ? ` · ${e.note}` : ''}</span><button type="button" className="travel-link" onClick={() => onUpdateAdmin((prev) => ({ ...prev, experience: prev.experience.filter((x) => x.id !== e.id) }))}>Remove</button></li>
          ))}
        </ul>
      )}
    </Dialog>
  )
}
