import type { Coords } from './campus'
import type { Settings } from '../types'

/**
 * Explicit journey origins (P6-02): the user chooses WHERE a journey starts.
 * A denied or missing device fix is never presented as "current location",
 * and campus coordinates are approximate building centres, not verified
 * entrances.
 */

export interface OriginOption {
  id: string
  basis: 'device' | 'home' | 'campus' | 'placement'
  label: string
  detail?: string
  coords: Coords | null
  /** device basis only: when the fix was taken */
  fixAt?: number | null
}

const CAMPUS: Coords = { lat: 51.5227, lng: -0.1276 }

export function availableOrigins(
  settings: Settings,
  coords: Coords | null,
  coordsAt: number | null
): OriginOption[] {
  const out: OriginOption[] = [
    {
      id: 'device',
      basis: 'device',
      label: 'Current location',
      detail: coords
        ? coordsAt
          ? `device fix from ${Math.max(1, Math.round((Date.now() - coordsAt) / 60000))}m ago`
          : 'device fix'
        : settings.locationEnabled
          ? 'waiting for a fix'
          : 'location is off',
      coords,
      fixAt: coordsAt,
    },
    {
      id: 'campus',
      basis: 'campus',
      label: 'Campus (IOE, 20 Bedford Way)',
      detail: 'approximate building centre',
      coords: CAMPUS,
    },
  ]
  if (settings.homeLat != null && settings.homeLng != null) {
    out.push({
      id: 'home',
      basis: 'home',
      label: 'Home',
      detail: settings.homeAddress,
      coords: { lat: settings.homeLat, lng: settings.homeLng },
    })
  }
  for (const [tag, p] of Object.entries(settings.placements ?? {})) {
    if (p.lat != null && p.lng != null) {
      out.push({
        id: `placement:${tag}`,
        basis: 'placement',
        label: `${tag} school${p.school ? ` (${p.school})` : ''}`,
        detail: p.address,
        coords: { lat: p.lat, lng: p.lng },
      })
    }
  }
  return out
}

/** The default origin: a usable device fix, else nothing selected — the UI
 *  must offer the saved origins rather than guessing. */
export function defaultOrigin(options: OriginOption[]): OriginOption | null {
  const device = options.find((o) => o.basis === 'device')
  return device?.coords ? device : null
}
