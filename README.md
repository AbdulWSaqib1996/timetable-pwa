# My Timetable

A free, installable PWA that turns a public Google Sheets timetable into a personal agenda:
pick your specialisms once, filter what you see, with records saved locally and optional online integrations.
Built with Vite + React + TypeScript; hosted on GitHub Pages and Vercel. See [PLAN.md](PLAN.md) for the
full plan and architecture, and [DEPLOYMENT.md](DEPLOYMENT.md) for how every piece is
deployed (automatic and manual).

## Using it

1. Open the app and paste your timetable's Google Sheets URL (open the tab you want first so
   the URL contains `#gid=…`). The sheet must be shared as **"anyone with the link can view"**.
2. Pick your specialism(s) when asked — every other specialism session is hidden from then on.
3. Day view opens on today and scrolls through the coming days; Week and Month views are in
   the switcher. Tap any session for details and its Moodle link. Notes and records are saved locally; optional encrypted sync transfers record data, not attachment files.
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

## Background push (optional)

`workers/push` is a Cloudflare Worker (free plan) that sends session and key-date reminders
even when the app is closed. Deploy:

```bash
cd workers/push
npx wrangler kv namespace create PUSH   # paste the printed id into wrangler.toml
npx wrangler deploy
```

Then paste the printed `*.workers.dev` URL into Settings → Background push and enable. VAPID
keys generate themselves into KV on first use; the cron runs every 10 minutes.

## Support

If this app saves you time, you can [buy the developer a coffee on Ko-fi](https://ko-fi.com/awsaqib). ☕

## Development

```bash
npm install
npm run dev      # local dev server
npm run build    # production build (includes PWA service worker)
```

Deployment is automatic on both frontend hosts for pushes to `main`. Both use the same
`npm run validate` build, unit and browser checks (`validate:ci` also installs Chromium).
Workers still deploy separately. See DEPLOYMENT.md before releasing cross-cutting changes.

## Supported sources and privacy

The parser recognises timetable columns such as Title, Date, Start, End and Room. It does
not support arbitrary spreadsheets, a column-mapping wizard, automatic tab discovery or
CSV fallback yet. Use a public sheet and select the tab in its URL. Cached data supports
offline viewing; live refresh, maps, routing and sync require online services.

Records start on this device. Optional encrypted sync transfers settings and record data;
photo and wallet/document blobs remain local and can be moved using backup. Push stores
a subscription and reminder configuration on the worker; background leave alerts also
store the last app-open location when enabled. TfL receives route coordinates, OpenStreetMap
serves map tiles, and address lookup uses postcodes.io or Nominatim. Calendar subscriptions
expose their configured public-sheet selection to the feed service. Study groups share
availability. Device usage pings use a pseudonymous identifier and feature counts and can
be disabled in Settings; they are enabled by default outside the demo.

## Safe development checks

`npm run validate` runs the production build, isolated worker/release unit tests and browser
regressions. `npm run validate:ci` also installs Chromium; install OS browser dependencies
on the runner where necessary. Browser tests block external services and worker tests use
in-memory KV and synthetic device subscriptions. No live push or analytics test is needed.
See [tests/README.md](tests/README.md) for coverage and remaining checks.
