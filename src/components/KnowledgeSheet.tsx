import { useState } from 'react'
import { Dialog, Field, FieldGroup, IconClose } from './ui'
import { newAdminId } from '../lib/admin'
import type { AdminFile, KnowledgeGoalRec, ResourceRec } from '../lib/admin'

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
const LEVEL_LABEL: Record<number, string> = { 1: 'not yet confident', 2: 'a little', 3: 'getting there', 4: 'confident', 5: 'could teach it' }

/**
 * Subject knowledge (PG-04, G2): goals in the learner's own words — a topic
 * (from the programme pack's curriculum sections when a pack carries them),
 * the question they want to answer, dated self-ratings of confidence,
 * resources shared across goals, an application opportunity (a lesson) and a
 * next review. A subject-audit "secure" entry can become a goal that reads
 * "Previously marked secure by you (date)" — never assessed mastery.
 */
export function KnowledgeSheet({ admin, todayISO, onUpdateAdmin, onClose }: Props) {
  const [topic, setTopic] = useState('')
  const [strand, setStrand] = useState<'breadth' | 'depth'>('breadth')
  const [question, setQuestion] = useState('')
  const [rating, setRating] = useState<Record<string, { level: string; note: string }>>({})
  const [newResource, setNewResource] = useState<Record<string, { title: string; url: string }>>({})
  const topics = [...new Set(admin.requirements.filter((r) => /curricul|subject|knowledge/i.test(r.section)).map((r) => r.title))]
  const goals = [...admin.goals].sort((a, b) => (a.state === b.state ? b.at - a.at : a.state === 'open' ? -1 : b.state === 'open' ? 1 : a.state === 'parked' ? -1 : 1))
  const setGoal = (id: string, patch: Partial<KnowledgeGoalRec>) => onUpdateAdmin((prev) => ({ ...prev, goals: prev.goals.map((g) => (g.id === id ? { ...g, ...patch, at: Date.now() } : g)) }))
  const unconverted = admin.audits.filter((a) => a.stage === 'secure' && !admin.goals.some((g) => g.legacyAuditId === a.id))

  return (
    <Dialog label="Subject knowledge" onClose={onClose} className="sheet-knowledge">
      <div className="sheet-header">
        <h2>Subject knowledge</h2>
        <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}><IconClose /></button>
      </div>
      <p className="filter-hint">What you want to know better, in your words. Confidence is your own dated rating — nothing here is assessed.</p>
      <Field label="New goal">
        <input type="text" className="placement-input" aria-label="Topic" placeholder="Topic (e.g. Fractions as division)" list="knowledge-topics" value={topic} onChange={(e) => setTopic(e.target.value)} />
        {topics.length > 0 && (
          <datalist id="knowledge-topics">
            {topics.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
        )}
        <div className="task-edit-row">
          <select className="date-input" aria-label="Strand" value={strand} onChange={(e) => setStrand(e.target.value as 'breadth' | 'depth')}>
            <option value="breadth">Breadth (primary)</option>
            <option value="depth">Depth (secondary)</option>
          </select>
          <input type="text" className="placement-input" aria-label="Your question" placeholder="Your question" value={question} onChange={(e) => setQuestion(e.target.value)} />
        </div>
        <div className="btn-row">
          <button
            type="button"
            className="btn-primary"
            disabled={!topic.trim()}
            onClick={() => {
              const rec: KnowledgeGoalRec = { id: newAdminId(), topic: topic.trim(), strand, state: 'open', confidence: [], resourceRefs: [], at: Date.now() }
              if (question.trim()) rec.question = question.trim()
              onUpdateAdmin((prev) => ({ ...prev, goals: [...prev.goals, rec] }))
              setTopic('')
              setQuestion('')
            }}
          >
            Add goal
          </button>
        </div>
      </Field>

      {unconverted.length > 0 && (
        <section className="filter-section">
          <h3 className="subheading">From your subject audits</h3>
          <ul className="workspace-list" aria-label="Audit entries">
            {unconverted.map((a) => (
              <li key={a.id} className="workspace-row">
                <span>{a.subject} <span className="filter-hint">· previously marked secure by you ({fmt(a.dateISO)})</span></span>
                <button
                  type="button"
                  className="travel-link"
                  onClick={() => onUpdateAdmin((prev) => ({ ...prev, goals: [...prev.goals, { id: newAdminId(), topic: a.subject, state: 'open', question: `Previously marked secure by you (${fmt(a.dateISO)})${a.note ? ` — ${a.note}` : ''}`, legacyAuditId: a.id, confidence: [], resourceRefs: [], at: Date.now() }] }))}
                >
                  Make a goal
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {goals.length === 0 ? (
        <p className="filter-hint">No goals yet.</p>
      ) : (
        <ul className="workspace-list practice-list" aria-label="Knowledge goals">
          {goals.map((g) => {
            const latest = [...(g.confidence ?? [])].sort((a, b) => b.dateISO.localeCompare(a.dateISO))[0]
            const r = rating[g.id] ?? { level: '3', note: '' }
            const nr = newResource[g.id] ?? { title: '', url: '' }
            const lesson = admin.lessons.find((l) => l.id === g.lessonRef)
            return (
              <li key={g.id} className={`practice-cycle goal goal--${g.state}`}>
                <div className="pgce-section-head">
                  <h3>{g.topic}</h3>
                  <span className="tag">{g.strand === 'depth' ? 'Depth' : 'Breadth'}</span>
                  <span className={`tag${g.state === 'open' ? ' tag--teal' : ''}`}>{g.state === 'open' ? 'Open' : g.state === 'parked' ? 'Parked' : 'Done'}</span>
                </div>
                {g.question && <p className="filter-hint">{g.question}</p>}
                <p className="filter-hint">
                  {latest ? `Self-rated ${latest.level}/5 (${LEVEL_LABEL[latest.level]}) on ${fmt(latest.dateISO)}` : 'No confidence rating yet'}
                  {(g.confidence ?? []).length > 1 ? ` · ${(g.confidence ?? []).length} ratings` : ''}
                  {g.nextReviewISO ? ` · next review ${fmt(g.nextReviewISO)}` : ''}
                  {lesson ? ` · apply in ${lesson.subject || 'lesson'} (${fmt(lesson.dateISO)})` : ''}
                </p>
                {g.state === 'open' && (
                  <>
                    <div className="task-edit-row">
                      <Field label="Confidence today">
                        <select className="date-input" aria-label={`Confidence: ${g.topic}`} value={r.level} onChange={(e) => setRating({ ...rating, [g.id]: { ...r, level: e.target.value } })}>
                          {[1, 2, 3, 4, 5].map((n) => (
                            <option key={n} value={n}>{n} · {LEVEL_LABEL[n]}</option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Note"><input type="text" className="placement-input" value={r.note} onChange={(e) => setRating({ ...rating, [g.id]: { ...r, note: e.target.value } })} /></Field>
                      <button type="button" className="btn-today-reset" onClick={() => { const entry = { dateISO: todayISO, level: Number(r.level) as 1 | 2 | 3 | 4 | 5, ...(r.note.trim() ? { note: r.note.trim() } : {}) }; setGoal(g.id, { confidence: [...(g.confidence ?? []), entry] }); setRating({ ...rating, [g.id]: { level: r.level, note: '' } }) }}>Rate</button>
                    </div>
                    <div className="task-edit-row">
                      <Field label="Apply in a lesson">
                        <select className="date-input" aria-label={`Apply in lesson: ${g.topic}`} value={g.lessonRef ?? ''} onChange={(e) => setGoal(g.id, { lessonRef: e.target.value || undefined })}>
                          <option value="">Not chosen</option>
                          {admin.lessons.map((l) => (
                            <option key={l.id} value={l.id}>{fmt(l.dateISO)} · {l.subject || 'Lesson'}</option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Next review"><input type="date" className="date-input" aria-label={`Next review: ${g.topic}`} value={g.nextReviewISO ?? ''} onChange={(e) => setGoal(g.id, { nextReviewISO: e.target.value || undefined })} /></Field>
                    </div>
                    <FieldGroup label="Resources (one resource can serve many goals)">
                      {(g.resourceRefs ?? []).length > 0 && (
                        <ul className="workspace-list" aria-label={`Resources: ${g.topic}`}>
                          {(g.resourceRefs ?? []).map((id) => {
                            const res = admin.resources.find((x) => x.id === id)
                            return (
                              <li key={id} className="workspace-row">
                                <span>{res ? (res.url ? <a href={res.url} target="_blank" rel="noopener noreferrer">{res.title}</a> : res.title) : 'Resource removed'}</span>
                                <button type="button" className="travel-link" onClick={() => setGoal(g.id, { resourceRefs: (g.resourceRefs ?? []).filter((x) => x !== id) })}>Unlink</button>
                              </li>
                            )
                          })}
                        </ul>
                      )}
                      <div className="task-edit-row">
                        <select className="date-input" aria-label={`Link resource: ${g.topic}`} value="" onChange={(e) => { if (e.target.value) setGoal(g.id, { resourceRefs: [...new Set([...(g.resourceRefs ?? []), e.target.value])] }) }}>
                          <option value="">Link an existing resource…</option>
                          {admin.resources.filter((x) => !(g.resourceRefs ?? []).includes(x.id)).map((x) => (
                            <option key={x.id} value={x.id}>{x.title}</option>
                          ))}
                        </select>
                      </div>
                      <div className="task-edit-row">
                        <input type="text" className="placement-input" aria-label={`New resource title: ${g.topic}`} placeholder="New resource title" value={nr.title} onChange={(e) => setNewResource({ ...newResource, [g.id]: { ...nr, title: e.target.value } })} />
                        <input type="url" className="placement-input" aria-label={`New resource link: ${g.topic}`} placeholder="https:// (optional)" value={nr.url} onChange={(e) => setNewResource({ ...newResource, [g.id]: { ...nr, url: e.target.value } })} />
                        <button
                          type="button"
                          className="btn-today-reset"
                          disabled={!nr.title.trim()}
                          onClick={() => {
                            const res: ResourceRec = { id: newAdminId(), title: nr.title.trim(), at: Date.now() }
                            if (/^https?:\/\//.test(nr.url.trim())) res.url = nr.url.trim()
                            onUpdateAdmin((prev) => ({ ...prev, resources: [...prev.resources, res], goals: prev.goals.map((x) => (x.id === g.id ? { ...x, resourceRefs: [...(x.resourceRefs ?? []), res.id], at: Date.now() } : x)) }))
                            setNewResource({ ...newResource, [g.id]: { title: '', url: '' } })
                          }}
                        >
                          Add resource
                        </button>
                      </div>
                    </FieldGroup>
                  </>
                )}
                <div className="btn-row">
                  {g.state === 'open' ? (
                    <>
                      <button type="button" className="btn-today-reset" onClick={() => setGoal(g.id, { state: 'parked' })}>Park</button>
                      <button type="button" className="btn-today-reset" onClick={() => setGoal(g.id, { state: 'done' })}>Mark done (your call)</button>
                    </>
                  ) : (
                    <button type="button" className="btn-today-reset" onClick={() => setGoal(g.id, { state: 'open' })}>Reopen</button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </Dialog>
  )
}
