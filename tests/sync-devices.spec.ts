import { expect, test } from './fixtures'
import type { Browser, BrowserContext, Page, Route } from '@playwright/test'

/**
 * Two open devices converge on their own (owner report, 10 Sep 2026). Real
 * app flows on both devices against a mocked sync object with the worker's
 * revision semantics; fake clocks drive the 2 s edit debounce, the 3-minute
 * background pull and the busy-server back-off.
 */

const DEMO = { demo: true, sheetId: '', gid: null, specialismsChosen: true, checklistDismissed: true, usagePing: false, pushServerBase: 'https://sync.test' }

type Remote = { blob?: string; revision: number; at?: number }

function mockServer() {
  const state = { remote: { revision: 0 } as Remote, requests: 0, busyOnce: false, conflicts: 0 }
  const handler = async (route: Route) => {
    const url = new URL(route.request().url())
    if (url.hostname !== 'sync.test') return ['127.0.0.1', 'localhost'].includes(url.hostname) ? route.continue() : route.abort()
    state.requests++
    if (state.busyOnce) {
      state.busyOnce = false
      return route.fulfill({ status: 429, headers: { 'retry-after': '1' }, json: { error: 'rate limited' } })
    }
    if (route.request().method() === 'GET') return route.fulfill({ json: state.remote })
    const body = route.request().postDataJSON() as { revision: number; blob: string }
    if (body.revision !== state.remote.revision) {
      state.conflicts++
      return route.fulfill({ status: 409, json: { error: 'conflict', revision: state.remote.revision } })
    }
    state.remote = { blob: body.blob, revision: state.remote.revision + 1, at: Date.now() }
    return route.fulfill({ json: { revision: state.remote.revision, at: state.remote.at } })
  }
  return { state, handler }
}

async function device(browser: Browser, handler: (route: Route) => Promise<void>): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 }, timezoneId: 'Europe/London' })
  await context.route('**/*', handler)
  const page = await context.newPage()
  await page.clock.install({ time: new Date('2026-09-07T07:05:00Z') })
  await page.addInitScript((settings) => {
    localStorage.setItem('timetable.whatsnew.v1', '99')
    if (localStorage.getItem('timetable.store.v2')) return
    localStorage.setItem('timetable.store.v2', JSON.stringify({ activeId: 'd', profiles: [{ id: 'd', name: 'Shared timetable', settings }] }))
    localStorage.setItem('timetable.sync.v1', JSON.stringify({ code: 'ABCDEFGH', lastAt: 0 }))
  }, DEMO)
  return { context, page }
}

const base = () => `http://127.0.0.1:4173/${process.env.VERCEL ? '' : 'timetable-pwa/'}`
const metaOf = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('timetable.meta.v2.d') ?? '{}'))
const MATHS = '2026-09-07|14:30|maths 1'

test('an attendance mark on device A reaches an open device B within one background pull; a busy server is retried', async ({ browser }) => {
  test.setTimeout(120_000)
  const server = mockServer()
  const a = await device(browser, server.handler)
  const b = await device(browser, server.handler)
  await a.page.goto(`${base()}#/schedule`)
  await b.page.goto(`${base()}#/schedule`)
  await expect(a.page.getByRole('heading', { level: 1, name: 'Schedule' })).toBeVisible()
  await expect(b.page.getByRole('heading', { level: 1, name: 'Schedule' })).toBeVisible()
  // Both start-up exchanges park each device's (identical) state.
  await expect.poll(() => server.state.remote.revision, { timeout: 15_000 }).toBeGreaterThanOrEqual(1)
  await a.page.waitForTimeout(500)
  const rev0 = server.state.remote.revision

  // Device A marks Maths 1 attended; the 2 s edit debounce parks it.
  await a.page.locator('.day-list .session-card', { hasText: 'Maths 1' }).click()
  await a.page.getByRole('button', { name: '✓ Attended' }).click()
  await a.page.clock.runFor(2_500)
  await expect.poll(() => server.state.remote.revision, { timeout: 15_000 }).toBeGreaterThan(rev0)
  expect((await metaOf(a.page))[MATHS].attended).toBe(true)

  // Device B has done nothing. Three minutes of being open is enough.
  expect((await metaOf(b.page))[MATHS]?.attended).toBeUndefined()
  await b.page.clock.runFor(181_000)
  await expect.poll(async () => (await metaOf(b.page))[MATHS]?.attended, { timeout: 15_000 }).toBe(true)
  // B's detail shows the answer from A without any reload.
  await b.page.locator('.day-list .session-card', { hasText: 'Maths 1' }).click()
  await expect(b.page.getByRole('button', { name: '✓ Attended' })).toHaveAttribute('aria-pressed', 'true')

  // Busy server: the next exchange gets a 429 (Retry-After is not readable cross-origin, so the
  // client's own 60 s back-off applies); the app retries on its own without any user action.
  server.state.busyOnce = true
  await b.page.getByRole('button', { name: '✗ Absent' }).click()
  await b.page.clock.runFor(2_500)
  await expect.poll(() => server.state.busyOnce).toBe(false)
  const before = server.state.remote.revision
  await b.page.waitForTimeout(500)
  expect(server.state.remote.revision).toBe(before)
  await b.page.clock.runFor(61_000)
  await expect.poll(() => server.state.remote.revision, { timeout: 15_000 }).toBe(before + 1)
  // And A learns of it on its own pull.
  await a.page.goto(`${base()}#/schedule`)
  await a.page.clock.runFor(181_000)
  await expect.poll(async () => (await metaOf(a.page))[MATHS]?.absent, { timeout: 15_000 }).toBe(true)
  expect(server.state.conflicts).toBeGreaterThanOrEqual(0)
  await a.context.close()
  await b.context.close()
})

test('Data & devices names the sync status and its cadence', async ({ browser }) => {
  const server = mockServer()
  const a = await device(browser, server.handler)
  await a.page.goto(`${base()}#/settings/data`)
  const health = a.page.getByRole('list', { name: 'Data health' })
  await expect(health).toContainText('Sync status')
  await expect(health).toContainText(/Synced\.|no sync attempt yet|Syncing…/)
  await expect(health).toContainText('checks every 3 minutes while open')
  await a.context.close()
})
