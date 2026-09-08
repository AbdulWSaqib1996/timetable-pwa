import test from 'node:test'
import assert from 'node:assert/strict'
import { MAX_EFFORT_MINS, needsScheduling, realDate, validatePlanChild } from '../../shared/planValidation.js'
import { validatePayload } from '../../shared/contracts.js'

const block = (over = {}) => ({ id: 'b1', parentId: 't1', kind: 'block', title: 'Read chapter', done: false, dateISO: '2026-09-10', startTime: '17:00', endTime: '18:00', at: 1, ...over })

test('real calendar dates only', () => {
  assert.equal(realDate('2026-02-29'), false)
  assert.equal(realDate('2026-09-31'), false)
  assert.equal(realDate('2026-09-30'), true)
  assert.equal(realDate('20260930'), false)
})

test('study blocks: missing date, impossible date, reverse/zero interval and effort bounds cannot commit; errors name the field (TT-10)', () => {
  assert.equal(validatePlanChild(block()).ok, true)
  assert.equal(validatePlanChild(block({ dateISO: undefined })).errors.dateISO !== undefined, true)
  assert.equal(validatePlanChild(block({ dateISO: '2026-02-30' })).errors.dateISO !== undefined, true)
  assert.equal(validatePlanChild(block({ startTime: '18:00', endTime: '17:00' })).errors.endTime, 'A block must end after it starts.')
  assert.equal(validatePlanChild(block({ startTime: '17:00', endTime: '17:00' })).errors.endTime, 'A block must end after it starts.')
  assert.equal(validatePlanChild(block({ effortMins: MAX_EFFORT_MINS + 1 })).errors.effortMins !== undefined, true)
  assert.equal(validatePlanChild(block({ effortMins: 2.5 })).errors.effortMins !== undefined, true)
  assert.equal(validatePlanChild(block({ title: '  ' })).errors.title, 'Give it a title.')
  // Adjacent blocks are fine; subtasks need no date; milestones need a real one.
  assert.equal(validatePlanChild(block({ startTime: '18:00', endTime: '19:00' })).ok, true)
  assert.equal(validatePlanChild({ id: 's', parentId: 't', kind: 'subtask', title: 'x', done: false, at: 1 }).ok, true)
  assert.equal(validatePlanChild({ id: 'm', parentId: 't', kind: 'milestone', title: 'x', done: false, dateISO: 'soon', at: 1 }).ok, false)
})

test('legacy invalid records are flagged "Needs scheduling", never deleted', () => {
  assert.equal(needsScheduling(block({ startTime: '18:00', endTime: '17:00' })), true)
  assert.equal(needsScheduling(block()), false)
})

test('the wire contract enforces the same block/effort rules on import and sync ingestion', () => {
  const payload = (plans) => ({
    store: { activeId: 'p1', profiles: [{ id: 'p1', name: 'Synthetic', settings: { demo: true, sheetId: '', gid: null } }] },
    admin: { p1: { reflections: [], targets: [], meetings: [], observations: [], lessons: [], audits: [], tasks: [], exceptions: [], commitments: [], plans } },
  })
  assert.doesNotThrow(() => validatePayload(payload([block()])))
  assert.throws(() => validatePayload(payload([block({ startTime: '18:00', endTime: '17:00' })])), /end after it starts/)
  assert.throws(() => validatePayload(payload([block({ effortMins: 100000 })])), /Invalid effort/)
})
