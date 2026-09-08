import test from 'node:test'
import assert from 'node:assert/strict'
import { buildFindIndex, normalizeText, searchFindIndex, FIND_PAGE_SIZE } from '../../shared/find.js'

const owners = [
  { ownerType: 'session', ownerId: 's1', rev: 1, title: 'English 1', date: '2026-09-01', time: '11:30', text: 'Bedford Way Rm 421 EK', kind: 'Session' },
  { ownerType: 'personal', ownerId: 'c1', rev: 5, title: 'Dentist appointment', date: '2026-09-09', time: '17:00', text: 'Appointment', content: 'Bring the referral letter', kind: 'Personal event' },
  { ownerType: 'task', ownerId: 't1', rev: 3, title: 'Big essay', date: '2026-09-30', text: '', content: 'Discuss phonics and reading fluency', kind: 'Task' },
  { ownerType: 'document', ownerId: 'w1', rev: 2, title: 'DBS certificate.pdf', text: 'document', kind: 'Document' },
]

test('normalizeText folds case, accents and punctuation', () => {
  assert.equal(normalizeText('  Café — “Lesson”, 2!  '), 'cafe lesson 2')
})

test('default scope searches titles/rooms/tutors; notes only when opted in', () => {
  const idx = buildFindIndex('p1', owners)
  assert.equal(searchFindIndex(idx, 'rm 421').results[0].ownerId, 's1')
  assert.equal(searchFindIndex(idx, 'phonics').total, 0)
  const withNotes = searchFindIndex(idx, 'phonics', { includeContent: true })
  assert.equal(withNotes.total, 1)
  assert.equal(withNotes.results[0].matchedIn, 'content')
  assert.match(withNotes.results[0].snippet, /phonics/i)
  assert.equal(searchFindIndex(idx, 'dbs').results[0].ownerType, 'document')
})

test('rebuild reuses unchanged entries and drops tombstoned owners', () => {
  const first = buildFindIndex('p1', owners)
  const renamed = owners.map((o) => (o.ownerId === 't1' ? { ...o, title: 'Bigger essay', rev: 4 } : o)).filter((o) => o.ownerId !== 'c1')
  const second = buildFindIndex('p1', renamed, first)
  assert.equal(second.size, 3)
  assert.equal(searchFindIndex(second, 'dentist').total, 0)
  assert.equal(searchFindIndex(second, 'bigger').total, 1)
  assert.equal(searchFindIndex(second, 'big essay').results[0].title, 'Bigger essay')
  // Unchanged owner: the very same entry object survives.
  assert.equal(second.byKey.get('p1|session|s1'), first.byKey.get('p1|session|s1'))
  // A different profile never inherits entries.
  const other = buildFindIndex('p2', [], first)
  assert.equal(other.size, 0)
})

test('ranking: title hits first, then upcoming soonest, then past newest', () => {
  const idx = buildFindIndex('p1', [
    { ownerType: 'session', ownerId: 'a', rev: 1, title: 'Maths 1', date: '2026-09-20', time: '09:00', text: 'maths room' },
    { ownerType: 'session', ownerId: 'b', rev: 1, title: 'Maths 1', date: '2026-09-10', time: '09:00', text: 'maths room' },
    { ownerType: 'session', ownerId: 'c', rev: 1, title: 'Maths 1', date: '2026-08-01', time: '09:00', text: 'maths room' },
    { ownerType: 'session', ownerId: 'd', rev: 1, title: 'Science', date: '2026-09-11', time: '09:00', text: 'maths building' },
  ])
  const ids = searchFindIndex(idx, 'maths', { todayISO: '2026-09-07' }).results.map((r) => r.ownerId)
  assert.deepEqual(ids, ['b', 'a', 'c', 'd'])
})

test('10,000 entries: paged to 50 and every query answers fast', () => {
  const many = []
  for (let i = 0; i < 10_000; i++) {
    many.push({ ownerType: i % 3 === 0 ? 'task' : 'session', ownerId: `o${i}`, rev: i, title: `Record ${i} ${i % 7 === 0 ? 'phonics' : 'fluency'}`, date: `2026-${String(1 + (i % 12)).padStart(2, '0')}-${String(1 + (i % 28)).padStart(2, '0')}`, text: `Room ${i % 50}`, content: `note ${i}` })
  }
  const t0 = performance.now()
  const idx = buildFindIndex('p1', many)
  const built = performance.now() - t0
  assert.ok(built < 1500, `index build took ${built.toFixed(0)} ms`)
  const queries = ['phonics', 'record 12', 'room 7', 'flu', 'record 9999', 'zzz']
  let slowest = 0
  for (const q of queries) {
    const t = performance.now()
    const r = searchFindIndex(idx, q, { includeContent: true })
    slowest = Math.max(slowest, performance.now() - t)
    assert.ok(r.results.length <= FIND_PAGE_SIZE)
  }
  assert.ok(slowest < 200, `slowest query ${slowest.toFixed(0)} ms`)
  const page2 = searchFindIndex(idx, 'record', { offset: 50 })
  assert.equal(page2.results.length, 50)
  assert.equal(page2.total, 10_000)
})
