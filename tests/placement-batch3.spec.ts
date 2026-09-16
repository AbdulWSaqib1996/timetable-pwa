import { expect, test } from './fixtures'
import type { Page } from '@playwright/test'

/**
 * Placement review Batch 3 (Pass 88) — visual and navigation: the session
 * detail's navigator (Overview · Homework · Notes · Travel) with a homework
 * count and an editor that opens on request (UX-01); a saved placement edited
 * section by section with a review before applying, and the guided flow's
 * "Save draft & close" (PL-06); every placement with the same Open / Edit
 * pair on the placements page (concept B); the optional onboarding placement
 * review that never blocks the timetable (concept A).
 */

test.use({ timezoneId: 'Europe/London' })

const session = (id: string, title: string, dateISO: string, day: string, start = '08:30', end = '15:30', extra: Record<string, unknown> = {}) => ({ id, title, day, dateISO, start, end, room: 'B12', groups: '', tutor: 'A Tutor', subject: title, isSpecialism: false, isSelfStudy: false, isOptional: false, eventKey: `event:${id}`, ...extra })
const SESSIONS = [
  session('a1', 'School Experience SE1a', '2026-09-16', 'Wed'),
  session('a2', 'School Experience SE1a', '2026-09-17', 'Thu'),
  session('m1', 'Maths 1', '2026-09-18', 'Fri', '09:00', '11:00'),
  session('m2', 'Maths 2', '2026-09-25', 'Fri', '09:00', '11:00'),
]
const SE1 = { id: 'pl-se1', code: 'SE1', schoolLocationId: 'sch-1', startISO: '2026-09-07', endISO: '2026-12-11', mappedBlockTags: ['SE1A'], mentorName: 'A Mentor', at: 10 }
const SE2 = { id: 'pl-se2', code: 'SE2', schoolLocationId: 'sch-2', startISO: '2027-02-01', endISO: '2027-03-26', mappedBlockTags: ['SE2'], at: 10 }
const SCHOOL1 = { id: 'sch-1', name: 'Riverside Primary', address: '1 River Lane', lat: 51.53, lng: -0.11, confirmedAt: 5, at: 10 }
const SCHOOL2 = { id: 'sch-2', name: 'Meadow Park Primary', address: '4 Meadow Way', at: 10 }
const base = () => ({
  reflections: [], targets: [], meetings: [], observations: [], audits: [], tasks: [], exceptions: [], plans: [], commitments: [], programmes: [], packs: [], requirements: [], milestones: [], cycles: [], preps: [], goals: [], resources: [], projects: [], readings: [], contacts: [], questions: [], protected: [], supportNotes: [], examples: [], reviewPacks: [], experience: [], reviews: [], homework: [], lessons: [],
  placements: [SE1, SE2],
  schools: [SCHOOL1, SCHOOL2],
})

async function seed(page: Page, opts: { admin?: Record<string, unknown>; settings?: Record<string, unknown>; sessions?: unknown[] } = {}) {
  await page.clock.install({ time: new Date('2026-09-16T06:05:00Z') })
  await page.addInitScript(
    ({ SESSIONS, admin, settings }) => {
      localStorage.setItem('timetable.whatsnew.v1', '99')
      if (localStorage.getItem('timetable.store.v2')) return
      localStorage.setItem('timetable.store.v2', JSON.stringify({ activeId: 'fx', profiles: [{ id: 'fx', name: 'My timetable', settings: { demo: false, sheetId: 'FIXTURESHEET-FIXTURESHEET-FIXTURESHEET-0001', gid: null, specialismsChosen: true, checklistDismissed: true, usagePing: false, ...settings } }] }))
      localStorage.setItem('timetable.cache.v2.fx', JSON.stringify({ fetchedAt: Date.now(), sessions: SESSIONS }))
      localStorage.setItem('timetable.admin.v1.fx', JSON.stringify(admin))
    },
    { SESSIONS: opts.sessions ?? SESSIONS, admin: opts.admin ?? base(), settings: opts.settings ?? {} }
  )
  await page.setViewportSize({ width: 390, height: 844 })
}
const readAdmin = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('timetable.admin.v1.fx')!))
const readSettings = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('timetable.store.v2')!).profiles[0].settings)

test('UX-01: the session detail has Overview, Homework, Notes and Travel sections; homework is added from its own section and counted beside it', async ({ page }) => {
  await seed(page)
  await page.goto('./#/schedule')
  await page.getByRole('option', { name: /Friday 18 September/ }).click()
  await page.locator('.day-list .session-card').filter({ hasText: 'Maths 1' }).click()
  const tabs = page.getByRole('tablist', { name: 'Session detail sections' })
  await expect(tabs.getByRole('tab')).toHaveText(['Overview', 'Homework', 'Notes', 'Travel & map'])
  // Overview keeps the identity card, attendance and place; homework lives in its own section.
  await expect(page.locator('.detail-identity')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Attendance' })).toBeVisible()
  await expect(page.getByRole('group', { name: 'Homework set in this session' })).toBeHidden()
  await tabs.getByRole('tab', { name: /^Homework/ }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Session homework')
  const panel = page.getByRole('group', { name: 'Homework set in this session' })
  await expect(panel).toContainText('Nothing set from this session yet.')
  await expect(panel.getByLabel('Homework', { exact: true })).toHaveCount(0)
  await panel.getByRole('button', { name: 'Add homework' }).click()
  // The open editor never widens the page (owner report, 16 Sep 2026: the chooser overflowed and iOS zoomed).
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0)
  await expect(tabs.getByRole('tab', { name: 'Travel & map' })).toBeInViewport()
  await panel.getByLabel('Homework', { exact: true }).fill('Read chapter 3')
  const due = panel.getByRole('combobox', { name: 'Due in', exact: true })
  await due.selectOption((await due.locator('optgroup[label="Later occurrences of this lesson"] option').first().getAttribute('value'))!)
  await panel.getByRole('button', { name: 'Save homework' }).click()
  await expect(panel.getByRole('list', { name: 'Homework set' })).toContainText('Read chapter 3')
  await expect(tabs.getByRole('tab', { name: 'Homework (1)' })).toBeVisible()
  await panel.getByRole('button', { name: 'Close' }).click()
  await expect(panel.getByRole('button', { name: 'Add homework' })).toBeVisible()
  // Notes has the note editor; Overview points at the homework.
  await tabs.getByRole('tab', { name: 'Notes' }).click()
  await expect(page.getByRole('heading', { name: 'Notes & evidence' })).toBeVisible()
  await tabs.getByRole('tab', { name: 'Overview' }).click()
  await page.getByRole('button', { name: '1 homework — open the Homework section' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Session homework')
  // The due session counts it too.
  await page.goto('./#/schedule')
  await page.getByRole('button', { name: 'Next week' }).click()
  await page.getByRole('option', { name: /Friday 25 September/ }).click()
  await page.locator('.day-list .session-card').filter({ hasText: 'Maths 2' }).click()
  await expect(page.getByRole('tab', { name: 'Homework (1)' })).toBeVisible()
  await page.getByRole('tab', { name: 'Homework (1)' }).click()
  await expect(page.getByRole('list', { name: 'Homework due' })).toContainText('Read chapter 3')
})

test('PL-06: a saved placement is edited one section at a time with a review before applying; nothing else changes', async ({ page }) => {
  await seed(page)
  await page.goto('./#/placement/pl-se1')
  const details = page.getByRole('region', { name: 'School details' }).or(page.locator('.placement-details'))
  await expect(details.first()).toContainText('Riverside Primary · 1 River Lane · pin confirmed')
  await expect(details.first()).toContainText('A Mentor')
  await page.getByRole('button', { name: 'Edit mentor & dates' }).click()
  const flow = page.getByRole('dialog', { name: 'Set up SE1' })
  await expect(flow.getByRole('heading', { name: 'Edit mentor & dates · SE1' })).toBeVisible()
  await expect(flow.getByRole('list', { name: 'Setup steps' })).toHaveCount(0)
  await expect(flow.getByRole('button', { name: 'Next', exact: true })).toHaveCount(0)
  await flow.getByLabel('Mentor', { exact: true }).fill('B Mentor')
  await flow.getByRole('button', { name: 'Review changes' }).click()
  const review = flow.getByRole('group', { name: 'Review changes' })
  await expect(review).toContainText('Applying 1 change to SE1')
  await expect(review.getByRole('list', { name: 'Changes' })).toContainText('Mentor')
  await expect(review.getByRole('list', { name: 'Changes' })).toContainText('A Mentor → B Mentor')
  await review.getByRole('button', { name: 'Save changes' }).click()
  const a = await readAdmin(page)
  expect(a.placements.find((p: { id: string }) => p.id === 'pl-se1')).toMatchObject({ ...SE1, mentorName: 'B Mentor', at: expect.any(Number) })
  expect(a.placements.find((p: { id: string }) => p.id === 'pl-se2')).toEqual(SE2)
  expect(a.schools.find((s: { id: string }) => s.id === 'sch-1')).toEqual(SCHOOL1)
  await expect(details.first()).toContainText('B Mentor')
  // Edit school opens on the school section; the guided flow keeps Save draft & close.
  await page.getByRole('button', { name: 'Edit school', exact: true }).click()
  await expect(flow.getByRole('heading', { name: 'Edit school · SE1' })).toBeVisible()
  await expect(flow.getByLabel('School name')).toHaveValue('Riverside Primary')
  await flow.getByRole('button', { name: 'Cancel' }).click()
})

test('Concept B: every saved placement has the same Open / Edit pair on the placements page, readiness shown separately; the guided flow keeps a draft on Save draft & close', async ({ page }) => {
  await seed(page)
  await page.goto('./#/placement')
  const cards = page.getByRole('list', { name: 'Your placements' })
  const se1 = cards.getByRole('listitem').filter({ hasText: 'SE1' })
  const se2 = cards.getByRole('listitem').filter({ hasText: 'SE2' })
  const se3 = cards.getByRole('listitem').filter({ hasText: 'SE3' })
  await expect(se1.getByRole('button', { name: 'Open SE1' })).toBeVisible()
  await expect(se1.getByRole('button', { name: 'Edit SE1' })).toBeVisible()
  await expect(se1).toContainText('Ready to plan')
  await expect(se2.getByRole('button', { name: 'Open SE2' })).toBeVisible()
  await expect(se2.getByRole('button', { name: 'Continue SE2 setup' })).toBeVisible()
  await expect(se2).toContainText('School details incomplete')
  await expect(se2.getByRole('button', { name: 'To school' })).toHaveCount(0)
  await expect(se3.getByRole('button', { name: 'Set up SE3' })).toBeVisible()
  await se1.getByRole('button', { name: 'Edit SE1' }).click()
  const flow = page.getByRole('dialog', { name: 'Set up SE1' })
  await flow.getByLabel('School name').fill('Riverside Primary Academy')
  await flow.getByRole('button', { name: 'Save draft & close' }).click()
  await expect(flow).toHaveCount(0)
  expect((await readAdmin(page)).schools.find((s: { id: string }) => s.id === 'sch-1').name).toBe('Riverside Primary')
  await se1.getByRole('button', { name: 'Edit SE1' }).click()
  await expect(flow.getByRole('group', { name: 'Unsaved changes' })).toContainText('You have unsaved changes to SE1')
})

test('Concept A: after choosing a specialism, a timetable with placement blocks offers an optional placements review that never blocks the timetable', async ({ page }) => {
  const sessions = [...SESSIONS, session('sp1', 'Music (specialism)', '2026-09-21', 'Mon', '13:00', '15:00', { isSpecialism: true, specialismName: 'Music' }), session('sp2', 'PE (specialism)', '2026-09-21', 'Mon', '13:00', '15:00', { isSpecialism: true, specialismName: 'PE' })]
  const a = base()
  a.placements = []
  a.schools = []
  await seed(page, { admin: a, settings: { specialismsChosen: false }, sessions })
  await page.goto('./#/today')
  const picker = page.getByRole('dialog', { name: 'Choose your specialisms' })
  await expect(picker).toBeVisible()
  await picker.getByRole('button', { name: 'Show all specialisms' }).click()
  const review = page.getByRole('dialog', { name: 'Review your placements' })
  await expect(review).toBeVisible()
  await expect(review).toContainText('1 placement block (2 school days)')
  const rows = review.getByRole('list', { name: 'Placements to review' })
  await expect(rows.getByRole('button', { name: 'Set up SE1' })).toBeVisible()
  await expect(rows.getByRole('button', { name: 'Set up SE3' })).toBeVisible()
  await review.getByRole('button', { name: "I'll finish this later" }).click()
  await expect(review).toHaveCount(0)
  expect((await readSettings(page)).placementReviewSeen).toBe(true)
  await page.reload()
  await expect(page.getByRole('dialog', { name: 'Review your placements' })).toHaveCount(0)
  // The timetable is usable regardless.
  await page.goto('./#/schedule')
  await expect(page.getByRole('option', { name: /Wednesday 16 September/ })).toBeVisible()
})

test('Concept A: setting up from the review opens the guided flow; a later visit never springs the review', async ({ page }) => {
  const sessions = [...SESSIONS, session('sp1', 'Music (specialism)', '2026-09-21', 'Mon', '13:00', '15:00', { isSpecialism: true, specialismName: 'Music' }), session('sp2', 'PE (specialism)', '2026-09-21', 'Mon', '13:00', '15:00', { isSpecialism: true, specialismName: 'PE' })]
  const a = base()
  a.placements = []
  a.schools = []
  await seed(page, { admin: a, settings: { specialismsChosen: false }, sessions })
  await page.goto('./#/today')
  await page.getByRole('dialog', { name: 'Choose your specialisms' }).getByRole('button', { name: 'Show all specialisms' }).click()
  const review = page.getByRole('dialog', { name: 'Review your placements' })
  await review.getByRole('list', { name: 'Placements to review' }).getByRole('button', { name: 'Set up SE1' }).click()
  await expect(page.getByRole('dialog', { name: 'Set up SE1' })).toBeVisible()
  expect((await readSettings(page)).placementReviewSeen).toBe(true)
  await page.getByRole('dialog', { name: 'Set up SE1' }).getByRole('button', { name: 'Cancel' }).click()
  await expect(review).toHaveCount(0)
  // A profile that chose its specialism earlier is never interrupted, even with unmapped blocks.
  await page.reload()
  await expect(page.getByRole('dialog', { name: 'Review your placements' })).toHaveCount(0)
})
