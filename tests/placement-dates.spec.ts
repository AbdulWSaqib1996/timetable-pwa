import { expect, test } from './fixtures'

/**
 * Pass 93: a placement range written with weekday names ("SE3 continues
 * (Mon 12th April - Friday 2nd July 2027)", as on the Group 2 sheet) expands to
 * every school day in the span except bank holidays, and bank holidays are
 * labelled in the schedule. Synthetic rows copied from the sheet's titles.
 */
const rows = [
  ['Title', 'Day', 'Date', 'Start', 'End', 'Room', 'Groups'],
  ['SE3 Briefing and Q&A', 'Tuesday', '16/03/2027', '09:00', '11:30', 'Room 1', '2'],
  ['SE3 visit day', 'Tuesday', '23/03/2027', '09:00', '09:00', '', '2'],
  ['SE3 continues (Mon 12th April - Friday 2nd July 2027)', 'Monday', '12/04/2027', '00:00', '00:00', '', '2'],
  ['SE3: In placement school as usual', 'Wednesday', '05/05/2027', '09:00', '12:30', '', '2'],
  ['SE3 ends (Mon 12th April - Friday 2nd July 2027)', 'Friday', '02/07/2027', '09:00', '09:00', '', '2'],
  ['SE3 1-to-1 tutorials', 'Monday', '05/07/2027', '09:00', '16:00', '', '2'],
]
const gviz =
  'google.visualization.Query.setResponse(' +
  JSON.stringify({ status: 'ok', table: { cols: [], rows: rows.map((r) => ({ c: r.map((v) => ({ v })) })) } }) +
  ');'

test('SE3 written with weekday names spans 12 Apr – 2 Jul 2027 (58 school days), and bank holidays are labelled', async ({ page, context }) => {
  await context.route('**/docs.google.com/**', (route) => route.fulfill({ contentType: 'text/plain', body: gviz }))
  await page.clock.install({ time: new Date('2027-05-03T08:00:00Z') })
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('./')
  await page.getByRole('button', { name: 'Let’s get started' }).click()
  await page.getByPlaceholder(/spreadsheets/).fill('https://docs.google.com/spreadsheets/d/SYNTHETICSHEETID1234567890/edit#gid=0')
  await page.getByRole('button', { name: 'Connect timetable' }).click()
  await page.getByRole('button', { name: 'Continue' }).click()
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Skip for now' }).click()
  await page.getByRole('button', { name: 'Save this timetable' }).click()
  await expect(page.locator('.page-today')).toBeVisible()
  // Today is the early May bank holiday.
  await expect(page.locator('.page-today .badge-bank-holiday')).toHaveText('Early May bank holiday')

  // 60 weekdays in the span minus 3 May and 31 May; rows outside the span are not placement days.
  await page.goto('./#/placement')
  await expect(page.getByText('Planned 58 days', { exact: false })).toBeVisible()

  // Week of 3 May: labelled, and no placement day is created on the bank holiday.
  await page.goto('./#/schedule')
  await expect(page.locator('.week-bank-holiday')).toHaveText('Bank holiday')
  // Tue, Thu and Fri are generated; Wed already has its own sheet row; Mon is the bank holiday.
  await expect(page.locator('.week-event', { hasText: 'SE3 placement day' })).toHaveCount(3)
  await expect(page.locator('.week-event', { hasText: 'SE3: In placement school as usual' })).toHaveCount(1)
})
