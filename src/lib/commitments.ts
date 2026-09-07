import type { CommitmentRec } from './admin'
import type { Session } from '../types'

/**
 * Personal commitments and study blocks (P5-06): user-owned records presented
 * to the schedule/Today/clash/busy pipelines as clearly-marked sessions.
 * Imported sources can never overwrite them — they live in the record store
 * with their own identity.
 */

export const commitmentEventKey = (c: Pick<CommitmentRec, 'id'>) => `commitment:${c.id}`

export const KIND_LABEL: Record<CommitmentRec['kind'], string> = {
  appointment: 'Appointment',
  work: 'Work',
  study: 'Study block',
}

export function commitmentToSession(c: CommitmentRec): Session {
  return {
    id: `cmt-${c.id}`,
    calendarUid: `cmt-${c.id}`,
    eventKey: commitmentEventKey(c),
    title: c.title,
    day: '',
    dateISO: c.dateISO,
    start: c.startTime,
    end: c.endTime,
    room: c.location ?? '',
    groups: '',
    tutor: '',
    subject: `Personal · ${KIND_LABEL[c.kind]}`,
    isSpecialism: false,
    isSelfStudy: false,
    isOptional: false,
    isFreeTime: c.busy === false,
  }
}

/** Commitments the user asked reminders for. */
export function remindableCommitmentSessions(commitments: CommitmentRec[]): Session[] {
  return commitments.filter((c) => c.remind === true).map(commitmentToSession)
}

export const isCommitmentSession = (s: Pick<Session, 'id'>) => s.id.startsWith('cmt-')

/** Busy commitments only (for clash detection and group availability). */
export function busyCommitmentSessions(commitments: CommitmentRec[]): Session[] {
  return commitments.filter((c) => c.busy !== false).map(commitmentToSession)
}
