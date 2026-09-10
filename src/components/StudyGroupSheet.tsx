import { useEffect, useState } from 'react'
import {
  DEFAULT_MIN_MEETING,
  DEFAULT_WORK_END,
  DEFAULT_WORK_START,
  intersectAvailability,
  lastUpdatedLabel,
  memberFreshness,
  proposalEvent,
} from '../../shared/availability.js'
import { useModalA11y } from '../lib/a11y'
import { DEFAULT_PUSH_BASE } from '../lib/config'
import {
  ProposalConflict,
  computeFreeSlots,
  createGroup,
  fetchGroup,
  fmtSlotTime,
  joinGroup,
  leaveGroup,
  markPublished,
  proposeSlot,
  respondProposal,
  shouldPublish,
} from '../lib/groups'
import type { FreeSlot, GroupState, Proposal } from '../lib/groups'
import { downloadICS } from '../lib/ics'
import type { Session, Settings } from '../types'
import { IconClose } from './ui'

interface Props {
  settings: Settings
  /** filtered sessions (all dates) for computing free slots — course sessions
   *  plus opted-in personal busy commitments, already merged by the caller */
  sessions: Session[]
  todayISO: string
  onUpdateSettings: (patch: Partial<Settings>) => void
  onClose: () => void
}

function formatSlotDay(dateISO: string): string {
  const [y, m, d] = dateISO.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
}

const HOURS = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]

export function StudyGroupSheet({ settings, sessions, todayISO, onUpdateSettings, onClose }: Props) {
  const dialogRef = useModalA11y<HTMLDivElement>(onClose)
  const base = settings.pushServerBase ?? DEFAULT_PUSH_BASE
  const [name, setName] = useState(settings.groupName ?? '')
  const [codeInput, setCodeInput] = useState('')
  const [group, setGroup] = useState<GroupState | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [pendingProposal, setPendingProposal] = useState<FreeSlot | null>(null)

  const workStart = settings.groupWorkStart ?? DEFAULT_WORK_START
  const workEnd = settings.groupWorkEnd ?? DEFAULT_WORK_END
  const minMeeting = settings.groupMinMeeting ?? 45

  const mySlots = () =>
    computeFreeSlots(sessions, todayISO, 7, { workStart, workEnd, minMinutes: minMeeting })
  const creds = () => ({ memberId: settings.groupMemberId, token: settings.groupToken })

  async function refresh(code: string, displayName: string) {
    // Publish only when the slots changed or the freshness policy requires a
    // republish (P6-05) — reading the group never needs a write.
    const slots = mySlots()
    if (shouldPublish(code, slots)) {
      const next = await joinGroup(base, code, displayName, slots, creds())
      markPublished(code, slots)
      if (next.memberId !== settings.groupMemberId || next.token !== settings.groupToken) {
        onUpdateSettings({ groupMemberId: next.memberId, groupToken: next.token })
      }
    }
    setGroup(await fetchGroup(base, code))
  }

  useEffect(() => {
    if (settings.groupCode && settings.groupName) {
      setBusy(true)
      refresh(settings.groupCode, settings.groupName)
        .catch((err) => setError(err instanceof Error ? err.message : 'Could not load the group.'))
        .finally(() => setBusy(false))
    }
    // Re-run when working hours / minimum length change: the slots change, so
    // the publish guard republishes and the intersection recomputes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workStart, workEnd, minMeeting])

  async function run(action: () => Promise<void>) {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await action()
    } catch (err) {
      if (err instanceof ProposalConflict) {
        setNotice(err.message)
        if (settings.groupCode) setGroup(await fetchGroup(base, settings.groupCode).catch(() => group))
      } else {
        setError(err instanceof Error ? err.message : 'Something went wrong.')
      }
    } finally {
      setBusy(false)
    }
  }

  const handleCreate = () =>
    run(async () => {
      const slots = mySlots()
      const created = await createGroup(base, name.trim(), slots)
      markPublished(created.code, slots)
      onUpdateSettings({
        groupCode: created.code,
        groupName: name.trim(),
        groupMemberId: created.memberId,
        groupToken: created.token,
      })
      setGroup(await fetchGroup(base, created.code))
    })

  const handleJoin = () =>
    run(async () => {
      const code = codeInput.trim().toUpperCase()
      const slots = mySlots()
      const joined = await joinGroup(base, code, name.trim(), slots)
      markPublished(code, slots)
      onUpdateSettings({
        groupCode: code,
        groupName: name.trim(),
        groupMemberId: joined.memberId,
        groupToken: joined.token,
      })
      setGroup(await fetchGroup(base, code))
    })

  const handleLeave = () =>
    run(async () => {
      if (settings.groupCode && settings.groupName) {
        await leaveGroup(base, settings.groupCode, settings.groupName, creds())
      }
      onUpdateSettings({
        groupCode: undefined,
        groupName: undefined,
        groupMemberId: undefined,
        groupToken: undefined,
      })
      setGroup(null)
    })

  const handlePropose = (slot: FreeSlot) =>
    run(async () => {
      const proposal = await proposeSlot(base, settings.groupCode!, creds(), slot)
      setPendingProposal(null)
      setGroup((g) => (g ? { ...g, proposals: [...g.proposals.filter((p) => p.id !== proposal.id), proposal] } : g))
    })

  const handleRespond = (p: Proposal, action: 'yes' | 'no' | 'withdraw') =>
    run(async () => {
      const updated = await respondProposal(base, settings.groupCode!, creds(), p.id, p.rev, action)
      setGroup((g) => (g ? { ...g, proposals: g.proposals.map((x) => (x.id === updated.id ? updated : x)) } : g))
    })

  const now = Date.now()
  const members = group?.members ?? null
  const availability =
    members && members.length > 1
      ? intersectAvailability(members, { minMinutes: minMeeting, now, workStart, workEnd })
      : null
  const memberName = (id: string) => members?.find((m) => m.memberId === id)?.name ?? 'someone who left'
  const canPropose = !!settings.groupMemberId && !!settings.groupToken
  const openProposals = (group?.proposals ?? []).filter((p) => p.status === 'open')

  const exportProposal = (p: Proposal) => {
    downloadICS(
      [proposalEvent(settings.groupCode!, p) as unknown as Session],
      'Study group',
      `study-group-${p.slot.d}.ics`
    )
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div ref={dialogRef} className="modal-card sheet" role="dialog" aria-modal="true" aria-label="Study group" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-header">
          <h2>Study group</h2>
          <button type="button" className="btn-icon" onClick={onClose} aria-label="Close">
            <IconClose />
          </button>
        </div>
        {!settings.groupCode ? (
          <>
            <p className="filter-hint">
              Find when you and your coursemates are all free. Only your free times are shared —
              never session details. Start with your display name:
            </p>
            <div className="feed-row">
              <input
                type="text"
                placeholder="Your display name"
                maxLength={24}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <section className="filter-section">
              <h3>Join an existing group</h3>
              <p className="filter-hint">
                Got a code from a coursemate? Enter it here. (They'll find it at the top of their
                Study group screen.)
              </p>
              <div className="feed-row">
                <input
                  type="text"
                  placeholder="Group code, e.g. K7M2PQ"
                  value={codeInput}
                  onChange={(e) => setCodeInput(e.target.value)}
                />
              </div>
              <button
                type="button"
                className="btn-primary"
                disabled={busy || !name.trim() || codeInput.trim().length < 4}
                onClick={handleJoin}
              >
                {busy ? 'Working…' : 'Join group'}
              </button>
            </section>
            <section className="filter-section">
              <h3>…or create a new group</h3>
              <p className="filter-hint">You'll get a code to share with your coursemates.</p>
              <button type="button" className="btn-secondary" disabled={busy || !name.trim()} onClick={handleCreate}>
                Create a group
              </button>
            </section>
          </>
        ) : (
          <>
            <p className="workload-line">
              Group code: <strong>{settings.groupCode}</strong> — coursemates join by opening
              Settings → Study group in their own app and entering this code.
            </p>
            {members && (
              <ul className="keydates-list group-members">
                {members.map((m) => {
                  const freshness = memberFreshness(m, now)
                  return (
                    <li key={m.memberId ?? m.name} className="keydate-line">
                      <span className="change-title">{m.name}</span>
                      <span className="filter-hint">
                        {freshness === 'missing'
                          ? 'no availability shared yet'
                          : `updated ${lastUpdatedLabel(m.at, now)}`}
                        {freshness === 'stale' ? ' — out of date, not counted as free' : ''}
                      </span>
                    </li>
                  )
                })}
              </ul>
            )}
            <section className="filter-section">
              <h3>Working hours</h3>
              <div className="feed-row group-hours">
                <select
                  aria-label="Working hours start"
                  className="date-input"
                  value={workStart}
                  onChange={(e) => onUpdateSettings({ groupWorkStart: Number(e.target.value) })}
                >
                  {HOURS.map((h) => (
                    <option key={h} value={h * 60}>{`${String(h).padStart(2, '0')}:00`}</option>
                  ))}
                </select>
                <span>to</span>
                <select
                  aria-label="Working hours end"
                  className="date-input"
                  value={workEnd}
                  onChange={(e) => onUpdateSettings({ groupWorkEnd: Number(e.target.value) })}
                >
                  {HOURS.filter((h) => h * 60 > workStart).map((h) => (
                    <option key={h} value={h * 60}>{`${String(h).padStart(2, '0')}:00`}</option>
                  ))}
                </select>
                <select
                  aria-label="Minimum meeting length"
                  className="date-input"
                  value={minMeeting}
                  onChange={(e) => onUpdateSettings({ groupMinMeeting: Number(e.target.value) })}
                >
                  {[DEFAULT_MIN_MEETING, 45, 60, 90].map((m) => (
                    <option key={m} value={m}>{`≥ ${m} min`}</option>
                  ))}
                </select>
              </div>
            </section>
            {availability && (
              <>
                <h3 className="subheading">When you're all free (next 7 days)</h3>
                {availability.excluded.length > 0 && (
                  <p className="filter-hint">
                    Not counted (availability {availability.excluded.some((e) => e.reason === 'stale') ? 'out of date' : 'missing'}):{' '}
                    {availability.excluded.map((e) => e.name).join(', ')} — they may not actually be
                    free at these times.
                  </p>
                )}
                {availability.slots.length === 0 ? (
                  <p className="filter-hint">No common free slots found.</p>
                ) : (
                  <ul className="keydates-list">
                    {availability.slots.slice(0, 10).map((slot, i) => (
                      <li key={i} className="keydate-line">
                        <span className="kd-chip">{formatSlotDay(slot.d)}</span>
                        <span className="change-title">
                          {fmtSlotTime(slot.from)} – {fmtSlotTime(slot.to)}
                        </span>
                        {canPropose && (
                          <button
                            type="button"
                            className="btn-secondary btn-inline"
                            disabled={busy}
                            onClick={() => setPendingProposal(slot)}
                          >
                            Propose
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                {pendingProposal && (
                  <div className="group-propose-confirm">
                    <p className="filter-hint">
                      Propose <strong>{formatSlotDay(pendingProposal.d)} {fmtSlotTime(pendingProposal.from)}–{fmtSlotTime(pendingProposal.to)}</strong>?
                      Everyone in the group will see it and can accept or decline. Nothing is sent
                      until you press Send.
                    </p>
                    <div className="btn-row">
                      <button type="button" className="btn-primary" disabled={busy} onClick={() => void handlePropose(pendingProposal)}>
                        Send proposal
                      </button>
                      <button type="button" className="btn-secondary" disabled={busy} onClick={() => setPendingProposal(null)}>
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
            {members && members.length === 1 && (
              <p className="filter-hint">Waiting for others to join — common slots appear when they do.</p>
            )}
            {openProposals.length > 0 && members && (
              <>
                <h3 className="subheading">Proposed meet-ups</h3>
                <ul className="keydates-list">
                  {openProposals.map((p) => {
                    const current = members.filter((m) => m.memberId)
                    const yes = current.filter((m) => p.responses[m.memberId!] === 'yes')
                    const accepted = current.length > 1 && yes.length === current.length
                    const mine = p.responses[settings.groupMemberId ?? '']
                    return (
                      <li key={p.id} className="keydate-line group-proposal">
                        <span className="kd-chip">{formatSlotDay(p.slot.d)}</span>
                        <span className="change-title">
                          {fmtSlotTime(p.slot.from)} – {fmtSlotTime(p.slot.to)}
                          <span className="filter-hint">
                            {' '}by {memberName(p.by)} ·{' '}
                            {accepted
                              ? 'everyone accepted 🎉'
                              : current
                                  .map((m) => `${m.name} ${p.responses[m.memberId!] === 'yes' ? '✓' : p.responses[m.memberId!] === 'no' ? '✗' : '…'}`)
                                  .join(', ')}
                          </span>
                        </span>
                        {canPropose && (
                          <span className="btn-row group-proposal-actions">
                            {mine !== 'yes' && (
                              <button type="button" className="btn-secondary btn-inline" disabled={busy} onClick={() => void handleRespond(p, 'yes')}>
                                Can make it
                              </button>
                            )}
                            {mine !== 'no' && (
                              <button type="button" className="btn-secondary btn-inline" disabled={busy} onClick={() => void handleRespond(p, 'no')}>
                                Can't
                              </button>
                            )}
                            {p.by === settings.groupMemberId && (
                              <button type="button" className="btn-secondary btn-inline" disabled={busy} onClick={() => void handleRespond(p, 'withdraw')}>
                                Withdraw
                              </button>
                            )}
                            {accepted && (
                              <button type="button" className="btn-secondary btn-inline" onClick={() => exportProposal(p)}>
                                Add to my calendar
                              </button>
                            )}
                          </span>
                        )}
                      </li>
                    )
                  })}
                </ul>
                <p className="filter-hint">
                  “Add to my calendar” downloads an .ics to YOUR calendar only — coursemates add it
                  from their own app.
                </p>
              </>
            )}
            <div className="btn-row">
              <button
                type="button"
                className="btn-secondary"
                disabled={busy}
                onClick={() => void run(() => refresh(settings.groupCode!, settings.groupName!))}
              >
                {busy ? 'Working…' : '↻ Refresh'}
              </button>
              <button type="button" className="btn-secondary" disabled={busy} onClick={handleLeave}>
                Leave group
              </button>
            </div>
          </>
        )}
        {notice && <p className="filter-hint">{notice}</p>}
        {error && (
          <div className="btn-row">
            <p className="setup-error">{error}</p>
            {settings.groupCode && (
              <button
                type="button"
                className="btn-secondary"
                disabled={busy}
                onClick={() => void run(() => refresh(settings.groupCode!, settings.groupName!))}
              >
                Try again
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
