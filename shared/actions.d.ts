export const ACTION_VERSION: number
export interface NotificationData {
  v: number
  url: string
  key?: string
  kind: 'session' | 'task' | 'attendance'
  profileId?: string
  snoozeUrl?: string
}
export function makeNotificationData(opts: {
  profileId?: string
  key?: string
  kind?: 'session' | 'task' | 'attendance'
  url?: string
  snoozeUrl?: string
}): NotificationData
export interface QueuedAction {
  v?: number
  action: string
  key: string
  profileId?: string
  kind?: string
  id?: string
  at: number
}
export function groupPendingActions(
  items: (QueuedAction | null | undefined)[],
  profileIds: string[]
): {
  apply: Map<string, QueuedAction[]>
  open: { profileId: string; key: string; kind: string }[]
  dropped: (QueuedAction | null | undefined)[]
}
