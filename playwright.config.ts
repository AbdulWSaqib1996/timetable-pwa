import { defineConfig } from '@playwright/test'

/**
 * Smoke test over the production build: `npm run build` first, then
 * `npm run test:e2e` (vite preview serves dist at the GitHub Pages base path).
 */
export default defineConfig({
  testDir: 'tests',
  testMatch: '**/*.spec.ts',
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: `http://127.0.0.1:4173/${process.env.VERCEL ? '' : 'timetable-pwa/'}`,
    serviceWorkers: 'block',
  },
  webServer: {
    command: 'npm run preview -- --host 127.0.0.1 --port 4173 --strictPort',
    port: 4173,
    reuseExistingServer: false,
  },
})
