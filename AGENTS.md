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
2. Change spans app **and** worker (e.g. a new endpoint)? → deploy the worker **first**, then push the app.
3. `build` must pass before deploying; a red smoke test blocks — never skip it.
4. After any deploy, run `verify` and report its output verbatim.
5. If `git push` times out on port 22, retry with:
   `GIT_SSH_COMMAND="ssh -o HostName=ssh.github.com -o Port=443" git push origin main`

### Auth (humans only, one-time)

- Cloudflare: `npx wrangler login` (browser OAuth). Agents: check with `npx wrangler whoami`; if unauthenticated, stop and ask.
- GitHub: `gh auth login` (only needed for the `app` target; pushes use the git remote's SSH key).
- Vercel: auto-deploys from Git; `npx vercel login` + `npx vercel link` only for CLI deploys.

## Hard rules (do NOT violate)

- **Never delete or overwrite the KV key `vapid`** — it invalidates every push subscription irreversibly.
- **Never delete KV records you did not create in the current task.** Real-user data lives beside operational keys (`sub:`, `sync:`, `aping:`, `adev:`, `snap:` — full prefix map in DEPLOYMENT.md §6). A deleted user ping/subscription cannot be restored.
- **Never test against production analytics or push subscriptions.** If a test must ping, use a device id starting `ffffffff` and delete exactly that id afterwards.
- Never commit secrets; the only secret (`statskey`) lives in KV. Rotate with
  `npx wrangler kv key put --namespace-id <id-from-wrangler.toml> --remote statskey <new>` — only when asked.
- Don't change `registerType`, the KV namespace ids, or `src/lib/config.ts` base URLs unless the task is explicitly about them.

## Conventions

- Log every substantive change in `PLAN.md` (same commit) — it is the running record.
- CI must stay green; `npm run test:e2e` locally reproduces the gate.
- Rollback: app = `git revert` + push; workers = a compatible rollback or forward fix. Never restore the legacy broadcasting `/test` handler; retain its 410 response (see DEPLOYMENT.md).
- KV budget: stay frugal with KV **writes** (~1,000/day account cap); prefer read-only checks.

## Quick health check (read-only, always safe)

```bash
./scripts/deploy.sh verify
```

Expected: all PASS — Vercel 200, Pages 200, `/vapid` returns a key, `/stats`
401 without a key, feed serves `cache-control: public, max-age=900`, dashboard 200.

## Remaining phases and UI design references

For Phases 3–7, read [TIMETABLE_PWA_REMAINING_PHASES_IMPLEMENTATION.md](TIMETABLE_PWA_REMAINING_PHASES_IMPLEMENTATION.md). The accompanying [handoff-assets](handoff-assets/) directory contains the before/after screenshots and HTML concepts. These references now live in this repository; follow the handoff’s phase boundaries, styling specifications and acceptance tests when implementing the relevant phase.
