# My Timetable

A free, installable PWA that turns a public Google Sheets timetable into a personal agenda:
pick your specialisms once, filter what you see, and it remembers everything on your device.
Built with Vite + React + TypeScript; hosted on GitHub Pages. See [PLAN.md](PLAN.md) for the
full plan and architecture.

## Using it

1. Open the app and paste your timetable's Google Sheets URL (open the tab you want first so
   the URL contains `#gid=…`). The sheet must be shared as **"anyone with the link can view"**.
2. Pick your specialism(s) when asked — every other specialism session is hidden from then on.
3. Day view opens on today and scrolls through the coming days; Week and Month views are in
   the switcher. Tap any session for details and its Moodle link. Everything is saved locally.
4. Install it from the browser menu ("Add to Home Screen" / "Install app") for an app-like
   experience with offline support (last-fetched data is kept).

## Calendar export

- **Download .ics** (Settings → Calendar export): a one-off snapshot of your filtered
  timetable to import into Google/Apple/Outlook calendars.
- **Live feed** (Settings → Calendar feed): a URL your calendar app polls so it stays in sync
  with the sheet. Needs the tiny worker in `workers/ics-feed` deployed to Cloudflare's free
  plan:

  ```bash
  cd workers/ics-feed
  npx wrangler deploy   # first run opens a browser to log in / create a free account
  ```

  Copy the printed `*.workers.dev` URL into Settings → Calendar feed. The app builds the full
  feed URL (sheet + your specialism choices) and you paste that into your calendar app's
  "subscribe by URL" option.

## Support

If this app saves you time, you can [buy the developer a coffee on Ko-fi](https://ko-fi.com/awsaqib). ☕

## Development

```bash
npm install
npm run dev      # local dev server
npm run build    # production build (includes PWA service worker)
```

Deployment is automatic: every push to `main` builds and publishes to GitHub Pages via
`.github/workflows/deploy.yml`.
