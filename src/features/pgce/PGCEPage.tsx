import { useEffect, useState } from 'react'
import { Card, PageHeader, QuickMenu, SettingsAction } from '../../components/ui'
import type { AdminFile } from '../../lib/admin'
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
  onOpenSettings: () => void
}

/**
 * PGCE file destination (P4-07; R3 / TT-20 hierarchy): four stable section
 * cards — Placement, Evidence, Development, Documents — each with ONE
 * dominant action, one short summary and a restrained "View all". Record
 * types are reached from Development's menu rather than a row of
 * equal-weight buttons; every existing record type stays one tap away.
 * Counts describe what has been collected, never a competency score.
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
  onOpenSettings,
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

  return (
    <div className="page page-pgce">
      <PageHeader title="PGCE file" subtitle={profileName} actions={<SettingsAction onOpen={onOpenSettings} />} />

      {activeCourse().features.placement && (
        <Card className="pgce-section">
          <div className="pgce-section-head">
            <h2>Placement</h2>
            <button type="button" className="btn-today-reset" onClick={onOpenPlacements}>
              View all →
            </button>
          </div>
          <p className="filter-hint">
            {placement.blocks > 0
              ? `${placement.attendedDays}${placement.targetDays ? ` of ${placement.targetDays}` : ''} school day${placement.attendedDays === 1 && !placement.targetDays ? '' : 's'} logged across ${count(placement.blocks, 'block')}. A logged day is one you ticked Attended on; school and mentor details live on any session of the block.`
              : 'Placement blocks from your timetable appear here — school details, mentor and logged days.'}
          </p>
          <div className="btn-row">
            <button type="button" className="btn-primary" onClick={onOpenPlacements}>
              {placement.blocks > 0 ? 'Open placements' : 'Set up placements'}
            </button>
          </div>
        </Card>
      )}

      <Card className="pgce-section">
        <div className="pgce-section-head">
          <h2>Evidence &amp; reflections</h2>
          <button type="button" className="btn-today-reset" onClick={() => onOpenAdmin('reflect')}>
            View all →
          </button>
        </div>
        <p className="filter-hint">
          {evidence > 0 || admin.reflections.length > 0
            ? `${count(evidence, 'session note/photo record')} tagged for evidence · ${count(admin.reflections.length, 'weekly reflection')}. Coverage shows what you have collected, not a competency score.`
            : 'Add your first reflection, or tag a session note against the Teachers’ Standards — everything collects here.'}
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

      <Card className="pgce-section">
        <div className="pgce-section-head">
          <h2>Development</h2>
          <button type="button" className="btn-today-reset" onClick={() => onOpenAdmin('overview')}>
            View all →
          </button>
        </div>
        <p className="filter-hint">
          {openTargets > 0 || openActions > 0
            ? [openTargets > 0 ? count(openTargets, 'open target') : '', openActions > 0 ? `${count(openActions, 'mentor action')} to tick off` : '']
                .filter(Boolean)
                .join(' · ')
            : developmentTotal > 0
              ? `${count(developmentTotal, 'record')} across targets, meetings, observations, lessons and audits.`
              : 'Targets, mentor meetings, observations, lessons and audits live here — add the first one from the menu.'}
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
        </div>
      </Card>

      <Card className="pgce-section">
        <div className="pgce-section-head">
          <h2>Documents</h2>
          <button type="button" className="btn-today-reset" onClick={() => onOpenAdmin('wallet')}>
            View all →
          </button>
        </div>
        <p className="filter-hint">
          {walletCount === null
            ? 'Wallet files are stored on this device.'
            : walletCount > 0
              ? `${count(walletCount, 'file')} in the wallet on this device. Files do not sync between devices yet.`
              : 'Keep DBS letters, certificates and school documents in the wallet — stored on this device.'}
        </p>
        <div className="btn-row">
          <button type="button" className="btn-primary" onClick={() => onOpenAdmin('wallet')}>
            Open wallet
          </button>
          <button type="button" className="btn-today-reset" onClick={() => onOpenAdmin('overview')}>
            Print binder &amp; exports
          </button>
          <button type="button" className="btn-today-reset" onClick={onOpenStats}>
            Term stats
          </button>
        </div>
      </Card>
    </div>
  )
}
