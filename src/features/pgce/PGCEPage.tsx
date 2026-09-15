import { useEffect, useState } from 'react'
import { Card, IconArrowRight, IconBook, IconCalendar, IconChart, IconChevronLeft, IconNote, IconPin, IconPrint, IconSchool, IconShield, IconUser, PageHeader, SettingsAction } from '../../components/ui'
import { PLACEMENT_CODES, PLACEMENT_STATE_LABEL, PLACEMENT_TIMING_LABEL, placementSetupState, schoolOf } from '../../lib/admin'
import type { AdminFile, PlacementCode } from '../../lib/admin'
import { SECTION_LABEL, activePlacement, loadLastSection, recommendNext, saveLastSection } from '../../lib/pgceNext'
import type { Recommendation } from '../../lib/pgceNext'
import type { PgceSection, PgceTab } from '../../lib/navigationState'
import type { Settings } from '../../types'
import { getWalletFiles } from '../../lib/wallet'
import type { MetaMap } from '../../types'
import { activeCourse } from '../../lib/course'
import { roadmapSummary } from '../../../shared/programme.js'

export type AdminTab = PgceTab

interface Props {
  profileId: string
  profileName: string
  admin: AdminFile
  metaMap: MetaMap
  placement: { attendedDays: number; totalDays: number; targetDays?: number; blocks: number }
  /** U05: the destination shown expanded (`#/pgce/<section>`), or the landing */
  section: PgceSection | null
  onOpenSection: (section: PgceSection | null) => void
  /** U05: records tab (optionally one record; "Add new" focuses the form) — `#/pgce/records/<tab>[/<id>]` */
  onOpenRecords: (tab: AdminTab, opts?: { recordId?: string; focusAdd?: boolean }) => void
  /** U05: `#/pgce/lesson/<id>` */
  onOpenLesson: (lessonId: string, stage?: 'plan' | 'rehearse' | 'review') => void
  /** U05: `#/pgce/packs[/<id>]` */
  onOpenPacks: (packId?: string) => void
  onOpenJournal: () => void
  onOpenStats: () => void
  onOpenPlacements: () => void
  onOpenPlacementSetup: () => void
  onOpenSettings: () => void
  onOpenMentorAccess: () => void
  settings: Settings
  todayISO: string
  blocks: { tag: string; total: number; attended: number }[]
  onOpenPlacement: (id: string) => void
  onSetUpPlacement: (code: PlacementCode, id?: string) => void
  onJourney: (id: string, leg: 'out' | 'back') => void
  onOpenProgramme: () => void
  onOpenPractice: () => void
  onOpenPrep: () => void
  onOpenKnowledge: () => void
  onOpenAcademic: () => void
  onOpenWorkload: () => void
  onOpenExamples: () => void
  onOpenExperience: () => void
  onOpenReviews: () => void
}

const fmt = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

/**
 * PGCE file landing (audit U01/U05, Pass 79). One compact card for the
 * placement in play, ONE recommended next action with its reason (rule
 * precedence lives in src/lib/pgceNext.ts), four stable destinations that
 * each have their own URL, and Documents / Experience ledger / All records
 * beneath. Every one of the eleven record functions is a labelled control;
 * counts describe what has been collected — never a competency score — and
 * the recommendation never gates access to anything.
 */
export function PGCEPage(props: Props) {
  const { profileId, profileName, admin, metaMap, placement, section, todayISO, blocks } = props
  const [walletCount, setWalletCount] = useState<number | null>(null)
  useEffect(() => {
    let live = true
    void getWalletFiles(profileId)
      .then((files) => live && setWalletCount(files.length))
      .catch(() => live && setWalletCount(null))
    return () => {
      live = false
    }
  }, [profileId])
  // U01: the last section is remembered per profile, never globally.
  const [lastSection, setLastSection] = useState<PgceSection | null>(() => loadLastSection(profileId))
  useEffect(() => {
    if (section) {
      saveLastSection(profileId, section)
      setLastSection(section)
    }
  }, [profileId, section])
  useEffect(() => setLastSection(loadLastSection(profileId)), [profileId])

  const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`
  const evidence = Object.values(metaMap).filter((m) => !m.deleted && (m.note || (m.photos ?? 0) > 0 || (m.standards ?? []).length > 0)).length
  const openActions = admin.meetings.reduce((n, m) => n + m.actions.filter((a) => !a.done).length, 0)
  const active = activePlacement(admin, todayISO)
  const rec = recommendNext(admin, todayISO, profileId, blocks.length > 0)
  const roadmap = roadmapSummary(admin.requirements ?? [], admin.milestones ?? [], todayISO)
  // The placements that are not the active one — listed so none disappears once set up.
  const otherPlacements = PLACEMENT_CODES.filter((code) => code !== active.code).map((code) => {
    const placement = (admin.placements ?? []).find((p) => p.code === code)
    const school = schoolOf(placement, admin.schools ?? [])
    return { code, placement, school, state: placementSetupState(placement, school) }
  })
  const act = (r: Recommendation) => {
    if (r.kind === 'setup') props.onSetUpPlacement((r.placementCode as PlacementCode) ?? 'SE1', r.placementId)
    else if (r.kind === 'lesson' && r.lessonId) props.onOpenLesson(r.lessonId, r.stage)
    else if (r.kind === 'prep') props.onOpenPrep()
    else props.onOpenRecords(r.tab ?? 'overview', { focusAdd: r.focusAdd })
  }
  // The lesson "in play": the recommended one, else the nearest dated from today, else the most recent.
  const sortedLessons = [...admin.lessons].sort((a, b) => a.dateISO.localeCompare(b.dateISO))
  const currentLesson = (rec.kind === 'lesson' && admin.lessons.find((l) => l.id === rec.lessonId)) || sortedLessons.find((l) => l.dateISO >= todayISO) || sortedLessons[sortedLessons.length - 1] || null
  const n = {
    lessons: admin.lessons.length,
    cycles: (admin.cycles ?? []).filter((c) => c.state !== 'archived').length,
    preps: (admin.preps ?? []).length,
    meetings: admin.meetings.length,
    observations: admin.observations.length,
    targets: admin.targets.length,
    reflections: admin.reflections.length,
    examples: (admin.examples ?? []).length,
    packs: (admin.reviewPacks ?? []).length,
    reviews: (admin.reviews ?? []).length,
    projects: (admin.projects ?? []).length,
    goals: (admin.goals ?? []).filter((g) => g.state === 'open').length,
    audits: admin.audits.length,
    experience: (admin.experience ?? []).length,
  }

  const link = (label: string, onClick: () => void, primary = false) => (
    <button key={label} type="button" className={primary ? 'btn-primary' : 'btn-today-reset'} onClick={onClick}>
      {label}
    </button>
  )
  const destinations: { id: PgceSection; icon: JSX.Element; tone: string; summary: string; primary: JSX.Element; links: JSX.Element[]; recent: JSX.Element | null }[] = [
    {
      id: 'lessons',
      icon: <IconBook size={20} />,
      tone: 'violet',
      summary: n.lessons ? `${count(n.lessons, 'lesson')} · ${count(n.cycles, 'practice focus')}` : 'Plan, rehearse, teach and review — one lesson at a time.',
      primary: currentLesson ? link(`Open current lesson: ${currentLesson.subject || 'Lesson'} · ${fmt(currentLesson.dateISO)}`, () => props.onOpenLesson(currentLesson.id), true) : link('New lesson', () => props.onOpenRecords('lessons', { focusAdd: true }), true),
      links: [link(`Lessons (${n.lessons})`, () => props.onOpenRecords('lessons')), ...(currentLesson ? [link('New lesson', () => props.onOpenRecords('lessons', { focusAdd: true }))] : []), link(`Practice focus (${n.cycles})`, props.onOpenPractice)],
      recent: sortedLessons.length ? (
        <ul className="workspace-list" aria-label="Recent lessons">
          {[...sortedLessons].reverse().slice(0, 5).map((l) => (
            <li key={l.id} className="workspace-row requirement-row">
              <span><strong>{l.subject || 'Lesson'}</strong> <span className="filter-hint">· {fmt(l.dateISO)}{l.classGroup ? ` · ${l.classGroup}` : ''}{l.taughtAt && !l.evaluation ? ' · review pending' : ''}</span></span>
              <button type="button" className="travel-link" aria-label={`Open lesson: ${l.subject || 'Lesson'} ${fmt(l.dateISO)}`} onClick={() => props.onOpenLesson(l.id)}>Open</button>
            </li>
          ))}
        </ul>
      ) : null,
    },
    {
      id: 'mentor',
      icon: <IconUser size={20} />,
      tone: 'teal',
      summary: openActions > 0 ? `${count(openActions, 'mentor action')} to tick off` : n.meetings || n.observations ? `${count(n.meetings, 'meeting')} · ${count(n.observations, 'observation')}` : 'Prepare for meetings, keep observations and the targets you agree.',
      primary: link(`Mentor preparation (${n.preps})`, props.onOpenPrep, true),
      links: [link(`Mentor meetings (${n.meetings})`, () => props.onOpenRecords('meetings')), link(`Observations (${n.observations})`, () => props.onOpenRecords('obs')), link(`Targets (${n.targets})`, () => props.onOpenRecords('targets')), link('Mentor access', props.onOpenMentorAccess)],
      recent: admin.meetings.length ? (
        <ul className="workspace-list" aria-label="Recent meetings">
          {[...admin.meetings].sort((a, b) => b.dateISO.localeCompare(a.dateISO)).slice(0, 3).map((m) => (
            <li key={m.id} className="workspace-row requirement-row">
              <span><strong>Meeting {fmt(m.dateISO)}</strong> <span className="filter-hint">· {m.actions.filter((a) => !a.done).length} open action{m.actions.filter((a) => !a.done).length === 1 ? '' : 's'}</span></span>
              <button type="button" className="travel-link" aria-label={`Open meeting ${fmt(m.dateISO)}`} onClick={() => props.onOpenRecords('meetings', { recordId: m.id })}>Open</button>
            </li>
          ))}
        </ul>
      ) : null,
    },
    {
      id: 'evidence',
      icon: <IconNote size={20} />,
      tone: 'blue',
      summary: evidence || n.reflections ? `${count(evidence, 'evidence record')} · ${count(n.reflections, 'weekly reflection')} — what you have collected, not a score` : 'Session notes, weekly reflections, examples and the packs you share.',
      primary: link('Evidence journal', props.onOpenJournal, true),
      links: [link(`Weekly reflections (${n.reflections})`, () => props.onOpenRecords('reflect')), link(`Evidence examples (${n.examples})`, props.onOpenExamples), link(`Review packs (${n.packs})`, () => props.onOpenPacks()), link(`Reviews & handover (${n.reviews})`, props.onOpenReviews)],
      recent: (admin.reviewPacks ?? []).length ? (
        <ul className="workspace-list" aria-label="Recent packs">
          {[...(admin.reviewPacks ?? [])].sort((a, b) => b.at - a.at).slice(0, 3).map((p) => (
            <li key={p.id} className="workspace-row requirement-row">
              <span><strong>{p.title}</strong> <span className="filter-hint">· {p.items.length} item{p.items.length === 1 ? '' : 's'}{p.sharing?.mentorIds.length ? ` · shared v${p.sharing.revision}` : ''}</span></span>
              <button type="button" className="travel-link" aria-label={`Open pack: ${p.title}`} onClick={() => props.onOpenPacks(p.id)}>Open</button>
            </li>
          ))}
        </ul>
      ) : null,
    },
    {
      id: 'academic',
      icon: <IconCalendar size={20} />,
      tone: 'amber',
      summary: n.projects || n.goals ? `${count(n.projects, 'project')} · ${count(n.goals, 'open knowledge goal')}` : 'Assignments, subject knowledge, workload and your programme requirements.',
      primary: link(`Academic work (${n.projects})`, props.onOpenAcademic, true),
      links: [link(`Subject knowledge (${n.goals})`, props.onOpenKnowledge), link('Workload & support', props.onOpenWorkload), link(`Audits (${n.audits})`, () => props.onOpenRecords('audits')), link('Programme', props.onOpenProgramme)],
      // PG-01 roadmap (G1a) lives with the programme now: nothing is assumed until the learner confirms it.
      recent:
        roadmap.requirements === 0 && (admin.milestones ?? []).length === 0 ? (
          <p className="filter-hint">Requirements not yet confirmed. Enter your course profile and import your provider's pack — nothing is assumed about day targets or deadlines until you confirm it.</p>
        ) : (
          <ul className="roadmap-lines" aria-label="Roadmap">
            <li>
              <span className="tag">Academic</span> {roadmap.academic.next ? `${roadmap.academic.next.title} · ${roadmap.academic.next.dateISO}` : 'nothing dated ahead'}
              {roadmap.academic.total > 0 ? ` · ${roadmap.academic.done}/${roadmap.academic.total} done` : ''}
            </li>
            <li>
              <span className="tag">Training</span> {roadmap.training.next ? `${roadmap.training.next.title} · ${roadmap.training.next.dateISO}` : 'nothing dated ahead'}
              {roadmap.training.total > 0 ? ` · ${roadmap.training.done}/${roadmap.training.total} done` : ''}
            </li>
            <li>
              <span className="tag">Next review</span> {roadmap.nextReview ? `${roadmap.nextReview.title} · ${roadmap.nextReview.dateISO}` : 'none scheduled'}
            </li>
            <li>
              <span className={`tag${roadmap.unconfirmed > 0 ? ' tag--amber' : ''}`}>Requirements</span> {roadmap.unconfirmed > 0 ? `${roadmap.unconfirmed} of ${roadmap.requirements} not yet confirmed by you` : `${roadmap.requirements} confirmed by you`}
            </li>
          </ul>
        ),
    },
  ]
  const shown = section ? destinations.filter((d) => d.id === section) : destinations

  return (
    <div className="page page-pgce">
      {section ? (
        <button type="button" className="page-back" onClick={() => props.onOpenSection(null)}>
          <IconChevronLeft size={18} /> PGCE file
        </button>
      ) : null}
      <PageHeader title={section ? SECTION_LABEL[section] : 'PGCE file'} subtitle={section ? `${profileName} · PGCE file` : `${profileName} · your placement and professional development`} actions={<SettingsAction onOpen={props.onOpenSettings} />} />

      {!section && activeCourse().features.placement && (
        <Card className="pgce-section pgce-section--placement pgce-active">
          <div className="pgce-section-head">
            <span className="pgce-tile" aria-hidden="true"><IconPin size={20} /></span>
            <h2>
              {active.code}
              {active.placement?.label ? <span className="pgce-active-label"> · {active.placement.label}</span> : null}
            </h2>
            {placement.blocks > 0 && (
              <span className="badge pgce-count">
                {placement.attendedDays}
                {placement.targetDays ? `/${placement.targetDays}` : ''} days logged
              </span>
            )}
          </div>
          <p className="pgce-active-school">
            <IconSchool size={16} /> {active.school?.name ?? 'School not set up yet'}
          </p>
          <p className="pgce-active-state">
            <span className={`tag tag--${active.state}`}>{PLACEMENT_STATE_LABEL[active.state]}</span> <span className="tag">{PLACEMENT_TIMING_LABEL[active.timing]}</span>
            {active.placement?.startISO && active.placement?.endISO ? <span className="filter-hint"> {fmt(active.placement.startISO)} – {fmt(active.placement.endISO)}</span> : null}
          </p>
          <div className="btn-row">
            {/* A placement you have set up must stay openable and editable from here
                (owner request, 16 Sep 2026) — it used to offer only the journeys. */}
            {active.state === 'ready' && active.placement ? (
              <button type="button" className="btn-primary" onClick={() => props.onOpenPlacement(active.placement!.id)}>Open {active.code}</button>
            ) : (
              <button type="button" className="btn-primary" onClick={() => props.onSetUpPlacement(active.code as PlacementCode, active.placement?.id)}>Set up {active.code}</button>
            )}
            {active.placement && (
              <button type="button" className="btn-today-reset" onClick={() => props.onSetUpPlacement(active.code as PlacementCode, active.placement!.id)}>
                {active.state === 'ready' ? `Edit ${active.code} setup` : 'Continue setup'}
              </button>
            )}
            {active.placement && active.state !== 'ready' && (
              <button type="button" className="btn-today-reset" onClick={() => props.onOpenPlacement(active.placement!.id)}>Open {active.code}</button>
            )}
            {active.state === 'ready' && active.placement && (
              <>
                <button type="button" className="btn-today-reset" onClick={() => props.onJourney(active.placement!.id, 'out')}>To school</button>
                <button type="button" className="btn-today-reset" onClick={() => props.onJourney(active.placement!.id, 'back')}>Back home</button>
              </>
            )}
            <button type="button" className="btn-today-reset" onClick={props.onOpenPlacements}>All placements</button>
            {blocks.length > 0 && <button type="button" className="btn-today-reset" onClick={props.onOpenPlacementSetup}>Review block mapping</button>}
          </div>
          {/* Every placement stays one tap away, so setting one up never hides the others. */}
          {otherPlacements.length > 0 && (
            <ul className="pgce-other-placements" aria-label="Your other placements">
              {otherPlacements.map((p) => (
                <li key={p.code}>
                  <button
                    type="button"
                    className="travel-link"
                    onClick={() => (p.placement ? props.onOpenPlacement(p.placement.id) : props.onSetUpPlacement(p.code as PlacementCode))}
                  >
                    {p.code} · {p.school?.name ?? PLACEMENT_STATE_LABEL[p.state]}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {!section && (
        <Card className="pgce-section pgce-next">
          <section aria-label="Next action">
            <div className="pgce-section-head">
              <h2>Next</h2>
              <span className="tag">{rec.rule === 'data' ? 'Needs attention' : rec.rule === 'dated' ? 'Dated' : rec.rule === 'unfinished' ? 'Unfinished' : 'To start'}</span>
            </div>
            <p className="pgce-next-label"><strong>{rec.label}</strong></p>
            <p className="filter-hint pgce-next-reason">{rec.reason}</p>
            <div className="btn-row">
              <button type="button" className="btn-primary" onClick={() => act(rec)}>{rec.kind === 'setup' ? 'Set up' : rec.kind === 'onboard' ? 'Add lesson' : 'Open'}</button>
              <button type="button" className="btn-today-reset" onClick={() => props.onOpenRecords('overview')}>See all</button>
              {lastSection && <button type="button" className="travel-link" onClick={() => props.onOpenSection(lastSection)}>Continue in {SECTION_LABEL[lastSection]} <IconArrowRight size={14} /></button>}
            </div>
          </section>
        </Card>
      )}

      <div className={`pgce-grid${section ? ' pgce-grid--one' : ''}`}>
        {shown.map((d) => (
          <Card key={d.id} className={`pgce-section pgce-section--${d.id}`}>
            <div className="pgce-section-head">
              <span className={`pgce-tile ui-tile ui-tile--${d.tone}`} aria-hidden="true">{d.icon}</span>
              {section ? (
                <h2 className="visually-hidden">{SECTION_LABEL[d.id]}</h2>
              ) : (
                <h2>
                  <a className="pgce-section-link" href={`#/pgce/${d.id}`} onClick={(e) => { e.preventDefault(); props.onOpenSection(d.id) }}>
                    {SECTION_LABEL[d.id]} <IconArrowRight size={14} />
                  </a>
                </h2>
              )}
            </div>
            <p className="filter-hint">{d.summary}</p>
            <div className="btn-row">
              {d.primary}
              {d.links}
            </div>
            {section && d.recent}
          </Card>
        ))}
      </div>

      {!section && (
        <Card className="pgce-section pgce-section--documents">
          <div className="pgce-section-head">
            <span className="pgce-tile" aria-hidden="true"><IconNote size={20} /></span>
            <h2>Documents &amp; records</h2>
            {walletCount !== null && walletCount > 0 && <span className="badge pgce-count">{count(walletCount, 'file')}</span>}
          </div>
          <p className="filter-hint">
            {walletCount === null ? 'Keep your documents together on this device.' : walletCount > 0 ? `${count(walletCount, 'file')} in the wallet on this device. Files do not sync between devices yet.` : 'Keep DBS letters, certificates and school documents in the wallet — stored on this device.'}
          </p>
          <div className="btn-row">
            <button type="button" className="btn-primary" onClick={() => props.onOpenRecords('wallet')}>Open wallet</button>
            <button type="button" className="btn-today-reset" onClick={() => props.onOpenRecords('overview')}><IconPrint /> Print binder &amp; exports</button>
            <button type="button" className="btn-today-reset" onClick={props.onOpenStats}><IconChart /> Term stats &amp; attendance</button>
            <button type="button" className="btn-today-reset" onClick={props.onOpenExperience}>Experience ledger ({n.experience})</button>
            <button type="button" className="btn-today-reset" onClick={() => props.onOpenRecords('overview')}>All development records →</button>
          </div>
        </Card>
      )}

      <p className="filter-hint pgce-privacy">
        <IconShield size={16} /> Your records stay private on this device until you export or share them.
      </p>
    </div>
  )
}
