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
  assert.deepEqual(placementPolicyOf({}), { start: '08:30', end: '15:45', breakMins: 0, insetCounts: true, source: 'profile' })
})

// --- Pass 86 (placement review Batch 1): per-placement policy, hours validation, stale pins ---
import { locationCurrent, normaliseAddress, resolvePolicy, validateWorkingHours } from '../../shared/placement.js'

test('PL-03: each placement applies its own inset policy and hours; the profile default covers unowned blocks', () => {
  const placements = [
    { id: 'p1', code: 'SE1', mappedBlockTags: ['SE1A'], insetCountsAsSchoolDay: false, workingHours: { start: '08:00', end: '16:00' } },
    { id: 'p2', code: 'SE2', mappedBlockTags: ['SE2A'] },
  ]
  const s = { placementInsetCounts: true }
  assert.equal(resolvePolicy('SE1A', s, placements).insetCounts, false)
  assert.equal(resolvePolicy('SE1A', s, placements).source, 'placement')
  assert.equal(resolvePolicy('SE2A', s, placements).insetCounts, true)
  assert.equal(resolvePolicy('SE3A', s, placements).source, 'profile', 'an unowned block follows the profile default')
  const sessions = [day('2026-10-01'), day('2026-10-02'), { ...day('2026-10-01'), id: 'plc-SE2A-2026-10-01', title: 'SE2A placement day' }]
  const exceptions = [exc('2026-10-01', 'inset'), { id: 'e2', tag: 'SE2A', dateISO: '2026-10-01', kind: 'inset', at: 1 }]
  const blocks = computePlacementBlocks(sessions, exceptions, s, () => undefined, placements)
  const se1 = blocks.find((b) => b.tag === 'SE1A')
  const se2 = blocks.find((b) => b.tag === 'SE2A')
  assert.equal(se1.plannedDays, 1, 'SE1 excludes its inset day')
  assert.equal(se2.plannedDays, 1, 'SE2 (profile default: inset counts) keeps it')
  assert.deepEqual(applyPlacementExceptionRules(sessions, exceptions, s, placements).map((x) => x.id), ['plc-SE1A-2026-10-02', 'plc-SE2A-2026-10-01'])
  // Day length precedence: a row without times uses the placement's hours, not the profile's.
  const untimed = computePlacementBlocks([{ ...day('2026-10-03'), start: '', end: '' }], [], s, () => undefined, placements)[0]
  assert.equal(untimed.days[0].plannedMins, 8 * 60)
  // Changing the profile default touches only placements without an override.
  const flipped = { placementInsetCounts: false }
  assert.equal(resolvePolicy('SE1A', flipped, placements).insetCounts, false)
  assert.equal(resolvePolicy('SE2A', flipped, placements).insetCounts, false)
})

test('PL-05: reversed or equal hours are refused with a sentence; a valid interval passes; an invalid override is ignored by the resolver', () => {
  assert.equal(validateWorkingHours({ start: '08:00', end: '16:00' }), null)
  assert.match(validateWorkingHours({ start: '16:00', end: '08:00' }), /end after it starts/)
  assert.match(validateWorkingHours({ start: '09:00', end: '09:00' }), /end after it starts/)
  assert.match(validateWorkingHours({ start: '9', end: '16:00' }), /HH:MM/)
  assert.equal(validateWorkingHours(undefined), null)
  const p = { mappedBlockTags: ['SE1A'], workingHours: { start: '16:00', end: '08:00' } }
  assert.equal(resolvePolicy('SE1A', {}, [p]).start, '08:30', 'a reversed override falls back to the profile default')
})

test('PL-01: a pin is current only for the address it was located for; older records without locatedFor are trusted', () => {
  assert.equal(normaliseAddress('  1 River   Lane, N1 1AA '), '1 river lane, n1 1aa')
  assert.equal(locationCurrent({ address: '1 River Lane', lat: 51.5, lng: -0.1, locatedFor: '1 river lane' }), true)
  assert.equal(locationCurrent({ address: '99 Different Road', lat: 51.5, lng: -0.1, locatedFor: '1 river lane' }), false)
  assert.equal(locationCurrent({ address: '1 River Lane', lat: 51.5, lng: -0.1 }), true)
  assert.equal(locationCurrent({ address: '1 River Lane', lat: Number.NaN, lng: -0.1, locatedFor: '1 river lane' }), false)
  assert.equal(locationCurrent({ address: '1 River Lane' }), false)
})
