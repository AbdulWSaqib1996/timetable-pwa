# Agent runbook — My Timetable

Instructions for AI agents (ChatGPT/Codex, Claude, or any tool with a shell)
deploying or operating this repo. Everything here is non-interactive; anything
that needs a human is explicitly marked. Full background: [DEPLOYMENT.md](DEPLOYMENT.md).

## System map

- Web app (Vite/React PWA, `src/`) → GitHub Pages `https://abdulwsaqib1996.github.io/timetable-pwa/` and Vercel `https://pgce-timetable.vercel.app/`. Both auto-deploy on push to `main`; both run the shared build/unit gate, and GitHub Actions adds the full Playwright gate (Vercel's build image cannot launch Chromium).
- `workers/push/worker.js` → Cloudflare Worker `timetable-push` (push, cron, sync, analytics). **Manual deploy only.**
- `workers/ics-feed/worker.js` → Cloudflare Worker `timetable-ics` (calendar feed). **Manual deploy only.**
- One Cloudflare KV namespace (id in both `wrangler.toml`s) holds all worker state.

## Deploying

Preferred: use the driver script — it prints PASS/FAIL and never prompts.

```bash
./scripts/deploy.sh preflight   # exit 2 = missing auth/tooling; report, don't work around
./scripts/deploy.sh build       # npm build + Playwright smoke (must pass before any deploy)
./scripts/deploy.sh workers     # wrangler deploy both workers (idempotent)
git push origin main            # deploys the app to BOTH hosts (normal path)
./scripts/deploy.sh verify      # curl checks with expected results; exit 1 on any failure
```

`./scripts/deploy.sh app` re-triggers Pages + Vercel for current `main` without
a new commit. `all` runs everything in order.

### Decision rules

1. Changed anything under `workers/`? → `deploy.sh workers` (git push does NOT deploy workers).
   The push worker hosts four Durable Objects (`SyncStore`, `GroupStore`, `AnalyticsStore`, `MentorStore` — the G4 mentor portal, routes `/mentor/*`, signing key `mentor-signing-key` in KV, encrypted attachments under `matt:*`); never delete those KV records. `mentor.html` is a second Vite page like `analytics.html` and `verify` checks it.
2. Change spans app **and** worker (e.g. a new endpoint)? → deploy the worker **first**, then push the app.
3. `build` must pass before deploying; a red smoke test blocks — never skip it.
4. After any deploy, run `verify` and report its output verbatim.
5. **Every release that changes the app updates What's new** (documentation-only passes need no entry): add an entry to `src/lib/changelog.ts` (`WHATSNEW_ENTRIES`, newest first — the version bump follows from it) describing what the learner will notice, in their words; the toast shows it once and Settings → Help keeps the history (owner instruction, 11 Sep 2026).
6. If `git push` times out on port 22, retry with:
   `GIT_SSH_COMMAND="ssh -o HostName=ssh.github.com -o Port=443" git push origin main`

### Auth (humans only, one-time)

- Cloudflare: `npx wrangler login` (browser OAuth). Agents: check with `npx wrangler whoami`; if unauthenticated, stop and ask.
- GitHub: `gh auth login` (only needed for the `app` target; pushes use the git remote's SSH key).
- Vercel: auto-deploys from Git; `npx vercel login` + `npx vercel link` only for CLI deploys.

## Hard rules (do NOT violate)

- **Never delete or overwrite the KV key `vapid`** — it invalidates every push subscription irreversibly.
- **Never delete KV records you did not create in the current task.** Real-user data lives beside operational keys (`sub:`, `sync:`, `aping:`, `adev:`, `snap:` — full prefix map in DEPLOYMENT.md §6). A deleted user ping/subscription cannot be restored.
- **Never test against production analytics or push subscriptions.** If a test must ping, use a device id starting `ffffffff` and delete exactly that id afterwards.
- **Never set `analytics:retention-policy` in KV unless the owner explicitly asks** — it activates a dormant job that deletes `adev:` first-seen rows (scoped, grace-period-gated, ≤200/run) and changes what “tokens ever recorded” means.
- The admin dashboard's freshness comes from `checkedAt` on `/stats/v2` (the snapshot job's heartbeat, `meta:checkedAt` in the `AnalyticsStore`), not `generatedAt`, which only moves when the numbers change. A "stale" dashboard means the job itself stopped succeeding.
- The `AnalyticsStore` Durable Object (`day:`/`dp:`/`seen:`/`rel:`/`meta:` rows) is analytics-owned; never reach into SyncStore/GroupStore storage from it or vice versa. `/stats` and `/stats/v2` are `Authorization: Bearer` only — do not reintroduce a query-string credential.
- Never commit secrets; the only secret (`statskey`) lives in KV. Rotate with
  `npx wrangler kv key put --namespace-id <id-from-wrangler.toml> --remote statskey <new>` — only when asked.
- Don't change `registerType`, the KV namespace ids, or `src/lib/config.ts` base URLs unless the task is explicitly about them.

## Conventions

- Log every substantive change in `PLAN.md` (same commit) — it is the running record.
- CI must stay green; `npm run test:e2e` locally reproduces the gate.
- Rollback: app = `git revert` + push; workers = a compatible rollback or forward fix. Never restore the legacy broadcasting `/test` handler; retain its 410 response (see DEPLOYMENT.md).
- KV budget: Cloudflare is on Workers Paid (no daily cap; 1M KV writes/month included, metered beyond). Stay frugal with KV **writes and deletes** (a delete is billed as a write): never write or delete unconditionally in the cron — read first and write only on a real change. Prefer read-only checks.

## Quick health check (read-only, always safe)

```bash
./scripts/deploy.sh verify
```

Expected: all PASS — Vercel 200, Pages 200, `/vapid` returns a key, `/stats`
401 without a key, feed serves `cache-control: public, max-age=900`, dashboard 200.

## Remaining phases and UI design references

Completed handoffs and audits are archived under [archive/](archive/README.md) (the Phases 3–7 handoff with its `handoff-assets/` is at `archive/enhancements/2026-09-06-remaining-phases/`); the active package, if any, stays at the repo root until its last batch ships. Follow a handoff’s phase boundaries, styling specifications and acceptance tests when implementing it.
