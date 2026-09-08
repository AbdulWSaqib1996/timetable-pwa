export interface CourseBuilding {
  name: string
  keywords: string[]
  lat: number
  lng: number
}

export interface CourseConfig {
  configId: string
  version: number
  name: string
  timezone: string
  terminology: { specialism: string; group: string }
  campus: { label: string; lat: number; lng: number; searchSuffix: string }
  buildings: CourseBuilding[]
  features: { placement: boolean; pgceFile: boolean }
  journeyProvider: 'tfl' | 'none'
}

export const TEMPLATE_FIELDS: readonly string[]
export const UCL_PGCE_CONFIG: CourseConfig

export function validTimezone(tz: unknown): boolean
export function validateCourseConfig(input: unknown): {
  ok: boolean
  errors: string[]
  config: CourseConfig | null
}
export function sanitizeTemplate(config: unknown): CourseConfig | null
export function applyTemplate<T extends object>(settings: T, config: unknown): T & { courseConfig?: CourseConfig }
