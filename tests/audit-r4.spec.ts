import { expect, test } from './fixtures'
import type { Page } from '@playwright/test'

/**
 * R4 regressions (Pass 53): local "Find anything" (NF-01), work-plan block
 * calendar projection (NF-02) and Plan-week suggestions (NF-03). Demo
 * profiles with synthetic records; every network host is blocked.
 */

const DEMO = { demo: true, sheetId: '', gid: null, specialismsChosen: true, checklistDismissed: true, usagePing: false }
const EMPTY_ADMIN = { reflections: [], targets: [], observations: [], lessons: [], audits: [], tasks: [], exceptions: [], plans: [], commitments: [], meetings: [] }

type Seed = { profiles: { id: string; name: string; settings: Record<string, unknown> }[]; admin?: Record<string, Record<string, unknown>>; width?: number }

async function seed(page: Page, { profiles, admin = {}, width = 390 }: Seed) {
  await page.clock.install({ time: new Date('2026-09-07T07:05:00Z') })
  await page.addInitScript(
    ({ profiles, admin }) => {
      localStorage.setItem('timetable.whatsnew.v1', '99')
      if (localStorage.getItem('timetable.store.v2')) return
      localStorage.setItem('timetable.store.v2', JSON.stringify({ activeId: profiles[0].id, profiles }))
      for (const [id, file] of Object.entries(admin)) localStorage.setItem(`timetable.admin.v1.${id}`, JSON.stringify(file))
    },
    { profiles, admin }
  )
  await page.setViewportSize({ width, height: 900 })
}

const adminOf = (page: Page, id: string) => page.evaluate((pid) => JSON.parse(localStorage.getItem(`timetable.admin.v1.${pid}`)!), id)

const TASK = { id: 'essay', title: 'Big essay', dueISO: '2026-09-30', status: 'todo', notes: 'Discuss phonics and reading fluency', at: 1 }
const BLOCK = { id: 'blk1', parentId: 'essay', kind: 'block', title: 'Library session', dateISO: '2026-09-09', startTime: '15:00', endTime: '17:00', at: 1 }
const TODAY_BLOCK = { id: 'blk2', parentId: 'essay', kind: 'block', title: 'Reading hour', dateISO: '2026-09-07', startTime: '19:00', endTime: '20:00', at: 1 }
const BROKEN = { id: 'blk3', parentId: 'essay', kind: 'block', title: 'Broken block', dateISO: '2026-09-10', startTime: '15:00', endTime: '14:00', at: 1 }
const ORPHAN = { id: 'blk4', parentId: 'gone', kind: 'block', title: 'Orphan block', dateISO: '2026-09-10', startTime: '10:00', endTime: '11:00', at: 1 }

test('NF-02: a valid study block projects into List, Week and Today; opening it edits the block in place; invalid and orphan blocks stay off the grid', async ({ page }) => {
  await seed(page, {
    profiles: [{ id: 'd', name: 'Demo learner', settings: { ...DEMO, activeView: 'list' } }],
    admin: { d: { ...EMPTY_ADMIN, tasks: [TASK], plans: [BLOCK, TODAY_BLOCK, BROKEN, ORPHAN] } },
  })
  await page.goto('./#/schedule')
  const list = page.getByRole('region', { name: 'List view' })
  const card = list.locator('.session-card', { hasText: 'Library session' })
  await expect(card).toBeVisible()
  await expect(card).toContainText('Study block')
  await expect(list.locator('.session-card', { hasText: 'Broken block' })).toHaveCount(0)
  await expect(list.locator('.session-card', { hasText: 'Orphan block' })).toHaveCount(0)
  // Opening the projection opens the PARENT task's block editor, focused on the block.
  await card.click()
  const dialog = page.getByRole('dialog', { name: 'Edit task' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByLabel('Title', { exact: true })).toHaveValue('Big essay')
  await expect(dialog.getByLabel('Starts')).toBeFocused()
  await expect(dialog.getByLabel('Starts')).toHaveValue('15:00')
  await dialog.getByLabel('Ends').fill('18:00')
  await dialog.getByRole('button', { name: 'Save block' }).click()
  await dialog.getByRole('button', { name: 'Close' }).click()
  // Every view follows the edit; no commitment was created; one owner only.
  await expect(list.locator('.session-card', { hasText: 'Library session' })).toContainText('18:00')
  const admin = await adminOf(page, 'd')
  expect(admin.commitments).toHaveLength(0)
  expect(admin.plans.filter((p: { id: string }) => p.id === 'blk1')).toHaveLength(1)
  expect(admin.plans.find((p: { id: string }) => p.id === 'blk1').endTime).toBe('18:00')
  // Today shows today's block among the day's items.
  await page.goto('./#/today')
  await expect(page.getByText('Reading hour').first()).toBeVisible()
  // Desktop week grid draws it too.
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('./#/schedule')
  await page.getByRole('tab', { name: 'Week' }).click()
  await expect(page.locator('.week-event', { hasText: 'Library session' })).toBeVisible()
  await expect(page.locator('.week-event', { hasText: 'Broken block' })).toHaveCount(0)
})

test('NF-02: deleting a block removes its projection; a task without the block keeps "Needs scheduling" for an invalid one', async ({ page }) => {
  await seed(page, {
    profiles: [{ id: 'd', name: 'Demo learner', settings: { ...DEMO, activeView: 'list' } }],
    admin: { d: { ...EMPTY_ADMIN, tasks: [TASK], plans: [BLOCK, BROKEN] } },
  })
  await page.goto('./#/tasks')
  await page.locator('.keydates-list li', { hasText: 'Big essay' }).locator('.keydate-row').click()
  const dialog = page.getByRole('dialog', { name: 'Edit task' })
  await expect(dialog.getByText('Needs scheduling')).toBeVisible()
  await dialog.getByRole('button', { name: 'Remove block' }).first().click()
  await dialog.getByRole('button', { name: 'Close' }).click()
  await page.goto('./#/schedule')
  await expect(page.getByRole('region', { name: 'List view' }).locator('.session-card', { hasText: 'Library session' })).toHaveCount(0)
})

test('NF-03: Plan week suggests non-overlapping gaps with reasons; a suggestion only prefills an editor; a saved block can be undone', async ({ page }) => {
  await seed(page, {
    profiles: [{ id: 'd', name: 'Demo learner', settings: { ...DEMO, activeView: 'list' } }],
    admin: {
      d: {
        ...EMPTY_ADMIN,
        tasks: [TASK],
        commitments: [
          { id: 'free1', title: 'Yoga (free)', dateISO: '2026-09-08', startTime: '18:00', endTime: '19:00', kind: 'appointment', busy: false, at: 1 },
          { id: 'busy1', title: 'Shift', dateISO: '2026-09-08', startTime: '12:00', endTime: '13:00', kind: 'work', busy: true, at: 1 },
        ],
      },
    },
  })
  await page.goto('./#/schedule')
  await page.getByRole('button', { name: 'Plan week' }).click()
  const sheet = page.getByRole('dialog', { name: 'Plan week' })
  await expect(sheet).toBeVisible()
  await expect(sheet.getByText(/Week of Mon 7 Sept/)).toBeVisible()
  await expect(sheet.getByText(/Due this week/)).toHaveCount(0)
  const suggestions = sheet.getByRole('list', { name: 'Suggested gaps' }).getByRole('button')
  expect(await suggestions.count()).toBeGreaterThan(3)
  // Every suggestion states why it fits and is labelled an estimate.
  const texts = await suggestions.allInnerTexts()
  for (const t of texts) {
    expect(t).toMatch(/estimate/)
    expect(t).toMatch(/free (between|after|before)|nothing planned/)
  }
  // No Tuesday suggestion overlaps the busy shift (12:00–13:00); the free yoga does not block 18:00–19:00.
  const tuesday = texts.filter((t) => t.startsWith('Tue 8 Sept'))
  for (const t of tuesday) {
    const [, from, to] = t.match(/(\d\d:\d\d)–(\d\d:\d\d)/)!
    expect(from < '13:00' && '12:00' < to).toBe(false)
  }
  expect(tuesday.some((t) => { const [, f, e] = t.match(/(\d\d:\d\d)–(\d\d:\d\d)/)!; return f < '19:00' && '18:00' < e })).toBe(true)
  await expect(sheet.getByText(/marked free are shown but do not block/)).toBeVisible()
  await expect(sheet.getByText(/15 min travel buffer/)).toBeVisible()

  // Personal study block: the editor opens prefilled; Cancel saves nothing.
  const firstText = texts[0]
  const [, from, to] = firstText.match(/(\d\d:\d\d)–(\d\d:\d\d)/)!
  await suggestions.first().click()
  const personal = page.getByRole('dialog', { name: 'Add personal event' })
  await expect(personal).toBeVisible()
  await expect(personal.getByLabel('Starts')).toHaveValue(from)
  await expect(personal.getByLabel('Ends')).toHaveValue(to)
  await personal.getByRole('button', { name: 'Cancel' }).click()
  expect((await adminOf(page, 'd')).commitments).toHaveLength(2)

  // Block for a task: prefilled work-plan form; Add saves; Undo removes it.
  await page.getByRole('button', { name: 'Plan week' }).click()
  await sheet.getByLabel('Plan as').selectOption('essay')
  await suggestions.first().click()
  const task = page.getByRole('dialog', { name: 'Edit task' })
  await expect(task.getByText(/Prefilled from Plan week/)).toBeVisible()
  await expect(task.getByLabel('Starts')).toHaveValue(from)
  await task.getByPlaceholder('Study block…').fill('Essay reading')
  await task.getByRole('button', { name: '＋ Add block' }).click()
  await task.getByRole('button', { name: 'Close' }).click()
  expect((await adminOf(page, 'd')).plans.filter((p: { title: string }) => p.title === 'Essay reading')).toHaveLength(1)
  await expect(page.getByText(/Added study block “Essay reading”/)).toBeVisible()
  await page.getByRole('button', { name: 'Undo' }).click()
  expect((await adminOf(page, 'd')).plans.filter((p: { title: string }) => p.title === 'Essay reading')).toHaveLength(0)
  await expect(page.getByText(/Added study block “Essay reading”/)).toHaveCount(0)
})

test('NF-01: Find anything finds a lesson, a personal event and a task; notes only when opted in; opens the canonical editor; keeps its query', async ({ page }) => {
  await seed(page, {
    profiles: [{ id: 'd', name: 'Demo learner', settings: DEMO }],
    admin: {
      d: {
        ...EMPTY_ADMIN,
        tasks: [TASK],
        plans: [BLOCK],
        commitments: [{ id: 'dent', title: 'Dentist appointment', dateISO: '2026-09-09', startTime: '17:00', endTime: '18:00', kind: 'appointment', busy: true, at: 1 }],
        reflections: [{ id: 'r1', weekISO: '2026-08-31', wentWell: 'Phonics carousel worked', challenges: '', focus: '', standards: [], at: 1 }],
      },
    },
  })
  await page.goto('./#/schedule')
  await page.getByRole('button', { name: 'Search', exact: true }).click()
  await page.getByRole('button', { name: 'Search everything →' }).click()
  await expect(page).toHaveURL(/#\/find$/)
  const box = page.getByRole('searchbox', { name: 'Find anything' })
  await expect(box).toBeFocused()
  const results = page.getByRole('list', { name: 'Search results' })
  await box.fill('english 1')
  await expect(results.getByRole('button').first()).toContainText('English 1')
  await expect(results.getByRole('button').first()).toContainText('Timetable')
  await box.fill('dentist')
  await expect(results.getByRole('button')).toHaveCount(1)
  await expect(results.getByRole('button').first()).toContainText('Personal')
  await box.fill('library')
  await expect(results.getByRole('button').first()).toContainText('Work plan')
  // Notes are outside the default scope; opting in finds the phrase locally with a snippet.
  await box.fill('phonics')
  await expect(page.getByText(/No results for “phonics”/)).toBeVisible()
  await page.getByLabel('Include my notes and captions').check()
  await expect(results.getByRole('button')).toHaveCount(2)
  await expect(results.getByRole('button', { name: /Big essay/ })).toContainText(/phonics/i)
  await expect(results.getByRole('button', { name: /Weekly reflection/ })).toBeVisible()
  // Keyboard: ↓ into results, Enter opens the canonical editor; Back keeps the query.
  await box.fill('dentist')
  await expect(results.getByRole('button')).toHaveCount(1)
  await box.press('ArrowDown')
  await expect(results.getByRole('button').first()).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('dialog', { name: 'Edit personal event' })).toBeVisible()
  await page.getByRole('button', { name: 'Close' }).click()
  await expect(page).toHaveURL(/#\/find$/)
  await expect(box).toHaveValue('dentist')
  // A task result opens the task editor.
  await box.fill('big essay')
  await results.getByRole('button', { name: /Big essay/ }).click()
  await expect(page.getByRole('dialog', { name: 'Edit task' })).toBeVisible()
})

test('NF-01: rename and delete update results; another profile cannot see them', async ({ page }) => {
  await seed(page, {
    profiles: [
      { id: 'a', name: 'Profile A', settings: DEMO },
      { id: 'b', name: 'Profile B', settings: DEMO },
    ],
    admin: { a: { ...EMPTY_ADMIN, tasks: [TASK] }, b: { ...EMPTY_ADMIN, tasks: [{ ...TASK, id: 'other', title: 'Profile B only task' }] } },
  })
  await page.goto('./#/tasks')
  await page.locator('.keydates-list li', { hasText: 'Big essay' }).locator('.keydate-row').click()
  await page.getByLabel('Title', { exact: true }).fill('Bigger essay')
  await page.getByRole('button', { name: 'Save task' }).click()
  await page.goto('./#/find')
  const box = page.getByRole('searchbox', { name: 'Find anything' })
  const results = page.getByRole('list', { name: 'Search results' })
  await box.fill('bigger')
  await expect(results.getByRole('button')).toHaveCount(1)
  await box.fill('profile b only')
  await expect(page.getByText(/No results/)).toBeVisible()
  await page.goto('./#/settings/timetable')
  await page.getByRole('button', { name: 'Profile B', exact: true }).click()
  await page.goto('./#/find')
  await box.fill('profile b only')
  await expect(results.getByRole('button')).toHaveCount(1)
  await box.fill('bigger')
  await expect(page.getByText(/No results/)).toBeVisible()
  // Deleting in profile B removes it from its own results.
  await page.goto('./#/tasks')
  await page.locator('.keydates-list li', { hasText: 'Profile B only task' }).locator('.keydate-row').click()
  await page.getByRole('button', { name: 'Delete task' }).click()
  await page.goto('./#/find')
  await box.fill('profile b only')
  await expect(page.getByText(/No results/)).toBeVisible()
})

test('NF-01: 10,000 searchable entries — typing stays responsive and results page at 50', async ({ page }) => {
  test.setTimeout(120_000)
  const tasks = []
  for (let i = 0; i < 10_000; i++) {
    tasks.push({ id: `t${i}`, title: `Record ${i} ${i % 7 === 0 ? 'phonics' : 'fluency'}`, dueISO: `2026-${String(1 + (i % 12)).padStart(2, '0')}-${String(1 + (i % 28)).padStart(2, '0')}`, status: 'todo', notes: `note ${i}`, at: i + 1 })
  }
  await seed(page, { profiles: [{ id: 'd', name: 'Demo learner', settings: DEMO }], admin: { d: { ...EMPTY_ADMIN, tasks } } })
  await page.goto('./#/find')
  const box = page.getByRole('searchbox', { name: 'Find anything' })
  await expect(box).toBeVisible()
  const t0 = Date.now()
  await box.pressSequentially('record 99', { delay: 40 })
  await expect(box).toHaveValue('record 99')
  const typed = Date.now() - t0
  expect(typed, `typing 9 characters took ${typed} ms`).toBeLessThan(4000)
  const results = page.getByRole('list', { name: 'Search results' })
  await expect(results.getByRole('button')).toHaveCount(50)
  await expect(page.getByText(/showing 50/)).toBeVisible()
  await page.getByRole('button', { name: /Show more/ }).click()
  await expect(results.getByRole('button')).toHaveCount(100)
})

test('Back from a detail returns to the page that opened it (own hash writes no longer cancel the internal entry)', async ({ page }) => {
  await seed(page, { profiles: [{ id: 'd', name: 'Demo learner', settings: DEMO }] })
  await page.goto('./#/tasks')
  await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Schedule' }).click()
  await expect(page).toHaveURL(/#\/schedule$/)
  await page.locator('.day-list .session-card').first().click()
  await expect(page.locator('.detail-page')).toBeVisible()
  await page.getByRole('button', { name: /Back/ }).first().click()
  await expect(page).toHaveURL(/#\/schedule$/)
})
