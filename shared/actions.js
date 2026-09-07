/**
 * Versioned notification payloads and action routing (P3-05).
 *
 * Every notification the app or push worker schedules carries a logical
 * owner: { v: 2, profileId, key (stable eventKey), kind: 'session' | 'task' }.
 * Transport identifiers (endpoints, tags) stay separate. Queued actions from
 * the service worker are routed to the OWNING profile — an unscoped legacy
 * action is applied only when exactly one profile exists; it is never
 * attached to whichever profile happens to be active.
 */

export const ACTION_VERSION = 2

/** Data block for a notification (service-worker `data` field). */
export function makeNotificationData({ profileId, key, kind = 'session', url = './', snoozeUrl } = {}) {
  return { v: ACTION_VERSION, url, key, kind, profileId, snoozeUrl: key ? snoozeUrl : undefined }
}

const isMark = (a) => a === 'attended' || a === 'absent' || a === 'done'

/**
 * Split queued actions by owning profile.
 * Returns:
 *  - apply: Map<profileId, action[]> of attendance/task marks to persist
 *  - open:  ordered "open this event" requests with a resolvable owner
 *  - dropped: actions that cannot be safely attributed (unknown profile, or
 *    an unscoped legacy action while several profiles exist)
 */
export function groupPendingActions(items, profileIds) {
  const apply = new Map()
  const open = []
  const dropped = []
  const known = new Set(profileIds)
  const seenIds = new Set()
  for (const item of items ?? []) {
    if (!item || typeof item.action !== 'string' || !item.key) {
      dropped.push(item)
      continue
    }
    // Deduplicate replayed queue entries so a reload cannot repeat an operation.
    if (item.id) {
      if (seenIds.has(item.id)) continue
      seenIds.add(item.id)
    }
    let owner = item.profileId
    if (owner && !known.has(owner)) {
      dropped.push(item) // owning profile was deleted — never re-attach elsewhere
      continue
    }
    if (!owner) {
      if (profileIds.length === 1) owner = profileIds[0]
      else {
        dropped.push(item)
        continue
      }
    }
    if (item.action === 'open') {
      open.push({ profileId: owner, key: item.key, kind: item.kind ?? 'session' })
    } else if (isMark(item.action)) {
      if (!apply.has(owner)) apply.set(owner, [])
      apply.get(owner).push({ ...item, profileId: owner })
    } else {
      dropped.push(item)
    }
  }
  return { apply, open, dropped }
}
