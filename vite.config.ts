import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// Served from the domain root on Vercel (VERCEL env is set there) and from
// /timetable-pwa/ on GitHub Pages; dev uses the Pages base too.
const base = process.env.VERCEL ? '/' : '/timetable-pwa/'

export default defineConfig({
  base,
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
        shortcuts: [
          {
            name: 'Today',
            url: './?view=today',
            icons: [{ src: 'icon-192.png', sizes: '192x192', type: 'image/png' }],
          },
          {
            name: 'Key dates',
            url: './?view=keydates',
            icons: [{ src: 'icon-192.png', sizes: '192x192', type: 'image/png' }],
          },
        ],
      },
      workbox: {
        // App shell is precached; sheet data also gets a NetworkFirst cache so a fetch
        // still succeeds offline, and periodic background sync (sw-periodic.js) keeps it warm.
        globPatterns: ['**/*.{js,css,html,png,svg,ico}'],
        navigateFallback: `${base}index.html`,
        importScripts: ['sw-periodic.js', 'sw-push.js'],
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
          {
            // campus map tiles keep working offline once seen
            urlPattern: /^https:\/\/tile\.openstreetmap\.org\//,
            handler: 'CacheFirst',
            options: {
              cacheName: 'osm-tiles',
              expiration: { maxEntries: 120, maxAgeSeconds: 30 * 24 * 3600 },
            },
          },
          {
            urlPattern: /^https:\/\/api\.open-meteo\.com\//,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'weather',
              networkTimeoutSeconds: 6,
              expiration: { maxEntries: 4, maxAgeSeconds: 3 * 3600 },
            },
          },
        ],
      },
    }),
  ],
})
