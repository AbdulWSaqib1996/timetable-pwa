# Learner-app audit development plan (R1–R6 → Passes 50–55)

**Prepared:** 8 September 2026, against HEAD `61b9186` (admin analytics A1–A5 complete). **Governs:** how
[TIMETABLE_APP_AUDIT_AND_ENHANCEMENTS.md](TIMETABLE_APP_AUDIT_AND_ENHANCEMENTS.md) gets implemented in this
repository. The audit stays the source of truth for behaviour and acceptance; this plan sequences it onto the
repo's release conventions, records baseline drift since the audit's `f342695` snapshot, and fixes the routine
decisions inline. Decisions marked **Decided** are defaults chosen here — say so before the relevant batch to
change one. Nothing below starts until the owner says "Run R1" (or names a later batch).

## 0. Baseline drift since the audit (verified at HEAD)

Re-checked every finding against current source before writing this plan:

| Finding | Status at `61b9186` | Note |
|---|---|---|
| TT-01 desktop width (`.shell-main` 370px, `.week-grid` 322px @1440) | **still present** | CSS rules at `index.css` `.shell-main` / `:has(.page--wide)` / `.schedule-desktop` unchanged by admin work |
| TT-02/03 personal events missing from desktop Week/Month and search | **still present** | `SchedulePage` still feeds `filteredSessions`; `searchResults` still `courseSessions + allKeyDates` |
| TT-04, TT-06, TT-09, TT-10, TT-14, TT-15, TT-16, TT-17, TT-19, TT-20 | **still present** | learner UI untouched since audit |
| TT-05 Today device-local clock (`now.getHours()` in `TodayPage.tsx:94`) | **still present** | |
| TT-07 unrecoverable new-record drafts | **still present** | `useDraft` still loads by exact random id |
| TT-08 unguarded `decodeURIComponent` (`router.ts:53`) | **still present** | |
| TT-11/12 journey replan + stale leave plans | **still present** | `useJourney` fallback only in the initial `.then` |
| TT-13 `CommitmentSheet` drops `remind` | **still present** | no `remind` in the sheet at all |
| **TT-18 consent-safe collection** | **RESOLVED by admin A2 (Pass 46)** | shared queue, consent generations, immutable acked batches; Settings copy already truthful. Drop from scope; nothing to build |
| TT-21 key-date reminder chips in My timetable (`SettingsSheet` ~L676, inside `section === 'timetable'`) | **still present** | |

New constraints since the audit that every batch must respect:

- **A4 instrumentation lives at success points** — `App.updateAdmin` (pgce_record_saved diff), `App.saveTask`
  (task_created/completed), route-view effect, `SessionDetail` (journey/photo/nav events), `useJourney`
  (journey_planned), `sync.ts` (sync_outcome), export paths (export_prepared). Refactors in R1–R3 that move these
  functions must carry the `telemetryTrack` calls with them; the admin-a4 browser tests are the regression net.
  No new events are added by any batch here (audit §TT-18: new UI features do not authorise new collection).
- **Dashboard and worker are frozen for this workstream.** None of R1–R5 needs a worker change; R6 (recurrence) does
  and deploys worker-first. Reserved `ffffffff…` tokens and the retention flag rules from AGENTS.md stay in force.
- The evidence spec `evidence/current-audit.spec.ts.txt` is adapted into `tests/audit-r*.spec.ts` with expectations
  flipped from "observe defect" to "assert fix"; it is never run against production and never bundled.

## 1. Conventions binding every batch

Same discipline as P0–P7 and A1–A5:

- One branch per batch (`audit-r1` … `audit-r6`), small commits per work group, merged to `main`; PLAN.md §9.4
  completion record per batch (Passes 50–55) listing finding/feature IDs, before/after behaviour, files, tests and
  limitations — exactly what audit §10 asks for.
- Gate: `npm run validate` AND `VERCEL=1 npm run validate` green (unit + browser, both hosting layouts); rebuild the
  default layout afterwards. Every reproduced defect gets a regression test that fails first.
- Screenshots at 390px and 1440px in both themes for any changed surface, from synthetic data only, filed under
  `timetable-app-audit/evidence/r*-*.png` beside the audit's own captures for same-viewport comparison.
- Worker-first deployment only when `workers/` or `shared/` change (R6); push over port-443 SSH; watch CI for the
  exact commit; `./scripts/deploy.sh verify`; record verbatim output.
- Prohibitions carried from audit §10 and AGENTS.md: no changes to `registerType`, KV namespace ids, `vapid`, base
  URLs, production analytics or subscriptions; no owner data as test material; no restoring older full files.

## 2. Batch plan

### R1 — Trustworthy schedule, routing and saved work (Pass 50) — TT-01…TT-10

The largest batch, but the audit already cuts it into six reviewable groups; each is one commit, in this order so
later groups build on earlier helpers:

1. **Safe navigation** (TT-08): `src/lib/navigationState.ts` — guarded hash parsing returning a typed invalid
   route; "This link could not be opened" page with Today/Schedule actions; unknown settings section → settings
   index + notice; an app-level error boundary with a non-destructive reload; internal return-route tracking
   instead of `history.length > 1`. Tests: malformed escape, empty/oversized key, unknown section, external
   predecessor.
2. **Course clock** (TT-05): `src/hooks/useCourseClock.ts` giving one `{ nowMs, todayISO, wall }` source in
   `course.timezone` (refreshes each minute and on visibility resume); `TodayPage`, `JourneyHomePage`,
   `buildDemoSessions`, task `completedISO` and every `new Date().toISOString().slice(0,10)` used as a course day
   move onto it. A compact zone label appears when device ≠ course zone. Tests: London vs New York contexts at one
   instant, DST spring/fall, course midnight, profile timezone switch.
3. **Canonical projection + complete Week headers** (TT-02, TT-03, TT-04): `src/lib/scheduleProjection.ts`
   (owner type/key, date/time, title/location, source, revision, busy, actions) consumed by Today, mobile day list,
   Week, Month, busy indicators, counts and search; `shared/intervals.js` for overlap groups (also reused by group
   availability). **Decided:** a dedicated "Personal events" display toggle; subject/group filters apply to imported
   events only; search scope = all course-member events + personal events + tasks across all dates with the visible
   "All dates; display filters not applied" note; notes/photos stay out of basic search (NF-01 later). Week days =
   union of eligible timed events, personal events and deadline dates; header pins show two entries + accessible
   "+N more" opening that day's list.
4. **Desktop width + overlap-aware Today** (TT-01, TT-06): main grid item gets `width:100%; min-width:0;
   justify-self:stretch` with a Schedule content cap of 1440px and a 320px panel only at ≥1280px when the grid keeps
   ≥800px; `TodayPage` derives `current[]`/`upcoming[]`/`finished[]` by identity with "Also now" rows, clash counts
   for busy overlaps, a separate untimed section and "Show finished sessions". Tests: **positive** width assertions
   at 1024/1280/1440/1920 with panel open/closed (not just no-overflow); equal-start, nested and partial overlaps.
5. **Draft index + plan validation** (TT-07, TT-10): `src/lib/draftIndex.ts` over the existing envelopes (profile +
   kind index, stable draft id + intended record id for NEW records, Continue/Start new/Discard when exactly one
   matches, flush on close/pagehide, shape/version validation, remote-deletion conflict outcome); applied to
   commitment, task and every PGCE creation form. `shared/planValidation.js` for subtask/milestone/block rules
   (real dates, end > start, effort ≤ 6000 min) enforced at local save, backup import and sync ingestion; invalid
   legacy blocks surface as "Needs scheduling", never deleted or timed.
6. **Completed-task copy + explicit status actions** (TT-09): "Completed" (+ date when known) replaces "2d overdue"
   for done tasks; the cyclic status button becomes a labelled status menu.

**Gate (audit §9 R1):** every reproduced defect has a corrected assertion; readable desktop calendar and complete
mobile day in screenshots; a draft advertised as saved is recoverable with the same intended id; no invalid block can
commit. **Rollback:** view changes revert independently; the safe parser, clock and validation stay.

### R2 — Journey continuity and consistent actions (Pass 51) — TT-11…TT-17 (TT-18 already done)

Commits: (1) journey state as a discriminated union + the future→passed transition effect fetching exactly one
leave-now alternative with abort/generation protection and resume refresh (TT-11); (2) immediate leave-plan
supersession on intent change, publication keyed by profile + event + request identity, 15-second negative cache with
bounded backoff and a working Retry (TT-12); (3) `remind` preserved through `CommitmentSheet` with an explicit
"Remind me" control defaulting off (TT-13); (4) overlap lanes per connected component via `shared/intervals.js`
(TT-14); (5) desktop panel keyed by event key + return context, resolved against current data, closed on week change
unless pinned (TT-15); (6) `src/components/MapState.tsx` wrapping `StaticMap`/`RouteMap` with loading/partial/offline
states, single screen-reader status, no automatic re-requests (TT-16); (7) journey-home copy driven by the shared
state, saved-origin selection before any permission prompt, clipboard success/failure feedback (TT-17). NF-06's
saved-origin defaults and provider-capability declaration in the course config land here as groundwork.

**Decided:** leave plans are client-only (the worker contract never carried them), so TT-12 scope is the client
reminder consumer. **Gate:** future departure crossing replans without navigation; a superseded plan cannot drive the
display or a local reminder; a reminder-enabled commitment survives edit; all-tiles-failed remains useful.

### R3 — UI consistency and discoverability (Pass 52) — §5, TT-19, TT-20, TT-21, List view, Settings search

**TT-21 ships first as its own commit and may be released alone on request** — the key-date reminder timing group
moves to Reminders under a `key-date-reminders` anchor, My timetable keeps the source controls plus a
"Configure key-date reminders →" link, existing `keyDateReminderDays`/`toggleOffset` paths untouched. Then: page
width contracts (reading 720px, lists 960px, Schedule up to 1440px); Settings action in every primary mobile
header with dynamic nav columns (a three-destination course divides evenly); skip-to-content link and route
heading focus; Tasks grouped Today/Upcoming/Overdue/Completed with explicit status actions; PGCE reduced to four
section cards (Placement, Evidence, Development, Documents) with one primary action each; the accessible List
view sharing filters and anchor; local Settings search with synonyms. **Gate:** all destinations/actions still
reachable; 320–1920 matrices, zoom and keyboard pass; before/after screenshots compared at the same viewport.

### R4 — Planning and local retrieval (Pass 53) — NF-01, NF-02, NF-03

Repaired basic search first (R1), then the opt-in local "Find anything" index keyed by `(profileId, ownerType,
ownerId)` with tombstone invalidation, 150–250ms debounce, 50-result first page and a 10,000-entry performance
fixture; work-block calendar projection `plan:<blockId>` with a single owner (opens the parent's block editor);
"Plan week" gap suggestions over the same busy intervals (Monday start, 08:00–20:00, 30–120 min, every suggestion
says why it fits; nothing created without Save; undo restores). No recurrence yet. Group availability publishes plan
blocks as busy intervals only — no text, unchanged wire contract.

### R5 — Recovery and evidence workflows (Passes 54a and 54b) — NF-05, NF-08, NF-09 (NF-07 optional)

Split in two because the second half has an external prerequisite:

- **54a (no accounts needed):** data-health centre under Data & devices with truthful separate states ("Backup
  generated", never "safely backed up"); profile-scoped export with preview and owner-id handling; evidence review
  queue and binder selections with exact-output preview; and the **reviewed authenticated-encryption envelope for
  portable backups** (documented KDF/format/version, test vectors, wrong-key behaviour) — a separate subtask, never an
  improvised UI patch.
- **54b (NF-09 cloud backups):** the shared provider-adapter contract (`authorize/listBackups/upload/download/
  deleteOwnedBackup/disconnect` + file export/import capabilities); **iCloud Drive as the honest file/share path
  first** (needs no account — "Save to iCloud Drive" via share sheet with download fallback; restore via file picker);
  then Google Drive `drive.appdata` with in-memory tokens, "Reconnect to back up" on expiry, verified read-back before
  "Last cloud backup" changes, opaque filenames, scoped retention (latest ten, this installation, opt-in pruning),
  and the optional once-per-24h foreground automatic mode with its stated limits. CloudKit is a documented future
  option, not built. **Owner prerequisite before 54b starts:** a Google Cloud project with an OAuth client id
  (consent screen, both deployed origins + local dev origin, Drive API enabled) — an external account action I
  cannot and must not do; the provider card stays in its explanatory disabled state until the id is configured.

**Gate:** export matches preview; unavailable attachments explicit; Google/iCloud acceptance list 1–8 from NF-09 with
provider test accounts and synthetic content only; no tokens in archives, logs or storage.

### R6 — Recurrence and provider extensions (Pass 55) — NF-04, later NF-06 alternates

Weekly recurrence as a versioned `shared/` expansion helper (interval 1–4 weeks, weekdays, required end date,
≤12 months / ≤366 occurrences, deterministic occurrence ids from series id + original local occurrence, skip/move
exceptions, "this / this and following" with preview counts, DST-invalid wall-time correction policy). **Worker
deploys first** so reminder expansion understands series before any client creates one; creation stays disabled
until that deploy is verified. Alternate routes only from real provider alternatives with request identity and
freshness. NF-07 checklists only if the owner asks (P3, optional).

## 3. Sizing, sequencing and risk

| Batch | Pass | Size | Highest risk | Mitigation |
|---|---|---|---|---|
| R1 | 50 | XL — 6 commits | Projection refactor regressing existing schedule/Today suites | Build projection beside existing paths, switch consumers one at a time, keep all 61 browser + 129 unit tests green per commit |
| R2 | 51 | L — 7 commits | Journey state rewrite breaking P6 fixtures | Keep request-identity model; phase-six spec is the regression net |
| R3 | 52 | L — TT-21 first, then 5 commits | Nav/width changes vs both hosting layouts | Both-layout validate; 320–1920 matrix in a new audit-r3 spec |
| R4 | 53 | M–L — 3 commits | Search index leaking across profiles | Index keyed by profile; profile-switch and tombstone tests |
| R5 | 54a/54b | L + L | Cryptography and provider auth | 54a's reviewed envelope with test vectors precedes 54b; 54b blocked on the owner's OAuth client |
| R6 | 55 | L (worker + client) | Unbounded expansion / duplicate reminders | Shared bounded helper; worker-first deploy; creation gated on verified worker |

Order is strict R1 → R2 → R3 (TT-21 may go early) → R4 → R5a → R5b → R6, as the audit's dependency notes require.

> **10 Sep 2026 — NF-09 withdrawn.** R5b shipped (Pass 54b) and was then removed on the owner's instruction (Pass 58): the Google Drive and iCloud providers, their Settings section, hook, tests and setup notes are gone; the standard Back up / Restore (R5a, encrypted envelope) is the only backup path. Do not rebuild NF-09 without a new explicit go-ahead.
Each pass is releasable on its own; nothing in a later batch is pulled forward.

## 4. Decisions recorded (change any before its batch)

1. **TT-18 is closed** by admin A2 — no learner-side collector work; no new events for new UI.
2. **Personal-events visibility** is its own toggle; course filters never touch personal records (audit default).
3. **Leave plans are client-only**; TT-12 keying/supersession lives in the client reminder consumer.
4. **TT-21 ships inside R3 by default**, first commit; say the word to release it alone earlier.
5. **R5 splits** at the account boundary; iCloud file path precedes Google Drive; CloudKit deferred.
6. **Owner prerequisite:** Google OAuth client id + consent screen + origins before 54b (external; not something I
   can provision). Everything else in R1–R6 needs no new accounts, vendors or paid services.
7. **NF-07 (session checklists)** is optional and not scheduled unless requested.
8. **Numbering:** learner audit batches record as PLAN.md Passes 50–55, cross-referenced to R-numbers and TT/NF ids.
