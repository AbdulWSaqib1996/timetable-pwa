import test from 'node:test'
import assert from 'node:assert/strict'
import {
  applyPlacementExceptionRules,
  computePlacementBlocks,
  placementPolicyOf,
} from '../../shared/placement.js'

const day = (dateISO, patch = {}) => ({
  id: `plc-SE1A-${dateISO}`,
  title: 'SE1A placement day',
  dateISO,
  start: '08:30',
  end: '15:45',
  ...patch,
})
const settings = {}
const exc = (dateISO, kind, patch = {}) => ({ id: `e-${dateISO}`, tag: 'SE1A', dateISO, kind, at: 1, ...patch })

test('holiday and cancelled days leave the plan; totals reflect it', () => {
  const sessions = [day('2026-10-01'), day('2026-10-02'), day('2026-10-05')]
  const exceptions = [exc('2026-10-02', 'holiday')]
  const filtered = applyPlacementExceptionRules(sessions, exceptions, settings)
  assert.deepEqual(filtered.map((s) => s.dateISO), ['2026-10-01', '2026-10-05'])
  const [block] = computePlacementBlocks(sessions, exceptions, settings, () => undefined)
  assert.equal(block.plannedDays, 2)
  assert.equal(block.excludedDays, 1)
  assert.equal(block.days.find((d) => d.dateISO === '2026-10-02').plannedMins, 0)
})

test('inset days follow the explicit policy, never an assumption', () => {
  const sessions = [day('2026-10-01'), day('2026-10-02')]
  const exceptions = [exc('2026-10-02', 'inset')]
  const counts = computePlacementBlocks(sessions, exceptions, { placementInsetCounts: true }, () => undefined)[0]
  assert.equal(counts.plannedDays, 2)
  const noCounts = computePlacementBlocks(sessions, exceptions, { placementInsetCounts: false }, () => undefined)[0]
  assert.equal(noCounts.plannedDays, 1)
  assert.equal(
    applyPlacementExceptionRules(sessions, exceptions, { placementInsetCounts: false }).length,
    1
  )
})

test('half days and changed working hours adjust planned minutes; breaks subtract', () => {
  const sessions = [day('2026-10-01')]
  const half = computePlacementBlocks(sessions, [exc('2026-10-01', 'part-day', { startTime: '08:30', endTime: '12:00' })], settings, () => undefined)[0]
  assert.equal(half.days[0].plannedMins, 210)
  const custom = computePlacementBlocks(sessions, [], { placementHours: { start: '09:00', end: '15:00', breakMins: 30 } }, () => undefined)[0]
  // The row's own 08:30–15:45 times win over defaults; break still subtracts.
  assert.equal(custom.days[0].plannedMins, 435 - 30)
  const bare = computePlacementBlocks([day('2026-10-01', { start: '', end: '' })], [], { placementHours: { start: '09:00', end: '15:00', breakMins: 30 } }, () => undefined)[0]
  assert.equal(bare.days[0].plannedMins, 360 - 30)
})

test('two source rows on one date are ONE day; whole-day tick logs it with honest provenance', () => {
  const sessions = [
    day('2026-10-01', { id: 'row-1', title: 'SE1A School Experience' }),
    day('2026-10-01', { id: 'row-2', title: 'SE1A briefing' }),
  ]
  const meta = { 'row-1': { attended: true } }
  const [block] = computePlacementBlocks(sessions, [], settings, (s) => meta[s.id])
  assert.equal(block.days.length, 1)
  assert.equal(block.days[0].inferred, false)
  assert.equal(block.days[0].loggedFrom, 'day-tick')
  assert.equal(block.days[0].loggedMins, block.days[0].plannedMins)
})

test('an hours correction overrides the whole-day tick; missing records stay unrecorded, not absent', () => {
  const sessions = [day('2026-10-01'), day('2026-10-02')]
  const exceptions = [exc('2026-10-01', 'hours', { loggedMins: 300 })]
  const [block] = computePlacementBlocks(sessions, exceptions, settings, (s) =>
    s.dateISO === '2026-10-01' ? { attended: true } : undefined
  )
  const corrected = block.days.find((d) => d.dateISO === '2026-10-01')
  assert.equal(corrected.loggedMins, 300)
  assert.equal(corrected.loggedFrom, 'correction')
  const unrecorded = block.days.find((d) => d.dateISO === '2026-10-02')
  assert.equal(unrecorded.loggedMins, null)
  assert.equal(unrecorded.absent, false)
})

test('inferred (span-expanded) days are labelled until confirmed; policy defaults are explicit', () => {
  const [block] = computePlacementBlocks([day('2026-10-01')], [], settings, () => undefined)
  assert.equal(block.days[0].inferred, true)
  assert.equal(block.inferredDays, 1)
  assert.deepEqual(placementPolicyOf({}), { start: '08:30', end: '15:45', breakMins: 0, insetCounts: true })
})
