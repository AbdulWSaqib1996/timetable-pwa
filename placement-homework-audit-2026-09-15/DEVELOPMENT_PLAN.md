# Placement & homework review — phased implementation plan

**Source:** [PLACEMENT_HOMEWORK_REVIEW_2026-09-15.md](PLACEMENT_HOMEWORK_REVIEW_2026-09-15.md) (baseline `3429667`). **Planned:** 16 September 2026, after Passes 83–85 (audit Batch D) shipped. **Status:** Batch 1 shipped as Pass 86 (16 September 2026); Batches 2–4 are planned only. Each batch below becomes one release pass under the runbook in `AGENTS.md` (branch, both validation gates, workers first when `shared/` or a worker changes, PLAN.md record, What's new entry).

## 1. What the review found, checked against the code as of `0283fe6`

The review's findings were re-read against the current tree. Everything it reports as a defect is still present; three of its five feature proposals were partly or wholly delivered by the audit's Batch D while the review was being written, which changes their scope.

| ID | Still valid? | Notes |
|---|---|---|
| PL-01 address edit keeps the old pin | **Yes** | `PlacementSetupFlow` patches `address` and `lat/lng/confirmedAt` independently; `locate()` applies any response. |
| PL-02 Settings detour loses the draft | **Yes** | The flow's state is component-local; `onOpenSettings` unmounts it. The draft index (`src/lib/draftIndex.ts`) exists and is unused here. |
| PL-03 per-placement inset policy ignored | **Yes** | `insetCountsAsSchoolDay` is saved and never read by `placementBlocks`/counting. |
| PL-04 code change keeps old tag proposals | **Yes** | Initial `tags` state is computed once from the first code. |
| PL-05 reversed hours accepted | **Yes** | `save()` checks dates only; the contract validates each clock alone. |
| PL-06 setup wizard used for everyday edits | **Yes, reduced** | Pass 81 restored Open/Edit; Pass 83 added a placement timeline and the transition page. Direct per-section editing is still missing. |
| HW-01 same-title/same-date homework collapsed | **Yes** | `dedupeKeyDates` runs over homework projections in `allKeyDates`. |
| HW-02 no homework edit/reschedule | **Yes** | `HomeworkPanel` has add/remove/complete only. |
| HW-03 due-session move leaves split dates | **Yes** | `dueISO` is a copy; nothing reconciles it when the referenced occurrence moves. |
| HW-04 session-only homework has no source link | **Yes** | App derives `setIn` from `lessonId` only. |
| HW-05 drafts, truncation, capped target list | **Yes** | Component-local draft; silent `slice` in `makeHomework`; 40-item cap. |
| UX-01 homework buried in session detail | **Yes** | Pass 82's place card sits above it too. |
| UX-02 return-destination button inside a `Field` label | **Yes** | The button's accessible name still inherits the label text. |
| NF-01 placement transition workspace | **Delivered** as Pass 83 (E04): transition record, four checklist groups, endpoint preview, per-placement return destination, stale-on-pin-change. Remaining: "not known yet" follow-up dates; a transition step for first-day hours and resources. |
| NF-02 homework as planned study work | **Partly** — Pass 84 (E02) added the weekly review with idempotent batches and Undo, but plan parents are still tasks only; homework is not a plan owner. |
| NF-03 session preparation checklist | Not started. |
| NF-04 homework change inbox | Not started; depends on HW-03's due-mode model. |
| NF-05 resources by stable uid | **Partly** — Pass 85 (E05) resolves every file reference by uid, lists missing files and relinks them. Remaining: attaching resources to homework and placements, and a school resource section. |

## 2. Cross-cutting decisions

1. **Order**: correctness before lifecycle before layout before new features — the review's order. Batch 1 (placements) and Batch 2 (homework) are independent of each other and can be released in either order; both precede Batch 3.
2. **One data editor, two presentations** (PL-06): the placement flow keeps its guided first-run steps; a saved placement gets a section page with per-section Edit. Persistent ids and SE codes never change.
3. **Homework due intent is explicit** (HW-03): `dueMode: 'session' | 'date'`, a last-confirmed snapshot, and a shared effective-due resolver that every consumer (session detail, Tasks, Schedule, reminders, Find) reads. No consumer copies a date again.
4. **Identity dedupe only** (HW-01): learner-owned homework and tasks are never collapsed by title/date; imported-deadline dedupe (Pass 74/82) stays as it is.
5. **Drafts reuse `draftIndex`** (PL-02, HW-05): no second persistence mechanism.
6. **Worker changes deploy first**; contract additions are additive with `ADMIN_SCHEMA_VERSION` bumped once per batch.
7. **Probes become tests**: each `evidence/audit-*.spec.ts` probe that asserts a defect is rewritten as a positive regression test under `tests/` in the batch that fixes it; the audit copies stay in the package.
8. **What's new** entry for every batch (all four change the learner's app).

## 3. Batches

### Batch 1 — placement correctness (Pass 86) — PL-01, PL-02, PL-03, PL-04, PL-05, UX-02

> **Status (16 September 2026): implemented as Pass 86** — see PLAN.md. Deviations: the location revision is `SchoolLocationRec.locatedFor` (the address the pin was located for) rather than a numeric revision; a pin is current only while the saved address still matches it, and older records without the field are trusted as before. The draft is the whole flow state under `draftIndex` kind `placement-setup`; the flow saves it on every change and offers Resume / Discard on reopening (no automatic apply). A taken block tag stays disabled with a note to release it from its owner (the reviewed transfer is deferred to Batch 3's section editor).

**In**
- **PL-01** school location as a revisioned object: `{ address, lat, lng, confirmedAt, revision }`. A meaningful address change in the draft clears the candidate pin and confirmation; Save with an unconfirmed pin yields "Location needs confirmation" and travel/journeys refuse to use the old coordinates. Geocode requests carry the draft identity and normalised address; late or mismatched responses are ignored; timeout/error/retry states; finite-coordinate validation. Cancel restores the saved school.
- **PL-02** a placement draft in `draftIndex` keyed by profile + placement id (or a new-draft id): current step, changed fields, source `at`, saved time. The return-destination detour becomes an inline sub-editor with "Back to setup"; when Settings is genuinely needed the draft is persisted first and resumed on return. Resume / Discard on reopening; Keep draft / Discard on a dirty Cancel; a failed save keeps the draft.
- **PL-03** a policy resolver in `shared/placement.js`: dated exception → placement override → profile default, used by counting, the Schedule school-day card, next-school-day lists, reminders and exports. Working-hour precedence documented and applied the same way: dated exception → explicit imported row → placement default → profile default.
- **PL-04** proposed tags vs explicit tags: changing the code before any manual mapping regenerates proposals; after manual edits offer Replace suggestions / Keep my links; a tag owned by another placement requires a reviewed transfer; the final review shows the affected dates and count.
- **PL-05** shared same-day interval validation (end strictly after start) at the form and in the contract, inline error beside the two fields, effective arrival time shown.
- **UX-02** the return-destination action moves out of the `Field` label into a `FieldGroup`; the test asserts the accessible name "Set return destination".

**Out**: the section-page editor (Batch 3); onboarding placement review (Batch 3).

**Gate**: corrected versions of the five placement probes pass as positive tests; SE1/SE3 byte-for-byte unchanged when SE2 is edited; a late geocode response for the old address cannot confirm the new one; an inset day is excluded for a placement whose override says so while another placement includes it; the Settings detour, reload and sheet closure keep the draft; reversed hours cannot save; both validation gates green.

**Size**: L (five defects across the flow, the resolver and the contract).

### Batch 2 — complete the homework lifecycle (Pass 87) — HW-01, HW-02, HW-03, HW-04, HW-05

**In**
- **HW-03** `HomeworkRec` gains `dueMode`, `dueSnapshot { dateISO, start, title, sessionRef, at }` and `dueHistory[]`; `shared/homework.js` gains `resolveDue(homework, sessions)` → `{ state: 'current' | 'changed' | 'cancelled' | 'missing' | 'ambiguous', effectiveISO, effectiveStart, ... }` using the existing identity utilities. Every consumer reads the resolver. A changed target shows "Maths 2 moved: Tue 22 → Wed 23" with **Follow this session** / **Keep the original date**; until reviewed the last confirmed deadline stands with an attention state everywhere. Fixed-date homework never moves.
- **HW-01** `allKeyDates` dedupes learner-owned homework and tasks by identity only; the projection keeps every record visible and independently completable; Find, notifications and calendar pins agree.
- **HW-02** a Homework detail/editor route (`#/homework/<id>`), reachable from the source list, the due list, Tasks, the Schedule and Find: title, details, source session, due session/date, status, resource links; Edit and Change due session/date on the same id; Remove with Undo through the existing tombstone semantics; separate "Due in this session" and "Set in this session" counts; the badge reads "Homework".
- **HW-04** source navigation from `setSessionRef` first, then the lesson when one exists; "Source no longer in timetable" fallback with the saved snapshot; Open due session.
- **HW-05** homework drafts in `draftIndex` keyed by profile + source; counters and inline validation instead of silent truncation; a searchable due chooser (Suggested later occurrences / All eligible sessions / Choose a date) with date, time, tutor/group and placement context; effective eligibility (membership, cancellation, `deadlineOnly`) applied to targets; a clearly labelled optional "Use this due session for the next item".
- Reminders read the effective due value; the ICS feed is unchanged (homework is not exported).

**Out**: homework as a plan parent (Batch 4); the change inbox (Batch 4).

**Gate**: two same-title/same-date homework records stay separately visible and completable; edits keep the record id and status; moved, retitled, cancelled, missing and ambiguous targets give one consistent date across session detail, Tasks, Schedule, Find and reminders; deletion Undo restores; a `deadlineOnly` row cannot receive session-linked homework; 200+ future sessions remain searchable; over-limit text is refused, not cut; existing `owner-homework-keydates` and `owner-followups` suites stay green.

**Size**: L.

### Batch 3 — visual and navigation improvements (Pass 88) — PL-06, UX-01, concepts A–F

**In**
- **Placements page** as the permanent destination: every placement with the same Open / Edit pair, timing and readiness shown separately (concept B, building on Pass 83's timeline).
- **Section editor** for a saved placement (concept C/D): School, People & dates, School day, Travel, Timetable, each with Edit and a review-and-apply step; the guided flow stays for first setup with Save draft and a final review.
- **Optional onboarding placement review** (concept A) after membership selection with Edit / Continue setup / "I'll finish this later".
- **Session detail navigator** (UX-01, concept E): Overview · Homework · Notes · Travel, a homework count beside the heading, compact homework cards with Add homework opening a focused editor; attendance and travel controls stay where they are.
- **Homework management screen** (concept F) on the Batch 2 route: instructions and source/due links first, Edit and Change due distinct from Done.
- Labels per the review's contract: "Edit school", "Edit mentor & dates", "Change due session", "Save draft".

**Out**: new features; any change to ids or SE codes.

**Gate**: 320/390/768/1440 widths, light/dark, 200% text, keyboard and focus return, long names and instructions; a ready and an incomplete placement at setup and afterwards; every existing action still reachable; the `v5-matrix` and `gap-closure` suites extended, not relaxed.

**Size**: L (five screens).

### Batch 4 — connected learner workflows (Pass 89 onward) — NF-02, NF-03, NF-04, NF-05 remainder

**In**, in this order, each shippable alone:
- **NF-02** homework as a plan owner: `PlanChildRec.parentRef: { kind: 'task' | 'homework', id }` with a backward-compatible migration from `parentId`; the workload planner and the Pass 84 weekly review count homework effort once; completing a study block records effort without completing the homework; a changed due session prompts a plan review rather than moving edited blocks.
- **NF-04** homework change inbox: a `homeworkChanges` collection (change id, homework and session ids, previous/current snapshot, decision, decided at) fed by the Batch 2 resolver; resolving is an explicit versioned command, idempotent across devices; completion history distinguishes done / reopened / rescheduled.
- **NF-03** session preparation checklist: a per-session preparation record of learner items plus derived links to incoming homework; one compact card on Today; "Ready for this session" is a learner statement only; notifications opt-in.
- **NF-05 remainder**: resource links on homework and a placement resource collection by wallet uid, shown with the Pass 85 On this device / Missing / In a backup states and relink; no pupil data.
- **NF-01 remainder**: "not known yet" with a follow-up date on transition items; first-day hours and resources in the checklist.

**Out**: any provider, LMS or school integration; resource sharing to mentors until the existing sharing controls cover it (recorded as deferred).

**Gate**: offline operation with honest unknown/error states; sync and backup round trips; idempotent proposals and Undo; no double-counting; curriculum, logged experience and QTS outcomes kept separate.

**Size**: M each.

### Completion — archive (with the last accepted batch)

Per the review's §9: move `placement-homework-audit-2026-09-15/` to `archive/enhancements/2026-09-15-placement-homework/` with a README listing delivered and deferred IDs, commits and validation; update `archive/README.md` and PLAN.md; keep a backlog pointer for anything deferred.

## 4. Questions for the owner (defaults apply if unanswered)

1. Display labels: the review's concepts use P1/P2/P3 — *default: keep SE1/SE2/SE3 on screen (the standing decision), with "source SE1" shown where a block tag differs*.
2. Batch 1 vs Batch 2 first: *default: Batch 1 (placement correctness) — it removes a wrong-location risk in journeys*.
3. Onboarding placement review (Batch 3): optional step or skipped entirely for a profile with no placement blocks — *default: shown only when the timetable has placement blocks*.
4. NF-03 notifications: *default: none until asked for; the Today card is enough for a first release*.
