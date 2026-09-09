import { makeNotificationData } from '../../shared/actions.js'

export interface ReminderOpts {
  /** stable event key (enables action buttons) */
  key?: string
  /** owning profile — actions and taps route back to it (P3-05) */
  profileId?: string
  /** 'task' switches the actions to Open task / Mark done / Snooze; 'attendance' asks attended-or-absent */
  kind?: 'session' | 'task' | 'attendance'
  snoozeUrl?: string
  tag?: string
}

/**
 * Show a reminder notification. Prefers the service-worker path so the
 * notification can carry action buttons (the page Notification constructor
 * doesn't support actions); falls back to a plain Notification (dev mode,
 * or no SW). The payload carries a versioned owner (profileId + eventKey +
 * kind) so a tap or action applies to the right profile.
 */
export function showReminder(title: string, body: string, opts: ReminderOpts = {}): void {
  const { key, profileId, kind = 'session', snoozeUrl, tag } = opts
  void (async () => {
    try {
      const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : undefined
      if (reg) {
        const options: NotificationOptions & { actions?: { action: string; title: string }[] } = {
          body,
          icon: 'icon-192.png',
          badge: 'icon-192.png',
          // A tag makes a same-tag notification replace this one (used so the
          // in-app and push-worker copies of an attendance prompt can't double up).
          tag,
          data: makeNotificationData({ profileId, key, kind, snoozeUrl }),
        }
        if (key) {
          options.actions =
            kind === 'task'
              ? [
                  { action: 'open', title: '📂 Open task' },
                  { action: 'done', title: '✓ Mark done' },
                  { action: 'snooze', title: '⏰ Snooze 10m' },
                ]
              : kind === 'attendance' || tag?.startsWith('att-')
                ? [
                    { action: 'attended', title: '✓ Attended' },
                    { action: 'absent', title: '✗ Absent' },
                  ]
                : [
                    { action: 'attended', title: '✓ Attended' },
                    { action: 'snooze', title: '⏰ Snooze 10m' },
                  ]
        }
        await reg.showNotification(title, options)
        return
      }
    } catch {
      /* fall through to the plain constructor */
    }
    try {
      new Notification(title, { body })
    } catch {
      /* notifications unavailable */
    }
  })()
}
