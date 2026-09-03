import { useEffect, useState } from 'react'
import { DEFAULT_PUSH_BASE } from '../lib/config'
import {
  computeFreeSlots,
  createGroup,
  fetchGroup,
  fmtSlotTime,
  intersectSlots,
  joinGroup,
  leaveGroup,
} from '../lib/groups'
import type { GroupMember } from '../lib/groups'
import type { Session, Settings } from '../types'

interface Props {
  settings: Settings
  /** filtered sessions (all dates) for computing free slots */
  sessions: Session[]
  todayISO: string
  onUpdateSettings: (patch: Partial<Settings>) => void
  onClose: () => void
}

function formatSlotDay(dateISO: string): string {
  const [y, m, d] = dateISO.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
}

export function StudyGroupSheet({ settings, sessions, todayISO, onUpdateSettings, onClose }: Props) {
  const base = settings.pushServerBase ?? DEFAULT_PUSH_BASE
  const [name, setName] = useState(settings.groupName ?? '')
  const [codeInput, setCodeInput] = useState('')
  const [members, setMembers] = useState<GroupMember[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const mySlots = () => computeFreeSlots(sessions, todayISO)

  async function refresh(code: string, displayName: string) {
    // republish my current slots, then read everyone's
    await joinGroup(base, code, displayName, mySlots())
    setMembers(await fetchGroup(base, code))
  }

  useEffect(() => {
    if (settings.groupCode && settings.groupName) {
      setBusy(true)
      refresh(settings.groupCode, settings.groupName)
        .catch((err) => setError(err instanceof Error ? err.message : 'Could not load the group.'))
        .finally(() => setBusy(false))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function run(action: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await action()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  const handleCreate = () =>
    run(async () => {
      const code = await createGroup(base, name.trim(), mySlots())
      onUpdateSettings({ groupCode: code, groupName: name.trim() })
      setMembers(await fetchGroup(base, code))
    })

  const handleJoin = () =>
    run(async () => {
      const code = codeInput.trim().toUpperCase()
      await joinGroup(base, code, name.trim(), mySlots())
      onUpdateSettings({ groupCode: code, groupName: name.trim() })
      setMembers(await fetchGroup(base, code))
    })

  const handleLeave = () =>
    run(async () => {
      if (settings.groupCode && settings.groupName) await leaveGroup(base, settings.groupCode, settings.groupName)
      onUpdateSettings({ groupCode: undefined, groupName: undefined })
      setMembers(null)
    })

  const common = members && members.length > 1 ? intersectSlots(members.map((m) => m.slots)) : []

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card sheet" role="dialog" aria-label="Study group" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-header">
          <h2>Study group</h2>
          <button type="button" className="btn-icon" onClick={onClose} aria-label="Close">
            ✕
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
              <p className="filter-hint">
                {members.length} member{members.length === 1 ? '' : 's'}:{' '}
                {members.map((m) => m.name).join(', ')}
              </p>
            )}
            {members && members.length > 1 && (
              <>
                <h3 className="subheading">When you're all free (next 7 days)</h3>
                {common.length === 0 ? (
                  <p className="filter-hint">No common free slots found.</p>
                ) : (
                  <ul className="keydates-list">
                    {common.slice(0, 10).map((slot, i) => (
                      <li key={i} className="keydate-line">
                        <span className="kd-chip">{formatSlotDay(slot.d)}</span>
                        <span className="change-title">
                          {fmtSlotTime(slot.from)} – {fmtSlotTime(slot.to)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
            {members && members.length === 1 && (
              <p className="filter-hint">Waiting for others to join — common slots appear when they do.</p>
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
        {error && <p className="setup-error">{error}</p>}
      </div>
    </div>
  )
}
