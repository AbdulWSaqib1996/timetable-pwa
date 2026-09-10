import { expect, test } from './fixtures'
import type { Page } from '@playwright/test'

/**
 * Gap closure after the owner's check of V0–V4 (Pass 62): the Settings
 * sub-pages carry the same card/heading/state language as the restyled
 * pages, the session detail opens with an identity card, the travel copy
 * points at the control that follows it, and no learner screen or sheet
 * uses emoji as a control or a label (weather glyphs excepted).
 */

test.use({ timezoneId: 'Europe/London' })

const ADMIN = { reflections: [{ id: 'r1', weekISO: '2026-08-31', wentWell: 'x', challenges: 'y', focus: 'z', standards: [], at: 1 }], targets: [{ id: 't1', text: 'Questioning', standards: [], setISO: '2026-09-01', status: 'open', at: 1 }], observations: [], lessons: [], audits: [], exceptions: [], plans: [], commitments: [], meetings: [], tasks: [{ id: 'late', title: 'Essay', dueISO: '2026-09-05', status: 'todo', at: 1 }] }

async function seed(page: Page, width = 390) {
  await page.clock.install({ time: new Date('2026-09-07T07:05:00Z') })
  await page.addInitScript((ADMIN) => {
    localStorage.setItem('timetable.whatsnew.v1', '99')
    localStorage.setItem('timetable.store.v2', JSON.stringify({ activeId: 'd', profiles: [{ id: 'd', name: 'Demo learner', settings: { demo: true, sheetId: '', gid: null, specialismsChosen: true, checklistDismissed: true, usagePing: false, travelMode: 'transit', locationEnabled: false, homeLat: 51.55, homeLng: -0.1, homeAddress: '1 Example Street' } }] }))
    localStorage.setItem('timetable.admin.v1.d', JSON.stringify(ADMIN))
  }, ADMIN)
  await page.setViewportSize({ width, height: 844 })
}

const WEATHER = /[☀️🌤⛅🌥☁️🌧🌦🌨❄️⛈🌩🌫🌬🌂🚶🚌🚇🚆🚈🚊⛴🚲🚗]/u
async function emojiOnPage(page: Page) {
  return page.evaluate(() => {
    const re = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u
    const out: string[] = []
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    while (walker.nextNode()) {
      const t = (walker.currentNode.textContent || '').trim()
      if (t && re.test(t)) out.push(t.slice(0, 40))
    }
    return out
  })
}

test('Settings sub-pages: card sections with 18px headings, state beside the heading, collapsible privacy detail, no emoji', async ({ page }) => {
  await seed(page)
  for (const section of ['timetable', 'travel', 'calendars', 'appearance', 'help']) {
    await page.goto(`./#/settings/${section}`)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    const cards = page.locator('.settings-body > .filter-section')
    expect(await cards.count()).toBeGreaterThan(0)
    const bg = await cards.first().evaluate((el) => getComputedStyle(el).backgroundColor)
    expect(bg).not.toBe('rgba(0, 0, 0, 0)')
    const h3 = await cards.first().locator('h3').first().evaluate((el) => parseFloat(getComputedStyle(el).fontSize))
    expect(h3).toBeGreaterThanOrEqual(18)
    expect((await emojiOnPage(page)).filter((t) => !WEATHER.test(t))).toEqual([])
  }
  await page.goto('./#/settings/travel')
  await expect(page.locator('#travel-mode .notif-state').first()).toHaveText('location off · public transport')
  await expect(page.locator('#travel-mode').getByText('set', { exact: true })).toBeVisible()
  const more = page.locator('#travel-mode details.settings-more').first()
  await expect(more).not.toHaveAttribute('open', '')
  await more.locator('summary').click()
  await expect(more).toContainText('OpenStreetMap')
  await page.goto('./#/settings/appearance')
  await expect(page.locator('#theme .notif-state')).toHaveText('System')
  await page.goto('./#/settings/timetable')
  await expect(page.locator('#profiles .notif-state')).toHaveText('1 on this device')
  await expect(page.getByRole('button', { name: /Set up a study group/ }).locator('svg')).toHaveCount(1)
})

test('Session detail opens with an identity card (kind, date, time, place) and the travel copy points below', async ({ page }) => {
  await seed(page)
  await page.goto('./#/schedule')
  await page.locator('.day-list .session-card').first().click()
  const card = page.locator('.detail-identity')
  await expect(card).toBeVisible()
  await expect(card.locator('.badge-kind')).toHaveText('Course session')
  await expect(card.locator('.today-fact')).toHaveCount(3)
  await expect(card).toContainText('Monday, 7 September 2026')
  await expect(card).toContainText(/\d\d:\d\d–\d\d:\d\d/)
  await expect(card).toContainText(/Room /)
  // The identity card sits above the details list and the tabs sit above it.
  const tabsY = (await page.getByRole('tablist').boundingBox())!.y
  const cardY = (await card.boundingBox())!.y
  expect(tabsY).toBeLessThan(cardY)
  await expect(page.locator('.detail-list')).not.toContainText('Time')
  await page.getByRole('tab', { name: 'Travel & map' }).click()
  await expect(page.getByText(/choose a saved starting point below/)).toBeVisible()
  await expect(page.getByText(/origin above/)).toHaveCount(0)
})

test('No emoji controls or labels on any learner screen or sheet (weather glyphs excepted)', async ({ page }) => {
  test.setTimeout(120_000)
  await seed(page)
  const check = async (label: string) => {
    const found = (await emojiOnPage(page)).filter((t) => !WEATHER.test(t))
    expect(found, `${label}: ${JSON.stringify(found)}`).toEqual([])
  }
  const closeSheet = async () => {
    if ((await page.getByRole('dialog').count()) === 0) return
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)
    if ((await page.getByRole('dialog').count()) > 0) {
      const close = page.getByRole('dialog').first().getByRole('button', { name: /^(Close|Cancel|Later)$/ }).first()
      if (await close.count()) await close.click()
    }
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await page.waitForTimeout(300) // let any history change from the sheet settle before the next route
  }
  for (const route of ['today', 'schedule', 'tasks', 'pgce', 'find', 'home', 'placement', 'settings/data', 'settings/reminders']) {
    await page.goto(`./#/${route}`)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await check(route)
  }
  await page.goto('./#/schedule')
  await page.getByRole('tab', { name: 'Month' }).click()
  await check('month')
  await page.goto('./#/tasks')
  await page.getByRole('button', { name: 'Add task' }).click()
  await check('task editor')
  await expect(page.getByRole('button', { name: 'Done' })).toBeVisible()
  await closeSheet()
  await page.goto('./#/pgce')
  await page.getByRole('button', { name: 'Print binder & exports' }).click()
  await check('PGCE admin overview')
  await page.getByRole('dialog').getByRole('button', { name: 'Reflections', exact: true }).click()
  await check('reflections tab')
  await expect(page.getByText('Challenges:')).toBeVisible()
  await closeSheet()
  await page.getByRole('button', { name: 'Evidence journal' }).click()
  await check('evidence journal')
  await expect(page.locator('.journal-kind').first()).toBeVisible()
  await closeSheet()
  await page.getByRole('button', { name: 'Term stats & attendance' }).click()
  await check('term stats')
})

test('Filters sheet has no emoji labels', async ({ page }) => {
  await seed(page)
  await page.goto('./#/schedule')
  await page.getByRole('button', { name: /^Filters/ }).click()
  await expect(page.getByRole('dialog', { name: 'Filters' })).toBeVisible()
  const found = (await emojiOnPage(page)).filter((t) => !WEATHER.test(t))
  expect(found).toEqual([])
  await expect(page.getByRole('button', { name: 'View all key dates' })).toBeVisible()
})
