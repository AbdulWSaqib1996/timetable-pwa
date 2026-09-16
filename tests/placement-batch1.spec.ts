import { expect, test } from './fixtures'
import type { Page, Route } from '@playwright/test'

/**
 * Placement review Batch 1 (Pass 86) — the review's five placement probes
 * turned positive, plus UX-02: an address edit drops the old pin and a late
 * geocode reply for the old address cannot confirm the new one (PL-01); a
 * Settings detour, a reload and Cancel keep or discard a draft on the
 * learner's say-so (PL-02); a placement's own inset policy drives its count
 * (PL-03); changing the code regenerates untouched proposals and asks when
 * links were edited (PL-04); reversed hours cannot save (PL-05); the
 * return-destination action has its own accessible name (UX-02).
 */

test.use({ timezoneId: 'Europe/London' })

const session = (id: string, title: string, dateISO: string, day: string) => ({ id, title, day, dateISO, start: '08:30', end: '15:30', room: '', groups: '', tutor: '', subject: title, isSpecialism: false, isSelfStudy: false, isOptional: false })
const SESSIONS = [session('a1', 'School Experience SE1a', '2026-09-16', 'Wed'), session('a2', 'School Experience SE1a', '2026-09-17', 'Thu')]
const SE1 = { id: 'pl-se1', code: 'SE1', schoolLocationId: 'sch-1', startISO: '2026-09-07', endISO: '2026-12-11', mappedBlockTags: ['SE1A'], mentorName: 'A Mentor', at: 10 }
const SE2 = { id: 'pl-se2', code: 'SE2', schoolLocationId: 'sch-2', startISO: '2027-02-01', endISO: '2027-03-26', mappedBlockTags: ['SE2'], at: 10 }
const SCHOOL1 = { id: 'sch-1', name: 'Riverside Primary', address: '1 River Lane', lat: 51.53, lng: -0.11, confirmedAt: 5, at: 10 }
const SCHOOL2 = { id: 'sch-2', name: 'Meadow Park Primary', address: '4 Meadow Way', at: 10 }
const base = () => ({
  reflections: [], targets: [], meetings: [], observations: [], audits: [], tasks: [], exceptions: [], plans: [], commitments: [], programmes: [], packs: [], requirements: [], milestones: [], cycles: [], preps: [], goals: [], resources: [], projects: [], readings: [], contacts: [], questions: [], protected: [], supportNotes: [], examples: [], reviewPacks: [], experience: [], reviews: [], homework: [], lessons: [],
  placements: [SE1, SE2],
  schools: [SCHOOL1, SCHOOL2],
})

async function seed(page: Page, admin: Record<string, unknown> = base(), settings: Record<string, unknown> = {}, sessions = SESSIONS) {
  await page.clock.install({ time: new Date('2026-09-16T06:05:00Z') })
  await page.addInitScript(
    ({ SESSIONS, admin, settings }) => {
      localStorage.setItem('timetable.whatsnew.v1', '99')
      if (localStorage.getItem('timetable.store.v2')) return
      localStorage.setItem('timetable.store.v2', JSON.stringify({ activeId: 'fx', profiles: [{ id: 'fx', name: 'My timetable', settings: { demo: false, sheetId: 'FIXTURESHEET-FIXTURESHEET-FIXTURESHEET-0001', gid: null, specialismsChosen: true, checklistDismissed: true, usagePing: false, placementReviewSeen: true, ...settings } }] }))
      localStorage.setItem('timetable.cache.v2.fx', JSON.stringify({ fetchedAt: Date.now(), sessions: SESSIONS }))
      localStorage.setItem('timetable.admin.v1.fx', JSON.stringify(admin))
    },
    { SESSIONS: sessions, admin, settings }
  )
  await page.setViewportSize({ width: 390, height: 844 })
}
const readAdmin = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('timetable.admin.v1.fx')!))
const readSettings = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('timetable.store.v2')!).profiles[0].settings)
async function edit(page: Page) {
  await page.goto('./#/pgce')
  // An incomplete placement offers 'Continue setup' where a ready one offers 'Edit'.
  await page.locator('.pgce-active').getByRole('button', { name: /^(Edit SE1 setup|Continue setup)$/ }).click()
  return page.getByRole('dialog', { name: 'Set up SE1' })
}
const next = (flow: ReturnType<Page['getByRole']>, n: number) => (async () => { for (let i = 0; i < n; i++) await flow.getByRole('button', { name: 'Next', exact: true }).click() })()

test('PL-01: an address edit drops the old pin, an unconfirmed save is honest, a late reply for the old address cannot confirm the new one, and SE2 is untouched', async ({ page }) => {
  // postcodes.io answers slowly, so a reply can arrive after the address moved on.
  await page.route('**/api.postcodes.io/**', async (route: Route) => {
    await new Promise((r) => setTimeout(r, 1200))
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ status: 200, result: { latitude: 51.5, longitude: -0.12 } }) })
  })
  await seed(page)
  const flow = await edit(page)
  await expect(flow.getByText(/Pin confirmed/)).toBeVisible()
  await flow.getByRole('textbox', { name: /^Address/ }).fill('99 Different School Road')
  await expect(flow.getByText(/Pin confirmed/)).toHaveCount(0)
  await expect(flow.getByRole('status')).toContainText('The address changed, so the old pin no longer applies')
  await next(flow, 3)
  await expect(flow.getByRole('status')).toContainText('location still needs confirmation')
  await flow.getByRole('button', { name: 'Save placement' }).click()
  let data = await readAdmin(page)
  const s1 = data.schools.find((s: { id: string }) => s.id === 'sch-1')
  expect(s1.address).toBe('99 Different School Road')
  expect(s1.lat).toBeUndefined()
  expect(s1.confirmedAt).toBeUndefined()
  expect(data.placements.find((p: { id: string }) => p.id === 'pl-se2')).toEqual(SE2)
  expect(data.schools.find((s: { id: string }) => s.id === 'sch-2')).toEqual(SCHOOL2)
  // The card is honest and journeys are not offered.
  await expect(page.locator('.pgce-active')).toContainText('School details incomplete')
  await expect(page.locator('.pgce-active').getByRole('button', { name: 'To school' })).toHaveCount(0)
  // Locate for address A, then change to address B before the reply lands: B keeps no pin.
  const again = await edit(page)
  await again.getByRole('textbox', { name: /^Address/ }).fill('1 Old Road, SW1A 1AA')
  await again.getByRole('button', { name: 'Locate on map' }).click()
  await again.getByRole('textbox', { name: /^Address/ }).fill('2 New Road, SW1A 2AA')
  await page.waitForTimeout(1600)
  await expect(again.getByRole('button', { name: 'Confirm this pin' })).toHaveCount(0)
  await expect(again.getByRole('button', { name: /Locate on map|Retry locating/ })).toBeVisible()
  // Locate for the current address and confirm: the pin is recorded for that address.
  await again.getByRole('button', { name: /Locate on map|Retry locating/ }).click()
  await again.getByRole('button', { name: 'Confirm this pin' }).click()
  await expect(again.getByText(/Pin confirmed/)).toBeVisible()
  await next(again, 3)
  await again.getByRole('button', { name: 'Save placement' }).click()
  data = await readAdmin(page)
  expect(data.schools.find((s: { id: string }) => s.id === 'sch-1')).toMatchObject({ address: '2 New Road, SW1A 2AA', lat: 51.5, lng: -0.12, locatedFor: '2 New Road, SW1A 2AA' })
  await expect(page.locator('.pgce-active')).toContainText('Ready to plan')
})

test('PL-02 + UX-02: a Settings detour, a reload and Cancel keep the draft on the learner’s say-so; the return destination is set inline by a real button', async ({ page }) => {
  await page.route('**/api.postcodes.io/**', (route: Route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ status: 200, result: { latitude: 51.55, longitude: -0.1 } }) }))
  await seed(page)
  let flow = await edit(page)
  await flow.getByLabel('School name').fill('Unsaved school change')
  await expect(flow.getByText('Draft kept on this device')).toBeVisible()
  await next(flow, 2)
  // UX-02: the action's accessible name is exactly the visible label.
  const group = flow.getByRole('group', { name: 'Return destination' })
  await expect(group.getByRole('button', { name: 'Set return destination', exact: true })).toBeVisible()
  await group.getByRole('button', { name: 'Open Settings → Travel & home' }).click()
  await expect(page).toHaveURL(/settings\/travel/)
  // Reload, reopen: the draft is offered, not applied silently.
  await page.reload()
  flow = await edit(page)
  await expect(flow.getByLabel('School name')).toHaveValue('Riverside Primary')
  const offer = flow.getByRole('group', { name: 'Unsaved changes' })
  await expect(offer).toContainText('You have unsaved changes to SE1')
  await offer.getByRole('button', { name: 'Resume draft' }).click()
  await expect(flow.getByRole('list', { name: 'Setup steps' }).locator('[aria-current="step"]')).toHaveText('Pattern & travel')
  await flow.getByRole('button', { name: 'Back' }).click()
  await flow.getByRole('button', { name: 'Back' }).click()
  await expect(flow.getByLabel('School name')).toHaveValue('Unsaved school change')
  // Set the home inline: settings gain the home, the flow stays open.
  await next(flow, 2)
  await group.getByLabel('Home address').fill('7 Home Street, N1 9ZZ')
  await group.getByRole('button', { name: 'Set return destination', exact: true }).click()
  await expect(group).toContainText('Home · 7 Home Street, N1 9ZZ')
  expect(await readSettings(page)).toMatchObject({ homeAddress: '7 Home Street, N1 9ZZ', homeLat: 51.55 })
  // Cancel while dirty asks; Discard leaves saved data alone and clears the draft.
  await flow.getByRole('button', { name: 'Cancel' }).click()
  await expect(flow.getByRole('group', { name: 'Unsaved changes' })).toContainText('Keep your unsaved changes as a draft, or discard them?')
  await flow.getByRole('group', { name: 'Unsaved changes' }).getByRole('button', { name: 'Discard' }).click()
  const data = await readAdmin(page)
  expect(data.schools.find((s: { id: string }) => s.id === 'sch-1').name).toBe('Riverside Primary')
  flow = await edit(page)
  await expect(flow.getByRole('group', { name: 'Unsaved changes' })).toHaveCount(0)
  await expect(flow.getByLabel('School name')).toHaveValue('Riverside Primary')
})

test('PL-03: a placement’s own inset policy drives its count while another placement keeps the profile default', async ({ page }) => {
  const a = base() as ReturnType<typeof base> & { placements: (typeof SE1 & { insetCountsAsSchoolDay?: boolean })[] }
  a.placements = [{ ...SE1, insetCountsAsSchoolDay: false }, { ...SE2, mappedBlockTags: ['SE2A'] }]
  a.exceptions = [{ id: 'ex1', tag: 'SE1A', dateISO: '2026-09-16', kind: 'inset', at: 1 }, { id: 'ex2', tag: 'SE2A', dateISO: '2026-09-18', kind: 'inset', at: 1 }] as never[]
  await seed(page, a, {}, [...SESSIONS, session('b1', 'School Experience SE2a', '2026-09-18', 'Fri')])
  await page.goto('./#/placement/pl-se1')
  await expect(page.getByText(/1 planned school day, 0 logged/)).toBeVisible()
  await page.goto('./#/placement/pl-se2')
  await expect(page.getByText(/1 planned school day, 0 logged/)).toBeVisible()
  // The excluded inset day is not a school day on the Schedule either.
  await page.goto('./#/schedule')
  await page.getByRole('option', { name: /Wednesday 16 September/ }).click()
  await expect(page.locator('.day-list .school-day-card')).toHaveCount(0)
  await page.getByRole('option', { name: /Thursday 17 September/ }).click()
  await expect(page.locator('.day-list .school-day-card')).toHaveCount(1)
})

test('PL-04: changing a new placement’s code regenerates untouched proposals, and asks once links were edited', async ({ page }) => {
  const a = base()
  a.placements = []
  a.schools = []
  await seed(page, a)
  await page.goto('./#/pgce')
  await page.locator('.pgce-active').getByRole('button', { name: 'Set up SE1', exact: true }).click()
  const flow = page.getByRole('dialog', { name: /Set up SE/ })
  await flow.getByLabel('Which placement?').selectOption('SE3')
  await next(flow, 4)
  await expect(flow.getByRole('checkbox', { name: /SE1A/ })).not.toBeChecked()
  await expect(flow.getByRole('status')).toContainText('Saving links 0 blocks (0 school days) to SE3')
  // Choose SE1A by hand, go back and change the code: the edited links are a deliberate choice.
  await flow.getByRole('checkbox', { name: /SE1A/ }).check()
  for (let i = 0; i < 4; i++) await flow.getByRole('button', { name: 'Back' }).click()
  await flow.getByLabel('Which placement?').selectOption('SE2')
  const choice = flow.getByRole('group', { name: 'Timetable links' })
  await expect(choice).toContainText('Replace them with SE2')
  await choice.getByRole('button', { name: 'Keep my links' }).click()
  await next(flow, 4)
  await expect(flow.getByRole('checkbox', { name: /SE1A/ })).toBeChecked()
  await expect(flow.getByRole('status')).toContainText('Saving links 1 block (2 school days) to SE2')
  await flow.getByRole('button', { name: 'Save placement' }).click()
  expect((await readAdmin(page)).placements[0]).toMatchObject({ code: 'SE2', mappedBlockTags: ['SE1A'] })
})

test('PL-05: reversed working hours cannot save — the error names the fix; a valid interval saves with its arrival preview', async ({ page }) => {
  await seed(page)
  const flow = await edit(page)
  await next(flow, 2)
  await flow.getByRole('checkbox', { name: /Different hours/ }).check()
  await flow.getByLabel('Day starts').fill('16:00')
  await flow.getByLabel('Day ends').fill('08:00')
  await flow.getByRole('button', { name: 'Next', exact: true }).click()
  await expect(flow.getByRole('alert')).toContainText('The school day must end after it starts')
  await expect(flow.getByRole('list', { name: 'Setup steps' }).locator('[aria-current="step"]')).toHaveText('Pattern & travel')
  await flow.getByLabel('Day ends').fill('16:00')
  await flow.getByLabel('Day starts').fill('08:00')
  await expect(flow.getByText(/Effective arrival: 07:50/)).toBeVisible()
  await next(flow, 1)
  await flow.getByRole('button', { name: 'Save placement' }).click()
  expect((await readAdmin(page)).placements[0].workingHours).toEqual({ start: '08:00', end: '16:00' })
})
