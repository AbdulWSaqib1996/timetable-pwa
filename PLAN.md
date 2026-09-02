# Plan: Timetable Viewer PWA for Google Sheets (FINAL)

**Status: P1–P5 built. Live at https://abdulwsaqib1996.github.io/timetable-pwa/ (repo: AbdulWSaqib1996/timetable-pwa).**
Remaining: P4b needs the user to run `npx wrangler deploy` in `workers/ics-feed` (Cloudflare login required). Future ideas are tracked in **Future enhancements** below.

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

- ✅ "Next session" card / countdown at the top (P5).
- ✅ Room-name shortening ("IOE - Bedford Way (20) - 631" → "Bedford Way 631") (P5).
- ✅ Colour-coding by subject (P5).
- Multiple saved sheets/profiles — moved to Future enhancements below.

## Edge cases planned for

- **CORS/fetch failures** → clear error + serve cached data.
- **Sheet structure changes** (columns reordered/renamed) → column mapping re-runs and warns rather than breaking.
- **Merged/blank cells and grouped rows** (common in timetable sheets) → forward-fill logic during parse.
- **The "Groups" column** (`1,2,3,...` vs `2`) → treated as data, optionally filterable, but not used to hide rows by default since the tab is already group-specific.
- **Hyperlinks**: the GViz endpoint doesn't return cell hyperlinks directly — but the example sheet has the URL as a visible column, so it is read as text. (If a future sheet embeds links in the title cell instead, fall back to the HTML export to recover them — noted as a known limitation.)

## Build phases

1. ✅ **P1 — Fetch & display**: scaffold Vite + React + TS project, URL input, parse GViz JSON, render the day/agenda view opening on today with scroll-ahead. (Also added later: tap a session for a detail sheet with date/time/duration/location/tutor/Moodle link.)
2. ✅ **P2 — Filters & persistence**: specialism detection/picker, general filters, localStorage save/restore, settings screen.
3. ✅ **P3 — Views + PWA + deploy**: week and month views with the segmented switcher (date-range filter moved into the Filters sheet); manifest, service worker (`vite-plugin-pwa`), offline cache; GitHub repo + Actions workflow deploying to GitHub Pages.
4. ✅ **P4 — ICS export**: (a) client-side .ics file download of the filtered timetable (Settings → Calendar export); (b) subscribable feed worker written in `workers/ics-feed` — deploy with `npx wrangler deploy`, then paste the workers.dev URL into Settings → Calendar feed.
5. ✅ **P5 — Polish/nice-to-haves**: Now/Next card at the top of the day view (current session with time remaining, or the next upcoming one with a countdown; tap for details), room-name shortening on cards ("IOE - Bedford Way (20) - 631" → "Bedford Way 631", full name kept in the detail sheet), deterministic per-subject colour coding on day cards and week-grid events.

Each phase is independently usable — after P1 the timetable is already viewable.

## Future enhancements (beyond P5)

Ideas that would meaningfully improve the product, roughly ordered by value-for-effort. Effort: S (hours), M (a day or two), L (multi-day / needs new infrastructure).

1. **Share your setup via link (S)** — encode the sheet ID, tab and specialism choices into a URL (`?setup=…`) so a coursemate opens the app fully configured with one tap. Highest-value social feature; pure client-side.
2. **Change detection & highlights (M)** — on each refresh, diff the new sheet data against the cached copy and badge what changed: "Room changed for Maths 2", added/cancelled sessions, with a small changelog sheet. Turns silent timetable edits into visible alerts.
3. **Search (S)** — a quick search box across titles, tutors and rooms ("when do I next have KaW?"). Client-side filter over loaded sessions.
4. **Per-session "Add to calendar" (S)** — a Google Calendar template-URL button in the session detail sheet for one-off adding, complementing the bulk .ics/feed export. No API needed.
5. **Multiple timetables/profiles (M)** — save more than one sheet (next year's timetable, partner's group) and switch between them; each profile keeps its own filters. Mostly a storage-schema change (array of profiles instead of one settings object).
6. **Groups-aware filtering (M)** — parse the Groups column (`2` vs `1,2,3,…`) properly so a single mixed-groups tab can be filtered to "my group", making the app work for cohorts whose sheets aren't split per group.
7. **Week/term awareness (S)** — configurable term start date to show "Week 3" labels in headers and the week view, matching how courses talk about time.
8. **Session reminders (L)** — true push notifications before sessions need a push backend (another small worker + Web Push subscriptions). Note the pragmatic version already works today: subscribe via the ICS feed and let the calendar app's native alerts do the reminding.
9. **Private-sheet support (L)** — Google Sheets API + OAuth (the original Option B) for sheets that can't be link-shared. Significant auth complexity; only worth it if a future sheet can't be public.
10. **Attendance & notes (M)** — tick off attended sessions and attach personal notes per session (localStorage), e.g. "bring PE kit"; optional export.
11. **ICS feed hardening (S)** — once the worker is deployed: an unguessable token in the feed path (the URL currently encodes only the already-public sheet ID), custom calendar name, and per-subject colour hints where clients support them.
12. **Background freshness (M)** — Periodic Background Sync (where supported) so the service worker refreshes sheet data before the app is opened; plus an in-app "new version available" toast when the PWA updates.
13. **Room directions (S)** — link the location in the session detail to Google Maps (building name + "London"), handy in the first weeks on an unfamiliar campus.

## Resolved decisions (log)

1. **Sheet access**: the sheet is public — anyone with the link can view it → Option A (direct browser fetch, no backend, no OAuth).
2. **Hosting**: must be completely free (student project, no budget) → GitHub Pages + GitHub Actions on a public repo. No card, no trials, no usage caps that matter at this scale.
