import { MENTOR_ATTACHMENT_MAX_BYTES, bytesToBase64, encryptBytes, randomHex, validAttestation } from '../../shared/mentor.js'
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
 */

const trim = (base: string) => base.replace(/\/+$/, '')
const baseOf = (settings: Settings) => trim(settings.pushServerBase ?? DEFAULT_PUSH_BASE)

async function post<T>(base: string, path: string, body: unknown): Promise<{ ok: boolean; status: number; body: T }> {
  const res = await fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  return { ok: res.ok, status: res.status, body: (await res.json().catch(() => ({}))) as T }
}

export interface MentorSpace { spaceId: string; ownerToken: string }
export interface MentorSummary { id: string; name: string; createdAt: number; revokedAt: number | null; lastSeenAt: number | null }
export interface MentorListing { mentors: MentorSummary[]; invites: { code: string; label: string; expiresAt: number }[]; packs: { id: string; title: string; sharedAt: number; mentorIds: string[]; attachments: number }[] }
export interface InboxItem { spaceId: string; mentorId: string; mentorName: string; feedbackId: string; at: number; sig: string; packId: string; packTitle: string; text: string }

/** Mint the space on first use (idempotent for the same token). */
export async function ensureMentorSpace(settings: Settings, update: (patch: Partial<Settings>) => void): Promise<MentorSpace> {
  const space: MentorSpace = settings.mentorSpaceId && settings.mentorOwnerToken ? { spaceId: settings.mentorSpaceId, ownerToken: settings.mentorOwnerToken } : { spaceId: randomHex(12), ownerToken: randomHex(24) }
  const res = await post<{ ok?: boolean; error?: string }>(baseOf(settings), '/mentor/space', space)
  if (!res.ok) throw new Error(res.status === 403 ? 'This mentor space belongs to another device — turn mentor access off there first.' : 'Could not reach the mentor service.')
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
  if (!res.ok) throw new Error('Could not create the invitation.')
  return { ...res.body, link: inviteLink(space.spaceId, res.body.code, res.body.secret) }
}

export async function listMentors(settings: Settings, space: MentorSpace): Promise<MentorListing> {
  const res = await post<MentorListing & { error?: string }>(baseOf(settings), '/mentor/mentors', { spaceId: space.spaceId, ownerToken: space.ownerToken })
  if (!res.ok) throw new Error('Could not load your mentors.')
  return res.body
}

export async function revokeMentor(settings: Settings, space: MentorSpace, mentorId: string): Promise<void> {
  const res = await post<{ ok?: boolean }>(baseOf(settings), '/mentor/revoke', { spaceId: space.spaceId, ownerToken: space.ownerToken, mentorId })
  if (!res.ok) throw new Error('Could not end that mentor’s access.')
}

export interface ShareAttachment { id: string; name: string; bytes: Uint8Array }

/** Share a pack's text with chosen mentors; attachments are encrypted per file before they leave the device. */
export async function sharePack(settings: Settings, space: MentorSpace, pack: { id: string; title: string; text: string }, mentorIds: string[], attachments: ShareAttachment[]): Promise<{ sharedAt: number; attachments: number }> {
  const encrypted = []
  for (const a of attachments) {
    if (a.bytes.byteLength > MENTOR_ATTACHMENT_MAX_BYTES) throw new Error(`${a.name} is over the 2 MB limit for shared attachments.`)
    const key = randomHex(32)
    const blob = await encryptBytes(a.bytes, key)
    encrypted.push({ id: a.id, name: a.name, size: a.bytes.byteLength, key, iv: blob.iv, data: blob.data })
  }
  const res = await post<{ sharedAt: number; attachments: number; error?: string }>(baseOf(settings), '/mentor/share', { spaceId: space.spaceId, ownerToken: space.ownerToken, pack, mentorIds, attachments: encrypted })
  if (!res.ok) throw new Error(res.body.error ?? 'Could not share the pack.')
  return res.body
}

export async function fetchInbox(settings: Settings, space: MentorSpace, since: number): Promise<InboxItem[]> {
  const res = await post<{ feedback: InboxItem[]; error?: string }>(baseOf(settings), '/mentor/inbox', { spaceId: space.spaceId, ownerToken: space.ownerToken, since })
  if (!res.ok) throw new Error('Could not check for mentor feedback.')
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
