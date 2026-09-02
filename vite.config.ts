import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// Served from https://<username>.github.io/timetable-pwa/ (GitHub Pages)
export default defineConfig({
  base: '/timetable-pwa/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['apple-touch-icon.png'],
      manifest: {
        name: 'My Timetable',
        short_name: 'Timetable',
        description: 'Your Google Sheets timetable, filtered to what you actually attend.',
        theme_color: '#1a1f36',
        background_color: '#101322',
        display: 'standalone',
        start_url: '.',
        scope: '.',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // App shell is precached; sheet data also gets a NetworkFirst cache so a fetch
        // still succeeds offline, and periodic background sync (sw-periodic.js) keeps it warm.
        globPatterns: ['**/*.{js,css,html,png,svg,ico}'],
        navigateFallback: '/timetable-pwa/index.html',
        importScripts: ['sw-periodic.js'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/docs\.google\.com\/spreadsheets\/.*\/gviz\//,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'gviz-data',
              networkTimeoutSeconds: 8,
              expiration: { maxEntries: 10, maxAgeSeconds: 7 * 24 * 3600 },
            },
          },
        ],
      },
    }),
  ],
})
