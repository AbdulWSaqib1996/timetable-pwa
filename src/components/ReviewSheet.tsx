import { useState } from 'react'
import { Dialog, Field, IconClose } from './ui'
import { buildHandoverText, experienceSummary } from '../../shared/evidence.js'
import { newAdminId } from '../lib/admin'
import type { AdminFile, ReviewRecordRec } from '../lib/admin'
import { downloadFile } from '../lib/files'

interface Props {
  admin: AdminFile
  todayISO: string
  onUpdateAdmin: (updater: (prev: AdminFile) => AdminFile) => void
  onClose: () => void
}

const fmt = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

/**
 * Reviews and transition (PG-09, G3): a review record — date, participants,
 * focus, questions, the learner's private notes, any provider judgement with
 * its source, next steps, the pack discussed. The optional first-post
 * handover pack is built from evidence examples, experience by layer and
 * review next steps with private notes, contacts and identifiers left out; it
 * says who prepared it and that no induction body has received it.
 */
export function ReviewSheet({ admin, todayISO, onUpdateAdmin, onClose }: Props) {
  const [draft, setDraft] = useState({ dateISO: todayISO, participants: '', focus: '', questions: '', learnerNotes: '', judgement: '', source: '', nextSteps: '', packId: '' })
  const [showHandover, setShowHandover] = useState(false)
  const reviews = [...admin.reviews].sort((a, b) => b.dateISO.localeCompare(a.dateISO))
  const handover = () => buildHandoverText({ examples: admin.examples, experience: admin.experience, reviews: admin.reviews, placements: admin.placements, schools: admin.schools })
  const focusSummary = admin.cycles.find((c) => c.state === 'active')
  const exp = experienceSummary(admin.experience, null)

  return (
    <Dialog label="Reviews & handover" onClose={onClose} className="sheet-reviews">
      <div className="sheet-header">
        <h2>Reviews &amp; handover</h2>
        <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}><IconClose /></button>
      </div>
      <p className="filter-hint">
        Ready for a review: {admin.examples.length} evidence example{admin.examples.length === 1 ? '' : 's'} · focus: {focusSummary ? focusSummary.focus : 'none active'} · {exp.layers['learner-logged'].count} logged experience entr{exp.layers['learner-logged'].count === 1 ? 'y' : 'ies'} · {admin.reviewPacks.filter((p) => p.state !== 'discussed').length} pack{admin.reviewPacks.filter((p) => p.state !== 'discussed').length === 1 ? '' : 's'} not yet discussed.
      </p>
      <h3 className="subheading">Record a review</h3>
      <div className="task-edit-row">
        <Field label="Date"><input type="date" className="date-input" aria-label="Review date" value={draft.dateISO} onChange={(e) => setDraft({ ...draft, dateISO: e.target.value })} /></Field>
        <Field label="Participants"><input type="text" className="placement-input" aria-label="Participants" value={draft.participants} onChange={(e) => setDraft({ ...draft, participants: e.target.value })} /></Field>
      </div>
      <Field label="Focus"><input type="text" className="placement-input" aria-label="Review focus" value={draft.focus} onChange={(e) => setDraft({ ...draft, focus: e.target.value })} /></Field>
      <Field label="Questions I want answered"><textarea className="placement-input" rows={2} aria-label="Review questions" value={draft.questions} onChange={(e) => setDraft({ ...draft, questions: e.target.value })} /></Field>
      <Field label="My notes (private — never exported)"><textarea className="placement-input" rows={2} aria-label="Private notes" value={draft.learnerNotes} onChange={(e) => setDraft({ ...draft, learnerNotes: e.target.value })} /></Field>
      <Field label="Provider judgement, if any (as said, with its source)">
        <textarea className="placement-input" rows={2} aria-label="Provider judgement" value={draft.judgement} onChange={(e) => setDraft({ ...draft, judgement: e.target.value })} />
        <input type="text" className="placement-input" aria-label="Judgement source" placeholder="Source (who, where, when)" value={draft.source} onChange={(e) => setDraft({ ...draft, source: e.target.value })} />
      </Field>
      <Field label="Next steps"><textarea className="placement-input" rows={2} aria-label="Next steps" value={draft.nextSteps} onChange={(e) => setDraft({ ...draft, nextSteps: e.target.value })} /></Field>
      <Field label="Pack discussed">
        <select className="date-input" aria-label="Pack discussed" value={draft.packId} onChange={(e) => setDraft({ ...draft, packId: e.target.value })}>
          <option value="">None</option>
          {admin.reviewPacks.map((p) => (
            <option key={p.id} value={p.id}>{p.title}</option>
          ))}
        </select>
      </Field>
      <div className="btn-row">
        <button
          type="button"
          className="btn-primary"
          disabled={!draft.dateISO || (!!draft.judgement.trim() && !draft.source.trim())}
          onClick={() => {
            const rec: ReviewRecordRec = { id: newAdminId(), dateISO: draft.dateISO, at: Date.now() }
            for (const k of ['participants', 'focus', 'questions', 'learnerNotes', 'nextSteps', 'packId'] as const) if (draft[k].trim()) rec[k] = draft[k].trim()
            if (draft.judgement.trim()) rec.providerJudgement = { text: draft.judgement.trim(), source: draft.source.trim() }
            onUpdateAdmin((prev) => ({ ...prev, reviews: [...prev.reviews, rec] }))
            setDraft({ dateISO: todayISO, participants: '', focus: '', questions: '', learnerNotes: '', judgement: '', source: '', nextSteps: '', packId: '' })
          }}
        >
          Save review
        </button>
      </div>
      {draft.judgement.trim() && !draft.source.trim() && <p className="filter-hint">A provider judgement needs its source before it can be saved.</p>}
      {reviews.length > 0 && (
        <ul className="workspace-list" aria-label="Reviews">
          {reviews.map((r) => (
            <li key={r.id} className="workspace-row requirement-row">
              <span>
                <strong>{fmt(r.dateISO)}</strong>{r.focus ? ` · ${r.focus}` : ''}{r.participants ? <span className="filter-hint"> · with {r.participants}</span> : null}
                {r.providerJudgement && <p className="filter-hint">Provider view (source: {r.providerJudgement.source}): {r.providerJudgement.text}</p>}
                {r.nextSteps && <p className="filter-hint">Next: {r.nextSteps}</p>}
                {r.learnerNotes && <p className="filter-hint">Private notes kept (not in any export)</p>}
              </span>
            </li>
          ))}
        </ul>
      )}
      <h3 className="subheading">First-post handover pack (optional)</h3>
      <p className="filter-hint">Built from your evidence examples, experience by layer and review next steps. Private notes, contacts, addresses and identifiers are left out. It is prepared by you; nothing here implies an induction body has received it.</p>
      <div className="btn-row">
        <button type="button" className="btn-today-reset" onClick={() => setShowHandover((v) => !v)}>{showHandover ? 'Hide preview' : 'Preview handover pack'}</button>
        <button type="button" className="btn-primary" onClick={() => downloadFile('handover-pack.txt', handover(), 'text/plain')}>Export handover text</button>
      </div>
      {showHandover && <pre className="plan-pre pack-preview-text" aria-label="Handover preview">{handover()}</pre>}
    </Dialog>
  )
}
