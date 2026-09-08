# My Timetable — current app audit and development specification

**Review date:** 7 September 2026. **Baseline:** `f3426954ade244d5983ce267263df7cf0e6a3a54`. **Status:** audit and implementation handoff, not implemented. **Audience:** Claude or another developer working in the shared `timetable-pwa` repository.

## 1. What to do with this document

This is a fresh review of the learner timetable app after its earlier redesign and Phases 1–7. It is not a request to reimplement the original enhancement document. The current app already has Today/Schedule/Tasks/PGCE navigation, editable records, recovery, personal commitments, journey planning, provider route geometry and configurable courses. Preserve those capabilities and repair their remaining inconsistencies.

Start with **R1: trustworthy schedule and recovery** in section 9. Each issue below includes its evidence, expected behaviour, implementation direction and acceptance criteria. The design and feature sections specify defaults so development can proceed without asking the owner to make routine product decisions. When source has moved since this baseline, adapt the fix to the current implementation; never restore an older full file.

The review identified **21 findings**, including locally reproduced functional/layout defects, additional source-confirmed defects or conditional risks, and two explicit usability findings. Further feature work is separated from repairs. The most urgent improvements are accurate event visibility, course-timezone consistency, draft recovery, journey refresh and a properly sized desktop calendar.

Read the repository's `AGENTS.md`, current `PLAN.md`, and `TIMETABLE_PWA_REMAINING_PHASES_IMPLEMENTATION.md` before implementation. Use the existing `branding/` icon family and design tokens. The separate `admin-analytics-handoff/` specification owns analytics A1–A5; the collector changes referenced here must share that work rather than create a second telemetry system. Admin A1 is already present at this baseline and its former fail-open/cache/chart defects are not being re-reported here as unfixed.

**Concurrent work:** during final packaging, the shared working tree contained new admin A2 telemetry contracts/queue/store files and changes to App, Settings, analytics, usage and worker configuration. They were not modified by this audit and are outside the frozen baseline. Reconcile TT-18 with that work before acting; it may already be resolved when development starts. Do not overwrite those newer files with the audit snapshot.

## 2. Audit method, evidence and boundaries

An isolated copy of the app, shared libraries, workers and tests was created in the review workspace. The shared application code was not modified. Source hashes and the clean baseline status are recorded in [baseline.json](evidence/baseline.json). Browser tests used a fixed synthetic date, local demo content and synthetic personal records; external network requests were blocked. No real Google Sheet, home location, photo, wallet file, analytics credential, sync account or push subscription was inspected.

Validation completed:

- **104 unit tests passed.** [Unit output](evidence/unit-tests.txt).
- **TypeScript and production Vite/PWA build passed.** [Build output](evidence/build.txt).
- **All 44 existing browser tests passed in the combined audit run.** That run also included five added audit tests: four completed, one audit-only locator timed out. See the next item for its corrected run.
- **All six final targeted audit scenarios completed.** [Targeted output](evidence/targeted-audit-final.txt). These scenarios record current defects; passing an observation test does not mean the defect is fixed.
- Screens were captured for Today, Schedule, Tasks, PGCE, Settings, travel/data settings, journey home and session detail. Additional layout checks covered 320, 390 and 1440px. Existing tests cover themes, an enlarged-content proxy, keyboard navigation, onboarding, failures, backup/sync and journey fixtures.

Two harness issues were corrected only in the isolated copy: an existing test hard-codes port 4173 while this audit used 4281; an audit locator needed the actual accessible combobox role. These are not reported as application failures. The initial and combined logs remain in `evidence/` for transparency. This was not a real-device Safari, background-delivery, production-provider, penetration or exhaustive screen-reader audit. Such tests remain release requirements where applicable.

### Current UI reference captures

| Surface | Evidence |
|---|---|
| Desktop Schedule | [1440px screenshot](evidence/screens/schedule-desktop.png), [measured widths](evidence/desktop-sizing.json) |
| Mobile Schedule | [390px screenshot](evidence/screens/schedule-mobile.png) |
| Today | [London device](evidence/screens/today-Europe-London.png), [New York device, same instant and course](evidence/screens/today-America-New_York.png) |
| Tasks | [Completed-task wording](evidence/screens/tasks-mobile.png) |
| PGCE file | [Mobile overview](evidence/screens/pgce-390.png) |
| Session | [Overview](evidence/screens/session-overview-mobile.png), [Travel with tiles unavailable](evidence/screens/session-travel-mobile.png) |
| Settings | [Index](evidence/screens/settings-390.png), [Data](evidence/screens/settings-data-390.png), [Travel](evidence/screens/settings-travel-390.png) |
| Home journey | [Mobile](evidence/screens/home-390.png) |

These are current UI screenshots, not proposed visuals. They support the written design requirements below. Synthetic titles and counts must never be copied into production.

## 3. Overall UI and product assessment

### Keep these strengths

The light/dark palette, restrained card borders, labelled navigation and room-first session detail are a solid foundation. The mobile selected-day schedule is substantially easier to use than a miniature week grid. Separating course membership from temporary display filters is important and should remain. Journey origins are explicit; provider geometry is not invented; external directions remain available when an internal route cannot be found. Task and PGCE records have durable ownership, and recovery/sync already have meaningful tests.

Do not redesign the whole app again. Consolidate layout, action hierarchy, data selection and failure states. Most remaining problems occur where a newer feature feeds an older display component.

### What currently gets in the way

**Desktop is not using desktop space.** At 1440px, `.week-grid` measured approximately 322px wide while the shell occupied 1440px. Five day columns and overlapping lessons become narrow strips. This is a defect, not a preference for a compact design. A no-overflow assertion passes because the grid is too small.

**The same record does not appear everywhere.** Personal commitments appear on mobile and Today but disappear from desktop Week, Month event inputs and search. Weekend deadlines can disappear from desktop Week. The user should not need to remember which view contains their appointment.

**Today is visually calm but can be misleading.** It chooses one current session without displaying all simultaneous sessions, and its wall-clock comparison is device-local while the selected date is course-local. “Now” must mean the same thing on every device.

**Work is spread across too many similar actions.** Tasks use a cyclic status button; PGCE presents a wall of record-type buttons; several pages have both section links and equivalent buttons. Progressive disclosure should reduce duplication while keeping important actions visible.

**Travel states need a clearer hierarchy.** In the no-location case, journey home can say to turn travel on even though a saved origin is usable. Missing map tiles leave a blank map with a pin. “Live” language appears in static introductory text before a live response exists. Show origin, route state and main action before decorative map space.

**Recovery is not consistently discoverable.** Saved edits to existing records are covered by tests, but a newly created personal-event draft gets a random record ID and is not found when a fresh creation form opens after reload. Storage containing a draft is not sufficient: users must be able to retrieve it.

## 4. Findings and repairs

Priority: **P1** materially incorrect visibility, time, saved work or privacy; **P2** usability, conditional correctness or maintainability. No new P0 production exposure was established. Evidence labels distinguish **reproduced**, **source-confirmed**, **conditional risk** and **UX**. File references are relative to the repository and identify the relevant functions; exact line numbers can move.

### TT-01 — Desktop calendar collapses to intrinsic width

**P1 · reproduced.** `src/index.css`: `.shell-main`, desktop `.shell`, `.shell-main:has(.page--wide)` and `.schedule-desktop`. `evidence/desktop-sizing.json` records shell 1440px, main approximately 370px including padding, grid approximately 322px. Auto margins on a grid item with no explicit width permit shrink-to-content sizing; removing max-width does not establish full width.

Set an explicit available-width contract: the main grid item uses `width:100%; min-width:0; justify-self:stretch`; constrain readable inner pages separately. The Schedule content can use the full available width up to its desktop cap. Do not fix this by making every reading form extremely wide. Validate computed sizes after the rule change and verify no competing `.app`/legacy layout rule overrides it.

**Accept:** at 1440px with a 200px sidebar and 24px side padding, Schedule without a panel uses about 1192px, subject to its documented cap. With a 320px detail panel and 24px gap, the calendar retains at least about 800px. At 1024px it remains readable or switches to a list when columns cannot meet the minimum; there is no page overflow. Add a positive width assertion, not only `scrollWidth <= innerWidth`.

### TT-02 — Personal commitments disappear from desktop calendars

**P1 · reproduced for Week; source-confirmed for Month input.** `App.tsx` builds `personalSessions` and includes them in `scheduleSessions`, but `SchedulePage` gives desktop `WeekView` and `MonthView` only `filteredSessions`, which comes from imported sessions. The synthetic 17:00 personal appointment is visible at 390px and absent at 1440px. [Evidence](evidence/schedule-parity.json).

Create a canonical display projection that includes personal commitments and course events under explicit filter rules. Use it consistently for Week, Month, mobile day list, busy-day indicators and counts. Keep reminder and study-group eligibility as separate selectors; display inclusion is not permission to notify/share. Preserve record IDs and the Personal/free badges.

**Accept:** the same personal appointment can be found, opened and edited in Today, mobile day list, desktop Week, Month and the new List view. A free commitment displays but does not create a busy conflict. Course membership filters never delete or mutate personal records. Decide display filters explicitly: a dedicated “Personal events” toggle controls personal visibility; subject/group filters apply to imported events only.

### TT-03 — Schedule search excludes personal commitments

**P1 · reproduced.** `SchedulePage.searchResults` searches `courseSessions + allKeyDates`, without personal commitments. The fixture returns “No sessions match” for an appointment visibly present in the day list. [Evidence](evidence/search-parity.json).

Search the canonical local display/search projection, deduplicated by owner identity. Search the user's explicit query across title, tutor, subject and location; never transmit query text. State whether temporary view filters apply. Default: search all course-member events plus personal events and tasks across dates, independent of temporary filters, with a visible “All dates; display filters not applied” note.

**Accept:** appointment title and location resolve to its owner editor; imported and personal entries cannot appear twice; clearing search restores the prior anchor and view. Do not automatically include private note/photo text in basic schedule search; that belongs to the opt-in local search expansion described later.

### TT-04 — Weekend and excess deadlines disappear from desktop Week

**P1 · weekend reproduced; excess source-confirmed.** `WeekView.weekDays` adds weekend columns only if `sessions` has those dates, ignoring `keyDates`; header pins also use `.slice(0,2)` with no “more” action. The Saturday task fixture is absent from the week containing it.

Derive visible days from the union of eligible timed events, personal events and deadline dates. A weekend with any visible record must appear. Keep all-day/deadline content in a bounded header with the first two entries and an accessible “+N more” button that opens that day's list. A hidden overflow count must not silently drop records.

**Accept:** a Saturday-only deadline appears; three Monday deadlines expose all three through “+1 more”; keyboard users can reach the overflow list; counts match Tasks and the selected-day list. An empty weekend can remain collapsed, with an explicit seven-day option.

### TT-05 — Today uses device-local time for a course-local schedule

**P1 · reproduced.** `TodayPage` uses `now.getHours()/getMinutes()` while `App.tsx` derives `todayISO` in `course.timezone`. At `2026-09-07T08:15:00Z`, the London course's 09:00 session is correctly “Now” on a London device but “Up next · in 4h45m” on a New York device. The instant and course are identical. See the two `today-*.json` files.

Centralize a course clock using `utcToZonedParts(nowMs, course.timezone)` and the existing wall-time conversion helpers. Components compare course wall intervals or UTC instants consistently. Do not fix this by changing TfL's timezone: the provider still expects London wall time. Review `JourneyHomePage`, `buildDemoSessions`, task `completedISO`, queued notification actions and any `new Date().toISOString().slice(0,10)` used as a course day. The latter paths are source-confirmed inconsistent date conventions, not all separately reproduced.

**Accept:** London and New York browser contexts produce the same course session state at the same instant; DST transitions and course midnight are covered; a profile timezone switch updates immediately. Show a compact course-timezone label when the device timezone differs. Format travel arrival in the declared journey/course timezone and label it; do not mix clocks within one sentence.

### TT-06 — Today hides simultaneous appointments

**P1 · reproduced.** `TodayPage` picks a single `current` item. `rest` includes only sessions whose start is strictly later than the hero's start. A personal 09:00 appointment overlapping the 09:00 imported lesson is omitted entirely from Today. A second already-started event can also disappear depending on ordering.

Derive `current[]`, `upcoming[]`, `finished[]` and a complete visible remainder using identity, not just a greater-start test. Keep a single prominent hero if desired but add “Also now” rows for every other active event, with clash text for overlapping busy records. Include all remaining relevant events exactly once. A free/optional entry needs a truthful label; it is not automatically a conflict.

**Accept:** equal-start, nested and partially overlapping intervals all remain reachable on Today. Current busy conflicts show a clear count. No event duplication. “Day finished” is based on all relevant timed commitments, and untimed events are shown in a separate section rather than interpreted as already finished.

### TT-07 — New personal-event drafts are saved but not recoverable

**P1 · reproduced.** `CommitmentSheet` creates `recordId` with `newAdminId()`; `useDraft` loads only that exact ID. A reload followed by Add event creates another ID. The original `timetable.draft.v1.commitment.<id>.<profile>` remains in storage, but Continue draft is absent and title is blank. [Evidence](evidence/new-commitment-draft.json). `TaskEditSheet` uses the same new-record pattern; audit all creation forms before declaring coverage.

Use a durable draft index keyed by profile and editor kind. New-record drafts retain a stable draft ID and intended record ID. Add a recoverable-drafts entry point, showing type, title preview and saved time. If exactly one matching draft exists, offer Continue/Start new/Discard; do not silently load it into a different date or profile. Existing-record drafts remain tied to their canonical record and base revision.

Flush dirty draft state on close/pagehide where possible rather than cancelling the only pending 500ms write. Do not promise recovery for unpersisted edits. Validate recovered draft shape/version before populating forms. A remote deletion while editing requires an explicit conflict outcome, not silent resurrection.

**Accept:** create, type, wait for “Draft saved”, reload, reopen and recover the same new event ID; repeat for a new task and PGCE creation forms. Test closing inside the debounce window, quota failure, multiple drafts, profile switching, corrupted draft and remote deletion. Continue/Discard must not affect another profile. No unrequested draft uploads.

### TT-08 — Malformed session URL crashes the app

**P1 · reproduced.** `src/lib/router.ts:parseRoute` calls `decodeURIComponent` without a guard. `#/session/%E0%A4%A` produced `URI malformed` and an empty body. [Evidence](evidence/malformed-route.json).

Parse untrusted hash input safely. Catch decode errors; validate route names, settings section and key length; return a typed invalid-route result. Render “This link could not be opened” with Today and Schedule actions. Preserve the app shell and avoid logging potentially private key contents. Add a final application error boundary for unexpected rendering failures, with a non-destructive reload path; it is not a substitute for safe parsing.

**Accept:** malformed escapes, empty/oversized keys and unknown route sections never blank the screen. Unknown settings sections return to the settings index with a small notice. A removed event gets the existing no-longer-available flow. Back from an external deep link must not unexpectedly leave the PWA: track an internal return route rather than assuming `history.length > 1` means an in-app predecessor.

### TT-09 — Completed tasks are labelled overdue

**P2 · reproduced.** `TasksPage.row` computes its relative-date chip without considering status. The completed fixture displays “2d overdue” next to “✓ done”. [Evidence](evidence/completed-copy.json).

Separate deadline relevance from completion metadata. Outstanding tasks can say “2d overdue”. Completed tasks say “Completed” and, when available, the completion date; retain the original due date in secondary text. Never infer late submission simply because the due date has passed. Show “Completed after due date” only if reliable completion and deadline instants justify that statement and the feature actually needs it.

**Accept:** completed past/future/today tasks have neutral completion copy and remain excluded from reminders. Reopening returns them to the appropriate outstanding section. Status controls say what the next action will do; implement an explicit status menu or labelled controls instead of a poorly discoverable cycle.

### TT-10 — Invalid study blocks can be persisted

**P1 · reproduced.** `WorkPlanSection.add` accepts a block without a date and with `18:00–17:00`. The record appears in the saved `plans` array. HTML input constraints do not run as a complete schema check on its button handler. [Evidence](evidence/invalid-plan.json).

Add shared validation for each plan kind. Subtask: nonempty title, date optional only if supported. Milestone: valid real calendar date. Study block: real date, valid times, end strictly after start for the initial same-day model. Bound integer effort consistently between UI and wire validation; initial maximum 6000 minutes per item. Validate on local save, backup import and sync ingestion. Preserve existing invalid legacy records as “Needs scheduling” for correction; do not silently delete them or turn them into timed calendar entries.

**Accept:** missing date, impossible date, reverse/zero interval and invalid effort cannot commit; errors name the field and focus it. Valid adjacent blocks are accepted. Overlap is a warning with an explicit save choice, not silent rejection. Editing a block retains its identity and parent.

### TT-11 — A journey does not replan when its departure passes while open

**P1 · source-confirmed.** `useJourney` obtains the leave-now fallback only inside the initial `planJourney(...).then(...)` if departure is already passed. The 30-second tick updates `departure`, but no effect fetches the fallback when an initially future departure later becomes passed. An open page can therefore enter the missed-departure state with no fresh alternative.

Add a transition effect keyed by active request identity and departure state. On the first transition into passed, fetch a leave-now alternative with abort/generation protection. Refresh on visibility resume if the itinerary is stale. Do not refetch every render/tick. Preserve the original missed itinerary as context but select the alternative for live steps and map only when it arrives. Distinguish refreshing, alternative found, no alternative and offline.

**Accept:** freeze a synthetic future plan, advance past departure without changing route/origin, assert exactly one appropriate alternative request and updated arrival. Repeated ticks do not flood the provider. A late response for a previous origin is ignored. Existing future-plan and already-passed tests stay green.

### TT-12 — Stale leave plans and negative cache need explicit invalidation

**P1 · conditional risk from inspected source.** `journeyPlanner` caches error results for ten minutes. `useJourney` does not clear an event's previously published leave plan immediately when origin/buffer/mode changes or selection becomes unusable; the plan store retains an entry for up to twenty minutes. This may let the reminder consumer use a plan that no longer matches the UI. `leavePlans` is keyed by event key without explicit profile context.

Clear or mark an existing plan superseded as soon as request intent changes. Key publication/consumption by profile, event and request identity; expiry alone is not identity validation. A recovery retry should bypass a recent network-error cache or use a short negative TTL (initially 15 seconds) with bounded backoff. Successful provider caches may retain their established TTL with visible age.

**Accept:** change origin/buffer/profile during an in-flight request, then inspect the reminder consumer: it cannot use the superseded plan. A failed fetch followed by restored network has a working Retry path. Scope this change across client reminder use and worker contracts only where the existing contract actually carries these plans; do not imply client memory controls every background push.

### TT-13 — Editing a commitment drops its reminder preference

**P1 · source-confirmed.** `CommitmentRec` supports `remind`; `remindableCommitmentSessions` selects it. `CommitmentSheet.Fields`, `fieldsOf` and the newly constructed record omit it. Editing a previously reminder-enabled record can silently disable eligibility.

Include the reminder preference in the editor and preserve it on every edit. Default new personal events to reminders off, with explicit “Remind me” control and a short explanation of the configured offset. Do not enable reminders merely because the event counts as busy. If detailed offset editing is deferred, preserve existing settings and use the current supported offset consistently.

**Accept:** load a synthetic `remind:true` event, edit its title and confirm the flag/eligibility remains true. Toggle off explicitly and verify it stops participating. Imported or synced unknown fields must follow a deliberate schema migration rather than accidental reconstruction loss.

### TT-14 — Desktop overlap lanes stay narrow beyond the conflict

**P2 · source-confirmed.** `WeekView.assignLanes` uses the maximum lane count for the entire day, not each connected overlap group. A three-way morning overlap makes a lone afternoon lesson occupy a third of its day column.

Partition timed events into connected overlap components, assign lanes within each component, and reset width for disjoint components. Use numeric start/end ordering, not non-normalized lexical time strings. The same overlap helper should underpin busy conflicts, with explicit exclusion rules for free/self-study records.

**Accept:** three overlapping morning events use three lanes; an isolated afternoon event uses full width. Nested/transitive overlaps remain collision-free. Short events have a usable hit target or accessible agenda alternative without visually implying the wrong duration.

### TT-15 — Desktop selected panel can retain an obsolete session object

**P2 · conditional risk.** `SchedulePage` stores a complete `Session` object in local panel state. Refresh, changed source data, filters or week navigation do not resolve that selection against the latest dataset. A stale title/time can remain visible and edits may target a record no longer in the visible calendar.

Store a stable event key plus return context; derive the selected record from current canonical data. Update details on revision change. If the item disappears, show “This session changed or is no longer visible” with a safe resolution; never silently write to a replacement identified by a similar title. On changing weeks, close the panel by default unless deliberately pinned, and preserve focus on a meaningful calendar control.

**Accept:** room/time refresh updates the panel; cancellation removes editing controls; filters cannot leave ambiguous selection; Back restores the selected day and focused item where still present.

### TT-16 — Missing tiles look like a functioning map with no geography

**P2 · reproduced visually with network blocked; source-confirmed missing error state.** `StaticMap` and `RouteMap` load tiles without a displayed load/error aggregate. The captured travel screen shows a pin on blank space. Address and external directions correctly remain usable; retain that strength.

Track tile load progress and failure. If no visible tile loads within the request window, replace the blank region with “Map unavailable offline” or “Map could not load”, an appropriate Retry, and the readable address. A partial map should say “Some map tiles unavailable”. Do not draw invented route lines. Keep attribution when map content is shown, and keep provider route text primary.

**Accept:** all tiles fail, some fail, cached tiles work and online recovery are tested. Screen readers hear the status once, not once per tile. No endless spinner or repeated automatic requests.

### TT-17 — Journey-home copy overstates state; clipboard failures are silent

**P2 · source-confirmed.** `JourneyHomePage` has a fixed “Leaving now — live route” subtitle before a live plan exists. Its no-duration copy can instruct enabling location even when a saved origin is usable. Copy address catches errors without visible feedback.

Drive text from one shared journey state: choose origin, loading, planned/live with age, estimate, no route, offline, missed departure and stale. Offer saved-origin selection before requesting location permission. Clipboard actions show “Address copied” only after success; on failure expose selectable address text and “Copy unavailable here”. Apply the same feedback contract to share/export controls.

**Accept:** location-off + saved campus does not imply live routes require GPS; no origin does not say a live route exists; denied clipboard still permits manual copying. Do not treat copied text or an external link click as completed navigation.

### TT-18 — Consent-safe collection remains a shared dependency

**P1 · source-confirmed; owned by admin A2.** App-level sending checks `usagePing/demo`, while `trackUse` still accumulates without consent checks and `maybePing` clears the complete store after a send. This audit rechecked that those client paths remain. They are already specified in admin ADM-05–08 and must not become a competing implementation.

Track this as a required dependency on admin A2: every collection path gates current consent, queued events are dropped on opt-out, and acknowledged immutable batches do not erase newer events. Learner Settings must truthfully describe the final behaviour. No extra event collection is authorized simply by adding new UI features.

**Accept:** reuse the admin A2 regression matrix and one shared event catalogue; no duplicate tracker; learner controls and privacy text match actual behaviour.

### TT-19 — Settings and profile context are hard to reach on mobile

**P2 · UX with source confirmation.** The shell comment says Settings is reachable from every destination, but the mobile nav has only four primary buttons and only Today supplies a settings action. Schedule/Tasks/PGCE users must detour through Today. The course feature flag can reduce destinations to three while CSS still uses four columns.

Add the same labelled Settings action in each primary mobile page header, retaining the four core destinations. Use dynamic grid columns for the actual navigation count. Keep active profile/course context readable and supply a predictable profile switcher in Settings; do not add another permanent bottom tab. Add a global skip-to-content link and announce route heading changes.

**Accept:** Settings is reachable in one action from all primary destinations at 320px; a three-destination course divides the nav evenly; long profile names wrap/truncate with accessible full text; tab order and active-page semantics remain correct.

### TT-20 — PGCE and task actions need clearer hierarchy

**P2 · UX.** PGCE's overview repeats Journal links and lists many equal-weight record-type buttons; Tasks describes an invisible status cycle in body text. Users should see their next useful action without scanning all categories.

Use four stable PGCE sections: Placement, Evidence, Development, Documents. Each has one primary contextual action, one short summary and a restrained “View all” link. Move record-type choices into Development's list/quick-add menu. Retain one-tap access to existing records, not a wizard for every action. In Tasks, separate Today/Upcoming/Overdue/Completed with explicit status actions and a neutral completed section. Keep numerical evidence coverage descriptive; it is not a competency or qualification score.

**Accept:** no record type is lost; empty sections invite a first useful entry; completed records remain searchable; destructive actions retain undo/recovery; there is one clearly dominant action per card.

### TT-21 — Move key-date reminder settings into Reminders

**P2 · user-requested correction, source-confirmed on 8 September 2026.** In `src/components/SettingsSheet.tsx`, the editable “Key-date reminders” controls currently sit inside Settings → **My timetable**, beneath the key-dates sheet connection. Reminder timing belongs in Settings → **Reminders**. The existing configuration summary in Reminders does not replace access to the editable controls.

**Required change:** move the complete reminder timing control group into a clearly headed **Key-date reminders** section in Reminders, alongside the other reminder timing settings. Keep the key-dates source URL, connection status and disconnect/source configuration in My timetable. Beneath the source connection, add a small “Configure key-date reminders →” link that navigates to the new section; do not retain a second editable copy.

**Implementation details:**

- Continue using `settings.keyDateReminderDays` and the existing `toggleOffset('keyDateReminderDays', value)` path. Preserve the 7-, 3- and 1-day options, multi-selection, saved values, all-off state and profile ownership. Use consistent labels: “7 days before”, “3 days before”, “1 day before”.
- Move the UI only: do not reset preferences, introduce another storage key, change notification permission behaviour or alter client/background scheduling. Retain existing persistence, sync and subscription update paths.
- Give the section a stable anchor such as `key-date-reminders`. The source-page link should use the existing settings navigation mechanism to open Reminders, then scroll/focus the section after it renders. Avoid a new top-level route; direct `#/settings/reminders` remains valid.
- Preserve current eligibility rules. If no key-dates source is connected, show a concise explanation and a “Connect key dates” link to My timetable rather than silently hiding the topic. Do not extend personal-task reminder eligibility or change scheduling as part of this relocation.
- Replace the moved legacy explanatory text if needed with copy consistent with the actual foreground/background notification support already described on the Reminders page. Do not promise delivery merely because a timing chip is selected.
- Update any Settings search results, help references and screenshots so “key-date reminders” opens Reminders, while “key-dates sheet/source” opens My timetable.

**Acceptance tests:**

1. With a connected synthetic key-dates source, My timetable contains the source controls and navigation link but no editable reminder timing chips; Reminders contains exactly one editable key-date timing group.
2. Seed `[7, 1]`; opening either settings page and navigating between them leaves those values unchanged. Reminders shows 7 and 1 selected, 3 unselected. Reload retains the same state.
3. Toggle 3 on, then all options off; verify the existing settings/subscription update flow receives the correct values without changing other reminder offsets or requesting permission merely from navigation.
4. Switching profiles displays each profile’s own choices. No migration or automatic default reset is introduced.
5. With no source connected, the explanatory state and source setup link work. Source connection remains editable in My timetable.
6. Keyboard and mobile users can follow both links; focus lands at the destination heading; the group has an accessible name and each chip retains `aria-pressed`. Check 320px and desktop layouts.

**Delivery:** include in R3 as a small, separately reviewable fix. It can be implemented ahead of the broader R3 redesign because the relocation does not depend on the R1/R2 data changes. This audit addition requests documentation of the fix; no app code was changed here.

## 5. Styling and interaction specification

### Shared visual system

Keep the existing system font and new icon family. Use `src/index.css` tokens rather than inventing a second brand. Light: background `#f5f6fa`, surface `#ffffff`, text `#202940`, muted `#5b667b`, accent `#3e51c7`, accent surface `#eef0ff`, border `#dfe4ed`. Dark: background `#111722`, surface `#1a2230`, text `#e9edf6`, muted `#adb7cb`, accent `#b1bcff`, accent surface `#2a3557`, border `#354154`. Success/danger use existing semantic tokens.

Spacing: 4/8/12/16/20/24px. Controls radius 10px, badges 6px, cards 12px, hero 14px. Card padding 16px mobile, 20px desktop. Main mobile gutter 16px (12px allowed only at ≤340px); desktop 24px. Reading surfaces max-width about 720px; task/PGCE list surfaces up to 960px; Schedule fills its usable calendar area, up to 1440px of content. These are distinct inner containers, not a single width imposed on every page.

Page heading 24–28px, card heading 18–20px, body 15–16px/1.45–1.5, supporting text 13px, metadata 12px minimum. Long session titles wrap in mobile cards; desktop timeline may clamp to three lines but must expose full title through focusable detail. Time, title, room and status have stable positions. Tutor/weather/travel are secondary; avoid a dense line of icons competing with the room.

Use existing SVG UI icons instead of introducing more emoji as essential controls. The calendar icon's new session-block identity may appear in the sidebar/launcher but must not consume mobile header space. Subject colours are accents only; do not use them as the sole subject or conflict indicator. Avoid excessive uppercase copy in countdowns and avoid celebration when timetable completeness is unknown.

### Layout by screen

**Today:** date/profile header with Settings and Refresh; one urgent summary; current/upcoming hero with room; “Also now” if needed; remaining day including personal records; deadline summary; journey-home row. Provide “Show finished sessions” rather than making past records unreachable. Today deadline summary defaults to nearest outstanding task and a count; old overdue tasks get their own compact review action rather than permanently displacing everything else.

**Schedule mobile/tablet (<1024px):** Week/Month/List control if space permits, otherwise a labelled view picker; date strip/month drives one selected-day list. Keep Add event and Today adjacent to date context. Search opens below the header and explicitly states its scope. Month dots/counts distinguish event presence from deadlines through text/legend, not colour alone.

**Schedule desktop (≥1024px):** full-width week grid with readable day columns; optional 320px panel at ≥1280px only when the remaining grid meets its width threshold. At narrower widths open detail as the existing dialog. Toolbar sits above the grid, not centered over a narrow intrinsic-width column. Seven-day expansion and deadline overflow retain all records. List is a first-class accessible alternative with the same filters and anchor.

**Session detail:** retain Overview and Travel & map. Overview order: title/date, room, primary course link (label from course configuration rather than always Moodle if unsupported), attendance, note/evidence. Travel order: intent and origin, route status with freshness, leave/arrival summary, main directions action, text steps, collapsible map and access disclaimer. On desktop, the summary panel uses the same canonical data and save status as full detail.

**Tasks:** compact summary chips for Outstanding/Completed, local search, due grouping and explicit status menu. Default order: overdue oldest first, today by due time, upcoming by due date, completed newest completion first where known. Unknown completion date falls back to due date with no invented timestamp. Preserve linked mentor-action ownership; add a link back to its meeting and a reversible completion action.

**PGCE:** four section cards with progress/counts as context and one useful action each. Evidence/Development lists have search and type filters; avoid stacks of duplicate navigation buttons. Placement shows logged days/hours with definitions and exceptions. Do not reinterpret logged evidence as assessment performance.

**Settings:** retain the current categories and add local settings search with synonyms: home/address, backup/export, sync/device, notifications/reminders. Results open the actual setting with heading focus. Advanced diagnostics stay collapsed. Each risky data action explains affected profiles/files and has preview plus recovery. Do not replace existing checked persistence or undo mechanisms with a simple confirm dialog.

### Interaction requirements

All ordinary actions target at least 44×44px. Numeric status chips have accessible names such as “Mark English assignment complete”, not just a symbol. Menus have Escape and focus return. Modal background must be inert to keyboard and assistive technology; the existing focus-trap hook is useful but needs nested-dialog and empty-dialog checks. Route navigation focuses the page heading without stealing focus on routine refresh. Restore schedule anchor, scroll and selected item on returning from detail; distinguish same-tab app navigation from an external predecessor.

At 200% and 400% zoom, content reflows. Test the actual browser zoom/viewport behaviour where possible: CSS `zoom` is only a proxy. Validate contrast in both themes (4.5:1 normal text, 3:1 essential controls/large text), reduced motion and visible focus. Fixed bottom navigation and quick-add must not cover focused fields or the last row; include safe-area and visual-viewport keyboard cases. Screenshots captured with full-page browser tooling can place fixed navigation across the image; confirm actual scroll-to-bottom usability rather than classifying that screenshot artifact alone as a bug.

## 6. New features worth adding

The following are additive proposals. Implement only after R1/R2 repairs, with defaults below. None requires collecting private content in analytics or adding an AI API.

### NF-01 — One local “Find anything” search

**Priority P2; high everyday value.** Expand the repaired schedule search into a local search page covering sessions, personal events, tasks and optionally PGCE titles. Default search scope is titles/rooms/tutors; a user can enable “Include my notes and captions” for local content search. Documents' file names can be searched; do not OCR or upload files in the initial release.

Index by `(profileId, ownerType, ownerId)` with normalized text and source revision. Delete/tombstone invalidates the index. Build lazily and debounce input (150–250ms); use a worker for larger data only when measurement warrants it. Cap first result page at 50 and expose more. Results show record type, date and a short local snippet; clicking opens the canonical editor. Preserve query/filter/back context. No network requests for query text or result content.

**Acceptance:** find a past lesson, personal appointment and task by title; opt-in note search finds a phrase locally; switching profiles cannot leak results; deletion/rename updates results; keyboard selection works; test 10,000 synthetic searchable entries without typing stalls. Pending refresh must not turn cached search results into an empty screen.

### NF-02 — Unified work-plan calendar projection

**Priority P2; complete an existing workflow.** Work-plan study blocks currently live under tasks; turn valid scheduled blocks into read-only calendar projections linked to the parent, rather than creating duplicate commitments. Initial fields: block ID, parent task ID, date, start/end, busy flag, completion. Event key `plan:<blockId>`; store the block once in `plans`.

Projection participates in Today, Week, Month, List and conflict checks. Opening it opens the parent task's block editor with focus. Default busy=true. Reminder eligibility is explicit and off initially until the parent/child reminder contract is implemented. Parent completion retains blocks by default and offers existing review choices; cancellation removes projection via tombstone, not duplicate deletion. If parent due date moves, keep the existing review prompt and do not auto-shift blocks.

**Acceptance:** editing the block time updates every view; no second commitment is created; sync/backup round trips one owner; a block without valid scheduling remains in “Needs scheduling” and does not pollute time grids. Availability shares only busy intervals, never parent/task text.

### NF-03 — Weekly planning and workload view

**Priority P2.** Add a Schedule “Plan week” panel combining classes, personal busy time, validated work blocks and upcoming deadlines. Show available gaps as suggestions, not guaranteed free time. Respect quiet/personal availability preferences and transit buffers where known. Unknown journey duration is not zero.

Defaults: Monday-start course week, 08:00–20:00 visible planning range configurable locally, minimum suggested slot 30 minutes, maximum suggested block 120 minutes. Every suggestion states why it fits and what is excluded. Selecting a suggestion prefills an editor; nothing is created without Save. No automatic calendar rearrangement, task completion or AI-generated priorities.

**Acceptance:** no suggested gap overlaps a canonical busy interval; course timezone/DST covered; estimates are labelled; changes in source invalidate affected suggestions; undo restores any newly saved block. Existing commitments marked free remain visible but do not block suggestions.

### NF-04 — Recurring personal events with explicit exceptions

**Priority P3; larger schema change.** Support weekly recurrence first: interval 1–4 weeks, selected weekdays, required end date, maximum 12 months and 366 generated occurrences per series. Keep non-recurring events fully compatible. Default timezone is the profile course timezone captured on series creation.

Use a series record and deterministic occurrence identity derived from series ID plus original scheduled local occurrence, not an array index. Exceptions support skip and move; editing offers “This occurrence” and “This and following”, with preview counts. Splitting a series preserves historical occurrence identities. Do not create every occurrence as an independent synced record. Persist local overrides and series tombstones through the shared merge/backup model. DST-invalid wall times require a visible correction policy; never silently create a duplicate.

**Acceptance:** weekly study/shift series appears across all views; skipped occurrences stay skipped after sync; changing following weeks preserves past records; backup restore retains exceptions; imported timetable refresh cannot overwrite personal series. Client and worker reminder expansion use the same bounded helper. Deploy worker support before enabling reminder-capable series.

### NF-05 — Data health and recovery centre

**Priority P2.** Consolidate existing save state, sync state, backup age, attachment locality and recoverable drafts under Settings → Data & devices. This is a clearer front end over existing persistence, not a replacement storage engine.

Show separate truthful states: “Saved on this device”, “Synced records at …”, “Photos/documents are local”, “Last backup created …”, “N recoverable drafts”, and “Storage estimate unavailable” when the browser cannot provide it. Backup creation does not prove the file was retained elsewhere; say “Backup generated”, not “Safely backed up”. A preview lists included profiles, record counts and attachments before export/restore.

Add export only selected profile with explicit scope; retain complete backup as the default recovery option. An optional portable encrypted backup uses a reviewed authenticated encryption path and a separate password; never reuse or expose a sync code. Password-loss recovery cannot be promised. Encryption is a distinct later work item, not a reason to delay correcting misleading save status.

**Acceptance:** quota failures remain visible with drafts retained; sync success does not imply attachment sync; recovery steps never delete unrelated profiles; partial-profile export/import retains owner IDs or deliberately remaps them with a tested preview. Local recovery remains usable without a cloud account; optional Google Drive/iCloud backup is now specified separately in NF-09.

### NF-06 — Journey preferences and provider capability boundary

**Priority P2.** Add user-selected default origin per journey purpose (outbound/home), with a clear override each time. Never silently treat an old device fix as current. Display age and distinguish saved-place origin from live GPS. Keep personal addresses local except when the user requests a route from the chosen provider.

Course configuration should declare supported journey providers/region capability. For a course outside the supported internal provider area, show an explicit external-directions experience rather than repeatedly failing a London-only provider. Walking/driving estimates remain estimates; do not claim verified accessibility. Arrival buffer applies to the chosen arrive-by intent once; avoid subtracting it twice.

Later, add alternate-route selection only from real provider alternatives. Show arrival, changes and walking duration if supplied, with request identity and freshness. Selecting an alternative updates the exact departure used by the local reminder consumer. A route choice is not a route guarantee.

**Acceptance:** default origin is profile/purpose-specific; no location permission prompt when saved origin suffices; stale fix visible; unsupported region gives a usable address/link; no invented route geometry or step-free claims; origin change aborts obsolete results.

### NF-07 — Session preparation and follow-up checklist

**Priority P3.** Add a small optional checklist to a session: preparation items, follow-up items and local resource links. This differs from task deadlines: checklist entries have no due reminders unless the user explicitly promotes one into a task. Promotion records a stable link, not two independent completion states.

Use the event's canonical identity and existing metadata/record revision model. New imported versions of a session retain the checklist through identity reconciliation; ambiguous matches enter the existing review flow. Link labels are user-provided; validate URL schemes. Default collapse completed preparation items while retaining access. No automatic extraction from private notes or course links.

**Acceptance:** schedule refresh cannot detach items from a stable event; ambiguous identity never attaches notes to an unrelated lesson; promoted task ownership is explicit; sync/delete/backup tests cover the new collection. Avoid storing large binary resources in session metadata.

### NF-08 — Evidence review queue and shareable binder selections

**Priority P2.** Add a local review queue for untagged evidence, missing captions and records the user marked “Review later”. These are organizational states, not judgments about competency. Let the user select records, preview exactly what a binder/export will contain, redact optional personal fields and generate the output locally.

Selections reference canonical records; they do not duplicate images. Preview distinguishes absent local attachments from zero attachments. Add optional per-export caption/field inclusion controls; defaults exclude wallet documents and home/location details unless explicitly selected for a valid purpose. Do not auto-email, publish or upload exports.

**Acceptance:** totals match selected available records; missing photos are named as unavailable; repeated generation does not mutate records; deleting selection does not delete evidence; print layouts support long captions, page breaks and accessible reading order. Never introduce a numerical “teacher quality” or standards-pass score.

### NF-09 — Google Drive and iCloud backups

**Priority P2 · explicitly requested on 8 September 2026.** Add cloud backup and restore under **Settings → Data & devices → Cloud backups**. This extends NF-05; cloud backup is now in scope for development. It is a versioned recovery snapshot, not a replacement for the app's existing device sync. Connecting a provider must never automatically restore or overwrite local records.

#### User experience and defaults

Show separate Google Drive and iCloud cards with truthful capabilities, connection state, last completed backup, included profiles/attachments and Restore history. Primary actions: Connect/Set up, Back up now, Restore, Disconnect. Cloud backups default off. Initial scope is the active profile with its records and locally available photos/documents; offer an explicit all-profiles option with a preview. Show missing attachments before proceeding; do not silently call a metadata-only backup complete.

Use the established card, button, theme and error tokens. Provide a progress sequence: Preparing → Encrypting → Uploading/exporting → Verifying → Complete, with bytes/progress where supported and Cancel where safe. Distinguish “File exported — choose iCloud Drive in Files” from provider-confirmed upload. Only a completed, verified provider operation changes “Last cloud backup”. A dismissed picker/share sheet is not success.

Backup selection shows date/time, app/format version, originating device label, profile count, record count, attachment count, size and verification state. Store personal names and content inside the encrypted archive, not provider-visible filenames. Use an opaque backup ID and timestamp for the external filename. Restore requires selecting a snapshot, decrypting locally, validating it and reviewing the existing restore preview before committing through the recovery journal.

#### Google Drive: direct PWA integration

Use Google Identity Services browser authorization with a dedicated configured OAuth client and minimum `drive.appdata` scope. Store snapshots in `appDataFolder`; explain that these are app-managed backups rather than ordinary visible Drive-folder documents. List, download and restore them through the app. Do not request full Drive access. A visible-folder export can be a separate later option with its own narrowly scoped authorization, not an unannounced permission expansion. Google's app-data folder supports application-specific files and the dedicated scope. [Official app-data guide](https://developers.google.com/workspace/drive/api/guides/appdata?authuser=5).

Initialize authorization only after a user chooses Connect. Keep access tokens in memory, out of localStorage, logs, backups, service-worker caches and URLs. The token model uses short-lived access tokens; when they expire, reconnection needs a user-driven authorization flow. An expired session becomes “Reconnect to back up”, not an automatic popup or a falsely successful background job. [Google token model](https://developers.google.com/identity/oauth2/web/guides/use-token-model).

Configure allowed web origins for both deployed hosts and isolated local development, consent-screen details and required API enablement. Document exact setup/deployment variables in the runbook; no client secret belongs in the browser. Account provisioning is an external prerequisite, not permission to invent credentials or weaken authorization. Keep a disabled, explanatory provider state when configuration is absent.

Optional automatic mode: **“Back up when I use the app”**, at most once per 24 hours after data changes, and only while online with usable authorization and an unlocked encryption key. Run on foreground/open/resume with a single-flight lock and bounded retry; debounce settled writes before snapshotting. Do not claim exact-time or guaranteed closed-app backups. A future server-assisted solution cannot back up fresh device-only attachments while the device is offline; background token handling would require a separately reviewed backend/auth design.

#### iCloud: supported PWA path and optional deeper integration

Initial delivery is **encrypted file export/import through the system file/share interface**, labelled “Save to iCloud Drive”. When file sharing is supported, offer the generated archive through the native share flow so the user can choose Save to Files → iCloud Drive. Otherwise use a normal download and concise platform-specific instructions. Restore uses a file picker so a downloaded/iCloud Drive archive can enter the same decrypt/validate/preview flow. Detect support rather than relying only on device sniffing. Do not promise that the browser can select an iCloud folder or verify remote synchronization after a file is handed to the OS.

For deeper Apple-account-connected backup, evaluate a separate **CloudKit private-database adapter** using a provisioned app container, web configuration and user authentication. CloudKit JS exposes an app's CloudKit databases; it is not an arbitrary iCloud Drive folder API. Label this future option “iCloud app backup (CloudKit)” and explain that its snapshots are managed in the app, not visible ordinary Drive files. Never store private archives in a public database. [Apple CloudKit JS](https://developer.apple.com/documentation/cloudkitjs), [CloudKit web-service setup](https://developer.apple.com/library/archive/documentation/DataManagement/Conceptual/CloudKitWebServicesReference/SettingUpWebServices.html).

Do not silently substitute CloudKit for the requested iCloud Drive file flow or advertise automatic iCloud backup before that adapter is provisioned and verified. Native document APIs are a distinct implementation route if a native wrapper is deliberately introduced later; they are not assumed capabilities of the current PWA. Apple documents native document-provider access separately. [Apple document browser](https://developer.apple.com/documentation/uikit/uidocumentbrowserviewcontroller).

#### Archive, privacy and provider adapter contract

Reuse the current backup schema, validation and transactional restore machinery. Introduce a versioned authenticated-encryption envelope around the portable backup before cloud transfer; complete NF-05's reviewed encryption work first. Use a user-held backup passphrase/recovery key distinct from sync and provider credentials. Document the encryption/KDF format and version, test vectors, wrong-key behaviour and cross-device compatibility. Keep the unlocked key in memory for the initial version; unattended backup requiring persistent keys is explicitly deferred. Never promise password recovery. Show the user how to retain their key independently of the provider.

Cloud archives must exclude OAuth tokens, analytics keys, push subscription credentials and other device authentication material. Define and test the export allowlist; retain user-created records and necessary ownership metadata. Preserve source URLs/settings only within the encrypted payload where needed for restoration. Do not upload original unencrypted photos as separate provider assets. Build a consistent snapshot under the existing data lock; serialize and encrypt outside long UI-blocking work where practical. Current backup-size limits remain enforced: fail with a clear size message and scope options, never omit files silently.

Provide one adapter interface with capabilities and methods for `authorize`, `listBackups`, `upload`, `download`, `deleteOwnedBackup`, `disconnect`, plus file-export/import capabilities for the manual adapter. Unsupported operations are explicit; the iCloud file adapter must not fake remote listing, deletion or upload verification. Google and optional CloudKit use the same archive bytes and validation contract.

Each snapshot has a random backup ID, format version, installation ID, scope ID, creation time, ciphertext byte size and checksum. Upload to a new object; read back/check integrity and validate archive metadata before marking it complete. Partial uploads never replace the last good backup. Retries reuse the logical backup ID and reconcile uncertain success before creating another version. Concurrent devices create independent snapshots rather than overwriting each other.

Retention default: offer keeping the latest ten verified automatic snapshots **created by this installation for this scope**; enable pruning only with explicit setup consent. Pinned/manual snapshots and other installations' files are excluded. Delete only provider objects whose app-owned metadata matches the operation; never select targets by filename alone. Prune only after a replacement is verified. Disconnect stops queued work and removes local authorization state; it does not delete cloud backups. Deleting cloud backups is a separate explicit scoped action with a list/count preview.

#### Acceptance tests and delivery

1. Google sign-in success, cancellation, missing scope, token expiry, account switch, revocation and missing client configuration all produce usable states; no secrets appear in logs/storage/export.
2. Google upload/list/download/restore works with synthetic encrypted snapshots. Interrupted/resumed upload and uncertain acknowledgements do not destroy or duplicate the last good snapshot. A checksum/decryption failure never commits a restore.
3. iOS Safari/installed PWA and macOS manual export/import are tested with the available Files/share/download flow. Cancellation does not set cloud-backup success; unsupported sharing falls back to download; a file selected from iCloud restores correctly. Do not mark native/cloud verification complete based only on a mocked browser test.
4. Explicit scope includes the expected profile records and attachments. Missing local attachments and size-limit failures are shown before cloud transfer. No cross-profile data is included without the selected scope.
5. Wrong passphrase, corrupted archive, older supported version, unsupported newer version and failed storage restore preserve the current app through its recovery mechanism.
6. Automatic foreground backup runs only when changed, enabled, online, authorized and unlocked; respects the daily cadence; does not attempt popups without a gesture; closed-app execution is not promised.
7. Retention never touches another installation's or unrelated Drive objects; disconnect never deletes remote snapshots; multiple device snapshots remain separately restorable.
8. Both deployment origins, dark/light layouts, keyboard flow, screen-reader progress and narrow mobile views are covered. All development uses test provider accounts/fixtures and synthetic content; do not use the owner's actual Drive/iCloud data as test material.

**R5 delivery order:** shared encrypted archive + restore preview; Google Drive manual backup/history/restore; iCloud Drive file export/import; optional foreground automatic Drive backup with honest session/key limitations; optional CloudKit feasibility/configuration and private-database adapter. The initial cloud feature is complete when both Google Drive and the truthful iCloud Drive file path work; CloudKit and guaranteed unattended/native backup are explicitly separate enhancements. Record provider-specific completion and remaining limitations, not a single misleading “cloud backup supported” checkbox.

## 7. Shared technical contracts

### One event projection, several deliberate policies

Introduce selectors rather than another mutable combined store. A view model should identify owner type and key, display date/time, title/location, source kind, revision, busy status and supported actions. Imported sessions, commitments and scheduled plan blocks remain separate canonical owners. Do not identify records by title/date alone.

Recommended modules:

```text
src/lib/scheduleProjection.ts    # display/search projection, owner references
shared/intervals.js              # validated interval overlaps, groups and gaps
src/hooks/useCourseClock.ts     # one course date/time source, visibility refresh
src/lib/draftIndex.ts           # profile/kind discovery over durable draft envelopes
shared/planValidation.js        # kind-specific plan validation, used at boundaries
src/lib/navigationState.ts     # safe hash parsing and internal return context
src/components/MapState.tsx    # loading/partial/offline map wrapper
```

Reuse existing equivalents where appropriate. Avoid duplicating `shared/calendar-time.js`, identity helpers, persistence locks or merge functions. A selector takes the active profile/config as input; avoid asynchronous work relying on an ambient mutable course config from another profile. Cache keys include source revisions, course timezone and relevant filter policy.

For every record family, define separately: visible in which views, eligible for reminders, counts as busy, included in availability, included in export, indexed in search. “Visible” must not imply every other permission. Settings/course changes invalidate derived caches. Account for tombstones before projection.

### Time, draft and journey state

Use UTC instants for comparison and an explicit zone for wall-time entry/display. Course calendar dates are not interchangeable with UTC dates. Store ambiguous DST correction decisions explicitly where required. No direct `getHours()` comparison to course wall times in view code.

Draft envelopes include profile ID, draft ID, intended record ID, kind, base revision, saved time and validated value. Index repair can discover envelopes without trusting arbitrary localStorage JSON. Do not delete an unindexed draft during migration. Consent generation belongs to telemetry only; ordinary user drafts are not analytics.

Journey state should be a discriminated union, not scattered `minutes === null` branches. Include request identity, origin basis/age, mode, intent, provider, fetched time and current error/retry state. Keep provider response geometry attached to its exact itinerary. Cancellation invalidates both display and reminder publication where relevant.

### Migration and recovery defaults

New fields are optional on old backups and receive documented defaults. New required relationships need a schema version and migration tests. Preserve record IDs and timestamps unless a deliberate migration creates a linked replacement. Invalid legacy plan intervals are retained for review. New recurrence schemas remain disabled until worker/readers understand them. A failed migration leaves the last valid dataset and an actionable recovery message.

Use the current checked persistence/recovery journal for changes spanning metadata and attachments. Do not turn recoverable failures into silent best-effort writes. Distinguish syncing content from syncing preferences and device-local permissions. No feature may alter other profiles or their credentials merely because the active profile changes.

## 8. Test plan and acceptance matrix

The current test suite is valuable but misses view parity, positive desktop sizing, new-record draft recovery and time transitions while an open screen remains mounted. Add targeted invariants rather than snapshots that only prove a heading exists.

| Area | Required regression cases |
|---|---|
| Schedule projection | Imported + personal + task pins + plan blocks across Today/Week/Month/List/search; free/busy; filters; weekend-only deadline; >2 pins |
| Desktop geometry | Positive usable width at 1024/1280/1440/1920; panel open/closed; connected overlap groups; short events; long titles |
| Time | Two device zones, one course; two courses; midnight; DST spring/fall; queued completion actions; hidden/resumed tab |
| Today | Equal starts; nested overlaps; already-started remainder; untimed records; day finished; cancelled session |
| Recovery | New and existing drafts; same intended ID after reload; rapid close; multiple drafts; failed storage; remote delete/update |
| Validation | Real dates; reverse/zero/missing intervals; effort bounds; old invalid records; backup and sync boundary validation |
| Navigation | Malformed hash; missing event; unsupported section/feature; external predecessor; Back restoring anchor/focus/scroll |
| Travel | Future→passed while mounted; stale plan on resume; late response; origin/buffer/profile change; negative-cache retry; saved origin without GPS |
| Map/clipboard | No tiles/partial tiles/cache; honest fallback; attribution; provider geometry only; clipboard denied/manual copy |
| Cloud backup | Provider authorization/expiry; encrypted snapshot integrity; iCloud Files cancellation; scoped restore; foreground cadence; safe retention; no tokens in archives |
| Data/privacy | No private query/content in requests; consent gate shared with admin A2; no unrelated KV mutations; attachment locality stated |
| Accessibility | Keyboard/VoiceOver; modal background inert; no focus behind fixed nav; 44px actions; both themes; 200/400% reflow |
| New features | Recurrence exceptions and identity; work-plan single ownership; local search isolation; export preview exactly matches output |

Use intercepted provider fixtures and synthetic profiles only. Reproduce each defect before repair and flip the expectation to correct behaviour afterwards. The included observation test is a starting aid, not a permanent suite asserting bugs should remain. `evidence/current-audit.spec.ts.txt` is intentionally inert; adapt it into tests with project-relative evidence paths and configured baseURL before running.

Keep existing unit/browser gates green. Run relevant targeted checks after each work item, then the full gate at a phase boundary. Real-device installed-PWA notification/service-worker checks belong before release because browser tests block service workers. Follow both host base-path checks. Any worker/shared-wire change deploys worker first under `AGENTS.md`; this audit does not request deployment.

## 9. Ordered development plan

### R1 — Trustworthy schedule, routing and saved work

**Scope:** TT-01 through TT-10, prioritizing visibility, clock and recovery. **Dependencies:** current main source; no new provider or backend needed for core repairs.

Implement in small reviewable groups: (1) safe route parsing and fallback, (2) course clock, (3) shared display/search projection and complete Week headers, (4) desktop width/overlap-aware Today, (5) draft index/recovery and plan validation, (6) completed-task copy. Add positive geometry and parity fixtures. Repair incomplete historical plans non-destructively.

**Gate:** all reproduced issues now have corrected assertions; current 104 unit and 44 browser baselines remain green or are intentionally expanded; screenshots show a readable desktop calendar and complete mobile day. A draft advertised as saved can be recovered with the same intended identity. No new record can commit an invalid block.

**Rollback:** revert view changes independently; retain safe parser and data validation. Draft migration is additive and preserves old envelopes. Do not delete old drafts or canonical records to restore an earlier UI.

### R2 — Journey continuity and consistent actions

**Scope:** TT-11–17, plus TT-18 coordination. **Dependencies:** R1 time/identity helpers; admin A2 owns collection internals.

Implement shared journey state/transition refresh, request/profile invalidation, retry semantics, reminder preference preservation, overlap component layout, selected-panel identity, map states and clipboard feedback. Add saved-origin/unsupported-provider capability groundwork from NF-06. Verify local and background reminder boundaries explicitly.

**Gate:** future departure crossing works without navigation; superseded route cannot drive current display or local reminder; reminder-enabled commitment survives edit; all-map-failure remains useful. No fake live/stale/arrival/accessibility claims. Do not block unrelated UI improvements on an unfinished telemetry phase; track TT-18 as a release dependency for new event instrumentation.

**Rollback:** disable new provider enhancements while preserving old request identity safeguards and honest fallbacks. Keep cached errors short-lived. Never restore an obsolete plan simply to keep a countdown visible.

### R3 — UI consistency and discoverability

**Scope:** section 5, TT-19–21, List view, local Settings search. **Dependencies:** R1 stable projection; R2 shared travel state.

Apply shared page width contracts; add mobile Settings access, dynamic nav columns, clearer Task status actions, calmer PGCE card hierarchy and accessible list alternatives. Consolidate repeated UI helpers without rewriting the app. Reuse existing tokens/icons. Add heading focus and internal Back restoration. Move the key-date reminder timing controls from My timetable to Reminders as specified in TT-21; this small relocation may ship independently ahead of the wider phase.

**Gate:** all existing destinations/actions remain reachable; 320–1920px matrices and zoom/keyboard checks pass; no page-wide overflow or unusably narrow content. Current and proposed screenshots are reviewed at the same viewport and data. Mobile forms work with keyboard visible and safe-area insets.

**Rollback:** keep existing routes and aliases so bookmarks remain valid; revert individual layout components without changing data ownership.

### R4 — Planning and local retrieval

**Scope:** NF-01, NF-02, NF-03. **Dependencies:** projection, interval validation and draft recovery from R1.

Ship repaired basic search first, then local expanded search. Add work-block calendar projection with a single owner. Build weekly gap suggestions over the same busy intervals, with explicit save/undo. Do not add recurrence in this phase; keep identities simple while testing planning.

**Gate:** one block appears everywhere without duplication; all suggestions avoid busy intervals; note search is opt-in/local; profile switching/tombstones cannot leak search results. Performance measured on synthetic large data. No automatic task scheduling or network content processing.

**Rollback:** hide additive projections/search index while retaining canonical records; indexes are rebuildable. Removing a planning view must not delete saved blocks.

### R5 — Recovery and evidence workflows

**Scope:** NF-05, NF-08, NF-09, NF-07 where justified. **Dependencies:** validated drafts, canonical ownership and current recovery engine.

Add data-health summaries and clear local/synced/attachment states. Add profile-scoped export preview and evidence review selections. Add preparation checklist only after owner/identity integration is tested. Portable encrypted export is a separate subtask with reviewed cryptography and test vectors; do not improvise an encryption format in a UI patch. Complete it before the NF-09 Google Drive/iCloud cloud-backup adapters; follow NF-09’s provider-specific delivery order and capability limits.

**Gate:** export matches preview; unavailable files are explicit; recovery preserves unrelated data; linked task/checklist ownership is deterministic; backup/restore fixtures cover every new field/collection. No automatic sharing, upload or competency scoring.

**Rollback:** additive selectors and saved preferences can be hidden; retain exported formats/readers and migration compatibility. Never “clean up” wallet/photo data as part of visual rollback.

### R6 — Recurrence and provider extensions

**Scope:** NF-04 plus later NF-06 alternate routes/region integrations. **Dependencies:** R1–R5 stable contracts and operational budget review.

Implement recurrence as a versioned shared expansion helper with bounded occurrence generation, exceptions and deterministic IDs. Extend local/worker reminder eligibility together. Add internal provider integrations only with documented capabilities and current official contracts; unsupported regions keep external navigation. Alternate routes must originate from provider results.

**Gate:** occurrence edits/series splits survive sync and imports; worker supports the schema before client rollout; limits prevent unbounded expansion; no duplicate reminders; truthful provider/freshness labels. Validate both production build bases locally and complete the repository's release gate before deployment.

**Rollback:** disable creation of new series while readers retain existing data; never downgrade records into duplicated one-off events silently. Keep worker backward compatibility during staged release.

## 10. Completion instructions for Claude

Work from this baseline-aware document in R1–R6 order. Do not treat all feature proposals as part of one enormous change. For each implementation report: finding/feature IDs addressed, behaviour before/after, files changed, relevant tests and any remaining limitations. Update PLAN in the same implementation commit as required by the repo. Preserve current admin A2–A5 development and coordinate shared collector/contract changes through one implementation.

Routine defaults are supplied here: course-clock scheduling, one canonical owner per record, local search, explicit reminders, same-day validated blocks, bounded weekly recurrence, static external navigation outside supported providers, and non-destructive draft migration. Use these defaults rather than asking the owner to invent missing architecture. If a real provider or platform limit makes a proposed capability impossible, implement the honest supported fallback and document the exact limitation; never substitute fabricated data or silent behaviour.

Do not modify `registerType`, KV namespace IDs, `vapid`, source base URLs, production analytics, subscriptions or unrelated private data as part of this work. Do not copy the audit runtime, synthetic profiles or generated test results into the application bundle. The only deliverable authorized by the current request is this audit documentation and its supporting evidence; application changes follow a subsequent implementation instruction.
