import { test as base, expect } from '@playwright/test'
// Applied to every browser test. Synthetic responses may override this route;
// an unhandled request cannot reach Google, TfL, push, sync or analytics servers.
export const test = base.extend<{ isolateNetwork: void }>({
  isolateNetwork: [async ({ context }, use) => {
    await context.route('**/*', route => {
      const host = new URL(route.request().url()).hostname
      return ['127.0.0.1', 'localhost'].includes(host) ? route.continue() : route.abort()
    })
    await use()
  }, { auto: true }],
})
export { expect }
