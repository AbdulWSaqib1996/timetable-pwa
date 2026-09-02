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

**Status of the original list:** 1–8, 10, 12 built; 13 covered by the travel/directions work. Still open: **9** (private-sheet OAuth — only if a sheet can't be public) and **11** (ICS feed hardening — waits on the worker being deployed to Cloudflare). A second round of ideas is logged below in **Future enhancements — round 2**.

**Built (2 Sep 2026, fourth pass):** key dates render as solid highlighted blocks in the day agenda (with month-view pins, a Filters toggle, a tappable view-all list, and search inclusion); Ko-fi support link (ko-fi.com/awsaqib) in Settings and README; public Vercel hosting at pgce-timetable.vercel.app alongside GitHub Pages.

**Built (2 Sep 2026, third pass):** leave alerts (notify with a chosen head start before start − live travel time), an OpenStreetMap embed in session details, **optional-session handling** (sessions titled "(optional)" get a badge and a Filters toggle to hide them), and **key dates** — Settings → Key dates takes the submissions-tab URL, upcoming deadlines show as a countdown strip on the day view (urgent styling within 7 days) and a full list with Today/Tomorrow/in-Nd chips.

**Built (2 Sep 2026, second pass):** item 12 (background freshness) is implemented — a "new version available" refresh toast, a NetworkFirst service-worker cache for the sheet data (fetches work offline), and Periodic Background Sync (Chrome, installed PWAs) that re-fetches cached sheet data in the background. Reminders were upgraded to **multiple configurable offsets** (Settings → Session reminders: any combination of 5 min–2 hours, e.g. 1 hour AND 15 min before each session, with the legacy single setting migrated). New beyond the original list: **walking times & directions** — Settings → Travel times uses device location (never leaves the device) to estimate the walk to each session, with rooms cross-checked against a UCL Bloomsbury campus gazetteer (20 Bedford Way, Darwin, Cruciform, Wilkins, and ~17 more buildings) and a Google Maps walking-directions link per session (this also covers item 13).

**Built (2 Sep 2026):** items 1–8 and 10 below are implemented — share links (Settings → Share this setup), change detection (bell icon + changes sheet), search (magnifier in the header), per-session Google Calendar buttons, multiple timetable profiles (Settings → Timetables, with migration from the single-profile storage), group filtering (Filters → My group), term-start week numbers (Settings), reminders (Settings → Session reminders; fires while the app is open/installed — the note in item 8 about calendar-app alerts via the ICS feed still applies for guaranteed delivery), and attendance/notes (in each session's detail sheet, with badges on cards). Items 9 and 11–13 remain open.

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

## Future enhancements — round 2 (logged 2 Sep 2026)

A fresh pass over the app as it now stands. Effort: S (hours), M (a day or two), L (multi-day / new infrastructure).

**Built (2 Sep 2026, seventh pass): visual route timeline.** The session detail's "best route" is now a step-by-step timeline: one row per leg with a mode icon, an official-colour line badge (Victoria blue, bus red, Overground orange…), from → to stops, per-leg minutes, and the live total — replacing the plain-text route line.

**Built (2 Sep 2026, sixth pass): live TfL disruption awareness.** With public transport selected: an amber collapsible banner on the day view lists lines not running good service (strikes, closures, delays — refreshed every 5 min); session details show the live-recommended route ("Best route now: 73: King's Cross St. Pancras → Euston · then walk") which TfL's journey planner already steers around disruptions, plus ⚠ warnings when the recommended route's own lines are disrupted; and leave alerts append a TfL disruption note when firing.

**Built (2 Sep 2026, fifth pass): items 1–9 below.** Key-date reminders (7/3/1-day chips under Settings → Key dates); key dates in the .ics download and worker feed as 📌 all-day events; backup export/import (Settings → Backup, JSON of all profiles + notes/attendance) and the share link now carries term start, travel mode, filters and the key-dates tab; live TfL journey times in session details when the mode is public transport (falls back to the heuristic); ⚠ Clash badges on overlapping sessions in the day view; attendance insights (overall % + per-subject counts + CSV export in Settings); PWA shortcuts (Today / Key dates on long-press) and app-icon badging with the unseen-changes count; multi-tab merge (Settings → Timetables → "Merge tab into this timetable", with deduplication); manual System/Light/Dark theme toggle. Remaining from this list: 10–13 (analytics, error monitoring, print stylesheet, accessibility pass).

1. **Key-date reminders (S)** — the deadline data and the notification plumbing both exist; add "notify me 7/3/1 days before each key date" chips next to the session reminders. Highest-value quick win.
2. **Key dates in the calendar export/feed (S)** — include deadlines as all-day events in the .ics download and the worker feed, so submission dates land in Google/Apple Calendar alongside sessions.
3. **Settings backup & richer share link (S/M)** — export/import everything (profiles, filters, notes, attendance) as a JSON file, and extend the share link to carry term start and filter choices. Protects against cleared browser data — currently the only copy of notes/attendance is localStorage.
4. **Real journey times via the TfL API (M)** — TfL's Journey Planner API is free and needs no key for light use; replace the straight-line heuristics with real door-to-door public-transport times and live disruption awareness. Walking/driving could stay heuristic.
5. **Conflict detection (S)** — warn when two visible sessions overlap (e.g. a specialism choice clashing with a group session), as a badge on the day and a note in both details.
6. **Attendance insights (M)** — per-subject attended/total counts and a simple term overview, with CSV export; builds directly on the existing attendance data.
7. **PWA app shortcuts & badging (S)** — manifest shortcuts (jump straight to Today / Key dates from a long-press on the home-screen icon) and the App Badging API to show unseen timetable changes on the icon where supported.
8. **Multi-tab merge (M)** — some cohorts split content across tabs (group tab + all-groups events tab); allow a profile to combine several tabs of the same spreadsheet into one timetable, deduplicating identical rows.
9. **Theme toggle (S)** — manual light/dark override in Settings (currently follows the system).
10. **Privacy-friendly usage analytics (S)** — a free GoatCounter/Plausible-style counter (no cookies, no personal data) to learn whether other cohorts adopt the app; directly informs the template-sales decision in the monetisation notes.
11. **Error monitoring (S)** — Sentry's free tier wired into the app so parsing failures against unfamiliar sheets are visible without user reports.
12. **Print/PDF week view (S)** — a print stylesheet so the week grid prints cleanly for a pinboard.
13. **Accessibility pass (M)** — keyboard navigation through cards and sheets, focus trapping in modals, reduced-motion support, and a screen-reader audit; worth doing before promoting the app beyond the cohort.

**Suggested order:** 1 and 2 first (small and high-value, both about deadlines users already asked for), then 3 (data safety), 5 and 7 as polish, 4 when journey accuracy starts to matter, 10/11 before any push to other cohorts.

## Future enhancements — round 3 (logged 2 Sep 2026)

Ideas building on the app after rounds 1–2 and the TfL work (which now includes a visual per-leg route timeline with line colours and timings). **Built (2 Sep 2026, eighth pass): items 1–5, 7, 8, 9 and 12.** Background push is fully coded (workers/push: VAPID + RFC 8291 web-push crypto, KV subscriptions, 10-min cron computing session/key-date reminders server-side; Settings → Background push; SW push handlers) and awaits `wrangler login` + deploy; live departures under the route timeline; Open-Meteo weather on the Now/Next card and rain notes in leave alerts; deadline workload line + notes surfaced in the key-dates list; ☕ free-gap rows in the day view; 📸 share-week-as-image from the week view; day-view windowing with show-earlier/show-later; offline campus map (OSM tiles through the service worker replace the iframe embed); plus item 7 — a Term stats sheet (sessions, taught hours, attendance %, busiest week, most-visited building) with a shareable image. Still open from earlier rounds: original 9 (private-sheet OAuth) and 11 (feed hardening, after the worker deploy); round-2 10–13 (analytics, error monitoring, print stylesheet, accessibility pass). Effort: S (hours), M (a day or two), L (multi-day / new infrastructure).

1. **True background push (L)** — the one structural gap: strike alerts, leave alerts and key-date reminders currently need the app open. A small Cloudflare Worker with cron triggers + Web Push subscriptions would deliver them with the app closed. The most-requested-in-spirit item; also unlocks "timetable changed overnight" pushes.
2. **Live departures (M)** — TfL's Arrivals API: once a route is shown, add "next 205 from King's Cross: 2, 9, 14 min" so you know whether to run for it.
3. **Weather-aware mornings (S/M)** — Open-Meteo (free, keyless): rain/temperature chip on the Now/Next card and a "rain at 9:00 — consider leaving earlier" note in leave alerts.
4. **Deadline workload view (M)** — a "next 14 days" pressure summary over key dates (count + list), plus per-key-date notes/checklists ("draft done, references left") reusing the session-notes storage.
5. **Free-slot finder (M)** — surface gaps between sessions ("2h free after English 1, next session 14:30") in the day view — the natural place to plan library time; pairs with the deadline workload view.
6. **Personal-calendar clash check (M/L)** — subscribe to the user's own Google Calendar (public ICS address pasted into Settings) and badge timetable sessions that clash with personal events (work shifts, appointments).
7. **Term stats / "wrapped" (S)** — end-of-term shareable summary from existing data: attendance %, busiest week, most-visited building, total taught hours.
8. **Share week as image (S)** — render the week grid to a PNG (canvas) for sharing in group chats, where links get ignored but screenshots get read.
9. **List virtualisation (S/M)** — the day view renders all 443 sessions; virtualise (or window by month) to keep low-end phones smooth as the sheet grows.
10. **Playwright E2E tests in CI (M)** — the app now has enough surface (parsing, filters, profiles, share links) that regressions are plausible; a smoke suite against the demo data on every push would catch them before deploy.
11. **Android TWA / Play Store wrapper (L)** — package the PWA as a Trusted Web Activity for the Play Store; gives real install distribution to other cohorts and enables richer notifications on Android. Only worth it alongside the template-sales route.
12. **Offline map tiles (S)** — cache the handful of OSM tiles around campus in the service worker so the detail-sheet map renders offline too.

**Suggested order:** 3 and 8 as quick delights, 5 + 4 as the next real feature pair, 10 before the codebase grows further, 1 when reminders prove popular, 11 only with multi-cohort traction.

## Monetisation options (explored 2 Sep 2026)

Context: niche audience (one PGCE cohort today — likely low hundreds of users), £0 infrastructure, free-tier hosting. Ordered by fit:

1. **Donations — do this now.** Ko-fi / Buy Me a Coffee / PayPal.me / GitHub Sponsors. No backend, no cost, fits a student audience; add a "Support this app ☕" link in Settings and the README. GitHub Sponsors takes no fees. Expect pocket money, not income.
2. **Template / white-label sales — the realistic revenue path.** The app is sheet-agnostic: any course whose timetable lives in a Google Sheet could use it. Sell configured deployments or a one-time template (Gumroad / Lemon Squeezy, ~£10–30) to other cohorts, course reps or programme admins; or keep it open-source and charge for setup/customisation.
3. **Freemium** — free core, paid conveniences (hosted ICS feed, multiple profiles, priority features) via Stripe Payment Links + a small entitlement check (Cloudflare Workers KV would keep it £0). Only worth building once there's real multi-cohort traction.
4. **Ads — not recommended.** At this scale AdSense would earn pennies per month (display RPMs of ~£1–3 need thousands of daily views), damages the UX of a glance-at-it-daily utility, and drags in GDPR consent banners. Niche networks (Carbon/EthicalAds) require developer-scale traffic.
5. **Hosting constraint (important):** GitHub Pages and Vercel's Hobby plan are non-commercial tiers. A donation link on a personal open-source project is generally tolerated; running ads or selling access is not — that step needs Vercel Pro (~$20/mo) or a move to Cloudflare Pages (free tier permits commercial use).

**Recommendation:** add a donation link now; pursue template sales if other cohorts show interest; revisit freemium at hundreds of weekly users; skip ads.

## Resolved decisions (log)

1. **Sheet access**: the sheet is public — anyone with the link can view it → Option A (direct browser fetch, no backend, no OAuth).
2. **Hosting**: must be completely free (student project, no budget) → GitHub Pages + GitHub Actions on a public repo. No card, no trials, no usage caps that matter at this scale.
