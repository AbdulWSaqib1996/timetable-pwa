/** Canonical worker deployments for this app; Settings inputs can override them. */
export const DEFAULT_ICS_FEED_BASE = 'https://timetable-ics.ics-feed.workers.dev'
export const DEFAULT_PUSH_BASE = 'https://timetable-push.ics-feed.workers.dev'

/**
 * Google Drive backups (R5b / NF-09): the OAuth *client id* of the dedicated
 * Google Cloud project (a public, origin-restricted identifier — no secret
 * belongs in the browser). Set at build time via VITE_GOOGLE_OAUTH_CLIENT_ID;
 * empty = the provider card stays in its explanatory disabled state.
 * A localStorage override exists for local development and tests only.
 */
/** Owner-provisioned client (project my-timetable-backups-260910, 10 Sep 2026). Public and origin-restricted. */
const DEFAULT_GOOGLE_OAUTH_CLIENT_ID = '36473996504-3b6j3dasv2aj23lloo7j5kh8l6oli770.apps.googleusercontent.com'
export const GOOGLE_OAUTH_CLIENT_ID: string = (import.meta.env?.VITE_GOOGLE_OAUTH_CLIENT_ID as string | undefined) || DEFAULT_GOOGLE_OAUTH_CLIENT_ID
export function googleClientId(): string {
  try {
    const override = localStorage.getItem('timetable.dev.google-client-id')
    if (override === 'off') return '' // dev/test: simulate an unconfigured build
    if (override && /^[\w.-]+\.apps\.googleusercontent\.com$/.test(override)) return override
  } catch {
    /* storage unavailable */
  }
  return GOOGLE_OAUTH_CLIENT_ID
}
