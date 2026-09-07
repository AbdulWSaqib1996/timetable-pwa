export type JourneyIntent =
  | { kind: 'leave-now' }
  | { kind: 'arrive-by'; arriveByMs: number; timeZone?: string; eventKey?: string }

export interface JourneyEndpoint {
  lat: number
  lng: number
  label?: string
  basis?: 'device' | 'home' | 'campus' | 'placement' | 'saved'
}

export interface JourneyRequestLike {
  origin: JourneyEndpoint
  destination: JourneyEndpoint
  mode: string
  intent: JourneyIntent
  arrivalBufferMinutes?: number
}

export interface ItineraryLeg {
  mode: string
  line: string
  from: string
  to: string
  departMs: number | null
  arriveMs: number | null
  minutes: number
  fromLat?: number
  fromLng?: number
  summary: string
  disruptions: string[]
  isDisrupted: boolean
}

export interface Itinerary {
  departureMs: number
  arrivalMs: number
  durationMins: number
  legs: ItineraryLeg[]
  lines: string[]
}

export function journeyRequestKey(req: JourneyRequestLike): string
export function requiredArrivalMs(startMs: number, bufferMins: number): number
export function validateItinerary(raw: unknown, zone?: string): Itinerary | null
export function pickFeasibleItinerary(
  itineraries: (Itinerary | null)[],
  requiredMs: number,
  toleranceMs?: number
): Itinerary | null
export function departureState(leaveByMs: number, nowMs: number): 'future' | 'imminent' | 'passed'
