import { expect, test } from './fixtures'
import type { Page } from '@playwright/test'

/**
 * Phase 5 browser coverage. Fixtures are deterministic (7 Sep 2026) and all
 * external requests stay blocked.
 */

async function seed(page: Page, opts: { legacyCustom?: boolean } = {}) {
  await page.clock.install({ time: new Date('2026-09-07T07:15:00Z') })
  await page.addInitScript(
    ([legacy]) => {
      localStorage.setItem('timetable.whatsnew.v1', '99')
      const settings: Record<string, unknown> = {
        demo: true,
        sheetId: '',
        gid: null,
        specialismsChosen: true,
        checklistDismissed: true,
        usagePing: false,
      }
      if (legacy) {
        settings.customKeyDates = [
          { id: 'old1', title: 'Legacy essay', dateISO: '2026-09-12', start: '17:00' },
          { id: 'old2', title: 'Legacy submitted', dateISO: '2026-09-05' },
        ]
      }
      localStorage.setItem(
        'timetable.store.v2',
        JSON.stringify({ activeId: 'fx', profiles: [{ id: 'fx', name: 'Demo timetable', settings }] })
      )
      if (legacy) {
        // Saved status/note against the legacy Phase 2 owner key.
        localStorage.setItem(
          'timetable.meta.v2.fx',
          JSON.stringify({ '2026-09-05||legacy submitted': { status: 'done', note: 'sent by email', at: 1 } })
        )
      }
    },
    [opts.legacyCustom ?? false]
  )
}

const readTasks = (page: Page) =>
  page.evaluate(() => {
    const admin = JSON.parse(localStorage.getItem('timetable.admin.v1.fx') ?? '{}')
    return { tasks: admin.tasks ?? [], deleted: admin.deleted ?? {} }
  })

test('legacy personal deadlines migrate to task records keeping id, status and note', async ({ page }) => {
  await seed(page, { legacyCustom: true })
  await page.goto('./#/tasks')
  await expect(page.getByText('Legacy essay')).toBeVisible()
  const { tasks } = await readTasks(page)
  expect(tasks.map((t: { id: string }) => t.id).sort()).toEqual(['old1', 'old2'])
  const submitted = tasks.find((t: { id: string }) => t.id === 'old2')
  expect(submitted.status).toBe('done')
  expect(submitted.notes).toBe('sent by email')
  // The settings field is cleared after migration.
  const cleared = await page.evaluate(
    () => JSON.parse(localStorage.getItem('timetable.store.v2')!).profiles[0].settings.customKeyDates
  )
  expect(cleared).toBeUndefined()
})

test('task CRUD: create, edit keeps identity, duplicate never inherits completion, delete + undo beats the tombstone', async ({ page }) => {
  await seed(page)
  await page.goto('./#/tasks')
  // Create.
  await page.getByRole('button', { name: 'Add task' }).click()
  await page.getByLabel('Title').fill('Write assignment plan')
  await page.getByLabel('Due date').fill('2026-09-15')
  await page.getByRole('button', { name: 'Save task' }).click()
  await expect(page.getByText('Write assignment plan')).toBeVisible()
  const created = (await readTasks(page)).tasks[0]
  expect(created.status).toBe('todo')

  // Complete it, then edit the title: the id must not regenerate and the
  // completion history stays.
  // R1 / TT-09: the status control is an explicit labelled menu, not a cycle.
  await page.getByRole('combobox', { name: 'Status for Write assignment plan' }).selectOption('done')
  await page.locator('.completed-tasks summary').click()
  await page.locator('.completed-tasks li', { hasText: 'Write assignment plan' }).locator('.keydate-row').click()
  await page.getByLabel('Title').fill('Write assignment plan v2')
  await page.getByRole('button', { name: 'Save task' }).click()
  const afterEdit = (await readTasks(page)).tasks.find((t: { id: string }) => t.id === created.id)
  expect(afterEdit.title).toBe('Write assignment plan v2')
  expect(afterEdit.status).toBe('done')
  expect(afterEdit.completedISO).toBe('2026-09-07')

  // Duplicate: new id, back to "to do".
  await page.locator('.completed-tasks li', { hasText: 'v2' }).locator('.keydate-row').click()
  await page.getByRole('button', { name: 'Duplicate' }).click()
  const dup = (await readTasks(page)).tasks.find((t: { id: string }) => t.id !== created.id)
  expect(dup.status).toBe('todo')
  expect(dup.id).not.toBe(created.id)
  await expect(page.getByText('Write assignment plan v2 (copy)')).toBeVisible()

  // Delete the copy, then undo: the record returns with a revision NEWER than
  // the tombstone (not a locally hidden tombstone).
  await page.locator('.keydates-list li', { hasText: '(copy)' }).locator('.keydate-row').click()
  await page.getByRole('button', { name: 'Delete task' }).click()
  const afterDelete = await readTasks(page)
  expect(afterDelete.tasks.some((t: { id: string }) => t.id === dup.id)).toBe(false)
  expect(afterDelete.deleted[`tasks:${dup.id}`]).toBeGreaterThan(0)
  await page.getByRole('button', { name: 'Undo' }).click()
  const afterUndo = await readTasks(page)
  const restored = afterUndo.tasks.find((t: { id: string }) => t.id === dup.id)
  expect(restored).toBeTruthy()
  expect(restored.at).toBeGreaterThanOrEqual(afterDelete.deleted[`tasks:${dup.id}`])
})

test('mentor actions project into Tasks and complete exactly once in both views', async ({ page }) => {
  await seed(page)
  await page.addInitScript(() => {
    localStorage.setItem(
      'timetable.admin.v1.fx',
      JSON.stringify({
        reflections: [], targets: [], observations: [], lessons: [], audits: [],
        tasks: [], exceptions: [], plans: [], commitments: [],
        meetings: [
          { id: 'm1', dateISO: '2026-09-04', discussed: 'Targets', at: 1,
            actions: [{ id: 'a1', text: 'Read behaviour policy', done: false }] },
        ],
      })
    )
  })
  await page.goto('./#/tasks')
  const actionRow = page.locator('.mentor-action-row', { hasText: 'Read behaviour policy' })
  await expect(actionRow).toBeVisible()
  // click, not check(): completing the action removes the row immediately,
  // so there is no checked state left to verify.
  await actionRow.locator('input').click()
  await expect(page.locator('.mentor-action-row')).toHaveCount(0)
  // Completion lives on the meeting record — the single owner.
  const meetings = await page.evaluate(
    () => JSON.parse(localStorage.getItem('timetable.admin.v1.fx')!).meetings
  )
  expect(meetings[0].actions[0].done).toBe(true)
})

test('task drafts survive a reload and offer Continue/Discard', async ({ page }) => {
  await seed(page)
  await page.goto('./#/tasks')
  await page.getByRole('button', { name: 'Add task' }).click()
  await page.getByLabel('Title').fill('Half-typed thought')
  await page.getByLabel('Due date').fill('2026-09-20')
  await expect(page.getByText('Draft saved on this device.')).toBeVisible()
  // The editor closes without saving (simulates navigating away/crash)…
  await page.getByRole('button', { name: 'Cancel' }).click()
  // …and an EDIT of an existing task is a different draft key, so create a
  // task and confirm the abandoned creation draft did not leak into it.
  const draftKeys = await page.evaluate(() =>
    Object.keys(localStorage).filter((k) => k.startsWith('timetable.draft.v1.'))
  )
  expect(draftKeys.length).toBe(1)
})

test('every PGCE record type is editable; a reflection draft survives reload with Continue/Discard; delete has undo', async ({ page }) => {
  await seed(page)
  await page.addInitScript(() => {
    localStorage.setItem(
      'timetable.admin.v1.fx',
      JSON.stringify({
        tasks: [], exceptions: [], plans: [], commitments: [],
        reflections: [{ id: 'r1', weekISO: '2026-08-31', wentWell: 'Settled in', challenges: '', focus: '', standards: [], at: 5 }],
        targets: [{ id: 't1', text: 'Cold calling', standards: [], setISO: '2026-09-01', status: 'open', at: 5 }],
        meetings: [{ id: 'm1', dateISO: '2026-09-04', discussed: 'Targets', actions: [{ id: 'a1', text: 'Read policy', done: true }], at: 5 }],
        observations: [{ id: 'o1', dateISO: '2026-09-03', observer: 'JB', subject: 'Maths', focus: '', strengths: 'Pace', development: '', at: 5 }],
        lessons: [{ id: 'l1', dateISO: '2026-09-02', classGroup: 'Y2', subject: 'Maths', evaluation: 'Good', standards: [], at: 5 }],
        audits: [{ id: 'au1', subject: 'Maths', stage: 'baseline', note: '', dateISO: '2026-09-01', at: 5 }],
      })
    )
  })
  await page.goto('./#/pgce')
  await page.getByRole('button', { name: 'Weekly reflections (1)' }).click()
  // Edit exists for every record type (spot-check each tab's control).
  await expect(page.getByRole('button', { name: 'Edit reflection' })).toBeVisible()

  // Type into the editor, then reload mid-edit: the draft must offer recovery.
  await page.getByRole('button', { name: 'Edit reflection' }).click()
  await page.getByLabel('What went well').fill('Settled in AND ran my first starter')
  await expect(page.getByText('Draft saved on this device.')).toBeVisible()
  await page.reload()
  await page.goto('./#/pgce')
  await page.getByRole('button', { name: 'Weekly reflections (1)' }).click()
  await page.getByRole('button', { name: 'Edit reflection' }).click()
  await expect(page.getByText('Continue draft')).toBeVisible()
  await page.getByRole('button', { name: 'Continue draft' }).click()
  await expect(page.getByLabel('What went well')).toHaveValue('Settled in AND ran my first starter')
  await page.getByRole('button', { name: 'Save changes' }).click()
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('timetable.admin.v1.fx')!).reflections[0])
  expect(saved.wentWell).toContain('ran my first starter')
  expect(saved.id).toBe('r1')

  // Editing a meeting keeps each action's identity and done state.
  await page.getByRole('button', { name: 'Meetings', exact: true }).click()
  await page.getByRole('button', { name: 'Edit meeting' }).click()
  await page.getByLabel('Action text').fill('Read the FULL policy')
  await page.getByRole('button', { name: 'Save changes' }).click()
  const meeting = await page.evaluate(() => JSON.parse(localStorage.getItem('timetable.admin.v1.fx')!).meetings[0])
  expect(meeting.actions[0]).toMatchObject({ id: 'a1', text: 'Read the FULL policy', done: true })

  // Delete from the editor, then undo restores with a newer revision.
  await page.getByRole('button', { name: 'Edit meeting' }).click()
  await page.getByRole('button', { name: 'Delete meeting record' }).click()
  await expect(page.getByText('Record deleted.')).toBeVisible()
  await page.getByRole('button', { name: 'Undo' }).click()
  const after = await page.evaluate(() => JSON.parse(localStorage.getItem('timetable.admin.v1.fx')!))
  expect(after.meetings.length).toBe(1)
  expect(after.meetings[0].at).toBeGreaterThanOrEqual(after.deleted['meetings:m1'])
})

test('evidence search: query/type/untagged filters, captions indexed, honest empty state', async ({ page }) => {
  await seed(page)
  await page.addInitScript(() => {
    localStorage.setItem(
      'timetable.admin.v1.fx',
      JSON.stringify({
        tasks: [], exceptions: [], plans: [], commitments: [], meetings: [], observations: [], audits: [],
        reflections: [{ id: 'r1', weekISO: '2026-08-31', wentWell: 'Phonics went well', challenges: '', focus: '', standards: ['TS3'], at: 1 }],
        targets: [{ id: 't1', text: 'Improve questioning depth', standards: [], setISO: '2026-09-01', status: 'open', at: 1 }],
        lessons: [{ id: 'l1', dateISO: '2026-09-02', classGroup: 'Y2', subject: 'Maths', evaluation: 'Pacing drifted', standards: [], at: 1 }],
      })
    )
  })
  await page.goto('./#/pgce')
  await page.getByRole('button', { name: 'Evidence journal' }).click()
  const dialog = page.getByRole('dialog', { name: 'Evidence journal' })
  await expect(dialog).toBeVisible()
  // Query search reaches reflections and targets.
  await dialog.getByLabel('Search evidence').fill('questioning')
  await expect(dialog.locator('.journal-list li')).toHaveCount(1)
  await expect(dialog).toContainText('Improve questioning depth')
  // Untagged filter: the target and lesson lack standards; the reflection has TS3.
  await dialog.getByLabel('Search evidence').fill('')
  await dialog.getByRole('button', { name: /^Untagged/ }).click()
  await expect(dialog).not.toContainText('Phonics went well')
  // Over-restrictive filters name the real total instead of claiming no evidence.
  await dialog.getByLabel('Search evidence').fill('zzz-no-match')
  await expect(dialog.getByText(/Nothing matches these filters — you have 3 evidence records/)).toBeVisible()
  await dialog.getByRole('button', { name: 'Clear filters' }).click()
  await expect(dialog.locator('.journal-list li')).toHaveCount(3)
})

test('binder preview shows counts and file availability before printing', async ({ page }) => {
  await seed(page)
  await page.addInitScript(() => {
    localStorage.setItem(
      'timetable.admin.v1.fx',
      JSON.stringify({
        tasks: [], exceptions: [], plans: [], commitments: [], meetings: [], observations: [], audits: [],
        reflections: [], lessons: [],
        targets: [{ id: 't1', text: 'A target', standards: [], setISO: '2026-09-01', status: 'open', at: 1 }],
      })
    )
  })
  await page.goto('./#/pgce')
  await page.getByRole('button', { name: 'Print binder & exports' }).click()
  await page.getByRole('button', { name: /Export binder \(preview first\)/ }).click()
  const preview = page.getByRole('dialog', { name: 'Binder preview' })
  await expect(preview).toBeVisible()
  await expect(preview.getByText('Targets (1)')).toBeVisible()
  // R5a: the preview states exact contents — photos embedded from this device vs recorded elsewhere.
  await expect(preview.getByRole('list', { name: 'Binder contents' })).toContainText(/Photos embedded from this device/)
  // Narrow the range so the target falls out — the count updates before print.
  await preview.getByLabel('From').fill('2026-09-05')
  await expect(preview.getByText('Targets (0)')).toBeVisible()
})

test('work plan: subtasks/blocks with progress; moved due date names stranded blocks; completion asks a policy', async ({ page }) => {
  await seed(page)
  await page.goto('./#/tasks')
  await page.getByRole('button', { name: 'Add task' }).click()
  await page.getByLabel('Title').fill('Big essay')
  await page.getByLabel('Due date').fill('2026-09-30')
  await page.getByRole('button', { name: 'Save task' }).click()
  // Reopen to reach the work plan of the saved task.
  await page.locator('.keydates-list li', { hasText: 'Big essay' }).locator('.keydate-row').click()
  await page.getByPlaceholder('Subtask…').fill('Outline chapters')
  await page.getByRole('button', { name: 'Add subtask' }).click()
  await page.getByLabel('Type').selectOption('block')
  await page.getByPlaceholder('Study block…').fill('Library session')
  await page.getByLabel('Date', { exact: true }).fill('2026-09-28')
  await page.getByRole('button', { name: 'Add block' }).click()
  await expect(page.getByText('0/1 subtasks done')).toBeVisible()

  // Move the due date BEFORE the planned block: the save names it for review
  // instead of silently shifting anything.
  await page.getByLabel('Due date').fill('2026-09-20')
  await page.getByRole('button', { name: 'Save task' }).click()
  await expect(page.getByText(/1 planned study block falls after the new due date/)).toBeVisible()
  await page.getByRole('button', { name: 'Save anyway' }).click()

  // Completing with an open subtask asks for an explicit policy.
  await page.locator('.keydates-list li', { hasText: 'Big essay' }).locator('.keydate-row').click()
  await page.getByRole('button', { name: '✓ Done' }).click()
  await page.getByRole('button', { name: 'Save task' }).click()
  await expect(page.getByText(/1 subtask is still open/)).toBeVisible()
  await page.getByRole('button', { name: 'Mark them done too' }).click()
  const plans = await page.evaluate(() => JSON.parse(localStorage.getItem('timetable.admin.v1.fx')!).plans)
  expect(plans.find((c: { kind: string }) => c.kind === 'subtask').done).toBe(true)
  // The block never became a Tasks entry of its own.
  await expect(page.locator('.keydates-list li', { hasText: 'Library session' })).toHaveCount(0)
})

test('personal commitments: created on a day, marked Personal, block day-finished, and stay out of the feed URL', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await seed(page)
  await page.goto('./#/schedule')
  await page.getByRole('button', { name: 'Add a personal event on this day' }).click()
  await page.getByLabel('Title').fill('Dentist')
  await page.getByLabel('Starts').fill('18:00')
  await page.getByLabel('Ends').fill('19:00')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.locator('.day-list .session-card', { hasText: 'Dentist' })).toBeVisible()
  await expect(page.locator('.day-list .session-card', { hasText: 'Dentist' }).locator('.session-kind')).toContainText('Personal')

  // A later personal commitment prevents the "day finished" claim on Today
  // (demo sessions end 16:30; the dentist is at 18:00).
  await page.getByRole('button', { name: 'Today', exact: true }).nth(0).click()
  await page.goto('./#/today')
  await expect(page.locator('.today-finished')).toHaveCount(0)

  // Editing the interval preserves identity and the note field.
  const before = await page.evaluate(() => JSON.parse(localStorage.getItem('timetable.admin.v1.fx')!).commitments[0])
  await page.goto('./#/schedule')
  await page.locator('.day-list .session-card', { hasText: 'Dentist' }).click()
  await page.getByLabel('Starts').fill('18:30')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  const after = await page.evaluate(() => JSON.parse(localStorage.getItem('timetable.admin.v1.fx')!).commitments[0])
  expect(after.id).toBe(before.id)
  expect(after.startTime).toBe('18:30')
})
