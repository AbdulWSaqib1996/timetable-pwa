import { COURSE_TIMEZONE } from './calendar-time.js'

/**
 * Versioned course configuration (P7-01): the UCL/PGCE constants extracted
 * into data so another course works without source-code edits. The UCL
 * Primary PGCE setup stays a first-class built-in and the migration fixture —
 * a profile without a stored config behaves exactly as before.
 *
 * Runtime-neutral: the browser client, workers and node unit tests share this
 * validator, so a template accepted anywhere is accepted everywhere.
 */

/** Whitelisted template fields — a shared template can carry NOTHING else. */
export const TEMPLATE_FIELDS = ['configId', 'version', 'name', 'timezone', 'terminology', 'campus', 'buildings', 'features', 'journeyProvider']

export const UCL_PGCE_CONFIG = {
  configId: 'ucl-primary-pgce',
  version: 1,
  name: 'UCL Primary PGCE',
  timezone: COURSE_TIMEZONE,
  terminology: { specialism: 'Specialism', group: 'Group' },
  campus: {
    label: 'Campus (IOE, 20 Bedford Way)',
    lat: 51.5227,
    lng: -0.1276,
    /** appended to unknown-room map searches, e.g. "631 UCL London" */
    searchSuffix: 'UCL London',
  },
  buildings: [
    { name: 'IOE — 20 Bedford Way', keywords: ['bedford way'], lat: 51.5227, lng: -0.1276 },
    { name: 'Darwin Building', keywords: ['darwin'], lat: 51.5238, lng: -0.1319 },
    { name: 'Cruciform Building', keywords: ['cruciform'], lat: 51.5246, lng: -0.1339 },
    { name: 'Wilkins Building (Main Quad)', keywords: ['wilkins', 'main quad', 'octagon', 'gustave tuck'], lat: 51.5248, lng: -0.1336 },
    { name: 'Senate House', keywords: ['senate house'], lat: 51.5213, lng: -0.1287 },
    { name: 'Institute of Archaeology', keywords: ['archaeology'], lat: 51.5249, lng: -0.131 },
    { name: 'Chandler House', keywords: ['chandler'], lat: 51.5253, lng: -0.1228 },
    { name: 'Roberts Building', keywords: ['roberts'], lat: 51.523, lng: -0.1322 },
    { name: 'Christopher Ingold Building', keywords: ['ingold'], lat: 51.5253, lng: -0.1325 },
    { name: 'Medical Sciences / Anatomy', keywords: ['anatomy', 'medical sciences'], lat: 51.5237, lng: -0.1334 },
    { name: 'Bentham House', keywords: ['bentham'], lat: 51.5257, lng: -0.1307 },
    { name: 'Foster Court', keywords: ['foster court'], lat: 51.5243, lng: -0.1329 },
    { name: '25 Gordon Street', keywords: ['gordon street', 'gordon house'], lat: 51.5245, lng: -0.1317 },
    { name: 'Medawar Building', keywords: ['medawar'], lat: 51.5238, lng: -0.1326 },
    { name: '1–19 Torrington Place', keywords: ['torrington'], lat: 51.5218, lng: -0.1343 },
    { name: 'Tavistock Square area', keywords: ['tavistock'], lat: 51.5253, lng: -0.1289 },
    { name: 'Birkbeck / Malet Street', keywords: ['birkbeck', 'malet street'], lat: 51.5217, lng: -0.1303 },
    { name: 'Student Centre', keywords: ['student centre'], lat: 51.5246, lng: -0.1325 },
    { name: 'Drayton House', keywords: ['drayton'], lat: 51.525, lng: -0.132 },
    { name: 'Gordon Square', keywords: ['gordon square'], lat: 51.5244, lng: -0.13 },
    { name: 'UCL (IOE)', keywords: ['ioe'], lat: 51.5227, lng: -0.1276 },
  ],
  /** PGCE-specific surfaces; another course can switch them off */
  features: { placement: true, pgceFile: true },
  /** internal route planning provider for this course's region ('none' =
   *  external directions only — never a London-only provider failing forever) */
  journeyProvider: 'tfl',
}

const isFiniteNum = (n) => typeof n === 'number' && Number.isFinite(n)
const validLat = (n) => isFiniteNum(n) && n >= -90 && n <= 90
const validLng = (n) => isFiniteNum(n) && n >= -180 && n <= 180
const str = (v, min, max) => typeof v === 'string' && v.trim().length >= min && v.length <= max

/** True when the runtime's own timezone database knows this zone. */
export function validTimezone(tz) {
  if (!str(tz, 2, 60) || !/^[A-Za-z][A-Za-z0-9_+\-/]{1,59}$/.test(tz)) return false
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

/**
 * Validate a course configuration/template. Returns { ok, errors, config } —
 * `config` is a CLEAN rebuild from the whitelist (unknown fields dropped), so
 * an accepted template structurally cannot smuggle secrets or extra data.
 */
export function validateCourseConfig(input) {
  const errors = []
  const o = input && typeof input === 'object' ? input : {}
  if (!str(o.configId, 2, 40) || !/^[a-z0-9][a-z0-9-]{1,39}$/.test(o.configId)) {
    errors.push('configId must be a short lowercase slug (letters, digits, hyphens)')
  }
  if (!Number.isInteger(o.version) || o.version < 1 || o.version > 1_000_000) {
    errors.push('version must be a positive whole number')
  }
  if (!str(o.name, 2, 60)) errors.push('name must be 2–60 characters')
  if (!validTimezone(o.timezone)) errors.push(`timezone is not a recognised IANA zone (e.g. "Europe/London")`)

  const campus = o.campus && typeof o.campus === 'object' ? o.campus : {}
  if (!str(campus.label, 2, 80)) errors.push('campus.label must be 2–80 characters')
  if (!validLat(campus.lat) || !validLng(campus.lng)) errors.push('campus coordinates must be valid latitude/longitude numbers')
  if (campus.searchSuffix !== undefined && !str(campus.searchSuffix, 0, 60)) errors.push('campus.searchSuffix must be at most 60 characters')

  const buildings = []
  if (!Array.isArray(o.buildings) || o.buildings.length > 200) {
    errors.push('buildings must be a list of at most 200 entries')
  } else {
    o.buildings.forEach((b, i) => {
      const bo = b && typeof b === 'object' ? b : {}
      const keywords = Array.isArray(bo.keywords)
        ? bo.keywords.filter((k) => str(k, 2, 40)).map((k) => k.toLowerCase().trim())
        : []
      if (!str(bo.name, 1, 80) || keywords.length === 0 || keywords.length > 10 || !validLat(bo.lat) || !validLng(bo.lng)) {
        errors.push(`building ${i + 1} needs a name, 1–10 keywords (2–40 chars) and valid coordinates`)
        return
      }
      buildings.push({ name: bo.name.trim(), keywords, lat: bo.lat, lng: bo.lng })
    })
  }

  const term = o.terminology && typeof o.terminology === 'object' ? o.terminology : {}
  const terminology = {}
  for (const key of ['specialism', 'group']) {
    if (term[key] !== undefined) {
      if (!str(term[key], 1, 24)) errors.push(`terminology.${key} must be 1–24 characters`)
      else terminology[key] = term[key].trim()
    }
  }

  const journeyProvider = o.journeyProvider === undefined ? 'tfl' : o.journeyProvider
  if (!['tfl', 'none'].includes(journeyProvider)) errors.push("journeyProvider must be 'tfl' or 'none'")

  const feat = o.features && typeof o.features === 'object' ? o.features : {}
  const features = {
    placement: feat.placement !== false,
    pgceFile: feat.pgceFile !== false,
  }

  if (errors.length > 0) return { ok: false, errors, config: null }
  return {
    ok: true,
    errors: [],
    config: {
      configId: o.configId,
      version: o.version,
      name: o.name.trim(),
      timezone: o.timezone,
      terminology: { specialism: terminology.specialism ?? 'Specialism', group: terminology.group ?? 'Group' },
      campus: {
        label: campus.label.trim(),
        lat: campus.lat,
        lng: campus.lng,
        searchSuffix: campus.searchSuffix?.trim() || '',
      },
      buildings,
      features,
      journeyProvider,
    },
  }
}

/**
 * The portable share payload: a re-validated whitelist rebuild. Sync codes,
 * device subscriptions, private addresses, evidence, personal commitments and
 * every other field simply have no slot to occupy.
 */
export function sanitizeTemplate(config) {
  const { ok, config: clean } = validateCourseConfig(config)
  if (!ok || !clean) return null
  const out = {}
  for (const f of TEMPLATE_FIELDS) out[f] = clean[f]
  return out
}

/**
 * Apply a template to a profile's settings: ONLY the course configuration
 * changes. Home, reminders, notes, records, sync and group credentials are
 * untouched by construction — the caller spreads the result over settings.
 */
export function applyTemplate(settings, config) {
  const { ok, config: clean } = validateCourseConfig(config)
  if (!ok || !clean) return settings
  return { ...settings, courseConfig: clean }
}
