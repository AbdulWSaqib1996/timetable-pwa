# Current timetable app audit

Read [TIMETABLE_APP_AUDIT_AND_ENHANCEMENTS.md](TIMETABLE_APP_AUDIT_AND_ENHANCEMENTS.md).

This is the follow-up audit of the implemented learner app at commit `f342695`, after the original Phases 1–7. It includes 21 prioritized findings, nine feature proposals, exact UI guidelines, shared data/interaction contracts, acceptance tests and six ordered development phases. It is separate from the admin analytics handoff.

The `evidence` directory contains current synthetic screenshots, observed defect records, source hashes and test output. All tests ran against an isolated local snapshot with external services blocked. No application changes or deployment were performed.

For a quick starting point, inspect `evidence/screens/schedule-desktop.png` alongside `evidence/desktop-sizing.json`, then the Today timezone screenshots and `evidence/new-commitment-draft.json`. The written spec distinguishes reproduced defects from conditional risks and proposals.

The inert observation test `evidence/current-audit.spec.ts.txt` documents the synthetic scenarios. Do not copy it into the app bundle. To adapt it into a development test, put it under the repository's tests folder, use the configured baseURL rather than its audit port, choose a temporary evidence directory, and change assertions from recording known defects to verifying the desired behaviour. Never point it at production.
