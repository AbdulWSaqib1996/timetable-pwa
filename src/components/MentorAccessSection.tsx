import { useEffect, useState } from 'react'
import { CopyButton } from './CopyButton'
import { IconUser } from './ui'
import { absorbInbox, createInvite, ensureMentorSpace, fetchInbox, listMentors, mentorLoginLink, revokeMentor } from '../lib/mentor'
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

/**
 * Settings → Data & devices → Mentor access (G4). Turn the space on, mint
 * single-use invitation links, see who has joined and end anyone's access at
 * once, and pull signed feedback into the PGCE file as reviewer-authenticated
 * observations. Mentors only ever see the packs shared with them.
 */
export function MentorAccessSection({ settings, admin, onUpdateSettings, onUpdateAdmin }: Props) {
  const todayISO = new Date().toISOString().slice(0, 10)
  const enabled = !!settings.mentorSpaceId && !!settings.mentorOwnerToken
  const space: MentorSpace | null = enabled ? { spaceId: settings.mentorSpaceId!, ownerToken: settings.mentorOwnerToken! } : null
  const [listing, setListing] = useState<MentorListing | null>(null)
  const [label, setLabel] = useState('')
  const [invite, setInvite] = useState<{ link: string; expiresAt: number; label: string } | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const refresh = async (s: MentorSpace) => {
    try {
      setListing(await listMentors(settings, s))
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Could not load your mentors.')
    }
  }
  useEffect(() => {
    if (space) void refresh(space)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.mentorSpaceId])

  const run = async (work: () => Promise<void>) => {
    setBusy(true)
    setMsg(null)
    try {
      await work()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="filter-section" id="mentor-access">
      <div className="section-head">
        <span className="ui-tile ui-tile--violet" aria-hidden="true"><IconUser size={20} /></span>
        <h3 tabIndex={-1}>Mentor access</h3>
        <span className="badge">{enabled ? 'On' : 'Off'}</span>
      </div>
      <p className="filter-hint">
        Invite a mentor or tutor to a portal where they see only the review packs you share and can leave feedback. Their feedback arrives here signed by the service and is shown as reviewer-authenticated; you cannot edit its text. End anyone's access at any time.
      </p>
      {!enabled ? (
        <div className="btn-row">
          <button type="button" className="btn-primary" disabled={busy} onClick={() => void run(async () => { await ensureMentorSpace(settings, onUpdateSettings) })}>Turn on mentor access</button>
        </div>
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
          {listing && (
            <>
              {listing.invites.length > 0 && <p className="filter-hint">{listing.invites.length} invitation{listing.invites.length === 1 ? '' : 's'} not yet used.</p>}
              {listing.mentors.length === 0 ? <p className="filter-hint">No mentor has joined yet.</p> : (
                <ul className="workspace-list" aria-label="Mentors">
                  {listing.mentors.map((m) => (
                    <li key={m.id} className="workspace-row requirement-row">
                      <span>
                        <strong>{m.name}</strong> <span className="filter-hint">· joined {fmt(m.createdAt)}{m.lastSeenAt ? ` · last seen ${fmt(m.lastSeenAt)}` : ''}</span>
                        {m.revokedAt ? <span className="tag tag--amber"> Access ended</span> : <span className="tag tag--teal"> Active</span>}
                      </span>
                      {!m.revokedAt && (
                        <span className="requirement-confirm">
                          <CopyButton text={mentorLoginLink(space!.spaceId, m.id)} label="Copy sign-in link" />
                          <button type="button" className="travel-link" disabled={busy} onClick={() => void run(async () => { await revokeMentor(settings, space!, m.id); await refresh(space!) })}>End access</button>
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {listing.packs.length > 0 && <p className="filter-hint">{listing.packs.length} pack{listing.packs.length === 1 ? '' : 's'} shared so far (from Review packs in the PGCE file).</p>}
            </>
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
            <button type="button" className="btn-today-reset" disabled={busy} onClick={() => { onUpdateSettings({ mentorSpaceId: undefined, mentorOwnerToken: undefined }); setListing(null); setInvite(null); setMsg('Mentor access turned off on this device. Mentors already joined keep the packs they were shared until you end their access from a device that still has the space.') }}>Turn off on this device</button>
          </div>
        </>
      )}
      {msg && <p className="filter-hint" role="status">{msg}</p>}
    </section>
  )
}
