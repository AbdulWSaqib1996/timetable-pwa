import { useEffect, useState } from 'react'
import { Card, IconBook, IconCalendar, IconChart, IconNote, IconPin, IconPrint, IconShield, IconUser, PageHeader, QuickMenu, SettingsAction } from '../../components/ui'
import type { AdminFile, PlacementCode } from '../../lib/admin'
import { roadmapSummary } from '../../../shared/programme.js'
import { PlacementChooser } from './PlacementChooser'
import type { Settings } from '../../types'
import { getWalletFiles } from '../../lib/wallet'
import type { MetaMap } from '../../types'
import { activeCourse } from '../../lib/course'

export type AdminTab = 'overview' | 'reflect' | 'targets' | 'meetings' | 'obs' | 'lessons' | 'audits' | 'wallet'

interface Props {
  profileId: string
  profileName: string
  admin: AdminFile
  metaMap: MetaMap
  placement: { attendedDays: number; totalDays: number; targetDays?: number; blocks: number }
  onOpenAdmin: (tab: AdminTab) => void
  onOpenJournal: () => void
  onOpenStats: () => void
  onOpenPlacements: () => void
  onOpenPlacementSetup: () => void
  onOpenSettings: () => void
  settings: Settings
  todayISO: string
  blocks: { tag: string; total: number; attended: number }[]
  onOpenPlacement: (id: string) => void
  onSetUpPlacement: (code: PlacementCode, id?: string) => void
  onJourney: (id: string, leg: 'out' | 'back') => void
  onOpenProgramme: () => void
}

/**
 * PGCE file destination (P4-07; R3 / TT-20; V4): four section cards with a
 * consistent icon tile and an identity colour each (teal Placement, indigo
 * Evidence, violet Development, blue Documents — identity, never a warning),
 * ONE dominant action per card, destination-named links instead of "View
 * all", and count badges taken from real records. Record types are reached
 * from Development's menu; every existing record editor stays within two
 * purposeful steps. Counts describe what has been collected — never a
 * competency score, and no invented percentage in an empty state.
 */
export function PGCEPage({
  profileId,
  profileName,
  admin,
  metaMap,
  placement,
  onOpenAdmin,
  onOpenJournal,
  onOpenStats,
  onOpenPlacements,
  onOpenPlacementSetup,
  onOpenSettings,
  settings,
  todayISO,
  blocks,
  onOpenPlacement,
  onSetUpPlacement,
  onJourney,
  onOpenProgramme,
}: Props) {
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

  const evidence = Object.values(metaMap).filter(
    (m) => !m.deleted && (m.note || (m.photos ?? 0) > 0 || (m.standards ?? []).length > 0)
  ).length
  const openActions = admin.meetings.reduce((n, m) => n + m.actions.filter((a) => !a.done).length, 0)
  const openTargets = admin.targets.filter((t) => t.status !== 'met').length
  const developmentTotal =
    admin.targets.length + admin.meetings.length + admin.observations.length + admin.lessons.length + admin.audits.length

  const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`
  const placementSetUp = placement.blocks > 0
  const roadmap = roadmapSummary(admin.requirements ?? [], admin.milestones ?? [], todayISO)

  return (
    <div className="page page-pgce">
      <PageHeader title="PGCE file" subtitle={`${profileName} · your placement and professional development`} actions={<SettingsAction onOpen={onOpenSettings} />} />

      <div className="pgce-grid">
        {activeCourse().features.placement && (
          <Card className="pgce-section pgce-section--placement pgce-section--wide">
            <div className="pgce-section-head">
              <span className="pgce-tile" aria-hidden="true">
                <IconPin size={20} />
              </span>
              <h2>Placements</h2>
              {placementSetUp && (
                <span className="badge pgce-count">
                  {placement.attendedDays}
                  {placement.targetDays ? `/${placement.targetDays}` : ''} days logged
                </span>
              )}
            </div>
            <p className="filter-hint">
              {placementSetUp
                ? `${placement.attendedDays}${placement.targetDays ? ` of ${placement.targetDays}` : ''} school day${placement.attendedDays === 1 && !placement.targetDays ? '' : 's'} logged across ${count(placement.blocks, 'timetable block')}. A logged day is one you ticked Attended on.`
                : 'Set up each placement with its school, mentor and dates. Blocks from your timetable are mapped to SE1, SE2 and SE3 — proposed, then confirmed by you.'}
            </p>
            <PlacementChooser
              placements={admin.placements ?? []}
              schools={admin.schools ?? []}
              settings={settings}
              todayISO={todayISO}
              blocks={blocks}
              onOpen={onOpenPlacement}
              onSetUp={onSetUpPlacement}
              onJourney={onJourney}
              onAll={onOpenPlacements}
              onReviewMapping={onOpenPlacementSetup}
            />
          </Card>
        )}

        <Card className="pgce-section pgce-section--roadmap">
          <div className="pgce-section-head">
            <span className="pgce-tile" aria-hidden="true">
              <IconCalendar size={20} />
            </span>
            <h2>Programme roadmap</h2>
            {roadmap.requirements > 0 && <span className="badge pgce-count">{count(roadmap.requirements, 'requirement')}</span>}
          </div>
          {roadmap.requirements === 0 && (admin.milestones ?? []).length === 0 ? (
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
          )}
          <div className="btn-row">
            <button type="button" className="btn-primary" onClick={onOpenProgramme}>
              Programme
            </button>
          </div>
        </Card>

        <Card className="pgce-section pgce-section--evidence">
          <div className="pgce-section-head">
            <span className="pgce-tile" aria-hidden="true">
              <IconBook size={20} />
            </span>
            <h2>Evidence &amp; reflections</h2>
            {(evidence > 0 || admin.reflections.length > 0) && (
              <span className="badge pgce-count">{count(evidence + admin.reflections.length, 'record')}</span>
            )}
          </div>
          <p className="filter-hint">
            {evidence > 0 || admin.reflections.length > 0
              ? `${count(evidence, 'session note/photo record')} tagged for evidence · ${count(admin.reflections.length, 'weekly reflection')}. Coverage shows what you have collected, not a competency score.`
              : 'Connect session notes to the Teachers’ Standards, or add your first weekly reflection — everything collects here.'}
          </p>
          <div className="btn-row">
            <button type="button" className="btn-primary" onClick={onOpenJournal}>
              Evidence journal
            </button>
            <button type="button" className="btn-today-reset" onClick={() => onOpenAdmin('reflect')}>
              Weekly reflections ({admin.reflections.length})
            </button>
          </div>
        </Card>

        <Card className="pgce-section pgce-section--development">
          <div className="pgce-section-head">
            <span className="pgce-tile" aria-hidden="true">
              <IconUser size={20} />
            </span>
            <h2>Development</h2>
            {developmentTotal > 0 && <span className="badge pgce-count">{count(developmentTotal, 'record')}</span>}
          </div>
          <p className="filter-hint">
            {openTargets > 0 || openActions > 0
              ? [openTargets > 0 ? count(openTargets, 'open target') : '', openActions > 0 ? `${count(openActions, 'mentor action')} to tick off` : '']
                  .filter(Boolean)
                  .join(' · ')
              : developmentTotal > 0
                ? `${count(developmentTotal, 'record')} across targets, meetings, observations, lessons and audits.`
                : 'Targets, observations, lessons and mentor meetings live here — add the first one from the menu.'}
          </p>
          <div className="btn-row">
            <QuickMenu
              label="Add or open a record"
              items={[
                { label: `Targets (${admin.targets.length})`, onSelect: () => onOpenAdmin('targets') },
                { label: `Mentor meetings (${admin.meetings.length})`, onSelect: () => onOpenAdmin('meetings') },
                { label: `Observations (${admin.observations.length})`, onSelect: () => onOpenAdmin('obs') },
                { label: `Lessons (${admin.lessons.length})`, onSelect: () => onOpenAdmin('lessons') },
                { label: `Audits (${admin.audits.length})`, onSelect: () => onOpenAdmin('audits') },
              ]}
            />
            <button type="button" className="btn-today-reset" onClick={() => onOpenAdmin('overview')}>
              All development records →
            </button>
          </div>
        </Card>

        <Card className="pgce-section pgce-section--documents">
          <div className="pgce-section-head">
            <span className="pgce-tile" aria-hidden="true">
              <IconNote size={20} />
            </span>
            <h2>Documents &amp; reports</h2>
            {walletCount !== null && walletCount > 0 && <span className="badge pgce-count">{count(walletCount, 'file')}</span>}
          </div>
          <p className="filter-hint">
            {walletCount === null
              ? 'Keep your documents together on this device. Export a review pack when ready.'
              : walletCount > 0
                ? `${count(walletCount, 'file')} in the wallet on this device. Files do not sync between devices yet. Export a review pack when ready.`
                : 'Keep DBS letters, certificates and school documents in the wallet — stored on this device. Export a review pack when ready.'}
          </p>
          <div className="btn-row">
            <button type="button" className="btn-primary" onClick={() => onOpenAdmin('wallet')}>
              Open wallet
            </button>
            <button type="button" className="btn-today-reset" onClick={() => onOpenAdmin('overview')}>
              <IconPrint /> Print binder &amp; exports
            </button>
            <button type="button" className="btn-today-reset" onClick={onOpenStats}>
              <IconChart /> Term stats &amp; attendance
            </button>
          </div>
        </Card>
      </div>

      <p className="filter-hint pgce-privacy">
        <IconShield size={16} /> Your records stay private on this device until you export or share them.
      </p>
    </div>
  )
}
