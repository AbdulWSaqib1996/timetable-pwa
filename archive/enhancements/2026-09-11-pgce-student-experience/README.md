# PGCE / QTS student-experience audit — archived package (10–11 September 2026)

This folder is the completed handoff for the PGCE / QTS student-experience audit of My Timetable. It was moved here from the repo root by G3 (PLAN.md Pass 72) once every batch had shipped and been verified, as the plan's §4.7 requires. Relative links inside the package are unchanged: [PGCE_QTS_STUDENT_EXPERIENCE_AUDIT.md](PGCE_QTS_STUDENT_EXPERIENCE_AUDIT.md) (the audit), [DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md) (the batch plan with status notes per batch), `designs/` (the audit's mockups — their P1/P2/P3 labels are the owner's SE1/SE2/SE3), `evidence/` (the audit's captures).

## Completed batches

| Batch | Pass | Delivered |
|---|---|---|
| G0 | 68 | Placement entity + school location, reviewable tag → placement migration (SE1a → SE1 proposed, confirmed by the learner), typed references, feedback provenance, admin schema versioning with unknown-field preservation |
| G1a | 69 | SE1/SE2/SE3 chooser, school setup with a confirmed map pin, placement workspace, To school / Back home journeys, PG-01 programme roadmap (packs with diff preview, learner-confirmed requirements, milestones) |
| G1b | 70 | Lesson workbench (Plan → Rehearse → Teach → Review; plan revisions; next attempt without outcomes), practice cycles (one active focus), mentor preparation (agreed actions owned by the meeting), Today next steps; iOS bottom-nav fix |
| G2 | 71 | Subject-knowledge goals (self-rated confidence; audit "secure" → "previously marked secure by you"), academic workspace (deadlines referencing key dates; status only on confirmation; results labelled by source), workload proposals over the plan model with protected time, accept/undo, support notes |
| G3 | 72 | Evidence examples over referenced records (ITTECF and Teachers' Standards separate; Part Two contexts), review packs with pinned snapshots (export equals preview), experience ledger by layer (no double counting, comparisons only against confirmed requirements), review records and a first-post handover pack without private data; What's new restored |
| G4 | — | Mentor portal / provider adapters: **not built** — needs a separate explicit go-ahead |

## Binding rules kept throughout

One record, many typed references; no automatic outcomes (attendance, standards met, submitted, QTS); no telemetry events added, no AI, no cloud providers; placements are SE1/SE2/SE3; self-study rows are never placement blocks; anything reviewer-authenticated is unsettable without a portal.

## Verification

- Every batch ran `npm run validate` AND `VERCEL=1 npm run validate`, CI on merge, workers deployed first whenever `shared/` changed, and `./scripts/deploy.sh verify` on the live services. Records: PLAN.md Passes 68–72.
- Permanent suites: `tests/unit/pgce-g0…g3.test.mjs`, `tests/pgce-g0…g3.spec.ts`.
