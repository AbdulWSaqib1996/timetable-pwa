# My Timetable PWA — implementation handoff for Phases 3–7

Prepared 7 September 2026. This is a development specification, not a claim that the remaining features have been implemented.

## 1. Start here

The user approved one sequential seven-phase roadmap. Phases 1 and 2 have been implemented; continue with **Phase 3**. This document expands the remaining phases into implementation work, behavioural contracts, visual specifications and release checks. Preserve the sequence: reliability → daily UI → editable workflows → advanced travel/collaboration → optional expansion.

**Source of truth:** the existing enhancement report's Section 7 establishes scope. This handoff makes it executable. For travel, home and mobile Schedule, the latest Section 10 designs supersede earlier map ordering. Product behaviour and accessibility requirements take precedence over incidental limitations in a prototype.

### 1.1 Repository and release baseline

| Item | Location / baseline |
|---|---|
| Original repository | `/Users/abdulsaqib/Documents/Personal/Projects/timetable-pwa` |
| Git remote | `git@github.com:AbdulWSaqib1996/timetable-pwa.git` |
| Review workspace | `/Users/abdulsaqib/Documents/ChatGPT/Timetable PWA` |
| Original review | `TIMETABLE_PWA_ENHANCEMENTS.md` in the review workspace and repository |
| Phase 2 implementation branch | `codex/phase-2`; merged into `main` |
| Phase 2 implementation commit | `1af63bf` |
| Phase 2 release-log commit | `439371d3a8e1660352f84f6dcdd00931e5a94dd5` |
| Frontend stack | React 18, TypeScript, Vite, vite-plugin-pwa; npm lockfile |
| App hosts | `https://pgce-timetable.vercel.app/` and `https://abdulwsaqib1996.github.io/timetable-pwa/` |
| Push/sync worker | `workers/push/worker.js`; `timetable-push.ics-feed.workers.dev` |
| Calendar feed worker | `workers/ics-feed/worker.js`; `timetable-ics.ics-feed.workers.dev` |
| Phase 2 worker versions | Push `917e1cd1-56f2-4f35-b192-345468cbfb18`; feed `43900bd2-e329-42b1-bdc1-08f9934c97c4` |
| Existing gates | `npm run build`, `npm run test:unit`, `npm run test:e2e`, `npm run validate` |

Both hosted deployment statuses for `439371d` succeeded. The local suite passed **12 unit tests and 9 isolated browser tests**, including the full Vercel root-path layout. GitHub Actions runs the browser gate; Vercel runs the shared build/unit gate because its build image cannot launch Chromium. Preserve that distinction.

Before developing, read the current `AGENTS.md`, `DEPLOYMENT.md`, `PLAN.md`, `package.json`, this document and the original report. Fetch the repository and inspect status/history: the baseline may have advanced. Do not reset or overwrite another developer's work. Use a `codex/phase-3` branch/worktree or an equivalent user-approved branch. Paths below are repository-relative unless labelled as review artifacts. Proposed new paths are explicitly labelled **proposed**.

### 1.2 What Phase 2 already provides — reuse these contracts

- `shared/timetable.js`: the parser used by the browser and both workers; `src/lib/parseTimetable.ts` is a typed adapter. Invalid rows produce warnings. Avoid creating a fourth parser.
- `shared/identity.js`, `src/lib/identity.ts`: optional source Event ID/Session ID support, existing-owner reconciliation, stable observed calendar UIDs, ambiguous-match review and identity history. `sessionKey()` delegates to the stable owner. Do not return to row-index ownership.
- `src/lib/persistence.ts`, `attachments.ts`, `recovery.ts`: visible failed saves, commit-aware IndexedDB operations and a durable undo journal. Startup recovers interrupted operations before rendering. Do not bypass these with scattered silent `localStorage.setItem` catches.
- Backup v4 includes store, metadata, PGCE records, cache/identity snapshots, change history and attachment bytes. Validated v2/v3 fixtures remain supported. The size limits are 50 MB per backup and 10 MB per wallet file. Repeated import is idempotent.
- `shared/merge.js`: deletion-aware merges for metadata, PGCE records and profiles. Tombstones are part of the schema, including equal-timestamp precedence. Removing a key from a JavaScript object is insufficient to propagate deletion.
- `src/lib/sync.ts` and `workers/push/sync-store.js`: encrypted merge-before-write with revision conflicts and retries. The `SYNC` SQLite Durable Object binding is live. `/sync` and `/sync/delete` return 426; preserve this protection against older unsafe clients.
- Photos and wallet bytes **do not sync yet**. Metadata counts are not proof that a file is on this device. Session detail explains the difference.
- Opening remote updates must not reload an active form. Phase 2 defers UI application around open panels; durable form drafts and full conflict UX are Phase 5 work.

Phase 2's tests are regression evidence, not proof of every browser/platform scenario. Keep its fixtures and add coverage when expanding the model. Arbitrary simultaneous source edits cannot always be reconciled without a stable source ID or a previous snapshot. Expose uncertainty instead of silently attaching old evidence to a guessed event.

### 1.3 Non-negotiable operational constraints

1. Never delete or overwrite the production KV `vapid` key. Never delete KV records not created by the current task. Never test production push subscriptions or analytics.
2. Keep the legacy broadcasting `/test` endpoint disabled. Use isolated synthetic data for tests.
3. Preserve `registerType`, existing KV namespace IDs and default service base URLs unless a later explicit task requires changing them.
4. When changing app and worker contracts, deploy compatible workers first, then the app. A frontend git push does not deploy workers.
5. Log substantive changes in `PLAN.md` with the implementation commit. Record schema compatibility, feature coverage, tests and rollback.
6. Do not silently add mandatory accounts, paid infrastructure, a framework rewrite, AI-written reflections or a social feed. Phase 7 is optional expansion, not a prerequisite for releasing Phases 3–6.

## 2. Design references and how to use them

The accompanying `handoff-assets/` directory contains portable copies of the existing before/after images and HTML concepts. Keep it beside this Markdown file. When transferring to another AI, transfer the entire handoff ZIP, not just a screenshot pasted without context.

| Reference | What it establishes |
|---|---|
| [Mobile Schedule comparison](handoff-assets/comparison-mobile-schedule.png) | Labelled bottom navigation, Week/Month control, seven-day selector and one selected-day list |
| [Session travel comparison](handoff-assets/comparison-session-travel.png) | Compact event header, Overview / Travel & map, visible destination map, expandable steps and external navigation |
| [Home entry comparison](handoff-assets/comparison-home-entry.png) | Discoverable Journey home card on Today |
| [Home route comparison](handoff-assets/comparison-home-route.png) | Full-width mobile journey screen instead of the clipped popover |
| [Today comparison](handoff-assets/comparison-today.png) | Next session and room prominence, reduced header noise |
| [Session overview comparison](handoff-assets/comparison-session.png) | Clear metadata hierarchy and grouped actions |
| [Settings comparison](handoff-assets/comparison-settings.png) | Focused settings categories |
| [PGCE comparison](handoff-assets/comparison-pgce.png) | More approachable organisation and empty states |
| [Setup comparison](handoff-assets/comparison-setup.png) | Connect → Personalise → Preview |
| [Desktop comparison](handoff-assets/comparison-desktop.png) and [desktop design](handoff-assets/after-desktop-week.png) | Sidebar, usable week grid and selected-event panel |
| [Dark travel check](handoff-assets/travel-dark-check.png) | Dark-mode treatment, not a separate visual language |
| [Travel/Schedule concept source](handoff-assets/timetable-travel-schedule.html) | Layout CSS and example navigation behaviour |
| [General concept source](handoff-assets/timetable-ui-comparison.html) | Shared UI direction across Today/detail/setup/PGCE/settings |
| [Desktop concept source](handoff-assets/timetable-desktop-design.html) | Desktop composition and room/action hierarchy |

The HTML files are preview fragments, not production React components. Some preview interactions are demonstrations or messages, and their host supplied icon/runtime behaviour. Read the CSS/markup as references; use the PNGs if the fragments do not run standalone. Do not paste inline scripts, base64 screenshots, fabricated journey data or preview-only messages into the app.

The comparison images contain **before on the left and concept on the right**. Only the right-hand design is the target. The enclosing comparison controls and phone-frame border are not app UI. Sample journeys and a Camden-area home are synthetic. Never save that example address as the user's home.

**Conflict resolution:** use the latest travel treatment: the map is visible when **Travel & map** opens, while journey steps are collapsible. Do not put the map behind a second “show map” action. Keep map content off the initial Overview. Precise future-session leave-by times in the concept are a **Phase 6 capability**, not a Phase 4 promise.

## 3. Shared implementation architecture

### 3.1 Data pipeline

Use a single explicit pipeline rather than passing a broadly named `filteredSessions` everywhere:

```text
Validated source rows
  → source-scoped event identity + retained history
  → course membership / enrolment
  → purpose-specific eligibility (reminders, attendance, busy time, exports)
  → temporary presentation filters + selected date
  → screen presentation
```

Imported rows remain source-owned. Personal tasks, study blocks and appointments remain user-owned. Linking a mentor action into Tasks must refer to the original record, not create a second independently editable copy.

Suggested neutral modules under `shared/` are `membership.js`, `calendar-time.js`, `eligibility.js` and `travel-state.js`, with `.d.ts` contracts as currently used. These are proposed additions; use equivalent names if justified. Keep platform I/O in browser/worker adapters. Avoid importing React, `window`, IndexedDB or Cloudflare bindings into neutral modules.

### 3.2 Application state boundaries

Separate:

- **Shared course data:** profiles, enrolment, imported identity mappings, evidence, tasks, PGCE records and appropriate course settings.
- **Device state:** push subscription, permission state, local attachment availability, theme/density, active destination, selected date, presentation filters and scroll positions.
- **Ephemeral state:** a loading request, open route leg, menu, toast and current geolocation request.
- **Recoverable drafts:** per-profile, per-record form edits with base revision. These are neither saved records nor disposable ephemeral state.

Do not sync notification permission or assume a synced boolean creates a subscription on another device. Preserve active profile/view when applying remote records. Use the Phase 2 persistence and revision mechanisms when adding new collections; extend backup, restore, deletion cleanup and validation in the same change.

### 3.3 Proposed UI decomposition

Incrementally extract these responsibilities as their phase is implemented:

```text
src/features/schedule/     selectors, navigation state, day list, week grid, month picker
src/features/today/        next session, day summary, urgent item, journey-home entry
src/features/tasks/        task projections, details, editing and linked work plans
src/features/pgce/         navigation, record forms, drafts, evidence and binder preview
src/features/travel/       journey presentation, request intent, route states and map adapter
src/features/settings/    focused pages, data health and onboarding
src/components/ui/        Button, IconButton, Card, Field, Tabs, StatusMessage, PageHeader
src/styles/               tokens.css, shell.css, components.css, feature styles
```

This is a suggested organisation, not permission for a wholesale rewrite. Keep working imports and lazy loading during extraction. Do not migrate all code before delivering the first tested behavioural fix.

## 4. Phase 3 — consistent schedule, integrations and statistics

**Deliverable:** a reliability release using the current UI. Do this before redesigning screens. Each work item below should be reviewable and have tests before the next dependent item starts.

### P3-01. Separate course membership from display filters

**Current issue:** `src/lib/filters.ts` splits groups on commas and combines membership, optional/self-study switches, date filters, subjects, tutors and rooms in one function. The result is reused for reminders and other features. A Group 2 member can miss `1-10`; hiding a room can unintentionally affect background behaviour.

**Implementation:**

1. Define a parsed group expression: explicit tokens, inclusive numeric ranges, all-groups and unrecognised text. Normalise spaces, case and dash variants. Bound numeric expansion; do not expand an unbounded input such as `1-999999999`.
2. Treat an empty group cell as unrestricted only if the existing source contract says so. Support documented all-group forms such as `all` / `all groups`; show a warning for unknown syntax. Do not invent membership from an unknown string.
3. Introduce `selectCourseSessions` using saved enrolment only. Use a separate `selectVisibleSessions` for search/room/tutor/date/optional display choices.
4. Define reminder, attendance and busy-time eligibility explicitly. An optional session can be hidden visually without changing whether the user enrolled in it. Provide a distinct preference for optional/self-study reminder participation.
5. Migrate old choices conservatively: retain existing notification enablement and explain any newly separated choice in Settings. Never turn on a device notification feature merely because the schema changed.
6. Make Clear filters clear only temporary narrowing. Keep group and specialism membership. Display membership separately from the active display-filter count.
7. Route Today/NowNext, statistics, journal, calendar, reminders and group availability to the correct selector. Search is presentation; it must not alter reminder eligibility.

**Files:** `src/lib/filters.ts`, `App.tsx`, `hooks/useNotifications.ts`, `lib/push.ts`, `lib/groups.ts`, `components/FilterSheet.tsx`, `SettingsSheet.tsx`, worker filter functions.

**Tests:** Group 2 in `1-10`; `1, 2, 3`; whitespace/en dash; all groups; empty group; malformed/reversed/oversized ranges; a room filter does not remove a different-room reminder; clearing filters retains membership; both workers and browser agree for a shared fixture.

### P3-02. Make refresh source-scoped and race-safe

**Current issue:** `useTimetableData.ts` performs several async source fetches and updates active screen state after completion. An older profile request can finish after a profile switch. Extra-tab failures are partly tolerated, but a global timestamp is too coarse. Removed sources can linger in caches/history.

**Implementation:**

1. Use an AbortController and a monotonically increasing refresh generation. Every state/cache write must verify the profile, source configuration revision and generation that started the request.
2. A stale request may not publish into the new profile's UI or overwrite its latest cache. Decide explicitly whether its own profile's cache may be updated; cancellation is the simpler initial policy.
3. Represent each timetable, extra tab, deadline tab and notice source with ID/type, `lastAttemptAt`, `lastSuccessAt`, status, warnings and error. A failed attempt does not advance success time.
4. Reconcile events per source. Key ownership by source identity rather than extra-tab array index. Preserve notes/identity history when removing a source, but remove that source's rows from the live schedule and reminder set immediately. Archived evidence must remain discoverable.
5. Use settled per-source results; keep good cached content from a failed source with an explicit stale label. Do not mark the whole profile refreshed because one source succeeded.
6. Revalidate on resume/visibility with throttling, deduplication and bounded retries. Cancel polling while hidden. Manual Refresh should clearly report which sources succeeded.
7. Preserve Phase 2 recovery locks and pending-save errors. A refresh must not bypass a profile deletion or resurrect deleted-profile cache keys.

**Files:** `hooks/useTimetableData.ts`, `lib/gviz.ts`, `lib/history.ts`, `lib/storage.ts`, `types.ts`, `App.tsx`.

**Tests:** deferred A resolves after B; two refreshes resolve in reverse order; profile deleted during fetch; extra tab removed during fetch; one of three sources fails; offline then resume; warning-only source with valid rows; no-data response versus network error. Assert both rendered owner and stored owner.

### P3-03. One date-selection model

Create a profile/device-scoped navigation model with `selectedDateISO`, presentation mode and visible week/month anchor. Today uses the real current date in the course timezone; it is not “the date currently selected in Schedule.”

- Month date click updates the same selected day consumed by the list.
- Week/Month changes preserve selected date. If navigating to another month without a day selection, use a documented rule such as preserving the day number where valid.
- Today resets both selection and the displayed range. A “Today only” display flag must not hide the user's newly selected month date; migrate/remove that conflicting flag.
- Preserve date/mode/scroll when opening details and going Back. Store a return context containing profile, destination, selected date and scroll anchor.
- Midnight rollover updates the Today destination and Today marker without unexpectedly jumping the Schedule selection.

**Files:** `App.tsx`, `AgendaView.tsx`, `WeekView.tsx`, `MonthView.tsx`, `filters.ts`.

**Tests:** select a future date in Month → Week → open session → Back; select empty Sunday; previous/next week; leap day; year boundary; timezone midnight; Today reset from another month.

### P3-04. Calendar, placement and reminder parity

Define a written coverage contract before changing endpoints:

| Consumer | Default scope | User-owned private content |
|---|---|---|
| Today / Schedule | Course membership plus relevant personal commitments | Visible on this device/profile |
| Notifications | Explicit reminder eligibility, independent of screen filters | Only when enabled for the task/commitment |
| Downloaded calendar | Explicitly chosen course/personal scope | Export choice shown before download |
| Subscribed public-sheet feed | Chosen public sources and enrolment rules | Excluded unless a separate secure, explicit mechanism is designed |
| Evidence / attendance | Historical eligible events and linked records | Respect the profile and record type |
| Group availability | Busy/free intervals only | Titles, notes and addresses are not shared |

**Implementation:**

1. Extract shared membership, date/time, placement and eligibility rules. Preserve Phase 2 `eventKey` / `calendarUid`; do not regenerate every UID during the extraction.
2. Model a timed event as a course-local date/time plus a course timezone; distinguish it from an all-day event. Default the current course to Europe/London independently of the device's zone.
3. Choose one tested timezone conversion implementation for both runtimes. Do not parse a local wall time with the worker's default zone. Handle nonexistent and repeated wall times explicitly, with a warning or disambiguation policy; do not silently shift a deadline.
4. Generate calendar times consistently: use UTC instants or correctly declared TZID/VTIMEZONE semantics. Preserve explicit deadline due times. All-day dates use date values and an exclusive end date where appropriate.
5. Fold ICS lines by UTF-8 octets, not JavaScript string length; unfold/reparse in tests. Escape text/UID inputs safely. Keep Unicode titles and source identity intact.
6. Include intended extra tabs and deadlines in app, feed and reminders. Add deadline display to Week. Keep personal content out of public query-string feed URLs.
7. Test source cancellation and rescheduling without uncontrolled duplicate calendar entries. If a provider/client requires additional sequence/cancellation handling, implement it as part of the feed contract and test it.
8. Share placement span expansion. Identify generated days as inferred until confirmed/overridden in Phase 5. Avoid duplicate marker/generated events in statistics or calendars.

**Files:** `lib/ics.ts`, `format.ts`, `placementSpans.ts`, `push.ts`, `notify.ts`, `hooks/useNotifications.ts`, `workers/ics-feed/worker.js`, `workers/push/worker.js`, service-worker source under `public/` (locate the actual notification handler).

**Tests:** all-day and timed deadlines; overnight intervals; Europe/London daylight-saving transitions; a device in another timezone; emoji/accented/long titles; merged source rows; placement spans; stable UID before/after edit; cancellation; opted-out personal task omitted. Import representative output into Google Calendar and Apple Calendar where access is available; report real-client checks separately from automated parser tests.

### P3-05. Profile-scoped notification routing and actions

The current `PendingAction` has `action`, `key`, `at`; it needs an owner. Introduce a versioned notification payload containing `profileId`, stable `eventKey`, record kind, action intent and timestamp. Keep transport identifiers separate from these logical owners.

1. Write the owner when scheduling in-app and worker notifications. Include it in service-worker click/action handling and queued records.
2. On tap, locate the owning profile, switch intentionally, resolve the stable event and open its detail. If unavailable, show a safe “This session is no longer available” view with Changes/history access.
3. On action, update only that profile's metadata. Do not attach an unscoped legacy action to whichever profile happens to be active.
4. Drain actions only after a durable successful apply; preserve failed actions for retry. Deduplicate action IDs so a reload does not repeat an operation.
5. Use task actions for deadlines: Open task / Mark complete / Snooze where supported. Do not present Attended for a submission deadline.
6. Keep a normal notification/body-click path and in-app alternatives for platforms without action buttons. Missing permissions must not break schedule use.

**Tests:** profile A notification tapped while B active; A deleted; event moved with same key; unknown legacy payload; duplicate queue item; storage failure during apply; task versus taught-session actions. Do not test these by sending to real production subscriptions.

### P3-06. Attendance and evidence statistics

Define an eligible completed session once and reuse it in `StatsSheet`, settings summaries, CSV, binder and placement totals. Separate Attended, Absent and Unrecorded; do not treat missing data as absence or silently exclude it to inflate a rate.

Show the chosen denominator in UI: e.g. “8 attended of 12 eligible completed sessions; 2 absent, 2 unrecorded.” If also showing recorded-only attendance, label it separately. Exclude future sessions and non-attendance task records. Optional/self-study/placement eligibility must match the published rule.

Count placement days without double-counting multiple events on the same date. Mark inferred days and missing timetable periods. Teachers' Standards badges measure evidence coverage, not proof of competence or qualification completion.

**Tests:** mixed past/future; all unrecorded; zero denominator; two sessions same placement day; optional/self-study switches; deleted metadata; UI total equals CSV/binder fixture total.

### P3-07. Worker pagination and study-group integrity

Find every KV `list` call in workers and handle cursors until complete with bounded work and scheduled continuation if necessary. A first-page-only list must not silently omit subscriptions or records. Avoid repeatedly scanning expensive collections per request.

Study groups currently identify members using a display name. Add a stable member ID plus a device-held membership capability; keep display name editable. Same-name members remain separate. Make join/update/leave revisioned or transactional using an appropriate Durable Object, following the established sync pattern. KV read-merge-put alone is not strong concurrency protection.

Validate request sizes, dates/intervals and capability scope. Add durable abuse protection where an isolate-local counter is insufficient. Keep telemetry aggregate and avoid logging student notes, addresses, sync codes or push credentials. Measure request/write budgets with synthetic load before increasing polling frequency.

**Tests:** more than one list page; two simultaneous joins; rename; duplicate display names; stale leave/update; invalid intervals; old membership migration; interrupted scheduled run. Use the current Cloudflare transaction documentation when implementing; storage transactions are the relevant primitive, not an invented KV CAS operation. [Cloudflare storage API](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/).

### P3-08. Truthful travel freshness

Introduce a shared travel result envelope containing request identity, origin/destination, mode, intent, `requestedAt`, `fetchedAt`, expiry and status (`loading`, `live`, `cached`, `estimate`, `unavailable`). An estimate must include its basis. Provider live data and an old cached duration must not share a “live” label.

Clear a result as soon as its request identity changes. Countdown rendering must derive from timestamps and stop after expiry; do not keep decrementing a stale departure below zero. Keep address, room, Copy address and external directions available if routes/maps fail. Phase 3 fixes accuracy labels; it does not add tomorrow's arrival-by planning.

**Files:** `hooks/useLiveJourney.ts`, `hooks/useTravel.ts`, `lib/tfl.ts`, `campus.ts`, `weather.ts`, `SessionDetail.tsx`, `HomeCard.tsx`, `RouteSteps.tsx`.

**Phase 3 release gate:** all P3 tests pass on the existing UI, prior Phase 1/2 regressions pass, coverage contract and schema/rollback notes are committed. Do not claim the redesigned UI is complete in this release.

## 5. Phase 4 — daily-use redesign and exact styling specification

**Deliverable:** the reviewed mobile/desktop design implemented against real data and existing functionality. Do not substitute a generic dashboard, a grid of oversized statistic tiles, or static screenshot markup. Use the following values as implementation defaults, refining them only for measured accessibility/reflow needs.

### 5.1 Visual system — build this before moving screens

The desired character is calm, practical and readable: pale slate background, white/raised panels, restrained indigo emphasis, clear time and room labels, thin borders and modest rounding. Use one primary action per decision area. Avoid gradients, glass effects, heavy shadows, decorative illustrations and excessive pills. Subject colours are supporting cues, not replacements for readable labels.

The palette below follows the latest travel concept and harmonises its small differences from the earlier general mockup. These are **target Phase 4 values**, not a description of every current CSS variable.

| Token | Light | Dark | Usage |
|---|---|---|---|
| `--color-bg` | `#F5F6FA` | `#111722` | Page canvas |
| `--color-surface` | `#FFFFFF` | `#1A2230` | Cards, header, navigation |
| `--color-text` | `#202940` | `#E9EDF6` | Main text |
| `--color-muted` | `#5B667B` | `#ADB7CB` | Supporting text |
| `--color-border` | `#DFE4ED` | `#354154` | Separators and card outlines |
| `--color-accent` | `#3E51C7` | `#B1BCFF` | Main actions, selected state, room emphasis |
| `--color-accent-soft` | `#EEF0FF` | `#2A3557` | Selected nav, focus cards, room panel |
| `--color-on-accent` | `#FFFFFF` | `#172041` | Text on filled primary buttons |
| `--color-success` | `#196C54` | `#99DDC6` | Saved/completed status with text |
| `--color-danger` | `#9F1D1D` | `#F3B8B8` | Errors and destructive action text |
| `--color-danger-soft` | `#FDECEA` | `#3A1F1F` | Error container |

Keep semantic tokens. Do not hard-code light backgrounds in feature components. Use `data-theme="light"` / `"dark"` and a system preference fallback compatible with the current app. Explicit light must remain light under a dark OS setting and vice versa. `light-dark()` in prototype CSS is a reference; do not require it if the supported browser baseline needs conventional variable overrides.

**Typography:**

| Role | Size / line height | Weight |
|---|---|---|
| Body and form input | 16px / 1.5 | 400 |
| Page title | 24px / 1.25 | 600 |
| Session / travel page title | 22px / 1.3 | 600 |
| Section / card title | 16–18px / 1.35 | 500–600 |
| Prominent room / journey time | 26px / 1.25 | 600 |
| Supporting metadata | 14px / 1.45 | 400 |
| Caption / nav label | 12px / 1.5 | 400–500 |

Use the existing system stack (`-apple-system`, `BlinkMacSystemFont`, `Segoe UI`, Roboto, sans-serif). Do not fetch a new external font merely to match the word “Inter” in a concept. Use tabular numerals for times. Labels/inputs must not shrink below readable sizes to fit a phone. Two-line title truncation is acceptable only in a constrained grid where the full title remains available in detail; mobile day cards should normally wrap naturally.

**Spacing and shape:**

- Spacing scale: 4, 8, 12, 16, 20, 24, 32px.
- Phone page gutter: 16px; 12px at 320px when necessary. Card padding: 14–16px. Section spacing: 20–24px. Repeated cards: 10–12px.
- Desktop page gutter: 24–32px; gap between grid and detail: 20–24px.
- Radius: controls 10px, small badges 6px, cards 12px, primary next-session/home cards 14px. No rounded phone-frame border around the real app.
- Borders: 1px. Session accent edge: 3px. Use a subtle elevation only for overlays; normal cards are separated by border and space.
- Icon art: consistent 18–20px outline icons, 24px in main navigation, approximately 1.75–2px stroke. Use one bundled/local icon set or a small consistent SVG component family; do not retain a mixture of unrelated emoji for navigation.
- Normal interactive target: at least 44×44px. Bottom-nav item: at least 48px high plus label/padding. Compact density may reduce card gaps/padding, not shrink controls or make essential text unreadable.
- Focus: visible 3px outline in accent with 2px offset; never rely solely on a shadow or remove outline. Selected, today, hover and keyboard focus must remain distinguishable.

The 44px target is this product's preferred touch standard, not a claim that WCAG 2.2 AA universally requires 44px. WCAG's minimum target criterion has a 24px threshold with exceptions. [W3C target-size guidance](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html).

Suggested foundation (adapt names to avoid collisions with existing CSS):

```css
:root {
  --space-1: .25rem;
  --space-2: .5rem;
  --space-3: .75rem;
  --space-4: 1rem;
  --space-5: 1.25rem;
  --space-6: 1.5rem;
  --radius-control: .625rem;
  --radius-card: .75rem;
  --nav-height: 4.5rem;
}
.app-shell { min-height: 100dvh; background: var(--color-bg); }
.page { min-width: 0; padding: 1rem; }
.page--with-nav {
  padding-bottom: calc(var(--nav-height) + env(safe-area-inset-bottom, 0px) + 1rem);
}
.bottom-nav {
  position: fixed; inset: auto 0 0;
  display: grid; grid-template-columns: repeat(4, minmax(0, 1fr));
  padding: .5rem .25rem calc(.5rem + env(safe-area-inset-bottom, 0px));
  background: var(--color-surface); border-top: 1px solid var(--color-border);
}
.button { min-height: 2.75rem; padding: .625rem .875rem; }
.button--primary { background: var(--color-accent); color: var(--color-on-accent); }
:focus-visible { outline: 3px solid var(--color-accent); outline-offset: 2px; }
```

This snippet is a starting contract, not complete production CSS. Provide `vh` fallback if needed, account for the visual viewport/keyboard, and test the actual computed navigation height. Fixed nav must never cover the final card, a form error or the Save button.

### 5.2 Responsive shell and navigation

Use **Today · Schedule · Tasks · PGCE file** as the four top-level destinations. The labels are fixed product language. “Journey home” is an action/destination within travel; it must not be confused with the Today navigation icon.

| Width | Navigation / layout |
|---|---|
| 320–639px | Labelled four-item bottom nav; single column; full-page details; mobile selected-day Schedule |
| 640–1023px | Keep readable labelled navigation; use a wider list/two-column content only when it fits. Detail can remain a full page. Do not squeeze a desktop time grid into this range merely because the device is called a tablet. |
| 1024–1279px | Sidebar 176–200px; main content uses remaining width; week grid or agenda; detail opens as a full-width content view/accessible drawer if grid + panel would be cramped |
| 1280px and above | Sidebar about 200px; main week grid plus 300–340px detail panel; 20–24px gap. Let the grid consume real desktop width. |

These breakpoints refine the prototype's presentation to protect readable text. They are implementation defaults: if measured content fails at a boundary, adjust the breakpoint and document the screenshot comparison. Do not retain the current `.app { max-width: 640px }` restriction on desktop Schedule. Today/Tasks/forms may have a comfortable reading width while the schedule expands.

- Top-level header: page title, active timetable identity, and a small labelled route to Settings/Changes. Search belongs in Schedule and Evidence where useful.
- Settings remains reachable from every top-level destination. Changes must not vanish into an unlabelled emoji.
- Active destination uses soft accent background and text/icon emphasis; set `aria-current="page"`.
- Use the browser history/back model. URL state may be hash-based if that avoids hosting rewrite issues, but preserve existing setup/share and notification links. Respect the Vite base path on both hosts.
- Top-level scroll positions are independent. Back from a detail restores its caller, not always Today.
- A full-page detail replaces bottom navigation on small screens and has a clear Back label plus relevant sticky action. This avoids two competing bottom bars. Returning restores the nav and prior scroll.

### P4-01. Shared primitives and feature-preservation inventory

Before moving functionality, inventory every existing Settings control, PGCE tab, session action, share/export flow and notification toggle. Map it to a new destination. A feature is not migrated until it is reachable and functional in the new shell.

Build Button/IconButton, Card, Field, SegmentedControl, StatusMessage, PageHeader, EmptyState and an accessible dialog/drawer wrapper. Reuse `lib/a11y.ts` for focus behaviour. Make disabled/loading states explicit. Scope feature CSS rather than adding ambiguous global selectors such as `.active` or overriding every `button` repeatedly.

Create a local component/state fixture screen for development or equivalent screenshots in tests; do not expose implementation/debug controls in the shipped user navigation.

### P4-02. Today

**Order of content:**

1. “Today” and full date, with a compact source/sync status when relevant.
2. At most one urgent, actionable item: changed room/time or overdue work. More items link to Changes/Tasks.
3. Next/current session hero: time → title → prominent room/building → useful action.
4. Rest of day in time order, including meaningful gaps and actual clashes.
5. Journey home action; promote to the home card after the day's final relevant commitment.
6. Tomorrow preview or work summary, with restrained density.

```text
Today                                Settings
Monday 7 September
[Room changed · View change]

NEXT · 09:00–11:00
Exploring professionalism
[ Room A5.03                       ]
[ IOE · 20 Bedford Way              ]
[ Open session ]  [ Directions ]

Rest of today
11:30  English 1 · Room 421
       1 hour break
14:30  Maths 1 · Room 731

Journey home                         View →
[Today] [Schedule] [Tasks] [PGCE file]
```

Use `NowNextCard.tsx` / `HomeCard.tsx` logic as inputs, not separate duplicated queries. Prevent auto-scroll from hiding the next-session card. Auto-scroll may be offered within a timeline after deliberate action; it must not reposition the entire landing page unexpectedly.

Move release notes into Help/What's new. Show at most one contextual setup nudge with a dismiss action. Keep important data failures visible even when reducing banners.

**States:** first load skeleton; cached source with last-success time; no sessions today (offer Schedule/Tasks); day finished (Tomorrow + Journey home); optional-only day; source failure; profile with personal tasks only. Never render a blank screen because imported deadlines are absent.

**Acceptance:** time and room are easy to identify from the initial viewport at 390×844. The next-session action opens the correct stable event. Test “find your next room” with users; screenshots alone do not prove task-completion speed.

### P4-03. Mobile Schedule — required layout and interaction

Match the right side of `comparison-mobile-schedule.png`:

1. Header row: **Schedule** left, **Today** reset right. Active timetable/course below in muted text.
2. Week/Month segmented control, followed by week/month navigation. Keep previous/next controls at least 44px and give full accessible labels.
3. In Week mode, seven equal-width day controls, Monday through Sunday. Show short weekday, date number, and a subtle event indicator. Selected date has accent border/soft fill; today has a distinct marker even when another day is selected.
4. Selected date heading plus count below the strip.
5. Only that day's session cards. The user should not scroll through Monday and Tuesday to reach Wednesday.
6. Labelled Search and Filters entry, with active temporary-filter count/context. Their exact toolbar placement may wrap at narrow widths; do not remove them because the focused concept omitted their dialogs.
7. Persistent labelled bottom navigation on the top-level Schedule screen.

**Session card anatomy:** full start–end range in small supporting text, title, room in accent text, building/supporting information. Use white/dark-surface card, 1px border, 3px subject accent edge, 12px rounding and 14px padding. Make the card an actual button/link with a full accessible name. Do not nest unrelated buttons inside that clickable target; place secondary controls outside it if needed.

Meaningful breaks can be small neutral rows, e.g. “30 min break.” Derive them from the canonical day intervals; do not show a break inside overlapping sessions. Do not label a gap “lunch” unless that meaning is configured; the mockup's lunch label is illustrative.

At 320px with 12px gutters, seven day columns are about 42px wide. Keep the day control at least 44px high with a full cell hit area and adequate separation; document this constrained-width exception to the preferred 44px square. Do not shrink all navigation labels to fit. At enlarged text, allow a horizontal day strip with obvious previous/next navigation or a two-row/date-picker alternative instead of clipping. The rest of the page must reflow without horizontal overflow.

**Month:** calendar date selection drives the same list below. Announce the full selected date. Arrow keys move focus predictably in a calendar grid; selection and keyboard focus are separate. Empty days remain interactive. On returning to Week, show the week containing the selected date.

**Context restoration:** capture selected date, mode, search/filter state and a stable scroll anchor before opening detail. Back restores them. A fresh notification entry may have no caller; use its owning profile and a sensible date-targeted Schedule fallback.

**States/tests:** empty day, filtered-empty day with Clear filters, loading, stale cache, long title, long room name, deadline-only day, overlapping lessons, simultaneous specialism choices, weekend event, 320px and 200% text. A grouped “3 specialism options” card is allowed only for genuine alternatives; enrolled simultaneous events must still show a clash.

### P4-04. Desktop Schedule

Use the desktop design's three-part composition: labelled sidebar → week grid → selected-session panel. Show time labels and day headings consistently; use real start/end positioning. Keep a readable minimum day width. If seven days or a narrow viewport would make the grid unusable, provide agenda/selected-day mode rather than miniature event cards.

Use stable subject colours across refresh/order/filter changes. A subject colour comes from a deterministic normalised subject key or persisted map. In dark mode use appropriate soft fills and maintain text contrast. Do not encode optional/self-study/changed status by colour alone.

The selected panel shows title, full date/time, room/building, Moodle, travel tab and evidence controls. At wide widths selection should not cause the whole calendar to jump. At narrower widths open a detail route/drawer with Back/Close and restore focus to the selected event. Do not copy the prototype rule that simply hides the detail panel below a breakpoint while leaving no working alternative.

Overlap layout must pack real simultaneous intervals into columns or an accessible alternative list. Cards shorter than their readable content need a concise label and accessible detail, not silently clipped essential information.

### P4-05. Session Overview and Travel & map

**Mobile:** a full-page route with Back to caller, title, concise date/time/room, then two controls: **Overview** and **Travel & map**. Switching tabs preserves entered notes/draft state and does not remount the entire record form unnecessarily.

**Overview order:**

- Full title and date/time; room prominently grouped with building/address.
- Tutor, membership/optional context and relevant change notice.
- Open Moodle when a valid link exists; otherwise no dead action.
- Attendance status for an eligible taught/placement session, using Attended / Absent / Unrecorded semantics.
- Notes, photos and standards/evidence controls with accurate save/file availability states.
- Calendar/share secondary actions.

A deadline opens **task detail** instead. Do not show attendance controls or campus travel for a submission without a physical location.

**Travel & map order:**

```text
‹ Schedule
PS1 · Professionalism
Mon 7 September · 09:00–11:00 · Room A5.03
[ Overview ] [ Travel & map ]

[ Journey summary + freshness label       ]
[ Origin selector / permission alternative ]
[ IOE · 20 Bedford Way                    ]
[ Room A5.03 · full address               ]
[ Destination map — visible immediately   ]
[ Attribution / destination caption       ]
[ Journey steps     24 min        expand ▾ ]
[ Leg-level warnings when relevant        ]

[ Open in Google Maps                    ]
Opens navigation outside My Timetable
```

Use a map viewport of roughly 164–200px high on a normal phone, with rounded 12px container and a visible attribution caption. The map is a destination map in Phase 4. Do not draw an invented whole-route line. If tiles fail, replace the map area with a calm placeholder containing the destination and retry; keep address/copy/directions working.

Steps default collapsed, with duration and a short mode summary visible. Expanded steps retain walking/transit legs, stop names, durations and available departures. Display disruptions at the affected leg, not only in a distant global banner. Do not run departure polling while the travel view is closed/hidden.

**Phase boundary:** before Phase 6, the summary may say “About 24 min from your selected origin · estimate” or “Journey checked at 08:05.” It may show a current leave-now journey with truthful freshness. It must not say “Leave by 08:26 tomorrow” from today's duration. After Phase 6, replace that summary with the actual date-specific arrival-by plan and buffer control.

The primary navigation action is full-width on mobile, at least 46px high. It may sit in a sticky footer if the content has matching bottom padding and the software keyboard does not hide fields. Its external target must use the selected destination/mode. Keep Back behaviour consistent across Overview and Travel.

### P4-06. Journey home

Replace the tiny house pill's discoverability and the clipped popover, while preserving the useful existing route data.

- Put a labelled **Journey home** action on Today even before the day ends.
- Promote it to a soft-accent “Ready to head home?” card after the final relevant commitment. Use canonical commitments, not the currently filtered screen list. Later personal commitments from Phase 5 participate in this calculation.
- Include destination label, freshness-qualified duration and “View journey.” Allow dismissal for the day; dismissal must not remove the manual action.
- Mobile opens a full-width **Journey home** screen; Back returns to Today/caller. Desktop uses a contained panel with the same component structure.
- Reuse `JourneySummary`, `DestinationCard`, `DestinationMap`, `JourneySteps`, `FreshnessLabel` and `ExternalDirectionsButton` from session travel. Request intent is leave-now to home, not arrival-by for class.
- Make the origin explicit. Current location requires a valid fix; saved campus/placement origins require deliberate selection. Never silently claim the last session's location is the current position.

| State | Required UI |
|---|---|
| No saved home | “Set home location” with a skip/back route |
| Permission disabled/denied | Explain briefly; offer chosen origin or external directions |
| Waiting for fix | Loading state with a usable alternative |
| Near home | Quiet “Near home” state; manual route remains available |
| Route unavailable/offline | Cached timestamp or labelled estimate; address and directions remain |
| Home changed | Immediately remove the previous home's ETA/map before requesting the new route |
| Later commitment remains | No “day finished” claim; manual Journey home still available |

**Layout acceptance:** every home view stays within 320/360/390px bounds. No negative left coordinate like the original popover's reproduced `x = -4`. Include safe-area and enlarged-text checks.

### P4-07. Tasks and PGCE file

**Tasks:** three clear groups/views: Overdue, Upcoming and Completed. Show due date/time and status in text; preserve personal-only tasks. Add task is a labelled primary action. Completed records remain retrievable, never eligible for overdue/reminder prompts. Phase 4 reorganises existing behaviour; Phase 5 adds complete editing/work plans.

**PGCE file:** four understandable sections, preserving all existing record types:

| New section | Existing functionality to retain |
|---|---|
| Placement | School/mentor details, placement days, attendance; future hours/exceptions |
| Evidence & reflections | Session notes/photos, standards tags, weekly reflections, evidence journal |
| Development | Targets, meeting records/actions, observations, lessons and subject-knowledge audits |
| Documents | Wallet files, exports, binder entry point |

Each overview count links to the underlying list. Show positive first-use guidance such as “Add your first reflection,” not a red failure state for every empty standard. Evidence coverage is not a competency score. Keep files' local availability clear and preserve export/print access.

### P4-08. Focused Settings and data health

Split the long sheet into focused pages with titles, Back and labelled groups:

1. **My timetable:** profiles, sources/tabs, course membership, notices/deadlines, refresh and source warnings.
2. **Reminders:** per-device permission/subscription status, offsets, quiet hours and supported actions.
3. **Travel & home:** permission, mode, saved home/origins, placement locations, current limits.
4. **Connected calendars:** feed/export scope, calendar links, copy actions and privacy explanation.
5. **Data & devices:** save state, sync code/status, last successful source updates, backup/export/import, local file availability, storage estimate, recovery help and profile deletion.
6. **Appearance:** system/light/dark, comfortable/compact density.
7. **Help & privacy:** setup help, feature coverage, What's new, data destinations and opt-outs.

Data health should be a readable status list, not a wall of alarming badges. Distinguish “Saved on this device,” “Sync queued,” “Sync failed,” “File on another device,” “Backup prepared” and “Source last updated.” A browser download handoff is not proof the user retained the backup file. Use `navigator.storage.estimate()` where available and request persistence contextually; report denied/unavailable without claiming guaranteed storage.

Import preview should evolve from Phase 2's confirmation into an accessible summary/dialog showing profiles, record types, file counts, version/history limitations and replacements. Preserve validation and rollback; a prettier preview must not weaken them. Profile deletion must explain the actual local/shared effect, while disabling a device permission must not delete shared course records.

### P4-09. Onboarding and source repair

Implement **Connect → Personalise → Preview**:

- Connect: paste supported public sheet URL; validate early; explain public access; show fetching/error states. Preserve Demo. Optional permissions are not prerequisites.
- Personalise: identify source names/types, group and specialism options, and required column mappings. Where tab discovery is not supported by the available API, show a paste-tab alternative rather than inventing a complete tab list.
- Preview: show representative upcoming sessions, selected membership, source warnings, duplicates and ignored rows. Let the user go Back without losing their choices. Commit the new profile only after a successful validated preview.
- Repair: show source/row number, problem and meaningful action (change mapping, correct sheet, ignore with clear consequence). Do not quietly reinterpret invalid dates or invent missing times.

Persist unfinished setup as a local draft if appropriate. A failed import must not replace the existing profile. Avoid fake progress percentages for a request with no known total.

### P4-10. Accessibility and visual acceptance

Use semantic headings, labelled controls, full-date accessible names, focus restoration, keyboard-operable tabs/calendar, and announcements for meaningful async results. Preserve reduced-motion support. Keep focus on the triggering control after a failed save; move focus deliberately after navigation. Do not focus-trap a desktop nonmodal side panel.

Test a 320 CSS-pixel-wide layout and enlarged content without forcing ordinary reading into two-direction scrolling. A genuinely two-dimensional calendar may need an alternative list. This is a product test matrix informed by reflow guidance, not an accessibility certification. [W3C reflow guidance](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html).

**Required screenshot matrix:** Today; Schedule Week and Month; session Overview; Travel & map collapsed/expanded; home entry/route; Tasks; PGCE overview; each Settings category; onboarding steps. Capture relevant loading/empty/error states in addition to the happy path.

- Widths: 320, 360, 390, 768, 1024 and 1440px.
- Light and dark, including explicit theme overriding OS preference.
- 200% text/zoom; long title, long address, many filters, no room, no route.
- Keyboard focus path and open/close/back restoration.
- Real iOS/Android install, safe areas, keyboard and resume where devices are available. Record untested platforms explicitly.

Use deterministic seeded fixtures matching the concept (7 September 2026 demo) for before/after screenshots. Keep all network requests intercepted except the local test server. Assert that primary actions actually work, not merely that their text exists.

Compare implementation and target at the same viewport. Fix hierarchy, geometry and overflow before superficial pixel tweaks. Important pass/fail questions: is the next room prominent; can any day be selected directly; does Back preserve context; is home clearly a journey; is the map visible in its tab; are labels readable; do errors retain usable actions? Do not “approve” screenshot differences by replacing expected images without reviewing them.

**Phase 4 release gate:** all old functionality has a mapped destination; all screen flows use live application state; data tests remain green; layout/accessibility checks are recorded; no precise future travel promise ships ahead of Phase 6.

## 6. Phase 5 — editable planning and PGCE workflows

**Deliverable:** users can correct, recover, find and export their work. Complete editing/drafts before adding planning features. All new screens use Phase 4 primitives and navigation; do not introduce a second form style.

### P5-01. Complete Tasks CRUD and linked work

**Current starting points:** `AddDeadlineSheet.tsx`, `KeyDatesSheet.tsx`, `Settings.customKeyDates`, session metadata status, mentor actions in `admin.ts`.

1. Create a normalised user-task collection with stable ID, profile, title, due date, optional due time/timezone, status, created/updated revision and tombstone. Keep source-imported deadlines as source-owned records with user progress metadata.
2. Migrate existing personal deadlines without losing the Phase 2 owner key or completion state. Back up/test old settings-based records. Do not regenerate task identity when changing title or due date.
3. Support create, edit, duplicate, complete/reopen, delete and undo-delete. Duplicate receives a new ID and should not inherit completed status accidentally. Undo writes a revision newer than the delete tombstone; do not merely remove the tombstone locally.
4. For an imported deadline, allow progress/notes/reminder preferences; show the source and explain which fields must be corrected there. Do not silently overwrite a sheet-owned due date.
5. Project mentor actions/targets into Tasks using a source reference such as `{kind:'meeting-action', meetingId, actionId}`. Completion updates the owner record. Do not maintain conflicting duplicate status in two independent collections.
6. Add a dedicated task detail: title, source, due date/time, status, notes, related work, reminder choice and edit menu. Attendance and travel are absent unless the item represents a physical commitment with relevant location.
7. Extend validation, backup/restore, sync merges and profile cleanup with per-task revisions. A whole-profile last-write-wins settings field is not sufficient for concurrent task edits.

**UI:** task rows use a clear status control plus title and due label. Status uses text and an icon, not only a colour. The edit page has labelled fields and a persistent Save action that does not overlap the keyboard. Overdue is a derived state, not a separate copied record.

**Tests:** edit an overdue task without losing completion history; same task edited on two devices; two different tasks edited concurrently; repeat import; undo after sync; duplicate; imported versus personal field permissions; linked mentor action completes in both views exactly once.

### P5-02. Edit every PGCE record and recover drafts

Support editing for reflections, targets, meetings/actions, observations, lessons and audits. Use the existing field structures in `src/lib/admin.ts`; do not drop fields during UI extraction. Notes/standards/photo editing remains linked to the original stable session owner.

Proposed local draft envelope:

```ts
interface DraftEnvelope<T> {
  version: 1;
  profileId: string;
  recordKind: string;
  recordId: string;       // allocate once for a new record
  baseRevision: number;  // saved revision when editing began
  savedAt: number;       // draft persistence timestamp
  value: T;
}
```

**Implementation:**

- Store drafts by profile + kind + ID, with validation and bounded sizes. Debounce text input locally; show Draft saved only after successful persistence. Never claim a failed quota write is saved.
- Recover the draft when returning from another tab/screen, reloading, or resuming after a crash. Make “Continue draft” and “Discard draft” explicit.
- Save validates the draft, checks the latest record revision, commits through the existing persistence layer and then removes/marks the draft committed. A failed save keeps the draft.
- If sync changed the same record while editing, show the saved version and local draft with Keep mine / Use latest / Review changes as appropriate. Preserve both until a deliberate choice. Do not overwrite a draft on a visibility refresh or remote-apply event.
- For multi-field records, a conflict on one field should not automatically discard unrelated edits. Use base/current/draft comparisons for a three-way merge when safe; otherwise require review.
- Deleting a profile cleans its drafts as part of the same ownership policy. A draft for a deleted record must not silently resurrect it on reopen.
- Add edit and delete actions consistently in lists and detail pages. Destructive actions use clear labels and an undo/recovery path matching the actual persistence semantics.

**Record coverage:** Reflection (week, went well, challenges, focus, standards); Target (text, status, set/met dates, standards/source); Meeting (date, discussion, individually identified actions); Observation (date, observer, subject, focus, strengths, development); Lesson (date, class, subject, evaluation, standards); Audit (subject, stage, date, note). Validate dates and enum values at persistence entry points, not only in HTML inputs.

**Tests:** type → navigate → return; reload; switch profile; incoming sync during typing; deleted remote record; quota failure; Save then immediate close; repeated Save; concurrent unrelated records; focus/error announcement. Verify every record type, not just reflections.

### P5-03. Placement hours, exceptions and corrected attendance

Separate the source's inferred placement plan from the user's confirmed/logged experience.

Proposed data: placement period, school, timezone, default working hours; per-date exception (holiday, inset, part-day, cancelled, custom hours); attendance/logged hours with revision and provenance. An exception should refer to a stable placement/date identity and survive source refresh.

- Apply exceptions after shared span expansion. Do not rewrite the sheet's marker event or permanently delete generated source rows to model a holiday.
- Show Planned days/hours separately from Logged days/hours. A missing record is unrecorded, not automatically absent.
- Inset days may count differently by course policy; make the policy configurable/explicit rather than assuming all non-teaching days count or do not count.
- Validate end after start, interval overlaps and reasonable duration. Support a break duration if required. Do not imply minute-level accuracy from a whole-day attendance tick.
- Show “Inferred from timetable” until confirmed. Keep provenance in exports.
- Reuse Phase 3 eligibility/timezone rules so UI, statistics, calendar and binder agree.

**UI:** Placement overview → calendar/list → date detail → exception/log form. Use neutral planned styling, an explicit confirmed/logged indicator, and an explanation for excluded days. Do not rely on red/green cells alone.

**Tests:** weekend skip; school holiday; inset policy; half-day; changed working hours; two source rows same date; correction after sync; missing source days; DST boundary; repeat restore; planned/logged totals match the export.

### P5-04. Evidence search and binder preview

Search session notes, photo captions, reflections, lesson evaluations, targets and appropriate record text using a local index or an incremental computed selector. Start with a simple deterministic implementation; avoid an unnecessary external search service.

- Index by stable record identity/profile, not array position. Update on save/delete/sync/restore.
- Support query, date range, record type, standards and Untagged filters. Empty results distinguish no evidence from an over-restrictive filter.
- Show a short result excerpt, date, record type and standards; open the source record. Preserve search context on Back.
- Introduce photo captions as separately validated metadata if not already present; include them in backup/sync while file bytes remain local until Phase 7.
- Before binder export, show date range, selected sections, eligible record counts, page/section preview where feasible, and file availability. A missing attachment must be labelled; do not silently generate a supposedly complete evidence pack.
- Preserve semantic headings, readable print layout and image orientation. Avoid splitting a heading from its first content or stretching photos. Use print CSS and the existing binder/bundle generators before adding another rendering stack.
- Show progress for actual work, cancellation if long-running, and an export error state that preserves the current selections.

**Files:** `JournalSheet.tsx`, `lib/printBinder.ts`, `printBundle.ts`, `photos.ts`, `standards.ts`, relevant PGCE pages.

**Tests:** orphaned legacy note discoverable; untagged filter; edited/deleted search result; another profile's private record excluded; missing local photo; Unicode/long note; preview count equals output; selected sections only; landscape photo; empty export.

### P5-05. Assignment work plans

Add subtasks, milestones, estimated effort and optional study blocks under a single parent deadline. Give every child a stable ID and revision. A milestone is not a duplicate deadline; a study block refers to its parent task.

Changing the parent due date should identify affected planned blocks and offer a review, not silently shift all user appointments. Completing a subtask updates progress; completing the assignment should offer an explicit policy for unfinished children. Keep historical completion dates if introduced.

**UI:** task detail → Work plan section, simple checklist and milestone list, total estimated effort, Add study block. Keep the main due date/status visible. Do not turn the phone view into a wide project-management table.

**Tests:** parent edited/deleted; child deleted on another device; restored work plan; progress calculation; zero effort; a planned block clashes with a session; no duplicate assignment in Tasks.

### P5-06. Personal commitments and study blocks

Store personal appointments/work/study blocks separately from imported sessions. Minimum fields: stable ID, profile, title, interval/timezone, kind, optional location, busy/free participation, reminder choice and revision/tombstone. If recurrence is added, define occurrence identity and exceptions first; otherwise ship explicit individual events and do not imply recurring support.

Feed relevant commitments into Schedule, Today, clash detection, group busy/free calculation and the end-of-day home prompt. Mark them “Personal” or by kind so users can tell them from imported course rows. Imported sources must never overwrite them.

Sharing/exporting personal events is opt-in with a clear scope. Group availability sends only intervals, not titles/notes/location. Use the existing privacy and encryption boundaries.

**Tests:** personal evening appointment prevents “day finished”; private title absent from availability payload; edit interval preserves note/identity; offline creation; duplicate/undo; overlap with study block; calendar export respects inclusion choice.

**Phase 5 release gate:** all supported record types are editable and drafts recover; every new collection participates in backup/sync/delete; placement/evidence totals are consistent; work plans and personal commitments reference their canonical records.

## 7. Phase 6 — accurate travel planning and collaboration

**Deliverable:** the Phase 4 travel presentation gains actual date-specific planning. Do not create a separate “smart travel” UI with different controls or colours.

### P6-01. Arrival-by routing and arrival buffer

Extend the request model beyond the current `tflRoute(from, to)` signature. A proposed neutral contract is:

```ts
type JourneyIntent =
  | { kind: 'leave-now'; requestedAt: string }
  | { kind: 'arrive-by'; arriveBy: string; timeZone: string; eventKey: string };

interface JourneyRequest {
  profileId: string;
  origin: { lat: number; lng: number; label: string; basis: 'device' | 'saved' };
  destination: { lat: number; lng: number; label: string };
  mode: 'walking' | 'transit' | 'driving';
  intent: JourneyIntent;
  arrivalBufferMinutes: number;
}
```

The exact type names may differ, but preserve the request's date, timezone and intent. A returned itinerary should include actual departure/arrival instants, legs with times, duration including waits/transfers, provider/source, requested intent and freshness. Do not reduce the provider response to only `minutes`.

**Algorithm:**

1. Resolve session start in the course timezone using Phase 3 rules.
2. Compute required arrival = session start minus the chosen arrival buffer.
3. Request an itinerary for that actual date/time and arrival intent, if the provider supports it for that mode/area.
4. Select a feasible itinerary and use its departure instant for Leave by. Duration includes waiting and transfers; do not independently subtract a second duration from the already planned departure.
5. If there is no feasible itinerary, say so and offer alternatives/external navigation. If the provider supports only leave-now, label it accordingly; never fabricate a future plan.
6. Align leave reminders with the same itinerary/request ID. A changed buffer or event time invalidates both display and reminder plan.
7. Late departure state: say the planned departure has passed, offer a refreshed leave-now route and a truthful arrival estimate. Avoid a negative countdown.

The concept's `09:00 - 10 min buffer = 08:50 arrival`, with a sample 24-minute itinerary departing 08:26, is a deterministic UI fixture only. In real implementation, the provider's feasible itinerary determines departure. Verify the current provider API's date/time/mode/arrival parameters against official documentation at implementation time; do not assume a parameter name from this handoff.

**Tests:** tomorrow versus today; changed start time; zero/large buffer; overnight arrival; DST ambiguity; missed last service; no itinerary; provider only supports leave-now; displayed plan and notification refer to the same departure; invalid response rejected.

### P6-02. Explicit origins and strict invalidation

Support current device location, a saved campus origin, a saved placement origin and a user-selected saved origin. Show the basis and time of a device fix. Let the user change origin without changing the event itself.

The cache/request key must include origin, destination, mode, intent/date/time, relevant timezone and buffer. Old results must disappear immediately when any of these change. Abort obsolete requests and ignore late results; otherwise a fast origin switch can show the previous destination's ETA.

Do not represent a denied or stale device fix as “Current location.” Provide a saved-origin selector and external directions. Any coordinate rounding used for cache efficiency must be intentional and must not conflate materially different entrances/destinations. Do not describe approximate campus coordinates as a verified accessible entrance.

**Tests:** A route resolves after user switches to B; mode changes; home changes; permission revoked; stale location; no location; selected placement address geocodes elsewhere; profile switch while routing; route cache does not cross profiles incorrectly.

### P6-03. Forecasts, disruptions and departure boards

Forecasts should refer to the destination and journey/session time, not just current campus weather. Keep provider timestamps and forecast validity. Display only forecasts in the provider's supported horizon; otherwise say unavailable.

Match disruptions to actual itinerary legs/lines. Departure boards should identify the stop, direction and relevant service; do not show unrelated nearby arrivals. Pause/clear expired data when hidden/offline. Poll according to documented provider limits with backoff; do not introduce per-second network requests for a UI countdown.

Keep address, room, Copy address and external navigation when any provider fails. A map outage is not a route outage, and a route outage is not permission to hide the destination. Separate these states in the presentation.

**UI:** reuse Travel & map summary/destination/map/steps. Leg warnings appear adjacent to that leg. A concise freshness label is always visible; details explain source and checked time. Avoid stacking multiple red banners for the same failed network connection.

**Tests:** route succeeds/map fails; map succeeds/route fails; forecast outside horizon; departure expired; cancelled service; wrong direction; offline resume; retry; no actionable disruption.

### P6-04. Complete the journey-home itinerary

Use the same request/result model with `leave-now` intent and saved home destination. Show Leaving now plus a provider-derived arrival estimate, current/saved origin and mode. Do not reuse an earlier session's arrival-by request as the home route.

Recompute/invalidate after home, mode or origin changes. Respect the Phase 5 personal-commitment-aware end-of-day prompt and daily dismissal. Near-home detection should be a quiet status, not a forced redirect or deletion of the manual action. Do not hard-code the example home or a rigid proximity threshold into user-facing certainty; describe approximate proximity honestly.

**Tests:** home changed while request pending; current location already near home; no home; earlier manual journey; personal commitment later; leave-now request timestamp updates; external directions use home rather than the last campus destination.

### P6-05. Study-group availability and proposals

Build on Phase 3 stable membership/capability handling. Each member's availability includes generation time, horizon/timezone and relevant busy intervals. Define a freshness policy and show Last updated; stale or unavailable members must not appear confidently free.

- Merge course busy time with opted-in personal busy blocks from Phase 5.
- Intersect intervals with explicit working hours/minimum meeting length; handle cross-day/timezone boundaries.
- Propose a meeting slot with stable proposal ID, revision, participants and status. Sending a proposal is an explicit user action, not an automatic message to others.
- Export an accepted/chosen slot to a calendar with stable identity. Do not claim it has been inserted into everyone's calendars without an authorised integration.
- Keep names editable, same-name members distinct, and availability titles/private details absent from server payloads.
- Refresh availability only when relevant data changes or the freshness policy requires it; show failures and retries.

**Tests:** same-name members; stale member; missing member availability; personal busy block; timezone difference; simultaneous proposal edits; member leaves; export identity; privacy inspection of request payloads.

**Phase 6 release gate:** actual future-date itinerary intent is proven by request fixtures; buffer/reminders agree; stale results cannot survive destination changes; external navigation works through failures; group availability is current, private and concurrency-safe.

## 8. Phase 7 — optional course and media expansion

**Deliverable:** extensibility after the core app is dependable. These items may be released separately and must not delay earlier phases.

### P7-01. Configurable courses, campuses and templates

Extract UCL/PGCE-specific constants into a versioned course configuration: source definitions, timezone, membership terminology, building aliases/coordinates, placement policy and optional terminology labels. Keep the existing UCL/PGCE setup as a first-class built-in configuration and a migration fixture.

- Add a schema/validator and a user-facing configuration flow for another course. Validate coordinates, URLs, timezones, source IDs and field mappings. Avoid asking ordinary users to edit raw JSON.
- Persist per-profile configuration identity/version. A template update must not overwrite the user's personal home, reminders, notes or edits.
- Templates share intended public course/source settings only. Strip sync codes, device subscriptions, private addresses, evidence and personal commitments.
- Reuse the Phase 3 timezone model everywhere; do not create an alternate timezone conversion path for new courses.
- Unknown buildings show raw location text and manual/external directions instead of geocoding to an unrelated similarly named campus.

**UI:** extend My timetable/onboarding with course/template selection and a preview. Keep the Phase 4 shell, spacing and typography unchanged. Use labels from configuration only where needed; do not turn the app into a generic admin dashboard.

**Tests:** current PGCE migration; second course with another timezone; missing building; two courses same subject name; invalid template; template update preserves personal data; portable share payload contains no secrets.

### P7-02. Opted-in encrypted attachment sync

Phase 2 only syncs metadata. Do not enable file upload just because a sync code already exists. Start with an explicit opt-in explaining which files, approximate size, retention, removal and recovery behaviour. Verify the chosen storage/provider capabilities and costs before implementation; adding a paid service is not pre-authorised by this document.

**Proposed architecture:**

1. Attachment manifest keyed by profile/record owner and stable attachment UID, with content hash, MIME/name/size, revision, deletion marker and availability. Keep local numeric IndexedDB IDs as an implementation detail.
2. Encrypt bytes on the device before upload using a reviewed authenticated-encryption design with unique nonces and defined key lifecycle. Do not invent cryptography or use the sync-code hash as a raw file key. Document how code/key rotation affects existing files.
3. Put ciphertext in object/blob storage designed for files; keep small revisioned manifests in the existing sync layer or an appropriate strongly consistent metadata store. Do not stuff base64 images into the existing 400,000-character encrypted record blob.
4. Upload chunks or whole files with idempotent identifiers, integrity verification, bounded concurrency and retries. Commit “available remotely” only after a verified complete upload. An interrupted transfer must not expose a supposedly complete file.
5. Download to a staged local record, verify/decrypt, then commit atomically. A quota failure preserves the remote record and existing local files.
6. Explicit states: local only, queued, uploading, available on another device, downloading, available here, failed, deleted. Status follows actual bytes/manifest state rather than a photo count.
7. Define delete-from-this-device versus delete-everywhere. Shared deletion uses tombstones; no offline device may resurrect a deleted manifest on reconnect. Define retention and garbage collection before deleting unreachable ciphertext.
8. Extend backup/recovery to include manifests and all locally available files; disclose remote-only files. Keep an export option that downloads/collects all requested attachments before claiming a complete backup.
9. Test key rotation, revoked code/device access and loss-of-key recovery honestly. Never imply an operator can recover encrypted files without the necessary key.

**UI:** reuse Documents/Evidence file rows and Data & devices status. Show file-level progress only when the transfer provides a meaningful byte count. Provide retry/cancel and storage explanation without blocking timetable use.

**Tests:** two-device download; interrupted/repeated upload; duplicate content; corrupted ciphertext; wrong key; quota failure; offline delete/reconnect; manifest conflict; code rotation; zero-byte file; large file limit; backup with remote-only file; MIME/filename handling.

### P7-03. Full-route maps and verified accessibility details

Keep the Phase 4 destination map as fallback. Only draw a full route when provider geometry is available and permitted for use. Straight lines between stop coordinates are not a navigable route.

- Introduce a map adapter behind the existing travel UI. Feed it provider geometry, origin/destination markers and optional selected leg. Preserve attribution/licensing and provider usage limits.
- Selecting a journey leg highlights the corresponding geometry and keeps a textual equivalent. Fit the initial bounds to the route with sensible padding; avoid repeated zoom jumps during minor live updates.
- Make map controls keyboard/touch accessible and avoid trapping page scrolling. Text directions remain the primary accessible alternative.
- Entrance/accessibility details require a verified source, checked date and a way to report uncertainty. Do not label an approximate building centre as an accessible entrance or infer step-free access from a line colour.
- Handle absent/partial geometry, provider failure and offline state with destination-only map/address/steps. Avoid caching map tiles for offline use without checking provider terms.

**Tests:** geometry present/absent/partial; selected leg; long route; marker bounds; keyboard control; tile failure; attribution; stale entrance information; route and text disagree; no false accessibility claim.

**Phase 7 release gate:** another course works without source-code edits, file availability reflects verified bytes with encryption/retry/deletion coverage, and any route lines/entrance claims are backed by actual provider data.

## 9. Cross-phase test and release contract

### 9.1 Fixture catalogue

Maintain reusable synthetic fixtures rather than a different ad hoc dataset for every screen:

| Fixture | Purpose |
|---|---|
| `course-basic` | September demo week with ordinary sessions, rooms and tutors |
| `membership-ranges` | Group lists/ranges/all-groups and simultaneous specialisms |
| `sources-partial-failure` | Main + extra + deadline tab, one failed/stale source |
| `profile-race` | Profiles A/B with delayed requests and different ownership |
| `calendar-timezones` | All-day/timed/overnight/deadline/DST/Unicode cases |
| `evidence-history` | Old owner key, rescheduled event, orphan note and missing photo |
| `tasks-personal-only` | No imported deadlines, overdue personal item and completed item |
| `draft-conflict` | Local draft plus newer remote revision |
| `travel-states` | Live/cached/estimate/no route/denied location/map failure |
| `home-with-later-commitment` | Final class finished but a personal commitment remains |
| `multi-device` | Concurrent edits, equal-timestamp delete, offline reconnection |
| `legacy-backups` | Supported v2/v3/v4 backups, attachments and invalid payloads |

Use fixed dates/clocks for screenshots and reminder logic. Do not record a real student address, sync code, photo, subscription or analytics ID in fixtures. Existing `tests/fixtures.ts` blocks external browser requests; preserve this isolation when adding routes. A test that accidentally hits production is not acceptable validation.

### 9.2 What to test at each layer

- **Neutral unit tests:** membership, identity, eligibility, date/time, interval math, merge/tombstones, payload schemas, ICS folding and travel request identity.
- **Browser integration tests:** persistence/IndexedDB commit/rollback, drafts, cross-tab behaviour, backup preview/import, actual page navigation and forms.
- **Worker tests:** request validation, capability scope, pagination, revision conflicts, compatible old/new endpoint responses and scheduler logic using synthetic storage/providers.
- **Visual checks:** deterministic screenshots at required widths/themes, overflow bounds, focus visibility, sticky navigation/action areas and long content.
- **Real-device checks:** installation/resume, notifications/actions, location permission, sharing/downloads, safe-area/keyboard behaviour. Keep “not tested on hardware” separate from automated success.
- **Usability checks:** ask representative users to find their next room, open the home route, select Friday, change a task and recover a draft. Record observations; do not invent measured improvements from a redesign screenshot.

Add meaningful regression tests for the bug's trigger and outcome. Avoid tests that merely repeat implementation details or assert that a CSS class exists. Do not weaken existing tests to make a redesign pass.

### 9.3 Required development/release sequence

1. Confirm the current branch, working tree and phase scope. Read `AGENTS.md`; preserve concurrent changes.
2. Add failing regression coverage for the targeted data/behaviour bug where appropriate.
3. Implement the smallest compatible contract change. Include migration, validation, backup/restore/sync/delete support for any new stored entity.
4. Build the real UI using the specified primitives and inspect it at the target widths/themes.
5. Run the relevant tests and the repository gate. For routing/base-path changes, run both layouts:

   ```bash
   npm run validate
   VERCEL=1 npm run validate
   ```

6. Record implementation, known limits and rollback in `PLAN.md` / `DEPLOYMENT.md`. Use the current npm lockfile; do not upgrade unrelated dependencies in a UI phase.
7. If deployment is part of the authorised task, follow the project driver:

   ```bash
   ./scripts/deploy.sh preflight
   ./scripts/deploy.sh build
   ./scripts/deploy.sh workers   # when workers/shared worker code changed
   git push origin main         # only after compatible worker deployment
   ./scripts/deploy.sh verify
   ```

8. Verify the **exact released commit** in GitHub Actions and Vercel status, not merely that both homepages return 200. Run `verify` after rollout and report its output verbatim, as `AGENTS.md` requires.
9. For schema changes, document how to recover both old and newly written data. Reverting UI code does not undo a data migration. Preserve Phase 2 sync protection and tombstones in any rollback.

Do not change the Vercel skip-browser gate back to an unsupported Chromium launch. The full browser gate belongs in GitHub Actions and local validation. Do not deploy a new worker contract after the new frontend has already shipped.

### 9.4 Completion record required for each phase

At the end of a phase, update the implementation log with:

```text
Phase / work-item IDs completed:
Commit and branch:
User-visible behaviour:
Stored schema/contract changes:
Migration and rollback:
Automated checks + results:
Screenshots (viewport/theme/state):
Real-device/usability checks actually performed:
Known limitations / intentionally deferred work:
Worker versions + hosted commit statuses (if deployed):
Live endpoint verification output:
```

A phase is not complete just because a mockup exists, TypeScript compiles, or a homepage loads. Its listed exit criteria and preservation checks must pass. If a provider/platform requirement prevents part of the phase, state exactly what remains and keep it pending rather than substituting a fictional implementation.

## 10. Ready-to-use instruction for the next AI

Copy this prompt together with the repository and this handoff bundle:

> Continue the My Timetable PWA from its current main branch. Read AGENTS.md, DEPLOYMENT.md, PLAN.md, TIMETABLE_PWA_ENHANCEMENTS.md and TIMETABLE_PWA_REMAINING_PHASES_IMPLEMENTATION.md. Phases 1–2 are implemented; verify the current baseline rather than repeating them. Implement Phase 3 first, following P3-01 through P3-08 and preserving the existing data/notification/sync safeguards. Do not implement later phases without instruction. For any later UI phase, inspect the supplied before/after PNGs and HTML concept CSS, follow the exact design tokens and responsive/state specifications, and build functional React screens against real selectors rather than static mockups. Preserve every existing user feature, stable owner, tombstone and recovery path. Add meaningful regression coverage, test both hosting base paths when affected, document migrations/rollback, and follow the repository release runbook when deployment is authorised. Report what actually passed and any remaining work.

For Phase 4, replace the phase sentence with: “Implement Phase 4 using Sections 5.1–5.2 and P4-01 through P4-10; retain the Phase 3 data contracts and do not ship future-session arrival-by claims before Phase 6.” Use the analogous numbered work items for Phases 5–7.

## 11. Phase 2 verification record

Release baseline: `439371d3a8e1660352f84f6dcdd00931e5a94dd5` on main. GitHub Actions and Vercel reported success. [GitHub Pages deployment run](https://github.com/AbdulWSaqib1996/timetable-pwa/actions/runs/34104462069).

Read-only live verification completed 7 September 2026:

```text
== verify live endpoints ==
PASS: vercel app 200
PASS: pages app 200
PASS: push worker /vapid
PASS: /stats locked (401)
PASS: feed worker + cache header
PASS: analytics dashboard 200
done.
```

This handoff does not implement Phases 3–7. It is the specification and acceptance contract for their development. Reference-source pages cited here were checked when writing; verify provider APIs, limits and platform behaviour again when implementing the relevant phase.
