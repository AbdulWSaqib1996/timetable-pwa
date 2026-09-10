import { expect, test } from './fixtures'
import type { Page } from '@playwright/test'

/**
 * V2 (Pass 59) — daily-use screens from the visual audit: the Today state
 * contract, the desktop overlap group, task cards at 320px, the session
 * detail section order and the keyboard-operable week strip. Every check is
 * against real behaviour with synthetic data; nothing here is a snapshot.
 */

test.use({ timezoneId: 'Europe/London' })

const DEMO = { demo: true, sheetId: '', gid: null, specialismsChosen: true, checklistDismissed: true, usagePing: false, attendancePrompts: false }
const EMPTY_ADMIN = { reflections: [], targets: [], observations: [], lessons: [], audits: [], exceptions: [], plans: [], commitments: [], meetings: [], tasks: [] }

async function seed(page: Page, opts: { clock?: string; width?: number; admin?: Record<string, unknown>; settings?: Record<string, unknown> } = {}) {
  await page.clock.install({ time: new Date(opts.clock ?? '2026-09-07T06:30:00Z') })
  await page.addInitScript(
    ({ admin, settings }) => {
      localStorage.setItem('timetable.whatsnew.v1', '99')
      if (localStorage.getItem('timetable.store.v2')) return
      localStorage.setItem('timetable.store.v2', JSON.stringify({ activeId: 'd', profiles: [{ id: 'd', name: 'Demo learner', settings }] }))
      localStorage.setItem('timetable.admin.v1.d', JSON.stringify(admin))
    },
    { admin: opts.admin ?? EMPTY_ADMIN, settings: { ...DEMO, ...(opts.settings ?? {}) } }
  )
  await page.setViewportSize({ width: opts.width ?? 390, height: 844 })
}

const noHorizontalOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)

test('Today state contract: before the first session, during one, overlapping, after the last and an empty day each show a next action', async ({ page }) => {
  // Before the first session (07:30 London): Up next hero with one-tap details and Directions.
  await seed(page, { clock: '2026-09-07T06:30:00Z' })
  await page.goto('./#/today')
  const hero = page.locator('.today-hero')
  await expect(hero.locator('.today-hero-label')).toContainText('Up next')
  await expect(hero.getByRole('button', { name: 'Open session' })).toBeVisible()
  await expect(hero.getByRole('link', { name: /Directions/ })).toBeVisible()
  await expect(hero.locator('.today-fact')).toHaveCount(2) // time and place, each labelled by an icon
  await expect(hero.locator('.badge-kind')).toHaveText('Course session')
  const rest = page.getByRole('region', { name: 'Rest of today' })
  await expect(rest.locator('.today-row')).toHaveCount(2)
  await expect(rest.locator('.today-row-kind').first()).toContainText('Course session')
  await expect(rest.locator('.today-row-meta').first()).toContainText('Bedford Way')
  // The full title survives the heading/subtitle split: the hero name equals the detail title.
  const heroTitle = (await hero.locator('.today-hero-title').innerText()).replace(/\s+/g, ' ').trim()
  await hero.getByRole('button', { name: 'Open session' }).click()
  expect((await page.locator('.detail-title').innerText()).replace(/\s+/g, ' ').trim()).toBe(heroTitle)
  await page.locator('.page-back').click()
  // The FAB never covers the last actionable row.
  const fab = await page.locator('.fab-add').boundingBox()
  const lastRow = await page.locator('.today-row, .home-row, .keydate-strip').last().boundingBox()
  expect(fab && lastRow ? lastRow.y + lastRow.height <= fab.y || lastRow.x + lastRow.width <= fab.x : true).toBe(true)
  // A later clock: the same page shows the current session (09:30 London = 08:30Z).
  await page.clock.setFixedTime(new Date('2026-09-07T08:30:00Z'))
  await page.reload()
  await expect(page.locator('.today-hero-label')).toContainText('Now')
  // After the last session (17:00 London): an explicit finished state with next actions.
  await page.clock.setFixedTime(new Date('2026-09-07T16:00:00Z'))
  await page.reload()
  await expect(page.locator('.today-finished')).toContainText("That's the day done")
  await expect(page.locator('.today-finished').getByRole('button', { name: 'See the week' })).toBeVisible()
  await expect(page.getByRole('button', { name: /finished session/ })).toBeVisible()
  // Empty day: the demo timetable always fills today, so switch the profile to a
  // source that yields no sessions — the empty state names what comes next and offers actions.
  await page.evaluate(() => {
    const store = JSON.parse(localStorage.getItem('timetable.store.v2')!)
    store.profiles[0].settings = { sheetId: 'BROKENSHEETBROKENSHEETBROKEN', gid: null, sheetUrl: 'https://docs.google.com/x', specialismsChosen: true, checklistDismissed: true, usagePing: false }
    localStorage.setItem('timetable.store.v2', JSON.stringify(store))
  })
  await page.reload()
  await expect(page.getByText('Nothing on today')).toBeVisible()
  await expect(page.getByRole('button', { name: 'See the week' })).toBeVisible()
  await expect(noHorizontalOverflow(page)).resolves.toBe(true)
})

test('Today: an overlapping personal event appears under “Also now” as a readable card — never dropped', async ({ page }) => {
  await seed(page, {
    clock: '2026-09-07T08:45:00Z',
    admin: { ...EMPTY_ADMIN, commitments: [{ id: 'c1', title: 'Doctor', dateISO: '2026-09-07', startTime: '09:30', endTime: '10:30', kind: 'appointment', busy: true, at: 1 }] },
  })
  await page.goto('./#/today')
  const alsoNow = page.getByRole('region', { name: 'Also now' })
  await expect(alsoNow.locator('.today-row')).toHaveCount(1)
  await expect(alsoNow.locator('.today-row-kind')).toContainText('Personal')
  await expect(alsoNow).toContainText('ends 10:30')
})

test('V-09: unreadable parallel lanes become one exact-count group whose dialog lists every record; keyboard reaches it', async ({ page }) => {
  await seed(page, {
    width: 1280,
    admin: {
      ...EMPTY_ADMIN,
      commitments: [
        { id: 'a', title: 'Art elective', dateISO: '2026-09-08', startTime: '09:00', endTime: '11:00', kind: 'study', busy: true, at: 1 },
        { id: 'm', title: 'Music elective', dateISO: '2026-09-08', startTime: '09:00', endTime: '11:00', kind: 'study', busy: true, at: 1 },
        { id: 'c', title: 'Computing elective', dateISO: '2026-09-08', startTime: '09:00', endTime: '11:00', kind: 'study', busy: true, at: 1 },
      ],
    },
  })
  await page.goto('./#/schedule')
  const group = page.locator('.week-group', { hasText: 'Art elective' })
  await expect(group).toBeVisible()
  await expect(group).toContainText('09:00–11:00')
  await expect(group).toHaveAttribute('aria-label', /^\d+ parallel sessions, 09:00–11:00: .*Art elective.*Music elective.*Computing elective.*Opens a list$/)
  // Sessions the demo timetable already has at 09:00 on that day are counted too — the count is exact, never "3" by assumption.
  const declared = Number((await group.getAttribute('aria-label'))!.match(/^(\d+) /)![1])
  await group.focus()
  await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog', { name: /sessions on Tuesday 8 September/ })
  await expect(dialog).toBeVisible()
  await expect(dialog.locator('.session-card')).toHaveCount(declared)
  await expect(dialog.locator('.session-card', { hasText: 'Music elective' })).toContainText('Personal')
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  // Opening a record from the group selects exactly that record.
  await group.click()
  await dialog.locator('.session-card', { hasText: 'Music elective' }).click()
  await expect(page.locator('.session-panel')).toContainText('Music elective')
  await expect(page.locator('.session-panel')).not.toContainText('Art elective')
  // The colour key names the canonical subjects in the week, not guesses.
  await expect(page.getByRole('list', { name: 'Colour key' })).toBeVisible()
})

test('Tasks at 320px: a long title wraps on its own line, the overdue badge reads in words, the status control stays 44px', async ({ page }) => {
  await seed(page, {
    width: 320,
    admin: {
      ...EMPTY_ADMIN,
      tasks: [
        { id: 'late', title: 'Assessment essay draft with an unusually long title that must wrap cleanly', dueISO: '2026-09-05', status: 'todo', at: 1 },
        { id: 'soon', title: 'Reading log', dueISO: '2026-09-10', status: 'todo', at: 1 },
        { id: 'done', title: 'Submitted form', dueISO: '2026-09-01', status: 'done', completedISO: '2026-09-01', at: 1 },
      ],
    },
  })
  await page.goto('./#/tasks')
  const late = page.locator('.task-card', { hasText: 'Assessment essay draft' })
  await expect(late).toHaveClass(/task-card-overdue/)
  await expect(late.locator('.kd-chip')).toHaveText('2 days overdue')
  await expect(late.locator('.badge-source')).toHaveText('Your task')
  await expect(late.locator('.task-card-title')).toBeVisible()
  const titleBox = await late.locator('.task-card-title').boundingBox()
  expect(titleBox!.height).toBeGreaterThan(30) // wrapped, not clipped
  const select = late.getByRole('combobox', { name: /Status for/ })
  expect((await select.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  await expect(page.locator('.task-card', { hasText: 'Reading log' }).locator('.kd-chip')).toHaveText('Due in 3 days · Thursday')
  await expect(page.locator('.task-summary')).toContainText('1 overdue')
  await expect(page.locator('.completed-tasks summary')).toContainText('Completed (1)')
  await expect(noHorizontalOverflow(page)).resolves.toBe(true)
  // The status control still updates the single owner record once.
  await select.selectOption('done')
  await expect(page.locator('.completed-tasks summary')).toContainText('Completed (2)')
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('timetable.admin.v1.d')!).tasks.filter((t: { id: string }) => t.id === 'late'))
  expect(stored).toHaveLength(1)
  expect(stored[0].status).toBe('done')
})

test('Session detail: tabs before content, attendance as one grouped 44px choice with a pressed state, notes after attendance, travel one tap away', async ({ page }) => {
  await seed(page)
  await page.goto('./#/schedule')
  await page.locator('.day-list .session-card').first().click()
  await expect(page.locator('.detail-page')).toBeVisible()
  const tabs = page.getByRole('tablist', { name: 'Session detail sections' })
  await expect(tabs).toBeVisible()
  const group = page.getByRole('group', { name: 'Attendance' })
  const attended = group.getByRole('button', { name: 'Attended' })
  const absent = group.getByRole('button', { name: 'Absent' })
  expect((await attended.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  await expect(page.getByText('Not recorded', { exact: true })).toBeVisible()
  await attended.click()
  await expect(attended).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByText('Recorded as attended')).toBeVisible()
  await expect(page.getByText(/Last saved on this device/)).toBeVisible()
  await absent.click()
  await expect(absent).toHaveAttribute('aria-pressed', 'true')
  await expect(attended).toHaveAttribute('aria-pressed', 'false')
  await expect(page.getByRole('combobox', { name: 'Absence reason' })).toBeVisible()
  // Reading order = tab order: tabs → attendance → notes textarea → standards.
  const order = await page.evaluate(() => {
    const tabs = document.querySelector('[role=tablist]')!
    const attend = document.querySelector('.attendance-choice')!
    const note = document.querySelector('.note-input')!
    const before = (a: Element, b: Element) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
    return before(tabs, attend) && before(attend, note)
  })
  expect(order).toBe(true)
  await expect(page.getByRole('button', { name: 'Add photo' })).toHaveCount(0) // it is a labelled file control, not a button
  await expect(page.getByText('Add photo')).toBeVisible()
  await page.getByRole('tab', { name: 'Travel & map' }).click()
  await expect(page.locator('.detail-tabpanel[aria-label="Travel and map"]')).toBeVisible()
})

test('Week strip: the selected day is the tab stop; arrow keys move the shared date and the heading follows', async ({ page }) => {
  await seed(page)
  await page.goto('./#/schedule')
  const strip = page.getByRole('listbox', { name: /Pick a day/ })
  await expect(strip).toBeVisible()
  await expect(strip.getByRole('option', { selected: true })).toHaveAttribute('aria-label', /Monday 7 September, today/)
  await strip.getByRole('option', { selected: true }).focus()
  await page.keyboard.press('ArrowRight')
  await expect(page.locator('.day-list-heading h2')).toContainText('Tuesday 8')
  await expect(strip.getByRole('option', { selected: true })).toBeFocused()
  await page.keyboard.press('End')
  await expect(page.locator('.day-list-heading h2')).toContainText('Sunday 13')
  await expect(page.locator('.day-summary')).toBeVisible()
  await page.keyboard.press('ArrowRight') // crosses into the next week
  await expect(page.locator('.day-list-heading h2')).toContainText('Monday 14')
  await page.goto('./#/schedule')
  await expect(page.locator('.day-summary')).toContainText(/sessions · .* scheduled/)
})
