import { useEffect, useState } from 'react'
import { CopyButton } from './CopyButton'
import { IconUser } from './ui'
import { absorbInbox, closeMentorSpace, createInvite, ensureMentorSpace, fetchInbox, listMentors, mentorLoginLink, revokeMentor } from '../lib/mentor'
import type { MentorListing, MentorSpace } from '../lib/mentor'
import type { AdminFile } from '../lib/admin'
import type { Settings } from '../types'

interface Props {
  settings: Settings
  admin: AdminFile
  onUpdateSettings: (patch: Partial<Settings>) => void
  onUpdateAdmin: (updater: (prev: AdminFile) => AdminFile) => void
}

const fmt = (ms: number) => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
type Listing = { status: 'idle' } | { status: 'loading' } | { status: 'ready'; data: MentorListing } | { status: 'error'; message: string }

/**
 * Settings → Data & devices → Mentor access (G4; reworked in Pass 78 for
 * audit B06/B08). Turn the space on, mint single-use invitation links, see
 * who has joined and end anyone's access at once, and pull signed feedback
 * into the PGCE file as reviewer-authenticated observations.
 *
 * The mentor list is an explicit idle/loading/ready/error state keyed on the
 * space id AND the service base, with a named Retry — an error is never shown
 * as "no mentor yet". "Pause on this device" keeps the credential (it only
 * hides the controls here and never syncs); "End mentor access" is the
 * owner-authorised, service-side close with an impact preview first — it
 * denies every mentor route, deletes nothing and can be reopened.
 */
export function MentorAccessSection({ settings, admin, onUpdateSettings, onUpdateAdmin }: Props) {
  const todayISO = new Date().toISOString().slice(0, 10)
  const enabled = !!settings.mentorSpaceId && !!settings.mentorOwnerToken
  const paused = enabled && !!settings.mentorAccessPaused
  const space: MentorSpace | null = enabled ? { spaceId: settings.mentorSpaceId!, ownerToken: settings.mentorOwnerToken! } : null
  const [listing, setListing] = useState<Listing>({ status: 'idle' })
  const [label, setLabel] = useState('')
  const [invite, setInvite] = useState<{ link: string; expiresAt: number; label: string } | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [alert, setAlert] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmEnd, setConfirmEnd] = useState(false)
  const refresh = async (s: MentorSpace) => {
    setListing({ status: 'loading' })
    try {
      setListing({ status: 'ready', data: await listMentors(settings, s) })
    } catch (e) {
      setListing({ status: 'error', message: e instanceof Error ? e.message : 'Could not load your mentors.' })
    }
  }
  useEffect(() => {
    let live = true
    if (!space) {
      setListing({ status: 'idle' })
      return
    }
    setListing({ status: 'loading' })
    listMentors(settings, space)
      .then((data) => live && setListing({ status: 'ready', data }))
      .catch((e) => live && setListing({ status: 'error', message: e instanceof Error ? e.message : 'Could not load your mentors.' }))
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.mentorSpaceId, settings.pushServerBase])

  const run = async (work: () => Promise<void>) => {
    setBusy(true)
    setMsg(null)
    setAlert(null)
    try {
      await work()
    } catch (e) {
      setAlert(e instanceof Error ? e.message : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }
  const data = listing.status === 'ready' ? listing.data : null
  const closed = !!data?.closedAt
  const activeMentors = data?.mentors.filter((m) => !m.revokedAt) ?? []
  const sharedPacks = data?.packs.filter((p) => p.mentorIds.length > 0) ?? []

  const mentorList = data && (
    <>
      {data.invites.length > 0 && <p className="filter-hint">{data.invites.length} invitation{data.invites.length === 1 ? '' : 's'} not yet used.</p>}
      {data.mentors.length === 0 ? <p className="filter-hint">No mentor has joined yet.</p> : (
        <ul className="workspace-list" aria-label="Mentors">
          {data.mentors.map((m) => (
            <li key={m.id} className="workspace-row requirement-row">
              <span>
                <strong>{m.name}</strong> <span className="filter-hint">· joined {fmt(m.createdAt)}{m.lastSeenAt ? ` · last seen ${fmt(m.lastSeenAt)}` : ''}</span>
                {m.revokedAt ? <span className="tag tag--amber"> Access ended</span> : closed ? <span className="tag tag--amber"> Space closed</span> : <span className="tag tag--teal"> Active</span>}
              </span>
              {!m.revokedAt && (
                <span className="requirement-confirm">
                  {!closed && <CopyButton text={mentorLoginLink(space!.spaceId, m.id)} label="Copy sign-in link" />}
                  <button type="button" className="travel-link" disabled={busy} onClick={() => void run(async () => { await revokeMentor(settings, space!, m.id); setMsg(`${m.name}’s access has ended.`); await refresh(space!) })}>End access</button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {data.packs.length > 0 && <p className="filter-hint">{sharedPacks.length} of {data.packs.length} pack{data.packs.length === 1 ? '' : 's'} currently shared (from Review packs in the PGCE file).</p>}
    </>
  )
  const listState = listing.status === 'loading' ? (
    <p className="filter-hint" aria-busy="true">Loading your mentors…</p>
  ) : listing.status === 'error' ? (
    <p className="filter-hint" role="alert">{listing.message} <button type="button" className="travel-link" onClick={() => space && void refresh(space)}>Retry</button></p>
  ) : mentorList

  return (
    <section className="filter-section" id="mentor-access">
      <div className="section-head">
        <span className="ui-tile ui-tile--violet" aria-hidden="true"><IconUser size={20} /></span>
        <h3 tabIndex={-1}>Mentor access</h3>
        <span className="badge">{!enabled ? 'Off' : closed ? 'Ended' : paused ? 'Paused here' : 'On'}</span>
      </div>
      <p className="filter-hint">
        Invite a mentor or tutor to a portal where they see only the review packs you share and can leave feedback. Their feedback arrives here signed by the service and is shown as reviewer-authenticated; you cannot edit its text. End anyone's access at any time.
      </p>
      {!enabled ? (
        <div className="btn-row">
          <button type="button" className="btn-primary" disabled={busy} onClick={() => void run(async () => { await ensureMentorSpace(settings, onUpdateSettings); setMsg('Mentor access is on. Create an invitation link to bring a mentor in.') })}>Turn on mentor access</button>
        </div>
      ) : paused ? (
        <>
          <p className="filter-hint">Paused on this device: invitations and feedback checks are hidden here, but your mentor space and its credential are kept and still sync to your other devices. Mentors keep the access they have.</p>
          <div className="btn-row">
            <button type="button" className="btn-primary" disabled={busy} onClick={() => { onUpdateSettings({ mentorAccessPaused: false }); setMsg('Mentor access resumed on this device.') }}>Resume on this device</button>
          </div>
        </>
      ) : closed ? (
        <>
          <p className="filter-hint">Mentor access ended{data?.closedAt ? ` on ${fmt(data.closedAt)}` : ''}: no mentor can sign in or open a pack. Nothing was deleted — reopen to restore exactly what was shared.</p>
          <div className="btn-row">
            <button type="button" className="btn-primary" disabled={busy} onClick={() => void run(async () => { await closeMentorSpace(settings, space!, 'reopen'); setMsg('Mentor access reopened. Mentors sign in with their existing passphrase.'); await refresh(space!) })}>Reopen mentor access</button>
          </div>
        </>
      ) : (
        <>
          <div className="task-edit-row">
            <input type="text" className="placement-input" aria-label="Invitation label" placeholder="Who is this for? (e.g. school mentor)" value={label} onChange={(e) => setLabel(e.target.value)} />
            <button type="button" className="btn-primary" disabled={busy || !space} onClick={() => void run(async () => { const inv = await createInvite(settings, space!, label.trim()); setInvite({ link: inv.link, expiresAt: inv.expiresAt, label: label.trim() }); setLabel(''); await refresh(space!) })}>Create invitation link</button>
          </div>
          {invite && (
            <div className="callout callout--amber" aria-label="Invitation">
              <p>Send this link to {invite.label || 'your mentor'} — it works once and expires {fmt(invite.expiresAt)}. Anyone with the link can join, so send it privately.</p>
              <p className="settings-url sync-code" aria-label="Invitation link">{invite.link}</p>
              <div className="btn-row"><CopyButton text={invite.link} label="Copy invitation link" /></div>
            </div>
          )}
          <div className="btn-row">
            <button
              type="button"
              className="btn-today-reset"
              disabled={busy || !space}
              onClick={() => void run(async () => {
                const items = await fetchInbox(settings, space!, 0)
                const added = absorbInbox(admin, items, todayISO).added
                onUpdateAdmin((prev) => absorbInbox(prev, items, todayISO).file)
                onUpdateSettings({ mentorInboxAt: Date.now() })
                setMsg(added > 0 ? `${added} new feedback record${added === 1 ? '' : 's'} added to your PGCE file (reviewer-authenticated).` : 'No new feedback.')
              })}
            >
              Check for feedback
            </button>
            <button type="button" className="btn-today-reset" disabled={busy} onClick={() => { onUpdateSettings({ mentorAccessPaused: true }); setInvite(null); setConfirmEnd(false); setMsg('Paused on this device. Your mentor space is kept; mentors keep their access until you end it under Manage shared access.') }}>Pause on this device</button>
          </div>
        </>
      )}
      {enabled && (
        <details className="journey-steps mentor-manage">
          <summary><span>Manage shared access</span></summary>
          {listState}
          {!closed && data && (
            <div className="btn-row">
              <button type="button" className="btn-today-reset" disabled={busy} onClick={() => setConfirmEnd(true)}>End mentor access</button>
            </div>
          )}
          {confirmEnd && !closed && (
            <div className="callout callout--amber" aria-label="End mentor access">
              <p><strong>Ending mentor access</strong> signs out {activeMentors.length} active mentor{activeMentors.length === 1 ? '' : 's'} and takes {sharedPacks.length} shared pack{sharedPacks.length === 1 ? '' : 's'} out of reach across all your devices — nobody can sign in or open a pack until you reopen. Nothing is deleted; feedback already collected stays in your PGCE file. Copies mentors already downloaded cannot be recalled.</p>
              <div className="btn-row">
                <button type="button" className="btn-primary" disabled={busy} onClick={() => void run(async () => { await closeMentorSpace(settings, space!, 'close'); setConfirmEnd(false); setMsg('Mentor access ended. Reopen it here whenever you want.'); await refresh(space!) })}>End mentor access now</button>
                <button type="button" className="btn-ghost" onClick={() => setConfirmEnd(false)}>Keep access</button>
              </div>
            </div>
          )}
        </details>
      )}
      {alert && <p className="filter-hint" role="alert">{alert}</p>}
      <p className="filter-hint" role="status" aria-live="polite">{msg ?? ''}</p>
    </section>
  )
}
