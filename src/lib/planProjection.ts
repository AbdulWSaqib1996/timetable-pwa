import { needsScheduling } from '../../shared/planValidation.js'
import type { PlanChildRec, TaskRecord } from './admin'
import type { Session } from '../types'

/**
 * Work-plan blocks as read-only calendar projections (R4 / NF-02). The block
 * is stored ONCE in `plans`; this only presents valid, scheduled blocks of an
 * existing parent task to the calendar/Today/List/clash pipelines. Event key
 * `plan:<blockId>`; session id `plan-<blockId>`. Opening one opens the
 * parent's block editor. Never a commitment, never reminder-eligible here.
 */

export const planEventKey = (block: Pick<PlanChildRec, 'id'>) => `plan:${block.id}`
export const isPlanSession = (s: Pick<Session, 'id'>) => s.id.startsWith('plan-')
export const planIdOf = (s: Pick<Session, 'id'>) => s.id.slice('plan-'.length)

/** A block's parent: a task, or (NF-02) a homework record presented with the same two fields. */
export type PlanParent = Pick<TaskRecord, 'id' | 'title'> & { planKind?: 'task' | 'homework' }

export function planBlockToSession(block: PlanChildRec, parent: PlanParent): Session {
  return {
    id: `plan-${block.id}`,
    calendarUid: `plan-${block.id}`,
    eventKey: planEventKey(block),
    title: block.title,
    day: '',
    dateISO: block.dateISO!,
    start: block.startTime!,
    end: block.endTime!,
    room: '',
    groups: '',
    tutor: '',
    subject: `Study block · ${parent.title}`,
    isSpecialism: false,
    isSelfStudy: false,
    isOptional: false,
    // A finished block is shown but no longer counts as busy time.
    isFreeTime: block.done === true,
  }
}

/** Valid, scheduled blocks whose parent task still exists — invalid ones stay "Needs scheduling". */
export function planBlockSessions(plans: PlanChildRec[], tasks: PlanParent[]): Session[] {
  const byId = new Map(tasks.map((t) => [`${t.planKind ?? 'task'}:${t.id}`, t]))
  const out: Session[] = []
  for (const block of plans) {
    if (block.kind !== 'block') continue
    const parent = byId.get(`${block.parentKind ?? 'task'}:${block.parentId}`)
    if (!parent || needsScheduling(block)) continue
    out.push(planBlockToSession(block, parent))
  }
  return out
}
