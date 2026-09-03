/** iOS/iPadOS detection (iPadOS masquerades as a Mac but reports touch points). */
export function isIOS(): boolean {
  const ua = navigator.userAgent
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
}

/** Running as an installed app (Home Screen / window), not a browser tab. */
export function isStandalone(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  )
}

/**
 * iOS only allows Web Push for apps on the Home Screen — in a Safari tab the
 * Enable button can only fail. True when the install guide should show instead.
 */
export function needsIosInstall(): boolean {
  return isIOS() && !isStandalone()
}
