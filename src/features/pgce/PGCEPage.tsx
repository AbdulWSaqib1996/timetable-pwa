import { useEffect, useState } from 'react'
import { Card, PageHeader } from '../../components/ui'
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
}

/**
 * PGCE file destination (P4-07): four understandable sections over every
 * existing record type. Counts link straight into the underlying lists;
 * empty states invite a first entry instead of flagging failure.
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

  const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`

  return (
    <div className="page page-pgce">
      <PageHeader title="PGCE file" subtitle={profileName} />

      {activeCourse().features.placement && (
      <Card className="pgce-section">
        <div className="pgce-section-head">
          <h2>Placement</h2>
          <button type="button" className="btn-today-reset" onClick={onOpenPlacements}>
            View →
          </button>
        </div>
        <p className="filter-hint">
          {placement.blocks > 0
            ? `${placement.attendedDays}${placement.targetDays ? ` of ${placement.targetDays}` : ''} school day${placement.attendedDays === 1 && !placement.targetDays ? '' : 's'} logged across ${count(placement.blocks, 'block')} — tick Attended on a placement day to log it. School and mentor details live on any session of the block.`
            : 'Placement blocks from your timetable appear here — school details, mentor and logged days.'}
        </p>
      </Card>
      )}

      <Card className="pgce-section">
        <div className="pgce-section-head">
          <h2>Evidence &amp; reflections</h2>
          <button type="button" className="btn-today-reset" onClick={onOpenJournal}>
            Journal →
          </button>
        </div>
        <p className="filter-hint">
          {evidence > 0 || admin.reflections.length > 0
            ? `${count(evidence, 'session note/photo record')} tagged for evidence · ${count(admin.reflections.length, 'weekly reflection')}. Coverage shows what you have collected, not a competency score.`
            : 'Add your first reflection, or tag a session note against the Teachers’ Standards — everything collects here.'}
        </p>
        <div className="btn-row">
          <button type="button" className="btn-secondary" onClick={() => onOpenAdmin('reflect')}>
            Weekly reflections ({admin.reflections.length})
          </button>
          <button type="button" className="btn-secondary" onClick={onOpenJournal}>
            Evidence journal
          </button>
        </div>
      </Card>

      <Card className="pgce-section">
        <div className="pgce-section-head">
          <h2>Development</h2>
          <button type="button" className="btn-today-reset" onClick={() => onOpenAdmin('overview')}>
            Open →
          </button>
        </div>
        {openTargets > 0 || openActions > 0 ? (
          <p className="filter-hint">
            {openTargets > 0 ? `${count(openTargets, 'open target')}` : ''}
            {openTargets > 0 && openActions > 0 ? ' · ' : ''}
            {openActions > 0 ? `${count(openActions, 'mentor action')} to tick off` : ''}
          </p>
        ) : (
          <p className="filter-hint">Targets, mentor meetings, observations, lessons and audits live here.</p>
        )}
        <div className="btn-row pgce-dev-row">
          <button type="button" className="btn-secondary" onClick={() => onOpenAdmin('targets')}>
            Targets ({admin.targets.length})
          </button>
          <button type="button" className="btn-secondary" onClick={() => onOpenAdmin('meetings')}>
            Meetings ({admin.meetings.length})
          </button>
          <button type="button" className="btn-secondary" onClick={() => onOpenAdmin('obs')}>
            Observations ({admin.observations.length})
          </button>
          <button type="button" className="btn-secondary" onClick={() => onOpenAdmin('lessons')}>
            Lessons ({admin.lessons.length})
          </button>
          <button type="button" className="btn-secondary" onClick={() => onOpenAdmin('audits')}>
            Audits ({admin.audits.length})
          </button>
        </div>
      </Card>

      <Card className="pgce-section">
        <div className="pgce-section-head">
          <h2>Documents</h2>
          <button type="button" className="btn-today-reset" onClick={() => onOpenAdmin('wallet')}>
            Wallet →
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
          <button type="button" className="btn-secondary" onClick={() => onOpenAdmin('overview')}>
            Print binder &amp; exports
          </button>
          <button type="button" className="btn-secondary" onClick={onOpenStats}>
            Term stats
          </button>
        </div>
      </Card>
    </div>
  )
}
