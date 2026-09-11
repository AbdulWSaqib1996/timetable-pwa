import { expect, test } from './fixtures'
import type { Page } from '@playwright/test'

/**
 * R3 regressions (Pass 52): key-date reminder relocation (TT-21), page width
 * contracts (§5), mobile Settings reach + dynamic nav + skip link + heading
 * focus (TT-19), Tasks/PGCE hierarchy (TT-20), the List view and local
 * Settings search. Synthetic profiles only; every network host is blocked.
 */

type ProfileSeed = { id: string; name: string; settings: Record<string, unknown> }

const CONNECTED = {
  demo: false,
  sheetId: 'FIXTURESHEET',
  gid: null,
  specialismsChosen: true,
  checklistDismissed: true,
  usagePing: false,
  keyDatesUrl: 'https://docs.google.com/spreadsheets/d/FIXTURESHEET/edit#gid=5',
  keyDatesSheetId: 'FIXTURESHEET',
  keyDatesGid: '5',
  keyDateReminderDays: [7, 1],
  reminderOffsets: [15],
}

async function seed(page: Page, profiles: ProfileSeed[], opts: { width?: number; permission?: string } = {}) {
  await page.clock.install({ time: new Date('2026-09-07T07:05:00Z') })
  await page.addInitScript(
    ({ profiles, permission }) => {
      localStorage.setItem('timetable.whatsnew.v1', '99')
      // Count permission prompts: navigation alone must never ask.
      const w = window as unknown as { permissionRequests: number }
      w.permissionRequests = 0
      Object.defineProperty(window, 'Notification', {
        value: class {
          static permission = permission
          static requestPermission() {
            w.permissionRequests += 1
            return Promise.resolve('granted')
          }
        },
        configurable: true,
      })
      if (localStorage.getItem('timetable.store.v2')) return
      localStorage.setItem('timetable.store.v2', JSON.stringify({ activeId: profiles[0].id, profiles }))
    },
    { profiles, permission: opts.permission ?? 'granted' }
  )
  await page.setViewportSize({ width: opts.width ?? 390, height: 900 })
}

const settingsOf = (page: Page, id: string) =>
  page.evaluate((pid) => {
    const store = JSON.parse(localStorage.getItem('timetable.store.v2')!)
    return store.profiles.find((p: { id: string }) => p.id === pid).settings
  }, id)

const chip = (page: Page, label: string) => page.getByRole('group', { name: 'Days before each key date' }).getByRole('button', { name: label })

test('TT-21: reminder timing lives in Reminders only; My timetable keeps the source and a link that focuses the section', async ({ page }) => {
  await seed(page, [{ id: 'kd', name: 'Key-date profile', settings: CONNECTED }])
  await page.goto('./#/settings/timetable')
  // Source controls stay; the editable chips are gone from this page.
  await expect(page.getByPlaceholder('https://docs.google.com/spreadsheets/d/…#gid=…').first()).toHaveValue(CONNECTED.keyDatesUrl)
  await expect(page.getByText('Key dates connected — they refresh with the timetable.')).toBeVisible()
  await expect(page.getByRole('button', { name: '7 days before' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Configure key-date reminders →' }).click()
  await expect(page).toHaveURL(/#\/settings\/reminders$/)
  await expect(page.getByRole('heading', { name: 'Key-date reminders' })).toBeVisible()
  await expect(page.locator('#key-date-reminders-heading')).toBeFocused()
  // Exactly one editable group, with the seeded values reflected.
  await expect(page.getByRole('group', { name: 'Days before each key date' })).toHaveCount(1)
  await expect(chip(page, '7 days before')).toHaveAttribute('aria-pressed', 'true')
  await expect(chip(page, '3 days before')).toHaveAttribute('aria-pressed', 'false')
  await expect(chip(page, '1 day before')).toHaveAttribute('aria-pressed', 'true')
  // Navigating between the pages and reloading changes nothing.
  await page.goto('./#/settings/timetable')
  await page.goto('./#/settings/reminders')
  await page.reload()
  expect((await settingsOf(page, 'kd')).keyDateReminderDays).toEqual([7, 1])
  await expect(chip(page, '7 days before')).toHaveAttribute('aria-pressed', 'true')
  expect(await page.evaluate(() => (window as unknown as { permissionRequests: number }).permissionRequests)).toBe(0)
})

test('TT-21: toggling uses the existing settings path — other offsets untouched, no prompt from navigation', async ({ page }) => {
  await seed(page, [{ id: 'kd', name: 'Key-date profile', settings: CONNECTED }], { permission: 'default' })
  await page.goto('./#/settings/timetable')
  await page.getByRole('button', { name: 'Configure key-date reminders →' }).click()
  await expect(page.getByRole('heading', { name: 'Key-date reminders' })).toBeVisible()
  expect(await page.evaluate(() => (window as unknown as { permissionRequests: number }).permissionRequests)).toBe(0)
  await chip(page, '3 days before').click()
  await expect(chip(page, '3 days before')).toHaveAttribute('aria-pressed', 'true')
  let s = await settingsOf(page, 'kd')
  expect(s.keyDateReminderDays).toEqual([1, 3, 7])
  expect(s.reminderOffsets).toEqual([15])
  for (const label of ['7 days before', '3 days before', '1 day before']) await chip(page, label).click()
  await expect(page.getByText('Key-date reminders are off.')).toBeVisible()
  s = await settingsOf(page, 'kd')
  expect(s.keyDateReminderDays).toEqual([])
  expect(s.reminderOffsets).toEqual([15])
})

test('TT-21: each profile shows its own choices; no source → explanation and a working Connect link', async ({ page }) => {
  await seed(page, [
    { id: 'a', name: 'Profile A', settings: CONNECTED },
    { id: 'b', name: 'Profile B', settings: { ...CONNECTED, keyDateReminderDays: [3] } },
    { id: 'c', name: 'Profile C', settings: { ...CONNECTED, keyDatesUrl: undefined, keyDatesSheetId: undefined, keyDatesGid: undefined } },
  ])
  await page.goto('./#/settings/reminders')
  await expect(chip(page, '7 days before')).toHaveAttribute('aria-pressed', 'true')
  await page.goto('./#/settings/timetable')
  await page.getByRole('button', { name: 'Profile B', exact: true }).click()
  await page.goto('./#/settings/reminders')
  await expect(chip(page, '3 days before')).toHaveAttribute('aria-pressed', 'true')
  await expect(chip(page, '7 days before')).toHaveAttribute('aria-pressed', 'false')
  expect((await settingsOf(page, 'a')).keyDateReminderDays).toEqual([7, 1])
  // Profile C has no key-dates source: the topic is explained, not hidden.
  await page.goto('./#/settings/timetable')
  await page.getByRole('button', { name: 'Profile C', exact: true }).click()
  await page.goto('./#/settings/reminders')
  await expect(page.getByText(/need a connected submissions\/key-dates tab/)).toBeVisible()
  await expect(page.getByRole('group', { name: 'Days before each key date' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Connect key dates →' }).click()
  await expect(page).toHaveURL(/#\/settings\/timetable$/)
  await expect(page.getByRole('heading', { name: 'Key dates', exact: true })).toBeFocused()
  await expect(page.getByPlaceholder('https://docs.google.com/spreadsheets/d/…#gid=…').first()).toBeEditable()
})

test('TT-21: keyboard reach at 320px and desktop — the link is a real button and focus lands on the heading', async ({ page }) => {
  for (const width of [320, 1440]) {
    await page.close().catch(() => {})
    page = await page.context().newPage()
    await seed(page, [{ id: 'kd', name: 'Key-date profile', settings: CONNECTED }], { width })
    await page.goto('./#/settings/timetable')
    const link = page.getByRole('button', { name: 'Configure key-date reminders →' })
    await link.focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('heading', { name: 'Key-date reminders' })).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(chip(page, '7 days before')).toBeFocused()
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow, `no horizontal overflow at ${width}`).toBeLessThanOrEqual(1)
  }
})

// ---------------------------------------------------------------------------
// §5 widths, TT-19, TT-20, List view, Settings search — demo profile seeds.

const DEMO = { demo: true, sheetId: '', gid: null, specialismsChosen: true, checklistDismissed: true, usagePing: false }

const THREE_DESTINATION_COURSE = {
  configId: 'nyu-teaching-residency',
  version: 1,
  name: 'NYU Teaching Residency',
  timezone: 'America/New_York',
  terminology: { specialism: 'Concentration', group: 'Cohort' },
  campus: { label: 'NYU Steinhardt', lat: 40.7295, lng: -73.9965, searchSuffix: 'NYU New York' },
  buildings: [{ name: 'Pless Hall', keywords: ['pless'], lat: 40.7308, lng: -73.9946 }],
  features: { placement: true, pgceFile: false },
}

const TASK_SEED = {
  ...DEMO,
  customKeyDates: [
    { id: 'late', title: 'Overdue essay', dateISO: '2026-09-05' },
    { id: 'now', title: 'Lesson plan due today', dateISO: '2026-09-07', start: '17:00' },
    { id: 'next', title: 'Upcoming essay', dateISO: '2026-09-10' },
    { id: 'done', title: 'Submitted reading log', dateISO: '2026-09-06' },
  ],
}

async function seedAdmin(page: Page, id: string, admin: Record<string, unknown>) {
  await page.addInitScript(
    ({ id, admin }) => {
      if (!localStorage.getItem(`timetable.admin.v1.${id}`)) localStorage.setItem(`timetable.admin.v1.${id}`, JSON.stringify(admin))
    },
    { id, admin }
  )
}

const overflowOf = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
const widthOf = (page: Page, sel: string) => page.locator(sel).first().evaluate((el) => el.getBoundingClientRect().width)

test('TT-19: Settings is one action away from every primary destination at 320px', async ({ page }) => {
  await seed(page, [{ id: 'd', name: 'Demo learner', settings: DEMO }], { width: 320 })
  for (const route of ['today', 'schedule', 'tasks', 'pgce']) {
    await page.goto(`./#/${route}`)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await expect(page).toHaveURL(/#\/settings$/)
    expect(await overflowOf(page), `${route}@320`).toBeLessThanOrEqual(1)
  }
})

test('TT-19: a three-destination course divides the nav evenly; skip link and route heading focus work', async ({ page }) => {
  await seed(page, [{ id: 'd', name: 'A learner with a deliberately long timetable name', settings: { ...DEMO, courseConfig: THREE_DESTINATION_COURSE } }])
  await page.goto('./#/today')
  const nav = page.getByRole('navigation', { name: 'Main' })
  await expect(nav.getByRole('button')).toHaveCount(3)
  const columns = await nav.evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length)
  expect(columns).toBe(3)
  const widths = await nav.getByRole('button').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().width))
  expect(Math.max(...widths) - Math.min(...widths)).toBeLessThan(2)
  // Skip link: first Tab stop, focuses the main landmark without touching the hash.
  await page.keyboard.press('Tab')
  await expect(page.locator('.skip-link')).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.locator('#main-content')).toBeFocused()
  await expect(page).toHaveURL(/#\/today$/)
  // A route change focuses the new page heading; the live region carries its name.
  await nav.getByRole('button', { name: 'Tasks' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Tasks' })).toBeFocused()
  await expect(page.getByRole('status').filter({ hasText: /^Tasks$/ })).toHaveCount(1)
  // The active destination keeps page semantics.
  await expect(nav.getByRole('button', { name: 'Tasks' })).toHaveAttribute('aria-current', 'page')
})

test('§5: page width contracts at 1440px and no overflow from 320 to 1920', async ({ page }) => {
  test.setTimeout(120_000)
  await seed(page, [{ id: 'd', name: 'Demo learner', settings: TASK_SEED }], { width: 1440 })
  await page.goto('./#/tasks')
  expect(await widthOf(page, '.page-tasks')).toBeLessThanOrEqual(960)
  expect(await widthOf(page, '.page-tasks')).toBeGreaterThan(900)
  await page.goto('./#/pgce')
  expect(await widthOf(page, '.page-pgce')).toBeLessThanOrEqual(960)
  await page.goto('./#/settings')
  expect(await widthOf(page, '.page-settings')).toBeLessThanOrEqual(720)
  await page.goto('./#/today')
  expect(await widthOf(page, '.page-today')).toBeLessThanOrEqual(720)
  await page.goto('./#/schedule')
  expect(await widthOf(page, '.page-schedule')).toBeGreaterThan(1100)
  await page.locator('.week-event').first().click()
  await page.getByRole('button', { name: /Open full details|Full details/ }).click().catch(() => {})
  for (const width of [320, 768, 1024, 1920]) {
    await page.setViewportSize({ width, height: 900 })
    for (const route of ['today', 'schedule', 'tasks', 'pgce', 'settings']) {
      await page.goto(`./#/${route}`)
      await page.waitForTimeout(100)
      expect(await overflowOf(page), `${route}@${width}`).toBeLessThanOrEqual(1)
    }
  }
})

test('TT-20: tasks group Overdue / Today / Upcoming / Completed with explicit status, search and a link to the owning meeting', async ({ page }) => {
  await seed(page, [{ id: 'd', name: 'Demo learner', settings: TASK_SEED }])
  await seedAdmin(page, 'd', {
    reflections: [], targets: [], observations: [], lessons: [], audits: [], tasks: [], exceptions: [], plans: [], commitments: [],
    meetings: [{ id: 'm1', dateISO: '2026-09-04', discussed: 'Targets', at: 1, actions: [{ id: 'a1', text: 'Read behaviour policy', done: false }] }],
  })
  await page.addInitScript(() => {
    if (!localStorage.getItem('timetable.meta.v2.d')) localStorage.setItem('timetable.meta.v2.d', JSON.stringify({ '2026-09-06||submitted reading log': { status: 'done' } }))
  })
  await page.goto('./#/tasks')
  await expect(page.getByText('3 outstanding')).toBeVisible()
  await expect(page.getByText('1 completed')).toBeVisible()
  await expect(page.getByRole('region', { name: 'Overdue tasks' })).toContainText('Overdue essay')
  await expect(page.getByRole('region', { name: 'Due today' })).toContainText('Lesson plan due today')
  await expect(page.getByRole('region', { name: 'Upcoming tasks' })).toContainText('Upcoming essay')
  await expect(page.getByRole('region', { name: 'Upcoming tasks' })).not.toContainText('Lesson plan due today')
  // Explicit, named status control — no hidden cycle.
  await expect(page.getByRole('combobox', { name: 'Status for Overdue essay' })).toBeVisible()
  // Mentor action: named completion control plus a way back to its meeting.
  await expect(page.getByRole('checkbox', { name: 'Mark “Read behaviour policy” complete' })).toBeVisible()
  await page.getByRole('button', { name: 'Open meeting' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.keyboard.press('Escape')
  // Local search narrows every group, including completed records.
  await page.getByRole('searchbox', { name: 'Search tasks' }).fill('reading log')
  await expect(page.getByRole('region', { name: 'Overdue tasks' })).toHaveCount(0)
  await expect(page.locator('.completed-tasks')).toContainText('Submitted reading log')
  await page.getByRole('searchbox', { name: 'Search tasks' }).fill('nothing-here')
  await expect(page.getByText('No tasks match “nothing-here”.')).toBeVisible()
})

test('TT-20: PGCE shows four section cards, one dominant action each, record types behind an accessible menu', async ({ page }) => {
  await seed(page, [{ id: 'd', name: 'Demo learner', settings: DEMO }])
  await page.goto('./#/pgce')
  for (const name of ['Placement', 'Evidence & reflections', 'Development', 'Documents']) {
    await expect(page.getByRole('heading', { level: 2, name })).toBeVisible()
  }
  // G1a: five cards — Placements (one primary per SE card inside it), Programme roadmap, and the original three.
  const cards = page.locator('.pgce-section')
  await expect(cards).toHaveCount(5)
  for (let i = 0; i < 5; i++) {
    const primaries = await cards.nth(i).locator('.btn-primary').count()
    const placementCards = await cards.nth(i).locator('.placement-card').count()
    expect(primaries === 1 || primaries === placementCards, `card ${i}: ${primaries} primaries`).toBe(true)
  }
  // V4: destination-named links replaced the four vague "View all" controls.
  await expect(page.getByRole('button', { name: /View all/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'All development records →' })).toBeVisible()
  // Every record type stays one tap away, now inside Development's menu.
  const trigger = page.getByRole('button', { name: /Add or open a record/ })
  await trigger.click()
  const menu = page.getByRole('menu', { name: 'Add or open a record' })
  // G1b added Practice focus and Mentor preparation; G2 added Subject knowledge, Academic work and Workload & support.
  await expect(menu.getByRole('menuitem')).toHaveText([/^Targets/, /^Mentor meetings/, /^Observations/, /^Lessons/, /^Audits/, /^Practice focus/, /^Mentor preparation/, /^Subject knowledge/, /^Academic work/, /^Workload/, /^Reviews & handover/])
  await expect(menu.getByRole('menuitem').first()).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(menu.getByRole('menuitem').nth(1)).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)
  await expect(trigger).toBeFocused()
  await trigger.click()
  await menu.getByRole('menuitem', { name: /^Targets/ }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByRole('dialog')).toContainText(/Targets|Add target/)
  // Legacy accessible names still reachable (phase-five relies on them).
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: 'Evidence journal' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Print binder & exports' })).toBeVisible()
})

test('List view shares the schedule filters and date anchor and is keyboard-operable', async ({ page }) => {
  await seed(page, [{ id: 'd', name: 'Demo learner', settings: DEMO }])
  await page.goto('./#/schedule')
  await page.getByRole('tab', { name: 'List' }).click()
  const list = page.getByRole('region', { name: 'List view' })
  await expect(list).toBeVisible()
  await expect(list.getByText(/Every day from Monday 7 Sept onward, with your display filters applied/)).toBeVisible()
  await expect(list.locator('.agenda .session-card').first()).toBeVisible()
  // The strip moves the shared anchor; the note follows it.
  await list.getByRole('option', { name: 'Wednesday 9 September' }).click()
  await expect(list.getByText(/Every day from Wednesday 9 Sept onward/)).toBeVisible()
  // A record is a real button that opens the same detail as Week/Month.
  const first = list.locator('.agenda .session-card').first()
  await first.focus()
  await page.keyboard.press('Enter')
  await expect(page.locator('.detail-page')).toBeVisible()
  // The choice persists like Week/Month, and works on desktop too.
  await page.goto('./#/schedule')
  await expect(page.getByRole('tab', { name: 'List' })).toHaveAttribute('aria-selected', 'true')
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.reload()
  await expect(page.getByRole('region', { name: 'List view' })).toBeVisible()
  expect(await overflowOf(page)).toBeLessThanOrEqual(1)
})

test('Settings search: synonyms resolve and a result opens the real setting with heading focus', async ({ page }) => {
  await seed(page, [
    { id: 'a', name: 'Profile A', settings: DEMO },
    { id: 'b', name: 'Profile B', settings: DEMO },
  ])
  await page.goto('./#/settings')
  const search = page.getByRole('searchbox', { name: 'Search settings' })
  const results = page.getByRole('list', { name: 'Search results' })
  const expectResult = async (query: string, title: string) => {
    await search.fill(query)
    await expect(results.getByRole('button', { name: new RegExp(title) })).toBeVisible()
  }
  await expectResult('address', 'Home address')
  await expectResult('home', 'Home address')
  await expectResult('backup', 'Backup')
  await expectResult('export', 'Backup')
  await expectResult('device', 'Sync between devices')
  await expectResult('notifications', 'Session reminders')
  await expectResult('reminder', 'Key-date reminders')
  await search.fill('zzzz')
  await expect(page.getByText(/Nothing matches “zzzz”/)).toBeVisible()
  await search.fill('address')
  await results.getByRole('button', { name: /Home address/ }).click()
  await expect(page).toHaveURL(/#\/settings\/travel$/)
  await expect(page.locator('#home-address')).toBeFocused()
  await expect(page.getByLabel('Home address')).toBeVisible()
  // Profile context on the index: a predictable switcher, not another tab.
  await page.goto('./#/settings')
  await page.getByRole('button', { name: 'Switch timetable' }).click()
  await expect(page).toHaveURL(/#\/settings\/timetable$/)
  await expect(page.getByRole('heading', { name: 'Timetables' })).toBeFocused()
})
