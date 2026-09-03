import { defineConfig } from '@playwright/test'

/**
 * Smoke test over the production build: `npm run build` first, then
 * `npm run test:e2e` (vite preview serves dist at the GitHub Pages base path).
 */
export default defineConfig({
  testDir: 'tests',
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: 'http://localhost:4173',
  },
  webServer: {
    command: 'npm run preview -- --port 4173 --strictPort',
    port: 4173,
    reuseExistingServer: !process.env.CI,
  },
})
