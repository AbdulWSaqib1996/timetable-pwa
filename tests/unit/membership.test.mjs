import test from 'node:test'
import assert from 'node:assert/strict'
import {
  parseGroupExpression,
  groupMatches,
  expandGroupOptions,
  sessionInMembership,
  filterSessionsForMembership,
} from '../../shared/membership.js'

test('group ranges, lists, dash variants and normalisation all match membership', () => {
  assert.equal(groupMatches('1-10', ['2']), true) // the P3-01 headline bug
  assert.equal(groupMatches('1, 2, 3', ['2']), true)
  assert.equal(groupMatches(' 1 –  3 ', ['2']), true) // en dash + stray spaces
  assert.equal(groupMatches('Group 2', ['2']), true)
  assert.equal(groupMatches('02', ['2']), true) // leading zeros normalise
  assert.equal(groupMatches('4-6', ['2']), false)
  assert.equal(groupMatches('1-10', ['11']), false)
})

test('all-groups forms and empty cells are unrestricted', () => {
  assert.equal(groupMatches('all', ['7']), true)
  assert.equal(groupMatches('All Groups', ['7']), true)
  assert.equal(groupMatches('', ['7']), true)
  assert.equal(groupMatches(undefined, ['7']), true)
  assert.equal(parseGroupExpression('').empty, true)
  // No chosen groups: everything matches (the user has not narrowed).
  assert.equal(groupMatches('4-6', []), true)
  assert.equal(groupMatches('4-6', undefined), true)
})

test('malformed, reversed and oversized ranges are never expanded — literal match only, flagged unknown', () => {
  const reversed = parseGroupExpression('10-1')
  assert.deepEqual(reversed.unknown, ['10-1'])
  assert.equal(groupMatches('10-1', ['5']), false)
  assert.equal(groupMatches('10-1', ['10-1']), true) // literal equality still works
  const oversized = parseGroupExpression('1-999999999')
  assert.deepEqual(oversized.unknown, ['1-999999999'])
  assert.ok(oversized.tokens.length <= 1, 'unbounded range must not expand')
  const words = parseGroupExpression('red team')
  assert.deepEqual(words.unknown, ['red team'])
  assert.equal(groupMatches('red team', ['Red Team']), true)
})

test('option expansion lists each joinable group once, numerically sorted', () => {
  assert.deepEqual(expandGroupOptions(['1-3', '2, 4', 'all', '', '10']), ['1', '2', '3', '4', '10'])
})

test('membership combines specialisms and groups; empty selections never narrow', () => {
  const s = (patch = {}) => ({ groups: '1-10', specialismName: undefined, ...patch })
  assert.equal(sessionInMembership(s(), { specialisms: [], groups: ['2'] }), true)
  assert.equal(sessionInMembership(s({ specialismName: 'PE' }), { specialisms: ['Music'], groups: ['2'] }), false)
  assert.equal(sessionInMembership(s({ specialismName: 'Music' }), { specialisms: ['Music'], groups: ['2'] }), true)
  assert.equal(sessionInMembership(s({ groups: '4-6' }), { specialisms: [], groups: ['2'] }), false)
})

test('worker-config adapter agrees with the membership test for a shared fixture', () => {
  const fixture = [
    { title: 'A', groups: '1-10', specialismName: undefined },
    { title: 'B', groups: '11, 12' },
    { title: 'C', groups: '', specialismName: 'PE' },
    { title: 'D', groups: 'all groups', specialismName: 'Music' },
  ]
  const config = { spec: ['Music'], groups: ['2'] }
  const filtered = filterSessionsForMembership(fixture, config)
  assert.deepEqual(filtered.map((s) => s.title), ['A', 'D'])
  const viaMembership = fixture.filter((s) =>
    sessionInMembership(s, { specialisms: config.spec, groups: config.groups })
  )
  assert.deepEqual(filtered, viaMembership)
})
