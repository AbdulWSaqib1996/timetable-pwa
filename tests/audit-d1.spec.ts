import { expect, test } from './fixtures'
import type { Page, Route } from '@playwright/test'

/**
 * Audit D1 (Pass 83) — E01 learning threads and E04 placement transitions in
 * the browser: a thread starts from a lesson, feedback is attached by
 * reference (one observation, two threads, still one record), the next
 * attempt can sit on another placement without touching the original, and
 * the thread survives a reload; preparing for SE2 never writes to SE1, a
 * moved school pin makes the travel review stale, and a per-placement return
 * destination drives Back home with home as the labelled fallback.
 */

test.use({ timezoneId: 'Europe/London' })

const session = (id: string, title: string, dateISO: string, day: string) => ({
  id, title, day, dateISO, start: '08:30', end: '15:30', room: '', groups: '', tutor: '', subject: '', isSpecialism: false, isSelfStudy: false, isOptional: false,
})
const SESSIONS = [session('a1', 'School Experience SE1a', '2026-09-14', 'Mon'), session('b1', 'School Experience SE2a', '2027-01-11', 'Mon')]
const SE1 = { id: 'pl-se1', code: 'SE1', schoolLocationId: 'sch-1', startISO: '2026-09-07', endISO: '2026-12-11', mappedBlockTags: ['SE1A'], mentorName: 'A Mentor', at: 10 }
const SE2 = { id: 'pl-se2', code: 'SE2', schoolLocationId: 'sch-2', startISO: '2027-01-11', endISO: '2027-03-26', mappedBlockTags: ['SE2A'], mentorName: 'B Mentor', at: 10 }
const SCHOOL1 = { id: 'sch-1', name: 'Riverside Primary', address: '1 River Lane, N1 1AA', lat: 51.53, lng: -0.11, confirmedAt: 5, at: 10 }
const SCHOOL2 = { id: 'sch-2', name: 'Oak Academy', address: '2 Oak Road, SW15 1AA', lat: 51.44, lng: -0.19, confirmedAt: 5, at: 10 }
const base = () => ({
  reflections: [], targets: [{ id: 'tg1', text: 'Sharper cold-calling', standards: [], setISO: '2026-09-10', status: 'open', at: 3 }], meetings: [], audits: [], tasks: [], exceptions: [], plans: [], commitments: [], placements: [SE1, SE2], schools: [SCHOOL1, SCHOOL2], programmes: [], packs: [], requirements: [], milestones: [], cycles: [], preps: [], goals: [], resources: [], projects: [], readings: [], contacts: [], questions: [], protected: [], supportNotes: [], examples: [], experience: [], reviews: [], homework: [],
  reviewPacks: [{ id: 'pk1', title: 'Autumn pack', state: 'draft', createdISO: '2026-09-01', items: [], sharing: { revision: 1, sharedAt: 1, mentorIds: ['m1'], attachmentUids: [], textHash: 'h' }, at: 4 }],
  lessons: [
    { id: 'l1', dateISO: '2026-09-14', classGroup: 'Year 2', subject: 'Maths — number bonds', evaluation: '', standards: [], placementId: 'pl-se1', planRevision: 2, planAt: 20, taughtAt: 30, taughtPlanRevision: 2, stage: 'review', at: 30 },
    { id: 'l3', dateISO: '2026-09-15', classGroup: 'Year 2', subject: 'English — phonics', evaluation: '', standards: [], placementId: 'pl-se1', planRevision: 1, planAt: 21, at: 31 },
  ],
  observations: [
    { id: 'o1', dateISO: '2026-09-14', observer: 'A Mentor', subject: 'Maths', focus: 'Questioning', strengths: 'Clear modelling', development: 'Cold-call sooner', sourceType: 'learner-entered', lessonId: 'l1', placementId: 'pl-se1', revision: 0, at: 40 },
    { id: 'o2', dateISO: '2026-09-15', observer: 'A Mentor', subject: 'English', focus: 'Pace', strengths: 'Routines', development: 'Shorter inputs', sourceType: 'learner-entered', lessonId: 'l3', placementId: 'pl-se1', revision: 0, at: 41 },
  ],
})

async function seed(page: Page, admin: Record<string, unknown> = base()) {
  await page.clock.install({ time: new Date('2026-09-16T07:05:00Z') })
  await page.addInitScript(
    ({ SESSIONS, admin }) => {
      localStorage.setItem('timetable.whatsnew.v1', '99')
      if (localStorage.getItem('timetable.store.v2')) return
      localStorage.setItem('timetable.store.v2', JSON.stringify({ activeId: 'fx', profiles: [{ id: 'fx', name: 'My timetable', settings: { demo: false, sheetId: 'FIXTURESHEET-FIXTURESHEET-FIXTURESHEET-0001', gid: null, specialismsChosen: true, checklistDismissed: true, usagePing: false, homeLat: 51.55, homeLng: -0.1, homeAddress: '1 Example Street', placementHours: { start: '08:30', end: '16:00' } } }] }))
      localStorage.setItem('timetable.cache.v2.fx', JSON.stringify({ fetchedAt: Date.now(), sessions: SESSIONS }))
      localStorage.setItem('timetable.admin.v1.fx', JSON.stringify(admin))
    },
    { SESSIONS, admin }
  )
  await page.setViewportSize({ width: 390, height: 844 })
}
const admin = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('timetable.admin.v1.fx') ?? '{}'))

test('E01: a teaching cycle from a lesson — feedback by reference, a next attempt on another placement, and it survives a reload', async ({ page }) => {
  await seed(page)
  await page.goto('./#/pgce/lesson/l1')
  const wb = page.getByRole('dialog', { name: /Lesson workbench/ })
  await wb.getByRole('button', { name: 'Start a teaching cycle from this lesson' }).click()
  const timeline = wb.getByRole('group', { name: 'Teaching cycle timeline' })
  await expect(timeline).toBeVisible()
  // Plan and Teach are read from the lesson record; Feedback and Try next are missing, and it says why.
  await expect(timeline.locator('.cycle-dot[data-state="done"]')).toHaveCount(2)
  await expect(timeline).toContainText('No feedback attached')
  await wb.getByRole('button', { name: 'Open this teaching cycle' }).click()
  await expect(page).toHaveURL(/#\/pgce\/cycle\//)
  const steps = page.getByRole('list', { name: 'Teaching cycle' })
  await expect(steps.locator('.cycle-step[data-state="done"]')).toHaveCount(2)
  await expect(page.locator('.cycle-chip-row')).toContainText('SE1 · Riverside Primary')
  // Attach the observation: still one observation record afterwards.
  await page.getByRole('checkbox', { name: /Informs this thread: A Mentor.*14 Sept?/ }).check()
  await expect(steps.locator('.cycle-step[data-state="done"]')).toHaveCount(3)
  let a = await admin(page)
  expect(a.observations).toHaveLength(2)
  expect(a.learningThreads).toHaveLength(1)
  expect(a.learningThreads[0].observationIds).toEqual(['o1'])
  // The learner's own next action, then a next attempt on SE2: the original stays on SE1.
  await page.getByLabel('What to try next — in your own words').fill('Cold-call after every modelled example')
  await page.getByLabel('What to try next — in your own words').blur()
  await page.getByLabel('Placement for the next attempt').selectOption('pl-se2')
  await page.getByRole('button', { name: 'Create next practice lesson' }).click()
  await expect(steps.locator('.cycle-step[data-state="done"]')).toHaveCount(4)
  await expect(page.getByRole('button', { name: 'Open next lesson' })).toBeVisible()
  a = await admin(page)
  expect(a.lessons).toHaveLength(3)
  const next = a.lessons.find((l: { duplicatedFrom?: string }) => l.duplicatedFrom === 'l1')
  expect(next.placementId).toBe('pl-se2')
  expect(next.evaluation).toBe('')
  expect(a.lessons.find((l: { id: string }) => l.id === 'l1').placementId).toBe('pl-se1')
  expect(a.learningThreads[0].lessonIds).toEqual(['l1', next.id])
  // The same observation informs a second thread without being copied.
  await page.goto('./#/pgce/lesson/l3')
  await page.getByRole('dialog', { name: /Lesson workbench/ }).getByRole('button', { name: 'Start a teaching cycle from this lesson' }).click()
  await page.getByRole('dialog', { name: /Lesson workbench/ }).getByRole('button', { name: 'Open this teaching cycle' }).click()
  await page.getByRole('checkbox', { name: /Informs this thread: A Mentor.*14 Sept?/ }).check()
  await expect(page.getByText(/also informs 1 other thread/)).toBeVisible()
  a = await admin(page)
  expect(a.observations).toHaveLength(2)
  expect(a.learningThreads).toHaveLength(2)
  // Reload: the thread is read back from the same records and lists on the PGCE file.
  await page.reload()
  await expect(page.getByRole('list', { name: 'Teaching cycle' }).locator('.cycle-step[data-state="done"]')).toHaveCount(2)
  await page.goto('./#/pgce/lessons')
  await expect(page.getByRole('list', { name: 'Teaching cycles' }).locator('li')).toHaveCount(2)
})

test('E04: preparing for SE2 never writes to SE1, a moved pin makes the travel review stale, and a per-placement return destination drives Back home', async ({ page }) => {
  await page.route('**/api.postcodes.io/**', (route: Route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ status: 200, result: { latitude: 51.45, longitude: -0.18 } }) }))
  await seed(page)
  await page.goto('./#/pgce')
  await page.getByRole('button', { name: 'Prepare for SE2' }).click()
  await expect(page).toHaveURL(/#\/placement\/pl-se2\/prepare$/)
  await expect(page.getByRole('heading', { name: 'Prepare for SE2' })).toBeVisible()
  await expect(page.getByText('From SE1 · Riverside Primary to SE2 · Oak Academy')).toBeVisible()
  const progress = page.getByLabel('Checklist progress')
  await expect(progress).toContainText('4 of 9 done')
  // Endpoints previewed before the first day, with home named as the fallback.
  const endpoints = page.getByRole('list', { name: 'Journey endpoints' })
  await expect(endpoints).toContainText('Outward — 1 Example Street → Oak Academy')
  await expect(endpoints).toContainText('Return — Oak Academy → Home — your saved home address')
  await page.getByRole('button', { name: 'Mark journeys reviewed' }).click()
  await expect(page.getByRole('list', { name: 'School & travel' }).locator('[data-state="done"]')).toHaveCount(3)
  // Context, shares, goals, first day.
  await page.getByRole('textbox', { name: 'Teaching context' }).fill('Year 4 · maths and science · four mornings')
  await page.getByRole('textbox', { name: 'Teaching context' }).blur()
  await page.getByRole('button', { name: 'Mark reviewed' }).click()
  await page.getByRole('checkbox', { name: 'Carry forward: Sharper cold-calling' }).check()
  await page.getByRole('button', { name: 'Save carried-forward goals' }).click()
  await page.getByRole('button', { name: 'Confirm', exact: true }).click()
  await expect(progress).toContainText('9 of 9 done')
  await expect(page.getByRole('button', { name: 'Mark SE2 ready' })).toBeEnabled()
  // SE1 and its school are byte-for-byte what was seeded; SE2 was not rewritten either.
  let a = await admin(page)
  expect(a.placements.find((p: { id: string }) => p.id === 'pl-se1')).toEqual(SE1)
  expect(a.schools.find((s: { id: string }) => s.id === 'sch-1')).toEqual(SCHOOL1)
  expect(a.placements.find((p: { id: string }) => p.id === 'pl-se2')).toEqual(SE2)
  expect(a.transitions).toHaveLength(1)
  expect(a.transitions[0]).toMatchObject({ fromPlacementId: 'pl-se1', toPlacementId: 'pl-se2', carryTargetIds: ['tg1'], confirmedStartISO: '2027-01-11' })
  expect(a.targets[0].status).toBe('open')
  // The SE2 pin moves (edited on another device, say): the travel review is stale and readiness is blocked.
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('timetable.admin.v1.fx')!)
    raw.schools = raw.schools.map((s: { id: string; lat: number; at: number }) => (s.id === 'sch-2' ? { ...s, lat: 51.46, at: Date.now() } : s))
    localStorage.setItem('timetable.admin.v1.fx', JSON.stringify(raw))
  })
  await page.reload()
  await expect(progress).toContainText('8 of 9 done · 1 needs another look')
  await expect(page.getByRole('list', { name: 'School & travel' }).locator('[data-state="stale"]')).toContainText('The school pin changed')
  await expect(page.getByRole('button', { name: 'Mark SE2 ready' })).toBeDisabled()
  await page.getByRole('button', { name: 'Mark journeys reviewed' }).click()
  await expect(page.getByRole('button', { name: 'Mark SE2 ready' })).toBeEnabled()
  // A return destination for SE2 only: Back home goes there and says so; SE1 keeps home.
  await page.getByText('Return destination for SE2', { exact: true }).click()
  await page.getByLabel('Place name').fill('Digs near school')
  await page.getByLabel('Address or postcode').fill('SW15 2BB')
  await page.getByRole('button', { name: 'Locate and save for SE2' }).click()
  await expect(page.getByText('Saved: Digs near school, SW15 2BB')).toBeVisible()
  await expect(endpoints).toContainText('Return — Oak Academy → Digs near school (set for SE2)')
  a = await admin(page)
  expect(a.placements.find((p: { id: string }) => p.id === 'pl-se2').returnPlace).toMatchObject({ label: 'Digs near school', lat: 51.45 })
  expect(a.placements.find((p: { id: string }) => p.id === 'pl-se1').returnPlace).toBeUndefined()
  await page.getByRole('button', { name: 'Preview Back home' }).click()
  await expect(page).toHaveURL(/#\/placement\/pl-se2\/journey\/back$/)
  await expect(page.getByText('Return destination set for SE2: Digs near school')).toBeVisible()
  await page.goto('./#/placement/pl-se1/journey/back')
  await expect(page.getByText('Going to your saved home address — the fallback')).toBeVisible()
  // The placement timeline on All placements offers to continue.
  await page.goto('./#/placement')
  await expect(page.getByRole('list', { name: 'Placement timeline' })).toContainText('Continue preparing for SE2')
  await page.getByRole('button', { name: 'Continue preparing for SE2' }).click()
  await page.getByRole('button', { name: 'Mark SE2 ready' }).click()
  await expect(page.getByText('Marked ready')).toBeVisible()
  a = await admin(page)
  expect(a.transitions[0].state).toBe('done')
  expect(a.placements.find((p: { id: string }) => p.id === 'pl-se1')).toEqual(SE1)
})
