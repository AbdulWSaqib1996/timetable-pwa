#!/usr/bin/env bash
# Non-interactive deploy driver for My Timetable — safe for AI agents and CI.
# Usage: ./scripts/deploy.sh <preflight|build|workers|app|verify|all>
#
# Exit codes: 0 success, 1 a step failed, 2 missing auth/tooling (preflight).
# Every step prints PASS/FAIL lines; nothing prompts for input.
set -uo pipefail
cd "$(dirname "$0")/.."

PUSH_BASE="https://timetable-push.ics-feed.workers.dev"
FEED_BASE="https://timetable-ics.ics-feed.workers.dev"
PAGES_URL="https://abdulwsaqib1996.github.io/timetable-pwa/"
VERCEL_URL="https://pgce-timetable.vercel.app/"
SHEET_ID="1dQIERBovT4LZ4LlhzMbspFjRwmhJ_57TNsddMfEK2ZM"
SHEET_GID="841883402"

ok()   { echo "PASS: $*"; }
bad()  { echo "FAIL: $*"; FAILED=1; }
FAILED=0

preflight() {
  echo "== preflight =="
  command -v node >/dev/null && [ "$(node -e 'console.log(process.versions.node.split(".")[0])')" -ge 20 ] \
    && ok "node $(node --version)" || bad "node 20+ required"
  if npx --yes wrangler whoami >/dev/null 2>&1; then
    ok "wrangler authenticated"
  else
    bad "wrangler not authenticated — a human must run 'npx wrangler login' once (browser OAuth)"
  fi
  if command -v gh >/dev/null && gh auth status >/dev/null 2>&1; then
    ok "gh authenticated"
  else
    echo "WARN: gh not authenticated — Pages deploys still happen on git push; 'app' target needs gh"
  fi
  [ "$FAILED" -eq 0 ] || exit 2
}

build() {
  echo "== build & smoke test =="
  [ -d node_modules ] || npm ci --no-audit --no-fund || { bad "npm ci"; exit 1; }
  npm run validate:ci || { bad "build and regression checks"; exit 1; }
  ok "build and regression checks"
}

workers() {
  echo "== deploy workers =="
  ( cd workers/push && npx wrangler deploy ) || { bad "timetable-push deploy"; exit 1; }
  ok "timetable-push deployed"
  ( cd workers/ics-feed && npx wrangler deploy ) || { bad "timetable-ics deploy"; exit 1; }
  ok "timetable-ics deployed"
}

app() {
  echo "== deploy app (GitHub Pages via Actions + Vercel) =="
  echo "note: the normal path is 'git push origin main'; this target redeploys the current main."
  local deployment_id expected_sha run_id status
  deployment_id="timetable-release-$(node -e 'console.log(crypto.randomUUID())')"
  expected_sha=$(gh api repos/{owner}/{repo}/commits/main --jq .sha) || { bad "could not resolve main"; exit 1; }
  gh workflow run deploy.yml --ref main -f "deployment_id=$deployment_id" || { bad "could not trigger the Pages workflow"; exit 1; }
  run_id=""
  for ((attempt=0; attempt<${TIMETABLE_POLL_ATTEMPTS:-40}; attempt++)); do
    run_id=$(gh run list --workflow deploy.yml --branch main --event workflow_dispatch --limit 100 \
      --json databaseId,displayTitle,headSha | node scripts/select-deploy-run.mjs "$deployment_id" "$expected_sha") \
      || { bad "could not identify the dispatched workflow"; exit 1; }
    [ -n "$run_id" ] && break
    sleep "${TIMETABLE_POLL_SECONDS:-15}"
  done
  [ -n "$run_id" ] || { bad "timed out locating workflow $deployment_id"; exit 1; }
  local completed=0
  for ((attempt=0; attempt<${TIMETABLE_POLL_ATTEMPTS:-40}; attempt++)); do
    status=$(gh run view "$run_id" --json status,conclusion -q '.status + " " + (.conclusion // "")') \
      || { bad "could not read workflow $run_id"; exit 1; }
    case "$status" in
      "completed success") ok "Pages workflow $run_id"; completed=1; break ;;
      completed*) bad "Pages workflow $run_id: $status"; exit 1 ;;
    esac
    sleep "${TIMETABLE_POLL_SECONDS:-15}"
  done
  [ "$completed" -eq 1 ] || { bad "timed out waiting for workflow $run_id"; exit 1; }
  if [ -d .vercel ]; then
    [ "$(git rev-parse HEAD)" = "$expected_sha" ] && [ -z "$(git status --porcelain)" ] \
      || { bad "Vercel redeploy requires a clean checkout of the validated main commit"; exit 1; }
    npx --yes vercel --prod --yes || { bad "vercel deploy"; exit 1; }
    ok "vercel deployed"
  else
    echo "WARN: no .vercel link in this checkout — Vercel still auto-deploys on git push"
  fi
}

verify() {
  echo "== verify live endpoints =="
  [ "$(curl -s -o /dev/null -w '%{http_code}' "$VERCEL_URL")" = "200" ] && ok "vercel app 200" || bad "vercel app"
  [ "$(curl -s -o /dev/null -w '%{http_code}' "$PAGES_URL")" = "200" ] && ok "pages app 200" || bad "pages app"
  curl -s "$PUSH_BASE/vapid" | grep -q '"publicKey"' && ok "push worker /vapid" || bad "push worker /vapid"
  [ "$(curl -s -o /dev/null -w '%{http_code}' "$PUSH_BASE/stats")" = "401" ] && ok "/stats locked (401)" || bad "/stats should be 401 without key"
  curl -s -D - -o /dev/null "$FEED_BASE/?id=$SHEET_ID&gid=$SHEET_GID" | grep -qi 'cache-control: public, max-age=900' \
    && ok "feed worker + cache header" || bad "feed worker cache header"
  [ "$(curl -s -o /dev/null -w '%{http_code}' "${VERCEL_URL}analytics.html")" = "200" ] && ok "analytics dashboard 200" || bad "analytics dashboard"
  [ "$FAILED" -eq 0 ] || exit 1
}

case "${1:-}" in
  preflight) preflight ;;
  build)     build ;;
  workers)   build; workers ;;
  app)       app ;;
  verify)    verify ;;
  all)       preflight; build; workers; app; verify ;;
  *) echo "usage: $0 <preflight|build|workers|app|verify|all>"; exit 1 ;;
esac
[ "$FAILED" -eq 0 ] || exit 1
echo "done."
