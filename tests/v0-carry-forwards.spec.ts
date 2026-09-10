import { expect, test } from './fixtures'
import type { Page, Route } from '@playwright/test'

/**
 * V0 (Pass 56) — carry-forward defects FA-01/02/05/06/07 from the project
 * audit. Synthetic data only; the push worker is a routed mock; the service
 * worker is blocked, so the "no subscription" paths are exercised through
 * the pending state and the HTTP paths through an injected fake registration.
 */

const DEMO = { demo: true, sheetId: '', gid: null, specialismsChosen: true, checklistDismissed: true, usagePing: false }
const MATHS = '2026-09-07|14:30|maths 1'

async function seed(page: Page, opts: { settings?: Record<string, unknown>; profiles?: { id: string; name: string; settings?: Record<string, unknown> }[]; meta?: Record<string, unknown>; extra?: Record<string, string>; fakePush?: boolean; clock?: string } = {}) {
  await page.clock.install({ time: new Date(opts.clock ?? '2026-09-07T15:40:00Z') })
  await page.addInitScript(
    ({ profiles, meta, extra, fakePush }) => {
      localStorage.setItem('timetable.whatsnew.v1', '99')
      Object.defineProperty(window, 'Notification', { value: class { static permission = 'granted'; static requestPermission() { return Promise.resolve('granted') } constructor() {} }, configurable: true })
      if (fakePush) {
        // A fake service-worker registration with one push subscription, so the report path runs without a real SW.
        const fakeReg = { pushManager: { getSubscription: () => Promise.resolve({ endpoint: 'https://fcm.googleapis.com/fcm/send/fake-endpoint-1' }) } }
        Object.defineProperty(navigator, 'serviceWorker', { value: { ready: Promise.resolve(fakeReg), getRegistration: () => Promise.resolve(undefined), addEventListener() {}, removeEventListener() {} }, configurable: true })
      }
      if (localStorage.getItem('timetable.store.v2')) return
      localStorage.setItem('timetable.store.v2', JSON.stringify({ activeId: profiles[0].id, profiles }))
      if (meta) localStorage.setItem('timetable.meta.v2.' + profiles[0].id, JSON.stringify(meta))
      for (const [k, v] of Object.entries(extra ?? {})) localStorage.setItem(k, v)
    },
    {
      profiles: opts.profiles ?? [{ id: 'd', name: 'Demo learner', settings: { ...DEMO, ...(opts.settings ?? {}) } }],
      meta: opts.meta ?? null,
      extra: opts.extra ?? {},
      fakePush: opts.fakePush ?? false,
    }
  )
  await page.setViewportSize({ width: 390, height: 900 })
}

const ls = (page: Page, key: string) => page.evaluate((k) => localStorage.getItem(k), key)

function pushMock() {
  const state = { responses: [] as (number | 'network')[], bodies: [] as Record<string, unknown>[] }
  const handler = async (route: Route) => {
    const url = new URL(route.request().url())
    if (['127.0.0.1', 'localhost'].includes(url.hostname)) return route.continue()
    if (url.hostname !== 'push.test') return route.abort()
    if (url.pathname !== '/attendance') return route.fulfill({ status: 404, json: { error: 'not found' } })
    state.bodies.push(route.request().postDataJSON() as Record<string, unknown>)
    const next = state.responses.shift() ?? 200
    if (next === 'network') return route.abort()
    if (next === 200) return route.fulfill({ json: { ok: true, rev: 1 } })
    if (next === 409) return route.fulfill({ status: 409, json: { error: 'stale report', rev: 7 } })
    return route.fulfill({ status: next, json: { error: `HTTP ${next}` } })
  }
  return { state, handler }
}

test('FA-01/02: only an accepted report is acknowledged; 400/404/429/500/network keep a pending state; the ack is identity-scoped', async ({ page, context }) => {
  test.setTimeout(120_000)
  const mock = pushMock()
  await context.route('**/*', mock.handler)
  await seed(page, { settings: { pushEnabled: true, attendancePrompts: true, pushServerBase: 'https://push.test' }, meta: { [MATHS]: { attended: true, at: 1 } }, fakePush: true })
  await page.goto('./#/today')
  // First report (debounced 1.5 s) is accepted → acknowledged, no pending state.
  await page.clock.runFor(2_000)
  await expect.poll(() => mock.state.bodies.length).toBe(1)
  expect(mock.state.bodies[0]).toMatchObject({ v: 2, profileId: 'd', day: '2026-09-07', rev: 1, keys: [MATHS] })
  await expect.poll(() => ls(page, 'timetable.marks-ack.v2')).toContain('push.test|')
  expect(await ls(page, 'timetable.marks-pending.v2')).toBeNull()
  const ack = JSON.parse((await ls(page, 'timetable.marks-ack.v2'))!)
  const identity = Object.keys(ack)[0]
  expect(identity).toMatch(/^https:\/\/push\.test\|[0-9a-f]{24}\|d\|2026-09-07\|v2$/)
  expect(identity).not.toContain('fake-endpoint') // fingerprint, never the raw endpoint
  // Attended → absent changes the VALUE, not the set of answered sessions: correctly no new report.
  await page.evaluate((k) => {
    const m = JSON.parse(localStorage.getItem('timetable.meta.v2.d')!)
    m[k] = { ...m[k], absent: true, attended: false, at: Date.now() }
    localStorage.setItem('timetable.meta.v2.d', JSON.stringify(m))
  }, MATHS)
  await page.reload()
  await page.clock.runFor(2_000)
  await page.waitForTimeout(300)
  expect(mock.state.bodies).toHaveLength(1)
  // Clearing the answer changes the set to [] — a failing report keeps the local record and records a
  // pending state instead of an acknowledgement; each failure kind keeps the snapshot unacknowledged.
  await page.evaluate((k) => {
    const m = JSON.parse(localStorage.getItem('timetable.meta.v2.d')!)
    m[k] = { note: 'cleared', at: Date.now() }
    localStorage.setItem('timetable.meta.v2.d', JSON.stringify(m))
  }, MATHS)
  for (const status of [500, 429, 400] as const) {
    mock.state.responses = [status]
    const before = mock.state.bodies.length
    await page.reload()
    await page.clock.runFor(2_000)
    await expect.poll(() => mock.state.bodies.length).toBeGreaterThan(before)
    expect(mock.state.bodies[mock.state.bodies.length - 1]).toMatchObject({ keys: [] })
    await expect.poll(async () => JSON.parse((await ls(page, 'timetable.marks-pending.v2')) ?? 'null')?.status).toBe(status === 400 ? 'configuration' : 'retryable')
    const meta = JSON.parse((await ls(page, 'timetable.meta.v2.d'))!)
    expect(meta[MATHS].note).toBe('cleared') // the local record itself is never lost
    expect(JSON.parse((await ls(page, 'timetable.marks-ack.v2'))!)[identity].snapshot).toBe(JSON.stringify([MATHS])) // still the last ACCEPTED snapshot
  }
  // Retryable failures retry with backoff on their own; a later accepted report clears the pending state.
  mock.state.responses = [500, 200]
  await page.reload()
  await page.clock.runFor(2_000)
  await expect.poll(async () => JSON.parse((await ls(page, 'timetable.marks-pending.v2')) ?? 'null')?.status).toBe('retryable')
  await page.clock.runFor(61_000)
  await expect.poll(() => ls(page, 'timetable.marks-pending.v2'), { timeout: 15_000 }).toBeNull()
  expect(JSON.parse((await ls(page, 'timetable.marks-ack.v2'))!)[identity].snapshot).toBe('[]')
  // Re-answering changes the set again → a new report with the next revision.
  const sent = mock.state.bodies.length
  await page.evaluate((k) => {
    const m = JSON.parse(localStorage.getItem('timetable.meta.v2.d')!)
    m[k] = { attended: true, at: Date.now() }
    localStorage.setItem('timetable.meta.v2.d', JSON.stringify(m))
  }, MATHS)
  await page.reload()
  await page.clock.runFor(2_000)
  await expect.poll(() => mock.state.bodies.length).toBe(sent + 1)
  expect(mock.state.bodies[sent]).toMatchObject({ keys: [MATHS] })
})

test('FA-02: no subscription → pending/unavailable, never acknowledged; another profile reports its own snapshot', async ({ page, context }) => {
  const mock = pushMock()
  await context.route('**/*', mock.handler)
  await seed(page, {
    profiles: [
      { id: 'a', name: 'Profile A', settings: { ...DEMO, pushEnabled: true, attendancePrompts: true, pushServerBase: 'https://push.test' } },
      { id: 'b', name: 'Profile B', settings: { ...DEMO, pushEnabled: true, attendancePrompts: true, pushServerBase: 'https://push.test' } },
    ],
    meta: { [MATHS]: { attended: true, at: 1 } },
  })
  await page.goto('./#/today')
  await page.clock.runFor(2_000)
  await expect.poll(async () => JSON.parse((await ls(page, 'timetable.marks-pending.v2')) ?? 'null')?.status).toBe('unavailable')
  expect(await ls(page, 'timetable.marks-ack.v2')).toBeNull()
  expect(mock.state.bodies).toHaveLength(0)
  await page.goto('./#/settings/reminders')
  await expect(page.getByText(/have not been confirmed by the push server yet/)).toBeVisible()
})

test('FA-05: shared photos wait in an inbox, attach only on confirmation, survive a reload and are counted from stored files', async ({ page }) => {
  await seed(page)
  await page.goto('./#/today')
  // Two synthetic images parked by the service worker's share handler.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const req = indexedDB.open('timetable-share', 1)
        req.onupgradeneeded = () => req.result.createObjectStore('photos', { autoIncrement: true })
        req.onsuccess = () => {
          const tx = req.result.transaction('photos', 'readwrite')
          const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0))
          tx.objectStore('photos').add({ blob: new Blob([png], { type: 'image/png' }), at: Date.now() - 60_000 })
          tx.objectStore('photos').add({ blob: new Blob([png], { type: 'image/png' }), at: Date.now() })
          tx.oncomplete = () => resolve()
        }
      })
  )
  await page.reload()
  const sheet = page.getByRole('dialog', { name: 'Shared photos' })
  await expect(sheet).toBeVisible()
  await expect(sheet.getByText(/2 photos shared into My Timetable/)).toBeVisible()
  // Default destination: the most recently started session on the course clock (Maths 1 ended 16:30).
  await expect(sheet.getByLabel('Attach to session').locator('option:checked')).toHaveText(/Maths 1/)
  // "Later" keeps everything; the inbox is intact after a reload.
  await sheet.getByRole('button', { name: 'Later' }).click()
  await page.reload()
  await expect(page.getByRole('dialog', { name: 'Shared photos' })).toBeVisible()
  await expect(page.getByRole('list', { name: 'Shared photos waiting' }).getByRole('listitem')).toHaveCount(2)
  // Discard needs confirmation; declining keeps the item.
  page.once('dialog', (d) => void d.dismiss())
  await page.getByRole('list', { name: 'Shared photos waiting' }).getByRole('button', { name: 'Discard' }).first().click()
  await expect(page.getByRole('list', { name: 'Shared photos waiting' }).getByRole('listitem')).toHaveCount(2)
  // Attach: photos are written, the inbox empties, the count comes from stored files, the session opens.
  await page.getByRole('button', { name: 'Attach 2 photos' }).click()
  await expect(page.locator('.detail-page')).toBeVisible()
  const stored = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const req = indexedDB.open('timetable-photos', 1)
        req.onsuccess = () => {
          const tx = req.result.transaction('photos', 'readonly')
          const g = tx.objectStore('photos').getAll()
          g.onsuccess = () => resolve((g.result as { owner: string }[]).filter((p) => p.owner === 'd|2026-09-07|14:30|maths 1').length)
        }
      })
  )
  expect(stored).toBe(2)
  const meta = JSON.parse((await ls(page, 'timetable.meta.v2.d'))!)
  expect(meta[MATHS].photos).toBe(2)
  const inbox = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const req = indexedDB.open('timetable-share', 1)
        req.onsuccess = () => {
          const tx = req.result.transaction('photos', 'readonly')
          const g = tx.objectStore('photos').getAll()
          g.onsuccess = () => resolve(g.result.length)
        }
      })
  )
  expect(inbox).toBe(0)
  await page.reload()
  await expect(page.getByRole('dialog', { name: 'Shared photos' })).toHaveCount(0)
})

test('FA-06: backup coverage is tracked per timetable; a legacy timestamp is scope-unknown; the nudge follows the uncovered profile', async ({ page }) => {
  await seed(page, {
    profiles: [
      { id: 'a', name: 'Profile A', settings: DEMO },
      { id: 'b', name: 'Profile B', settings: DEMO },
    ],
    meta: { [MATHS]: { note: 'x', at: 1 } },
    extra: { 'timetable.backup.v1': JSON.stringify({ lastBackupAt: Date.parse('2026-09-01T10:00:00Z') }) },
  })
  await page.goto('./#/settings/data')
  const health = page.getByRole('list', { name: 'Data health' })
  await expect(health).toContainText('Profile A: scope unknown (older backup)')
  await expect(health).toContainText('Profile B: scope unknown (older backup)')
  // Scoped export of A only.
  await page.getByRole('button', { name: 'Back up… (preview first)' }).click()
  const sheet = page.getByRole('dialog', { name: 'Back up' })
  await sheet.getByRole('button', { name: /^Only “Profile A”/ }).click()
  const dl = page.waitForEvent('download')
  await sheet.getByRole('button', { name: 'Generate backup' }).click()
  await dl
  await sheet.getByRole('button', { name: 'Done' }).click()
  await expect(health).toContainText(/Profile A: included 7 Sept/)
  await expect(health).toContainText('Profile B: scope unknown (older backup)')
  const book = JSON.parse((await ls(page, 'timetable.backup.v1'))!)
  expect(book.history[0]).toMatchObject({ profiles: ['a'], all: false, kind: 'file' })
  // The device-wide nudge stays because B is not covered.
  await page.goto('./#/today')
  await expect(page.getByText(/live only on this device/)).toBeVisible()
  // Everything → both covered → the nudge goes; a NEW profile is not covered by that export.
  await page.goto('./#/settings/data')
  await page.getByRole('button', { name: 'Back up… (preview first)' }).click()
  const dl2 = page.waitForEvent('download')
  await sheet.getByRole('button', { name: 'Generate backup' }).click()
  await dl2
  await sheet.getByRole('button', { name: 'Done' }).click()
  await expect(health).toContainText(/Profile B: included 7 Sept/)
  await page.goto('./#/today')
  await expect(page.getByText(/live only on this device/)).toHaveCount(0)
})

test('FA-07: the restore preview states per-section effects, absent vs empty, attachments already present and newer local edits', async ({ page }) => {
  await seed(page, {
    profiles: [
      { id: 'a', name: 'Profile A', settings: DEMO },
      { id: 'z', name: 'Unrelated', settings: DEMO },
    ],
    meta: { [MATHS]: { note: 'edited later', at: Date.parse('2026-09-07T12:00:00Z') } },
  })
  await page.goto('./#/settings/data')
  // A v4 backup created BEFORE the local edit: meta present, admin explicitly empty, cache/changes absent.
  const backup = {
    version: 4,
    exportedAt: '2026-09-06T10:00:00.000Z',
    store: { activeId: 'a', profiles: [{ id: 'a', name: 'Profile A', settings: DEMO }, { id: 'n', name: 'Newcomer', settings: DEMO }] },
    meta: { a: { [MATHS]: { note: 'from backup', at: 5 } }, n: {} },
    admin: { a: { reflections: [], targets: [], meetings: [], observations: [], lessons: [], audits: [], tasks: [], exceptions: [], plans: [], commitments: [] } },
  }
  await page.locator('#backup input[type="file"]').setInputFiles({ name: 'b.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) })
  const restore = page.getByRole('dialog', { name: 'Restore backup' })
  const impact = restore.getByRole('list', { name: 'What restoring will do' })
  await expect(impact).toContainText('Profile A (existing)')
  await expect(impact).toContainText('session records replaced')
  await expect(impact).toContainText('PGCE/tasks replaced with an empty set')
  await expect(impact).toContainText('cached timetable not in the file — kept as it is')
  await expect(impact).toContainText('this device has edits newer than the backup')
  await expect(impact).toContainText('Newcomer (new on this device)')
  await expect(impact).toContainText('session records replaced with an empty set')
  await expect(impact).toContainText('Unrelated — untouched')
  await expect(impact).toContainText('6 Sept')
  // Restoring does exactly that: A's cache/changes untouched, the unrelated profile kept.
  const reloaded = page.waitForEvent('load')
  await restore.getByRole('button', { name: 'Restore', exact: true }).click()
  await reloaded
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  const store = await page.evaluate(() => JSON.parse(localStorage.getItem('timetable.store.v2')!))
  expect(store.profiles.map((p: { id: string }) => p.id).sort()).toEqual(['a', 'n', 'z'])
  const meta = JSON.parse((await ls(page, 'timetable.meta.v2.a'))!)
  expect(meta[MATHS].note).toBe('from backup')
})
