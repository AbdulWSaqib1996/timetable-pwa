import { MENTOR_ATTACHMENT_MAX_BYTES, bytesToBase64, encryptBytes, randomHex, sha256Hex, validAttestation } from '../../shared/mentor.js'
import type { Attestation } from '../../shared/mentor.js'
import { DEFAULT_PUSH_BASE } from './config'
import { newAdminId } from './admin'
import type { AdminFile, Observation } from './admin'
import type { Settings } from '../types'

/**
 * Learner-side client for the mentor portal (G4). The space id and owner
 * token live in Settings (synced between the learner's own devices, never
 * shared with mentors). Attachments are encrypted here with a fresh key per
 * file before upload. Feedback pulled from the inbox becomes an observation
 * with `sourceType: 'reviewer-authenticated'` and the worker's attestation;
 * the text of such a record is never editable in the app.
 *
 * Pass 78 (audit B05/B06): every call is bounded by a timeout and fails with
 * a MentorServiceError whose `kind` says what happened — connection, expired
 * session, access ended, service fault, or a refused request — so the UI can
 * distinguish an error from an empty result and offer a named Retry.
 */

const trim = (base: string) => base.replace(/\/+$/, '')
const baseOf = (settings: Settings) => trim(settings.pushServerBase ?? DEFAULT_PUSH_BASE)
export const MENTOR_REQUEST_TIMEOUT_MS = 15_000

export type MentorErrorKind = 'connection' | 'expired' | 'ended' | 'refused' | 'service' | 'stale'
export class MentorServiceError extends Error {
  constructor(public readonly kind: MentorErrorKind, message: string, public readonly status = 0) {
    super(message)
  }
}

async function post<T>(base: string, path: string, body: unknown, timeoutMs = MENTOR_REQUEST_TIMEOUT_MS): Promise<{ ok: boolean; status: number; body: T }> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: ctrl.signal })
    return { ok: res.ok, status: res.status, body: (await res.json().catch(() => ({}))) as T }
  } catch {
    throw new MentorServiceError('connection', 'Could not reach the mentor service — check your connection and retry.')
  } finally {
    clearTimeout(timer)
  }
}
/** Map a non-OK response to a typed error the UI can act on. */
function failure(res: { status: number; body: { error?: string } }, fallback: string): MentorServiceError {
  if (res.status === 401) return new MentorServiceError('expired', 'Your session has expired — sign in again.', 401)
  if (res.status === 403) return new MentorServiceError('ended', res.body.error === 'space belongs to another device' ? 'This mentor space belongs to another device — turn mentor access off there first.' : 'Access to this mentor space has ended.', 403)
  if (res.status === 409) return new MentorServiceError('stale', res.body.error ?? fallback, 409)
  if (res.status >= 500) return new MentorServiceError('service', `The mentor service had a problem (status ${res.status}) — try again in a moment.`, res.status)
  return new MentorServiceError('refused', res.body.error ?? fallback, res.status)
}

export interface MentorSpace { spaceId: string; ownerToken: string }
export interface MentorSummary { id: string; name: string; createdAt: number; revokedAt: number | null; lastSeenAt: number | null }
export interface MentorListing { mentors: MentorSummary[]; invites: { code: string; label: string; expiresAt: number }[]; packs: { id: string; title: string; sharedAt: number; mentorIds: string[]; attachments: number; unsharedAt?: number | null }[]; closedAt?: number | null }
export interface InboxItem { spaceId: string; mentorId: string; mentorName: string; feedbackId: string; at: number; sig: string; packId: string; packTitle: string; text: string }

/** Mint the space on first use (idempotent for the same token). */
export async function ensureMentorSpace(settings: Settings, update: (patch: Partial<Settings>) => void): Promise<MentorSpace> {
  const space: MentorSpace = settings.mentorSpaceId && settings.mentorOwnerToken ? { spaceId: settings.mentorSpaceId, ownerToken: settings.mentorOwnerToken } : { spaceId: randomHex(12), ownerToken: randomHex(24) }
  const res = await post<{ ok?: boolean; error?: string }>(baseOf(settings), '/mentor/space', space)
  if (!res.ok) throw failure(res, 'Could not turn on mentor access.')
  if (!settings.mentorSpaceId) update({ mentorSpaceId: space.spaceId, mentorOwnerToken: space.ownerToken })
  return space
}

/** The link a mentor opens; the app's own origin serves mentor.html. */
export function inviteLink(spaceId: string, code: string, secret: string): string {
  const origin = typeof window !== 'undefined' ? `${window.location.origin}${window.location.pathname.replace(/[^/]*$/, '')}` : '/'
  return `${origin}mentor.html#/join/${spaceId}/${code}/${secret}`
}
export const mentorLoginLink = (spaceId: string, mentorId: string): string => {
  const origin = typeof window !== 'undefined' ? `${window.location.origin}${window.location.pathname.replace(/[^/]*$/, '')}` : '/'
  return `${origin}mentor.html#/space/${spaceId}/${mentorId}`
}

export async function createInvite(settings: Settings, space: MentorSpace, label: string): Promise<{ code: string; secret: string; expiresAt: number; link: string }> {
  const res = await post<{ code: string; secret: string; expiresAt: number; error?: string }>(baseOf(settings), '/mentor/invite', { spaceId: space.spaceId, ownerToken: space.ownerToken, label })
  if (!res.ok) throw failure(res, 'Could not create the invitation.')
  return { ...res.body, link: inviteLink(space.spaceId, res.body.code, res.body.secret) }
}

export async function listMentors(settings: Settings, space: MentorSpace): Promise<MentorListing> {
  const res = await post<MentorListing & { error?: string }>(baseOf(settings), '/mentor/mentors', { spaceId: space.spaceId, ownerToken: space.ownerToken })
  if (!res.ok) throw failure(res, 'Could not load your mentors.')
  if (!Array.isArray(res.body.mentors)) throw new MentorServiceError('service', 'The mentor service sent an unexpected reply — try again.', res.status)
  return { mentors: res.body.mentors, invites: res.body.invites ?? [], packs: res.body.packs ?? [], closedAt: res.body.closedAt ?? null }
}

export async function revokeMentor(settings: Settings, space: MentorSpace, mentorId: string): Promise<void> {
  const res = await post<{ ok?: boolean; error?: string }>(baseOf(settings), '/mentor/revoke', { spaceId: space.spaceId, ownerToken: space.ownerToken, mentorId })
  if (!res.ok) throw failure(res, 'Could not end that mentor’s access.')
}

/** B08: close the space for every mentor (recoverable; nothing deleted) or reopen it. */
export async function closeMentorSpace(settings: Settings, space: MentorSpace, action: 'close' | 'reopen'): Promise<{ closedAt: number | null }> {
  const res = await post<{ ok?: boolean; closedAt?: number | null; error?: string }>(baseOf(settings), `/mentor/${action}`, { spaceId: space.spaceId, ownerToken: space.ownerToken })
  if (!res.ok) throw failure(res, action === 'close' ? 'Could not end mentor access.' : 'Could not reopen mentor access.')
  return { closedAt: res.body.closedAt ?? null }
}

/** B10: take one pack away from every mentor (idempotent). Downloaded copies are not recalled. */
export async function unsharePack(settings: Settings, space: MentorSpace, packId: string): Promise<{ revision: number; unsharedAt: number | null }> {
  const res = await post<{ ok?: boolean; revision?: number; unsharedAt?: number | null; error?: string }>(baseOf(settings), '/mentor/unshare', { spaceId: space.spaceId, ownerToken: space.ownerToken, packId })
  if (!res.ok) throw failure(res, 'Could not unshare the pack.')
  return { revision: res.body.revision ?? 0, unsharedAt: res.body.unsharedAt ?? null }
}

export interface ShareAttachment { uid: string; name: string; bytes: Uint8Array }

/** The portal-side attachment id for a stable wallet uid (fits the worker's record-id rule). */
export const shareAttachmentId = async (uid: string): Promise<string> => (await sha256Hex(`att:${uid}`)).slice(0, 32)
/** Text hash kept on the pack so the next share can say whether the text changed. */
export const packTextHash = async (text: string): Promise<string> => (await sha256Hex(text)).slice(0, 32)

export class StaleShareError extends Error {
  constructor(public readonly revision: number) {
    super('The pack changed on the server since you last shared — review and share again.')
  }
}

/**
 * Share ONE revision of a pack as a complete replacement of its portal content
 * (audit B01/B02): text, recipients and attachments. Attachments are encrypted
 * per file with a fresh key before upload. `revision` must be the last shared
 * revision + 1; the worker refuses anything else (StaleShareError) and treats a
 * repeat of the current revision as a harmless replay.
 */
export async function sharePack(settings: Settings, space: MentorSpace, pack: { id: string; title: string; text: string }, mentorIds: string[], attachments: ShareAttachment[], revision: number): Promise<{ revision: number; sharedAt: number; attachments: number; replayed?: boolean }> {
  const encrypted = []
  for (const a of attachments) {
    if (a.bytes.byteLength > MENTOR_ATTACHMENT_MAX_BYTES) throw new Error(`${a.name} is over the 2 MB limit for shared attachments.`)
    const key = randomHex(32)
    const blob = await encryptBytes(a.bytes, key)
    encrypted.push({ id: await shareAttachmentId(a.uid), name: a.name, size: a.bytes.byteLength, key, iv: blob.iv, data: blob.data })
  }
  const res = await post<{ revision: number; sharedAt: number; attachments: number; replayed?: boolean; error?: string }>(baseOf(settings), '/mentor/share', { spaceId: space.spaceId, ownerToken: space.ownerToken, revision, pack, mentorIds, attachments: encrypted }, 60_000)
  if (res.status === 409) throw new StaleShareError(Number((res.body as { revision?: number }).revision ?? 0))
  if (!res.ok) throw failure(res, 'Could not share the pack.')
  return res.body
}

export async function fetchInbox(settings: Settings, space: MentorSpace, since: number): Promise<InboxItem[]> {
  const res = await post<{ feedback: InboxItem[]; error?: string }>(baseOf(settings), '/mentor/inbox', { spaceId: space.spaceId, ownerToken: space.ownerToken, since })
  if (!res.ok) throw failure(res, 'Could not check for mentor feedback.')
  return res.body.feedback ?? []
}

/**
 * Turn inbox items into reviewer-authenticated observations, once each (by
 * feedback id). Returns the updated file and how many were added.
 */
export function absorbInbox(file: AdminFile, items: InboxItem[], todayISO: string): { file: AdminFile; added: number } {
  const seen = new Set(file.observations.map((o) => o.attestation?.feedbackId).filter(Boolean))
  const additions: Observation[] = []
  for (const item of items) {
    const attestation: Attestation = { spaceId: item.spaceId, mentorId: item.mentorId, mentorName: item.mentorName, feedbackId: item.feedbackId, at: item.at, sig: item.sig }
    if (seen.has(item.feedbackId) || !validAttestation(attestation)) continue
    seen.add(item.feedbackId)
    additions.push({ id: newAdminId(), dateISO: new Date(item.at).toISOString().slice(0, 10) || todayISO, observer: item.mentorName, subject: item.packTitle, focus: 'Review pack feedback', strengths: '', development: item.text, sourceType: 'reviewer-authenticated', attestation, revision: 0, at: Date.now() })
  }
  return { file: additions.length ? { ...file, observations: [...file.observations, ...additions] } : file, added: additions.length }
}

export const isAttested = (o: Pick<Observation, 'sourceType' | 'attestation'>): boolean => o.sourceType === 'reviewer-authenticated' && validAttestation(o.attestation)

export const fileToBytes = async (file: Blob): Promise<Uint8Array> => new Uint8Array(await file.arrayBuffer())
export { bytesToBase64 }
