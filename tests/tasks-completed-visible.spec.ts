import { expect, test } from './fixtures'
import type { Page } from '@playwright/test'

/**
 * Owner report (13 Sep 2026): after marking a task complete the Completed
 * section was not where the eye was — a long scroll to a collapsed card.
 * Marking done now opens the section, scrolls it into view, highlights the
 * row and offers Undo; the section can still be collapsed by hand.
 */

test.use({ timezoneId: 'Europe/London' })

async function seed(page: Page) {
  await page.clock.install({ time: new Date('2026-09-14T06:05:00Z') })
  await page.addInitScript(() => {
    localStorage.setItem('timetable.whatsnew.v1', '99')
    if (localStorage.getItem('timetable.store.v2')) return
    localStorage.setItem('timetable.store.v2', JSON.stringify({ activeId: 'd', profiles: [{ id: 'd', name: 'Demo learner', settings: { demo: true, sheetId: '', gid: null, specialismsChosen: true, checklistDismissed: true, usagePing: false } }] }))
    const tasks = Array.from({ length: 12 }, (_, i) => ({ id: 't' + i, title: 'Task ' + i, dueISO: '2026-09-' + String(15 + i).padStart(2, '0'), status: 'todo', at: 1 }))
    localStorage.setItem('timetable.admin.v1.d', JSON.stringify({ reflections: [], targets: [], meetings: [], observations: [], lessons: [], audits: [], exceptions: [], plans: [], commitments: [], tasks }))
  })
  await page.setViewportSize({ width: 390, height: 844 })
}

test('marking a task done opens Completed, scrolls it into view with the row highlighted, and Put it back restores it', async ({ page }) => {
  await seed(page)
  await page.goto('./#/tasks')
  await expect(page.getByRole('heading', { level: 1, name: 'Tasks' })).toBeVisible()
  await expect(page.locator('details.completed-tasks')).toHaveCount(0)
  await page.getByRole('combobox', { name: 'Status for Task 2' }).selectOption('done')
  const details = page.locator('details.completed-tasks')
  await expect(details).toHaveAttribute('open', '')
  await expect(page.locator('.task-moved')).toContainText('“Task 2” moved to Completed below.')
  const row = details.locator('.task-card-just-completed')
  await expect(row).toContainText('Task 2')
  await expect.poll(async () => row.evaluate((el) => { const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= window.innerHeight })).toBe(true)
  // The completed row shows its completion and the section can be collapsed by hand.
  await expect(row).toContainText('Completed Mon, 14 Sept 2026')
  await details.locator('summary').click()
  await expect(details).not.toHaveAttribute('open', '')
  // Undo returns the task to the list and clears the notice.
  await page.getByRole('button', { name: 'Put it back' }).click()
  await expect(page.locator('.task-moved')).toHaveCount(0)
  await expect(page.locator('details.completed-tasks')).toHaveCount(0)
  await expect(page.getByRole('combobox', { name: 'Status for Task 2' })).toHaveValue('todo')
})
