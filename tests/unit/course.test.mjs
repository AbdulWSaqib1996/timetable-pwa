import test from 'node:test'
import assert from 'node:assert/strict'
import {
  TEMPLATE_FIELDS,
  UCL_PGCE_CONFIG,
  applyTemplate,
  sanitizeTemplate,
  validTimezone,
  validateCourseConfig,
} from '../../shared/course.js'
import { buildICSCalendar, zonedTodayISO } from '../../shared/calendar-time.js'

test('migration fixture: the UCL built-in validates and matches the pre-P7 constants', () => {
  const { ok, config } = validateCourseConfig(UCL_PGCE_CONFIG)
  assert.ok(ok)
  assert.equal(config.timezone, 'Europe/London')
  assert.equal(config.campus.lat, 51.5227)
  assert.equal(config.campus.lng, -0.1276)
  // The gazetteer that shipped hardcoded: same buildings, same keyword matches.
  const key = 'ioe - bedford way (20) - 631'
  const match = config.buildings.find((b) => b.keywords.some((k) => key.includes(k)))
  assert.equal(match.name, 'IOE — 20 Bedford Way')
  assert.equal(config.features.placement, true)
  assert.equal(config.features.pgceFile, true)
})

const OTHER_COURSE = {
  configId: 'nyu-teaching-residency',
  version: 2,
  name: 'NYU Teaching Residency',
  timezone: 'America/New_York',
  terminology: { specialism: 'Concentration', group: 'Cohort' },
  campus: { label: 'NYU Steinhardt', lat: 40.7295, lng: -73.9965, searchSuffix: 'NYU New York' },
  buildings: [
    { name: 'Pless Hall', keywords: ['pless'], lat: 40.7308, lng: -73.9946 },
    { name: 'Kimball Hall', keywords: ['kimball'], lat: 40.7297, lng: -73.9942 },
  ],
  features: { placement: true, pgceFile: false },
}

test('a second course in another timezone validates; its wall times convert on the shared path', () => {
  const { ok, config } = validateCourseConfig(OTHER_COURSE)
  assert.ok(ok)
  assert.equal(config.features.pgceFile, false)
  // Same shared timezone model — no alternate conversion path: a 09:00 class
  // in New York exports as 13:00/14:00 UTC (EDT/EST), never London-shifted.
  const ics = buildICSCalendar(
    [{ id: 'x', dateISO: '2026-09-09', start: '09:00', end: '10:00', title: 'Methods seminar' }],
    'NYU',
    { zone: config.timezone }
  )
  assert.ok(ics.includes('DTSTART:20260909T130000Z'))
  // "today" in that zone can differ from London's — derived by the same helper.
  assert.equal(typeof zonedTodayISO(config.timezone), 'string')
})

test('two courses can share a subject/course name — identity is the configId, not the name', () => {
  const a = validateCourseConfig({ ...OTHER_COURSE, configId: 'course-a' })
  const b = validateCourseConfig({ ...OTHER_COURSE, configId: 'course-b' })
  assert.ok(a.ok && b.ok)
  assert.equal(a.config.name, b.config.name)
  assert.notEqual(a.config.configId, b.config.configId)
})

test('invalid templates are refused with reasons, never half-applied', () => {
  const bad = validateCourseConfig({
    configId: 'Bad Slug!',
    version: 0,
    name: 'x',
    timezone: 'Mars/Olympus_Mons_Base_Camp_One_Xx',
    campus: { label: '', lat: 123, lng: -200 },
    buildings: [{ name: '', keywords: [], lat: 91, lng: 0 }],
  })
  assert.equal(bad.ok, false)
  assert.equal(bad.config, null)
  assert.ok(bad.errors.length >= 5)
  assert.equal(validTimezone('Europe/London'), true)
  assert.equal(validTimezone('Not A Zone'), false)
  // settings stay untouched when the template is invalid
  const settings = { homeAddress: '1 Home St', courseConfig: undefined }
  assert.equal(applyTemplate(settings, { nope: true }), settings)
})

test('template update preserves personal data: only courseConfig changes', () => {
  const settings = {
    homeAddress: '1 Example Street',
    homeLat: 51.55,
    homeLng: -0.1,
    reminderMinutes: 30,
    groupCode: 'K7M2PQ',
    groupToken: 'secret-token',
    courseConfig: validateCourseConfig(OTHER_COURSE).config,
  }
  const updated = applyTemplate(settings, { ...OTHER_COURSE, version: 3, name: 'NYU Teaching Residency (2027)' })
  assert.equal(updated.courseConfig.version, 3)
  assert.equal(updated.homeAddress, '1 Example Street')
  assert.equal(updated.reminderMinutes, 30)
  assert.equal(updated.groupToken, 'secret-token')
  const { courseConfig: _a, ...restBefore } = settings
  const { courseConfig: _b, ...restAfter } = updated
  assert.deepEqual(restAfter, restBefore)
})

test('portable template contains no secrets: whitelist rebuild drops every foreign field', () => {
  const polluted = {
    ...OTHER_COURSE,
    groupToken: 'secret',
    syncCode: 'ABCDEF',
    homeAddress: '1 Private Lane',
    pushSubscription: { endpoint: 'https://example' },
    evidence: [{ note: 'private' }],
  }
  const template = sanitizeTemplate(polluted)
  assert.ok(template)
  assert.deepEqual(Object.keys(template).sort(), [...TEMPLATE_FIELDS].sort())
  const json = JSON.stringify(template)
  for (const leak of ['secret', 'ABCDEF', 'Private Lane', 'endpoint', 'evidence']) {
    assert.ok(!json.includes(leak), `template leaked ${leak}`)
  }
  // An invalid config yields NO template rather than a best-effort one.
  assert.equal(sanitizeTemplate({ configId: 'x' }), null)
})

test('journeyProvider is part of the template: defaults to tfl, accepts none, rejects anything else', () => {
  assert.equal(validateCourseConfig(UCL_PGCE_CONFIG).config.journeyProvider, 'tfl')
  assert.equal(validateCourseConfig({ ...OTHER_COURSE, journeyProvider: 'none' }).config.journeyProvider, 'none')
  assert.equal(validateCourseConfig({ ...OTHER_COURSE, journeyProvider: 'citymapper' }).ok, false)
  assert.ok(Object.keys(sanitizeTemplate(OTHER_COURSE)).includes('journeyProvider'))
})
