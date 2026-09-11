import { expect, test } from './fixtures'

/**
 * Bottom navigation follows the LIVE visual viewport (owner report, 11 Sep
 * 2026: on iOS the nav floated mid-screen after the keyboard closed). The
 * visual viewport is mocked as a resizable object so the keyboard's edge can
 * be simulated: the nav moves up by the hidden height and returns to the
 * bottom when the viewport is whole again.
 */

test('the bottom nav follows the keyboard only while an input is focused: a shrunken viewport with nothing focused (stale iOS report) leaves the nav at the bottom', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('timetable.whatsnew.v1', '99')
    localStorage.setItem('timetable.store.v2', JSON.stringify({ activeId: 'd', profiles: [{ id: 'd', name: 'Demo learner', settings: { demo: true, sheetId: '', gid: null, specialismsChosen: true, checklistDismissed: true, usagePing: false } }] }))
    // A controllable visual viewport (the real one is read-only).
    const target = new EventTarget()
    const mock = { height: window.innerHeight, offsetTop: 0, scale: 1, addEventListener: target.addEventListener.bind(target), removeEventListener: target.removeEventListener.bind(target), _emit: () => target.dispatchEvent(new Event('resize')) }
    Object.defineProperty(window, 'visualViewport', { value: mock, configurable: true })
  })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('./#/schedule')
  const nav = page.locator('.bottom-nav')
  await expect(nav).toBeVisible()
  const bottomGap = async () => page.evaluate(() => window.innerHeight - document.querySelector('.bottom-nav')!.getBoundingClientRect().bottom)
  const offset = async () => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--vv-bottom-offset').trim())
  const shrink = (by: number) => page.evaluate((by) => {
    const vv = window.visualViewport as unknown as { height: number; _emit: () => void }
    vv.height = window.innerHeight - by
    vv._emit()
  }, by)
  expect(await bottomGap()).toBe(0)
  // The owner's screenshot: viewport reported 300px shorter, no keyboard, nothing focused → nav stays put.
  await shrink(300)
  await page.waitForTimeout(500)
  expect(await bottomGap()).toBe(0)
  expect(await offset()).toBe('0px')
  // Keyboard up for real: an input is focused → the nav rides on the keyboard's edge.
  await page.getByRole('button', { name: 'Search', exact: true }).click()
  await expect(page.getByRole('searchbox', { name: 'Search sessions' })).toBeFocused()
  await shrink(300)
  await expect.poll(bottomGap).toBe(300)
  expect(await offset()).toBe('300px')
  // Focus leaves but iOS keeps reporting the shrunken viewport (stale): the nav must still return to the bottom.
  await page.getByRole('button', { name: 'Search', exact: true }).click()
  await expect(page.getByRole('searchbox', { name: 'Search sessions' })).toHaveCount(0)
  await expect.poll(bottomGap, { timeout: 3000 }).toBe(0)
  expect(await offset()).toBe('0px')
  // Pinch zoom (scale ≠ 1) is not a keyboard either.
  await page.getByRole('button', { name: 'Search', exact: true }).click()
  await page.evaluate(() => {
    const vv = window.visualViewport as unknown as { height: number; scale: number; _emit: () => void }
    vv.scale = 2
    vv.height = window.innerHeight / 2
    vv._emit()
  })
  await page.waitForTimeout(500)
  expect(await bottomGap()).toBe(0)
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
