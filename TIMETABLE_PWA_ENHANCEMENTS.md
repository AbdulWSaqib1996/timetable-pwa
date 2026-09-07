# My Timetable — project review and enhancement proposal

Reviewed 6 September 2026. Source revision: `f3bbadd`.

**Latest addition:** Section 7 is the unified seven-phase roadmap for all bug fixes, UI changes and new enhancements. It replaces the earlier phase lists. Section 10 retains the detailed travel/home/mobile Schedule visual comparisons.

**Project:** `/Users/abdulsaqib/Documents/Personal/Projects/timetable-pwa`

**Recommendation:** retain the existing React PWA and its useful PGCE functionality. First fix data integrity and notification issues, then reorganise the interface around **Today, Schedule, Tasks and PGCE file**. Add new features selectively once those foundations are reliable.

The original project was not edited, committed or deployed. This report, design previews, screenshots and isolated review checks live in `/Users/abdulsaqib/Documents/ChatGPT/Timetable PWA/`. The review covers the frontend, data model, parsing, persistence, sync, notifications, travel integrations, exports, workers, analytics, deployment and tests. It is a code and usability review, not a production penetration test or a complete accessibility certification.

## 1. What already exists

This is a substantial course companion, rather than just a timetable viewer. Avoid proposing the following as brand-new features:

| Area | Existing functionality | Opportunity |
|---|---|---|
| Timetable | Public Google Sheets import; multiple profiles and merged tabs; specialism/group filters; search; day/week/month views; history retention; change log | More trustworthy import, consistent filters and navigation |
| Planning | Clash labels, free gaps, key dates, personal deadlines, submission status | Overdue visibility, editing, planned work and consistent calendar coverage |
| Travel | Campus matching, building/room separation, walking/transit/driving estimates, TfL journeys and departures, weather, journey home | Route freshness, arrival-time planning and clear permission states |
| Reminders | Session/deadline/leave reminders, quiet hours, attendance prompts, background push, briefings and digests | Device-scoped testing, coherent reminder scope and diagnostics |
| PGCE | Attendance/absence, placement day counts, school and mentor details, targets, meetings, observations, lessons, audits, reflections | Editable records, recoverable drafts and useful next actions |
| Evidence | Notes, photos, Teachers’ Standards tags, journal, document wallet, printable binder | Stable record identity, better retrieval and export controls |
| Data | Local storage and IndexedDB; JSON backup/restore; encrypted optional sync | Honest saved/synced states, conflict handling and reliable restoration |
| Sharing | Setup links, calendar download and subscription, week/stat images, study-group availability | Parity between outputs, freshness and membership identity |
| Operations | Two frontend hosts, two Cloudflare Workers, KV state, analytics dashboard, deployment scripts | Better test coverage, staging, deployment consistency and documentation |

Keep the small dependency footprint, offline cache, room parsing, readable room-change messages, code splitting for secondary screens, focus styling, reduced-motion support and existing dialog focus helper.

## 2. Findings to address first

**Evidence labels:** “Reproduced” means an isolated check confirmed the behaviour. “Code finding” means the implementation shows the issue, but the relevant production integration was not exercised. P0 means urgent; P1 means address before expanding the product; P2 means follow-up improvement.

### P0 — notification testing broadcasts to the cohort

**Code finding.** `sendTestPush()` calls the worker’s `POST /test`. That endpoint iterates the subscription list and sends a test to every listed subscriber. It has a ten-minute lock, but no authentication check or caller-device restriction. This is also a mismatch with a user testing notifications on their own phone.

**Proposal:** make the normal test target a verified subscription belonging to the requesting device. Put any administrator broadcast behind separate authentication and an explicit audience preview. Do not use a broadcast as a connectivity check.

**Acceptance:** a test from device A sends exactly one notification to A; unauthenticated broadcast attempts fail; no production test is needed for CI.

Evidence: [test helper](/Users/abdulsaqib/Documents/Personal/Projects/timetable-pwa/src/lib/pushCheck.ts:121), [worker handler](/Users/abdulsaqib/Documents/Personal/Projects/timetable-pwa/workers/push/worker.js:1180). This endpoint was **not invoked** during the review.

### P1 — rescheduling can detach evidence and change calendar identity

**Reproduced.** Session metadata is keyed by date, start time and title. Moving “English 1” from 09:00 to 09:30 changes that key, so notes, attendance and photo ownership no longer match the visible session. The change log reports a removal and addition instead of a move. Separately, calendar UIDs derive from row-position-based session IDs; inserting rows can change event identities.

**Proposal:** introduce a persistent source event ID, ideally an explicit sheet column. Where it is unavailable, maintain a reconciliation map and ask for review when matching is ambiguous. Keep date/time/title as editable fields. Migrate existing metadata and photo owners; use the persistent ID for calendar UIDs too.

**Acceptance:** time/title/date changes retain notes, attendance and attachments; row insertion does not duplicate subscribed events; ambiguous matches do not silently attach evidence to the wrong lesson.

Evidence: [session identity](/Users/abdulsaqib/Documents/Personal/Projects/timetable-pwa/src/lib/diff.ts:5), [parser](/Users/abdulsaqib/Documents/Personal/Projects/timetable-pwa/src/lib/parseTimetable.ts:231), [calendar export](/Users/abdulsaqib/Documents/Personal/Projects/timetable-pwa/src/lib/ics.ts:36).

### P1 — filters can hide required sessions and affect unrelated tools

**Reproduced.** Selecting Group 2 excludes a row labelled `1-10`: group parsing splits commas but does not expand ranges. This format appears in the built-in demo. “Clear all filters” also clears the user's specialisms and groups.

**Code finding.** `exportSessions` uses presentation filters and is reused for reminders, evidence, statistics and study-group availability. A temporary room or placement-only filter can therefore change more than the visible timetable. The worker and calendar feed apply different subsets of those settings.

**Proposal:** distinguish permanent enrolment choices from temporary view filters. Define one canonical “my course sessions” collection for reminders, records and availability. Allow explicitly labelled “export current view” separately. Parse ranges and common “all groups” forms through a shared policy.

**Acceptance:** Group 2 sees a `1-10` session; clearing a view filter preserves enrolment; searching or filtering does not silently suppress reminders or make a busy person appear free.

Evidence: [group matching](/Users/abdulsaqib/Documents/Personal/Projects/timetable-pwa/src/lib/filters.ts:27), [shared filtered collection](/Users/abdulsaqib/Documents/Personal/Projects/timetable-pwa/src/App.tsx:438).

### P1 — overdue work disappears from the deadline list

**Reproduced.** The Key dates sheet filters out every past date, including incomplete deadlines. The main countdown also only considers today onward. A missed deadline can become less visible precisely when it needs attention.

**Code findings.** Personal deadlines can be added and deleted but have no edit flow. The status control cycles through symbols. Custom deadlines do not enable the “View all key dates” filter control because that checks sheet-loaded key dates. Session detail exposes attendance controls even for deadlines.

**Proposal:** a Tasks destination with Overdue, Upcoming and Completed; explicit status selection; edit, duplicate and undo-delete; an Add task action within the list. Use a dedicated deadline detail view with due time, status and supporting work. Suppress reminders for completed tasks; the foreground deadline loop currently does not check completion.

**Acceptance:** incomplete past deadlines stay visible; editing retains notes/status; a completed item stops reminders; personal-only users can always reach the full list.

Evidence: [deadline list](/Users/abdulsaqib/Documents/Personal/Projects/timetable-pwa/src/components/KeyDatesSheet.tsx:44), [add form](/Users/abdulsaqib/Documents/Personal/Projects/timetable-pwa/src/components/AddDeadlineSheet.tsx:10), [foreground reminders](/Users/abdulsaqib/Documents/Personal/Projects/timetable-pwa/src/hooks/useNotifications.ts:243).

### P1 — sync can resurrect deletions and miss PGCE-only edits

**Reproduced:** merging an older remote admin record restores a locally deleted item. The merge has no deletion markers. Removing the last field of session metadata similarly deletes the entry rather than preserving a timestamped deletion.

**Code findings:** automatic sync depends on `store` and `metaMap`, while PGCE forms update `adminFile`; an admin-only edit does not itself schedule a push. “Sync now” pushes without first pulling. The remote profile store replaces the local store wholesale, and preferences that belong to a device are included. Synced photo counts can exist on devices that do not have the photo blobs.

**Proposal:** track changes for every synced collection; preserve deletion markers; separate device settings from course data; use revisions and a merge-before-write cycle with concurrency protection. Show queued, syncing, synced and failed states. Distinguish evidence metadata from attachments available locally. Preserve drafts through any reload.

**Acceptance:** offline edits on two devices survive reconnection; deleted records stay deleted; a reflection-only edit syncs; device A’s notification permission/theme choice does not misrepresent device B; attachment availability is accurate.

Evidence: [auto-sync dependencies](/Users/abdulsaqib/Documents/Personal/Projects/timetable-pwa/src/App.tsx:278), [merge/apply](/Users/abdulsaqib/Documents/Personal/Projects/timetable-pwa/src/lib/sync.ts:194), [admin merge](/Users/abdulsaqib/Documents/Personal/Projects/timetable-pwa/src/lib/admin.ts:124).

### P1 — saving, restoring and deleting need trustworthy outcomes

**Code findings.** Storage writes commonly swallow errors. Backup import performs minimal structural validation, writes the profile store before importing attachments, and can report success with skipped files. Reimporting attachments appends them. Profile deletion removes localStorage records but does not clear that profile’s IndexedDB photos or wallet files. Backup export excludes cached timetable/history, although notes still depend on those session records for discovery.

**Proposal:** visible persistence failures; versioned schema validation; restore preview showing profiles, records and files; staged import with rollback; idempotent attachment IDs; history/event snapshots in backups; explicit profile-scoped attachment cleanup. Show backup completion only after the export is successfully prepared and handed off, with clear wording about where the user saves it.

**Acceptance:** corrupt files change nothing; repeated restore does not duplicate attachments; export failures are visible; deleting a profile covers its attachments; a fresh-device restore can find notes for sessions that disappeared from the source sheet.

Evidence: [storage and backup](/Users/abdulsaqib/Documents/Personal/Projects/timetable-pwa/src/lib/storage.ts:25), [photos](/Users/abdulsaqib/Documents/Personal/Projects/timetable-pwa/src/lib/photos.ts:117), [wallet](/Users/abdulsaqib/Documents/Personal/Projects/timetable-pwa/src/lib/wallet.ts:102).

### P1 — refreshing can show stale or wrong-profile results

**Code findings.** Refresh has no cancellation or active-profile guard, so a delayed response from a previously active profile can update the shared UI state. Extra-tab failures are ignored; deadline failures fall back to cached data while the overall update timestamp advances. The refresh-on-settings-change effect does not refresh when the final extra tab or deadline source is removed. Foreground sheet refresh is primarily mount/manual driven; resuming the app checks sync and service-worker updates but does not directly revalidate the visible timetable.

**Proposal:** cancel or discard stale requests; track success/error timestamps separately for each source; distinguish cached data from confirmed-fresh data; refresh on resume with sensible throttling and retry; clear removed-source data immediately.

**Acceptance:** slow profile A never overwrites profile B’s screen; a failed deadline source says so; removed tabs disappear immediately; returning after a room change refreshes the timetable without needing to discover ↻.

Evidence: [data hook](/Users/abdulsaqib/Documents/Personal/Projects/timetable-pwa/src/hooks/useTimetableData.ts:35).

### P1 — calendar, notification and app coverage differ

**Code findings.** The live feed supports the main tab, specialism selection, self-study choice, a key-date tab and placement details. It does not include all merged tabs, group/optional/subject filters or personal deadlines. Push config also omits personal deadlines and merged tabs. Week view receives regular sessions without the merged deadline collection. ICS output treats deadlines as all-day even when a due time was entered; timed events use floating local time; line folding counts string characters instead of UTF-8 octets.

**Proposal:** publish a clear coverage contract and reuse canonical event/filter logic across frontend and workers. Preserve actual due times, define a course timezone and retain stable event IDs. Show a subscription preview and explain whether personal tasks are included. Do not send personal content to a feed server implicitly.

**Acceptance:** the same enrolled sessions appear in the app, reminder schedule and feed; optional differences are explicit; deadlines appear in Week; a 17:00 due time survives export; Unicode and timezone cases import correctly in representative calendar clients.

Evidence: [feed URL](/Users/abdulsaqib/Documents/Personal/Projects/timetable-pwa/src/components/SettingsSheet.tsx:56), [feed worker](/Users/abdulsaqib/Documents/Personal/Projects/timetable-pwa/workers/ics-feed/worker.js:302), [push config](/Users/abdulsaqib/Documents/Personal/Projects/timetable-pwa/src/lib/push.ts:42), [ICS](/Users/abdulsaqib/Documents/Personal/Projects/timetable-pwa/src/lib/ics.ts:8). Calendar recommendations follow [RFC 5545](https://www.rfc-editor.org/rfc/rfc5545.html), especially content lines, date-time values and UID properties.

### P1 — notification actions are not scoped to a profile

**Code finding.** Queued notification actions contain action, session key and timestamp, but no profile ID. On startup they are applied to the active profile; an open window receives the action without profile routing. Clicking a notification usually focuses an existing window rather than opening the relevant session.

**Proposal:** carry profile ID, stable event ID and action type end to end. Route the action to its owner regardless of the active profile. Open the relevant detail view. Deadline notifications should offer task actions rather than “Attended”.

**Acceptance:** a reminder for profile A cannot change B; a tap opens the correct event; unsupported notification actions have a clear in-app fallback.

Evidence: [service worker actions](/Users/abdulsaqib/Documents/Personal/Projects/timetable-pwa/public/sw-push.js:130), [queue type](/Users/abdulsaqib/Documents/Personal/Projects/timetable-pwa/src/lib/pendingActions.ts:6).

### P2 — dates and navigation need a consistent model

**Reproduced:** with the “Today only” filter enabled, selecting 8 September in Month switches to Day but still shows 7 September. The selected date and filtered collection disagree. Parser helpers also accept impossible values such as `31/02/2026` and `25:99`.

**Code findings:** date parsing can forward-fill an invalid date from the previous row, and callers ignore parser warnings. Placement expansion assumes weekdays with default times; long timetable gaps are labelled as breaks without a confirmed academic calendar.

**Proposal:** share a selected date across views, keep Today as an explicit reset, validate dates/times with row-level feedback, and distinguish inferred placement days/gaps from confirmed holidays. Provide configurable school-day exceptions.

**Acceptance:** picking a date shows that date or a truthful empty state; invalid rows are identified before import; holidays are not silently counted as placement days.

Evidence: [month-to-day navigation](/Users/abdulsaqib/Documents/Personal/Projects/timetable-pwa/src/App.tsx:951), [parser](/Users/abdulsaqib/Documents/Personal/Projects/timetable-pwa/src/lib/parseTimetable.ts:62), [placement expansion](/Users/abdulsaqib/Documents/Personal/Projects/timetable-pwa/src/lib/placementSpans.ts:41).

### P2 — records and statistics need clearer meaning

**Code findings.** Attendance denominators include all sessions dated today, including sessions that have not finished. Unmarked sessions reduce the displayed attendance percentage. PGCE forms largely support add/delete rather than editing, and form drafts disappear when their tab unmounts. Evidence tags can be counted without substantive evidence. Different statistics/export paths use slightly different eligible-session rules.

**Proposal:** distinguish Attended, Absent and Unrecorded; only count eligible completed sessions; agree placement/optional/self-study rules in one place. Add record editing, draft recovery and undo. Label standards counts as evidence coverage, not an assessment of competence.

**Acceptance:** an afternoon session does not reduce attendance in the morning; unrecorded is not implied absence; every record can be corrected; export totals match the UI.

Evidence: [attendance statistics](/Users/abdulsaqib/Documents/Personal/Projects/timetable-pwa/src/components/StatsSheet.tsx:43), [PGCE forms](/Users/abdulsaqib/Documents/Personal/Projects/timetable-pwa/src/components/AdminSheet.tsx:80).

## 3. Recommended user experience

### Navigation and structure

Use four persistent, visibly labelled destinations on mobile. Use the same names in a desktop sidebar.

| Destination | Purpose | Existing features relocated here |
|---|---|---|
| **Today** | “What is next, where is it, and what needs attention?” | Now/Next, today's sessions, relevant change/deadline, contextual journey home |
| **Schedule** | Browse and plan dates | Agenda, Week, Month, date jump, search, view filters, calendar sharing |
| **Tasks** | Track work to completion | Key dates, personal deadlines, mentor actions; later, subtasks and study blocks |
| **PGCE file** | Maintain course records | Placement, evidence/reflections, development records, wallet and exports |

Keep Settings and Changes accessible in the header. Settings should contain configuration; routine coursework should have a direct destination. Keep advanced worker URLs under an Advanced section.

### Today

- Keep the next session visible on entry. The current agenda auto-scroll can put the Now/Next card above the viewport.
- Separate the session's short display title, explanatory subtitle, time and room. Preserve the original full title in details.
- Promote the room number and building, with a clear Directions action. Do not require location permission just to open directions.
- Show the rest of today as compact rows. Offer tomorrow through Schedule rather than a continuous multi-month list on the home screen.
- Collapse optional setup into one small contextual prompt. Move release notes into Changes/Help. Show urgent changes before routine onboarding.
- Show “No sessions today”, “All done today” and offline/stale states explicitly.

### Session and deadline detail

- On mobile, use a full-page detail view with a Back action and preserved scroll position; on desktop, show a side panel beside the selected calendar event.
- Put time, room, Moodle and Directions first. Put notes/evidence and travel/map into focused sections.
- Keep maps out of the initial Overview. As refined in Section 10, opening Travel & map shows the destination map with expandable journey steps. The original Section 4 capture is blank because external map requests were deliberately blocked; it is not evidence of a production map outage.
- Present attendance when relevant to a completed teaching/placement session. Use task status for a deadline.
- Provide visible labels on fields, clear saved/error status, attachment progress and recoverable drafts.

### Settings

The measured demo Settings sheet has **18 h3 sections, 3,439px of content and a 715px visible area**: approximately 4.8 visible sheet heights. Real sheet profiles expose additional sections.

Replace it with a short index: My timetable; Reminders; Travel & home; Connected calendars; Data & devices; Appearance; Help & privacy. Each row should show a meaningful current state and open one focused page. Separate “disable on this device” from deleting shared data. Explain local-only files and encrypted sync in the data page.

### PGCE file

Group eight peer tabs into four areas: Placement; Evidence & reflections; Development; Documents. Keep the underlying record types accessible inside these groups. Offer useful next actions, such as writing the first reflection or completing an outstanding mentor action. A new user should see a helpful start state rather than a red warning for all eight empty standards.

Retain a progress overview for established users. Let counts open their corresponding records, and support binder preview with date range and section selection.

### First use

Use **Connect → Personalise → Preview**. Validate the source and show row issues before saving. Confirm group and specialism choices against a few actual sessions. Show clearly what will be excluded. Keep the demo accessible without setup. Explain public-sheet access beside the field; ask for optional notifications/location when those features are first used.

The current copy promises “any Google Sheet” but the parser expects recognisable timetable columns. Narrow that wording or implement column mapping. Tab discovery and preview appear in the historical plan but are not implemented in the current setup screen.

### Desktop and accessibility

The current `.app` remains **640px wide at a 1,440px viewport**. Use the available space for a readable week calendar and optional detail panel. At smaller widths, collapse the panel first; on phones, use a readable agenda. Group simultaneous specialism alternatives with an explicit selection action, while retaining real clash warnings for sessions the user attends.

Use a restrained indigo accent, neutral surfaces, consistent icons and spacing. Normalise subject colours if retained; the current colour hash includes numbered titles, so related sessions can change colour. Support system/light/dark themes and comfortable/compact density.

Add visible and programmatic field labels, full date names on calendar buttons, correct keyboard behaviour for view controls, and complete modal behaviour for the specialism picker. Preserve existing focus and reduced-motion support. Use approximately 44px touch targets as a design goal; the WCAG 2.2 AA minimum is 24px with exceptions, so a 36px button is not automatically a failure. Test reflow at 320 CSS pixels and enlarged text. See [W3C target-size guidance](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html) and [W3C reflow guidance](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html).

## 4. Visual design comparisons

**Before** images are real screenshots of the unchanged local production build using built-in demo data. The clock was fixed to **Monday 7 September 2026 at 08:15 London time** for a repeatable next-session state. Mobile captures are 390×844; the original desktop capture is 1440×960. Network integrations were blocked in the screenshot run. **After** images are design concepts, not implemented app screens. They reuse the demo session content; labels are shortened for scanning without changing underlying events.

The concepts are interactive in the accompanying previews, but actions only navigate the mockup or describe the proposed result. They do not connect accounts, save course data or send notifications. The Today concept intentionally focuses on one day; Schedule retains longer-range browsing.

### Today — clearer priority and labeled navigation

![Today before and after](</Users/abdulsaqib/Documents/ChatGPT/Timetable PWA/review/screenshots/comparison-today.png>)

### Session — room and actions before secondary detail

![Session before and after](</Users/abdulsaqib/Documents/ChatGPT/Timetable PWA/review/screenshots/comparison-session.png>)

### Settings — a short index instead of one long form

![Settings before and after](</Users/abdulsaqib/Documents/ChatGPT/Timetable PWA/review/screenshots/comparison-settings.png>)

### First use — a guided connection flow

![First use before and after](</Users/abdulsaqib/Documents/ChatGPT/Timetable PWA/review/screenshots/comparison-setup.png>)

### PGCE file — a useful starting point and grouped tools

![PGCE file before and after](</Users/abdulsaqib/Documents/ChatGPT/Timetable PWA/review/screenshots/comparison-pgce.png>)

### Desktop — use the width for planning

![Desktop before and after](</Users/abdulsaqib/Documents/ChatGPT/Timetable PWA/review/screenshots/comparison-desktop.png>)

The desktop concept groups the three simultaneous Thursday specialism alternatives into a selectable summary. It retains the later Science specialism. This is a proposed interaction, not removal of sessions from the source.

## 5. Further functionality worth adding

Effort is relative: S = a contained change; M = several UI/data changes; L = changes spanning persistence, workers or migrations. These are planning judgments, not delivery estimates.

| Enhancement | Benefit and proposed scope | Priority / effort | Completion criterion |
|---|---|---|---|
| **Editable tasks and overdue inbox** | Edit deadlines; explicit statuses; undo; combine course deadlines and mentor actions without duplicating them | P1 / M | Missed work stays visible and can be corrected |
| **Import preview and repair** | Column mapping, source names, validation warnings, duplicate preview, specialism/group confirmation | P1 / M | A user can diagnose an unsuitable sheet without a blank timetable |
| **Data health centre** | Per-source freshness; last successful sync/backup; attachment availability; storage use and persistence request | P1 / M | Users can tell what is saved, current and recoverable |
| **Record editing and draft recovery** | Edit reflections, observations, lessons and meetings; recover interrupted forms; undo deletion | P1 / M | Navigating away or reopening does not lose a draft |
| **Assignment work plans** | Subtasks, estimated work, milestones and optional study blocks linked to one deadline | P2 / M | A deadline can become a realistic plan, not just another reminder |
| **Personal events and commitments** | Add appointments, part-time work and study blocks separately from imported sessions | P2 / M | Busy time is respected by personal and study-group availability |
| **Placement calendar exceptions** | School hours, holidays, inset days, part days and corrected attendance | P2 / M | Planned versus logged school days are transparent and correctable |
| **Evidence retrieval and binder preview** | Search notes, captions and records; filter untagged evidence; choose export sections/date ranges | P2 / M | Find an existing piece of evidence quickly and preview exactly what is exported |
| **Travel planned for the session** | Arrival-by journeys, destination-specific forecast, configurable buffer, stale-data timestamp | P2 / M | Tomorrow’s route is not presented as a live route calculated for now |
| **Study-group scheduling** | Availability freshness, personal busy blocks, stable member IDs, proposed meeting slots and calendar export | P2 / M–L | Same-name members do not overwrite each other; stale availability is marked |
| **Course/source configuration** | Campus-independent location mapping, course timezone and reusable cohort setup templates | P3 / L | Another course can configure the app without changing UCL-specific source code |
| **Optional attachment sync** | Explicit opt-in for encrypted photo/document transfer with limits and retention controls | P3 / L | A second device can retrieve a file without implying current text-only sync already does this |

Persistent storage is a useful mitigation, not a replacement for backups; browsers control quotas and eviction. Use `navigator.storage.estimate()` and a contextual persistence request with appropriate fallbacks. See [MDN StorageManager](https://developer.mozilla.org/en-US/docs/Web/API/StorageManager) and [storage eviction guidance](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria).

Defer a full framework rewrite, mandatory accounts, paid infrastructure, AI-generated reflections and a complex social feed. The current product has enough useful capability to justify improving coherence and reliability first.

## 6. Technical and operational recommendations

1. **Create shared domain logic.** Parsing, placement expansion, group matching, identity and calendar rules are duplicated across the frontend and two workers. Extract testable, runtime-neutral modules and fixture-based parity tests. Keep this incremental.
2. **Split responsibilities.** `App.tsx` is 1,183 lines; `SettingsSheet.tsx` is 1,339; the push worker is 1,439; CSS is 2,418. Separate source loading, course selection, device settings, navigation, record persistence and worker services along actual behaviours.
3. **Add validation at trust boundaries.** Validate backup/share payloads, worker config, subscription endpoints and array/size limits. Use HTTPS endpoint validation and deliberate outbound-request policy. The hand-written Web Push implementation merits focused review before substantial expansion.
4. **Make offline states explicit.** Cached TfL responses can be consumed by helpers that label them live; there is no consistent source timestamp in the view model. Distinguish live, cached and estimated. Retain address/directions when a map is unavailable.
5. **Clarify privacy by feature.** Setup broadly says data stays on the device, but optional sync, push, availability sharing and default-on analytics have different behaviours. Home/placement geocoding and transit requests send location data to their service providers. Describe those specific flows; encrypted sync includes settings but does not transfer wallet/photo blobs. Prefer “pseudonymous device usage” to an unqualified anonymity claim. This is product transparency guidance, not a legal compliance assessment.
6. **Harden worker scaling deliberately.** KV list calls need pagination where collections can exceed one page; the cron and test handler currently iterate a single listed page. Best-effort in-memory rate limits are not global quota enforcement. Add isolated staging, error reporting and write-budget monitoring before increasing usage. Study groups use display names as identity and read-modify-write a shared record; address identity and concurrent membership updates before expanding collaboration.
7. **Align deployment checks.** Pages has a Playwright gate; Vercel deployment is documented as independent without that gate. Apply a common validation policy. Keep worker-first sequencing for compatible cross-cutting changes, and continue protecting existing KV/VAPID state. The deployment driver should explicitly fail if polling exhausts its timeout and should select the triggered workflow by identity rather than simply the latest run.
8. **Refresh documentation.** The historical plan still describes no backend and an undeployed feed near the top, while later notes and `DEPLOYMENT.md` describe deployed workers. Separate current architecture from historical decisions; avoid promises of CSV fallback/tab discovery that are not in the implementation.

## 7. Unified phased implementation roadmap

This is the **single implementation sequence** for the findings, UI designs and enhancements in Sections 2–6 and 10. It replaces the earlier A–D outline and travel-specific delivery sequence. All phases are **proposed, not started**. The application remains unchanged.

Retain the existing React PWA. Deliver small, independently verifiable changes within each phase rather than one large rewrite. A phase is complete when its exit criteria pass; calendar estimates should be set after the migration and integration work is broken into implementation tasks. Existing priority labels describe severity, while this sequence also accounts for dependencies.

| Phase | Outcome | Main scope | Dependency |
|---|---|---|---|
| **1. Contain immediate risks** | Safe notification testing and releases | Cohort broadcast fix, urgent deadline fixes, staging, release checks | Start here |
| **2. Make saved data trustworthy** | Stable records, recoverable storage and sync | Event identity, migration, restore, deletion, sync and parser validation | Phase 1 test safeguards |
| **3. Make the app and integrations consistent** | One reliable schedule across screens and services | Enrolment/filter rules, source refresh, calendar/reminder parity, statistics and worker fixes | Phase 2 identities and schemas |
| **4. Redesign daily use** | Clear mobile and desktop navigation | Today, Schedule, Tasks, PGCE file, Settings, setup, session and home-journey UI | Phases 2–3 data and state contracts |
| **5. Complete planning and PGCE workflows** | Work and evidence can be edited, planned and retrieved | Tasks, drafts, placement exceptions, personal events, evidence search and binder preview | Phase 4 navigation; Phase 2 persistence |
| **6. Add smarter travel and collaboration** | Journeys and group plans reflect real intent | Arrival-by travel, buffers, forecasts, home origins and group scheduling | Phases 3–5 canonical schedule and commitments |
| **7. Extend to other courses and richer media** | Optional broader use | Configurable courses/campuses, attachment sync and full-route maps | Stable core plus explicit product need |

### Phase 1 — contain immediate risks

**Purpose:** remove urgent harmful behaviour and establish a reliable way to validate subsequent changes.

1. Restrict the push test to a verified subscription belonging to the requesting device. Keep any administrator broadcast separate, authenticated and explicit about its audience. Review endpoint/configuration validation and the hand-written Web Push path before extending it.
2. Apply the small urgent deadline fixes in the existing interface: retain incomplete overdue items, stop foreground reminders for completed tasks, and make personal-only deadline lists reachable. The full Tasks redesign follows in Phase 4.
3. Establish isolated frontend/worker fixtures and a dedicated test subscription. Reproduce the review's critical failures as regression cases. Do not exercise tests against cohort subscribers, production analytics or shared production records.
4. Make Pages and Vercel use equivalent build/check gates. Fix deployment polling so it tracks the intended workflow run and fails on timeout. Preserve KV/VAPID state; use compatible worker-first rollout when frontend changes depend on new worker behaviour.
5. Correct misleading current documentation and copy about supported sheet formats, attachment sync and which optional features send data to providers. Keep a clear record of current architecture and deployment procedures.

**Exit criteria:** a notification test reaches exactly its requesting device; unauthorised broadcasts fail; overdue work remains visible and completed work stops foreground reminders; failed checks prevent release; deployment timeout is reported as failure.

**Release:** a contained corrective release. Do not wait for the redesign to deliver these fixes.

**Implementation status (7 September 2026):** Phase 1 is released, including the subsequent Vercel build-image fix. Phase 2 is implemented on `codex/phase-2` and is passing the local release checks; hosted rollout and final endpoint verification are the remaining release steps. Implementation details, legacy-format compatibility and rollback are in `PLAN.md` and `DEPLOYMENT.md`. The review and before/after designs elsewhere in this document describe the original baseline and later planned UI phases.

### Phase 2 — make saved data trustworthy

**Purpose:** protect existing profiles, notes, photos and records before moving their interfaces or expanding their use.

1. Add visible save/export errors and versioned payload validation. Build a recoverable backup/restore path before migrating storage: include event/history snapshots needed to discover old notes, preview profiles/records/files, stage import with rollback, and use idempotent attachment IDs. A failed or repeated import must not corrupt or duplicate data.
2. Introduce stable event IDs across session metadata, photos, change history, notifications and calendar UIDs. Prefer a source event ID; otherwise maintain a reconciliation map and expose ambiguous matches for review. Migrate legacy owners without guessing when the evidence is insufficient. Include calendar UID transition handling so existing subscribers do not receive an uncontrolled duplicate event set.
3. Make profile deletion clean up that profile's photos and wallet files as well as localStorage records. Preserve isolation between profiles.
4. Repair sync: timestamped deletion markers, revision-aware merge-before-write, concurrency protection, and change tracking for every synced collection, including PGCE-only edits. Separate device preferences from shared course data. Avoid replacing the complete profile store indiscriminately. Identify attachments that exist only on another device instead of equating a photo count with a local file.
5. Validate real dates and times, surface row warnings, and prevent invalid-row forward-fill. Validate backup/share payloads and worker configuration at their entry points, including size limits and allowed endpoint schemes.
6. Extract the relevant identity, storage and parsing responsibilities incrementally from large modules. Introduce shared runtime-neutral data contracts for the frontend and workers; avoid a broad refactor detached from a behavioural fix.

**Exit criteria:** rescheduling retains evidence and attendance; invalid imports leave existing data intact; repeated restore does not duplicate files; old-session notes remain discoverable; deletion survives two-device reconnection; a reflection-only edit syncs; profile deletion removes its files; interrupted migration can be recovered from a verified backup.

**Release:** storage compatibility must be demonstrated using legacy fixtures before rollout. Define rollback for both old and newly written records; reverting application code alone may not reverse a data migration.

### Phase 3 — make the app and integrations consistent

**Purpose:** establish dependable schedule membership, dates and freshness before redesigning the screens that present them.

1. Create the canonical “my course sessions” collection. Parse group ranges and all-group forms; separate permanent enrolment from temporary search/view filters. Clearing filters must preserve group/specialism choices. Reminders, records, statistics and availability must use their intended canonical collection, with “export current view” offered separately.
2. Fix refresh ownership and freshness: cancel/discard obsolete profile requests, remove data when its source is removed, track success/error timestamps per source, and revalidate on resume with throttling/retry. Preserve truthful cached/offline/error states rather than advancing a global success timestamp after partial failure.
3. Introduce one selected-date model across Day/Week/Month, including Today reset and truthful empty states. Fix the “Today only” versus month selection conflict now; Phase 4 changes its presentation.
4. Align the app, push worker, calendar feed and exports through shared filtering/date/placement rules and parity fixtures. Include merged tabs and intended deadline coverage. Preserve due times, stable IDs, course timezone, daylight-saving behaviour and UTF-8 line folding. Define opt-in scope before personal tasks are sent to a feed or push service. Include deadlines in Week and publish the coverage contract.
5. Scope notification payloads and queued actions by profile ID and stable event ID; open the correct detail on a tap, route actions to their owner and give deadlines task actions. Handle old or unresolvable payloads safely and offer in-app fallbacks where platform actions are unavailable.
6. Correct attendance/statistics semantics: distinguish Attended, Absent and Unrecorded; count eligible completed sessions; share optional/self-study/placement eligibility rules with exports. Label standards counts as evidence coverage. Mark inferred placement days and timetable gaps honestly until explicit exceptions arrive in Phase 5.
7. Repair worker pagination, concurrent study-group membership updates and display-name-based member identity. Add appropriate durable rate enforcement where needed, error reporting and write-budget monitoring before growing traffic or collaboration features.
8. Add a shared travel freshness representation. Distinguish live, cached and estimated results, stop displaying expired countdowns and preserve address/directions when route or map data is unavailable. This fixes misleading status independently of advanced journey planning.

**Exit criteria:** Group 2 sees sessions marked `1-10`; a temporary filter cannot suppress unrelated reminders; delayed profile A cannot overwrite B; removed sources disappear; selected dates agree across views; calendar/reminder parity fixtures pass; timed deadlines survive calendar import; profile A notifications cannot change B; UI/export attendance totals agree; cached travel is not labelled live.

**Release:** a reliability release on the existing UI. All P1 correctness issues from the review should be resolved here or in Phases 1–2 before feature expansion.

### Phase 4 — redesign daily use

**Purpose:** apply the reviewed visual direction to working features backed by the corrected data model.

1. Introduce the shared interface foundation: consistent spacing/icons, stable subject colours, system/light/dark themes and comfortable/compact density. Use **Today, Schedule, Tasks and PGCE file** as labelled mobile bottom navigation and desktop sidebar destinations. Keep Settings and Changes easy to reach.
2. Redesign **Today** around the next session, prominent room/building, urgent change or deadline, and a compact list for the rest of the day. Fix auto-scroll hiding Now/Next. Reduce setup prompts and relocate release notes. Provide no-sessions, finished-day, loading, stale and offline states.
3. Redesign **Schedule** with a mobile day strip, readable selected-day cards, shared Week/Month selection, Today reset, search and labelled filters. Preserve date, mode and scroll when returning from details. Keep overlap/optional indicators and meaningful breaks. Use a wider desktop week grid with a detail panel; group simultaneous specialism alternatives without hiding genuine clashes.
4. Replace the long mobile session sheet with a full-page detail and Back action; use a desktop side panel. Keep time, room, Moodle and directions easy to find. Separate **Overview** from **Travel & map**. Give deadlines their own task detail instead of attendance controls. Show map content when Travel & map is opened; keep it out of the initial Overview and make journey steps expandable.
5. Make **Journey home** visible on Today and promote it after the relevant day's final commitment. Keep it accessible earlier, support dismissal, and do not infer the day's end from a temporary filtered view. Replace the clipped mobile popover with a full-width journey screen. Keep session and home destinations distinct, show the current travel estimate/status, and offer a clear external navigation action.
6. Build the **Tasks** destination around Overdue, Upcoming and Completed, explicit status, and Add task. Preserve the Phase 1 fixes. Full editing and work plans are completed in Phase 5.
7. Reorganise **PGCE file** into Placement, Evidence & reflections, Development and Documents. Preserve every record type, link overview counts to records, and provide helpful first-use states instead of warnings for every empty standard.
8. Replace Settings with focused pages: My timetable; Reminders; Travel & home; Connected calendars; Data & devices; Appearance; Help & privacy. Build the data health centre with per-source freshness, save/sync/backup status, attachment availability, storage usage and an appropriate persistence request. Distinguish disabling a device feature from deleting shared data.
9. Implement **Connect → Personalise → Preview** onboarding using Phase 2 validation: source names, supported tab discovery, column mapping/repair, row warnings, duplicate preview, and group/specialism confirmation against actual sessions. Preserve the demo. Request optional permissions at the relevant feature and explain public-sheet requirements.
10. Apply accessibility throughout: field labels, full date labels, keyboard navigation, modal focus behaviour, safe-area spacing, usable touch targets, enlarged text and 320px reflow. Split App/Settings/CSS responsibilities as these screens move; retain the existing focus and reduced-motion support.

**Exit criteria:** core screens work on phone and desktop; the next room is quickly discoverable; days can be selected without scrolling through the week; returning from a session preserves context; the home route is labelled and fits the viewport; personal-only tasks remain accessible; existing settings and PGCE record types remain reachable; save and source failures have truthful visible states. Validate the usability targets in Section 8 with representative users rather than claiming them from screenshots alone.

**Design boundary:** the UI may show current or estimated travel already supported by the app. Do not ship the mockup's precise future-session “leave by” promise until Phase 6 supplies arrival-by planning. Use the latest Section 10 map treatment: map visible within Travel & map, journey steps expandable.

### Phase 5 — complete planning and PGCE workflows

**Purpose:** make existing work correctable and recoverable, then add planning tools that reuse those records.

1. Complete task editing, duplicate, explicit due time/status, undo-delete and dedicated details. Link mentor actions and course deadlines into the work list without creating separate competing copies. Preserve identity and completion state when edited.
2. Add editing and draft recovery for reflections, observations, lessons, meetings and other PGCE forms. Preserve drafts across tab changes, navigation, reload and sync; provide clear save/error feedback and undo where appropriate. Finish these corrective workflows before adding the following planning features.
3. Add placement hours and exceptions: school holidays, inset days, part days, configurable hours and corrected attendance. Distinguish planned from logged days and inferred from confirmed calendar information.
4. Add evidence search across notes, captions and records, untagged-evidence filters, and a binder/export preview with date range and section selection. Keep record counts and export totals consistent with Phase 3 eligibility rules; show attachment availability and progress.
5. Add assignment work plans: subtasks, milestones, estimated effort and optional study blocks linked to a single deadline.
6. Add personal appointments, work commitments and study blocks separately from imported sessions. Feed these into personal busy time, clash checks and the end-of-day home prompt. Calendar sharing remains explicit about including personal content.

**Exit criteria:** every supported record can be corrected; interrupted forms recover; overdue tasks can be edited without losing history; placement exceptions change planned/logged totals correctly; evidence is searchable; binder previews match output; work plans stay linked to one deadline; personal commitments influence availability without modifying imported sessions.

### Phase 6 — add smarter travel and collaboration

**Purpose:** use the reliable timetable and personal commitments to plan journeys and shared time accurately.

1. Implement session-date **arrival-by** routing and a configurable arrival buffer. Calculate leave time from an itinerary for the actual required arrival time, including wait/transfer time. Preserve request intent and timezone, and align leave reminders with the same result. Do not reuse “leave now” estimates as tomorrow's plan.
2. Support explicit current/saved origins and campus or placement destinations. Invalidate old routes when origin, destination, mode, session time or home changes. Offer chosen origins when permission is denied or a location fix is missing; avoid silently treating the previous session's location as current.
3. Add destination- and journey-time-specific forecasts, leg-level disruption warnings and useful departure boards, with visible freshness and retry behaviour. Keep address, room, copy-address and external directions available during route/map failure. Cover late departures, no route, at-home, no-home and offline states.
4. Complete the home journey using a leave-now itinerary and truthful arrival estimate, reusing the session travel presentation. Retain the day-independent action and avoid conflicting end-of-day prompts when personal commitments remain.
5. Extend study groups with availability freshness, personal busy blocks, proposed meeting slots and calendar export. Reuse the stable membership identity and concurrency repairs from Phase 3. Share only the intended availability information and make stale data obvious.

**Exit criteria:** tomorrow's route is requested for tomorrow's session; buffers affect both the displayed leave time and reminders; changed destinations never retain the previous ETA; travel failure still permits external directions; same-name group members remain distinct; stale or busy members are not presented as confidently available; proposed slots respect relevant commitments.

### Phase 7 — extend to other courses and richer media

**Purpose:** deliver the optional P3 expansion items after the core app is dependable. Include these in the roadmap, but do not make them blockers for releasing Phases 1–6.

1. Generalise course/source configuration: configurable campus/building mappings, course timezone settings and reusable cohort setup templates. Keep UCL/PGCE as a supported configuration. Expand the timezone model introduced in Phase 3 rather than inventing another calendar policy.
2. Add explicitly opted-in encrypted attachment sync with size/storage limits, retention controls, progress, retries and accurate local/remote availability. Extend the Phase 2 record sync/restore model; do not imply the current metadata-only sync already transfers photos or wallet documents.
3. Add full-route maps only where a provider supplies suitable geometry: origin/destination markers, selected-leg highlighting and geographic route rendering. Add verified entrance/accessibility details where sourced; keep destination-only maps as the fallback. This is distinct from the Phase 4 map presentation redesign.

**Exit criteria:** another course can configure its timetable and locations without source edits; a second device can retrieve an opted-in attachment and handle quota/retry cases honestly; displayed route lines come from provider geometry; missing geometry or entrance data is clearly handled.

A framework rewrite, mandatory accounts, paid infrastructure, AI-generated reflections and a social feed remain outside this roadmap. Any later decision to add them needs a concrete product need rather than being bundled into the redesign.

### Validation and release rules for every phase

- Run the production build and relevant regression checks for the changed behaviour. Extend shared fixtures as data rules change; do not defer all testing to a final phase.
- Test worker changes against staging/test subscriptions and preserve existing production state during compatible rollout.
- For data changes, test legacy backups, interrupted operations, repeat restore, quota failures, offline edits and two-device conflicts as applicable.
- For UI changes, check light/dark, mobile/desktop, keyboard, screen reader, enlarged text and relevant empty/loading/error states. Validate installation, resume and platform-dependent notifications/sharing on real iOS and Android devices when those flows change.
- For calendar changes, test due times, Unicode, timezone/daylight-saving boundaries, cancellations and edits in representative clients.
- Keep a changelog, updated feature coverage/privacy copy, and a concrete rollback/recovery procedure with each release. Later phases must preserve earlier exit criteria.

### Coverage check against the review

| Review scope | Primary delivery phase |
|---|---|
| Broadcast test and release/deployment safeguards | 1 |
| Overdue/completed-reminder correctness | 1; full Tasks UI in 4 and editing in 5 |
| Stable identity, metadata/photo ownership and safe migration | 2 |
| Save/restore/profile cleanup and two-device sync | 2 |
| Invalid dates, row warnings and payload validation | 2; repair/preview UI in 4 |
| Enrolment/filter separation, refresh races and source freshness | 3 |
| Calendar/feed/push coverage, due times and profile-scoped actions | 3 |
| Selected-date, attendance/statistics and worker/group correctness | 3 |
| Today, mobile Schedule, desktop grid and session detail designs | 4 |
| Home entry/panel clipping, Settings, PGCE organisation and accessibility | 4 |
| Guided import, data health, privacy and permission presentation | 4, using safeguards from 1–3 |
| Editable records/tasks, draft recovery and undo | 5 |
| Placement exceptions, evidence retrieval and binder preview | 5 |
| Work plans and personal events | 5 |
| Arrival-by travel, buffers, forecasts and return-home planning | 6 |
| Availability freshness, suggested meetings and group export | 6, using membership fixes from 3 |
| Course configuration, attachment sync and whole-route maps | 7 |
| Focused refactoring, documentation, offline handling and verification | Within the owning phase, not a separate rewrite or final testing phase |

The sequence is **protect → stabilise data → align behaviour → redesign → complete workflows → add smarter planning → extend selectively**. Each feature has one primary delivery phase; later references describe integration or prerequisites rather than a second competing implementation plan.

## 8. Validation performed and remaining checks

### Completed in the isolated review copy

- Production build: **passed** (`tsc && vite build`). Initial JS was about **259 kB / 84.69 kB gzip**; CSS **30.39 kB / 6.17 kB gzip**. Vite reported a non-fatal mixed static/dynamic import warning for the photos module. These are build figures, not measured user performance.
- Existing Playwright smoke test: **1 passed**. It checks demo boot, a session detail and Escape dismissal. The demo is constructed directly; this does **not** exercise Google Sheets parsing despite the smoke test comment suggesting parser coverage.
- Review capture/geometry test: **1 passed**. Current Week layout showed no document-level horizontal overflow at 320, 390, 768 and 1440 pixels. This does not prove full accessibility or absence of clipped individual controls.
- Targeted findings checks: **5 passed**, confirming the unwanted identity, group-range, deletion-merge, invalid-date/time, overdue and month-navigation behaviours. Passing here means the issue was reproduced, not fixed.
- Design inspection: mobile comparisons checked in light/dark at 736 and 360 pixels; desktop concept checked at 1024 and 360; primary local interactions and page error checks passed. The desktop export was captured at wide size.
- The source repository was clean before and after review. Source files were compared against the review copy; the extra review tests exist only in the copy.

### Still needed before implementation is called ready

- Real-device iOS and Android installation, resume, notifications and sharing; screen-reader and keyboard testing; enlarged text and contrast checks on every final state.
- Parser fixtures including real exported sheet structures, group ranges, merged headers, invalid rows, cancellations and date boundaries. Worker/frontend parity tests.
- Offline/online transitions, slow profile switches, source removal, interrupted save/restore, quota failure and repeated attachment restore.
- Two-device edit/delete conflicts and rollback of legacy data migrations.
- Calendar import/subscription tests across timezone and daylight-saving boundaries, Unicode titles and event edits.
- Notification tests against a dedicated staging subscription only. Production analytics, push subscribers and KV records were not used for testing.
- Usability sessions with representative cohort members. Suggested targets: identify the next room within 5 seconds; reach an overdue task within 2 actions; find a prior reflection within 30 seconds; understand backup versus sync without explanation. These are proposed acceptance targets, not measured improvements.

## 9. Project coverage map

| Project area | Files/paths reviewed | Main conclusion |
|---|---|---|
| Boot, layout and PWA | `src/main.tsx`, `src/App.tsx`, `src/index.css`, `src/types.ts`, `index.html`, `vite.config.ts`, manifests/icons | Keep foundation; reorganise state/navigation and responsive layout |
| Main views and setup | `SetupScreen`, `SpecialismPicker`, `FilterBar`, `FilterSheet`, `AgendaView`, `WeekView`, `MonthView`, `NowNextCard`, `SessionCard` | Improve hierarchy, selected-date consistency and enrolment handling |
| Detail and records | `SessionDetail`, `KeyDatesSheet`, `AddDeadlineSheet`, `ChangesSheet`, `AdminSheet`, `JournalSheet`, `StatsSheet`, `SettingsSheet` | Separate tasks from configuration; make records editable and reliable |
| Travel and groups | `HomeCard`, `RouteSteps`, `StaticMap`, `StudyGroupSheet`; `useTravel`, `useLiveJourney`; `campus`, `location`, `tfl`, `weather`, `geocode`, `groups` | Preserve useful integrations; improve freshness, planning and sharing identity |
| Source pipeline | `useTimetableData`; `gviz`, `sheetUrl`, `parseTimetable`, `placementSpans`, `history`, `diff`, `filters`, `format`, `demo`, `notices` | Validate inputs and preserve stable event identity |
| Persistence/sharing | `storage`, `sync`, `photos`, `wallet`, `share`, `shareTarget`, `pendingActions`, `admin` | Improve migrations, restore, sync conflicts and profile ownership |
| Exports | `ics`, `weekImage`, `printBundle`, `printBinder`, `files`, `standards` | Align data scope and calendar semantics; preview exports |
| Notifications | `useNotifications`, `push`, `pushCheck`, `notify`, `platform`, `UpdateToast`, both public service-worker extensions | Make actions device/profile aware; preserve known platform limits |
| Workers | `workers/push/worker.js`, `workers/ics-feed/worker.js`, Wrangler configuration | Restrict tests; share logic; plan concurrency, pagination and staging |
| Analytics and release | `analytics`, `usage`, `changelog`, `config`, `public/analytics.html`, deployment workflow/script, package/TypeScript/Playwright configuration, smoke test, README, PLAN, DEPLOYMENT, AGENTS | Retain lightweight operations; improve coverage and current documentation |

Dependency packages and generated bundles were treated as build inputs/outputs rather than audited line by line. Production data, live cohort analytics and private student records were not inspected.

## 10. Travel, journey home and mobile Schedule — detailed design follow-up

Added 6 September 2026 following the request for specific before-and-after comparisons. This section extends the original review; it does not authorise or implement changes to the application.

**How to read these designs:** the left side is the current application, captured at a 390 × 844 mobile viewport in the isolated review copy. The right side is a proposed interface. The timetable uses the app's built-in demo for Monday 7 September 2026. Journey responses are synthetic, and “home” is an **example location near Camden Town**, not a personal address. The maps are actual OpenStreetMap destination-area tiles captured from the current map component. Journey durations, departure boards and arrival times are illustrative, not live travel guidance. Any “live TfL” text on the left is the existing UI rendering the fixture response.

The interactive comparison also supports switching between these three screens, opening the home journey, expanding journey steps, selecting dates, switching Week/Month, and opening the Monday PS1 overview/travel example. Other session detail workflows are outside this concept's scope. Its Google Maps buttons are real external destination links to the sample locations. The preview does not implement live route planning or save settings.

### 10.1 Session travel and map

![Session travel: current detail sheet beside the proposed dedicated travel view](</Users/abdulsaqib/Documents/ChatGPT/Timetable PWA/review/screenshots/comparison-session-travel.png>)

**Current journey:** open a session, then scroll past the title and the date/time/building/room/tutor metadata. A travel estimate and a small Directions link appear above the detailed route. The destination map follows the route, with Moodle, calendar and evidence controls below. The screenshot shows this scrolled travel section; the title and initial metadata have moved out of view.

The current map shows **one destination pin**. It is not a map of the entire transit journey. Tapping the map opens OpenStreetMap; the separate Directions link opens Google Maps. The app already provides route legs, some departure boards, disruptions and weather. These should be retained and reorganised, rather than rebuilt as unrelated new features.

**Proposed journey:** Schedule → session → **Travel & map**. Keep the session title, time and room visible in a compact header. Lead with an actionable leave time, then the destination and map, expandable journey steps, and a prominent **Open in Google Maps** button. Keep notes, attendance, Moodle and evidence in Overview.

In the example, a 09:00 start minus a 24-minute journey and a 10-minute arrival buffer produces **leave by 08:26**, with planned arrival at 08:50. This illustrates the proposed calculation; a production arrival-by itinerary must be requested for the session's actual date and required arrival time. Simply subtracting today's journey estimate is insufficient for tomorrow's session.

Recommended functionality:

- An arrival buffer that can be adjusted without changing the session time. Preserve departure time and arrival-by intent in the route model.
- Explicit origin and destination. Use the placement school's saved location for placement sessions; keep the room alongside the building address. Do not imply that the approximate campus coordinates identify a verified accessible entrance.
- Separate **Live · updated [time]**, **Cached · checked [time]**, and **Estimate** states. Hide expired countdowns and show disruptions next to the affected leg.
- Keep the destination map as the initial scope. A later full-route map needs provider-supplied route geometry, origin/destination markers and selected-leg highlighting; do not draw an invented line between stations and present it as a navigable route.
- Retain the address, room, a copy-address action and directions link when map tiles fail. If location is unavailable, offer a chosen origin or external directions without claiming to know the user's position.

**Acceptance:** the session time, room, leave time and navigation action can be found without searching through notes; expanding route steps exposes the full leg information; tomorrow's journey uses tomorrow's timetable; late, offline and permission-denied states remain usable. The default concept collapses leg detail to reduce phone scrolling. It can also demonstrate map-first versus steps-first ordering and different arrival buffers.

Evidence: [SessionDetail travel section](/Users/abdulsaqib/Documents/Personal/Projects/timetable-pwa/src/components/SessionDetail.tsx:220), [destination map](/Users/abdulsaqib/Documents/Personal/Projects/timetable-pwa/src/components/StaticMap.tsx:16), [journey loading](/Users/abdulsaqib/Documents/Personal/Projects/timetable-pwa/src/hooks/useLiveJourney.ts:1).

### 10.2 Where navigation home belongs

![Finding the home journey: current header shortcut beside a proposed Today card](</Users/abdulsaqib/Documents/ChatGPT/Timetable PWA/review/screenshots/comparison-home-entry.png>)

**Current entry point:** Settings → Travel times → save a home address and enable travel times. A small house pill appears in the top bar when coordinates indicate the user is more than approximately 400 metres from home. It can appear at any time of day. With no location fix it shows a waiting state; with location disabled or when nearby, it disappears. Tapping it opens the route, arrival estimate, weather, destination map and **Directions home** link.

The pill can initially show a rough estimate and change after the live-route request made when opening the panel. In the captured example this moves from an estimated 19 minutes to the fixture's 24 minutes. That difference is expected from the current calculation paths, not a measured journey improvement.

**Proposed entry point:** put a labelled **Journey home** action on Today, and promote it into a “Ready to head home?” card after the last scheduled session ends. Keep it available earlier in the day, including when the user leaves a session early. “Head home” is a destination action; **Today** is the app's landing-page navigation, so the two labels should stay distinct.

Do not derive this solely from a filtered list of visible sessions: a hidden specialism, a personal commitment or a later placement activity should not incorrectly trigger “your day is finished.” Use the user's relevant schedule, allow dismissal, and provide the journey action independently of that prompt.

![The return journey: current popover beside the proposed full-width journey view](</Users/abdulsaqib/Documents/ChatGPT/Timetable PWA/review/screenshots/comparison-home-route.png>)

**Proposed route screen:** Today → View journey home → **Journey home**. Show “Leaving now”, the arrival estimate, saved destination label, selected origin, map, expandable steps and **Open in Google Maps**. Back returns to Today. Reuse the same travel presentation as session travel, with destination/intent changed from “arrive for this session” to “leave now for home”.

Use the device's current location when allowed. Offer an explicit campus/placement origin if needed; do not silently reuse the last session's location as though it were a fresh location fix. The concept toggles between Current location and IOE to illustrate that choice; both refer to the same example origin and no route request is made.

**Additional reproduced layout issue:** the current home popover's measured bounds were `x = -4`, `width = 374` at a 390-pixel viewport. Its left edge was clipped by 4 pixels. The proposed full-width mobile view removes that positioning dependency. Classify this as a contained **P2** responsive-layout fix; also verify at narrow widths and enlarged text.

Required states:

| Situation | Proposed behaviour |
|---|---|
| Home not saved | Show a contextual “Set home location” action; let setup be skipped |
| Location off, denied or awaiting a fix | Explain the state and offer a selected origin or external directions |
| At/near home | Replace the travel prompt with a quiet “Near home” state; allow manual origin selection |
| End of scheduled day | Promote the journey card, while keeping Tomorrow and outstanding work accessible |
| Route unavailable/offline | Show last-checked information or a labelled estimate; preserve address and directions |
| Home destination changed | Clear the old destination's route and request the new journey before showing an ETA |

**Acceptance:** the home journey is discoverable from Today without recognising a house emoji; its panel fits inside the viewport; the destination cannot be confused with the session building; cached results are not labelled live; directions use the selected mode and destination.

Evidence: [HomePill visibility and loading](/Users/abdulsaqib/Documents/Personal/Projects/timetable-pwa/src/components/HomeCard.tsx:28), [popover layout](/Users/abdulsaqib/Documents/Personal/Projects/timetable-pwa/src/index.css:2348).

### 10.3 How Schedule should work on mobile

![Mobile Schedule: current stacked Week view beside a proposed day strip and selected-day list](</Users/abdulsaqib/Documents/ChatGPT/Timetable PWA/review/screenshots/comparison-mobile-schedule.png>)

**Current behaviour:** at widths up to 639 pixels, Week view switches from the desktop time grid to vertically stacked days and session cards. It already avoids squeezing the desktop grid onto a phone. However, reaching later days requires scrolling through earlier ones, and the dense header contains several icon actions alongside Day/Week/Month and Filters.

**Proposed behaviour:** make Schedule a persistent bottom-navigation destination. Within it, show Week/Month, a date range, a **Today** reset and a seven-day selector. Below that, show only the selected day's sessions, with clear start/end times, subject and room. Include breaks where meaningful. Selecting Tuesday replaces Monday's list while keeping the week context visible. Empty days stay selectable and say there are no sessions.

Month should use the same selected-date state: choosing a date updates the session list beneath the calendar; returning to Week lands on that date's week. Opening a session and going Back should preserve date, mode and scroll position. Desktop can retain its time grid while sharing this selection model.

The illustrative Schedule omits search/filter sheets to focus on date navigation. The implementation should retain search and filters, provide a compact labelled entry point, show active-filter context, and distinguish course enrolment choices from temporary display filters. Keep full titles available in session details even if list titles are shortened. Preserve overlap/clash and optional-session indicators. Thursday's sample specialism choices are condensed in the concept; a production view must render actual enrolment and overlapping sessions accurately.

**Acceptance:** any visible day is reachable in one tap; Today restores the real current date; Week/Month share selection; all sessions are reachable with large text; an empty day is not mistaken for a loading failure; returning from a session restores context. Verify touch targets, focus order, safe-area spacing, keyboard and screen-reader labels on real devices.

Evidence: [mobile breakpoint](/Users/abdulsaqib/Documents/Personal/Projects/timetable-pwa/src/components/WeekView.tsx:68), [current stacked-day rendering](/Users/abdulsaqib/Documents/Personal/Projects/timetable-pwa/src/components/WeekView.tsx:167).

### 10.4 Roadmap alignment and review checks

Section 7 is the sole implementation sequence. These designs are delivered through **Phase 4** (mobile Schedule, session travel presentation and home entry/panel), **Phase 6** (arrival-by routing, buffers, forecasts and home-journey planning), and **Phase 7** (optional whole-route geography and verified entrance details). Phase 3 establishes the shared date and freshness behaviour first. These references identify where this design fits; they are not a separate delivery plan.

Additional checks performed for this follow-up: captured the unchanged current UI with synthetic journey responses and public map tiles; reproduced the home popover's clipped edge; inspected the proposed layouts in light/dark appearance at 736, 360 and 320 pixels; exercised route expansion, the home entry/back flow, day selection, Week/Month switching and the Monday PS1 travel example. The final captures block service workers to keep API fixtures deterministic. These are preview checks, not production route accuracy or accessibility certification.

The original source repository remains unchanged. All new files are review artifacts or tests in the isolated copy. The existing enhancement priorities still apply: these designs should follow the data-integrity and notification fixes identified earlier.
