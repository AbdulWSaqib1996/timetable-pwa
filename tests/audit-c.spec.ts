import { expect, test } from './fixtures'
import type { Page } from '@playwright/test'

/**
 * Audit Batch C (Pass 79) — positive regression tests for U01–U05:
 *  - U01: the PGCE landing shows the active placement, ONE next action whose
 *         rule follows the fixed precedence (data issue → dated → unfinished →
 *         onboarding), four destinations reachable in two actions, the last
 *         section remembered per profile;
 *  - U02: packs as list/detail with Content → People → Check & share, a search
 *         that finds one record among 200 without scrolling them all, sharing
 *         state beside the learner state, and Discussed needing a valid date;
 *  - U03: one toolbar row at 390px with Filters (count) + Clear + Today, the
 *         school-day card naming school, hours and source, To school / Back home;
 *  - U04: arrow keys move every tab strip; textareas have visible labels;
 *         reduced motion is honoured for the completed-task reveal;
 *  - U05: `#/pgce/records/<tab>/<id>` and `#/pgce/lesson/<id>` restore the
 *         record on refresh; the record header names type, placement, date
 *         and draft state; Back returns to the caller; delete is a labelled
 *         control that asks first and offers Undo.
 */

test.use({ timezoneId: 'Europe/London' })

const session = (id: string, title: string, dateISO: string, day: string, start = '08:30', end = '15:30') => ({ id, title, day, dateISO, start, end, room: '', groups: '', tutor: '', subject: '', isSpecialism: false, isSelfStudy: false, isOptional: false })
const SESSIONS = [session('a1', 'School Experience SE1a', '2026-09-14', 'Mon'), session('m1', 'Maths 2', '2026-09-15', 'Tue', '09:00', '11:00')]
const base = () => ({
  reflections: [{ id: 'r1', weekISO: '2026-09-07', wentWell: 'Clear modelling', challenges: '', focus: 'Wait time', standards: ['TS4'], at: 10 }],
  targets: [], meetings: [], observations: [], audits: [], tasks: [], exceptions: [], plans: [], commitments: [], programmes: [], packs: [], requirements: [], milestones: [], cycles: [], preps: [], goals: [], resources: [], projects: [], readings: [], contacts: [], questions: [], protected: [], supportNotes: [], examples: [], experience: [], reviews: [],
  lessons: [
    { id: 'l1', dateISO: '2026-09-14', classGroup: 'Y2', subject: 'Maths — number bonds', evaluation: '', standards: ['TS4'], placementId: 'pl-se1', at: 10 },
    { id: 'l0', dateISO: '2026-09-09', classGroup: 'Y2', subject: 'Phonics', evaluation: '', standards: [], intention: 'x', taughtAt: 5, taughtPlanRevision: 1, planRevision: 1, at: 20 },
  ],
  placements: [{ id: 'pl-se1', code: 'SE1', schoolLocationId: 'sch-1', startISO: '2026-09-07', endISO: '2026-12-11', mappedBlockTags: ['SE1A'], mentorName: 'A Mentor', workingHours: { start: '08:15', end: '15:45' }, at: 10 }],
  schools: [{ id: 'sch-1', name: 'Riverside Primary', address: '1 River Lane', lat: 51.53, lng: -0.11, confirmedAt: 5, at: 10 }],
  reviewPacks: [{ id: 'k1', title: 'Progress review 1', state: 'selected', createdISO: '2026-09-14', items: [], attachments: [], at: 1 }],
})

async function seed(page: Page, admin: Record<string, unknown> = base(), settings: Record<string, unknown> = {}, width = 390) {
  await page.clock.install({ time: new Date('2026-09-14T06:05:00Z') })
  await page.addInitScript(
    ({ SESSIONS, admin, settings }) => {
      localStorage.setItem('timetable.whatsnew.v1', '99')
      if (localStorage.getItem('timetable.store.v2')) return
      localStorage.setItem('timetable.store.v2', JSON.stringify({ activeId: 'fx', profiles: [{ id: 'fx', name: 'My timetable', settings: { demo: false, sheetId: 'FIXTURESHEET-FIXTURESHEET-FIXTURESHEET-0001', gid: null, specialismsChosen: true, checklistDismissed: true, usagePing: false, ...settings } }] }))
      localStorage.setItem('timetable.cache.v2.fx', JSON.stringify({ fetchedAt: Date.now(), sessions: SESSIONS }))
      localStorage.setItem('timetable.admin.v1.fx', JSON.stringify(admin))
    },
    { SESSIONS, admin, settings }
  )
  await page.setViewportSize({ width, height: 844 })
}
const admin = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('timetable.admin.v1.fx') ?? '{}'))

test('U01: active placement card, ONE next action by precedence, four destinations in two actions, last section remembered per profile', async ({ page }) => {
  // 1. Data issue first: the placement in play has no confirmed pin → setup is recommended over the taught-but-unreviewed lesson.
  const a = base()
  ;(a.schools[0] as { confirmedAt?: number }).confirmedAt = undefined
  await seed(page, a)
  await page.goto('./#/pgce')
  const next = page.getByLabel('Next action')
  await expect(next).toContainText('Finish setting up SE1')
  await expect(next).toContainText('Needs attention')
  await expect(page.locator('.pgce-active')).toContainText('SE1')
  await expect(page.locator('.pgce-active')).toContainText('Riverside Primary')
  await expect(page.getByRole('button', { name: 'Set up SE1' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'To school' })).toHaveCount(0)
  // 2. With the pin confirmed, the nearest DATED item wins — the shared next-steps rule puts the taught
  //    Phonics review (9 Sep) before today's unplanned Maths lesson.
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('timetable.admin.v1.fx')!)
    raw.schools[0].confirmedAt = 5
    localStorage.setItem('timetable.admin.v1.fx', JSON.stringify(raw))
  })
  await page.reload()
  await expect(next).toContainText('Review Phonics')
  await expect(next).toContainText('Dated')
  await expect(page.getByRole('button', { name: 'To school' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Back home' })).toBeVisible()
  // Only ONE recommendation in the main slot; See all is there.
  await expect(next.getByRole('button', { name: 'Open' })).toHaveCount(1)
  await expect(next.getByRole('button', { name: 'See all' })).toBeVisible()
  // 3. No dated work within reach → the most recently edited unfinished record (a draft mentor prep beyond the 14-day horizon).
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('timetable.admin.v1.fx')!)
    raw.lessons[1].evaluation = 'reviewed'
    raw.lessons[0].dateISO = '2026-09-01'
    raw.lessons[0].intention = 'planned'
    raw.preps = [{ id: 'p1', dateISO: '2026-10-30', state: 'draft', exampleRefs: [], at: 99 }]
    localStorage.setItem('timetable.admin.v1.fx', JSON.stringify(raw))
  })
  await page.reload()
  await expect(next).toContainText('Finish your mentor preparation')
  await expect(next).toContainText('Unfinished')
  // Two actions to the current lesson: the destination's primary opens the workbench with its own URL.
  await page.getByRole('button', { name: /^Open current lesson/ }).click()
  await expect(page.getByRole('dialog', { name: /Lesson workbench/ })).toBeVisible()
  await expect(page).toHaveURL(/#\/pgce\/lesson\//)
  await page.keyboard.press('Escape')
  // Two actions to mentor preparation.
  await page.getByRole('button', { name: /^Mentor preparation \(/ }).click()
  await expect(page.getByRole('dialog', { name: 'Mentor preparation' })).toBeVisible()
  await page.keyboard.press('Escape')
  // The section visited last is remembered for THIS profile and offered as Continue.
  await page.getByRole('link', { name: /^Evidence & reviews/ }).click()
  await expect(page).toHaveURL(/#\/pgce\/evidence$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Evidence & reviews' })).toBeVisible()
  await expect(page.getByRole('list', { name: 'Recent packs' })).toContainText('Progress review 1')
  await page.goto('./#/pgce')
  await expect(page.getByRole('button', { name: /Continue in Evidence & reviews/ })).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('timetable.pgce.section.v1.fx'))).toBe('evidence')
  expect(await page.evaluate(() => localStorage.getItem('timetable.pgce.section.v1.other'))).toBeNull()
  // Nothing scores the learner.
  await expect(page.locator('.page-pgce')).not.toContainText(/\d+%|\bscores?\b|\bbehind\b/i)
})

test('U02: list/detail packs in three steps; search finds one of 200 records; sharing state beside learner state; Discussed needs a valid date', async ({ page }) => {
  const a = base()
  a.lessons = Array.from({ length: 200 }, (_, i) => ({ id: `L${i}`, dateISO: `2026-0${1 + (i % 9)}-${String(1 + (i % 28)).padStart(2, '0')}`, classGroup: 'Y2', subject: i === 137 ? 'Needle — fractions' : `Lesson ${i}`, evaluation: '', standards: [], placementId: i % 2 ? 'pl-se1' : undefined, at: 1 }))
  await seed(page, a, { mentorSpaceId: 'a'.repeat(24), mentorOwnerToken: 'b'.repeat(48) }, 768)
  await page.goto('./#/pgce/packs/k1')
  const sheet = page.getByRole('dialog', { name: 'Review packs' })
  await expect(sheet).toBeVisible()
  // Split view at 768px: list and detail side by side.
  const list = await sheet.getByLabel('Pack list').boundingBox()
  const detail = await sheet.getByLabel('Pack: Progress review 1').boundingBox()
  expect(detail!.x).toBeGreaterThan(list!.x + list!.width - 1)
  await expect(sheet.locator('[data-sharing-state]')).toHaveText('Never shared')
  await expect(sheet.getByLabel('Pack states')).toContainText('Selected')
  // Search + filters narrow 200 candidates to one without traversing the list.
  const status = sheet.getByRole('list', { name: 'Pack candidates' })
  await expect(status).not.toContainText('Needle')
  await sheet.getByLabel('Search records').fill('needle')
  await expect(sheet.getByText('1 of 201 records match')).toBeVisible()
  await sheet.getByRole('checkbox', { name: /Needle — fractions/ }).check()
  await sheet.getByRole('button', { name: 'Pin selection (1)' }).click()
  await expect(sheet.getByRole('list', { name: 'Pinned items' })).toContainText('Needle — fractions')
  await sheet.getByLabel('Search records').fill('')
  await sheet.getByLabel('Placement filter').selectOption('unassigned')
  await expect(sheet.getByText(/^101 of 200 records match/)).toBeVisible()
  await sheet.getByLabel('Record type').selectOption('reflection')
  await expect(sheet.getByText(/^1 of 200 records match/)).toBeVisible()
  // Discussed needs a valid date: an empty date is an inline error, the state does not change.
  await sheet.getByRole('button', { name: 'Mark as draft' }).click()
  await sheet.getByLabel('Discussed on').fill('')
  await sheet.getByRole('button', { name: 'Mark as discussed' }).click()
  await expect(sheet.getByRole('alert')).toContainText('Pick the date it was discussed')
  expect((await admin(page)).reviewPacks[0].state).toBe('draft')
  await sheet.getByLabel('Discussed on').fill('2026-12-11')
  await sheet.getByRole('button', { name: 'Mark as discussed' }).click()
  expect((await admin(page)).reviewPacks[0]).toMatchObject({ state: 'discussed', discussedISO: '2026-12-11' })
  // Steps answer the arrow keys; Check & share without a review says so and points back to People.
  await sheet.getByRole('tab', { name: 'Content' }).focus()
  await page.keyboard.press('ArrowRight')
  await expect(sheet.getByRole('tab', { name: 'People' })).toHaveAttribute('aria-selected', 'true')
  await expect(sheet.getByRole('tab', { name: 'People' })).toBeFocused()
  await page.keyboard.press('ArrowRight')
  await expect(sheet.getByRole('tabpanel', { name: 'Share step' })).toContainText('choose people first')
  // A pack shared then edited shows "Changes not shared" beside the learner's own state.
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('timetable.admin.v1.fx')!)
    raw.reviewPacks[0].sharing = { revision: 1, sharedAt: 1, mentorIds: ['mt0123456789ab'], attachmentUids: [], textHash: 'stale' }
    localStorage.setItem('timetable.admin.v1.fx', JSON.stringify(raw))
  })
  await page.reload()
  await expect(sheet.locator('[data-sharing-state]')).toHaveText('Changes not shared (v1 sent)')
  await expect(sheet.getByLabel('Pack states')).toContainText('Discussed')
  // 320px: no sideways scroll and the pack list is still reachable above the detail.
  await page.setViewportSize({ width: 320, height: 700 })
  await expect(sheet.getByRole('button', { name: /Progress review 1/ })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0)
})

test('U03: one toolbar row with Filters count + Clear + Today; the school-day card names school, hours and source and offers the journeys', async ({ page }) => {
  await seed(page, base(), { filters: { dateRange: 'all', subjects: ['Maths'], tutors: [], rooms: [], showSelfStudy: true, showOptional: true, showKeyDates: true } })
  await page.goto('./#/schedule')
  await expect(page.getByRole('heading', { level: 1, name: 'Schedule' })).toBeVisible()
  const bar = page.locator('.schedule-toolbar .filterbar')
  // Every control's vertical centre sits on one row (heights differ slightly between the segmented control and the buttons).
  const centres = await bar.locator('> *').evaluateAll((els) => els.map((el) => { const r = el.getBoundingClientRect(); return r.top + r.height / 2 }))
  expect(centres.length).toBeGreaterThanOrEqual(4)
  expect(Math.max(...centres) - Math.min(...centres)).toBeLessThan(12)
  await expect(page.getByRole('button', { name: /^Filters, 1 active/ })).toBeVisible()
  // Today sits on the week navigator (the date row), beside the arrows.
  await expect(page.locator('.week-nav').getByRole('button', { name: 'Today' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Search' })).toBeVisible()
  await bar.getByRole('button', { name: 'Clear filters' }).click()
  await expect(bar.getByRole('button', { name: 'Clear filters' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Filters', exact: true })).toBeVisible()
  // The school-day card: code, school, the placement's own hours with their source, and both journeys.
  const card = page.locator('.school-day-card')
  await expect(card).toContainText('SE1 · School day')
  await expect(card).toContainText('Riverside Primary')
  await expect(card).toContainText('Working day 08:15–15:45 (this placement)')
  await expect(card).toContainText('timetable row 08:30–15:30')
  await expect(card).toContainText('from your placement setup')
  await expect(card.getByRole('button', { name: 'To school' })).toBeVisible()
  await card.getByRole('button', { name: 'Back home' }).click()
  await expect(page).toHaveURL(/#\/placement\/pl-se1\/journey\/back$/)
  await page.goBack()
  await page.locator('.placement-day').click()
  await expect(page.getByLabel('Placement details')).toContainText('Riverside Primary')
  // Plan study time is a secondary weekly action, not another primary.
  await page.goto('./#/schedule')
  await expect(page.getByRole('button', { name: 'Plan study time this week' })).toHaveClass(/travel-link/)
  // Nothing disappears at 320px.
  await page.setViewportSize({ width: 320, height: 700 })
  await expect(page.locator('.week-nav').getByRole('button', { name: 'Today' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'More' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Filters', exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0)
})

test('U04 + U05: labelled forms and delete controls, arrow-key tabs, record header with draft state, deep links that survive refresh, Back to the caller', async ({ page }) => {
  await seed(page)
  // Deep link to one record: refresh keeps it; the header names type, placement, date and draft state.
  await page.goto('./#/pgce/records/lessons/l1')
  const editor = page.getByRole('dialog', { name: 'Edit Lesson' })
  await expect(editor).toBeVisible()
  const head = editor.getByLabel('Record')
  await expect(head).toContainText('Lesson')
  await expect(head).toContainText('SE1 · Riverside Primary')
  await expect(head).toContainText('2026-09-14')
  await expect(head).toContainText('No unsaved changes')
  await editor.getByLabel('Subject').fill('Maths — number bonds (edited)')
  await expect(head).toContainText('Draft kept on this device')
  await page.reload()
  await expect(page.getByRole('dialog', { name: 'Edit Lesson' })).toBeVisible()
  await expect(page).toHaveURL(/#\/pgce\/records\/lessons\/l1$/)
  await page.getByRole('dialog', { name: 'Edit Lesson' }).getByRole('button', { name: 'Back' }).click()
  await expect(page.getByRole('dialog', { name: 'Edit Lesson' })).toHaveCount(0)
  // The records sheet underneath is still the deep-linked tab, with visibly labelled fields.
  const sheet = page.getByRole('dialog', { name: 'My PGCE file' })
  await expect(sheet.getByRole('tab', { name: 'Lessons' }).or(sheet.getByRole('button', { name: 'Lessons', exact: true }))).toHaveAttribute('aria-pressed', 'true')
  await expect(sheet.getByLabel('Subject', { exact: true })).toBeVisible()
  await expect(sheet.getByLabel('Evaluation')).toBeVisible()
  // Delete is a labelled text control beside Edit, asks first, and can be undone.
  const row = sheet.getByRole('listitem').filter({ hasText: 'Phonics' })
  await expect(row.getByRole('button', { name: 'Delete lesson' })).toHaveText('Delete')
  await row.getByRole('button', { name: 'Delete lesson' }).click()
  await expect(row.getByRole('group', { name: 'Confirm deletion' })).toContainText('Delete the lesson “Phonics”')
  await row.getByRole('group', { name: 'Confirm deletion' }).getByRole('button', { name: 'Delete lesson' }).click()
  expect((await admin(page)).lessons.map((l: { id: string }) => l.id)).toEqual(['l1'])
  await sheet.locator('.status-message').getByRole('button', { name: 'Undo' }).click()
  expect((await admin(page)).lessons.map((l: { id: string }) => l.id).sort()).toEqual(['l0', 'l1'])
  await sheet.getByRole('button', { name: 'Close' }).first().click()
  await expect(page).toHaveURL(/#\/pgce$/)
  // A lesson deep link restores the workbench; its stage tabs answer the arrow keys.
  await page.goto('./#/pgce/lesson/l0')
  const wb = page.getByRole('dialog', { name: /Lesson workbench/ })
  await expect(wb).toBeVisible()
  await wb.getByRole('tab', { name: 'Plan' }).focus()
  await page.keyboard.press('End')
  await expect(wb.getByRole('tab', { name: 'Review' })).toHaveAttribute('aria-selected', 'true')
  await page.reload()
  await expect(page.getByRole('dialog', { name: /Lesson workbench/ })).toBeVisible()
  // Reduced motion: marking a task done still opens Completed and highlights the row (no animated scroll needed).
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('timetable.admin.v1.fx')!)
    raw.tasks = [{ id: 't1', title: 'Reading log', dueISO: '2026-09-20', status: 'todo', at: 1 }]
    localStorage.setItem('timetable.admin.v1.fx', JSON.stringify(raw))
  })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('./#/tasks')
  await page.reload()
  await page.getByRole('combobox', { name: 'Status for Reading log' }).selectOption('done')
  await expect(page.locator('.completed-tasks')).toHaveAttribute('open', '')
  await expect(page.locator('.task-card-just-completed')).toBeVisible()
})
