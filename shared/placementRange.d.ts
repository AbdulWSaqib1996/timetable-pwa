export function parsePlacementRange(title: string | null | undefined): { from: string; to: string } | null
export type PlacementWindows = Map<string, { from: string; to: string }[]>
export function placementWindows(
  sessions: ReadonlyArray<{ title: string; isKeyDate?: boolean; placementTag?: string }> | null | undefined,
  isPlacement: (title: string) => boolean,
  tagOf: (title: string) => string
): PlacementWindows
export function insideDeclaredSpan(windows: PlacementWindows, tag: string, dateISO: string): boolean
