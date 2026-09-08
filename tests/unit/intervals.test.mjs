import test from 'node:test'
import assert from 'node:assert/strict'
import { assignLanesByComponent, classifyNow, overlaps, toMins } from '../../shared/intervals.js'

test('toMins parses wall times and rejects garbage', () => {
  assert.equal(toMins('09:30'), 570)
  assert.equal(toMins('24:00'), null)
  assert.equal(toMins('9:5'), null)
  assert.equal(toMins(undefined), null)
})

test('lanes are assigned per connected overlap component (TT-14)', () => {
  const items = [
    { id: 'a', start: 540, end: 660 }, // 09-11
    { id: 'b', start: 570, end: 630 }, // 09:30-10:30 overlaps a
    { id: 'c', start: 600, end: 720 }, // 10-12 overlaps a & b (transitive)
    { id: 'd', start: 840, end: 900 }, // 14-15 alone
  ]
  const placed = assignLanesByComponent(items)
  const byId = Object.fromEntries(placed.map((p) => [p.item.id, p]))
  assert.equal(byId.a.lanes, 3)
  assert.equal(byId.b.lanes, 3)
  assert.equal(byId.c.lanes, 3)
  assert.equal(byId.d.lanes, 1, 'the lone afternoon event keeps full width')
  assert.equal(byId.d.lane, 0)
  // Collision-free inside the component.
  const lanesUsed = new Set([byId.a.lane, byId.b.lane, byId.c.lane])
  assert.equal(lanesUsed.size, 3)
  // Nested: a contains e; still two lanes, and f after both is full width.
  const nested = assignLanesByComponent([
    { id: 'a', start: 540, end: 720 },
    { id: 'e', start: 600, end: 630 },
    { id: 'f', start: 720, end: 780 },
  ])
  const n = Object.fromEntries(nested.map((p) => [p.item.id, p]))
  assert.equal(n.a.lanes, 2)
  assert.equal(n.f.lanes, 1)
  assert.equal(overlaps({ start: 0, end: 10 }, { start: 10, end: 20 }), false, 'half-open intervals')
})

test('classifyNow places every item exactly once by identity; equal starts and nesting survive (TT-06)', () => {
  const items = [
    { id: 'lesson', start: 540, end: 660, busy: true }, // 09-11
    { id: 'dentist', start: 540, end: 600, busy: true }, // 09-10 equal start
    { id: 'free', start: 555, end: 570, busy: false }, // nested, free
    { id: 'later', start: 700, end: 760, busy: true },
    { id: 'earlier', start: 480, end: 530, busy: true },
    { id: 'untimed', start: null, busy: true },
  ]
  const c = classifyNow(items, 555) // 09:15
  assert.deepEqual(c.current.map((x) => x.id).sort(), ['dentist', 'free', 'lesson'])
  assert.deepEqual(c.upcoming.map((x) => x.id), ['later'])
  assert.deepEqual(c.finished.map((x) => x.id), ['earlier'])
  assert.deepEqual(c.untimed.map((x) => x.id), ['untimed'])
  const total = c.current.length + c.upcoming.length + c.finished.length + c.untimed.length
  assert.equal(total, items.length, 'no duplication, no loss')
  assert.equal(c.clashCount, 2, 'the free entry is not a conflict')
  // Nothing current and nothing upcoming → day finished, untimed never counts.
  const late = classifyNow(items, 800)
  assert.equal(late.current.length + late.upcoming.length, 0)
  assert.equal(late.untimed.length, 1)
})
