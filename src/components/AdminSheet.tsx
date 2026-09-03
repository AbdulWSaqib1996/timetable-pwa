import { useEffect, useState } from 'react'
import { useModalA11y } from '../lib/a11y'
import type { AdminFile, AuditStage, Lesson, Meeting, Observation, Reflection, TargetItem } from '../lib/admin'
import { mondayOfISO, newAdminId, reflectionStreak } from '../lib/admin'
import { sessionKey } from '../lib/diff'
import { daysUntil, isPlacementSession, placementTag } from '../lib/format'
import { printBinder } from '../lib/printBinder'
import { TEACHERS_STANDARDS } from '../lib/standards'
import { WALLET_FILE_CAP, addWalletFile, deleteWalletFile, getWalletFiles } from '../lib/wallet'
import type { WalletFile } from '../lib/wallet'
import type { MetaMap, Session } from '../types'

interface Props {
  profileId: string
  profileName: string
  admin: AdminFile
  onUpdateAdmin: (updater: (prev: AdminFile) => AdminFile) => void
  /** sessions with the user's filters applied, all dates */
  sessions: Session[]
  metaMap: MetaMap
  keyDates: Session[]
  placementTargetDays?: number
  todayISO: string
  onClose: () => void
}

type Tab = 'overview' | 'reflect' | 'targets' | 'meetings' | 'obs' | 'lessons' | 'audits' | 'wallet'

const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'reflect', label: 'Reflections' },
  { id: 'targets', label: 'Targets' },
  { id: 'meetings', label: 'Meetings' },
  { id: 'obs', label: 'Observations' },
  { id: 'lessons', label: 'Lessons' },
  { id: 'audits', label: 'Audits' },
  { id: 'wallet', label: 'Wallet' },
]

const fmt = (dateISO: string) => {
  const [y, m, d] = dateISO.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

function TSChips({ selected, onToggle }: { selected: string[]; onToggle: (id: string) => void }) {
  return (
    <div className="chip-grid ts-chips">
      {TEACHERS_STANDARDS.map((ts) => (
        <button
          key={ts.id}
          type="button"
          className={`chip chip-small${selected.includes(ts.id) ? ' chip-on' : ''}`}
          aria-pressed={selected.includes(ts.id)}
          title={ts.label}
          onClick={() => onToggle(ts.id)}
        >
          {ts.id}
        </button>
      ))}
    </div>
  )
}

const toggleIn = (list: string[], id: string) =>
  list.includes(id) ? list.filter((x) => x !== id) : [...list, id].sort()

/* ---------- tab components (each owns its add-form state) ---------- */

function ReflectionsTab({ admin, todayISO, onUpdate }: { admin: AdminFile; todayISO: string; onUpdate: Props['onUpdateAdmin'] }) {
  const [week, setWeek] = useState(todayISO)
  const [wentWell, setWentWell] = useState('')
  const [challenges, setChallenges] = useState('')
  const [focus, setFocus] = useState('')
  const [standards, setStandards] = useState<string[]>([])
  const list = [...admin.reflections].sort((a, b) => b.weekISO.localeCompare(a.weekISO))
  return (
    <>
      <p className="filter-hint">
        One entry per week: what went well, what was hard, what to focus on next. Reflections join
        your evidence journal and the binder.
      </p>
      <div className="admin-form">
        <label className="admin-label">
          Week of
          <input type="date" className="date-input" value={week} onChange={(e) => setWeek(e.target.value)} />
        </label>
        <textarea className="note-input" rows={2} placeholder="What went well…" value={wentWell} onChange={(e) => setWentWell(e.target.value)} />
        <textarea className="note-input" rows={2} placeholder="Challenges…" value={challenges} onChange={(e) => setChallenges(e.target.value)} />
        <textarea className="note-input" rows={2} placeholder="Focus for next week…" value={focus} onChange={(e) => setFocus(e.target.value)} />
        <TSChips selected={standards} onToggle={(id) => setStandards((s) => toggleIn(s, id))} />
        <button
          type="button"
          className="btn-primary"
          disabled={!wentWell.trim() && !challenges.trim() && !focus.trim()}
          onClick={() => {
            const entry: Reflection = {
              id: newAdminId(),
              weekISO: mondayOfISO(week || todayISO),
              wentWell: wentWell.trim(),
              challenges: challenges.trim(),
              focus: focus.trim(),
              standards,
              at: Date.now(),
            }
            onUpdate((prev) => ({ ...prev, reflections: [...prev.reflections, entry] }))
            setWentWell('')
            setChallenges('')
            setFocus('')
            setStandards([])
          }}
        >
          Save reflection
        </button>
      </div>
      <ul className="admin-list">
        {list.map((r) => (
          <li key={r.id} className="admin-item">
            <div className="admin-item-head">
              <strong>w/c {fmt(r.weekISO)}</strong>
              <span className="journal-tags">
                {r.standards.map((ts) => (
                  <span className="badge badge-standard" key={ts}>{ts}</span>
                ))}
                <button type="button" className="btn-icon" aria-label="Delete reflection" onClick={() => onUpdate((prev) => ({ ...prev, reflections: prev.reflections.filter((x) => x.id !== r.id) }))}>✕</button>
              </span>
            </div>
            {r.wentWell && <p>👍 {r.wentWell}</p>}
            {r.challenges && <p>⚠ {r.challenges}</p>}
            {r.focus && <p>🎯 {r.focus}</p>}
          </li>
        ))}
      </ul>
    </>
  )
}

function TargetsTab({ admin, todayISO, onUpdate }: { admin: AdminFile; todayISO: string; onUpdate: Props['onUpdateAdmin'] }) {
  const [text, setText] = useState('')
  const [standards, setStandards] = useState<string[]>([])
  const cycle = (t: TargetItem): TargetItem =>
    t.status === 'open'
      ? { ...t, status: 'progress', at: Date.now() }
      : t.status === 'progress'
        ? { ...t, status: 'met', metISO: todayISO, at: Date.now() }
        : { ...t, status: 'open', metISO: undefined, at: Date.now() }
  const list = [...admin.targets].sort((a, b) => (a.status === 'met' ? 1 : 0) - (b.status === 'met' ? 1 : 0) || b.setISO.localeCompare(a.setISO))
  return (
    <>
      <p className="filter-hint">
        Targets set with your mentor. Tap the status to move ○ open → ◐ in progress → ✓ met; met
        targets are evidence.
      </p>
      <div className="admin-form">
        <textarea className="note-input" rows={2} placeholder="e.g. Use cold-calling to check understanding in maths" value={text} onChange={(e) => setText(e.target.value)} />
        <TSChips selected={standards} onToggle={(id) => setStandards((s) => toggleIn(s, id))} />
        <button
          type="button"
          className="btn-primary"
          disabled={!text.trim()}
          onClick={() => {
            const entry: TargetItem = { id: newAdminId(), text: text.trim(), standards, setISO: todayISO, status: 'open', source: 'manual', at: Date.now() }
            onUpdate((prev) => ({ ...prev, targets: [...prev.targets, entry] }))
            setText('')
            setStandards([])
          }}
        >
          Add target
        </button>
      </div>
      <ul className="admin-list">
        {list.map((t) => (
          <li key={t.id} className={`admin-item${t.status === 'met' ? ' done' : ''}`}>
            <div className="admin-item-head">
              <button type="button" className="status-cycle" onClick={() => onUpdate((prev) => ({ ...prev, targets: prev.targets.map((x) => (x.id === t.id ? cycle(x) : x)) }))}>
                {t.status === 'met' ? '✓ met' : t.status === 'progress' ? '◐ in progress' : '○ open'}
              </button>
              <span className="journal-tags">
                {t.standards.map((ts) => (
                  <span className="badge badge-standard" key={ts}>{ts}</span>
                ))}
                <button type="button" className="btn-icon" aria-label="Delete target" onClick={() => onUpdate((prev) => ({ ...prev, targets: prev.targets.filter((x) => x.id !== t.id) }))}>✕</button>
              </span>
            </div>
            <p>{t.text}</p>
            <p className="admin-dates">set {fmt(t.setISO)}{t.metISO ? ` · met ${fmt(t.metISO)}` : ''}{t.source && t.source !== 'manual' ? ` · from ${t.source}` : ''}</p>
          </li>
        ))}
      </ul>
    </>
  )
}

function MeetingsTab({ admin, todayISO, onUpdate }: { admin: AdminFile; todayISO: string; onUpdate: Props['onUpdateAdmin'] }) {
  const [date, setDate] = useState(todayISO)
  const [discussed, setDiscussed] = useState('')
  const [actionsText, setActionsText] = useState('')
  const list = [...admin.meetings].sort((a, b) => b.dateISO.localeCompare(a.dateISO))
  return (
    <>
      <p className="filter-hint">
        A quick record per mentor meeting. Actions (one per line) become tickable to-dos that carry
        forward until done.
      </p>
      <div className="admin-form">
        <label className="admin-label">
          Date
          <input type="date" className="date-input" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <textarea className="note-input" rows={2} placeholder="What was discussed…" value={discussed} onChange={(e) => setDiscussed(e.target.value)} />
        <textarea className="note-input" rows={2} placeholder="Actions agreed (one per line)…" value={actionsText} onChange={(e) => setActionsText(e.target.value)} />
        <button
          type="button"
          className="btn-primary"
          disabled={!discussed.trim() && !actionsText.trim()}
          onClick={() => {
            const entry: Meeting = {
              id: newAdminId(),
              dateISO: date || todayISO,
              discussed: discussed.trim(),
              actions: actionsText.split('\n').map((t) => t.trim()).filter(Boolean).map((text) => ({ id: newAdminId(), text, done: false })),
              at: Date.now(),
            }
            onUpdate((prev) => ({ ...prev, meetings: [...prev.meetings, entry] }))
            setDiscussed('')
            setActionsText('')
          }}
        >
          Log meeting
        </button>
      </div>
      <ul className="admin-list">
        {list.map((m) => (
          <li key={m.id} className="admin-item">
            <div className="admin-item-head">
              <strong>{fmt(m.dateISO)}</strong>
              <button type="button" className="btn-icon" aria-label="Delete meeting" onClick={() => onUpdate((prev) => ({ ...prev, meetings: prev.meetings.filter((x) => x.id !== m.id) }))}>✕</button>
            </div>
            {m.discussed && <p>{m.discussed}</p>}
            {m.actions.map((a) => (
              <label className="toggle-row admin-action" key={a.id}>
                <input
                  type="checkbox"
                  checked={a.done}
                  onChange={(e) =>
                    onUpdate((prev) => ({
                      ...prev,
                      meetings: prev.meetings.map((x) =>
                        x.id === m.id
                          ? { ...x, actions: x.actions.map((y) => (y.id === a.id ? { ...y, done: e.target.checked } : y)), at: Date.now() }
                          : x
                      ),
                    }))
                  }
                />
                <span className={a.done ? 'action-done' : ''}>{a.text}</span>
              </label>
            ))}
          </li>
        ))}
      </ul>
    </>
  )
}

function ObservationsTab({ admin, todayISO, onUpdate }: { admin: AdminFile; todayISO: string; onUpdate: Props['onUpdateAdmin'] }) {
  const [date, setDate] = useState(todayISO)
  const [observer, setObserver] = useState('')
  const [subject, setSubject] = useState('')
  const [focus, setFocus] = useState('')
  const [strengths, setStrengths] = useState('')
  const [development, setDevelopment] = useState('')
  const [makeTarget, setMakeTarget] = useState(true)
  const list = [...admin.observations].sort((a, b) => b.dateISO.localeCompare(a.dateISO))
  return (
    <>
      <p className="filter-hint">
        Formal observations you received. Development points can become targets automatically.
      </p>
      <div className="admin-form">
        <label className="admin-label">
          Date
          <input type="date" className="date-input" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <input type="text" className="placement-input" placeholder="Observer (mentor / tutor)" value={observer} onChange={(e) => setObserver(e.target.value)} />
        <input type="text" className="placement-input" placeholder="Lesson / subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
        <input type="text" className="placement-input" placeholder="Observation focus" value={focus} onChange={(e) => setFocus(e.target.value)} />
        <textarea className="note-input" rows={2} placeholder="Strengths…" value={strengths} onChange={(e) => setStrengths(e.target.value)} />
        <textarea className="note-input" rows={2} placeholder="Development points…" value={development} onChange={(e) => setDevelopment(e.target.value)} />
        <label className="toggle-row">
          <input type="checkbox" checked={makeTarget} onChange={(e) => setMakeTarget(e.target.checked)} />
          Add development points as a target
        </label>
        <button
          type="button"
          className="btn-primary"
          disabled={!subject.trim() && !strengths.trim() && !development.trim()}
          onClick={() => {
            const entry: Observation = { id: newAdminId(), dateISO: date || todayISO, observer: observer.trim(), subject: subject.trim(), focus: focus.trim(), strengths: strengths.trim(), development: development.trim(), at: Date.now() }
            const target: TargetItem | null =
              makeTarget && development.trim()
                ? { id: newAdminId(), text: development.trim(), standards: [], setISO: date || todayISO, status: 'open', source: 'observation', at: Date.now() }
                : null
            onUpdate((prev) => ({
              ...prev,
              observations: [...prev.observations, entry],
              targets: target ? [...prev.targets, target] : prev.targets,
            }))
            setObserver(''); setSubject(''); setFocus(''); setStrengths(''); setDevelopment('')
          }}
        >
          Log observation
        </button>
      </div>
      <ul className="admin-list">
        {list.map((o) => (
          <li key={o.id} className="admin-item">
            <div className="admin-item-head">
              <strong>{fmt(o.dateISO)} · {o.subject || 'Lesson'}</strong>
              <button type="button" className="btn-icon" aria-label="Delete observation" onClick={() => onUpdate((prev) => ({ ...prev, observations: prev.observations.filter((x) => x.id !== o.id) }))}>✕</button>
            </div>
            {o.observer && <p className="admin-dates">observed by {o.observer}{o.focus ? ` · focus: ${o.focus}` : ''}</p>}
            {o.strengths && <p>👍 {o.strengths}</p>}
            {o.development && <p>🎯 {o.development}</p>}
          </li>
        ))}
      </ul>
    </>
  )
}

function LessonsTab({ admin, todayISO, onUpdate }: { admin: AdminFile; todayISO: string; onUpdate: Props['onUpdateAdmin'] }) {
  const [date, setDate] = useState(todayISO)
  const [subject, setSubject] = useState('')
  const [classGroup, setClassGroup] = useState('')
  const [evaluation, setEvaluation] = useState('')
  const [standards, setStandards] = useState<string[]>([])
  const list = [...admin.lessons].sort((a, b) => b.dateISO.localeCompare(a.dateISO))
  return (
    <>
      <p className="filter-hint">
        Lessons you taught, with a quick post-lesson evaluation — evaluations are TS-taggable
        evidence, and the count feeds your stats. Snap the plan as a photo on the day's session.
      </p>
      <div className="admin-form">
        <label className="admin-label">
          Date
          <input type="date" className="date-input" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <input type="text" className="placement-input" placeholder="Subject (e.g. Maths — fractions)" value={subject} onChange={(e) => setSubject(e.target.value)} />
        <input type="text" className="placement-input" placeholder="Class (e.g. Year 2)" value={classGroup} onChange={(e) => setClassGroup(e.target.value)} />
        <textarea className="note-input" rows={2} placeholder="How did it go? What would you change?…" value={evaluation} onChange={(e) => setEvaluation(e.target.value)} />
        <TSChips selected={standards} onToggle={(id) => setStandards((s) => toggleIn(s, id))} />
        <button
          type="button"
          className="btn-primary"
          disabled={!subject.trim()}
          onClick={() => {
            const entry: Lesson = { id: newAdminId(), dateISO: date || todayISO, classGroup: classGroup.trim(), subject: subject.trim(), evaluation: evaluation.trim(), standards, at: Date.now() }
            onUpdate((prev) => ({ ...prev, lessons: [...prev.lessons, entry] }))
            setSubject(''); setClassGroup(''); setEvaluation(''); setStandards([])
          }}
        >
          Log lesson
        </button>
      </div>
      <ul className="admin-list">
        {list.map((l) => (
          <li key={l.id} className="admin-item">
            <div className="admin-item-head">
              <strong>{fmt(l.dateISO)} · {l.subject}{l.classGroup ? ` (${l.classGroup})` : ''}</strong>
              <span className="journal-tags">
                {l.standards.map((ts) => (
                  <span className="badge badge-standard" key={ts}>{ts}</span>
                ))}
                <button type="button" className="btn-icon" aria-label="Delete lesson" onClick={() => onUpdate((prev) => ({ ...prev, lessons: prev.lessons.filter((x) => x.id !== l.id) }))}>✕</button>
              </span>
            </div>
            {l.evaluation && <p>{l.evaluation}</p>}
          </li>
        ))}
      </ul>
    </>
  )
}

function AuditsTab({ admin, todayISO, onUpdate }: { admin: AdminFile; todayISO: string; onUpdate: Props['onUpdateAdmin'] }) {
  const [subject, setSubject] = useState('')
  const [stage, setStage] = useState<AuditStage>('baseline')
  const [note, setNote] = useState('')
  const bySubject = new Map<string, typeof admin.audits>()
  for (const a of admin.audits) bySubject.set(a.subject, [...(bySubject.get(a.subject) ?? []), a])
  return (
    <>
      <p className="filter-hint">
        Subject-knowledge audits: log each pass (baseline → revisited → secure) so the start/mid/end
        story lives in one place.
      </p>
      <div className="admin-form">
        <input type="text" className="placement-input" placeholder="Subject (e.g. Maths)" value={subject} onChange={(e) => setSubject(e.target.value)} />
        <select className="absent-reason" value={stage} onChange={(e) => setStage(e.target.value as AuditStage)} aria-label="Audit stage">
          <option value="baseline">Baseline</option>
          <option value="revisited">Revisited</option>
          <option value="secure">Secure</option>
        </select>
        <textarea className="note-input" rows={2} placeholder="Score / gaps / what to work on…" value={note} onChange={(e) => setNote(e.target.value)} />
        <button
          type="button"
          className="btn-primary"
          disabled={!subject.trim()}
          onClick={() => {
            onUpdate((prev) => ({
              ...prev,
              audits: [...prev.audits, { id: newAdminId(), subject: subject.trim(), stage, note: note.trim(), dateISO: todayISO, at: Date.now() }],
            }))
            setSubject(''); setNote('')
          }}
        >
          Log audit pass
        </button>
      </div>
      <ul className="admin-list">
        {[...bySubject.entries()].map(([subj, entries]) => (
          <li key={subj} className="admin-item">
            <div className="admin-item-head">
              <strong>{subj}</strong>
              <span className="admin-dates">{entries.map((e) => e.stage).join(' → ')}</span>
            </div>
            {[...entries].sort((a, b) => a.dateISO.localeCompare(b.dateISO)).map((e) => (
              <p key={e.id}>
                {e.stage} ({fmt(e.dateISO)}){e.note ? `: ${e.note}` : ''}{' '}
                <button type="button" className="btn-icon" aria-label="Delete audit entry" onClick={() => onUpdate((prev) => ({ ...prev, audits: prev.audits.filter((x) => x.id !== e.id) }))}>✕</button>
              </p>
            ))}
          </li>
        ))}
      </ul>
    </>
  )
}

function WalletTab({ profileId }: { profileId: string }) {
  const [files, setFiles] = useState<WalletFile[]>([])
  const [error, setError] = useState<string | null>(null)
  const reload = () => void getWalletFiles(profileId).then(setFiles)
  useEffect(reload, [profileId])
  const sizeLabel = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)}MB` : `${Math.round(n / 1024)}KB`)
  return (
    <>
      <p className="filter-hint">
        The documents schools keep asking for — safeguarding certificate, DBS, templates, policies —
        stored on this device (max {WALLET_FILE_CAP / 1024 / 1024}MB each) and included in backups.
      </p>
      <label className="btn-secondary btn-file">
        📎 Add a document
        <input
          type="file"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) {
              setError(null)
              void addWalletFile(profileId, file)
                .then(reload)
                .catch((err) => setError(err instanceof Error ? err.message : 'Could not store that file.'))
            }
            e.target.value = ''
          }}
        />
      </label>
      {error && <p className="setup-error">{error}</p>}
      <ul className="admin-list">
        {files.map((f) => (
          <li key={f.id} className="admin-item wallet-item">
            <div className="admin-item-head">
              <button
                type="button"
                className="wallet-open"
                onClick={() => {
                  const url = URL.createObjectURL(f.blob)
                  window.open(url, '_blank', 'noopener')
                  setTimeout(() => URL.revokeObjectURL(url), 60_000)
                }}
              >
                📄 {f.name}
              </button>
              <span className="journal-tags">
                <span className="admin-dates">{sizeLabel(f.size)}</span>
                <button
                  type="button"
                  className="btn-icon"
                  aria-label="Delete document"
                  onClick={() => {
                    if (window.confirm(`Delete "${f.name}" from the wallet?`)) void deleteWalletFile(f.id).then(reload)
                  }}
                >
                  ✕
                </button>
              </span>
            </div>
          </li>
        ))}
        {files.length === 0 && <p className="filter-hint">Nothing in the wallet yet.</p>}
      </ul>
    </>
  )
}

/* ---------- overview dashboard ---------- */

function Overview({ admin, sessions, metaMap, keyDates, placementTargetDays, todayISO }: Omit<Props, 'onClose' | 'onUpdateAdmin' | 'profileId' | 'profileName'>) {
  const past = sessions.filter((s) => s.dateISO <= todayISO && !s.isSelfStudy && !s.isKeyDate)
  const absent = past.filter((s) => metaMap[sessionKey(s)]?.absent).length
  const dayTags = new Map<string, { total: Set<string>; done: Set<string> }>()
  for (const s of sessions) {
    if (s.isKeyDate || !isPlacementSession(s)) continue
    const tag = placementTag(s.title)
    const e = dayTags.get(tag) ?? { total: new Set<string>(), done: new Set<string>() }
    e.total.add(s.dateISO)
    if (metaMap[sessionKey(s)]?.attended) e.done.add(s.dateISO)
    dayTags.set(tag, e)
  }
  const daysDone = [...dayTags.values()].reduce((n, e) => n + e.done.size, 0)

  // Evidence per standard: session meta + reflections + lesson evaluations.
  const evCounts = new Map<string, number>()
  for (const m of Object.values(metaMap)) for (const ts of m.standards ?? []) evCounts.set(ts, (evCounts.get(ts) ?? 0) + 1)
  for (const r of admin.reflections) for (const ts of r.standards) evCounts.set(ts, (evCounts.get(ts) ?? 0) + 1)
  for (const l of admin.lessons) for (const ts of l.standards) evCounts.set(ts, (evCounts.get(ts) ?? 0) + 1)
  const gaps = TEACHERS_STANDARDS.filter((ts) => !(evCounts.get(ts.id) ?? 0)).map((ts) => ts.id)

  const openTargets = admin.targets.filter((t) => t.status !== 'met').length
  const openActions = admin.meetings.reduce((n, m) => n + m.actions.filter((a) => !a.done).length, 0)
  const streak = reflectionStreak(admin.reflections, todayISO)
  const secureAudits = new Set(admin.audits.filter((a) => a.stage === 'secure').map((a) => a.subject)).size
  const auditSubjects = new Set(admin.audits.map((a) => a.subject)).size
  const dueSoon = keyDates.filter(
    (k) => k.dateISO >= todayISO && daysUntil(k.dateISO, todayISO) <= 14 && metaMap[sessionKey(k)]?.status !== 'done'
  ).length

  const rows: { label: string; value: string; warn?: boolean }[] = [
    { label: '🏫 School days logged', value: `${daysDone}${placementTargetDays ? ` / ${placementTargetDays}` : ''}` },
    { label: '✗ Absences recorded', value: `${absent}`, warn: absent > 0 },
    {
      label: '📔 Evidence coverage',
      value: gaps.length === 0 ? 'all 8 standards ✓' : `${8 - gaps.length}/8 standards`,
      warn: gaps.length > 0,
    },
    { label: '🎯 Open targets', value: `${openTargets}`, warn: openTargets > 0 },
    { label: '☐ Mentor actions to do', value: `${openActions}`, warn: openActions > 0 },
    { label: '✍️ Reflection streak', value: `${streak} week${streak === 1 ? '' : 's'}` },
    { label: '👀 Observations logged', value: `${admin.observations.length}` },
    { label: '🍎 Lessons taught', value: `${admin.lessons.length}` },
    { label: '📚 Audits secure', value: auditSubjects > 0 ? `${secureAudits}/${auditSubjects} subjects` : 'none logged' },
    { label: '📌 Deadlines due in 14d', value: `${dueSoon}`, warn: dueSoon > 0 },
  ]
  return (
    <>
      <ul className="notif-overview admin-overview">
        {rows.map((r) => (
          <li key={r.label}>
            <span>{r.label}</span>
            <span className={`notif-state${r.warn ? ' warn' : ''}`}>{r.value}</span>
          </li>
        ))}
      </ul>
      {gaps.length > 0 && (
        <p className="filter-hint admin-gaps">
          ⚠ No evidence yet against {gaps.join(', ')} — tag a note, reflection or lesson evaluation
          to close the gap.
        </p>
      )}
    </>
  )
}

export function AdminSheet(props: Props) {
  const { profileId, profileName, admin, onUpdateAdmin, sessions, metaMap, keyDates, placementTargetDays, todayISO, onClose } = props
  const dialogRef = useModalA11y<HTMLDivElement>(onClose)
  const [tab, setTab] = useState<Tab>('overview')
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        ref={dialogRef}
        className="modal-card sheet"
        role="dialog"
        aria-modal="true"
        aria-label="My PGCE file"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet-header">
          <h2>🎓 My PGCE file</h2>
          <button type="button" className="btn-icon" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="chip-grid admin-tabs">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`chip${tab === t.id ? ' chip-on' : ''}`}
              aria-pressed={tab === t.id}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
        {tab === 'overview' && (
          <Overview admin={admin} sessions={sessions} metaMap={metaMap} keyDates={keyDates} placementTargetDays={placementTargetDays} todayISO={todayISO} />
        )}
        {tab === 'reflect' && <ReflectionsTab admin={admin} todayISO={todayISO} onUpdate={onUpdateAdmin} />}
        {tab === 'targets' && <TargetsTab admin={admin} todayISO={todayISO} onUpdate={onUpdateAdmin} />}
        {tab === 'meetings' && <MeetingsTab admin={admin} todayISO={todayISO} onUpdate={onUpdateAdmin} />}
        {tab === 'obs' && <ObservationsTab admin={admin} todayISO={todayISO} onUpdate={onUpdateAdmin} />}
        {tab === 'lessons' && <LessonsTab admin={admin} todayISO={todayISO} onUpdate={onUpdateAdmin} />}
        {tab === 'audits' && <AuditsTab admin={admin} todayISO={todayISO} onUpdate={onUpdateAdmin} />}
        {tab === 'wallet' && <WalletTab profileId={profileId} />}
        <div className="modal-actions">
          <button
            type="button"
            className="btn-primary"
            onClick={() =>
              void printBinder({ profileId, profileName, sessions, metaMap, admin, placementTargetDays, todayISO })
            }
          >
            🖨 Export full binder (PDF)
          </button>
          <button type="button" className="btn-ghost" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
