# Visual UI audit — development plan (batches V0–V5 → PLAN.md Passes 56–57, 59–61 and 63; Pass 58 is the owner-requested cloud backup removal; Pass 62 is the gap closure after the owner's check — see GAP_AUDIT_2026-09-10.md)

**Source:** [VISUAL_UI_AUDIT.md](VISUAL_UI_AUDIT.md) (10 September 2026) with its `designs/` and `evidence/`, plus the carry-forward defects FA-01–07 in [../project-audit-2026-09-10/PROJECT_AUDIT_2026-09-10.md](../project-audit-2026-09-10/PROJECT_AUDIT_2026-09-10.md). **Owner instruction (10 Sep 2026):** *no functionality may be lost — e.g. the map and the train/TfL view.* Section 1 is therefore a preservation register that every batch is gated on, before any visual work is judged.

**Status of the audit's baseline notes (checked before planning):** B-01 (`snapshot.ts` type error) was already fixed the same evening, but with an unchecked cast — V0 replaces it with the typed projection the audit asks for. The device-to-device sync fix and cloud backups (R5b) are both merged and live; the Google card is configured with the owner's client id. The audit's "Vite-only visual bundle" is not a gate; every batch runs the normal `npm run validate` on both hosting bases.

---

## 1. Functional preservation register (gate for every batch)

Each row is a control or state that exists today. A batch that touches the screen must keep the row working **and** keep (or add) the named test. Restyling never removes a control to match a mockup; where the audit relocates something, the destination is written here and gets a navigation test.

| Screen | Must survive (exact current behaviour) | Regression net |
|---|---|---|
| **Today** | Changes bell + badge, Refresh, Settings; urgent line; next/current hero with room + building, "Session details", **Directions** (stays one tap: secondary hero action or labelled item); "Also now" clash list; remaining day incl. personal events and plan blocks; "Show finished sessions"; deadline summary + overdue review; **Journey home** row; attendance quick-answer card; add-event FAB; course-time badge; demo/updated stamp | `phase-four-visual`, `audit-r1` (classifyNow), `notifications-quick` (card) + V1 additions |
| **Schedule (mobile)** | Week / Month / List; 7-day strip with selected-state + full spoken date, prev/next week, Today; day list with clash badges, free gaps, placement day blocks; key dates woven in; placements-only toggle; Filters (count, Clear); search with scope note + "Search everything →"; **Plan week**; add personal event on a day; month dots/legend | `phase-three`, `phase-four-visual`, `audit-r1/r3/r4`, `sync-devices` |
| **Schedule (desktop)** | Positioned week grid with exact half-hour offsets; component lanes for overlaps (TT-14); "+N more" key-date expander; weekend union columns; side panel ≥1280 with **Pin**; List view; toolbar | `audit-r1/r2/r3` |
| **Session detail — Overview** | Title/date/room, course link (Moodle or course-configured label), Attended / Absent (reversible), notes textarea, Teachers' Standards chips, **Review later**, photos (add via picker/camera, caption, delete, "N recorded elsewhere"), identity-review banner, personal-event edit/delete, Back to caller | `phase-five`, `audit-r5a`, `notifications-quick`, `audit-r4` (Back) |
| **Session detail — Travel & map** | Intent (arrive-by with **arrival buffer** / leave-now); **origin selector** (device fix, home, campus, placements — labelled native control); plan status with freshness ("live TfL" / "TfL route from Nm ago" / estimate) and **Retry**; leave-by / arrival summary; departure-passed → leave-now alternative; **Journey steps: walk/bus/tube legs with line colours, live departure boards, disruption warnings (deduplicated)**; **RouteMap with provider geometry, leg highlight, tile status (loading/partial/failed), Retry map**; StaticMap fallback with address; **Copy address** (honest failure); **Open in Google Maps**; weather note; entrance/step-free disclaimer; `no-provider` course state | `phase-six`, `phase-seven`, `audit-r2` (TT-11/12/16/17), unit `journey.test.mjs` |
| **Journey home** | Origin picker + "Use this origin by default"; state-driven subtitle (choose origin / planning / live with age / estimate / unreachable / no route / external); TfL route + map (same components as above); Copy address; Open home in Maps; Set home when none; Back to caller | `phase-four-visual`, `audit-r2` (TT-17) |
| **Tasks** | Overdue / Today / Upcoming / Completed grouping and order; summary chips; local search; explicit status `<select>` (todo/doing/done) that updates the single owner; row opens editor/detail; mentor actions with named checkbox + **Open meeting**; Add task; delete + Undo; work-plan editor with in-place block editing | `phase-one`, `phase-five`, `audit-r1/r3/r4` |
| **PGCE** | Four cards → placements page, evidence journal, weekly reflections, targets / meetings / observations / lessons / audits (QuickMenu), wallet, **Print binder & exports**, **Term stats**; counts from real records; journal review queue + binder selections | `phase-five`, `audit-r3/r5a` |
| **Settings** | Seven categories, index search + synonyms, anchors/deep links (`#/settings/<section>`), Done/Back, profile switcher; My timetable (sources, merge tabs, key-dates **source**, notices, specialisms, term start, course setup, study group); Reminders (session offsets, **key-date reminders**, attendance prompts, leave alerts, quiet hours, background push, self-check/test push); Travel & home; Connected calendars (feed URL, .ics export incl. personal toggle); Data & devices; Appearance; Help | `phase-four-visual`, `phase-seven`, `audit-r3` (TT-21, search) |
| **Data & devices** | Data-health states (saved/synced/photos/last backup **generated**/drafts/storage/sources/sync status + cadence); Attendance analysis + CSV (**relocates** to PGCE stats with a link back — V3); Back up sheet (scope, preview, passphrase); Restore sheet (unlock, preview, recovery journal); ~~Cloud backups~~ (**removed on the owner's instruction, 10 Sep 2026 — Pass 58**: only the standard Back up / Restore remains); Sync (code, Sync now, rotate, disconnect) | `audit-r5a`, `backup-only`, `sync-devices`, `phase-two` |
| **Find** | All six record types, notes/captions opt-in, type chips, ↓/↑/Enter, Show more, preserved query, pending-refresh honesty | `audit-r4` |
| **Admin analytics** | Six pages (Overview, Return visits, Feature adoption, Reliability, Releases, Data & access) + Lock; Bearer-only, no credential in URL; legacy vs v2 datasets kept separate; charts with zero baseline, units, legend, data table, keyboard/tooltip; CSV export | `admin-a1…a5` |

Two global rules from the owner instruction: (1) every relocation gets a **navigation test** proving the control is still reachable in ≤2 purposeful steps; (2) map and TfL surfaces are compared **state by state** (missing origin, loading, live, cached, expired, no route, provider failure, tiles failed/partial, no-provider course) with the fixtures already in `audit-r2` / `phase-six` — a restyle that cannot render one of those states is not merged.

---

## 2. Conventions (unchanged from R1–R5b)

One branch per batch (`visual-v0` … `visual-v5`), small commits, merged to `main`; a PLAN.md §9.4 record per batch; `npm run validate` AND `VERCEL=1 npm run validate` green; screenshots at 320/390/768/1024/1440 in light and dark (plus reduced motion and 200% text where the batch changes type), from synthetic fixtures identical before/after, filed in `visual-ui-audit-2026-09-10/evidence/v*-*.png`; worker-first deploy only when `workers/` or `shared/` change; push over port-443 SSH; CI watched per commit; `deploy.sh verify`. Prohibitions carried forward: no telemetry events, no sync/metrics/reminder-rule/consent changes as a side effect of styling, no `git add -A` (the repo carries foreign audit folders), never archive another developer's unfinished work.

---

## 3. Batches

### V0 — Carry-forward defects and the typed projection (Pass 56)

Small and first, because two of them touch code shipped this week.

1. **B-01 done properly:** replace the `as unknown as` cast in `src/lib/cloudBackup/snapshot.ts` with a typed `stripForCloud(settings): Settings` that omits only the denylisted optional keys; unit-assert the required keys survive. Run the cloud-backup and backup round-trip suites.
2. **FA-01/02/03 — attendance reporting to the worker:** acknowledge only a stored report (record the reported set after a 2xx, not before); scope the reported-set cache to the subscription endpoint/profile and re-report when push is re-enabled or the endpoint changes; make suppression reversible (clearing a mark removes the key on the next report — the worker replaces the set instead of union-only). Worker change → workers first.
3. **FA-04 — course clock in reminder maths:** the in-app loop's `new Date()` arithmetic moves to `useCourseClock`/`shared/calendar-time` so a device in another zone reminds on course time; keep `notifications-quick` pinned to Europe/London AND add a New York device fixture.
4. **FA-05 — shared photos:** dequeue a shared photo only after the attachment write succeeded (recoverable), never on read.
5. **FA-06/07 — backup coverage per profile and restore effects per section:** "Last backup generated" per profile (the scoped export marks only its profiles); the restore preview lists per-section effects (replaced / merged / untouched) using `backupSummary`.

Gate: existing 153/113 stay green; new tests per item; PLAN record.

### V1 — Foundations: tokens, type, controls, contrast (Pass 57) — V-01, V-02, V-03, V-05

- Semantic tokens in `src/index.css` for the audit's pairs (primary, supporting `#526078`, saved `#116653/#e6f4f0`, attention `#865000/#fff3d6`, error `#9f1d1d/#fdecea`, development `#7041a2/#f2ebff`, information `#1e5f98/#e7f1fc`) and the checked dark set (`#121b29 / #1d2a3d / #edf2fb / #b1bfd2`); the `.workload-line.heavy` pink and the other hard-coded pink/orange labels move onto the error/attention tokens, each pair re-measured (a unit test computes contrast from the token values — ≥4.5:1 text, ≥3:1 large/UI).
- Type scale: page title 26–28/32–34 700, section 18/24, card 16–18, body 16/24, supporting **14/20**; 12–13px only for metadata and dense desktop calendar labels. Tabular numerals for times/metrics.
- Shared control variants in `ui.tsx`/CSS: `btn-primary`/`secondary`/`ghost`, segmented tabs, chips, icon buttons at **44×44** (20px icons); the 27px view tabs, 24px arrival chips, 32px attendance actions and ~15px Copy address measured in `evidence/ui-measurements.json` are the named targets, re-measured by a test.
- One line-icon family for core controls (extend the existing `Icon*` primitives); emoji only in optional personality copy. Icon-only buttons keep names; ambiguous frequent actions get visible labels.
- Backup nudge (V-04) moves from above every page heading to Data & devices / the backup entry points with an attention count that clears only on explicit action or snooze; pending-save **errors** stay global.

Gate: measurement test (no essential control under 44px; no ordinary text under 14px except allowed metadata classes); contrast unit test; all suites green; before/after at same viewports.

### V2 — Daily use: Today, Schedule (mobile + desktop), Tasks, Session detail (Pass 59) — V-01, V-06 (detail structure), V-09, V-10

- **Today:** heading/date, one attention summary, one next-session card with labelled time/room icons, title split into heading/subtitle with the full title in the accessible name and detail; later sessions as readable cards; Journey home as an explicit row; **Directions stays a one-tap secondary hero action**; state contract (before first / current / overlapping / after last / empty) each with a next action; attendance card above the finished-day state.
- **Schedule mobile:** larger segmented control, labelled strip (selected-state, keyboard, full spoken date), day summary, consistent time/title/location hierarchy; secondary functions into a labelled **More** menu (QuickMenu) rather than removed.
- **Schedule desktop:** comfortable density (64–72px/hour) with a compact alternative; lanes collapse into a **"N parallel sessions"** group only below a measured 100px lane width, and the group opens a panel listing every record (count exact, three records open three details); positions stay exact; source category labels drive colour, not title guesses.
- **Tasks:** card per task with title on its own line, semantic badges (overdue error, upcoming attention), one clear action, quieter Completed disclosure; status control keeps updating the single owner; provenance kept without exposing ids.
- **Session detail:** identity → time/location → attendance as one 44px grouped choice with pressed state → Notes & evidence section → Travel as a clear tab; saved/pending/failed shown truthfully; travel reachable without scrolling through the evidence form.

Gate: preservation rows for these four screens; new tests for the overlap group (expansion + keyboard), Today state contract, tasks at 320px, detail tab order.

### V3 — Travel and settings (Pass 60) — V-06, V-07, Reminders, Find

- **Travel & map:** origin → destination → status → **primary action** ("Choose starting point" when missing; Directions/leave-by when planned) → options (arrival buffer as a secondary preference); compact unavailable-map card with Retry; 200–240px map viewport on mobile with the address outside the image and attribution kept; **every current travel component stays** (origin selector, plan status/freshness/Retry, journey steps with live departures and disruptions, RouteMap geometry/leg highlight/tile states, StaticMap fallback, Copy address, Google Maps, weather, disclaimer). Add the successful-route fixture screenshot the audit asked for.
- **Journey home:** one origin/destination summary, distinct "Choose starting point" and "Open home in Maps", edit-home grouped with the address; Copy address and Retry map kept in the detail group; no-home → Set home + return.
- **Settings index:** full-row buttons with icon tiles and one accessible name, 14px descriptions, Done/Back only; search and anchors unchanged; TT-21 placement preserved and re-tested.
- **Data & devices:** order = save/sync/backup state → Back up / Restore → connect another device (sync) → storage & advanced (expandable; draft problems surfaced automatically); attendance analysis moves to PGCE Term stats with a link back; mobile values left-aligned under labels, two-column only ≥640px; "Offline" when offline.
- **Reminders:** groups = device status (**"Blocked on this device"** with recovery steps when denied), session reminders, leave alerts, attendance prompts, key dates, quiet hours; wrapping 44px chips; timezone label; "Configure" opens existing values.
- **Find:** labelled field, scope chips (all six types kept), grouped results, "what is indexed" note; keyboard contract unchanged; no recent-search tracking.

Gate: travel state-by-state comparison (nine states) in both themes; Data & devices relocation navigation test; blocked-permission fixture; all suites green.

### V4 — PGCE and admin analytics (Pass 61) — V-08, V-10

- **PGCE:** four sections with consistent icons and category colours (teal/indigo/violet/blue as identity, not warnings), desktop two-column, destination-named links instead of "View all", Set up / Open placement by state, attendance analysis hosted here; every record editor reachable in ≤2 steps; no invented percentages.
- **Admin:** navy rail with shared type/spacing/icon language, headline cards keeping the legacy fixture values, a separate v2 card with the non-comparability warning, source/period/partial-day beside numbers, mobile stacked cards + report selector; charts keep zero baselines, units, ticks, legend, data table, keyboard/tooltip; reporting-window control only where the metric supports it; all six pages + Lock retained; no contract, retention or telemetry change.

Gate: `admin-a1…a5` green unchanged; PGCE empty and populated fixtures; count badges from real records.

### V5 — Validate, capture and archive (Pass 63)

Normal build + both validate gates; captures at 320/390/768/1024/1440 light/dark, reduced motion, 200% text, keyboard-only runs, focus after route/modal transitions, scroll reachability under the nav/FAB, permission failures, map failure, stale data, unsaved edits, offline. A designer/developer review of the screenshots, not only assertions. Then the audit's **required archive step**: move `VISUAL_UI_AUDIT.md`, `designs/`, before/after captures and evidence to `archive/enhancements/2026-09-10-visual-ui/` with a README of completed IDs and results, relative links intact, linked from PLAN.md; production source, permanent tests, runbooks and any unfinished work stay put.

---

## 4. Decisions taken in this plan (change them here, not ad hoc)

- Order: V0 (defects) before any restyle; V1 tokens/controls before screens, because V2–V4 consume them. R6 (recurrence, Pass 55) stays queued and can run before or after V0 on the owner's call; MF-01–07 remain proposals.
- The desktop "parallel sessions" group is an **interaction change** and ships only with its expansion + keyboard tests; below the 100px lane threshold only.
- The backup nudge relocation and the attendance-analysis relocation are the only two moves; both get navigation tests and a link from the old place.
- Emoji is replaced only for core controls (navigation, exports, placements, view/filter toggles); the demo/personality copy keeps it.
- Dark theme tokens are adopted as specified but each state colour (active/hover/disabled/error/focus) is checked individually in V1; the dark mockup is direction, not a diff target.
- Nothing in the mockups' static copy ("saved", "backed up", route times) is implemented as text: each state renders from real persistence/journey state, per the audit's own rule.
