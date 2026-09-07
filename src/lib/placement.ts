import {
  applyPlacementExceptionRules,
  computePlacementBlocks,
  exceptionFor as exceptionForShared,
  isExcluded,
  placementPolicyOf,
} from '../../shared/placement.js'
import type { PlacementBlockView, PlacementDayView, PlacementPolicy } from '../../shared/placement.js'
import type { PlacementExceptionRec } from './admin'
import type { Session, SessionMeta, Settings } from '../types'

/** Typed adapters over the shared placement core (P5-03) — one implementation
 *  for UI, statistics, calendar filtering, CSV and the binder. */

export type { PlacementBlockView, PlacementDayView, PlacementPolicy }

export const placementPolicy = (settings: Settings): PlacementPolicy => placementPolicyOf(settings)

export const exceptionFor = (
  exceptions: PlacementExceptionRec[],
  tag: string,
  dateISO: string
): PlacementExceptionRec | undefined => exceptionForShared(exceptions, tag, dateISO) as PlacementExceptionRec | undefined

export { isExcluded }

export const applyPlacementExceptions = (
  sessions: Session[],
  exceptions: PlacementExceptionRec[],
  settings: Settings
): Session[] => applyPlacementExceptionRules(sessions, exceptions, settings)

export const placementBlocks = (
  sessions: Session[],
  exceptions: PlacementExceptionRec[],
  settings: Settings,
  metaOf: (s: Session) => SessionMeta | undefined
): PlacementBlockView[] => computePlacementBlocks(sessions, exceptions, settings, metaOf)
