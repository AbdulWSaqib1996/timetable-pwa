import { expect, test } from './fixtures'
import type { Page } from '@playwright/test'

/**
 * G0 (Pass 68) — the reviewable tag → placement migration sheet. A real
 * (non-demo) profile with cached SE1A, SE1B and SE2 blocks and imported
 * school details opens the sheet from the PGCE file, sees prefix proposals
 * (never a silent write), confirms, and gets SE1/SE2 placement records with
 * carried-over school details. Re-confirming changes nothing; a block can be
 * left Unassigned; Settings keep their imported placement details.
 */

test.use({ timezoneId: 'Europe/London' })

const session = (id: string, title: string, dateISO: string, day: string) => ({
  id, title, day, dateISO, start: '08:30', end: '15:30', room: '', groups: '', tutor: '', subject: '', isSpecialism: false, isSelfStudy: false, isOptional: false,
})
const SESSIONS = [
  session('a1', 'School Experience SE1a', '2026-10-05', 'Mon'),
  session('a2', 'School Experience SE1a', '2026-10-06', 'Tue'),
  session('b1', 'School Experience SE1b', '2026-11-02', 'Mon'),
  session('c1', 'School Experience SE2', '2027-02-01', 'Mon'),
  session('s1', 'SE1a self study', '2026-10-07', 'Wed'),
]

async function seed(page: Page) {
  await page.clock.install({ time: new Date('2026-09-07T07:05:00Z') })
  await page.addInitScript((SESSIONS) => {
    localStorage.setItem('timetable.whatsnew.v1', '99')
    if (localStorage.getItem('timetable.store.v2')) return
    localStorage.setItem('timetable.store.v2', JSON.stringify({ activeId: 'fx', profiles: [{ id: 'fx', name: 'My timetable', settings: {
      demo: false, sheetId: 'FIXTURESHEET-FIXTURESHEET-FIXTURESHEET-0001', gid: null, specialismsChosen: true, checklistDismissed: true, usagePing: false,
      placements: { SE1A: { school: 'Riverside Primary', address: '1 River Lane', mentor: 'A Mentor', lat: 51.5, lng: -0.1 }, SE2: { school: 'Hillside Academy' } },
    } }] }))
    localStorage.setItem('timetable.cache.v2.fx', JSON.stringify({ fetchedAt: Date.now(), sessions: SESSIONS }))
  }, SESSIONS)
  await page.setViewportSize({ width: 390, height: 844 })
}

const admin = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('timetable.admin.v1.fx') ?? '{}'))

test('proposals by prefix, confirm writes SE1/SE2 with carried school details, idempotent, Unassigned kept, Settings untouched', async ({ page }) => {
  await seed(page)
  await page.goto('./#/pgce')
  await expect(page.getByRole('heading', { level: 1, name: 'PGCE file' })).toBeVisible()
  // Nothing is written before confirmation.
  expect((await admin(page)).placements ?? []).toEqual([])
  await page.getByRole('button', { name: 'Set up SE1, SE2, SE3 →' }).click()
  const dialog = page.getByRole('dialog', { name: 'Set up placements' })
  await expect(dialog).toBeVisible()
  // The self-study row is not a block; the three real blocks are, with prefix proposals.
  await expect(dialog.getByRole('listitem').filter({ hasText: 'SE1A' }).first()).toContainText('proposed SE1')
  await expect(dialog.getByRole('combobox', { name: 'Placement for SE1A' })).toHaveValue('SE1')
  await expect(dialog.getByRole('combobox', { name: 'Placement for SE1B' })).toHaveValue('SE1')
  await expect(dialog.getByRole('combobox', { name: 'Placement for SE2' })).toHaveValue('SE2')
  await expect(dialog.getByRole('combobox', { name: /Placement for/ })).toHaveCount(3)
  // Cancel (button and Escape) writes nothing, even after a change in the sheet.
  await dialog.getByRole('combobox', { name: 'Placement for SE2' }).selectOption('SE3')
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(dialog).toHaveCount(0)
  expect((await admin(page)).placements ?? []).toEqual([])
  await page.getByRole('button', { name: 'Set up SE1, SE2, SE3 →' }).click()
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('combobox', { name: 'Placement for SE2' })).toHaveValue('SE2')
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  expect((await admin(page)).placements ?? []).toEqual([])
  await page.getByRole('button', { name: 'Set up SE1, SE2, SE3 →' }).click()
  await expect(dialog).toBeVisible()
  // The learner overrides one proposal: SE1B stays Unassigned for now.
  await dialog.getByRole('combobox', { name: 'Placement for SE1B' }).selectOption('')
  await dialog.getByRole('button', { name: 'Confirm placements' }).click()
  await expect(dialog).toHaveCount(0)

  const first = await admin(page)
  expect(first.schemaVersion).toBe(2)
  const se1 = first.placements.find((p: { code: string }) => p.code === 'SE1')
  const se2 = first.placements.find((p: { code: string }) => p.code === 'SE2')
  expect(first.placements.map((p: { code: string }) => p.code).sort()).toEqual(['SE1', 'SE2'])
  expect(se1.mappedBlockTags).toEqual(['SE1A'])
  expect(se1.mentorName).toBe('A Mentor')
  expect(se2.mappedBlockTags).toEqual(['SE2'])
  const riverside = first.schools.find((s: { id: string }) => s.id === se1.schoolLocationId)
  expect(riverside).toMatchObject({ name: 'Riverside Primary', address: '1 River Lane', lat: 51.5, lng: -0.1 })
  expect(riverside.confirmedAt).toBeUndefined()
  expect(first.schools.find((s: { id: string }) => s.id === se2.schoolLocationId)?.name).toBe('Hillside Academy')
  // The PGCE card now lists the confirmed placements; Settings still hold the imported details.
  await expect(page.getByRole('list', { name: 'Placements' })).toContainText('SE1 · Riverside Primary')
  await expect(page.getByRole('list', { name: 'Placements' })).toContainText('SE2 · Hillside Academy')
  const settings = await page.evaluate(() => JSON.parse(localStorage.getItem('timetable.store.v2')!).profiles[0].settings)
  expect(settings.placements.SE1A.school).toBe('Riverside Primary')

  // Re-open: current mapping shown, re-confirm with no changes → identical records.
  await page.getByRole('button', { name: 'Review SE1, SE2, SE3 →' }).click()
  await expect(dialog.getByRole('combobox', { name: 'Placement for SE1B' })).toHaveValue('')
  await expect(dialog.getByRole('listitem').filter({ hasText: 'SE1A' }).first()).toContainText('currently SE1')
  await dialog.getByRole('button', { name: 'Confirm placements' }).click()
  const second = await admin(page)
  expect(second.placements).toEqual(first.placements)
  expect(second.schools).toEqual(first.schools)

  // Assign the remaining block: SE1 gains SE1B; ids and school link are kept.
  await page.getByRole('button', { name: 'Review SE1, SE2, SE3 →' }).click()
  await dialog.getByRole('combobox', { name: 'Placement for SE1B' }).selectOption('SE1')
  await dialog.getByRole('button', { name: 'Confirm placements' }).click()
  const third = await admin(page)
  const se1b = third.placements.find((p: { code: string }) => p.code === 'SE1')
  expect(se1b.id).toBe(se1.id)
  expect(se1b.mappedBlockTags).toEqual(['SE1A', 'SE1B'])
  expect(se1b.schoolLocationId).toBe(se1.schoolLocationId)
  expect(third.schools.length).toBe(2)

  // The placement overview labels the mapped block with its placement and school.
  await page.getByRole('button', { name: 'Open placement' }).click()
  await expect(page.locator('.placement-block').filter({ hasText: 'SE1A' }).first()).toContainText('SE1 · Riverside Primary')
})

test('an older admin file (no placements, no schemaVersion) loads, and unknown newer fields survive a save', async ({ page }) => {
  await seed(page)
  await page.addInitScript(() => {
    if (localStorage.getItem('timetable.admin.v1.fx')) return
    localStorage.setItem('timetable.admin.v1.fx', JSON.stringify({ reflections: [], targets: [], meetings: [], observations: [], lessons: [], audits: [], futureThing: { keep: true } }))
  })
  await page.goto('./#/pgce')
  await expect(page.getByRole('heading', { level: 1, name: 'PGCE file' })).toBeVisible()
  await page.getByRole('button', { name: 'Set up SE1, SE2, SE3 →' }).click()
  await page.getByRole('dialog', { name: 'Set up placements' }).getByRole('button', { name: 'Confirm placements' }).click()
  const file = await admin(page)
  expect(file.schemaVersion).toBe(2)
  expect(file.placements.map((p: { code: string }) => p.code).sort()).toEqual(['SE1', 'SE2'])
  expect(file.futureThing).toEqual({ keep: true })
  expect(file.tasks).toEqual([])
})
