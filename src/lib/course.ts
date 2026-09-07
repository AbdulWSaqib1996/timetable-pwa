import { UCL_PGCE_CONFIG, validateCourseConfig } from '../../shared/course.js'
import type { CourseConfig } from '../../shared/course.js'

/**
 * The ACTIVE course configuration (P7-01). App sets it from the profile's
 * settings during render (idempotent); every helper that needs course
 * constants — timezone, campus, buildings, terminology, feature flags —
 * reads it here instead of hardcoding UCL. Without a stored config the
 * UCL Primary PGCE built-in applies, preserving pre-P7 behaviour exactly.
 */

let active: CourseConfig = UCL_PGCE_CONFIG

export function setActiveCourse(config: unknown | undefined): void {
  if (!config) {
    active = UCL_PGCE_CONFIG
    return
  }
  const { ok, config: clean } = validateCourseConfig(config)
  // A stored config that no longer validates falls back to the built-in
  // rather than half-applying.
  active = ok && clean ? clean : UCL_PGCE_CONFIG
}

export function activeCourse(): CourseConfig {
  return active
}

/** The course timezone every wall-time conversion should use. */
export function courseZone(): string {
  return active.timezone
}
