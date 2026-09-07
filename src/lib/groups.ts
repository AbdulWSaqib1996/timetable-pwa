import { COURSE_TIMEZONE } from '../../shared/calendar-time.js'
import { availabilityPayload, computeFreeIntervals } from '../../shared/availability.js'
import type { FreeSlot } from '../../shared/availability.js'
import type { Session } from '../types'
import { toMinutes } from './format'

export type { FreeSlot }

/**
 * Study groups: share a short code; each member publishes their free slots
 * (times only — no session details, P6-05 privacy rule) plus generation time,
 * timezone and horizon, and everyone sees the freshness-aware intersection.
 */

export interface GroupMember {
  /** stable id (P3-07); may be absent from very old servers */
  memberId?: string
  name: string
  at: number
  slots: FreeSlot[]
  /** timezone the slots' wall minutes are in (defaults to the course zone) */
  tz?: string
}

/** A meeting proposal (P6-05): stable id, revision-checked edits. */
export interface Proposal {
  id: string
  rev: number
  /** proposer memberId */
  by: string
  slot: FreeSlot
  status: 'open' | 'withdrawn'
  participants: string[]
  responses: Record<string, 'yes' | 'no'>
  at: number
}

/** Device-held membership capability — proves this device owns its member record. */
export interface GroupCredentials {
  memberId?: string
  token?: string
}

export interface SlotOptions {
  workStart?: number
  workEnd?: number
  minMinutes?: number
}

/**
 * My free slots for the next `days` days: course sessions AND opted-in
 * personal busy commitments (they arrive here as sessions with busy time)
 * become plain intervals; the shared model does the rest. Nothing but
 * times ever leaves this function.
 */
export function computeFreeSlots(sessions: Session[], todayISO: string, days = 7, opts: SlotOptions = {}): FreeSlot[] {
  const busy = sessions
    .filter((s) => !s.isKeyDate && !s.isSelfStudy && !s.isFreeTime && toMinutes(s.start) !== null)
    .map((s) => {
      const from = toMinutes(s.start)!
      return { d: s.dateISO, from, to: toMinutes(s.end) ?? from + 60 }
    })
  return computeFreeIntervals(busy, { todayISO, days, ...opts })
}

export const fmtSlotTime = (mins: number) =>
  `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`

const trim = (base: string) => base.replace(/\/+$/, '')

export async function createGroup(
  base: string,
  name: string,
  slots: FreeSlot[]
): Promise<{ code: string } & GroupCredentials> {
  const res = await fetch(`${trim(base)}/group`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(availabilityPayload({ code: '', name, slots, tz: COURSE_TIMEZONE })),
  })
  if (!res.ok) throw new Error('Could not create the group.')
  const json = (await res.json()) as { code?: string; memberId?: string; token?: string }
  if (!json.code) throw new Error('The server returned no code.')
  return { code: json.code, memberId: json.memberId, token: json.token }
}

export async function joinGroup(
  base: string,
  code: string,
  name: string,
  slots: FreeSlot[],
  creds?: GroupCredentials
): Promise<GroupCredentials> {
  const res = await fetch(`${trim(base)}/group/join`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(availabilityPayload({ code, name, slots, tz: COURSE_TIMEZONE, creds })),
  })
  if (res.status === 404) throw new Error('No group with that code.')
  if (res.status === 403) {
    const { error } = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(error ?? 'Your membership on this device is out of date — rejoin with the code.')
  }
  if (!res.ok) throw new Error('Could not join the group.')
  const json = (await res.json()) as { memberId?: string; token?: string }
  return { memberId: json.memberId ?? creds?.memberId, token: json.token ?? creds?.token }
}

export interface GroupState {
  members: GroupMember[]
  proposals: Proposal[]
}

export async function fetchGroup(base: string, code: string): Promise<GroupState> {
  const res = await fetch(`${trim(base)}/group?code=${encodeURIComponent(code)}`)
  if (res.status === 404) throw new Error('This group no longer exists.')
  if (!res.ok) throw new Error('Could not load the group.')
  const json = (await res.json()) as { members?: GroupMember[]; proposals?: Proposal[] }
  return { members: json.members ?? [], proposals: json.proposals ?? [] }
}

/** Explicit send action (P6-05): nothing is proposed until the user asks. */
export async function proposeSlot(
  base: string,
  code: string,
  creds: GroupCredentials,
  slot: FreeSlot
): Promise<Proposal> {
  const res = await fetch(`${trim(base)}/group/propose`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code, memberId: creds.memberId, token: creds.token, slot }),
  })
  if (res.status === 403) throw new Error('Your membership on this device is out of date — rejoin with the code.')
  if (!res.ok) throw new Error('Could not send the proposal.')
  const json = (await res.json()) as { proposal?: Proposal }
  if (!json.proposal) throw new Error('Could not send the proposal.')
  return json.proposal
}

/** Thrown when a proposal changed under a response; carries the fresh copy. */
export class ProposalConflict extends Error {
  proposal?: Proposal
  constructor(proposal?: Proposal) {
    super('This proposal just changed — showing the latest version.')
    this.proposal = proposal
  }
}

export async function respondProposal(
  base: string,
  code: string,
  creds: GroupCredentials,
  proposalId: string,
  rev: number,
  action: 'yes' | 'no' | 'withdraw'
): Promise<Proposal> {
  const res = await fetch(`${trim(base)}/group/proposal/respond`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code, memberId: creds.memberId, token: creds.token, proposalId, rev, action }),
  })
  if (res.status === 409) {
    const json = (await res.json().catch(() => ({}))) as { proposal?: Proposal }
    throw new ProposalConflict(json.proposal)
  }
  if (res.status === 403) throw new Error('Your membership on this device is out of date — rejoin with the code.')
  if (!res.ok) throw new Error('Could not update the proposal.')
  const json = (await res.json()) as { proposal?: Proposal }
  if (!json.proposal) throw new Error('Could not update the proposal.')
  return json.proposal
}

export async function leaveGroup(
  base: string,
  code: string,
  name: string,
  creds?: GroupCredentials
): Promise<void> {
  await fetch(`${trim(base)}/group/leave`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code, name, ...creds }),
  }).catch(() => {})
}

/* ---- publish policy (P6-05): republish only when the slots changed or the
 * freshness window requires it — not on every open. ---- */

const PUB_KEY = (code: string) => `timetable.group.pub.v1.${code}`
/** Republish at half the freshness window even when nothing changed. */
const REPUBLISH_MS = 12 * 3_600_000

export function slotsFingerprint(slots: FreeSlot[]): string {
  return slots.map((s) => `${s.d}:${s.from}-${s.to}`).join('|')
}

export function shouldPublish(code: string, slots: FreeSlot[], now = Date.now()): boolean {
  try {
    const raw = localStorage.getItem(PUB_KEY(code))
    if (!raw) return true
    const last = JSON.parse(raw) as { hash?: string; at?: number }
    return last.hash !== slotsFingerprint(slots) || now - (last.at ?? 0) > REPUBLISH_MS
  } catch {
    return true
  }
}

export function markPublished(code: string, slots: FreeSlot[], now = Date.now()): void {
  try {
    localStorage.setItem(PUB_KEY(code), JSON.stringify({ hash: slotsFingerprint(slots), at: now }))
  } catch {
    /* storage unavailable — we'll just republish next time */
  }
}
