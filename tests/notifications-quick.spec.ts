import { expect, test } from './fixtures'
import type { Page } from '@playwright/test'

/**
 * Notification behaviour changes (owner request, 9 Sep 2026): no leave alert
 * when already at the session's location; no "did you attend?" once a
 * session is answered; quick Attended/Absent answers on Today and when a
 * prompt notification is opened. Demo profile, frozen clock, no network.
 */

// The in-app reminder loop reads the DEVICE clock; CI runs in UTC, so pin the
// browser to the course zone the fixtures were written in.
test.use({ timezoneId: 'Europe/London' })

const DEMO = { demo: true, sheetId: '', gid: null, specialismsChosen: true, checklistDismissed: true, usagePing: false }
// Demo Monday 7 Sept 2026: PS1 09:00–11:00 (Bedford Way), Maths 1 14:30–16:30.
const BEDFORD_WAY = { latitude: 51.5227, longitude: -0.1276 }
const FAR_AWAY = { latitude: 51.55, longitude: -0.19 }
const MATHS = '2026-09-07|14:30|maths 1'

async function seed(page: Page, opts: { clock: string; settings?: Record<string, unknown>; meta?: Record<string, unknown> }) {
  await page.clock.install({ time: new Date(opts.clock) })
  await page.addInitScript(
    ({ settings, meta }) => {
      localStorage.setItem('timetable.whatsnew.v1', '99')
      const received: string[] = []
      Object.assign(window, { received })
      Object.defineProperty(window, 'Notification', {
        value: class {
          static permission = 'granted'
          static requestPermission() {
            return Promise.resolve('granted')
          }
          constructor(title: string) {
            received.push(title)
          }
        },
        configurable: true,
      })
      if (localStorage.getItem('timetable.store.v2')) return
      localStorage.setItem('timetable.store.v2', JSON.stringify({ activeId: 'd', profiles: [{ id: 'd', name: 'Demo learner', settings }] }))
      if (meta) localStorage.setItem('timetable.meta.v2.d', JSON.stringify(meta))
    },
    { settings: { ...DEMO, ...(opts.settings ?? {}) }, meta: opts.meta ?? null }
  )
  await page.setViewportSize({ width: 390, height: 844 })
}

const received = (page: Page) => page.evaluate(() => (window as unknown as { received: string[] }).received)

test('leave alert: sent when far from the session, silent when already at its building', async ({ page, context }) => {
  await context.grantPermissions(['geolocation'])
  const leave = { locationEnabled: true, travelMode: 'walking', leaveAlertOffsets: [10] }
  // 08:52 London time: PS1 starts in 8 minutes.
  await context.setGeolocation(FAR_AWAY)
  await seed(page, { clock: '2026-09-07T07:52:00Z', settings: leave })
  await page.goto('./#/today')
  // The 30-second check must run AFTER the device fix has arrived.
  await expect(page.getByText(/from your location/)).toBeVisible()
  await page.clock.runFor(35_000)
  await expect.poll(() => received(page)).toEqual(expect.arrayContaining([expect.stringMatching(/Time to leave — PS1|Leave in .* — PS1/)]))

  // Same moment, standing at Bedford Way: nothing.
  await page.close()
  const page2 = await context.newPage()
  await context.setGeolocation(BEDFORD_WAY)
  await seed(page2, { clock: '2026-09-07T07:52:00Z', settings: leave })
  await page2.goto('./#/today')
  await expect(page2.getByText(/from your location|You're here|at the building/).first()).toBeVisible()
  await page2.clock.runFor(35_000)
  await page2.waitForTimeout(300)
  expect((await received(page2)).filter((t) => /leave/i.test(t))).toEqual([])
})

test('attendance prompt: asked once for an unanswered session, never for one already marked attended or absent', async ({ page }) => {
  // 16:40 London time: Maths 1 ended 10 minutes ago.
  await seed(page, { clock: '2026-09-07T15:40:00Z', settings: { attendancePrompts: true } })
  await page.goto('./#/today')
  await page.clock.runFor(35_000)
  await expect.poll(() => received(page)).toContain('Did you attend Maths 1?')
  await page.close()
})

test('attendance prompt: a session marked absent is not asked; Today offers ✓ Attended / ✗ Absent for a session that just ended', async ({ page }) => {
  await seed(page, { clock: '2026-09-07T15:40:00Z', settings: { attendancePrompts: true }, meta: { [MATHS]: { absent: true, at: 1 } } })
  await page.goto('./#/today')
  await page.clock.runFor(35_000)
  await page.waitForTimeout(300)
  expect(await received(page)).not.toContain('Did you attend Maths 1?')
  await expect(page.getByRole('region', { name: 'Attendance prompt' })).toHaveCount(0)
  // Clear the answer: the Today card appears with both quick answers; ✓ writes attended.
  await page.evaluate(() => localStorage.setItem('timetable.meta.v2.d', JSON.stringify({})))
  await page.reload()
  const card = page.getByRole('region', { name: 'Attendance prompt' })
  await expect(card).toBeVisible()
  await expect(card).toContainText('Maths 1')
  await card.getByRole('button', { name: '✓ Attended' }).click()
  await expect(card).toHaveCount(0)
  const meta = await page.evaluate(() => JSON.parse(localStorage.getItem('timetable.meta.v2.d')!))
  expect(meta[MATHS].attended).toBe(true)
  expect(meta[MATHS].absent).toBe(false)
})

test('a tapped "did you attend?" notification opens the quick answer sheet (queued open with kind attendance), and ✗ Absent writes the record', async ({ page }) => {
  await seed(page, { clock: '2026-09-07T15:40:00Z', settings: { attendancePrompts: true } })
  await page.goto('./#/schedule')
  await expect(page.getByRole('heading', { level: 1, name: 'Schedule' })).toBeVisible()
  await page.waitForTimeout(500) // let the app's own start-up pass over the queue finish first
  // Queue what the service worker stores when a prompt is tapped with no window open.
  await page.evaluate(
    (key) =>
      new Promise<void>((resolve) => {
        const req = indexedDB.open('timetable-actions', 1)
        req.onupgradeneeded = () => req.result.createObjectStore('pending', { autoIncrement: true })
        req.onsuccess = () => {
          const tx = req.result.transaction('pending', 'readwrite')
          tx.objectStore('pending').add({ v: 2, action: 'open', key, profileId: 'd', kind: 'attendance', id: 'q1', at: Date.now() })
          tx.oncomplete = () => resolve()
        }
      }),
    MATHS
  )
  await page.reload()
  const sheet = page.getByRole('dialog', { name: 'Did you attend Maths 1?' })
  await expect(sheet).toBeVisible()
  await expect(sheet.getByRole('button', { name: '✓ Attended' })).toBeVisible()
  await sheet.getByRole('button', { name: '✗ Absent' }).click()
  await expect(sheet).toHaveCount(0)
  const meta = await page.evaluate(() => JSON.parse(localStorage.getItem('timetable.meta.v2.d')!))
  expect(meta[MATHS].absent).toBe(true)
  expect(meta[MATHS].attended).toBe(false)
  // The same tap for an already-answered session opens the session instead of asking again.
  await page.waitForTimeout(500)
  await page.evaluate(
    (key) =>
      new Promise<void>((resolve) => {
        const req = indexedDB.open('timetable-actions', 1)
        req.onsuccess = () => {
          const tx = req.result.transaction('pending', 'readwrite')
          tx.objectStore('pending').add({ v: 2, action: 'open', key, profileId: 'd', kind: 'attendance', id: 'q2', at: Date.now() })
          tx.oncomplete = () => resolve()
        }
      }),
    MATHS
  )
  await page.reload()
  await expect(page.getByRole('dialog', { name: 'Did you attend Maths 1?' })).toHaveCount(0)
  await expect(page.locator('.detail-page')).toBeVisible()
})
