# Deployment guide

Everything needed to deploy My Timetable — the automatic paths, the manual
equivalents, first-time setup from a clean account, verification, and rollback.
All hosting is on free tiers; there are no paid services anywhere.

> **Automating this?** [`AGENTS.md`](AGENTS.md) is the runbook for AI agents
> (ChatGPT/Codex, Claude, CI bots): the same steps as this document, expressed
> as non-interactive commands with hard rules. [`scripts/deploy.sh`](scripts/deploy.sh)
> is the prompt-free driver behind it — `preflight | build | workers | app |
> verify | all`, PASS/FAIL output, meaningful exit codes.

## 1. What gets deployed where

| Piece | What it is | Where it runs | How it deploys |
|---|---|---|---|
| **Web app** (this repo's `src/`) | Vite + React PWA | GitHub Pages: `https://abdulwsaqib1996.github.io/timetable-pwa/` | Auto on push to `main` (GitHub Actions, gated by the Playwright smoke test) |
| **Web app** (same build) | — | Vercel: `https://pgce-timetable.vercel.app/` | Auto on push to `main` (Vercel Git integration) |
| **Analytics dashboard** | `public/analytics.html` (own PWA manifest) | Ships inside both app deploys (`/analytics.html`) | Same as the app |
| **timetable-push** worker | Web Push + cron (reminders, briefings, digests), sync store, analytics, study groups, `/history` | Cloudflare Workers: `https://timetable-push.ics-feed.workers.dev` | **Manual only**: `npx wrangler deploy` |
| **timetable-ics** worker | Subscribable calendar feed (placement expansion, history) | Cloudflare Workers: `https://timetable-ics.ics-feed.workers.dev` | **Manual only**: `npx wrangler deploy` |
| **KV namespace** | All worker state (one namespace, shared) | Cloudflare KV id `f4bb2f63ca3a4a76975036c421791731` | Created once; never redeployed |

> ⚠️ The workers do **not** deploy on git push. Any change under `workers/`
> must be followed by a manual `wrangler deploy` (section 4.3).

## 2. Prerequisites

- Node 20+ and npm.
- Accounts: GitHub (repo + Pages), Vercel (Hobby), Cloudflare (Workers free plan).
- CLIs (all run via `npx`, no global installs needed):
  - `wrangler` — authenticate once with `npx wrangler login` (browser OAuth; no
    secrets pass through the terminal).
  - `vercel` — only needed for manual Vercel deploys; `npx vercel login`.
  - `gh` (optional) — for triggering/watching GitHub Actions from the terminal.

## 3. Build and test locally

```bash
npm ci
npm run build        # tsc + vite build → dist/ (also builds the SW + manifest)
npm run test:e2e     # Playwright smoke over dist/ (first run: npx playwright install chromium)
npm run dev          # dev server (no service worker in dev)
npm run preview      # serves dist/ at http://localhost:4173/timetable-pwa/
```

The build base path is decided in `vite.config.ts`: `/` when the `VERCEL` env
var is set (Vercel sets it), `/timetable-pwa/` otherwise (GitHub Pages). A
build timestamp is baked in as `__BUILD_TIME__` and shown in Settings → Support,
so you can always check which build a device runs.

## 4. Deploying

### 4.1 The web app — automatic (normal path)

```bash
git push origin main
```

- **GitHub Pages**: `.github/workflows/deploy.yml` installs dependencies and Chromium,
  runs `npm run validate` (build, worker/release unit tests and browser tests), then publishes
  `dist/`. Any failure blocks publication.
- **Vercel**: its Git integration builds the same commit independently (with
  `VERCEL` set, so base `/`). `vercel.json` runs `scripts/validate.sh --skip-e2e`
  (build + unit tests; fail-closed). The browser (Playwright) gate for the same
  commit runs in GitHub Actions — Vercel's build image cannot launch Chromium
  (missing system libraries, no root), verified from a failed build's logs on
  6 Sep 2026, which left Vercel silently serving a stale deployment until this
  split was introduced.
- If SSH port 22 is blocked on your network, push over 443:
  `GIT_SSH_COMMAND="ssh -o HostName=ssh.github.com -o Port=443" git push`
  (or add `Host github.com / HostName ssh.github.com / Port 443` to `~/.ssh/config`).

### 4.2 The web app — manual

```bash
# GitHub Pages: re-run the workflow without a new commit
./scripts/deploy.sh app
# (or: repo → Actions → "Deploy to GitHub Pages" → Run workflow)

# Vercel: deploy the working tree directly
npx vercel --prod
```

### 4.3 The Cloudflare workers — always manual

```bash
cd workers/push     && npx wrangler deploy
cd workers/ics-feed && npx wrangler deploy
```

Deploy the relevant worker whenever `workers/push/worker.js` or
`workers/ics-feed/worker.js` changes. Deploys are instant and zero-downtime;
KV data (subscriptions, snapshots, sync blobs, analytics) is untouched.

**Deploy the app and workers together** when a change spans both (e.g. a new
`/endpoint` the app calls): deploy the worker *first*, then push the app — old
app versions ignore new endpoints, but a new app calling a missing endpoint
fails.

## 5. First-time setup from scratch (new fork / new accounts)

1. **Clone and install**: `git clone … && npm ci`.
2. **Cloudflare**: `npx wrangler login`, then create the KV namespace and wire it in:
   ```bash
   cd workers/push
   npx wrangler kv namespace create PUSH     # prints an id
   ```
   Put that id in **both** `workers/push/wrangler.toml` (binding `PUSH`) and
   `workers/ics-feed/wrangler.toml` (binding `RATE` — the feed worker reuses the
   same namespace for its `hist:` keys). Then deploy both workers (4.3). The
   push worker's cron (`*/10 * * * *`) and VAPID keypair set themselves up
   automatically on first use.
3. **Stats key** (protects the analytics endpoint):
   ```bash
   cd workers/push
   npx wrangler kv key put --namespace-id <your-id> --remote statskey "$(python3 -c 'import secrets;print(secrets.token_hex(12))')"
   ```
   Keep the printed value — the dashboard asks for it once per browser.
4. **Point the app at your workers**: edit `src/lib/config.ts`
   (`DEFAULT_PUSH_BASE`, `DEFAULT_ICS_FEED_BASE`) to your `*.workers.dev` URLs,
   and `public/analytics.html` (`const BASE = …`).
5. **GitHub Pages**: push to `main`. If the first run fails because Pages isn't
   enabled: `gh api -X POST repos/<owner>/<repo>/pages -f build_type=workflow`,
   then re-run the workflow. If the repo name differs from `timetable-pwa`,
   change the base path in `vite.config.ts` and `playwright.config`'s URL in
   `tests/smoke.spec.ts`.
6. **Vercel**: `npx vercel` once to create/link the project, then `npx vercel
   --prod`; subsequent pushes auto-deploy. Add a custom alias in the Vercel
   dashboard if wanted (this deployment uses `pgce-timetable.vercel.app`).

## 6. Secrets & state inventory

There are only two secret-ish values, both living in KV (never in the repo):

| Key | Purpose | Notes |
|---|---|---|
| `statskey` | Guards `GET /stats` | Rotate any time: `npx wrangler kv key put --namespace-id … --remote statskey <new>`; re-enter in the dashboard |
| `vapid` | Web Push signing keypair | **Auto-generated; never delete/replace it** — doing so invalidates every push subscription and everyone must re-enable push |

KV key prefixes (useful when inspecting with `wrangler kv key list`):
`sub:` push subscriptions+config · `snap:` sheet snapshots (also feeds `/history`)
· `sent:` notification dedupe · `snooze:` pending snoozes · `fail:` sheet-health
counters · `ntcseen:` notices seen · `grp:` study groups · `sync:` encrypted
device-sync blobs · `aping:`/`adev:` anonymous analytics · `hist:` calendar-feed
history · `testlock` test-push throttle.

User data note: sync blobs are encrypted client-side (the worker never sees
plaintext); analytics rows contain no personal data. Nothing else server-side
is user-identifiable.

## 7. Post-deploy verification

```bash
# App hosts
curl -s -o /dev/null -w '%{http_code}\n' https://pgce-timetable.vercel.app/            # 200
curl -s -o /dev/null -w '%{http_code}\n' https://abdulwsaqib1996.github.io/timetable-pwa/  # 200

# Push worker
curl -s https://timetable-push.ics-feed.workers.dev/vapid                    # {"publicKey":…}
curl -s -o /dev/null -w '%{http_code}\n' https://timetable-push.ics-feed.workers.dev/stats  # 401 (locked)

# Feed worker (any public sheet id)
curl -s -D - -o /dev/null "https://timetable-ics.ics-feed.workers.dev/?id=<sheetId>&gid=<gid>" | grep -i cache-control  # max-age=900
```

Then in the app: Settings → Support shows the new build timestamp (devices pick
it up automatically on the next open/resume — the SW checks for updates on
every resume); Settings → Background push → "Run self-check" should be all ✓ on
a subscribed device. `npm run test:e2e` locally reproduces the CI gate.

## 8. Rollback

- **App**: `git revert <bad-commit> && git push` — both hosts redeploy the
  revert (Pages still runs the smoke gate). Devices auto-update to the revert
  like any release.
- **Workers**: `npx wrangler deployments list` then `npx wrangler rollback` in
  the worker's directory (or `git checkout <good> -- worker.js && npx wrangler
  deploy`). KV state is versionless and unaffected either way.

## 9. Operating notes

- **Free-tier budget**: the binding constraint is Cloudflare KV's ~1,000
  writes/day (account-wide). The app is engineered around it — pings ≤2
  writes/device/day, config/sync writes only on real changes, the feed writes
  history at most ~once/day per sheet, and rate-limiting is in-memory. Worst
  case at ~30 active users is a few hundred writes/day. Requests (100k/day) and
  KV reads (100k/day) have huge headroom.
- The cron runs every 10 minutes; briefing 07:00, week-ahead Sun 18:00, Friday
  digest 16:00 (all Europe/London via the worker's own clock handling).
- The dashboard (`/analytics.html`) caches `/stats` for 10 minutes per browser;
  the refresh link forces.
- Full change history and design decisions: [PLAN.md](PLAN.md).

## Phase 1 release and recovery

Phase 1 is prepared on `codex/phase-1`; it is not deployed by running the isolated tests.

1. Run `./scripts/deploy.sh preflight`, then `./scripts/deploy.sh build` on the intended
   code. Missing authentication is a human setup step, not a reason to bypass checks.
2. Deploy the corrected worker before the frontend. The `workers` target now repeats the
   shared validation gate. Preserve existing KV namespace bindings and the `vapid` record.
3. Release the reviewed frontend commit to main. Pages runs the full gate (incl. browser
   tests); Vercel runs build + unit tests (`--skip-e2e` — its image cannot launch Chromium).
   PRs validate without deploying Pages.
4. Run `./scripts/deploy.sh verify` after deployment and report its output. Do not call
   a push-test or analytics endpoint as a health check. Hosting verification is still required;
   a local pass is not evidence that a release has shipped.

The corrected worker returns 410 for legacy `/test`. Old apps receive a refusal instead
of a broadcast. New apps use only `/test-device`; an old worker returns 404, and the app
explains that the server needs updating. No fallback and no administrator broadcast exist.
Device tests present the installed subscription's endpoint, public key and secret auth
material over HTTPS; the worker compares them with the stored subscription and sends once
to that record. Credentials/provider responses are not returned or logged. Known HTTPS
push services are allowed (FCM, Mozilla, Apple and Windows notification hosts); unsupported
providers are rejected explicitly. Outbound redirects are disabled.

`testlock:<subscription-hash>` is a ten-minute, per-device, expiring operational key.
No existing `testlock` or user record is deleted during rollout. This KV cooldown is
best-effort across isolates and is not a global transactional quota.

For a manual Pages redeploy, the driver supplies a unique `deployment_id` input, matches
both that run title and the expected main SHA, and fails if identification or completion
times out. It never selects an unrelated latest run. If main changes concurrently, retry
against the intended commit; do not weaken the match. A direct linked Vercel redeploy also
requires a clean checkout of that validated SHA, and runs Vercel's configured build gate.

Recovery: revert the frontend if needed while keeping the corrected worker. **Do not roll
back the push worker to a version that restores the broadcasting `/test` endpoint.** Apply
a forward fix or another release that retains the 410 response. No data migration is part
of Phase 1. Do not rotate/delete VAPID or bulk-clear KV during recovery.

Configuration references: [Vercel build commands](https://vercel.com/docs/builds/configure-a-build),
[GitHub workflow dispatch](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow?tool=webui).
