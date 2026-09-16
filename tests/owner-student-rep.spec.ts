import { expect, test } from './fixtures'
import type { Page } from '@playwright/test'

/**
 * Owner, 16 September 2026: "Student Rep meetings should also be optional and
 * should not count in the attendance count. Possibly have an option within
 * settings to highlight whether the user is part of the student rep, and if
 * they're not — hide it from their schedule and dashboard altogether."
 */

test.use({ timezoneId: 'Europe/London' })

const session = (id: string, title: string, start: string, end: string, extra: Record<string, unknown> = {}) => ({
  id, title, day: 'Wed', dateISO: '2026-09-16', start, end, room: 'B12', groups: '1', tutor: 'A Tutor', subject: title, isSpecialism: false, isSelfStudy: false, isOptional: false, ...extra,
})
// The cached sheet already carries the parser's optional flag for the rep meeting.
const SESSIONS = [session('m1', 'Maths 1', '09:00', '11:00'), session('r1', 'Student Rep Meeting', '13:00', '14:00', { isOptional: true })]

async function seed(page: Page, studentRep?: boolean) {
  await page.clock.install({ time: new Date('2026-09-16T15:05:00Z') })
  await page.addInitScript(
    ({ SESSIONS, studentRep }) => {
      localStorage.setItem('timetable.whatsnew.v1', '99')
      if (localStorage.getItem('timetable.store.v2')) return
      localStorage.setItem('timetable.store.v2', JSON.stringify({ activeId: 'fx', profiles: [{ id: 'fx', name: 'My timetable', settings: { demo: false, sheetId: 'FIXTURESHEET-FIXTURESHEET-FIXTURESHEET-0001', gid: null, specialismsChosen: true, checklistDismissed: true, usagePing: false, ...(studentRep ? { studentRep: true } : {}) } }] }))
      localStorage.setItem('timetable.cache.v2.fx', JSON.stringify({ fetchedAt: Date.now(), sessions: SESSIONS }))
      localStorage.setItem('timetable.meta.v2.fx', JSON.stringify({ '2026-09-16|09:00|maths 1': { attended: true, at: 1 }, '2026-09-16|13:00|student rep meeting': { attended: true, at: 1 } }))
    },
    { SESSIONS, studentRep }
  )
  await page.setViewportSize({ width: 390, height: 844 })
}

test('not a rep (the default): Student Rep meetings are hidden from the Schedule and Today altogether', async ({ page }) => {
  await seed(page)
  await page.goto('./#/schedule')
  await page.getByRole('option', { name: /Wednesday 16 September/ }).click()
  await expect(page.locator('.day-list .session-card').filter({ hasText: 'Maths 1' })).toHaveCount(1)
  await expect(page.locator('.day-list .session-card').filter({ hasText: 'Student Rep' })).toHaveCount(0)
  await page.goto('./#/today')
  await expect(page.getByText('Student Rep Meeting')).toHaveCount(0)
  // Settings names the choice and its consequences.
  await page.goto('./#/settings/timetable')
  const toggle = page.getByRole('checkbox', { name: 'I am a student rep — show Student Rep meetings' })
  await expect(toggle).not.toBeChecked()
  await expect(page.getByText('never count towards attendance')).toBeVisible()
  await toggle.check()
  await page.goto('./#/schedule')
  await page.getByRole('option', { name: /Wednesday 16 September/ }).click()
  await expect(page.locator('.day-list .session-card').filter({ hasText: 'Student Rep' })).toHaveCount(1)
})

test('a rep sees the meeting as optional, and attendance counts exclude it even when it was attended', async ({ page }) => {
  await seed(page, true)
  await page.goto('./#/schedule')
  await page.getByRole('option', { name: /Wednesday 16 September/ }).click()
  await page.locator('.day-list .session-card').filter({ hasText: 'Student Rep' }).click()
  await expect(page.getByRole('heading', { name: /Student Rep Meeting/ })).toBeVisible()
  // The term stats count one eligible completed session — Maths 1 — not two.
  await page.goto('./#/pgce')
  await page.getByRole('button', { name: /Term stats & attendance/ }).click()
  await expect(page.getByText('attended — 1 of 1 eligible completed session').first()).toBeVisible()
})
