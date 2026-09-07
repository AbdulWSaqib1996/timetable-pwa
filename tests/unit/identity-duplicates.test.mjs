import test from 'node:test'
import assert from 'node:assert/strict'
import { reconcileEvents, eventKey, legacyKey } from '../../shared/identity.js'

const row = (dateISO, start, title, extra = {}) => ({
  id: `${dateISO}-${start}`, title, day: '', dateISO, start, end: start,
  room: '', groups: '2', tutor: 'X', subject: '', isSpecialism: false,
  isSelfStudy: false, isOptional: false, ...extra,
})

test('verbatim duplicate sheet rows pair with duplicate history and are never flagged', () => {
  const a = row('2027-07-22', '09:00', 'Deferred Finish')
  const b = row('2027-07-22', '09:00', 'Deferred Finish')
  const first = reconcileEvents([a, b], [])
  // second refresh: history now holds both prior occurrences
  const second = reconcileEvents([a, b], first)
  for (const s of second) {
    assert.equal(s.identityCandidates.length, 0, 'duplicates must not be flagged for review')
    assert.equal(s.identityWarning, undefined)
  }
})

test('an extra new duplicate is treated as new, not fuzzy-linked to another date', () => {
  const seen = reconcileEvents([row('2027-07-22', '09:00', 'Deferred Finish')], [])
  const out = reconcileEvents(
    [row('2027-07-22', '09:00', 'Deferred Finish'), row('2027-07-22', '09:00', 'Deferred Finish')],
    [...seen, row('2027-07-01', '09:00', 'Deferred Finish')]
  )
  const unmatchedFlags = out.filter((s) => s.identityCandidates.length > 0)
  assert.equal(unmatchedFlags.length, 0, 'sheet duplicates never ask the user')
})

test('a resolved identity sticks across refreshes (resolved history entry wins the claim)', () => {
  const fresh = row('2026-09-08', '10:00', 'L&T 1')
  const resolvedHistory = [
    { ...row('2026-09-08', '10:00', 'L&T 1'), eventKey: '2026-09-15|10:00|l&t 1' }, // user linked to the moved event
  ]
  const out = reconcileEvents([fresh], resolvedHistory)
  assert.equal(out[0].identityCandidates.length, 0)
  assert.equal(eventKey(out[0]), '2026-09-15|10:00|l&t 1', 'resolution must be preserved')
  assert.notEqual(eventKey(out[0]), legacyKey(out[0]))
})
