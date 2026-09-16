/**
 * E05 (audit D3, Pass 85): the learner-controlled data & sharing centre.
 * Runtime-neutral. Four states — on this device, synced, backed up, shared
 * with mentors — derived ONLY from confirmed results: a persisted save, the
 * server's acknowledged sync time, a backup generation this device recorded
 * (with the exact attachment identities it contained), and a pack's
 * `sharing` summary written after the mentor service acknowledged the share.
 * A button click, an attempt or a download prompt is never a state. Files are
 * identified by their stable uid, so a restore that remaps local ids keeps
 * every link, and a file that is referenced but absent is named as missing.
 * The recovery guide is plain language and carries no secret.
 */

import { MENTOR_ATTACHMENT_TTL_S } from './mentor.js'

export const MENTOR_ATTACHMENT_TTL_MS = MENTOR_ATTACHMENT_TTL_S * 1000

/** When a shared pack's portal copies of its attachments stop being served. */
export function attachmentExpiry(sharedAt, now) {
  const expiresAt = sharedAt + MENTOR_ATTACHMENT_TTL_MS
  return { expiresAt, expired: now >= expiresAt, daysLeft: Math.max(0, Math.ceil((expiresAt - now) / 86400000)) }
}

/** Every file reference in the admin file, by uid: packs, project drafts, receipts and feedback. */
export function referencedUids(admin) {
  const out = new Map()
  const add = (uid, ref) => {
    if (!uid) return
    if (!out.has(uid)) out.set(uid, [])
    out.get(uid).push(ref)
  }
  for (const p of admin?.reviewPacks ?? []) for (const a of p.attachments ?? []) add(a.uid, { kind: 'pack', id: p.id, title: p.title, name: a.name })
  for (const pr of admin?.projects ?? []) {
    for (const d of pr.drafts ?? []) if (d.kind === 'wallet') add(d.uid, { kind: 'project-draft', id: pr.id, title: pr.title, name: d.label })
    for (const s of pr.submissions ?? []) add(s.receiptUid, { kind: 'project-receipt', id: pr.id, title: pr.title, name: `receipt (${s.channel})` })
    for (const f of pr.feedbackRefs ?? []) if (f.kind === 'wallet') add(f.uid, { kind: 'project-feedback', id: pr.id, title: pr.title, name: f.source })
  }
  return out
}

/** Point every reference at another file identity (the learner chose the original file again). Pure. */
export function relinkUid(admin, fromUid, toUid, now) {
  if (!fromUid || !toUid || fromUid === toUid) return admin
  const packs = (admin.reviewPacks ?? []).map((p) => {
    if (!(p.attachments ?? []).some((a) => a.uid === fromUid)) return p
    return { ...p, attachments: p.attachments.map((a) => (a.uid === fromUid ? { ...a, uid: toUid, state: 'local-only' } : a)), at: now }
  })
  const projects = (admin.projects ?? []).map((pr) => {
    const hit = (pr.drafts ?? []).some((d) => d.uid === fromUid) || (pr.submissions ?? []).some((s) => s.receiptUid === fromUid) || (pr.feedbackRefs ?? []).some((f) => f.uid === fromUid)
    if (!hit) return pr
    return {
      ...pr,
      ...(pr.drafts ? { drafts: pr.drafts.map((d) => (d.uid === fromUid ? { ...d, uid: toUid } : d)) } : {}),
      ...(pr.submissions ? { submissions: pr.submissions.map((s) => (s.receiptUid === fromUid ? { ...s, receiptUid: toUid } : s)) } : {}),
      ...(pr.feedbackRefs ? { feedbackRefs: pr.feedbackRefs.map((f) => (f.uid === fromUid ? { ...f, uid: toUid } : f)) } : {}),
      at: now,
    }
  })
  return { ...admin, reviewPacks: packs, projects }
}

/**
 * One row per file on this device, plus one per referenced file that is not
 * here. "Backed up" means a backup generated on this device listed the uid;
 * "shared" lists the packs whose acknowledged share included it, with the
 * portal expiry. Nothing here infers from a download prompt or an attempt.
 */
export function fileRows({ files, admin, history, now }) {
  const refs = referencedUids(admin)
  const newestWith = (uid) => (history ?? []).find((h) => Array.isArray(h.attachments) && h.attachments.includes(uid)) ?? null
  const sharesOf = (uid) =>
    (admin?.reviewPacks ?? [])
      .filter((p) => p.sharing && !p.sharing.unsharedAt && (p.sharing.attachmentUids ?? []).includes(uid))
      .map((p) => ({ packId: p.id, title: p.title, revision: p.sharing.revision, sharedAt: p.sharing.sharedAt, ...attachmentExpiry(p.sharing.sharedAt, now) }))
  const rows = files.map((f) => {
    const b = newestWith(f.uid)
    return { uid: f.uid, name: f.name, kind: f.kind, size: f.size ?? null, present: true, backedUp: b ? { at: b.at } : null, shares: sharesOf(f.uid), refs: refs.get(f.uid) ?? [] }
  })
  const present = new Set(files.map((f) => f.uid))
  for (const [uid, list] of refs) if (!present.has(uid)) rows.push({ uid, name: list[0].name || 'file', kind: 'missing', size: null, present: false, backedUp: newestWith(uid) ? { at: newestWith(uid).at } : null, shares: sharesOf(uid), refs: list })
  return rows
}

/** Synced state from the server-acknowledged time only. Records edited after it are pending. */
export function syncSummary({ enabled, lastAt, failed, busy, records, now }) {
  if (!enabled) return { state: 'off', pending: 0, lastAt: null }
  const pending = (records ?? []).filter((r) => (r.at ?? 0) > (lastAt ?? 0)).length
  // Switched on but never acknowledged is "never" — nothing is confirmed, whatever is pending.
  const state = failed ? 'failed' : busy ? 'working' : !lastAt ? 'never' : pending > 0 ? 'pending' : 'confirmed'
  return { state, pending, lastAt: lastAt ?? null, ageMs: lastAt ? now - lastAt : null }
}

/** Backed-up state from recorded generations only: what the newest one contained, and what changed since. */
export function backupSummaryState({ history, profileId, records, now }) {
  const newest = (history ?? []).find((h) => h.all || (h.profiles ?? []).includes(profileId)) ?? null
  if (!newest) return { state: 'never', lastAt: null, files: null, editsSince: (records ?? []).length }
  const editsSince = (records ?? []).filter((r) => (r.at ?? 0) > newest.at).length
  const ageDays = (now - newest.at) / 86400000
  return { state: editsSince > 0 || ageDays > 30 ? 'stale' : 'covered', lastAt: newest.at, files: newest.files === true ? (newest.attachments?.length ?? 0) : newest.files === false ? 0 : null, editsSince, ageDays }
}

/** Shared-with-mentors state from acknowledged shares on the packs. */
export function shareSummary(admin, now) {
  const packs = (admin?.reviewPacks ?? []).filter((p) => p.sharing)
  const live = packs.filter((p) => !p.sharing.unsharedAt && p.sharing.mentorIds.length > 0)
  const expired = live.filter((p) => (p.sharing.attachmentUids ?? []).length > 0 && attachmentExpiry(p.sharing.sharedAt, now).expired)
  const newest = live.map((p) => p.sharing.sharedAt).sort((a, b) => b - a)[0] ?? null
  return { shared: live.length, expired: expired.length, unshared: packs.length - live.length, lastAt: newest, packs: live.map((p) => ({ id: p.id, title: p.title, revision: p.sharing.revision, sharedAt: p.sharing.sharedAt, mentors: p.sharing.mentorIds.length, files: (p.sharing.attachmentUids ?? []).length, ...attachmentExpiry(p.sharing.sharedAt, now) })) }
}

/**
 * Before a restore: which file identities the backup's records reference that
 * are in neither the backup's own attachments nor on this device — those
 * records will read "missing" after the restore, and the learner should know
 * first. Restored local numeric ids never matter: only uids are compared.
 */
export function restoreReferencedMissing(backupAdminByProfile, backupUids, localUids) {
  const missing = new Set()
  for (const admin of Object.values(backupAdminByProfile ?? {})) for (const uid of referencedUids(admin).keys()) if (!backupUids.has(uid) && !localUids.has(uid)) missing.add(uid)
  return { count: missing.size, uids: [...missing] }
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

/**
 * A plain-language recovery guide the learner can keep with their backup. It
 * names what exists and how to get it back; it never includes a sync code, a
 * mentor owner token, an invite secret or any key.
 */
export function buildRecoveryGuide({ generatedAt, profiles, sync, backup, mentors, appUrl }) {
  const when = new Date(generatedAt).toLocaleString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  const lines = []
  lines.push('MY TIMETABLE — RECOVERY GUIDE', `Written ${when} from the app on this device.`, '')
  lines.push('WHAT EXISTS')
  for (const p of profiles) lines.push(`- Timetable "${p.name}": ${plural(p.records, 'session record')}, ${plural(p.adminRecords, 'PGCE record')}, ${plural(p.photos, 'photo')}, ${plural(p.documents, 'document')}.`)
  lines.push('')
  lines.push('WHERE IT LIVES')
  lines.push('- Everything is stored in this browser on this device. Clearing site data or uninstalling removes it unless you have a backup.')
  lines.push(sync.enabled ? `- Sync between devices is ON: records (not photos or documents) are copied, encrypted, to your other devices under a code you chose. The code is not written here — find it in Settings → Data & devices on a device that has it, and keep it somewhere safe of your own.` : '- Sync between devices is OFF: nothing is copied anywhere.')
  lines.push(backup.lastAt ? `- Last backup generated here: ${new Date(backup.lastAt).toLocaleString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}${backup.files === null ? '' : backup.files ? `, including ${plural(backup.files, 'file')}` : ', records only (no photos or documents)'}. The app cannot see whether you kept the file — check where you saved it.` : '- No backup has been generated on this device yet.')
  lines.push(mentors.enabled ? `- Mentor access is ON: ${plural(mentors.packsShared, 'review pack')} currently shared. Shared attachments are served to mentors for 60 days from each share, then expire on the portal. Your access credential is not written here.` : '- Mentor access is OFF.')
  lines.push('')
  lines.push('HOW TO GET IT BACK')
  lines.push(`1. Open the app${appUrl ? ` at ${appUrl}` : ''} on the new device or browser.`)
  lines.push('2. Settings → Data & devices → Restore from backup… and choose your backup file. If it is sealed with a passphrase you will be asked for it. The preview shows what will be added, replaced or is missing before anything changes.')
  lines.push('3. If sync was on, enter your sync code under Sync between devices to pull your records from your other devices. Photos and documents do not sync — they come from a backup.')
  lines.push('4. If a record says a file is missing on this device, choose the original file again from your wallet (Relink) or restore a backup that contains it.')
  lines.push('5. If mentor access was on, turn it on again on the restored device; mentors keep what you shared until you unshare it or the portal copies expire.')
  lines.push('')
  lines.push('This guide contains no codes, tokens or keys — keep those separately.')
  return lines.join('\n')
}
