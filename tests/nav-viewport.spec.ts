import { expect, test } from './fixtures'

/**
 * Bottom navigation follows the LIVE visual viewport (owner report, 11 Sep
 * 2026: on iOS the nav floated mid-screen after the keyboard closed). The
 * visual viewport is mocked as a resizable object so the keyboard's edge can
 * be simulated: the nav moves up by the hidden height and returns to the
 * bottom when the viewport is whole again.
 */

test('the bottom nav sits at the visual viewport edge: raised while a keyboard hides the bottom, back at 0 afterwards', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('timetable.whatsnew.v1', '99')
    localStorage.setItem('timetable.store.v2', JSON.stringify({ activeId: 'd', profiles: [{ id: 'd', name: 'Demo learner', settings: { demo: true, sheetId: '', gid: null, specialismsChosen: true, checklistDismissed: true, usagePing: false } }] }))
    // A controllable visual viewport (the real one is read-only).
    const target = new EventTarget()
    const mock = { height: window.innerHeight, offsetTop: 0, addEventListener: target.addEventListener.bind(target), removeEventListener: target.removeEventListener.bind(target), _emit: () => target.dispatchEvent(new Event('resize')) }
    Object.defineProperty(window, 'visualViewport', { value: mock, configurable: true })
  })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('./#/today')
  const nav = page.locator('.bottom-nav')
  await expect(nav).toBeVisible()
  const bottomGap = async () => page.evaluate(() => window.innerHeight - document.querySelector('.bottom-nav')!.getBoundingClientRect().bottom)
  expect(await bottomGap()).toBe(0)
  // Keyboard up: the visual viewport is 300px shorter.
  await page.evaluate(() => {
    const vv = window.visualViewport as unknown as { height: number; _emit: () => void }
    vv.height = window.innerHeight - 300
    vv._emit()
  })
  await expect.poll(bottomGap).toBe(300)
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--vv-bottom-offset').trim())).toBe('300px')
  // Keyboard down: back to the real bottom, not stuck at the old edge.
  await page.evaluate(() => {
    const vv = window.visualViewport as unknown as { height: number; _emit: () => void }
    vv.height = window.innerHeight
    vv._emit()
  })
  await expect.poll(bottomGap).toBe(0)
  // The FAB follows the same offset.
  await page.evaluate(() => {
    const vv = window.visualViewport as unknown as { height: number; _emit: () => void }
    vv.height = window.innerHeight - 200
    vv._emit()
  })
  await expect.poll(() => page.evaluate(() => window.innerHeight - document.querySelector('.fab-add')!.getBoundingClientRect().bottom)).toBeGreaterThanOrEqual(200)
})

test('closing the Schedule search blurs the input before it unmounts', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('timetable.whatsnew.v1', '99')
    localStorage.setItem('timetable.store.v2', JSON.stringify({ activeId: 'd', profiles: [{ id: 'd', name: 'Demo learner', settings: { demo: true, sheetId: '', gid: null, specialismsChosen: true, checklistDismissed: true, usagePing: false } }] }))
    ;(window as unknown as { blurs: number }).blurs = 0
    const orig = HTMLElement.prototype.blur
    HTMLElement.prototype.blur = function () {
      ;(window as unknown as { blurs: number }).blurs += 1
      return orig.call(this)
    }
  })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('./#/schedule')
  await page.getByRole('button', { name: 'Search', exact: true }).click()
  await expect(page.getByRole('searchbox', { name: 'Search sessions' })).toBeFocused()
  await page.getByRole('button', { name: 'Search', exact: true }).click()
  await expect(page.getByRole('searchbox', { name: 'Search sessions' })).toHaveCount(0)
  expect(await page.evaluate(() => (window as unknown as { blurs: number }).blurs)).toBeGreaterThanOrEqual(1)
})
