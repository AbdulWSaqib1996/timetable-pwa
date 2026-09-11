# PGCE / QTS student-experience audit — development plan (batches G0–G4 → PLAN.md Passes 68–72+)

**Source:** [PGCE_QTS_STUDENT_EXPERIENCE_AUDIT.md](PGCE_QTS_STUDENT_EXPERIENCE_AUDIT.md) (10 September 2026, PG-07A clarification 11 September; **owner clarification 11 September: the three placements are recorded as SE1, SE2 and SE3** — the mockups' P1/P2/P3 are illustrative labels) with its `designs/` (23 mobile + 4 desktop mockups, `design.css`, `gallery.html`) and `evidence/`. **Written 11 September 2026 after the visual audit closed (Pass 67).** This is a plan, not a start: nothing here is implemented until the owner says "Run G0" (etc.).

**Owner rules carried forward:** no functionality is lost (maps, TfL, journey home, every existing editor, Find, sync, backup — the visual plan's preservation register still applies and is re-checked per batch); never `git add -A` (foreign folders at the root); shared-contract or worker changes deploy the workers first; both validate gates on every batch; re-seed nothing without an explicit go-ahead; the visual language is `archive/enhancements/2026-09-10-visual-ui/designs/design.css` — this audit's mockups reuse it.

---

## 0. What the audit asks for, in one paragraph

Turn the existing PGCE records (reflections, targets, meetings, observations, lessons, audits, placement days, journal, binder, tasks, work blocks) into one **connected teaching-development cycle** — understand the course → prepare a lesson → rehearse a focus → teach → discuss feedback → try again → select a few examples for review — with a **course-aware roadmap** whose requirements are sourced and versioned, **three separate placements (SE1/SE2/SE3 in the owner's records; the mockups say P1/P2/P3) at different schools** with their own setup, records and outward/return journeys, and **mentor preparation / review packs** built from records the student already has. Everything must keep provenance honest (learner-entered ≠ authenticated reviewer; logged ≠ fulfilled; tags ≠ standards met; export ≠ submission; the app never awards QTS) and must work offline with sync, backup and restore intact.

## 1. Baseline reconciliation (what changed since the audit was written)

The audit inspected commit `d58a91f` while the visual audit was mid-flight. Since then (Passes 56–67):

- PGCE file is four tiled cards (Placement, Evidence & reflections, Development, Documents & reports) with one primary each and destination-named links; Term stats hosts the attendance analysis and CSV. The audit's "My programme / Lessons & practice / Mentor preparation / Subject knowledge / Placement experience / Evidence & reviews" grouping must be **added as entry points behind these cards** (or as new cards where the register allows), not by removing the existing ones.
- Cloud backups were **removed** on the owner's instruction (Pass 58); the audit's references to "cloud stripping" and "cloud-backup round-trip" reduce to the encrypted file backup + device sync. Do not reintroduce a cloud provider.
- Sync now unifies the same timetable across devices into one profile (Pass 64); new collections must respect `unifyProfiles`/`dedupeProfiles` and profile tombstones.
- Self-study rows are never placements (Pass 66): `isSelfStudyTitle` is excluded from `isPlacementTitle` in `shared/eligibility.js` and the push worker. The PG-07A tag-migration must reuse these helpers, never re-implement the regex.
- The session detail is a hero + tiled cards with a Travel & map tab; the "Travel to this session" CTA and the return-trip card already exist (Pass 63). PG-07A's "To school / Back home" per placement reuses `useJourney`, `OriginSelector`, `RouteMap`/`StaticMap` and `JourneyHomePage` patterns rather than new travel code.
- `Settings.placements` (per imported tag: school, address, mentor, notes, lat/lng) and profile-level working hours / inset policy exist (`PlacementPage`, `src/lib/placement.ts`). PG-07A migrates these with a reviewable mapping.

Design rule from the audit that binds every batch: **one record, many linked uses** — typed references `{ profileId, entityType, entityId, revision? }`, titles/dates are display metadata, never keys; every new persisted record has a stable id, owner, timestamps/revision, schema version, defaults for optional fields and deletion semantics that merge (`shared/merge.js` tombstones) and restore.

## 2. Functional preservation register (gate for every batch)

Everything in the visual plan's register (archived at `archive/enhancements/2026-09-10-visual-ui/DEVELOPMENT_PLAN.md` §1) plus:

| Area | Must survive (exact current behaviour) | Regression net |
|---|---|---|
| PGCE file | Four cards; `Evidence journal`, `Weekly reflections (N)`, `Add or open a record` menu (Targets/Mentor meetings/Observations/Lessons/Audits), `All development records →`, `Open wallet`, `Print binder & exports`, `Term stats & attendance`; counts from real records; privacy line | `audit-r3` TT-20, `v4-pgce-admin`, `phase-five` |
| AdminSheet tabs | Overview/Reflections/Targets/Meetings/Observations/Lessons/Audits/Wallet with their quick forms, edit/delete, binder export | `phase-five`, `audit-r5a` |
| Placement page | Working hours & policy, blocks with planned vs logged days, day rows with exceptions, per-block school/address/mentor via any session, CSV day log | `phase-five` (P5-03), `audit-r5a` |
| Journal & binder | Review queue, standards chips, binder selection/preview/print, photo captions | `audit-r5a`, `phase-five` |
| Tasks | Mentor action appears once (owner = meeting), status select updates one owner, work plans | `audit-r1`, `phase-five`, `v2-daily-use` |
| Travel | Session Travel & map, Journey home, origins, RouteMap/StaticMap states, TfL steps/disruptions, Copy address, Google Maps | `audit-r2`, `phase-six`, `phase-seven`, `v3-travel-settings` |
| Sync/backup | Two-device convergence incl. profile unification; encrypted file backup/restore with impact preview; worker attendance snapshot | `sync-devices`, `phase-two`, `v0-carry-forwards`, `backup-only` |

New rule for this audit: **no automatic outcome** — no stage change, action completion, tag, export or count may set attendance, "standard met", submitted, provider-confirmed or any qualification state (audit EDU-02…05, §17.2).

## 3. Batches

Numbers follow PLAN.md: the next free pass is **68**. Each batch = one branch (`pgce-g0` … `pgce-g4`), a PLAN.md §9.4 record, both gates, CI, `deploy.sh verify`, worker-first deploy when `shared/`/worker code changes, and a demo-fixture extension (`src/lib/demo.ts` / test seeds) so every new entity is visible with sample data.

### G0 — Reconcile, model the placements, provenance foundations (Pass 68)

> **Status (11 September 2026): implemented as Pass 68** — see PLAN.md. Delivered as specified with two recorded refinements: the placement entity lives in `AdminFile.placements` (+ `schools`) in `src/lib/admin.ts` rather than `src/lib/placement.ts`, which keeps its P5-03 day-span semantics; and pre-G0 observations are read as `learner-entered` without rewriting the record (no `at` bump, so old-device sync is unaffected).

**In**
- **Placement entity** (`src/lib/placement.ts` + `shared/contracts.js` validation + `shared/merge.js` collection + backup/restore + sync): `id`, `profileId`, `code` (**SE1/SE2/SE3** for the owner's programme — the code is the block prefix the timetable already uses; extensible to other naming), `schoolLocationId` → a `SchoolLocation` record (name, address, confirmed lat/lng + `confirmedAt`, entrance note user-entered), date range, `mappedBlockTags[]`, mentor/contact refs, working-pattern overrides (fall back to profile defaults), arrival preference, optional saved return-place ref, `revision`, `at`, tombstone. Programme template initialises **SE1, SE2, SE3** for the owner's course (display label "Placement SE1" etc.); other routes can add/rename.
- **Reviewable tag → placement migration**: a one-time review sheet listing imported placement block tags (`placementTagOf`, e.g. `SE1A`, `SE1B`, `SE2`) and existing `Settings.placements[tag]` details with a **proposed** mapping — a tag whose block prefix equals a placement code (SE1a → SE1) is proposed, never applied silently — that the student confirms; unmapped/ambiguous blocks stay **Unassigned** with their fields intact; idempotent. Self-study rows (`isSelfStudyTitle`) are never placement blocks (Pass 66).
- **Typed references** helper (`src/lib/refs.ts`): `{ profileId, entityType, entityId, revision? }` with validation; `placementId?: string` added (optional, additive) to Lesson, Observation, Meeting, MeetingAction, ExperienceLog (new, G3), practice attempts (G1). Old records get `placementId: undefined` = Unassigned.
- **Provenance field** on Observation/feedback: `sourceType: 'personal-reflection' | 'learner-entered' | 'reviewer-authenticated'`; existing observations migrate to `learner-entered`; `reviewer-authenticated` cannot be set by the client in G0–G3 (no portal).
- Schema versioning: `AdminFile.schemaVersion`, unknown newer fields preserved on read/merge/backup; malformed references rejected by `validatePayload`.
- Backward-compatibility tests: old AdminFile payloads load, merge, export/restore; two-device sync with one device on the old schema (unknown fields survive); profile isolation on every new read/write.

**Out**: any UI beyond the migration review sheet and a P1/P2/P3 chooser stub; journeys; lessons workbench.

**Demo criteria / gate**: existing PGCE tests unchanged and green; migration preview/confirm/cancel test; idempotent re-run; sync/backup round-trips a profile with three placements; worker unaffected unless `shared/contracts.js` changes (then deploy first).

### G1 — Placements (PG-07A), roadmap (PG-01), lesson workbench (PG-02), practice & mentor prep (PG-03) as one vertical slice (Passes 69–70; split 69 = PG-07A + PG-01, 70 = PG-02 + PG-03)

**Pass 69 — PG-07A + PG-01**

> **Status (11 September 2026): implemented as Pass 69** — see PLAN.md. Delivered as specified with these recorded refinements: the chooser cards are SE1/SE2/SE3 (owner's codes); the pin-confirm step uses the existing StaticMap + geocoder with an explicit `Confirm this pin` button (no draggable pin — the static map is by design); reminders resolve the school from `settings.placements[tag]`, which the setup flow now mirrors from a confirmed pin, so the worker's logic is unchanged; the outward journey targets the next mapped school day (leave-now once it has started); the demo world still has no placement blocks.
- **Placement chooser** on the PGCE Placement card (mobile: three cards — SE1, SE2, SE3 — with code, school, date range, setup state Not set up / School details incomplete / Ready to plan, Current/Upcoming/Finished by dates, mentor, hours; `Open placement`, `To school`, `Back home`; indigo/teal/violet accents as identity only). "All placements" is a grouped reporting view.
- **School setup flow**: choose code → school + confirm map pin (StaticMap with a "confirm this pin" step; address text alone is never "verified") → people/dates → working pattern & travel preferences (overrides with visible defaults) → preview source-block mapping → save. Saving SE2 must not modify SE1/SE3 (byte-for-byte test).
- **Placement workspace** (`#/placement/:id`): its lessons, observations, meetings/actions, experience/attendance, resources, evidence — deep links back to the owning school from each record; session rows show `SE2 · <school>` from the session's mapping.
- **To school / Back home**: `#/placement/:id/journey/out|back` reusing `useJourney` with request identity = profile + placementId + schoolLocation revision + direction + origin/destination + mode + requested time (late SE1 responses ignored after switching to SE2); From → To, arrival time/buffer/mode shown before results; return journey planned separately from school finish time (no reversed polyline); origin can be Current location; no home → "Set return destination". Every existing map/TfL/steps/Copy address/Maps control kept. Reminders resolve placement from the session mapping, not the viewed placement (worker compatibility review; deploy first if the worker changes).
- **PG-01 roadmap**: `CourseProfile` (route, jurisdiction, academic year, provider label, phase/subject/age, dates, full/part-time) + `ProgrammePack`/`Requirement` (owner/source, URL/file ref, section, applicability, effective dates, version, planned value, verification state default **Unconfirmed**; "Confirmed by you from [source]") + `ProgrammeMilestone` (kind academic|training|review, date, source ref, state, pack version). Manual/JSON pack import with validation; **no** handbook extraction, **no** hard-coded 120-day target, no completion ring; two pathways + one next review + unconfirmed count; pack update previews a diff; historical reviews pin their pack version. Settings → My timetable gains "Programme" entry.

**Pass 70 — PG-02 + PG-03**
- **Lesson extension** (additive fields on Lesson): linked timetable occurrence (typed ref to the session key), sequence/unit ref, intention, prior knowledge, misconceptions, sequence, checks, planned responses, resource refs; optional templates; **Plan → Rehearse → Teach → Review** stage views (tabs with proper `tablist` semantics) over one record; planning vs evaluation versions kept distinct; Teach mode = essential plan + resources, offline, large controls; duplicate → new identity without copied outcomes; the existing quick retrospective lesson form stays.
- **PracticeCycle / Attempt**: focus (one active by default), linked curriculum ref, rehearsal note, lesson attempts, feedback refs, review decision, pause/archive without failure labels.
- **Mentor preparation**: agenda from what changed / where help is needed / selected examples / proposed next steps + open actions as references; after the meeting: what happened, optional duration, agreed actions (still owned by the meeting), next review date. Feedback provenance shown beside text; learner-entered can never acquire reviewer authorship; changing a reviewed record creates a revision.
- Today: up to three "next steps" derived only from dated work + the active focus (dismiss/pin; unknown dates never overdue). Schedule: rehearsal/study blocks via the canonical plan model (no new block type).

**Out (G1)**: mentor portal, AI, provider adapters, subject-knowledge goals, academic workspace, workload engine, experience ledger totals, review packs.

**Demo criteria / gate**: the audit's §17.1 end-to-end fixture up to "next attempt": P1/P2/P3 at three synthetic schools; edit P2 leaves P1/P3 unchanged; a P2 lesson opened from Schedule/Find/journal/mentor action shows P2's school and returns correctly; late P1 journey response never renders under P3; outbound/return routes differ; all no-home/no-coords/denied/stale/map-failure/offline states honest; next week's P2 preview does not alter today's P1 reminder; the full cycle (plan → rehearse → learner-entered feedback → next attempt) works offline after load; no stage change sets attendance or assessment.

### G2 — Subject knowledge (PG-04), academic workspace (PG-05), workload (PG-08) (Pass 71)

**In**
- `KnowledgeGoal`: topic (from the programme pack's curriculum list; primary breadth or secondary depth), student's question, dated self-confidence events, resource refs (one resource ↔ many goals), application opportunity (lesson ref), next review. Existing subject audit `secure` migrates to "Previously marked secure by you (date)"; **never** assessed mastery. No question cards / AI in this batch.
- `AcademicProject` (the PGCE form of MF-02): brief, provider criteria, deadline (linked to an existing key date, not a copy), optional word/credits (no award calculation), milestones as tasks (existing owner model), reading notes with quotation/paraphrase/interpretation + source/page (no invented bibliographic data), approval-planning section for classroom enquiry (recorded, not an approval workflow), status draft → ready → submitted (user confirmation only) → feedback → result (labelled by source; never awards anything). Export never marks Submitted.
- Workload (MF-01 specialised): deterministic needed-vs-available time over the existing plan model honouring locked sessions, travel buffers, protected time and fixed deadlines; reports the gap ("2 h unallocated"), proposes reviewed blocks as a diff with accept/undo; never fills protected time or drops requirements; missing estimates = unknown. Support: user-entered contacts, private discussion agenda, unanswered course questions — no wellbeing score, no notifications to staff, no streaks.

**Out**: question cards/self-checks, AI suggestions, provider connectors.

**Gate**: no duplicate scheduling; deadline change recomputes proposals without auto-accept; undo restores; export/restore round-trip of all three collections; profile isolation; existing tasks/work-plan tests green.

### G3 — Evidence narratives (PG-06), experience ledger (PG-07), reviews & transition (PG-09) (Pass 72)

**In**
- `EvidenceExample`: refs to existing records + narrative (context, decision, noticed, changed next); contexts course-curriculum / practice-cycle / provider-assessment; **ITTECF references and Teachers' Standards references are separate enums**, no combined score; Part Two = conduct context references only.
- `ReviewPack`: pinned revisions (immutable snapshot mechanism chosen and documented — proposed: store the referenced records' canonical JSON inside the pack at selection time, plus attachment ids with local-only/missing states), "Selected / Draft / Discussed", exact preview of what leaves the device incl. provenance and captions; extends the existing binder export path.
- `ExperienceLog` per placement: activity type (mentor meeting, observation, teaching, provider-designated ITAP, other), date/duration, planned source ref, **planned / learner-logged / discussed-reviewed / provider-outcome-reference** kept separate; no inferred mentoring duration, no double-counted same-day activities, inset policy from the programme; comparisons only against confirmed PG-01 rules, otherwise totals without a deficit; provider-conversation export with a source per value. Existing whole-day ticks vs minute corrections stay distinguishable (`placementSpans`/`placement.ts` untouched semantics).
- PG-09 review workspace: selected narrative/evidence + focus + experience summary + questions; review record (date, participants, learner notes, source of any provider judgement, next steps); optional first-post handover pack excluding private notes and identifiers; nothing implies an induction body received it.

**Gate**: one source record in many examples without duplicate blobs; deleting an example never deletes a lesson; old pack versions readable after source edits; missing attachments shown; academic outcome cannot set QTS; export == preview; holiday/inset/part-day consistency with existing placement code.

### G4 — Optional authenticated mentor portal and provider adapters (Pass 73+, only on a separate explicit go-ahead)

Requires a new authenticated backend with invitations, revocation, scoped packs and secure attachment sharing, separate from analytics and sync codes; `reviewer-authenticated` provenance becomes settable only through it. **Not planned in detail here**; the audit itself marks it a later extension. Nothing in G0–G3 may simulate it (no "verified" badge from a typed name).

## 4. Cross-cutting decisions (change them here, not ad hoc)

1. **Programme template default** = example primary, ages 5–11, England PGCE-with-QTS, with SE1/SE2/SE3 initialised (owner's codes; the audit's P1/P2/P3 are mockup labels). Secondary/QTS-only/part-time selectable; unknown rules show "Requirements not yet confirmed", never a shortfall.
2. **Identity**: the remote-wins profile unification (Pass 64) extends to placements only by `id`; two placements are never merged by similar school names or dates.
3. **Storage**: new collections live in `AdminFile` (per profile) with tombstones in `shared/merge.js`; large documents stay in the existing attachment store; pack snapshots are bounded (text + attachment ids), never file blobs in synced metadata.
4. **Worker**: reminders/briefings gain placement-aware destination (school of the session's mapped placement) in G1; any worker change deploys first with its unit harness extended (`tests/unit/push-worker.test.mjs`).
5. **No new telemetry events, no AI, no external services** in G0–G3.
6. **Visual language**: reuse `design.css` tokens and the existing tiles/hero/cards; placement accents indigo/teal/violet are identity, amber = unresolved input, never "failing".
7. **Archive**: on completion of G3 (or when the owner stops), move `pgce-student-audit-2026-09-10/` to `archive/enhancements/<date>-pgce-student-experience/` with a README, as the audit's §18 requires.

## 5. Questions for the owner before G0 starts (answers can be written inline here)

1. Programme facts for the template: placement dates for SE1/SE2/SE3 (or "enter later"), required school-day rule if any (the audit forbids a hard-coded 120), the academic year label. — *Answered 11 Sep: the codes are SE1, SE2, SE3. Default for the rest if unanswered: dates blank, rule unconfirmed.*
2. Should the migration of existing `Settings.placements[tag]` details propose mappings automatically (student confirms) or start fully blank? — *default: propose by block prefix (SE1a/SE1b → SE1), confirm required.*
3. G1 split: run Pass 69 (placements + roadmap) before Pass 70 (lesson workbench + practice), or the reverse? — *default: 69 then 70, because lessons need a placement to link to.*
4. Confirm G4 stays out of scope until separately requested. — *default: out.*

## 6. Effort and sequencing summary

| Batch | Pass | Size | Risk | Depends on |
|---|---|---|---|---|
| G0 | 68 | M | contract/merge/backup changes; worker deploy likely | — |
| G1a | 69 | L | placement model + journeys + roadmap; worker reminder resolution | G0 |
| G1b | 70 | L | lesson versions, practice cycle, mentor prep | G1a |
| G2 | 71 | L | three new collections + workload engine | G0, G1b |
| G3 | 72 | L | pinned snapshots, ledger provenance, exports | G1–G2 |
| G4 | 73+ | XL | new backend; explicit go-ahead only | G3 |

Order is strict G0 → G1a → G1b → G2 → G3. Each pass ends with the demo fixture extended, both gates green, CI success, `deploy.sh verify` six PASS and a PLAN.md record.
