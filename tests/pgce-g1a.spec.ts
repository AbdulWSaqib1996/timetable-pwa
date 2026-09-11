import { expect, test } from './fixtures'
import type { Page, Route } from '@playwright/test'

/**
 * G1a (Pass 69) — PG-07A placements and PG-01 roadmap. A real (non-demo)
 * profile with SE1 ready (confirmed pin), SE3 incomplete (address, no confirmed
 * pin) and SE2 not set up. The chooser shows the three states; setting up SE2
 * through the flow leaves SE1 and SE3 byte-for-byte unchanged; the workspace
 * shows SE1's records and its sessions carry `SE1 · school`; journeys plan
 * outward (arrive-by) and return (leave-now from the school) with every state
 * honest; a late SE1 response never renders under another placement; the
 * programme sheet imports a pack, previews a diff, confirms a requirement and
 * feeds the roadmap card.
 */

test.use({ timezoneId: 'Europe/London' })

const session = (id: string, title: string, dateISO: string, day: string) => ({
  id, title, day, dateISO, start: '08:30', end: '15:30', room: '', groups: '', tutor: '', subject: '', isSpecialism: false, isSelfStudy: false, isOptional: false,
})
const SESSIONS = [
  session('a1', 'School Experience SE1a', '2026-09-14', 'Mon'),
  session('a2', 'School Experience SE1a', '2026-09-15', 'Tue'),
  session('b1', 'School Experience SE1b', '2026-11-02', 'Mon'),
  session('c1', 'School Experience SE2', '2027-02-01', 'Mon'),
  session('d1', 'School Experience SE3', '2027-05-03', 'Mon'),
]
const SE1 = { id: 'pl-se1', code: 'SE1', schoolLocationId: 'sch-1', startISO: '2026-09-07', endISO: '2026-12-11', mappedBlockTags: ['SE1A', 'SE1B'], mentorName: 'A Mentor', arrivalBufferMins: 15, at: 10 }
const SE3 = { id: 'pl-se3', code: 'SE3', schoolLocationId: 'sch-3', mappedBlockTags: ['SE3'], at: 10 }
const SCHOOLS = [
  { id: 'sch-1', name: 'Riverside Primary', address: '1 River Lane, N1 1AA', lat: 51.53, lng: -0.11, confirmedAt: 5, entranceNote: 'Side gate on River Lane', at: 10 },
  { id: 'sch-3', name: 'Hillside Academy', address: '9 Hill Road', at: 10 },
]
const ADMIN = {
  reflections: [], targets: [], meetings: [{ id: 'm1', dateISO: '2026-09-10', discussed: 'Targets', actions: [{ id: 'act1', text: 'Plan a phonics lesson', done: false }], placementId: 'pl-se1', at: 10 }],
  observations: [], lessons: [{ id: 'l1', dateISO: '2026-09-09', classGroup: 'Year 2', subject: 'Maths — number bonds', evaluation: '', standards: [], placementId: 'pl-se1', at: 10 }],
  audits: [], tasks: [], exceptions: [], plans: [], commitments: [], placements: [SE1, SE3], schools: SCHOOLS, schemaVersion: 2,
}

const tflJourney = (dep: string, arr: string, duration: number, to = 'Riverside Primary') => ({
  journeys: [{ startDateTime: dep, arrivalDateTime: arr, duration, legs: [{ mode: { name: 'walking' }, duration, departureTime: dep, arrivalTime: arr, departurePoint: { commonName: 'Origin St' }, arrivalPoint: { commonName: to }, instruction: { summary: `Walk to ${to}` }, disruptions: [], isDisrupted: false }] }],
})

async function seed(page: Page, opts: { home?: boolean; admin?: Record<string, unknown> } = {}) {
  await page.clock.install({ time: new Date('2026-09-11T07:05:00Z') })
  await page.addInitScript(
    ({ SESSIONS, ADMIN, home }) => {
      localStorage.setItem('timetable.whatsnew.v1', '99')
      if (localStorage.getItem('timetable.store.v2')) return
      localStorage.setItem('timetable.store.v2', JSON.stringify({ activeId: 'fx', profiles: [{ id: 'fx', name: 'My timetable', settings: {
        demo: false, sheetId: 'FIXTURESHEET-FIXTURESHEET-FIXTURESHEET-0001', gid: null, specialismsChosen: true, checklistDismissed: true, usagePing: false,
        travelMode: 'transit', locationEnabled: false, arrivalBufferMins: 10,
        ...(home ? { homeAddress: '1 Example Street, London N1', homeLat: 51.55, homeLng: -0.1 } : {}),
        placements: { SE1A: { school: 'Riverside Primary', lat: 51.53, lng: -0.11 } },
      } }] }))
      localStorage.setItem('timetable.cache.v2.fx', JSON.stringify({ fetchedAt: Date.now(), sessions: SESSIONS }))
      localStorage.setItem('timetable.admin.v1.fx', JSON.stringify(ADMIN))
    },
    { SESSIONS, ADMIN: opts.admin ?? ADMIN, home: opts.home ?? true }
  )
  await page.setViewportSize({ width: 390, height: 844 })
}
const admin = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('timetable.admin.v1.fx') ?? '{}'))
const card = (page: Page, code: string) => page.getByRole('list', { name: 'Your placements' }).getByRole('listitem').filter({ has: page.getByRole('heading', { level: 3, name: new RegExp(`^${code}`) }) })

test('chooser states; setting up SE2 through the flow leaves SE1 and SE3 byte-for-byte unchanged and mirrors the confirmed pin', async ({ page, context }) => {
  await context.route('**/api.postcodes.io/**', (route: Route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ status: 200, result: { latitude: 51.52, longitude: -0.09 } }) }))
  await seed(page)
  await page.goto('./#/pgce')
  await expect(page.getByRole('heading', { level: 1, name: 'PGCE file' })).toBeVisible()
  await expect(card(page, 'SE1')).toContainText('Ready to plan')
  await expect(card(page, 'SE1')).toContainText('Current')
  await expect(card(page, 'SE1')).toContainText('Riverside Primary')
  await expect(card(page, 'SE2')).toContainText('Not set up')
  await expect(card(page, 'SE3')).toContainText('School details incomplete')
  await expect(card(page, 'SE3')).toContainText('pin has not been confirmed')
  await expect(card(page, 'SE1').getByRole('button', { name: 'To school' })).toBeVisible()
  await expect(card(page, 'SE3').getByRole('button', { name: 'To school' })).toHaveCount(0)
  const before = await admin(page)

  await card(page, 'SE2').getByRole('button', { name: 'Set up SE2' }).click()
  const dialog = page.getByRole('dialog', { name: 'Set up SE2' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('combobox', { name: 'Which placement?' })).toHaveValue('SE2')
  await dialog.getByRole('button', { name: 'Next' }).click()
  await dialog.getByLabel('School name').fill('Meadow Park Primary')
  await dialog.getByLabel('Address').fill('4 Meadow Way, E1 6AA')
  await dialog.getByRole('button', { name: 'Locate on map' }).click()
  await expect(dialog.getByRole('button', { name: 'Confirm this pin' })).toBeVisible()
  await dialog.getByRole('button', { name: 'Confirm this pin' }).click()
  await expect(dialog).toContainText('Pin confirmed')
  await dialog.getByLabel('Entrance note (optional)').fill('Main reception')
  await dialog.getByRole('button', { name: 'Next' }).click()
  await dialog.getByLabel('Mentor', { exact: true }).fill('B Mentor')
  await dialog.getByLabel('Starts').fill('2027-02-01')
  await dialog.getByLabel('Ends').fill('2027-03-26')
  await dialog.getByRole('button', { name: 'Next' }).click()
  await expect(dialog).toContainText('default 08:30')
  await expect(dialog).toContainText('Home · 1 Example Street')
  await dialog.getByRole('button', { name: 'Next' }).click()
  // Mapping preview: SE2 proposed and ticked; SE1A/SE1B are SE1's and cannot be taken.
  await expect(dialog.getByRole('checkbox', { name: /^SE2/ })).toBeChecked()
  await expect(dialog.getByRole('checkbox', { name: /^SE1A/ })).toBeDisabled()
  await expect(dialog).toContainText('mapped to SE1')
  await dialog.getByRole('button', { name: 'Save placement' }).click()
  await expect(dialog).toHaveCount(0)

  const after = await admin(page)
  expect(JSON.stringify(after.placements.find((p: { code: string }) => p.code === 'SE1'))).toBe(JSON.stringify(before.placements.find((p: { code: string }) => p.code === 'SE1')))
  expect(JSON.stringify(after.placements.find((p: { code: string }) => p.code === 'SE3'))).toBe(JSON.stringify(before.placements.find((p: { code: string }) => p.code === 'SE3')))
  expect(JSON.stringify(after.schools.filter((s: { id: string }) => s.id !== after.placements.find((p: { code: string }) => p.code === 'SE2').schoolLocationId))).toBe(JSON.stringify(before.schools))
  const se2 = after.placements.find((p: { code: string }) => p.code === 'SE2')
  expect(se2.mappedBlockTags).toEqual(['SE2'])
  expect(se2.mentorName).toBe('B Mentor')
  expect(se2.startISO).toBe('2027-02-01')
  const school = after.schools.find((s: { id: string }) => s.id === se2.schoolLocationId)
  expect(school).toMatchObject({ name: 'Meadow Park Primary', lat: 51.52, lng: -0.09, entranceNote: 'Main reception' })
  expect(school.confirmedAt).toBeGreaterThan(0)
  await expect(card(page, 'SE2')).toContainText('Ready to plan')
  await expect(card(page, 'SE2')).toContainText('Upcoming')
  // The block-tag mirror the worker and session travel tab read.
  const settings = await page.evaluate(() => JSON.parse(localStorage.getItem('timetable.store.v2')!).profiles[0].settings)
  expect(settings.placements.SE2).toMatchObject({ school: 'Meadow Park Primary', lat: 51.52, lng: -0.09, mentor: 'B Mentor' })
  expect(settings.placements.SE1A.school).toBe('Riverside Primary')
})

test('the SE1 workspace lists its lesson and open action, its next school days carry "SE1 · Riverside Primary", and the session detail shows the same label', async ({ page }) => {
  await seed(page)
  await page.goto('./#/pgce')
  await card(page, 'SE1').getByRole('button', { name: 'Open placement' }).click()
  await expect(page).toHaveURL(/#\/placement\/pl-se1$/)
  await expect(page.getByRole('heading', { level: 1, name: 'SE1 · Riverside Primary' })).toBeVisible()
  await expect(page.getByText('Mentor A Mentor')).toBeVisible()
  await expect(page.getByRole('list', { name: 'Lessons' })).toContainText('Maths — number bonds')
  await expect(page.getByRole('list', { name: 'Open actions' })).toContainText('Plan a phonics lesson')
  const nextDays = page.getByRole('list', { name: 'Next school days' })
  await expect(nextDays.getByRole('listitem').first()).toContainText('SE1 · Riverside Primary')
  await nextDays.getByRole('button').first().click()
  await expect(page).toHaveURL(/#\/session\//)
  await expect(page.locator('.detail-placement-label')).toHaveText('SE1 · Riverside Primary')
  // Adding a lesson from the admin sheet can be linked to SE1 with the new Placement field.
  await page.goto('./#/placement/pl-se1')
  await page.getByRole('button', { name: 'Lessons →' }).click()
  const sheet = page.getByRole('dialog')
  await sheet.getByPlaceholder('Subject (e.g. Maths — fractions)').fill('Phonics')
  await sheet.getByRole('combobox', { name: 'Placement' }).selectOption('pl-se1')
  await sheet.getByRole('button', { name: 'Log lesson' }).click()
  const file = await admin(page)
  expect(file.lessons.find((l: { subject: string }) => l.subject === 'Phonics').placementId).toBe('pl-se1')
  // A record without a placement stays Unassigned (no empty-string link on the wire).
  await sheet.getByPlaceholder('Subject (e.g. Maths — fractions)').fill('Unlinked')
  await sheet.getByRole('combobox', { name: 'Placement' }).selectOption('')
  await sheet.getByRole('button', { name: 'Log lesson' }).click()
  expect('placementId' in (await admin(page)).lessons.find((l: { subject: string }) => l.subject === 'Unlinked')).toBe(false)
})

test('To school plans arrive-by with the placement buffer; Back home leaves now from the school; no home → Set return destination; late SE1 response never renders under SE3', async ({ page, context }) => {
  const requests: string[] = []
  await context.route('**/api.tfl.gov.uk/Journey/**', async (route: Route) => {
    requests.push(route.request().url())
    await new Promise((r) => setTimeout(r, 700))
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(tflJourney('2026-09-14T07:40:00', '2026-09-14T08:10:00', 30)) })
  })
  await seed(page)
  await page.goto('./#/placement/pl-se1/journey/out')
  await expect(page.getByRole('heading', { level: 1, name: 'To school' })).toBeVisible()
  const od = page.getByLabel('Journey to school')
  await expect(od).toContainText('Riverside Primary')
  await expect(od).toContainText('Side gate on River Lane')
  await expect(od).toContainText('Arrive by 08:15 on 2026-09-14 · 15 min early')
  await expect(page.getByRole('combobox', { name: /origin/i })).toHaveValue('home')
  await expect(page.locator('.journey-steps')).toContainText('Walk to Riverside Primary', { timeout: 10000 })
  await expect(page.getByText('live TfL')).toBeVisible()
  await expect(page.getByRole('link', { name: /Open in Maps/ })).toHaveAttribute('href', /destination=51\.53,-0\.11/)
  expect(requests.length).toBeGreaterThan(0)

  await page.goto('./#/placement/pl-se1/journey/back')
  await expect(page.getByRole('heading', { level: 1, name: 'Back home' })).toBeVisible()
  const back = page.getByLabel('Journey home from school')
  await expect(back).toContainText('Leaving now · school day ends 15:45')
  await expect(back).toContainText('1 Example Street')
  await expect(page.getByRole('combobox', { name: /origin/i })).toHaveValue('placement-pl-se1')
  await expect(page.getByRole('link', { name: /Open in Maps/ })).toHaveAttribute('href', /destination=51\.55,-0\.1/)

  // A late SE1 outward response must not render under SE3, which has no confirmed pin.
  await page.goto('./#/placement/pl-se1/journey/out')
  await expect(page.getByRole('heading', { level: 1, name: 'To school' })).toBeVisible()
  await page.goto('./#/placement/pl-se3/journey/out')
  await expect(page.getByText('School location not confirmed yet')).toBeVisible()
  await page.waitForTimeout(1200)
  await expect(page.getByText('School location not confirmed yet')).toBeVisible()
  await expect(page.locator('.journey-steps')).toHaveCount(0)
  await expect(page.getByText('Riverside Primary')).toHaveCount(0)

  // An unknown journey leg falls back to the workspace with a notice; a bad id is honest.
  await page.goto('./#/placement/pl-se1/journey/sideways')
  await expect(page.getByRole('heading', { level: 1, name: 'SE1 · Riverside Primary' })).toBeVisible()
  await page.goto('./#/placement/nope')
  await expect(page.getByRole('heading', { level: 1, name: 'Placement not found' })).toBeVisible()
})

test('without a home the return journey asks for a destination instead of guessing', async ({ page }) => {
  await seed(page, { home: false })
  await page.goto('./#/placement/pl-se1/journey/back')
  await expect(page.getByText('No return destination yet')).toBeVisible()
  await page.getByRole('button', { name: 'Set return destination' }).click()
  await expect(page).toHaveURL(/#\/settings\/travel$/)
})

test('programme: profile, pack import with diff preview, learner confirmation, milestones, and the roadmap card', async ({ page }) => {
  await seed(page)
  await page.goto('./#/pgce')
  await expect(page.getByText('Requirements not yet confirmed.')).toBeVisible()
  await page.goto('./#/settings/timetable')
  await page.getByRole('button', { name: 'Programme', exact: true }).click()
  const sheet = page.getByRole('dialog', { name: 'Programme' })
  await expect(sheet).toBeVisible()
  await sheet.getByLabel('Provider').fill('UCL IOE')
  await sheet.getByLabel('Academic year').fill('2026/27')
  await sheet.getByRole('button', { name: 'Save course profile' }).click()
  expect((await admin(page)).programmes[0]).toMatchObject({ id: 'course', route: 'pgce-qts', providerLabel: 'UCL IOE', academicYear: '2026/27' })

  const pack = (version: number, daysValue: string) => JSON.stringify({
    packId: 'ucl-2026', label: 'UCL handbook', ownerSource: 'provider', version,
    requirements: [
      { key: 'days', section: 'School experience', title: 'Assessed school days', plannedValue: daysValue },
      { key: 'obs', section: 'School experience', title: 'Formal observations per placement', plannedValue: '6' },
    ],
    milestones: [{ key: 'rev1', kind: 'review', title: 'Progress review 1', date: '2026-12-11' }, { key: 'essay', kind: 'academic', title: 'Assignment 1', date: '2026-11-20' }],
  })
  await sheet.getByRole('tab', { name: /Packs/ }).click()
  await sheet.getByLabel('Pack JSON').fill('{ not json')
  await sheet.getByRole('button', { name: 'Validate & preview' }).click()
  await expect(sheet.getByRole('alert')).toContainText('not valid JSON')
  await sheet.getByLabel('Pack JSON').fill(pack(1, '120 days'))
  await sheet.getByRole('button', { name: 'Validate & preview' }).click()
  const preview = sheet.getByLabel('Pack preview')
  await expect(preview).toContainText('2 new requirements')
  await expect(preview).toContainText('2 new milestones')
  // Nothing is written until Apply.
  expect((await admin(page)).requirements ?? []).toEqual([])
  await preview.getByRole('button', { name: 'Apply pack' }).click()
  await expect(sheet.getByRole('tab', { name: /Requirements \(2\)/ })).toBeVisible()
  const obsRow = sheet.getByRole('listitem').filter({ hasText: 'Formal observations' })
  await expect(obsRow).toContainText('Unconfirmed')
  await obsRow.getByRole('button', { name: 'Confirm from source' }).click()
  await obsRow.getByLabel('Source you checked').fill('Handbook p.12')
  await obsRow.getByRole('button', { name: 'Confirm' }).click()
  await expect(obsRow).toContainText('Confirmed by you from Handbook p.12')

  // v2 changes the days wording: preview shows one changed; after apply only that one is unconfirmed.
  await sheet.getByRole('tab', { name: /Packs/ }).click()
  await expect(sheet.getByRole('list', { name: 'Packs' })).toContainText('v1')
  await sheet.getByLabel('Pack JSON').fill(pack(2, '120 days (minimum)'))
  await sheet.getByRole('button', { name: 'Validate & preview' }).click()
  await expect(preview).toContainText('1 changed')
  await expect(preview).toContainText('1 unchanged')
  await preview.getByRole('button', { name: 'Apply pack' }).click()
  const reqs = (await admin(page)).requirements
  expect(reqs.find((r: { id: string }) => r.id === 'ucl-2026:days').verification).toBe('unconfirmed')
  expect(reqs.find((r: { id: string }) => r.id === 'ucl-2026:obs')).toMatchObject({ verification: 'confirmed', confirmedSource: 'Handbook p.12', packVersion: 2 })

  await sheet.getByRole('tab', { name: /Milestones/ }).click()
  const review = sheet.getByRole('listitem').filter({ hasText: 'Progress review 1' })
  await expect(review).toContainText('pack v2')
  await sheet.getByLabel('Milestone', { exact: true }).fill('Mentor review 0')
  await sheet.getByLabel('Date').fill('2026-10-02')
  await sheet.getByRole('button', { name: 'Add milestone' }).click()
  const early = sheet.getByRole('listitem').filter({ hasText: 'Mentor review 0' })
  await early.getByRole('button', { name: 'Mark done' }).click()
  await expect(early).toContainText('done')
  await page.keyboard.press('Escape')

  await page.goto('./#/pgce')
  const roadmap = page.getByRole('list', { name: 'Roadmap' })
  await expect(roadmap).toContainText('Assignment 1 · 2026-11-20')
  await expect(roadmap).toContainText('Progress review 1 · 2026-12-11')
  await expect(roadmap).toContainText('1 of 2 not yet confirmed by you')
  await expect(roadmap).toContainText('nothing dated ahead')
})
