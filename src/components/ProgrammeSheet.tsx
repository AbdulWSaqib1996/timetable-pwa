import { useState } from 'react'
import { Dialog, Field, IconClose } from './ui'
import { applyProgrammePack, diffProgrammePack, milestoneKinds, packOwners, programmeModes, programmePhases, programmeRoutes, validateProgrammePack } from '../../shared/programme.js'
import type { ProgrammePack } from '../../shared/programme.js'
import { newAdminId } from '../lib/admin'
import type { AdminFile, MilestoneRec, ProgrammeProfileRec, RequirementRec } from '../lib/admin'

interface Props {
  admin: AdminFile
  todayISO: string
  onUpdateAdmin: (updater: (prev: AdminFile) => AdminFile) => void
  onClose: () => void
}

type Tab = 'profile' | 'packs' | 'requirements' | 'milestones'

const ROUTE_LABEL: Record<string, string> = { 'pgce-qts': 'PGCE with QTS', pgce: 'PGCE (no QTS)', 'qts-only': 'QTS only', other: 'Other' }
const fmt = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

/**
 * PG-01 programme roadmap (G1a): the course profile in the learner's own words,
 * requirement packs imported as JSON (validated, previewed as a diff before
 * anything is written), requirements confirmed only by the learner ("Confirmed
 * by you from …"), and dated milestones marked done only by them. No handbook
 * extraction, no built-in day target, no completion ring.
 */
export function ProgrammeSheet({ admin, todayISO, onUpdateAdmin, onClose }: Props) {
  const profile: ProgrammeProfileRec = admin.programmes.find((p) => p.id === 'course') ?? { id: 'course', route: 'pgce-qts', at: 0 }
  const [tab, setTab] = useState<Tab>(admin.packs.length ? 'requirements' : 'profile')
  const [draft, setDraft] = useState<ProgrammeProfileRec>(profile)
  const [importText, setImportText] = useState('')
  const [errors, setErrors] = useState<string[]>([])
  const [preview, setPreview] = useState<{ pack: ProgrammePack; diff: ReturnType<typeof diffProgrammePack> } | null>(null)
  const [confirming, setConfirming] = useState<{ id: string; source: string } | null>(null)
  const [newMs, setNewMs] = useState<{ kind: MilestoneRec['kind']; title: string; dateISO: string }>({ kind: 'review', title: '', dateISO: '' })

  const saveProfile = () => {
    const rec: ProgrammeProfileRec = { ...draft, id: 'course', at: Date.now() }
    for (const k of ['jurisdiction', 'academicYear', 'providerLabel', 'subject', 'ageRange', 'startISO', 'endISO'] as const) if (!rec[k]) delete rec[k]
    onUpdateAdmin((prev) => ({ ...prev, programmes: [...prev.programmes.filter((p) => p.id !== 'course'), rec] }))
  }

  const validateImport = () => {
    setPreview(null)
    let parsed: unknown
    try {
      parsed = JSON.parse(importText)
    } catch {
      setErrors(['That is not valid JSON — paste the pack exactly as it was shared.'])
      return
    }
    const { ok, errors: errs, pack } = validateProgrammePack(parsed)
    if (!ok || !pack) {
      setErrors(errs)
      return
    }
    setErrors([])
    setPreview({ pack, diff: diffProgrammePack(pack, admin.requirements, admin.milestones) })
  }
  const applyImport = () => {
    if (!preview) return
    const pack = preview.pack
    onUpdateAdmin((prev) => {
      const next = applyProgrammePack(pack, { packs: prev.packs, requirements: prev.requirements, milestones: prev.milestones }, Date.now())
      return { ...prev, packs: next.packs, requirements: next.requirements, milestones: next.milestones }
    })
    setPreview(null)
    setImportText('')
    setTab('requirements')
  }
  const onFile = (file: File | undefined) => {
    if (!file) return
    void file.text().then((t) => setImportText(t))
  }
  const setRequirement = (id: string, patch: Partial<RequirementRec>) =>
    onUpdateAdmin((prev) => ({ ...prev, requirements: prev.requirements.map((r) => (r.id === id ? { ...r, ...patch } : r)) }))
  const sections = [...new Set(admin.requirements.map((r) => r.section))].sort()
  const milestones = [...admin.milestones].sort((a, b) => a.dateISO.localeCompare(b.dateISO))
  const packVersion = (id?: string) => admin.packs.find((p) => p.id === id)?.version

  return (
    <Dialog label="Programme" onClose={onClose} className="sheet-programme">
      <div className="sheet-header">
        <h2>Programme</h2>
        <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
          <IconClose />
        </button>
      </div>
      <div className="segmented" role="tablist" aria-label="Programme sections">
        {(
          [
            ['profile', 'Course'],
            ['packs', `Packs (${admin.packs.length})`],
            ['requirements', `Requirements (${admin.requirements.length})`],
            ['milestones', `Milestones (${admin.milestones.length})`],
          ] as [Tab, string][]
        ).map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={`segment${tab === id ? ' segment-on' : ''}`} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'profile' && (
        <div className="programme-profile">
          <Field label="Route">
            <select className="date-input" value={draft.route} onChange={(e) => setDraft({ ...draft, route: e.target.value as ProgrammeProfileRec['route'] })}>
              {programmeRoutes.map((r) => (
                <option key={r} value={r}>{ROUTE_LABEL[r] ?? r}</option>
              ))}
            </select>
          </Field>
          <div className="task-edit-row">
            <Field label="Phase">
              <select className="date-input" value={draft.phase ?? 'primary'} onChange={(e) => setDraft({ ...draft, phase: e.target.value as ProgrammeProfileRec['phase'] })}>
                {programmePhases.map((p) => (
                  <option key={p} value={p}>{p[0].toUpperCase() + p.slice(1)}</option>
                ))}
              </select>
            </Field>
            <Field label="Mode">
              <select className="date-input" value={draft.mode ?? 'full-time'} onChange={(e) => setDraft({ ...draft, mode: e.target.value as ProgrammeProfileRec['mode'] })}>
                {programmeModes.map((m) => (
                  <option key={m} value={m}>{m === 'full-time' ? 'Full-time' : 'Part-time'}</option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="Provider"><input type="text" className="placement-input" value={draft.providerLabel ?? ''} onChange={(e) => setDraft({ ...draft, providerLabel: e.target.value })} /></Field>
          <div className="task-edit-row">
            <Field label="Academic year"><input type="text" className="placement-input" placeholder="2026/27" value={draft.academicYear ?? ''} onChange={(e) => setDraft({ ...draft, academicYear: e.target.value })} /></Field>
            <Field label="Jurisdiction"><input type="text" className="placement-input" placeholder="England" value={draft.jurisdiction ?? ''} onChange={(e) => setDraft({ ...draft, jurisdiction: e.target.value })} /></Field>
          </div>
          <div className="task-edit-row">
            <Field label="Subject (optional)"><input type="text" className="placement-input" value={draft.subject ?? ''} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} /></Field>
            <Field label="Age range (optional)"><input type="text" className="placement-input" placeholder="5–11" value={draft.ageRange ?? ''} onChange={(e) => setDraft({ ...draft, ageRange: e.target.value })} /></Field>
          </div>
          <div className="task-edit-row">
            <Field label="Course starts"><input type="date" className="date-input" value={draft.startISO ?? ''} onChange={(e) => setDraft({ ...draft, startISO: e.target.value })} /></Field>
            <Field label="Course ends"><input type="date" className="date-input" value={draft.endISO ?? ''} onChange={(e) => setDraft({ ...draft, endISO: e.target.value })} /></Field>
          </div>
          <div className="btn-row">
            <button type="button" className="btn-primary" onClick={saveProfile}>Save course profile</button>
          </div>
          <p className="filter-hint">These are your own entries. Requirements come from packs, and each one stays “Unconfirmed” until you confirm it against its source.</p>
        </div>
      )}

      {tab === 'packs' && (
        <div className="programme-packs">
          {admin.packs.length === 0 ? (
            <p className="filter-hint">No pack yet. Requirements not yet confirmed — nothing is assumed about your course rules until a pack is imported and confirmed.</p>
          ) : (
            <ul className="workspace-list" aria-label="Packs">
              {admin.packs.map((p) => (
                <li key={p.id} className="workspace-row">
                  <span>
                    <strong>{p.label}</strong> <span className="tag">v{p.version}</span>
                    <span className="filter-hint"> · {p.ownerSource}{p.importedAt ? ` · imported ${new Date(p.importedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : ''}</span>
                  </span>
                  {p.url && <a className="travel-link" href={p.url} target="_blank" rel="noopener noreferrer">Source ↗</a>}
                </li>
              ))}
            </ul>
          )}
          <Field label="Import a pack (JSON)" hint={`Fields: packId, label, ownerSource (${packOwners.join('/')}), version, requirements[{key, section, title, plannedValue?, applicability?, effectiveFrom?, effectiveTo?}], milestones?[{key, kind, title, date}].`}>
            <textarea className="placement-input" rows={6} value={importText} onChange={(e) => setImportText(e.target.value)} aria-label="Pack JSON" />
          </Field>
          <div className="btn-row">
            <label className="btn-today-reset">
              Choose file
              <input type="file" accept="application/json,.json" hidden onChange={(e) => onFile(e.target.files?.[0])} />
            </label>
            <button type="button" className="btn-secondary" onClick={validateImport} disabled={!importText.trim()}>Validate &amp; preview</button>
          </div>
          {errors.length > 0 && (
            <ul className="setup-error" role="alert">
              {errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}
          {preview && (
            <div className="callout callout--amber pack-preview" aria-label="Pack preview">
              <p>
                <strong>{preview.pack.label}</strong> v{preview.pack.version} · {preview.pack.requirements.length} requirements, {preview.pack.milestones.length} milestones
              </p>
              <ul>
                <li>{preview.diff.added.length} new requirement{preview.diff.added.length === 1 ? '' : 's'}</li>
                <li>{preview.diff.changed.length} changed (confirmation cleared — the wording changed)</li>
                <li>{preview.diff.unchanged.length} unchanged (confirmation kept)</li>
                <li>{preview.diff.removed.length} removed</li>
                <li>{preview.diff.milestonesAdded.length} new milestone{preview.diff.milestonesAdded.length === 1 ? '' : 's'}, {preview.diff.milestonesMoved.length} moved, {preview.diff.milestonesKept.length} kept (done milestones never move)</li>
              </ul>
              {preview.diff.changed.slice(0, 5).map((c) => (
                <p key={c.id} className="filter-hint">{c.title}: was “{c.previous.title}{c.previous.plannedValue ? ` · ${c.previous.plannedValue}` : ''}”</p>
              ))}
              <div className="btn-row">
                <button type="button" className="btn-primary" onClick={applyImport}>Apply pack</button>
                <button type="button" className="btn-ghost" onClick={() => setPreview(null)}>Discard</button>
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'requirements' && (
        <div className="programme-requirements">
          {admin.requirements.length === 0 ? (
            <p className="filter-hint">Requirements not yet confirmed — import a pack to list them. Nothing here invents a target.</p>
          ) : (
            sections.map((section) => (
              <section key={section} className="filter-section">
                <h3 className="subheading">{section}</h3>
                <ul className="workspace-list" aria-label={`Requirements: ${section}`}>
                  {admin.requirements
                    .filter((r) => r.section === section)
                    .map((r) => (
                      <li key={r.id} className="workspace-row requirement-row">
                        <span>
                          <strong>{r.title}</strong>
                          {r.plannedValue && <span className="filter-hint"> · planned {r.plannedValue}</span>}
                          {r.applicability && <span className="filter-hint"> · {r.applicability}</span>}
                          <span className="filter-hint">
                            {' '}
                            · {r.verification === 'confirmed' ? `Confirmed by you from ${r.confirmedSource || 'the pack'}${r.confirmedAt ? ` (${new Date(r.confirmedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })})` : ''}` : 'Unconfirmed'}
                            {r.packVersion ? ` · pack v${r.packVersion}` : ''}
                          </span>
                        </span>
                        {r.verification === 'confirmed' ? (
                          <button type="button" className="travel-link" onClick={() => setRequirement(r.id, { verification: 'unconfirmed', confirmedSource: undefined, confirmedAt: undefined })}>Unconfirm</button>
                        ) : confirming?.id === r.id ? (
                          <span className="requirement-confirm">
                            <input type="text" className="placement-input" aria-label="Source you checked" placeholder="e.g. Handbook p.12" value={confirming.source} onChange={(e) => setConfirming({ id: r.id, source: e.target.value })} />
                            <button type="button" className="btn-primary" onClick={() => { setRequirement(r.id, { verification: 'confirmed', confirmedSource: confirming.source.trim() || undefined, confirmedAt: Date.now() }); setConfirming(null) }}>Confirm</button>
                          </span>
                        ) : (
                          <button type="button" className="travel-link" onClick={() => setConfirming({ id: r.id, source: '' })}>Confirm from source</button>
                        )}
                      </li>
                    ))}
                </ul>
              </section>
            ))
          )}
        </div>
      )}

      {tab === 'milestones' && (
        <div className="programme-milestones">
          {milestones.length === 0 ? (
            <p className="filter-hint">No milestones yet — add reviews, hand-ins and training days below, or import a pack that carries them.</p>
          ) : (
            <ul className="workspace-list" aria-label="Milestones">
              {milestones.map((m) => (
                <li key={m.id} className="workspace-row">
                  <span>
                    <span className="tag">{m.kind}</span> <strong>{m.title}</strong>
                    <span className="filter-hint">
                      {' '}
                      · {fmt(m.dateISO)}
                      {m.state === 'done' ? ` · done${m.doneISO ? ` ${fmt(m.doneISO)}` : ''}` : m.dateISO < todayISO ? ' · date passed (not marked done)' : ''}
                      {m.packVersion ? ` · pack v${m.packVersion}${packVersion(m.packId) && packVersion(m.packId) !== m.packVersion ? ` (pack now v${packVersion(m.packId)})` : ''}` : ''}
                    </span>
                  </span>
                  {m.state === 'done' ? (
                    <button type="button" className="travel-link" onClick={() => onUpdateAdmin((prev) => ({ ...prev, milestones: prev.milestones.map((x) => (x.id === m.id ? { ...x, state: 'planned', doneISO: undefined } : x)) }))}>Reopen</button>
                  ) : (
                    <button type="button" className="travel-link" onClick={() => onUpdateAdmin((prev) => ({ ...prev, milestones: prev.milestones.map((x) => (x.id === m.id ? { ...x, state: 'done', doneISO: todayISO, packVersion: x.packVersion ?? packVersion(x.packId) } : x)) }))}>Mark done</button>
                  )}
                </li>
              ))}
            </ul>
          )}
          <div className="task-edit-row">
            <Field label="Kind">
              <select className="date-input" value={newMs.kind} onChange={(e) => setNewMs({ ...newMs, kind: e.target.value as MilestoneRec['kind'] })}>
                {milestoneKinds.map((k) => (
                  <option key={k} value={k}>{k[0].toUpperCase() + k.slice(1)}</option>
                ))}
              </select>
            </Field>
            <Field label="Date"><input type="date" className="date-input" value={newMs.dateISO} onChange={(e) => setNewMs({ ...newMs, dateISO: e.target.value })} /></Field>
          </div>
          <Field label="Milestone"><input type="text" className="placement-input" value={newMs.title} onChange={(e) => setNewMs({ ...newMs, title: e.target.value })} /></Field>
          <div className="btn-row">
            <button
              type="button"
              className="btn-primary"
              disabled={!newMs.title.trim() || !newMs.dateISO}
              onClick={() => {
                onUpdateAdmin((prev) => ({ ...prev, milestones: [...prev.milestones, { id: newAdminId(), kind: newMs.kind, title: newMs.title.trim(), dateISO: newMs.dateISO, state: 'planned', at: Date.now() }] }))
                setNewMs({ kind: 'review', title: '', dateISO: '' })
              }}
            >
              Add milestone
            </button>
          </div>
        </div>
      )}
    </Dialog>
  )
}
