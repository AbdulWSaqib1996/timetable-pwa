# Plan: Timetable Viewer PWA for Google Sheets (FINAL)

**Status: decisions resolved, ready to build.**

- Sheet access: **Option A** — the sheet is public ("anyone with the link can view"), so the app fetches it directly from the browser. No backend, no API keys, no accounts.
- Hosting: **GitHub Pages** — completely free, no card, no usage tiers. Deployed automatically from the repo via GitHub Actions.

## Goal

A mobile-friendly PWA that reads a timetable from a Google Sheet (e.g. the UCL PGCE "Group 2 Timetable"), lets you filter it — including automatically hiding the specialism sessions you don't attend — and remembers everything (sheet URL, chosen tab, all filter choices) so opening the app just shows *your* timetable.

## How the sheet is read (decided)

The sheet is public, so the app fetches it directly from the browser with no API key and no server, using Google's GViz endpoint (`https://docs.google.com/spreadsheets/d/{ID}/gviz/tq?tqx=out:json&gid=...`), with the CSV export endpoint as a fallback. Both return typed/tabular data and support listing values per tab. The whole product is a static site — free hosting, no accounts, no secrets. (If the sheet were ever made private, the fallback would be Google Sheets API + OAuth — deliberately out of scope.)

## Architecture (decided)

- **Frontend-only static SPA** — no backend, no database, £0 total cost. Stack: **Vite + React + TypeScript**.
- **Hosting: GitHub Pages**, free forever for public repos. Deploys automatically on every push to `main` via a GitHub Actions workflow (also free for public repos). The app lives at `https://<username>.github.io/timetable-pwa/`, so Vite is configured with `base: '/timetable-pwa/'` and routing uses hash or no routing at all (single screen + settings panel — no router needed).
- **Persistence: `localStorage`** for settings (sheet URL, tab, filters, specialism choices) and **cached last-fetched sheet data** so the timetable still displays offline or when Google is slow.
- **PWA layer**: web manifest (installable to home screen) + service worker via `vite-plugin-pwa` (caches app shell + last data; "last updated X ago" indicator with manual refresh). Service workers and installability work fine on GitHub Pages (HTTPS, scoped to the base path).

## Data model (what gets saved)

```
settings {
  sheetUrl            // full pasted URL; sheet ID parsed out of it
  selectedTabGid      // which tab, e.g. "Group 2 Timetable"
  columnMap           // auto-detected: Title/Day/Date/Start/End/Room/Groups/Tutor/Subject/Link
  mySpecialisms[]     // e.g. ["Music"] — specialism sessions not in this list are hidden
  filters { dateRange, subject[], tutor[], room[], showSelfStudy }
  hideSpecialismsAutomatically: true/false
  activeView          // "day" | "week" | "month" — last-used view restored on open
}
cache { fetchedAt, rows[] }
```

## Core behaviours

1. **Setup flow (first run only)**: paste sheet URL → app fetches tab list → pick your tab → app parses the header row and previews the data → confirm. Never asked again unless you open Settings.
2. **Parsing**: header-row detection with a sensible mapping for the known columns (Title, Day, Date, Start, End, Room, Groups, Tutor, Subject, hyperlink). Dates like `2-Sep-2026` and times like `9:30` parsed into real datetimes so "today/this week" views work.
3. **Specialism filter (the headline feature)**: the app detects rows whose Title matches `Specialism N - <name>` and extracts the distinct specialism names (Art & Design, Music, Computing, PE, …). A one-time picker asks "which specialism(s) are yours?" — after that, all other specialism rows are hidden automatically, forever, across all future weeks in the sheet. The pattern is configurable in case the naming changes.
4. **General filters**: by date range (Today / This week / All), subject, tutor, room, and a toggle for Self Study rows. All selections persist.
5. **Display — three views, switchable via a segmented control, last-used view remembered**:
   - **Day/agenda view (default)**: opens on **today**, with a continuous vertical scroll into the following days (infinite agenda list, day headers sticky as you scroll). A "Today" button jumps back. Each session card shows time, title, room, tutor, and a tappable Moodle link. This is the primary mobile experience.
   - **Week view**: a time-grid for the week (Mon–Fri by default, weekend shown only if sessions exist), current week first, swipe/arrows to move between weeks. Denser layout suited to desktop and tablet; on phones it renders as a compact vertical list per day.
   - **Month view**: a calendar grid with dots/short labels per day for a quick "which days am I in" overview; tapping a day jumps to that day in the agenda view.
   - All views respect the same active filters (specialisms etc.), highlight "now/next" on today, and are verified at mobile width.
6. **Refresh**: data re-fetched on app open (when online) and via pull-to-refresh/refresh button; otherwise served from cache.
7. **ICS export (core, not a nice-to-have)** — two levels:
   - **`.ics` file download (P4a)**: one tap exports the *filtered* timetable (your specialisms only) as a standard .ics file, importable into Google/Apple/Outlook calendars. Fully client-side, works on GitHub Pages.
   - **Subscribable ICS feed (P4b)**: a URL you add once to your calendar app, which then stays in sync as the sheet changes. A static site can't serve this, so it's a tiny **Cloudflare Worker (free plan, no card)**: the app builds you a feed URL encoding the sheet ID, tab and your filter choices as query parameters; the Worker fetches the public sheet on each request, applies the filters, and returns ICS. No database, no secrets — still £0.

## Nice-to-haves (after MVP, in rough priority order)

- Multiple saved sheets/profiles (e.g. next year's timetable, or a friend's group).
- "Next session" card / countdown at the top.
- Room-name shortening ("IOE - Bedford Way (20) - 631" → "Bedford Way 631").
- Colour-coding by subject.

## Edge cases planned for

- **CORS/fetch failures** → clear error + serve cached data.
- **Sheet structure changes** (columns reordered/renamed) → column mapping re-runs and warns rather than breaking.
- **Merged/blank cells and grouped rows** (common in timetable sheets) → forward-fill logic during parse.
- **The "Groups" column** (`1,2,3,...` vs `2`) → treated as data, optionally filterable, but not used to hide rows by default since the tab is already group-specific.
- **Hyperlinks**: the GViz endpoint doesn't return cell hyperlinks directly — but the example sheet has the URL as a visible column, so it is read as text. (If a future sheet embeds links in the title cell instead, fall back to the HTML export to recover them — noted as a known limitation.)

## Build phases

1. **P1 — Fetch & display**: scaffold Vite + React + TS project, URL input, parse GViz JSON, render the day/agenda view opening on today with scroll-ahead. (Proves the data access works end to end.)
2. **P2 — Filters & persistence**: specialism detection/picker, general filters, localStorage save/restore, settings screen.
3. **P3 — Views + PWA + deploy**: week and month views with the segmented switcher; manifest, service worker (`vite-plugin-pwa`), offline cache, install prompt; GitHub repo + Actions workflow deploying to GitHub Pages.
4. **P4 — ICS export**: (a) client-side .ics file download of the filtered timetable; (b) subscribable feed via a free Cloudflare Worker with filters encoded in the feed URL.
5. **P5 — Polish/nice-to-haves**: next-session card, styling refinements, remaining backlog items.

Each phase is independently usable — after P1 the timetable is already viewable.

## Resolved decisions (log)

1. **Sheet access**: the sheet is public — anyone with the link can view it → Option A (direct browser fetch, no backend, no OAuth).
2. **Hosting**: must be completely free (student project, no budget) → GitHub Pages + GitHub Actions on a public repo. No card, no trials, no usage caps that matter at this scale.
