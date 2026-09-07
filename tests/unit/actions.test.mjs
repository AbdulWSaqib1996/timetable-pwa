import test from 'node:test'
import assert from 'node:assert/strict'
import { groupPendingActions, makeNotificationData } from '../../shared/actions.js'

const item = (patch = {}) => ({ v: 2, action: 'attended', key: 'k1', profileId: 'pA', id: 'i1', at: 1, ...patch })

test('actions route to their owning profile, even while another profile is active', () => {
  const { apply, dropped } = groupPendingActions(
    [item(), item({ id: 'i2', profileId: 'pB', key: 'k2', action: 'absent' })],
    ['pA', 'pB']
  )
  assert.deepEqual([...apply.keys()].sort(), ['pA', 'pB'])
  assert.equal(apply.get('pB')[0].action, 'absent')
  assert.equal(dropped.length, 0)
})

test('an action owned by a deleted profile is dropped, never re-attached', () => {
  const { apply, dropped } = groupPendingActions([item({ profileId: 'gone' })], ['pA'])
  assert.equal(apply.size, 0)
  assert.equal(dropped.length, 1)
})

test('unscoped legacy actions apply only when exactly one profile exists', () => {
  const legacy = { action: 'attended', key: 'k1', at: 1 } // no v/profileId/id
  const single = groupPendingActions([legacy], ['pOnly'])
  assert.equal(single.apply.get('pOnly')?.length, 1)
  const multi = groupPendingActions([legacy], ['pA', 'pB'])
  assert.equal(multi.apply.size, 0)
  assert.equal(multi.dropped.length, 1)
})

test('duplicate action ids are applied once; malformed and unknown records are dropped safely', () => {
  const { apply, dropped } = groupPendingActions(
    [item(), item(), item({ id: 'i9', action: 'explode' }), null, { action: 'attended', at: 1 }],
    ['pA']
  )
  assert.equal(apply.get('pA').length, 1)
  assert.equal(dropped.length, 3)
})

test("task 'done' and 'open' route with their kinds; open carries the owner", () => {
  const { apply, open } = groupPendingActions(
    [item({ action: 'done', kind: 'task' }), item({ id: 'i2', action: 'open', key: 'k3', kind: 'task' })],
    ['pA']
  )
  assert.equal(apply.get('pA')[0].action, 'done')
  assert.deepEqual(open, [{ profileId: 'pA', key: 'k3', kind: 'task' }])
})

test('notification data is versioned and drops snoozeUrl without a key', () => {
  const data = makeNotificationData({ profileId: 'pA', key: 'k', kind: 'task', snoozeUrl: 'https://x' })
  assert.equal(data.v, 2)
  assert.equal(data.kind, 'task')
  assert.equal(data.snoozeUrl, 'https://x')
  assert.equal(makeNotificationData({ profileId: 'pA', snoozeUrl: 'https://x' }).snoozeUrl, undefined)
})
