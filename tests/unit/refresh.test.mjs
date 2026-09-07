import test from 'node:test'
import assert from 'node:assert/strict'
import { createGenerationGate, planSources, resolveSourceResults, sourceKeyOf } from '../../shared/refresh.js'

const settings = {
  sheetId: 'S'.repeat(24),
  gid: '10',
  extraTabs: [{ sheetId: 'E'.repeat(24), gid: '20', url: '' }],
  keyDatesSheetId: 'K'.repeat(24),
  keyDatesGid: '30',
}
const row = (patch = {}) => ({ id: 'r1', title: 'A', dateISO: '2026-09-07', start: '09:00', end: '10:00', room: '', ...patch })

test('planSources lists main, extra tabs and key dates in a stable order; demo plans nothing', () => {
  const plan = planSources(settings)
  assert.deepEqual(plan.map((p) => p.kind), ['timetable', 'extra', 'keydates'])
  assert.equal(sourceKeyOf(plan[0]), `${settings.sheetId}|10`)
  assert.deepEqual(planSources({ demo: true, sheetId: 'x'.repeat(24) }), [])
  assert.deepEqual(planSources(null), [])
})

test('one failed source keeps its last good rows, labelled stale, without advancing success time', () => {
  const plan = planSources(settings)
  const prev = [
    row({ sourceKey: sourceKeyOf(plan[1]), title: 'Extra old' }),
    row({ sourceKey: sourceKeyOf(plan[0]), title: 'Main old' }),
  ]
  const { bySource, statuses } = resolveSourceResults(
    plan,
    {
      main: { ok: true, rows: [row({ title: 'Main fresh' })], warnings: [] },
      [plan[1].id]: { ok: false, error: 'network down' },
      keydates: { ok: true, rows: [], warnings: [] },
    },
    prev,
    1000
  )
  assert.deepEqual(bySource.get('main').map((r) => r.title), ['Main fresh'])
  assert.deepEqual(bySource.get(plan[1].id).map((r) => r.title), ['Extra old'])
  const extraStatus = statuses.find((s) => s.id === plan[1].id)
  assert.equal(extraStatus.status, 'stale')
  assert.equal(extraStatus.lastSuccessAt, null)
  assert.equal(extraStatus.lastAttemptAt, 1000)
  assert.equal(statuses[0].status, 'ok')
  assert.equal(statuses[0].lastSuccessAt, 1000)
})

test('a failed source with nothing cached reports an error and returns no rows', () => {
  const plan = planSources({ ...settings, extraTabs: [], keyDatesSheetId: undefined })
  const { bySource, statuses, warnings } = resolveSourceResults(plan, { main: { ok: false, error: 'HTTP 500' } }, [])
  assert.deepEqual(bySource.get('main'), [])
  assert.equal(statuses[0].status, 'error')
  assert.match(warnings.join(' '), /HTTP 500/)
})

test('rows from a source that is no longer configured are dropped from the live set', () => {
  const plan = planSources({ ...settings, extraTabs: [], keyDatesSheetId: undefined })
  const removedKey = 'OLDSHEETOLDSHEETOLDSHEET|9'
  const prev = [row({ sourceKey: removedKey, title: 'Removed tab row' })]
  const { bySource } = resolveSourceResults(plan, { main: { ok: true, rows: [row()], warnings: [] } }, prev)
  const all = [...bySource.values()].flat()
  assert.ok(!all.some((r) => r.title === 'Removed tab row'))
})

test('cached rows without a sourceKey belong to the main source and survive its failure', () => {
  const plan = planSources({ ...settings, extraTabs: [], keyDatesSheetId: undefined })
  const prev = [row({ title: 'Legacy cached row' })] // no sourceKey (pre-phase-2 cache)
  const { bySource, statuses } = resolveSourceResults(plan, { main: { ok: false, error: 'offline' } }, prev)
  assert.deepEqual(bySource.get('main').map((r) => r.title), ['Legacy cached row'])
  assert.equal(statuses[0].status, 'stale')
})

test('warning-only source stays ok and keeps its warnings; empty rows are not an error', () => {
  const plan = planSources({ ...settings, extraTabs: [], keyDatesSheetId: undefined })
  const { statuses } = resolveSourceResults(plan, { main: { ok: true, rows: [], warnings: ['Row 4 skipped'] } }, [])
  assert.equal(statuses[0].status, 'ok')
  assert.deepEqual(statuses[0].warnings, ['Row 4 skipped'])
})

test('generation gate: an older request that resolves after a newer one is not current', async () => {
  const gate = createGenerationGate()
  const a = gate.begin()
  const slowA = new Promise((resolve) => setTimeout(() => resolve(a.isCurrent()), 30))
  const b = gate.begin()
  const fastB = Promise.resolve(b.isCurrent())
  assert.equal(await fastB, true)
  assert.equal(await slowA, false)
  // Two refreshes resolving in reverse order: only the later generation may publish.
  const c = gate.begin()
  const d = gate.begin()
  assert.equal(c.isCurrent(), false)
  assert.equal(d.isCurrent(), true)
})
