import { useMemo, useState } from 'react'
import { zonedTodayISO } from '../../shared/calendar-time.js'
import { UCL_PGCE_CONFIG, sanitizeTemplate, validateCourseConfig } from '../../shared/course.js'
import type { CourseBuilding, CourseConfig } from '../../shared/course.js'
import { useModalA11y } from '../lib/a11y'
import type { Settings } from '../types'
import { IconClose } from './ui'

interface Props {
  settings: Settings
  onUpdateSettings: (patch: Partial<Settings>) => void
  onClose: () => void
}

/**
 * Course configuration (P7-01): choose the built-in UCL Primary PGCE course,
 * edit a custom course in a form (no raw JSON required), or import/export a
 * portable template. Applying a template writes ONLY the course configuration
 * — home, reminders, notes, records and sync are untouched by construction.
 * The share payload is a validated whitelist rebuild, so sync codes, private
 * addresses and evidence cannot travel with it.
 */
export function CourseSheet({ settings, onUpdateSettings, onClose }: Props) {
  const dialogRef = useModalA11y<HTMLDivElement>(onClose)
  const current = useMemo(() => {
    const { ok, config } = validateCourseConfig(settings.courseConfig ?? UCL_PGCE_CONFIG)
    return ok && config ? config : UCL_PGCE_CONFIG
  }, [settings.courseConfig])

  const [mode, setMode] = useState<'view' | 'edit' | 'import'>('view')
  const [draft, setDraft] = useState<CourseConfig>(current)
  const [importText, setImportText] = useState('')
  const [errors, setErrors] = useState<string[]>([])
  const [preview, setPreview] = useState<CourseConfig | null>(null)

  const patchDraft = (p: Partial<CourseConfig>) => setDraft((d) => ({ ...d, ...p }))
  const patchCampus = (p: Partial<CourseConfig['campus']>) => setDraft((d) => ({ ...d, campus: { ...d.campus, ...p } }))
  const patchBuilding = (i: number, p: Partial<CourseBuilding>) =>
    setDraft((d) => ({ ...d, buildings: d.buildings.map((b, j) => (j === i ? { ...b, ...p } : b)) }))

  const applyConfig = (candidate: unknown) => {
    const { ok, errors: errs, config } = validateCourseConfig(candidate)
    if (!ok || !config) {
      setErrors(errs)
      return
    }
    onUpdateSettings({ courseConfig: config })
    setErrors([])
    setPreview(null)
    setMode('view')
  }

  const handleValidateImport = () => {
    setPreview(null)
    let parsed: unknown
    try {
      parsed = JSON.parse(importText)
    } catch {
      setErrors(['That is not valid JSON — paste the template exactly as it was shared.'])
      return
    }
    const { ok, errors: errs, config } = validateCourseConfig(parsed)
    if (!ok || !config) {
      setErrors(errs)
      return
    }
    setErrors([])
    setPreview(config)
  }

  const handleExport = () => {
    const template = sanitizeTemplate(current)
    if (!template) return
    const blob = new Blob([JSON.stringify(template, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `course-template-${current.configId}.json`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  const summary = (c: CourseConfig) => (
    <ul className="keydates-list">
      <li className="keydate-line"><span className="change-title">{c.name}</span><span className="filter-hint">template {c.configId} · v{c.version}</span></li>
      <li className="keydate-line"><span className="change-title">Timezone {c.timezone}</span><span className="filter-hint">today there: {zonedTodayISO(c.timezone)}</span></li>
      <li className="keydate-line"><span className="change-title">{c.campus.label}</span><span className="filter-hint">{c.buildings.length} known building{c.buildings.length === 1 ? '' : 's'}</span></li>
      <li className="keydate-line"><span className="change-title">Features</span><span className="filter-hint">{[c.features.placement ? 'placement' : null, c.features.pgceFile ? 'PGCE file' : null].filter(Boolean).join(', ') || 'timetable only'}</span></li>
    </ul>
  )

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div ref={dialogRef} className="modal-card sheet" role="dialog" aria-modal="true" aria-label="Course setup" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-header">
          <h2>Course setup</h2>
          <button type="button" className="btn-icon" onClick={onClose} aria-label="Close"><IconClose /></button>
        </div>

        {mode === 'view' && (
          <>
            <p className="filter-hint">
              The course sets the timezone, campus and building directory, terminology and which
              sections appear. Switching course never touches your home address, reminders, records
              or sync.
            </p>
            {summary(current)}
            <div className="btn-row">
              <button type="button" className="btn-secondary" onClick={() => { setDraft(current); setErrors([]); setMode('edit') }}>
                Edit course…
              </button>
              <button type="button" className="btn-secondary" onClick={() => { setImportText(''); setErrors([]); setPreview(null); setMode('import') }}>
                Import template…
              </button>
              <button type="button" className="btn-secondary" onClick={handleExport}>
                Export template
              </button>
            </div>
            {current.configId !== UCL_PGCE_CONFIG.configId && (
              <div className="btn-row">
                <button type="button" className="btn-secondary" onClick={() => applyConfig(UCL_PGCE_CONFIG)}>
                  Switch back to UCL Primary PGCE
                </button>
              </div>
            )}
            <p className="filter-hint">
              An exported template carries the public course settings only — never sync codes,
              addresses, evidence or anything personal.
            </p>
          </>
        )}

        {mode === 'edit' && (
          <>
            <section className="filter-section">
              <h3>Course</h3>
              <div className="feed-row">
                <input type="text" aria-label="Course name" placeholder="Course name" maxLength={60} value={draft.name} onChange={(e) => patchDraft({ name: e.target.value })} />
              </div>
              <div className="feed-row course-grid">
                <input type="text" aria-label="Template id" placeholder="template-id" maxLength={40} value={draft.configId} onChange={(e) => patchDraft({ configId: e.target.value })} />
                <input type="number" aria-label="Template version" min={1} value={draft.version} onChange={(e) => patchDraft({ version: Number(e.target.value) })} />
              </div>
              <div className="feed-row">
                <input type="text" aria-label="Course timezone" placeholder="IANA timezone, e.g. Europe/London" list="course-tz" value={draft.timezone} onChange={(e) => patchDraft({ timezone: e.target.value })} />
                <datalist id="course-tz">
                  {['Europe/London', 'Europe/Dublin', 'Europe/Paris', 'Europe/Berlin', 'America/New_York', 'America/Toronto', 'Australia/Sydney', 'Asia/Singapore'].map((z) => (
                    <option key={z} value={z} />
                  ))}
                </datalist>
              </div>
            </section>
            <section className="filter-section">
              <h3>Campus</h3>
              <div className="feed-row">
                <input type="text" aria-label="Campus label" placeholder="Campus label" maxLength={80} value={draft.campus.label} onChange={(e) => patchCampus({ label: e.target.value })} />
              </div>
              <div className="feed-row course-grid">
                <input type="number" aria-label="Campus latitude" step="any" placeholder="lat" value={draft.campus.lat} onChange={(e) => patchCampus({ lat: Number(e.target.value) })} />
                <input type="number" aria-label="Campus longitude" step="any" placeholder="lng" value={draft.campus.lng} onChange={(e) => patchCampus({ lng: Number(e.target.value) })} />
              </div>
              <div className="feed-row">
                <input type="text" aria-label="Map search suffix" placeholder="Search suffix for unknown rooms (e.g. UCL London)" maxLength={60} value={draft.campus.searchSuffix} onChange={(e) => patchCampus({ searchSuffix: e.target.value })} />
              </div>
            </section>
            <section className="filter-section">
              <h3>Terminology & features</h3>
              <div className="feed-row course-grid">
                <input type="text" aria-label="Specialism label" maxLength={24} value={draft.terminology.specialism} onChange={(e) => patchDraft({ terminology: { ...draft.terminology, specialism: e.target.value } })} />
                <input type="text" aria-label="Group label" maxLength={24} value={draft.terminology.group} onChange={(e) => patchDraft({ terminology: { ...draft.terminology, group: e.target.value } })} />
              </div>
              <label className="toggle-row">
                <input type="checkbox" checked={draft.features.placement} onChange={(e) => patchDraft({ features: { ...draft.features, placement: e.target.checked } })} />
                Placement tracking
              </label>
              <label className="toggle-row">
                <input type="checkbox" checked={draft.features.pgceFile} onChange={(e) => patchDraft({ features: { ...draft.features, pgceFile: e.target.checked } })} />
                PGCE file (reflections, targets, evidence…)
              </label>
            </section>
            <section className="filter-section">
              <h3>Buildings ({draft.buildings.length})</h3>
              <p className="filter-hint">
                Rooms are matched by keyword. A room that matches nothing keeps its raw text with an
                external map search — it is never guessed onto a similarly named building.
              </p>
              {draft.buildings.map((b, i) => (
                <div className="feed-row course-building-row" key={i}>
                  <input type="text" aria-label={`Building ${i + 1} name`} placeholder="Name" maxLength={80} value={b.name} onChange={(e) => patchBuilding(i, { name: e.target.value })} />
                  <input type="text" aria-label={`Building ${i + 1} keywords`} placeholder="keywords, comma-separated" value={b.keywords.join(', ')} onChange={(e) => patchBuilding(i, { keywords: e.target.value.split(',').map((k) => k.trim()).filter(Boolean) })} />
                  <input type="number" aria-label={`Building ${i + 1} latitude`} step="any" placeholder="lat" value={b.lat} onChange={(e) => patchBuilding(i, { lat: Number(e.target.value) })} />
                  <input type="number" aria-label={`Building ${i + 1} longitude`} step="any" placeholder="lng" value={b.lng} onChange={(e) => patchBuilding(i, { lng: Number(e.target.value) })} />
                  <button type="button" className="btn-icon" aria-label={`Remove building ${i + 1}`} onClick={() => setDraft((d) => ({ ...d, buildings: d.buildings.filter((_, j) => j !== i) }))}><IconClose /></button>
                </div>
              ))}
              <button type="button" className="btn-secondary" onClick={() => setDraft((d) => ({ ...d, buildings: [...d.buildings, { name: '', keywords: [], lat: d.campus.lat, lng: d.campus.lng }] }))}>
                + Add building
              </button>
            </section>
            <div className="btn-row">
              <button type="button" className="btn-primary" onClick={() => applyConfig(draft)}>Save course</button>
              <button type="button" className="btn-secondary" onClick={() => { setErrors([]); setMode('view') }}>Cancel</button>
            </div>
          </>
        )}

        {mode === 'import' && (
          <>
            <p className="filter-hint">
              Paste a course template shared by a coursemate or tutor. It is checked before anything
              is applied, and only course settings can be inside it.
            </p>
            <div className="feed-row">
              <textarea
                aria-label="Course template JSON"
                rows={8}
                placeholder='{"configId": "…", "version": 1, …}'
                value={importText}
                onChange={(e) => { setImportText(e.target.value); setPreview(null) }}
              />
            </div>
            <div className="btn-row">
              <button type="button" className="btn-secondary" disabled={!importText.trim()} onClick={handleValidateImport}>
                Check template
              </button>
              <button type="button" className="btn-secondary" onClick={() => { setErrors([]); setMode('view') }}>Cancel</button>
            </div>
            {preview && (
              <>
                <h3 className="subheading">Preview</h3>
                {summary(preview)}
                <div className="btn-row">
                  <button type="button" className="btn-primary" onClick={() => applyConfig(preview)}>
                    Apply this course
                  </button>
                </div>
                <p className="filter-hint">
                  Applying changes the course settings only — your home, reminders, notes and records
                  stay exactly as they are.
                </p>
              </>
            )}
          </>
        )}

        {errors.length > 0 && (
          <ul className="keydates-list" aria-label="Template problems">
            {errors.map((e, i) => (
              <li key={i} className="keydate-line"><span className="setup-error">{e}</span></li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
