import { useEffect, useState } from 'react'
import { Dialog, Field, IconClose } from './ui'
import { newAdminId } from '../lib/admin'
import type { AcademicProjectRec, AdminFile, ProjectStatus, ReadingNoteRec } from '../lib/admin'
import { sessionKey } from '../lib/diff'
import { getWalletFiles } from '../lib/wallet'
import { attachmentUid } from '../lib/attachments'
import type { Session } from '../types'

interface Props {
  admin: AdminFile
  /** key dates from the timetable (deadlines are references to these, never copies) */
  keyDates: Session[]
  todayISO: string
  /** E03: the wallet owner, so drafts and receipts can be picked by their stable uid */
  profileId: string
  onUpdateAdmin: (updater: (prev: AdminFile) => AdminFile) => void
  onClose: () => void
}

const STATUS_LABEL: Record<ProjectStatus, string> = { draft: 'Draft', ready: 'Ready', submitted: 'Submitted (you confirmed)', feedback: 'Feedback received', result: 'Result recorded' }
const CHANNELS = ['Turnitin', 'Moodle', 'Email', 'In person', 'Other']
const fmt = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}
const fmtAt = (ms: number) => new Date(ms).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
type WalletEntry = { uid: string; name: string }

/**
 * Academic workspace (PG-05, G2; E03, Pass 84): each assignment or enquiry as
 * a project — brief, provider criteria, a deadline that REFERENCES an existing
 * key date, optional words/credits (no award arithmetic), milestones as
 * ordinary tasks, reading notes by kind — and now the rest of the workflow:
 * a versioned outline, draft references (a wallet file by stable uid, or a
 * link), a submission history with a learner-recorded receipt (never
 * institution-verified; a resubmission APPENDS), feedback references and the
 * learner's own source list. Status moves only on the learner's confirmation;
 * recording a submission never completes any task; nothing here generates a
 * citation or awards anything.
 */
export function AcademicSheet({ admin, keyDates, todayISO, profileId, onUpdateAdmin, onClose }: Props) {
  const [title, setTitle] = useState('')
  const [deadlineRef, setDeadlineRef] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(admin.projects.find((p) => p.status !== 'result')?.id ?? admin.projects[0]?.id ?? null)
  const [confirmSubmit, setConfirmSubmit] = useState(false)
  const [outcome, setOutcome] = useState({ text: '', source: '' })
  const [note, setNote] = useState<{ kind: ReadingNoteRec['kind']; source: string; page: string; text: string }>({ kind: 'paraphrase', source: '', page: '', text: '' })
  const [milestone, setMilestone] = useState({ title: '', dueISO: '' })
  const [section, setSection] = useState('')
  const [draft, setDraft] = useState({ kind: 'wallet' as 'wallet' | 'link', uid: '', url: '', label: '' })
  const [submission, setSubmission] = useState({ channel: CHANNELS[0], receiptUid: '', note: '', confirm: false })
  const [fb, setFb] = useState({ kind: 'text' as 'text' | 'link' | 'wallet', text: '', url: '', uid: '', source: '' })
  const [source, setSource] = useState({ title: '', author: '', url: '', note: '' })
  const [wallet, setWallet] = useState<WalletEntry[] | null>(null)
  useEffect(() => {
    let live = true
    void getWalletFiles(profileId)
      .then(async (files) => Promise.all(files.map(async (f) => ({ uid: await attachmentUid(f), name: f.name }))))
      .then((list) => { if (live) setWallet(list) })
      .catch(() => { if (live) setWallet([]) })
    return () => { live = false }
  }, [profileId])
  const walletName = (uid?: string) => (uid ? wallet?.find((w) => w.uid === uid)?.name ?? null : null)
  const fileState = (uid?: string) => (!uid ? null : wallet === null ? 'checking' : walletName(uid) ? 'present' : 'missing')

  const project = admin.projects.find((p) => p.id === selectedId) ?? null
  const setProject = (id: string, patch: Partial<AcademicProjectRec>) => onUpdateAdmin((prev) => ({ ...prev, projects: prev.projects.map((p) => (p.id === id ? { ...p, ...patch, at: Date.now() } : p)) }))
  const deadlines = keyDates.filter((k) => k.isKeyDate && !k.id.startsWith('custom-') && !k.id.startsWith('hw-'))
  const deadlineOf = (p: AcademicProjectRec) => (p.deadlineRef ? deadlines.find((k) => sessionKey(k) === p.deadlineRef) ?? null : null)
  const stageOf = (p: AcademicProjectRec) => {
    if (p.status === 'result') return 'Result recorded'
    if (p.status === 'feedback' || (p.feedbackRefs ?? []).length) return 'Feedback'
    if ((p.submissions ?? []).length || p.status === 'submitted') return 'Submitted'
    if ((p.drafts ?? []).length) return 'Drafting'
    if ((p.outline ?? []).length) return 'Outline'
    if (admin.readings.some((n) => n.projectId === p.id) || (p.sources ?? []).length) return 'Reading'
    if (p.brief) return 'Question'
    return 'Brief'
  }

  return (
    <Dialog label="Academic work" onClose={onClose} className="sheet-academic">
      <div className="sheet-header">
        <h2>Academic work</h2>
        <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}><IconClose /></button>
      </div>
      <Field label="New project">
        <input type="text" className="placement-input" aria-label="Project title" placeholder="e.g. Assignment 1 — Reflective account" value={title} onChange={(e) => setTitle(e.target.value)} />
        <div className="task-edit-row">
          <select className="date-input" aria-label="Deadline (key date)" value={deadlineRef} onChange={(e) => setDeadlineRef(e.target.value)}>
            <option value="">Deadline: none linked</option>
            {deadlines.map((k) => (
              <option key={sessionKey(k)} value={sessionKey(k)}>{fmt(k.dateISO)} · {k.title}</option>
            ))}
          </select>
          <button
            type="button"
            className="btn-primary"
            disabled={!title.trim()}
            onClick={() => {
              const rec: AcademicProjectRec = { id: newAdminId(), title: title.trim(), status: 'draft', at: Date.now() }
              if (deadlineRef) rec.deadlineRef = deadlineRef
              onUpdateAdmin((prev) => ({ ...prev, projects: [...prev.projects, rec] }))
              setSelectedId(rec.id)
              setTitle('')
              setDeadlineRef('')
            }}
          >
            Add project
          </button>
        </div>
      </Field>
      {admin.projects.length > 0 && (
        <ul className="workspace-list" aria-label="Projects">
          {admin.projects.map((p) => {
            const d = deadlineOf(p)
            return (
              <li key={p.id}>
                <button type="button" className="workspace-row" aria-current={p.id === selectedId ? 'true' : undefined} onClick={() => setSelectedId(p.id)}>
                  <span>{p.title}{d ? <span className="filter-hint"> · due {fmt(d.dateISO)}</span> : p.deadlineRef ? <span className="filter-hint"> · deadline reference no longer in the timetable</span> : null}</span>
                  <span className="tag">{STATUS_LABEL[p.status]}</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
      {project && (
        <section className="prep-editor" aria-label={`Project: ${project.title}`}>
          <h3 className="subheading">{project.title} · {STATUS_LABEL[project.status]}</h3>
          {(() => {
            const d = deadlineOf(project)
            const nextTask = admin.tasks.filter((t) => t.projectId === project.id && t.status !== 'done').sort((a, b) => a.dueISO.localeCompare(b.dueISO))[0]
            return (
              <dl className="kv workload-summary assignment-summary" aria-label="Assignment summary">
                <div><dt>Due</dt><dd>{d ? `${fmt(d.dateISO)}${d.start ? ` ${d.start}` : ''} · ${d.title} (from your key dates)` : project.deadlineRef ? 'deadline reference no longer in the timetable' : 'no deadline linked'}</dd></div>
                <div><dt>Words</dt><dd>{project.words ? `${project.words} target (yours)` : 'no target set'}</dd></div>
                <div><dt>Stage</dt><dd>{stageOf(project)}</dd></div>
                <div><dt>Sources</dt><dd>{(project.sources ?? []).length} listed · {admin.readings.filter((n) => n.projectId === project.id).length} reading notes</dd></div>
                <div><dt>Next task</dt><dd>{nextTask ? `${nextTask.title} · due ${fmt(nextTask.dueISO)}` : 'none open'}</dd></div>
                <div><dt>Submission</dt><dd>{(project.submissions ?? []).length ? `${(project.submissions ?? []).length} recorded by you — not institution-verified` : 'not recorded'}</dd></div>
              </dl>
            )
          })()}
          <Field label="Deadline (key date)">
            <select className="date-input" aria-label="Change deadline" value={project.deadlineRef ?? ''} onChange={(e) => setProject(project.id, { deadlineRef: e.target.value || undefined })}>
              <option value="">None linked</option>
              {deadlines.map((k) => (
                <option key={sessionKey(k)} value={sessionKey(k)}>{fmt(k.dateISO)} · {k.title}</option>
              ))}
            </select>
            <span className="filter-hint">A reference to your key dates — changing it never adds a second pin to the Schedule.</span>
          </Field>
          <Field label="Brief"><textarea className="placement-input" rows={2} value={project.brief ?? ''} onChange={(e) => setProject(project.id, { brief: e.target.value })} /></Field>
          <Field label="Provider criteria"><textarea className="placement-input" rows={2} value={project.criteria ?? ''} onChange={(e) => setProject(project.id, { criteria: e.target.value })} /></Field>
          <div className="task-edit-row">
            <Field label="Words (optional)"><input type="number" className="date-input" min={0} aria-label="Words" value={project.words ?? ''} onChange={(e) => setProject(project.id, { words: e.target.value === '' ? undefined : Math.max(0, parseInt(e.target.value, 10) || 0) })} /></Field>
            <Field label="Credits (optional)"><input type="number" className="date-input" min={0} aria-label="Credits" value={project.credits ?? ''} onChange={(e) => setProject(project.id, { credits: e.target.value === '' ? undefined : Math.max(0, parseInt(e.target.value, 10) || 0) })} /></Field>
          </div>

          <h3 className="subheading">Outline{project.outlineRevision ? <span className="filter-hint"> · revision {project.outlineRevision}</span> : null}</h3>
          {(project.outline ?? []).length ? (
            <ul className="workspace-list" aria-label="Outline">
              {(project.outline ?? []).map((o, i) => (
                <li key={o.id} className="workspace-row requirement-row">
                  <label className="cycle-obs">
                    <input type="checkbox" checked={!!o.done} aria-label={`Section drafted: ${o.title}`} onChange={(e) => setProject(project.id, { outline: (project.outline ?? []).map((x) => (x.id === o.id ? { ...x, done: e.target.checked } : x)), outlineRevision: (project.outlineRevision ?? 0) + 1, outlineAt: Date.now() })} />
                    <span>{i + 1}. {o.title}</span>
                  </label>
                  <button type="button" className="travel-link" onClick={() => setProject(project.id, { outline: (project.outline ?? []).filter((x) => x.id !== o.id), outlineRevision: (project.outlineRevision ?? 0) + 1, outlineAt: Date.now() })}>Remove</button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="filter-hint">No outline yet — add the sections you intend to write.</p>
          )}
          <div className="task-edit-row">
            <input type="text" className="placement-input" aria-label="Outline section" placeholder="Section title" value={section} onChange={(e) => setSection(e.target.value)} />
            <button type="button" className="btn-today-reset" disabled={!section.trim()} onClick={() => { setProject(project.id, { outline: [...(project.outline ?? []), { id: newAdminId(), title: section.trim() }], outlineRevision: (project.outlineRevision ?? 0) + 1, outlineAt: Date.now() }); setSection('') }}>Add section</button>
          </div>

          <h3 className="subheading">Drafts</h3>
          {(project.drafts ?? []).length ? (
            <ul className="workspace-list" aria-label="Drafts">
              {(project.drafts ?? []).map((d) => (
                <li key={d.id} className="workspace-row requirement-row">
                  <span>
                    {d.kind === 'link' ? <a href={d.url} target="_blank" rel="noreferrer">{d.label}</a> : <>{d.label}<span className="filter-hint"> · {walletName(d.uid) ?? 'document'}</span></>}
                    {d.kind === 'wallet' ? <span className={`tag${fileState(d.uid) === 'missing' ? ' tag--amber' : ''}`}> {fileState(d.uid) === 'missing' ? 'Missing on this device' : fileState(d.uid) === 'present' ? 'In your wallet' : 'Checking…'}</span> : null}
                  </span>
                  <button type="button" className="travel-link" onClick={() => setProject(project.id, { drafts: (project.drafts ?? []).filter((x) => x.id !== d.id) })}>Remove</button>
                </li>
              ))}
            </ul>
          ) : null}
          <div className="task-edit-row">
            <select className="date-input" aria-label="Draft kind" value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as 'wallet' | 'link' })}>
              <option value="wallet">Wallet document</option>
              <option value="link">Link</option>
            </select>
            {draft.kind === 'wallet' ? (
              <select className="date-input" aria-label="Draft document" value={draft.uid} onChange={(e) => setDraft({ ...draft, uid: e.target.value })}>
                <option value="">{wallet === null ? 'Loading wallet…' : wallet.length ? 'Choose a document' : 'No documents in your wallet yet'}</option>
                {(wallet ?? []).map((w) => (
                  <option key={w.uid} value={w.uid}>{w.name}</option>
                ))}
              </select>
            ) : (
              <input type="url" className="placement-input" aria-label="Draft link" placeholder="https://…" value={draft.url} onChange={(e) => setDraft({ ...draft, url: e.target.value })} />
            )}
            <input type="text" className="placement-input" aria-label="Draft label" placeholder="Label (e.g. Draft 2)" value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} />
            <button type="button" className="btn-today-reset" disabled={!draft.label.trim() || (draft.kind === 'wallet' ? !draft.uid : !/^https?:\/\//.test(draft.url))} onClick={() => { const rec = { id: newAdminId(), kind: draft.kind, label: draft.label.trim(), at: Date.now(), ...(draft.kind === 'wallet' ? { uid: draft.uid } : { url: draft.url.trim() }) }; setProject(project.id, { drafts: [...(project.drafts ?? []), rec] }); setDraft({ kind: draft.kind, uid: '', url: '', label: '' }) }}>Add draft</button>
          </div>

          <h3 className="subheading">Status</h3>
          <div className="btn-row">
            {project.status === 'draft' && <button type="button" className="btn-primary" onClick={() => setProject(project.id, { status: 'ready' })}>Ready to submit</button>}
            {project.status === 'ready' && (
              <>
                <label className="toggle-row"><input type="checkbox" checked={confirmSubmit} onChange={(e) => setConfirmSubmit(e.target.checked)} /> I submitted this myself</label>
                <button type="button" className="btn-primary" disabled={!confirmSubmit} onClick={() => { setProject(project.id, { status: 'submitted', submittedISO: todayISO }); setConfirmSubmit(false) }}>Mark submitted</button>
                <button type="button" className="btn-today-reset" onClick={() => setProject(project.id, { status: 'draft' })}>Back to draft</button>
              </>
            )}
            {(project.status === 'submitted' || project.status === 'feedback') && (
              <Field label={project.status === 'submitted' ? 'Feedback received (text and who it came from)' : 'Result (as written by its source — a label, not an award)'}>
                <textarea className="placement-input" rows={2} aria-label={project.status === 'submitted' ? 'Feedback text' : 'Result text'} value={outcome.text} onChange={(e) => setOutcome({ ...outcome, text: e.target.value })} />
                <input type="text" className="placement-input" aria-label="Source" placeholder="Source (e.g. tutor email, 12 Jan)" value={outcome.source} onChange={(e) => setOutcome({ ...outcome, source: e.target.value })} />
                <div className="btn-row">
                  <button type="button" className="btn-primary" disabled={!outcome.text.trim() || !outcome.source.trim()} onClick={() => { setProject(project.id, project.status === 'submitted' ? { status: 'feedback', feedback: { text: outcome.text.trim(), source: outcome.source.trim() } } : { status: 'result', result: { text: outcome.text.trim(), source: outcome.source.trim() } }); setOutcome({ text: '', source: '' }) }}>
                    {project.status === 'submitted' ? 'Record feedback' : 'Record result'}
                  </button>
                </div>
              </Field>
            )}
          </div>
          {project.submittedISO && <p className="filter-hint">Submitted {fmt(project.submittedISO)} — recorded on your confirmation.</p>}
          {project.feedback && <p className="filter-hint"><strong>Feedback</strong> ({project.feedback.source}): {project.feedback.text}</p>}
          {project.result && <p className="filter-hint"><strong>Result</strong> ({project.result.source}): {project.result.text} — recorded by you from that source; nothing here awards anything.</p>}

          <h3 className="subheading">Submission record</h3>
          <p className="filter-hint">Learner-recorded, never institution-verified. A resubmission adds to the history below; nothing here completes your tasks for you.</p>
          {(project.submissions ?? []).length ? (
            <ol className="workspace-list" aria-label="Submission history">
              {[...(project.submissions ?? [])].sort((a, b) => a.submittedAt - b.submittedAt).map((s, i) => (
                <li key={s.id} className="workspace-row requirement-row">
                  <span>
                    <strong>{i === 0 ? 'Submitted' : `Resubmitted (${i + 1})`}</strong> {fmtAt(s.submittedAt)} · {s.channel}{s.note ? ` · ${s.note}` : ''}
                    {s.receiptUid ? <span className={`tag${fileState(s.receiptUid) === 'missing' ? ' tag--amber' : ''}`}> receipt: {fileState(s.receiptUid) === 'missing' ? 'missing on this device' : fileState(s.receiptUid) === 'present' ? walletName(s.receiptUid) : 'checking…'}</span> : <span className="tag"> no receipt</span>}
                  </span>
                </li>
              ))}
            </ol>
          ) : null}
          <div className="task-edit-row">
            <select className="date-input" aria-label="Submission channel" value={submission.channel} onChange={(e) => setSubmission({ ...submission, channel: e.target.value })}>
              {CHANNELS.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <select className="date-input" aria-label="Receipt document" value={submission.receiptUid} onChange={(e) => setSubmission({ ...submission, receiptUid: e.target.value })}>
              <option value="">No receipt file</option>
              {(wallet ?? []).map((w) => (
                <option key={w.uid} value={w.uid}>{w.name}</option>
              ))}
            </select>
            <input type="text" className="placement-input" aria-label="Submission note" placeholder="Note (e.g. receipt number)" value={submission.note} onChange={(e) => setSubmission({ ...submission, note: e.target.value })} />
          </div>
          <div className="btn-row">
            <label className="toggle-row"><input type="checkbox" checked={submission.confirm} onChange={(e) => setSubmission({ ...submission, confirm: e.target.checked })} /> I made this submission myself</label>
            <button
              type="button"
              className="btn-primary"
              disabled={!submission.confirm}
              onClick={() => {
                const rec = { id: newAdminId(), submittedAt: Date.now(), channel: submission.channel, ...(submission.receiptUid ? { receiptUid: submission.receiptUid } : {}), ...(submission.note.trim() ? { note: submission.note.trim() } : {}) }
                const patch: Partial<AcademicProjectRec> = { submissions: [...(project.submissions ?? []), rec] }
                if (project.status === 'draft' || project.status === 'ready') {
                  patch.status = 'submitted'
                  patch.submittedISO = todayISO
                }
                setProject(project.id, patch)
                setSubmission({ channel: submission.channel, receiptUid: '', note: '', confirm: false })
              }}
            >
              {(project.submissions ?? []).length ? 'Record resubmission' : 'Record submission'}
            </button>
          </div>

          <h3 className="subheading">Feedback references</h3>
          {(project.feedbackRefs ?? []).length ? (
            <ul className="workspace-list" aria-label="Feedback references">
              {(project.feedbackRefs ?? []).map((f) => (
                <li key={f.id} className="workspace-row requirement-row">
                  <span>{f.kind === 'text' ? f.text : f.kind === 'link' ? <a href={f.url} target="_blank" rel="noreferrer">{f.url}</a> : walletName(f.uid) ?? 'document'}<span className="filter-hint"> — {f.source}</span>{f.kind === 'wallet' && fileState(f.uid) === 'missing' ? <span className="tag tag--amber"> missing on this device</span> : null}</span>
                  <button type="button" className="travel-link" onClick={() => setProject(project.id, { feedbackRefs: (project.feedbackRefs ?? []).filter((x) => x.id !== f.id) })}>Remove</button>
                </li>
              ))}
            </ul>
          ) : null}
          <div className="task-edit-row">
            <select className="date-input" aria-label="Feedback kind" value={fb.kind} onChange={(e) => setFb({ ...fb, kind: e.target.value as 'text' | 'link' | 'wallet' })}>
              <option value="text">Pasted text</option>
              <option value="link">Link</option>
              <option value="wallet">Wallet document</option>
            </select>
            {fb.kind === 'text' ? <input type="text" className="placement-input" aria-label="Feedback reference text" placeholder="What was said" value={fb.text} onChange={(e) => setFb({ ...fb, text: e.target.value })} /> : fb.kind === 'link' ? <input type="url" className="placement-input" aria-label="Feedback link" placeholder="https://…" value={fb.url} onChange={(e) => setFb({ ...fb, url: e.target.value })} /> : (
              <select className="date-input" aria-label="Feedback document" value={fb.uid} onChange={(e) => setFb({ ...fb, uid: e.target.value })}>
                <option value="">Choose a document</option>
                {(wallet ?? []).map((w) => (
                  <option key={w.uid} value={w.uid}>{w.name}</option>
                ))}
              </select>
            )}
            <input type="text" className="placement-input" aria-label="Feedback source" placeholder="Source (who, when)" value={fb.source} onChange={(e) => setFb({ ...fb, source: e.target.value })} />
            <button type="button" className="btn-today-reset" disabled={!fb.source.trim() || (fb.kind === 'text' ? !fb.text.trim() : fb.kind === 'link' ? !/^https?:\/\//.test(fb.url) : !fb.uid)} onClick={() => { const rec = { id: newAdminId(), kind: fb.kind, source: fb.source.trim(), at: Date.now(), ...(fb.kind === 'text' ? { text: fb.text.trim() } : fb.kind === 'link' ? { url: fb.url.trim() } : { uid: fb.uid }) }; setProject(project.id, { feedbackRefs: [...(project.feedbackRefs ?? []), rec] }); setFb({ kind: fb.kind, text: '', url: '', uid: '', source: '' }) }}>Add feedback</button>
          </div>

          <h3 className="subheading">Sources</h3>
          <p className="filter-hint">Your list, in your words — nothing here is generated or formatted into a citation for you.</p>
          {(project.sources ?? []).length ? (
            <ul className="workspace-list" aria-label="Sources">
              {(project.sources ?? []).map((s) => (
                <li key={s.id} className="workspace-row requirement-row">
                  <span><strong>{s.title}</strong>{s.author ? ` — ${s.author}` : ''}{s.url ? <> · <a href={s.url} target="_blank" rel="noreferrer">link</a></> : null}{s.note ? <span className="filter-hint"> · {s.note}</span> : null}</span>
                  <button type="button" className="travel-link" onClick={() => setProject(project.id, { sources: (project.sources ?? []).filter((x) => x.id !== s.id) })}>Remove</button>
                </li>
              ))}
            </ul>
          ) : null}
          <div className="task-edit-row">
            <input type="text" className="placement-input" aria-label="Source title" placeholder="Title" value={source.title} onChange={(e) => setSource({ ...source, title: e.target.value })} />
            <input type="text" className="placement-input" aria-label="Source author" placeholder="Author (optional)" value={source.author} onChange={(e) => setSource({ ...source, author: e.target.value })} />
            <input type="url" className="placement-input" aria-label="Source link" placeholder="https://… (optional)" value={source.url} onChange={(e) => setSource({ ...source, url: e.target.value })} />
            <input type="text" className="placement-input" aria-label="Source note" placeholder="Your note (optional)" value={source.note} onChange={(e) => setSource({ ...source, note: e.target.value })} />
            <button type="button" className="btn-today-reset" disabled={!source.title.trim()} onClick={() => { const rec = { id: newAdminId(), title: source.title.trim(), at: Date.now(), ...(source.author.trim() ? { author: source.author.trim() } : {}), ...(source.url.trim() ? { url: source.url.trim() } : {}), ...(source.note.trim() ? { note: source.note.trim() } : {}) }; setProject(project.id, { sources: [...(project.sources ?? []), rec] }); setSource({ title: '', author: '', url: '', note: '' }) }}>Add source</button>
          </div>

          <h3 className="subheading">Milestones (tasks)</h3>
          {(() => {
            const mine = admin.tasks.filter((t) => t.projectId === project.id).sort((a, b) => a.dueISO.localeCompare(b.dueISO))
            return mine.length === 0 ? <p className="filter-hint">No milestones yet — they are ordinary tasks and appear on Tasks and in the workload planner.</p> : (
              <ul className="workspace-list" aria-label="Milestones">
                {mine.map((t) => (
                  <li key={t.id} className="workspace-row"><span>{fmt(t.dueISO)} · {t.title}</span><span className="tag">{t.status}</span></li>
                ))}
              </ul>
            )
          })()}
          <div className="task-edit-row">
            <input type="text" className="placement-input" aria-label="Milestone title" placeholder="Milestone" value={milestone.title} onChange={(e) => setMilestone({ ...milestone, title: e.target.value })} />
            <input type="date" className="date-input" aria-label="Milestone due" value={milestone.dueISO} onChange={(e) => setMilestone({ ...milestone, dueISO: e.target.value })} />
            <button type="button" className="btn-today-reset" disabled={!milestone.title.trim() || !milestone.dueISO} onClick={() => { onUpdateAdmin((prev) => ({ ...prev, tasks: [...prev.tasks, { id: newAdminId(), title: milestone.title.trim(), dueISO: milestone.dueISO, status: 'todo', projectId: project.id, at: Date.now() }] })); setMilestone({ title: '', dueISO: '' }) }}>Add milestone</button>
          </div>

          <h3 className="subheading">Reading notes</h3>
          {(() => {
            const notes = admin.readings.filter((n) => n.projectId === project.id).sort((a, b) => b.at - a.at)
            return notes.length === 0 ? <p className="filter-hint">No reading notes yet. Keep quotations, paraphrases and your interpretations apart, each with its source.</p> : (
              <ul className="workspace-list" aria-label="Reading notes">
                {notes.map((n) => (
                  <li key={n.id} className="workspace-row">
                    <span><span className="tag">{n.kind}</span> {n.kind === 'quotation' ? `“${n.text}”` : n.text}<span className="filter-hint"> — {n.source || 'source not given'}{n.page ? `, p.${n.page}` : ''}</span></span>
                    <button type="button" className="travel-link" onClick={() => onUpdateAdmin((prev) => ({ ...prev, readings: prev.readings.filter((x) => x.id !== n.id) }))}>Remove</button>
                  </li>
                ))}
              </ul>
            )
          })()}
          <div className="task-edit-row">
            <select className="date-input" aria-label="Note kind" value={note.kind} onChange={(e) => setNote({ ...note, kind: e.target.value as ReadingNoteRec['kind'] })}>
              <option value="quotation">Quotation</option>
              <option value="paraphrase">Paraphrase</option>
              <option value="interpretation">My interpretation</option>
            </select>
            <input type="text" className="placement-input" aria-label="Note source" placeholder="Source" value={note.source} onChange={(e) => setNote({ ...note, source: e.target.value })} />
            <input type="text" className="placement-input" aria-label="Page" placeholder="Page" value={note.page} onChange={(e) => setNote({ ...note, page: e.target.value })} />
          </div>
          <textarea className="placement-input" rows={2} aria-label="Note text" placeholder="Text" value={note.text} onChange={(e) => setNote({ ...note, text: e.target.value })} />
          <div className="btn-row">
            <button type="button" className="btn-today-reset" disabled={!note.text.trim()} onClick={() => { const rec: ReadingNoteRec = { id: newAdminId(), projectId: project.id, kind: note.kind, text: note.text.trim(), at: Date.now() }; if (note.source.trim()) rec.source = note.source.trim(); if (note.page.trim()) rec.page = note.page.trim(); onUpdateAdmin((prev) => ({ ...prev, readings: [...prev.readings, rec] })); setNote({ ...note, text: '', page: '' }) }}>Add note</button>
          </div>

          <h3 className="subheading">Classroom enquiry — approval planning (recorded, not an approval)</h3>
          {(['context', 'participants', 'consent', 'risks', 'approval'] as const).map((k) => (
            <Field key={k} label={k === 'approval' ? 'Approval status as told to you (and by whom)' : k[0].toUpperCase() + k.slice(1)}>
              <textarea className="placement-input" rows={2} value={project.enquiry?.[k] ?? ''} onChange={(e) => setProject(project.id, { enquiry: { ...(project.enquiry ?? {}), [k]: e.target.value } })} />
            </Field>
          ))}
        </section>
      )}
    </Dialog>
  )
}
