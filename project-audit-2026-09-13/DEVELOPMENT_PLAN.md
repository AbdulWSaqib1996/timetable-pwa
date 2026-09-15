# Development plan — project audit of 13 September 2026

Planned 13 September 2026 against baseline `71a65d1` (Pass 75) for the handoff in [CLAUDE_HANDOFF_AUDIT_2026-09-13.md](CLAUDE_HANDOFF_AUDIT_2026-09-13.md). This plan turns the audit's batches A → D into release passes with explicit In/Out scope, decisions and gates, in the same form as the earlier packages (`archive/enhancements/*/DEVELOPMENT_PLAN.md`). Nothing here is implemented yet; each batch runs on the owner's "Run …" instruction and ends with a PLAN.md record, both validate gates, CI, `deploy.sh verify` and a What's new entry when the learner will notice a change.

## 1. Reading of the audit (what is and is not being asked)

- It is a **correctness-first** audit of what G0–G4 shipped, not a rebuild. Ten findings (B01–B10), five UI changes (U01–U05), five connected-workflow proposals (E01–E05).
- The three P1 items concern **which attachments leave the device** (B01), **re-sharing a pack** (B02/B03) and **two stores for school details** (B04). They gate everything else that touches sharing.
- Its probes assert *current defects* (`evidence/audit-sept13.spec.ts`, `evidence/audit-sept13.test.mjs`). They are not to be committed as-is; each batch converts the relevant probe into a positive regression test in `tests/`.
- Its §6 order is binding: A → B → C → D1 → D2 → D3. Its §7 archive rule applies at the end (move this package to `archive/enhancements/2026-09-13-project-audit/` with a README of delivered/deferred IDs).
- Standing rules from the earlier packages still hold: no automatic outcomes, no telemetry events, no cloud providers, no new vendors; placements are SE1/SE2/SE3 in data (the audit's P1/P2/P3 are proposed *labels* — U01/U03 may show "P1" as a display label but never rename ids or source tags); workers deploy first on any `shared/` or `workers/` change; never `git add -A`.

## 2. Verified against the current code (13 Sep)

Before planning, each P1/P2 finding was checked against `main`:

| ID | Confirmed? | Note |
|---|---|---|
| B01 | Yes | `ReviewPackSheet` keeps `picked`, `shareWith`, `shareAtt`, `shareMsg` across `selectedId` changes; `shareAtt` ids are resolved against the whole wallet |
| B02 | Yes | `/mentor/share` appends `attachments` to an existing pack record; KV key `matt:<space>:<pack>:<att>` is overwritten; `/mentor/attachment` takes the first metadata match; the ≤5 cap is per request |
| B03 | Yes | pack attachments and mentor share use `String(f.id)` (IndexedDB auto-increment); `attachmentUid` exists in `src/lib/attachments.ts` and is unused here |
| B04 | Yes | `SessionDetail.placementInfo`, `DayList` school line and the worker reminder payload read `settings.placements[tag]`; the chooser/workspace read `admin.placements` + `admin.schools`; G1a only mirrors a *confirmed* setup into the legacy map |
| B05 | Yes | `MentorApp` `join/login/send/download/load` have no try/catch/finally; `busy` stays true on a rejected fetch |
| B06 | Yes | `mentors === null` is rendered as "Loading…"; the effect depends on `profileId` only; wallet load failure becomes `[]` |
| B07 | Yes | `mapsUrl` carries destination + travel mode only |
| B08 | Yes | "Turn off on this device" clears `mentorSpaceId`/`mentorOwnerToken` (synced fields) |
| B09 | Yes (by construction) | `sameDayTitle` merges by day + title; a timed course session with a deadline's title is dropped from the calendar |
| B10 | Yes | Delete pack is local only; there is no unshare route or client action |

## 3. Batches

### Batch A — sharing correctness and one school truth (Pass 77) — B01, B02, B03, B04

> **Status (13 September 2026): implemented as Pass 77** — see PLAN.md. Deviations: none of substance; the legacy-map mirror from G1a was removed rather than kept as a projection, and the worker's share/attachment handlers moved outside the storage transaction because they touch KV.

**In**
- **B03 stable attachment identity first** (it underpins B01/B02): pack attachment references become `{ uid, profileId, name, size, digest? }` using `attachmentUid`; numeric IndexedDB ids stay local handles. Wire validation for the new shape; migration of existing `attachments[]` entries by resolving the local numeric id → uid where the file is present, else marking `missing` with a **Relink** control ("Missing — choose the original file"); backup/restore keeps uids. Mentor share attachment ids become the uid (hash-encoded to satisfy the worker's id regex).
- **B01 isolated pack editor state**: `picked / shareWith / shareAtt / shareMsg` keyed by `{profileId, packId}` (a draft per pack, reset on profile change); files resolved only from the current pack's references ∩ wallet ∩ explicit selection; the share becomes an immutable **share command** `{packId, revision, recipients, attachments}` built at confirm time; a status line per pack. Test asserts the exact request body across A→B switches.
- **B02 replacement semantics on the worker**: `/mentor/share` replaces the pack's manifest atomically (`{revision, text, mentorIds, attachments}`); ciphertext keys become `matt:<space>:<pack>:<rev>:<att>`; upload ciphertext first, commit manifest second (a failed commit leaves the previous manifest valid; the previous revision's KV entries age out on their TTL); `/mentor/attachment` and `/mentor/packs` serve the committed revision only; the ≤5 cap is a bound on the manifest; retries are idempotent by `(packId, revision)`. Client shows a **diff before replacing** (text changed / recipients ± / files ±) and says plainly that downloaded copies cannot be recalled. Worker deploy first.
- **B04 canonical school resolver**: `resolvePlacementForSession(session, admin, settings)` in `src/lib/placementResolve.ts` — block tag → placement → school (coordinates, confirmed state, mentor, working hours, provenance `canonical | legacy | none`). `SessionDetail` travel, `DayList` school-day card, Today's placement label, the reminder payload projection and exports read it; the legacy `settings.placements[tag]` is read only for unmapped blocks and shown as "from the timetable — set up the placement to confirm"; school edits from the session detail open the placement setup flow instead of writing the legacy map.

**Out**: UI restructuring (Batch C), unshare (B10 in Batch B), any deletion of stored KV records (TTL only).

**Decisions**: attachment uid = `attachmentUid` (existing, content-derived); share revision = monotonically increasing integer per pack in the DO; legacy map kept read-only for unmapped blocks (never deleted).

**Gate**: probes converted — cross-pack isolation with exact bodies; reshare with zero files → zero accessible; same file twice → one decryptable; five as a total bound; injected upload/commit failure leaves the prior share readable; two devices with wallet row `1` holding different files never resolve to each other; editing SE2's school updates chooser, session details, school-day cards and the reminder payload while SE1/SE3 stay byte-identical; Pass 69/72/73 suites green; both gates; workers deployed first.

### Batch B — recovery and control (Pass 78) — B05, B06, B07, B08, B09, B10

> **Status (14 September 2026): implemented as Pass 78** — see PLAN.md. Deviations: the "2 items" affordance is a caption under each grouped key date rather than a collapsed group; the close-space route is `/mentor/close` with `/mentor/reopen` as its inverse; the two-device pause/sync test is a unit test of the sync projection (the pause never leaves the device) plus a browser test that the paused device keeps the credential and can still revoke; a replay of the current revision is now accepted only when the manifest is identical, so a client that missed an unshare gets 409 rather than a silent no-op.

**In**
- **B05** portal operations with an explicit status machine, bounded timeout/abort, `finally` cleanup, named Retry, drafts preserved, late responses discarded after sign-out/route change; 401 = expired, 403 = access ended, network = connection, decryption = attachment error; copy "Feedback saved. The learner can collect it in their app."; feedback submission idempotent by a client-generated id.
- **B06** `idle | loading | ready | error` for the mentor list and the wallet in `ReviewPackSheet` and `MentorAccessSection`; effects keyed on space id and service base; wallet storage denial ≠ empty wallet; one polite status region, alerts on failed actions.
- **B07** a shared `externalRouteUrl({origin?, destination, mode})` builder used by placement journeys and the home journey: "Open planned route" carries the selected saved origin; "Navigate from my location" is the separate, labelled device-origin action; pure tests per mode.
- **B08** keep the credential: device-local `mentorAccessPaused` (added to `deviceSettings` so it never syncs) replaces "turn off"; "Manage shared access" and a separate, owner-authorised **End mentor access** with an impact preview; a service-side `close-space` sets a recoverable `closedAt` and denies mentor routes (no data deletion). Two-device test for pause/sync/restore.
- **B09** dedupe safety: `dedupeKeyDates` merges only when the pair is *equivalent* — same day, same normalised title **and** (same start, or one side untimed) **and** no differing module/room — otherwise both stay and are grouped with a "2 items" affordance; a timed course session is dropped only when it has the key date's title and the same start (or the key date is untimed and the session is the only one with that title that day). Pass 74's fixture still yields one row.
- **B10** "Delete local pack" shows the share summary; new owner-authorised **Unshare** (`/mentor/unshare`, idempotent, denies portal access from then on, says downloads are not recalled); reviewable confirmation + Undo for pack and reflection deletion (tombstone semantics unchanged).

**Out**: navigation restructure (Batch C), new collections beyond a `sharing` summary on the pack record.

**Gate**: offline/401/403/503/malformed/decrypt-failure matrix for the portal with no permanently disabled control; error vs empty vs loading distinguishable; external links contain the intended endpoints per mode; pause keeps the space and the sole device can still revoke; B09 fixtures (same title different times; a lesson titled like a deadline) both visible while Pass 74 stays green; unshare denies `/mentor/packs` and `/mentor/attachment`; workers deployed first.

### Batch C — usability (Pass 79) — U01, U02, U03, U04, U05

> **Status (14 September 2026): implemented as Pass 79** — see PLAN.md. Deviations: the pack list on phones is a horizontal strip above the full-width detail rather than a separate screen (so a pack can be switched without leaving the editor); the records sheet, lesson workbench and review packs keep their transient (non-URL) openings from Today, the placement workspace and the record menu, while the PGCE landing always opens them by URL; the record header shows the local draft state ("Draft kept on this device") rather than a second autosave; the desktop schedule keeps its Placements toggle in the toolbar — on phones it moved into the labelled More menu; "Today" sits on the week-navigator row (the date row) rather than the toolbar, because a 390px row cannot hold the view selector, Filters, Clear, Today and More at 44px without truncation; body line-height is 1.45 (the spec's "about 1.5") so the demo Today page's last row still clears the add button at 390×844.

**In**
- **U01** PGCE landing: compact active-placement card (SE code with an optional display label, school, state, All placements / To school / Back home), **one** recommended next action with its reason (precedence: unresolved data/access issue → near dated commitment → unfinished recent work → onboarding) using `nextSteps`/attention selectors, four destinations (Lessons & practice; Mentor & feedback; Evidence & reviews; Academic work & programme), Documents / Experience ledger / All records beneath; last section remembered per profile; every one of the eleven menu functions reachable by a labelled destination.
- **U02** review packs as list/detail (split view ≥ 768px, full-screen on phones) with **Content → People → Check & share**: searchable candidates (placement, date, type), pin with count, readable preview whose text still equals the export, current-pack attachments only, a final share summary with the diff from the prior share, sharing state (Never shared / Shared v N / Changes not shared / Failed) beside the learner state; Discussed requires a valid date with an inline error.
- **U03** mobile Schedule toolbar: one row (view selector, Filters with active count and Clear, Today), one week navigator, the strip; Find beside the title; school-day card with school name, working hours and source note, Open school day / To school / Back home; key dates first (Pass 74); Plan study time as a secondary weekly action.
- **U04** token pass: 16px body, 14px supporting, heading scale, 44px targets, focus rings kept; mentor portal restyled on the shared tokens with accessible dark-mode button/accent/error colours (contrast computed in `tokens.test.mjs`); visible labels on textareas; tab widgets with arrow keys and panels; reduced motion honoured incl. the completed-task reveal.
- **U05** URL destinations for the major PGCE workspaces (`#/pgce/<section>`, `#/pgce/lesson/<id>` …) replacing stacked sheets where sensible; record header with type, placement, date, save state and Back; Add vs Open distinct; no unlabeled destructive icon beside Edit; deep link / refresh restores the record; failed save keeps input.

**Out**: new features (D batches); renaming persistent ids.

**Gate**: matrix at 320/390/768/1440, light/dark, 200% text, keyboard; two-action reach for the current lesson and mentor prep; nothing lost from the eleven functions; `v1-foundations`, `v5-matrix`, `gap-closure` suites extended rather than relaxed.

### Batch D1 — connected teaching (Pass 81) — E01, E04

> **Renumbered**: two owner requests of 15 September 2026 (key dates completed rather than attended; lessons setting homework due in a later occurrence) shipped first as Pass 80, so D1 is Pass 81, D2 Pass 82 and D3 Pass 83. E01 should build on the `homework` collection that pass added rather than a second store.

**In**: `learningThreads` collection (refs only: placementId, lessonIds, observationIds, cycleId, chosen next action, state, revision) with a "This teaching cycle" view Plan → Teach → Feedback → Try next and a compact timeline atop the lesson workbench; placement transition record + checklist (School & travel, Teaching context, Mentor & access, Carry forward) with outward/return endpoint preview and an optional per-placement return destination with a labelled global-home fallback.
**Out**: any automatic target or judgement from feedback; pupil data.
**Gate**: thread round-trips reload/sync/backup; one observation informs many threads without cloning; finishing SE1 keeps its history; starting SE2 cannot overwrite SE1 fields; changed SE2 coordinates invalidate the travel check.

### Batch D2 — academic and weekly flow (Pass 82) — E02, E03

**In**: weekly review over the existing workload planner (this week planned/logged/open; next week fixed/free; diff of moved/added/untouched blocks; accept individually or as a batch; stale proposals invalidated by timetable changes) and the assignment workspace (outline sections, draft references by wallet uid or link, submission record with learner-recorded receipt, feedback refs, source list) built on projects/readings/tasks.
**Out**: LMS or provider connections; any wellbeing or QTS score.
**Gate**: accepting twice never duplicates; Undo touches only its batch; a deadline change updates the linked view without a duplicate pin; receipts survive backup by uid; resubmission adds history.

### Batch D3 — data confidence (Pass 83) — E05

**In**: the data & sharing centre — On this device / Synced / Backed up / Shared with mentors from confirmed receipts, per-record/file table (where stored, bytes in backup?, share revision, remote expiry), restore preview (adds/replaces/missing) before applying, relink for missing files, a plain-language recovery guide that never includes secrets.
**Out**: cloud providers (Pass 58 decision stands).
**Gate**: an offline upload is never "backed up"; text-only export never claims files; expired mentor attachments obvious; remapped local ids keep links via uid.

### Completion — archive (with the last batch)

Per the audit's §7: move `project-audit-2026-09-13/` to `archive/enhancements/2026-09-13-project-audit/` with a README listing delivered/deferred IDs, commits and validation; update PLAN.md and `archive/README.md`.

## 4. Cross-cutting decisions

1. **Order** is the audit's: A → B → C → D1 → D2 → D3; A ships before any further sharing change.
2. **Identity**: attachments by `attachmentUid`; share revisions per pack; placements/schools by id; no renaming of persistent ids for display labels.
3. **Worker changes** (B02, B08, B10) each deploy first with `tests/unit/mentor-store.test.mjs` extended; no KV deletion beyond TTL.
4. **Probes → tests**: each finding's audit probe becomes a positive regression test under `tests/` in the batch that fixes it; the audit's own probe files stay in the package.
5. **What's new** entry for every batch that changes the learner's app (AGENTS.md rule 5).
6. **Sizes**: A = L (three worker/client contracts + resolver); B = L; C = L (five screens); D1–D3 = M each.

## 5. Questions for the owner (defaults apply if unanswered)

1. Display labels: show placements as P1/P2/P3 (audit) or keep SE1/SE2/SE3 on screen? — *default: keep SE1/SE2/SE3 on screen (owner's own codes, Pass 69); ids never change either way.* Keep SE1/SE2/SE3
2. B08: should "End mentor access" also be offered as a service-side close of the whole space? — *default: yes, recoverable (`closedAt`), no deletion.* Yes
3. U05: replace the large transient sheets with routes in Batch C, or keep sheets and add routes only for deep links? — *default: routes for the PGCE workspaces, sheets kept for quick-add forms.*
4. Batch C order vs D1: run usability before connected features (audit order) — *default: audit order.*
