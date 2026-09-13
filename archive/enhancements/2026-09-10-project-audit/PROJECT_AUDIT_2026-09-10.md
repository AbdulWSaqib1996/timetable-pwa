# Timetable PWA: further project audit and implementation handoff

Date: 10 September 2026. Audience: Claude or another implementation agent.

## 1. Scope, baseline and how to use this document

This is a fresh audit of the current shared project at `/Users/abdulsaqib/Documents/Personal/Projects/timetable-pwa`, based on commit `d933f44` (notifications release verification). Tracked-file status was clean when the snapshot was taken. This handoff proposes work; it does not implement changes or authorise production data manipulation.

The review covered learner UI, attendance/reminder integration, backup/restore, shared-photo intake, storage and relevant worker code. The complete existing automated suite, including admin analytics regressions, was run on an isolated snapshot. This is not a fresh exhaustive manual audit of every admin analytics screen, a penetration test, or verification of deployed services. Use the existing admin handoff for its larger design programme.

Read `AGENTS.md`, `PLAN.md`, `timetable-app-audit/DEVELOPMENT_PLAN.md` and the earlier `timetable-app-audit/TIMETABLE_APP_AUDIT_AND_ENHANCEMENTS.md` before implementation. Recheck the affected code against the latest branch: Claude may have progressed it since this baseline. The identifiers below are **FA-** identifiers to avoid colliding with earlier TT/NF work.

### Verification and evidence

- Production TypeScript/Vite build: passed.
- Existing unit suite: **153 passed**.
- Existing browser suite: **104 passed**.
- Additional audit browser checks: current UI captures, timezone discrepancy reproduction, and rejection of invalid backup data. See `evidence/fresh-browser-results.txt`.
- Local mocked probes: HTTP 500 attendance reporting resolves as success; posting an empty attendance-key list retains the previous worker mark. See `evidence/probe-results.txt`.
- Browser data was synthetic. External browser requests were blocked. No production notifications, analytics, subscriptions, Google accounts or personal records were used.
- Chromium screenshots at 390×900 and 1440×900 are current-state evidence, not proposed designs. Full-page captures can show the fixed mobile navigation partway down a tall image; this alone does not establish that the final controls are inaccessible.

Evidence labels below distinguish **reproduced** from **source-confirmed**. Source-confirmed defects have a concrete code path but still need the prescribed regression reproduction before changing behaviour. Passing tests are not evidence that these untested paths work.

### Earlier requests: preserve the progress

The key-date reminder controls are now in **Settings → Reminders**, with the source connection remaining in **My timetable** and links between them. Do not report or implement that move again. The attendance percentage is now displayed. The desktop calendar width and mobile schedule have improved substantially; retain them. Existing tests cover prior schedule, draft, recovery, travel and admin changes.

Encrypted/scoped local backups, preview, data health and evidence review exist. Google Drive/iCloud backup remains an existing planned feature, not a newly discovered omission: PLAN records R5a completed and 54b blocked on an owner-provisioned Google OAuth client ID. Preserve the earlier NF-09 requirements; do not invent credentials, promise unattended PWA background backups, or treat sync as a file backup. Do not hold independent reliability/UI fixes hostage to cloud configuration.

## 2. Prioritised defects

| ID | Priority | Finding | Evidence |
|---|---|---|---|
| FA-01 | P1 | Attendance reporting acknowledges failed HTTP responses | Reproduced with HTTP 500 |
| FA-02 | P1 | Attendance-report cache lacks subscription/profile identity and recovery triggers | Source-confirmed |
| FA-03 | P2 | Removing an attendance answer cannot remove worker suppression | Reproduced with an empty report |
| FA-04 | P1 | Foreground reminders use device time while Today uses course time | Reproduced in New York timezone |
| FA-05 | P1 | Shared photos leave the intake queue before successful attachment | Source-confirmed loss path |
| FA-06 | P2 | A single-profile backup suppresses the whole-device backup nudge | Source-confirmed |
| FA-07 | P2 | Restore replacement wording does not describe omitted sections accurately | Source-confirmed |

P1 means address in the next reliability batch because data recovery or core reminders are affected. P2 means a meaningful workflow or correctness problem, not an emergency. There is no confirmed P0 outage in this audit.

### FA-01 — Only acknowledge a successfully stored attendance report

**Files:** `src/lib/push.ts` (`reportAttendanceMarks`, around line 120); `src/hooks/useNotifications.ts` (reporting effect, around line 326).

`reportAttendanceMarks` awaits `fetch` without checking `response.ok`. Its caller then writes `timetable.marks-reported.v1`, so HTTP 400/404/429/500 responses become a local success marker. The function also returns normally when no service worker/subscription exists; the caller cannot distinguish those cases from delivery. A mocked HTTP 500 resolves successfully in the supplied probe. Consequence: the app may stop trying to inform the worker that a session was answered, and an unwanted prompt can still arrive.

**Implementation contract:** return a typed result distinguishing `accepted`, `unavailable`, `retryable-failure` and `configuration-failure`, or throw typed failures. Only accepted 2xx responses may update the acknowledgement. Check the API's expected response shape. Preserve a bounded pending report for retry; do not silently swallow an error and call it delivered. A 404 should surface a recoverable registration problem; it must not silently create or subscribe a device. Retry 429/5xx with bounded backoff and honour Retry-After when present. Keep the answer saved locally even if reporting fails.

**Acceptance:** mock accepted, 400, 404, 429, 500, network rejection and no subscription. Only accepted reports create an acknowledgement; failures retain a pending state. A subsequent valid response clears the pending state. Tests must never reach a deployed worker.

### FA-02 — Scope reporting state and retry when the environment changes

**Files:** the same hook and push helper; inspect subscription lifecycle in `src/lib/push.ts` and settings push controls.

The deduplication cache contains only `{day, keys}` under one device-wide localStorage key. It does not include profile, endpoint or server identity. The hook dependencies omit profile identity and the calendar day itself; the reporting work runs only on its listed React dependencies. A successful report to an old endpoint/server can therefore suppress an identical report to a replacement subscription/server. A mounted page crossing midnight has no explicit reporting trigger. Network rejection has no online/visibility retry unless some dependency happens to change. These are distinct from FA-01's HTTP-status bug.

**Implementation contract:** use an acknowledgement identity containing server origin, a non-reversible endpoint fingerprint, profile ID, course date and protocol version. Do not store/log the raw capability endpoint as diagnostic text. Reconcile after subscription replacement, active-profile switch, course-day rollover, online recovery and foreground resume. Debounce edits; coalesce to the latest authoritative snapshot; cancel or ignore late responses from the previous identity. At most one in-flight report per identity. Treat absence of a subscription as pending/unavailable, never acknowledged. Retry scheduling must not assume a PWA continues running when closed.

**Acceptance:** profile A→B with identical session keys, server change, subscription replacement, late response from A after switching to B, midnight with unchanged metadata, and offline→online recovery. Verify no report is skipped because another identity was acknowledged. Combine with FA-03 so a report cannot erase another profile's answers.

### FA-03 — Make attendance suppression reversible

**Files:** `workers/push/worker.js` `/attendance` handler (around 1656), cron attendance gate (around 828), shared request contract if introduced.

The client sends the set of currently answered session keys, but the worker unions that set into existing `record.marks`, retaining marks for up to two days. It does not remove a mark absent from a new report. The supplied mock posts `keys: []` to a record with one mark: it returns `{ok:true, skipped:true}` and retains the mark. Clearing an accidental attendance answer therefore cannot make the session eligible for a prompt again during the valid prompt window.

**Implementation contract:** define the request as an authoritative snapshot for one explicit profile and course day. Replace only that scope's mark set; retain unrelated days/profiles. Include a monotonic revision or equivalent ordering guard to reject stale snapshots. Validate profile/date/key consistency and impose request limits. Do not implement a global `record.marks = {}` reset. Migrate old union-style records explicitly; determine their scope from stored subscription config only when unambiguous, otherwise expire them safely. Decide whether already-delivered notification history should continue suppressing a second notification: clearing an answer must not produce notification spam.

**Acceptance:** mark, clear before first delivery, mark→absent, stale report arriving after a newer report, unrelated profile marks and old-day expiry. Ensure unchanged snapshots avoid unnecessary KV writes. Run locally against fake KV; never modify real subscription data for testing.

### FA-04 — Use the course clock throughout reminder calculations

**Files:** `src/hooks/useNotifications.ts` lines around 177–186 and attendance loop around 276; `src/features/today/TodayPage.tsx`; the existing course-clock utility; `tests/notifications-quick.spec.ts`.

The reminder loop uses `new Date().getHours()/getMinutes()` and device-local `localTodayISO()`. Today calculates session timing with its course clock. At `2026-09-07T15:40:00Z`, a browser in `America/New_York` displays the correct Maths 1 attendance card for a London course but does not emit “Did you attend Maths 1?”. The recent notification test pins Europe/London, masking this difference. This extends the earlier course-clock audit into the notification subsystem; do not undo the already-correct Today implementation.

**Implementation contract:** resolve the same course date/minutes used by Today for session, leave and attendance eligibility. Use that date for reporting scope and deduplication. Specify quiet hours separately: default to the course timezone for consistency with existing course reminders, show the zone next to the quiet-hours settings, and migrate without changing the saved hour values. If device-local quiet hours are later supported, make that an explicit preference. Audit photo-target matching in App, which also uses device hours, as part of FA-05. Do not mechanically replace every local clock: user-authored personal-event semantics must remain explicit.

**Acceptance:** same instant in London, UTC, New York and Tokyo; midnight boundaries, daylight-saving transitions, leave offsets and end-of-session window edges. The card and notification agree. Keep the London test and add timezone variation rather than removing its coverage.

### FA-05 — Keep shared photos until a recoverable attachment succeeds

**Files:** `src/lib/shareTarget.ts` (`getAndClearSharedPhotos`); `src/App.tsx` share-target effect around 938–979; service-worker share-target writer and `src/lib/photos.ts`.

`getAndClearSharedPhotos` clears the IndexedDB queue while returning blobs. App then chooses a target. If there is no eligible past/started session it returns, after the queue has already been cleared. A compression/attachment failure occurs after clearing too, without a recoverable intake record in this path. It also chooses a destination automatically from the current profile and uses device hours. This is a local intake-loss risk; it does not delete the original image from the user's photo library.

**Implementation contract:** replace destructive dequeue with a durable inbox. Each item needs an ID, received timestamp and pending/attached status. Read pending items, let the user confirm profile/session, and acknowledge/remove each only after its photo write succeeds. Default the picker to the current/most recent course-clock session, but do not auto-discard if none exists. Preserve per-item progress when only part of a batch succeeds. Use an idempotency token so reload/retry does not duplicate successful attachments. If adding the photo and updating metadata cannot be one transaction, persist a recovery record and reconcile the count from actual stored attachments. Show errors and Retry/Choose destination/Discard actions; discard requires an explicit user action.

**Acceptance:** share before the first session, empty timetable, wrong active profile, quota failure, compression failure, reload midway, duplicate retry, and two successful photos followed by a failed third. Pending images survive; successful images are not duplicated; photo counts match stored files. Test with synthetic blobs. Do not inspect the user's real images.

### FA-06 — Track backup coverage per profile

**Files:** `src/components/BackupSheets.tsx` (`generate`); `src/lib/storage.ts` (`markBackedUp`, `shouldNudgeBackup`); data-health component.

Both “Everything” and “Only this timetable” call the same argument-free `markBackedUp()`. The single `lastBackupAt` suppresses the whole-device nudge for 30 days. Backing up A can therefore hide the reminder even when B has never been included. The UI correctly says “generated” rather than “safe”; retain that truthful distinction.

**Implementation contract:** record generated-at time, included profile IDs and all-profile coverage for each recent export, with a bounded history. Derive each profile's last included time; a new profile is not covered by an earlier all-profile export. Keep legacy timestamps as “scope unknown”, never assume complete coverage. Device health should state “A included today; B not yet included” and offer a complete backup. Scope bookkeeping must not claim the user saved a downloaded file or that the export contains future edits. Consider a separate last-changed marker for later improvements, without resetting the nudge on every minor change.

**Acceptance:** A+B→export A, then export both, then create C; migrate an old global timestamp; cancel a download; fail encryption. Only successful generation updates generation history, and unknown/omitted coverage remains visible.

### FA-07 — Explain restore effects at section level

**Files:** `src/lib/backup.ts` (`restoreBackup`, `backupPreview`, `backupSummary`); `src/components/BackupSheets.tsx` restore preview.

Restore only writes metadata groups actually present in the incoming file. A same-ID profile with no incoming admin/cache section retains its local admin/cache data; attachments are merged. The existing replacement language is broader than those semantics. A zero incoming record count is not necessarily the final device count. This is primarily a preview/contract defect; do not “fix” it by deleting unspecified data.

**Implementation contract:** preserve the existing non-destructive behaviour by default, but compute a restore impact plan against local data. Per profile, show sections to replace, sections absent from the file that will be kept, and attachments to merge. Distinguish absent from present-but-empty. Show backup creation time/version and warn about newer local edits that would be replaced. Validate the impact plan again immediately before committing inside the recovery lock. An optional destructive replacement mode is outside this batch. Never silently remove unrelated profiles.

**Acceptance:** v2/v3/v4, same-ID local records with missing incoming sections, explicit empty sections, attachments already present, unrelated profiles and recovery rollback. Preview agrees with the resulting records. Preserve export/import validation: the audit's invalid metadata fixture was correctly blocked from export, so invalid export is **not** an open bug.

## 3. UI review and precise styling requirements

The indigo, pale neutral surfaces and four-destination navigation form a coherent base. The task is refinement, not another wholesale redesign. Reuse `src/index.css` tokens and shared controls in `src/components/ui.tsx`: `--accent: #3e51c7`, `--bg: #f5f6fa`, `--surface: #ffffff`, `--text: #202940`, `--text-muted: #5b667b`, `--border: #dfe4ed`. Reuse the existing dark-theme equivalents; do not hardcode light colours inside components. Keep existing branding and app icons.

### UI-01 — Bring secondary actions into the shared control system

Evidence: [mobile Today](evidence/390-today.png), [desktop Schedule](evidence/1440-schedule.png). “Show 3 finished sessions” and “Show all seven days” render as small native-looking bordered buttons, despite the surrounding custom design. They use `travel-link` styling outside the travel context.

Create a reusable secondary disclosure control: minimum 44px interactive height, 12–16px horizontal padding, 14px/20px label, 8–10px radius, transparent background by default and subtle token-based hover. Use chevrons with `aria-expanded` for disclosures. Calendar day-count toggles use `aria-pressed` because they select a display preference. Preserve focus indication, accessible text, counts and state across normal rerenders. Test 320px width and keyboard activation. Do not shrink the touch target to match the current screenshot.

### UI-02 — Make schedule controls easier to understand

Evidence: [mobile Schedule](evidence/390-schedule.png). Mobile “Week” actually shows a seven-day strip and a selected-day agenda, a useful design that needs a short explanatory cue. Desktop controls are spread across a long toolbar, and building/camera emoji actions lack visible explanation.

Retain Week/Month/List. Below the mobile week strip show “Select a day to see its sessions” until first interaction, then allow it to disappear. Desktop toolbar: view switch on left; a compact actions group on right containing **Placements**, **Plan week**, **Filters**; calendar export as a named secondary action or More menu. Use shared vector icons instead of emoji-only affordances; accessible labels alone are insufficient for sighted discoverability. Keep date navigation in a distinct second row with previous/next buttons adjacent to its label rather than far apart across the page. At <480px wrap groups deliberately into two rows without squeezing labels. Persist filters with a visible active count and a Clear action; preserve the existing filter semantics.

### UI-03 — Improve desktop event readability without losing time positioning

Evidence: [desktop Schedule](evidence/1440-schedule.png). Several parallel Thursday sessions occupy narrow columns, with small text and no visible room in the captured cards. This is density/readability feedback, not a claim that overlap placement remains broken.

Use at least 12px/16px event text in the desktop grid, title medium weight and time semibold. Allow two to three title lines before ellipsis; retain full details via keyboard focus/click. Show room/building only when width permits. For narrow overlap lanes show short title plus time, with an accessible full name; do not let room metadata displace the title. Add a user-selectable Comfortable density that increases pixels per hour, preserving accurate relative times and the overlap algorithm. At narrow desktop widths suggest List without automatically changing the user's chosen mode. Validate three overlapping events, long titles and 200% text enlargement.

### UI-04 — Restructure Data & devices around user decisions

Evidence: [mobile Data & devices](evidence/390-settings-data.png). Long right-aligned status values wrap awkwardly; attendance interrupts the sequence between health and backup. Technical storage/encryption detail competes with primary actions.

Order: **Device status → Back up or restore → Sync → Storage details**. Move attendance reporting into PGCE/Term stats with a short linked summary here if continuity requires it. For mobile status rows, place the label above a left-aligned value; use a two-column layout only above 640px. Status body text 14px/20px; section heading 16px/24px; 16px section padding and 24px between sections. Show Saved locally / Pending changes / Action needed using text plus icon, never colour alone. Put storage estimates and algorithm names in an expandable technical-details section. Keep “photos and documents are not synced” visible beside the Sync action. Include FA-06 coverage and FA-07 impact preview without making people interpret raw record structures.

### UI-05 — Offer a useful end-of-day state

Evidence: [mobile Today](evidence/390-today.png). At the end of the day, an attendance question and celebratory banner dominate; tomorrow appears as small secondary text and there is extensive spare space.

Keep outstanding attendance first. Then show one compact **Tomorrow** card with first start time, destination and session count, plus **View tomorrow** opening the selected schedule date. Use “Your scheduled sessions have finished” instead of implying all work is complete. A “Review today's sessions” disclosure replaces the bare finished-session button. Display journey home when the existing eligibility rules allow it; do not invent a location or route when home is missing. Do not fill the screen with low-value widgets merely to remove whitespace. Include empty, weekend and no-upcoming-session states.

### UI-06 — Give empty states a clear next action

Evidence: [desktop Tasks](evidence/1440-tasks.png), [mobile PGCE](evidence/390-pgce.png). Tasks explains how to connect dates but does not offer that connection as a direct action in the captured empty state. PGCE presents several equally strong primary buttons and repeated “View all” links.

Tasks: a 560px maximum-width empty-state card aligned to the content column, primary **Add a task**, secondary **Connect key dates** deep-linking to the source settings. Keep the already-correct Reminders location for reminder preferences. PGCE: one primary action per section, secondary text links with descriptive names such as “View placements”; prefer action copy that explains creation, e.g. “Add development record”. Replace repeated generic accessible link names. Do not obscure existing record types in a redesigned menu. Test both empty and populated fixtures before judging spacing.

### Shared UI acceptance criteria

Check 320, 390, 768, 1024 and 1440px, light/dark themes, reduced motion, 200% text enlargement and keyboard-only use. Preserve focus on route navigation and modal return; the outlined headings in captures are intentional programmatic focus evidence, not a defect to hide globally. Every essential icon-only action needs an accessible name; frequently used ambiguous actions also need visible text. Keep mobile bottom-navigation safe-area padding and ensure the final control can scroll above it. Capture populated tasks, placement records and overlapping sessions as well as empty demos. Test overflow and actual interaction, not screenshot appearance alone.

No new font family, colour palette, logo or external map style is required. Use existing card radii, border and shadow tokens consistently. Suggested spacing is 4/8/12/16/24/32px. Main mobile page gutters remain 16px. UI copy should describe outcomes, not internal algorithms.

## 4. Further feature opportunities

These are proposed additions, not defects. Prioritise after the reliability work and reconcile with existing NF items before building duplicate functionality.

### F-01 — Reminder delivery status and repair

Add a compact status panel under Reminders showing local permission, background subscription state, last successful attendance reconciliation and whether a retry is pending. Separate “answer saved on this device” from “background reminders updated”. Offer Retry now and the existing device-specific notification check. Never claim a notification was seen or delivered merely because the push provider accepted it. Do not log full endpoints, session notes or location. This is the visible complement to FA-01–04, not an admin analytics feature.

### F-02 — Shared-photo inbox

Expose FA-05's durable inbox from Today and Evidence journal with an item count. Users select destination profile/session, preview thumbnails and optionally add captions before attachment. Multi-select should apply one chosen destination to the batch with explicit confirmation. Keep pending items across reload/offline operation; do not sync image blobs implicitly. This extends existing evidence workflows and should reuse their image compression, caption validation and attachment identity mechanisms.

### F-03 — Recovery readiness and restore rehearsal

Extend existing data health with per-profile coverage, a backup-file validation check and a read-only restore-impact preview. A rehearsal decrypts/validates in memory and shows what would change without writing data. Label this “File can be read”, not “Recovery guaranteed”; unavailable referenced attachments still need disclosure. Reuse the current encryption envelope and FA-07 impact planner. Never upload a backup for checking. This supports NF-09 later without requiring a cloud account now.

### Existing cloud feature: implementation boundary

Keep direct Google Drive backup and the iCloud Files/share workflow in the earlier NF-09 backlog. The repository already describes encryption and platform constraints. Connect the new coverage/recovery UI to those adapters when implemented. Until OAuth setup is supplied, show the feature as planned/unavailable in development documentation, not as an enabled button that cannot work. No new external-provider capability was researched or validated in this audit.

## 5. Ordered implementation plan

### Batch 1 — Reminder correctness

Implement FA-01–04 together because identity, authoritative snapshots and retry acknowledgement form one protocol. Add fake-KV worker tests and mocked client tests first; then browser timezone cases. Add F-01's minimal status only after its state model is reliable. Review backwards compatibility for old clients before changing `/attendance`. If the worker contract changes, follow AGENTS worker-first deployment requirements when a deployment is actually requested. Do not touch VAPID, namespace IDs or real subscription records.

Gate: accepted responses alone acknowledge; profile/day replacement is isolated; stale replies cannot regress state; the same course instant produces consistent card/reminder eligibility in every test zone; existing notifications tests remain green.

### Batch 2 — Photo recovery and backup accuracy

Implement FA-05 inbox durability, then FA-06 coverage, then FA-07 impact plan. Build F-02 on the safe intake mechanism. F-03 can reuse the impact plan as an optional separate commit. Do not change the backup envelope/version gratuitously or delete old user data. Preserve recovery locking and attachment ownership.

Gate: injected storage failures lose no queued images; retry adds no duplicates; scoped backups do not hide uncovered profiles; preview and restore results agree for all supported versions; unrelated profiles survive.

### Batch 3 — UI refinement

Implement UI-01 shared controls first, UI-02/03 schedule next, UI-04 data screen using the new coverage/impact model, then UI-05/06. Keep this as incremental component/CSS changes. Capture before/after at identical viewport, clock, profile and data. Do not use polished empty fixtures to hide populated-layout problems. Run focused interaction tests and the complete existing suite once the batch is ready.

Gate: no horizontal overflow or obscured controls, consistent touch targets and themes, clear action labels, keyboard/modal focus retained. Preserve prior admin design tokens and independently branded admin icons.

### Batch 4 — Documentation, verification and archive

Record implementation decisions, migrations, test results and any genuinely deferred work in PLAN. For each FA/UI/F item record fixed, deferred with reason, or disproved with evidence. F items are optional enhancements; do not mark an unfinished feature delivered. Complete the mandatory archive procedure below after the relevant enhancement package is complete. Production code and regression tests stay in their normal directories.

## 6. Suggested regression work and review rules

The evidence folder includes `fresh-audit.spec.ts` and `probe.mjs` as audit harnesses. The timezone reproduction currently asserts the observed discrepancy; **invert that expectation when turning it into a permanent regression test**. Audit harnesses are not ready-made passing proof of a fix. The mock probe bundles the push helper from a local runtime snapshot; adapt its imports for repository tests rather than checking in the snapshot or generated bundle.

Run `npm run test:unit`, `npm run build`, and `npm run test:e2e` with the project's configured Node toolchain. The browser fixture blocks non-local network. Tests that create their own contexts must preserve that isolation. Use mock KV and synthetic blobs. Never test analytics/push against production, set `analytics:retention-policy`, delete records not created by a test, rotate VAPID, or alter the service worker registration strategy as part of this work. Read current AGENTS for the full operational constraints.

Do not reopen previously fixed issues based only on old screenshots. Do not silently implement speculative risks. A candidate involving backup preview validation was specifically rejected during this audit because `exportBackup` validates before returning; the disabled-button browser check preserves that behaviour.

## 7. Major product expansions — added 10 September 2026

The earlier F-01–03 proposals and all bug/UI work remain in scope as recorded. The following are **larger proposed capabilities**, added following the owner's request for more substantial enhancements. They are a product roadmap, not approval to build all features or replace the existing implementation plan. Implementers must turn the selected capability into a technical design before development, including schema migration, API contracts and release gates. The concrete defaults below establish the intended experience without requiring the owner to invent routine product decisions.

### Recommended product direction

Evolve the timetable into a **study and placement workspace**: understand what must be delivered, plan enough time to do it, connect the necessary materials, and review progress with a mentor. Keep the timetable as its dependable foundation. Avoid a collection of unrelated widgets or a generic chatbot with no connection to the user's actual work.

| Capability | Material new value | Suggested sequence | Relative size |
|---|---|---|---|
| MF-01 Adaptive workload planner | Turns deadlines and available time into a reviewed, reschedulable work plan | Second, after MF-02 core | Large |
| MF-02 Assignment and project workspace | Manages a substantial piece of work from brief through submission and feedback | First | Large |
| MF-03 Placement and mentor review portal | Enables an ongoing learner–mentor evidence and feedback workflow | Third; local workspace before portal | Very large |
| MF-04 Connected calendars and import inbox | Brings external commitments and course changes into one reliable schedule | After core projects/planning; one adapter at a time | Very large |
| MF-05 Course knowledge and revision workspace | Connects learning materials, personal notes, retrieval and revision to sessions | After MF-02; optional AI last | Large to very large |
| MF-06 Collaborative coursework workspace | Gives a study group a shared project, responsibilities and deliverables | After explicit sharing/identity foundation | Very large |
| MF-07 Change-impact and replanning centre | Explains what a changed session disrupts and offers a safe repair plan | After MF-01; expand with MF-04 | Large |

Sizes are comparative scope judgements, not delivery-time estimates. Existing features should be reused; none of these is a reason to rewrite the app wholesale.

### MF-01 — Adaptive workload planner

**User outcome:** “I have a 3,000-word assignment in three weeks, placement on three days each week and an observation to prepare for. Show me a realistic plan, and help me recover if I miss a block.”

**Beyond today's app:** existing weekly gap suggestions identify available slots and prefill blocks. This capability allocates **remaining effort across multiple weeks**, respects task dependencies, identifies infeasible deadlines and generates a reviewable replacement plan as circumstances change.

**First release:** user enters effort remaining, deadline, priority, minimum useful block length and dependencies for project milestones. Availability preferences include working days/hours, a daily study cap, breaks and protected commitments. Existing scheduled blocks can be locked. A deterministic planner allocates milestone blocks backward from deadlines while respecting dependencies and busy intervals. It must show unmet hours when a plan cannot fit; an impossible deadline must not produce a falsely reassuring schedule. Do not require an AI service for scheduling.

**Workflow:** open Plan from Schedule or an assignment → choose a one-to-four-week horizon → preview proposed blocks and unresolved constraints → accept all or selected changes. When a block is missed, offer Done / Partly done / Reschedule; partial completion changes remaining effort only after confirmation. Replanning affects flexible blocks, with one operation-level undo. Course sessions and locked personal events are never moved by the planner.

**UI:** desktop uses a calendar plus a persistent workload panel; mobile uses a daily plan with “6 hours needed / 4 hours available” summaries and a separate change-review screen. Every suggestion explains its main constraint: “Before draft review”, “Only 60-minute gap”, or “Exceeds your daily limit”. Keep manual scheduling available.

**Data/engineering:** add project/milestone references, estimated and remaining minutes, dependencies, lock state and plan revision to the existing canonical planning model. Suggestions remain temporary until accepted. Validate cycles, stale revisions, timezone boundaries and concurrent edits. Planning uses one shared busy-time projection; do not create a second event store.

**Release gate:** a feasible fixture fits without overlaps; an infeasible fixture reports exact unallocated effort; locked blocks stay fixed; changing a deadline regenerates a diff; accepting and undoing restores the original schedule; no external calls are required. Later extensions may learn duration estimates from user-confirmed actuals, with an explicit reset.

### MF-02 — Assignment and project workspace

**User outcome:** “Everything for this assignment—brief, criteria, research, draft milestones, planned time, submission and feedback—is in one place.”

**Beyond today's app:** a task is currently a unit of work. This adds a durable container for a multi-stage deliverable and links existing tasks, work blocks, evidence and documents instead of making disconnected copies.

**First release:** create an assignment manually or from a key date; retain its source link and source identity. Store brief, module, due date, optional word target, assessment criteria, milestones and linked resources. Provide a reusable template: understand brief → research → outline → draft → review → submit. Templates are editable, not mandatory academic rules. Milestones may own tasks and feed MF-01 with estimates. The assignment can exist before the planner is built.

**Workflow:** an assignment page has Overview, Plan, Materials and Feedback. The overview makes the next incomplete milestone obvious. Submission is a user-confirmed state with a date, reference/link and optional receipt attachment; do not infer successful institutional submission from opening an LMS link. Feedback can be linked to follow-up actions for the next assignment. Retain previous feedback and versions of milestone changes.

**UI:** add Projects as a view within Tasks initially, rather than adding another crowded mobile navigation item. Desktop project list shows deadline, next milestone and planned versus remaining effort; mobile cards show the same three facts. Use a timeline for milestones and offer a simple list alternative. Completion percentages must state what they count; task count is not assignment quality.

**Data/engineering:** introduce Project, Milestone and ResourceLink with stable IDs, profile ownership, timestamps and deletion semantics compatible with sync. Existing personal tasks remain valid without a project. Attaching an existing note or file creates a reference, not a duplicate blob. A source deadline update becomes a proposed project-date change with attribution.

**Release gate:** create from a key date without duplicating the date, link existing tasks, change a milestone, export/restore the complete workspace, and recover deleted projects without silently deleting shared resources. Test tasks linked to multiple contexts and broken/missing resource references. Initial version does not submit coursework to external platforms or generate assessed work on the learner's behalf.

### MF-03 — Placement workspace and mentor review portal

**User outcome:** “My mentor can review exactly the evidence I choose, comment on an observation, agree actions and see what has changed before our next meeting.”

**Beyond today's app:** placement records, observations, targets, meetings and evidence already exist locally. The expansion is a **connected review lifecycle with another person**, rather than another form or export button.

**Local foundation:** a placement workspace brings weekly teaching schedule, observation requests, targets, mentor-meeting agendas and selected evidence together. Each review pack is a versioned snapshot; editing the learner's original evidence does not silently rewrite a pack already reviewed. Provide a standards coverage matrix distinguishing evidence attached, learner reviewed and mentor reviewed. These are workflow states, not claims of professional competence or official certification.

**Portal release:** learner selects specific records → previews everything the mentor will see → creates a time-limited invitation → mentor signs in → comments, requests clarification and acknowledges a review → learner converts agreed actions into linked tasks. Access is revocable. Revision history shows who changed or reviewed what and when. Private reflection drafts stay private until explicitly selected. Start with learner and invited reviewer roles; institutional administrator roles are later scope.

**UI:** learner sees “Ready for review”, “Awaiting feedback” and “Actions agreed” queues. Mentor gets a focused browser page with the review pack and comments, not access to the learner's full personal timetable or analytics dashboard. A mobile-friendly meeting mode presents the agenda, open actions and reviewed evidence in order.

**Data/engineering:** genuine authenticated identities, record-level access control, separate collaboration storage, review-pack versions and revocation checks are required. Existing device sync codes are not mentor accounts or access control. Keep mentor data out of AnalyticsStore. Define attachment sharing explicitly: local-only files cannot magically appear in a reviewer portal. Show the upload scope and retain local/offline drafting. Do not require or encourage identifiable pupil records.

**Release gate:** reviewer cannot read unselected records or another learner's pack; revoked access fails on the next server request; concurrent comments survive; invitation expiry works; local edits cannot alter a historical reviewed snapshot; export includes review history in an understandable format. Explain that revoking access cannot retract files a reviewer already downloaded.

### MF-04 — Connected calendars and course import inbox

**User outcome:** “My work calendar, university timetable and personal commitments appear together. Imported changes are understandable and do not create duplicate events.”

**Beyond today's app:** it already connects timetable sources and offers calendar exports/feeds. This adds **inbound external calendar events, source identity, reconciliation and eventually controlled two-way updates**.

**First release:** support an import inbox for user-selected ICS files and structured pasted/tabular data. Preview recognised dates, course timezone, overlaps and duplicates before saving. Each imported event retains source ID and original value. Imported busy intervals participate in planning without exposing private titles to study groups. Do not start with mailbox-wide access or arbitrary authenticated website scraping.

**Provider release:** add one OAuth-backed calendar connector, read-only first. Users choose calendars and whether to import full details or busy times only. Show last successful refresh, stale/offline state and per-calendar disconnect. Later allow writing only app-owned study blocks to a dedicated calendar; define conflict resolution before offering full two-way editing. Google documents per-calendar event change notifications; notifications trigger reconciliation rather than replacing an event-sync design. See [Google Calendar push notifications](https://developers.google.com/workspace/calendar/api/guides/push).

**Apple boundary:** use ICS import/feed workflows as the initial calendar route. Apple's documented EventKit access is a native-app integration; do not assume it is a browser API available to this PWA. A native companion or another verified integration requires a separate feasibility decision. This calendar feature is separate from the existing iCloud **backup** proposal. See [Apple EventKit access](https://developer.apple.com/documentation/eventkit/accessing-calendar-using-eventkit-and-eventkitui).

**LMS extension:** course-platform connectors require institution/provider support and permissions. LTI is an integration family, not a universal API to read every student's deadlines. Implement adapters only after verifying the actual institution's supported contract; keep manual intake useful on its own. See [1EdTech integration considerations](https://www.1edtech.org/hed/iln/dle-considerations).

**UI/data:** Connected sources has one row per source and a review queue for ambiguous changes. Model Source, ExternalEventIdentity, SyncCursor and Override; distinguish source cancellation from a temporary fetch failure. Store OAuth secrets separately from portable backups and analytics. Provider credentials/configuration are external prerequisites; implementers must not fabricate them.

**Release gate:** repeated imports are idempotent; cancelled/recurring events reconcile correctly; transient failures do not delete events; disconnect has an explicit keep/remove-imported choice; no app-generated event is reimported as a duplicate. Test credentials and provider APIs only in an authorised development setup.

### MF-05 — Course knowledge and revision workspace

**User outcome:** “Open a lecture and find its slides, my notes, related assignments and revision questions. Ask a question and see which of my materials supports the answer.”

**Beyond today's app:** Find searches existing local records and evidence serves professional reflection. This adds course-organised learning resources, cross-links, a revision queue and optional document-grounded assistance.

**First release without AI:** link or import user-selected resources into modules and sessions; add structured notes, bookmarks and manually authored revision cards. Provide a personal revision queue whose scheduling responds to the learner's own recall rating. Link a resource to multiple sessions or assignments without duplicating it. Search includes titles/tags/notes, and extracted text only for supported file types. Unsupported scans remain accessible files, not silently searchable documents.

**Optional AI release:** extract candidate summaries, flashcards or answers from explicitly selected documents. Display page/section references and distinguish quotation, summary and inference. Save generated cards only after review. When a source does not support an answer, say so. Never invent attendance, observation evidence or mentor feedback. Content in uploaded documents is data, not authority to execute actions.

**UI/data:** a module library with session and project filters; resource viewer with note pane on desktop and tabs on mobile; a short Review queue from Today. Model Resource, ResourceReference, ExtractedTextVersion and RevisionCard. Offline note/card use remains available. Define file limits, attachment availability, version changes and index rebuilding before implementation.

**Release gate:** source links resolve to the correct document/page; replacing a source invalidates stale extraction; deleting a resource does not silently delete the learner's notes; offline cards work; AI output cannot write project/evidence state without review. Any cloud AI processing needs explicit per-use disclosure of selected content, a configured provider, bounded usage and cancellation. Do not make the basic library dependent on an AI account.

### MF-06 — Collaborative coursework workspace

**User outcome:** “Our group has one project with agreed tasks, owners, meeting notes and a shared deliverable, while our private timetables and personal reflections stay private.”

**Beyond today's app:** study groups already share availability and meeting proposals. This expands them into an explicit shared-work context with membership, responsibility and progress.

**First release:** invite members into a project; shared task board with an owner and due date; meeting agenda and decisions; selected resource links; change history. Meeting proposals reuse the existing availability mechanism. Accepting an assigned task creates a linked personal task, with clear ownership of shared status and private planning blocks. Do not publish private event names merely to compute availability.

**UI/data:** group project lives alongside personal projects with a visible Shared badge. Member avatars/names show responsibility; “My work” filters assigned items. Introduce authenticated membership and per-project permissions, compatible with MF-03's access foundation but separate from mentor review roles. Private notes and work blocks remain local/profile-owned; share only explicit project records. Prefer task comments and decisions to building an unrestricted messaging platform in the first release.

**Release gate:** former members lose server access; edits from two members reconcile without silent loss; deleting a shared task does not erase unrelated personal notes; invitations cannot grant access to another group; no private timetable titles leak. Offline edits clearly show pending versus shared state. Backups must state whether shared records are an export snapshot or restorable ownership, rather than implying access rights can be restored from a file.

### MF-07 — Change-impact and replanning centre

**User outcome:** “A lecture moved to a different campus. Show me the clash it creates, which study block is affected and what I need to change.”

**Beyond today's app:** timetable refresh/change history and travel planning exist. This adds a dependency-aware impact assessment across commitments, work plans, project deadlines and journeys.

**First release:** compare stable source-event identities and create a before/after change record. Classify cancellation, time shift, location change and uncertain match. Show directly affected work blocks, overlaps and reduced planning capacity. Link to the session and offer a reviewed repair plan using MF-01. A room-only change should not trigger a full week replan. Ambiguous source identity must be resolved before merging records, preserving notes and attendance.

**UI:** Today gets one “Changes need review” summary; detail view shows old/new values, affected items and suggested actions. The user can acknowledge, postpone review or accept selected adjustments. This is a user-facing change inbox, not an admin analytics dashboard. On mobile show one change at a time with a clear return to the inbox.

**Later travel extension:** where a verified provider supplies fresh disruption/journey data, show its timestamp and the affected journey. Use conservative estimated travel buffers where live information is unavailable and label them as estimates. Offer alternate departure or study-block placement; never fabricate a route or guarantee arrival. No promise of constant closed-app location tracking.

**Data/engineering:** maintain SourceChange, ImpactAssessment and ProposedRepair with input revisions. Do not mutate canonical events twice because both calendar reconciliation and replanning reacted. Revalidate the plan before acceptance; coalesce repeated refreshes. Separate observed change facts from calculated consequences.

**Release gate:** unchanged refresh produces no inbox item; one changed event produces one coherent item; notes stay attached to the correct session; accepting a repair is undoable; a newer source change invalidates the old proposal; stale travel data never appears as live.

### Product sequencing and navigation

**Start with MF-02, then MF-01, then MF-03.** Together they create the strongest coherent expansion: manage the deliverable → allocate realistic time → review professional progress. Fix the audit's reliability issues alongside the foundations, especially reminder state and attachment recovery, before depending on them in larger workflows.

Keep the mobile navigation at Today / Schedule / Tasks / PGCE initially. Projects and group work sit inside Tasks; planning sits inside Schedule; mentor/placement work sits inside PGCE; resources are linked contextually from sessions/projects with a library entry. Reassess navigation after usage testing, rather than adding seven new tabs. Larger capabilities need progressive disclosure and useful empty states; they should not turn Today into a dashboard of every feature.

Before a selected major feature starts, its implementation spec must include: current-code reuse map; schema and migration; offline/sync/backup behaviour; permission model where shared; populated mobile/desktop layouts; loading/empty/error states; acceptance fixtures; rollout/rollback; provider setup and cost constraints if applicable. The original audit's completion-and-archive requirement applies to these enhancement documents and design assets too. Retain unimplemented proposals in the active backlog when archiving completed batches.

## 8. Mandatory completion step: archive enhancement files

**Once the enhancements are completed and verified, move all files related to the completed enhancement handoffs into an `archive` folder to keep the project clean. This includes this audit document and its supporting evidence. Do not perform this move while the handoffs are still needed for active development.**

“Enhancement files” here means completed planning/specification documents, mockups, before/after visualisations, screenshots, audit outputs and temporary handoff assets. It does **not** mean the application's implemented source, runtime images/icons, migrations, regression tests, worker code, deployment scripts or operating instructions.

Use `archive/enhancements/<YYYY-MM-DD>-<release-or-batch>/`, retaining subdirectories and filenames so the archived package remains understandable. A suitable completed package contains `PROJECT_AUDIT_2026-09-10.md`, its `evidence/`, completed earlier specifications and the visual assets those specifications reference.

Completion checklist for Claude:

1. Inventory the completed package and its inbound/outbound links. Review earlier `TIMETABLE_PWA_ENHANCEMENTS.md`, `TIMETABLE_PWA_REMAINING_PHASES_IMPLEMENTATION.md`, `handoff-assets/`, `admin-analytics-handoff/` and `timetable-app-audit/` individually. Some files may still contain active work such as cloud backups. Do not blindly move every historical directory because one batch is finished.
2. Separate remaining active tasks into a short current backlog with stable IDs and links before archiving their completed parent handoff. Keep any still-required development plan discoverable. Do not mark deferred NF-09 or optional features complete to enable cleanup.
3. Move completed documentation, mockups, screenshots and test-output artefacts using explicit reviewed paths (`git mv` for tracked files). Preserve referenced assets together. Do not delete them, bulk-move all Markdown, or move files based only on the word “enhancement”.
4. Keep `AGENTS.md`, `README.md`, current `PLAN.md`, active backlog, production `src/`, `shared/`, `public/`, `workers/`, `tests/`, `scripts/`, build configuration and required branding assets in place. Keep permanent regression tests in `tests/`; archive temporary audit harnesses and recordings only. Never move `node_modules`, secrets, user backups or `.git` into the archive.
5. Add an archive `README.md` with completion date, baseline/fix commits, outcome by issue ID, files included, verification results and any follow-on backlog links. Leave one concise current documentation index pointing to the archive, instead of duplicating all old specs in the project root.
6. Update links in AGENTS, PLAN, the documentation index and archived Markdown/HTML. Preserve relative image and stylesheet references. Confirm before/after galleries still load from their archived location. Rewrite obsolete absolute `file://` references where necessary.
7. Review the diff: only intended handoff paths moved, no runtime source/assets removed, no active Claude work overwritten. Re-run the build and check documentation links; run relevant tests if a referenced asset/configuration changed. Record the archive location in PLAN and the final handoff.

The archive move is part of finishing implementation, not part of this audit. Leave this new specification in its working location until the corresponding work is complete.
