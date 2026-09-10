# Google Drive backups — setup runbook (R5b / NF-09)

The app stores passphrase-sealed backup snapshots in the user's own Google Drive
**app-data folder** (`drive.appdata` scope only — never the user's Drive files),
using Google Identity Services' browser token model. The browser holds only a
short-lived access token in memory; there is **no client secret** anywhere.

## What already exists (done 10 September 2026 via `gcloud`, account abdulwsaqib@gmail.com)

| Item | Value |
|---|---|
| Google Cloud project | `my-timetable-backups-260910` (number `36473996504`, name "My Timetable backups") |
| API enabled | `drive.googleapis.com` |

## One-time Console steps (cannot be done from `gcloud` for a personal account)

1. Open <https://console.cloud.google.com/auth/overview?project=my-timetable-backups-260910>
   and configure the OAuth consent screen ("Google Auth Platform"):
   - App name: **My Timetable** · User support email: your Gmail · Audience: **External**
   - Developer contact: your Gmail. Leave the app in **Testing** and add your own Google
     account(s) under **Audience → Test users** (no verification is needed for personal use;
     the token is valid for 7 days in Testing mode, so "Reconnect to back up" appears weekly).
   - Data access / scopes: add **`https://www.googleapis.com/auth/drive.appdata`** only.
2. Open <https://console.cloud.google.com/auth/clients?project=my-timetable-backups-260910>
   → **Create client** → type **Web application**, name "My Timetable PWA":
   - Authorised JavaScript origins (exactly these, no paths):
     - `https://pgce-timetable.vercel.app`
     - `https://abdulwsaqib1996.github.io`
     - `http://localhost:5173`
     - `http://127.0.0.1:4173`
   - Authorised redirect URIs: none (the token model uses a popup, not a redirect).
3. Copy the **Client ID** (ends in `.apps.googleusercontent.com`). It is a public identifier.

## Deployment variables

| Where | Variable | Value |
|---|---|---|
| Vercel → Project → Settings → Environment Variables (Production + Preview) | `VITE_GOOGLE_OAUTH_CLIENT_ID` | the client id |
| GitHub → repo → Settings → Secrets and variables → Actions → **Variables** | `VITE_GOOGLE_OAUTH_CLIENT_ID` | the client id (the Pages workflow passes it to `npm run validate`/build) |
| Local dev | `.env.local` → `VITE_GOOGLE_OAUTH_CLIENT_ID=…` (see `.env.example`) | |

Until the variable is set, the Google Drive card shows "not configured for this build" and
its Connect button is disabled; nothing else in the app changes. A local-only override
`localStorage['timetable.dev.google-client-id']` exists for development and tests.

## Behaviour and limits (what the UI promises — nothing more)

- Backups are **off by default**. Connecting never restores or overwrites local data.
- Progress: Preparing → Encrypting → Uploading → Verifying → Complete. Only a completed,
  verified read-back (SHA-256 of the sealed archive) changes "Last cloud backup".
- Snapshots carry an opaque id + timestamp as the filename; names and content live only
  inside the encrypted archive. Metadata (format version, device label, counts, size,
  checksum, installation id, verification flag) is stored as Drive `appProperties`.
- Retention ("keep only this device's latest 10") touches only snapshots created by this
  installation. Disconnect forgets the in-memory token and never deletes snapshots.
- "Back up when I use the app": foreground only, at most once per 24 hours after data
  changed, only while online, signed in and unlocked in this session. Nothing runs with the
  app closed; no popup is opened without a tap.
- The backup passphrase is never stored, never sent, and cannot be recovered. It is not the
  sync code and not the Google account password.
- Archives exclude device credentials (`groupToken`, `groupMemberId`) and cloud-backup
  bookkeeping; they never contain OAuth tokens, push subscriptions or analytics keys.
- iCloud Drive is a **file** path: the sealed archive goes to the OS share sheet (Save to
  Files → iCloud Drive) or a download; the browser cannot list, verify or delete iCloud
  files, and a dismissed share sheet is not a backup. CloudKit is a documented future option.
