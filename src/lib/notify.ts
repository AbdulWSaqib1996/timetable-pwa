/**
 * Show a reminder notification. Prefers the service-worker path so the
 * notification can carry action buttons ("✓ Attended" / "⏰ Snooze 10m" —
 * the page Notification constructor doesn't support actions); falls back
 * to a plain Notification (dev mode, or no SW).
 */
export function showReminder(title: string, body: string, key?: string, snoozeUrl?: string): void {
  void (async () => {
    try {
      const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : undefined
      if (reg) {
        const options: NotificationOptions & { actions?: { action: string; title: string }[] } = {
          body,
          icon: 'icon-192.png',
          badge: 'icon-192.png',
          data: { url: './', key, snoozeUrl: key ? snoozeUrl : undefined },
        }
        if (key) {
          options.actions = [
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
