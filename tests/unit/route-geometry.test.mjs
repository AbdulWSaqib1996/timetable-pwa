import test from 'node:test'
import assert from 'node:assert/strict'
import { fitZoom, mercator, parseLineString, projectOffset, routeBounds } from '../../shared/route-geometry.js'
import { validateItinerary } from '../../shared/journey.js'

test('parseLineString: provider JSON in, [lat,lng] pairs out; garbage and bad points dropped', () => {
  assert.deepEqual(parseLineString('[[51.52,-0.13],[51.53,-0.12]]'), [
    [51.52, -0.13],
    [51.53, -0.12],
  ])
  assert.deepEqual(parseLineString('not json'), [])
  assert.deepEqual(parseLineString(undefined), [])
  assert.deepEqual(parseLineString('{"a":1}'), [])
  // Partial garbage: valid points survive, invalid ones vanish.
  assert.deepEqual(parseLineString('[[51.52,-0.13],["x",1],[999,0],[51.53]]'), [[51.52, -0.13]])
})

test('very long lines downsample but keep both endpoints', () => {
  const long = JSON.stringify(Array.from({ length: 2000 }, (_, i) => [51 + i / 10000, -0.1]))
  const pts = parseLineString(long)
  assert.equal(pts.length, 400)
  assert.deepEqual(pts[0], [51, -0.1])
  assert.deepEqual(pts[pts.length - 1], [51.1999, -0.1])
})

test('fitZoom: every route point projects inside the padded viewport at the returned zoom', () => {
  const points = [
    [51.5227, -0.1276],
    [51.55, -0.1],
    [51.53, -0.14],
  ]
  const bounds = routeBounds(points)
  const { zoom, center } = fitZoom(bounds, 640, 240, 28)
  for (const [lat, lng] of points) {
    const o = projectOffset(lat, lng, center, zoom)
    assert.ok(Math.abs(o.x) <= 640 / 2 - 28 + 1, `x ${o.x} escapes at z${zoom}`)
    assert.ok(Math.abs(o.y) <= 240 / 2 - 28 + 1, `y ${o.y} escapes at z${zoom}`)
  }
})

test('a long route fits at a lower zoom than a short one; a single point stays a sane close-up', () => {
  const short = fitZoom(routeBounds([[51.52, -0.13], [51.53, -0.12]]), 640, 240)
  const long = fitZoom(routeBounds([[51.4, -0.3], [51.7, 0.1]]), 640, 240)
  assert.ok(long.zoom < short.zoom)
  const point = fitZoom(routeBounds([[51.52, -0.13]]), 640, 240)
  assert.equal(point.zoom, 17)
  assert.ok(Number.isFinite(point.center.lat))
  // Mercator stays finite even at silly latitudes (clamped).
  assert.ok(Number.isFinite(mercator(90, 0).y))
})

test('itinerary legs carry provider geometry when present, [] when absent or broken — never invented', () => {
  const leg = (path) => ({
    mode: { name: 'tube' },
    duration: 10,
    departureTime: '2026-09-08T08:20:00',
    arrivalTime: '2026-09-08T08:30:00',
    routeOptions: [{ name: 'Victoria' }],
    departurePoint: { commonName: 'A' },
    arrivalPoint: { commonName: 'B' },
    ...(path ? { path } : {}),
  })
  const it = validateItinerary({
    startDateTime: '2026-09-08T08:13:00',
    arrivalDateTime: '2026-09-08T08:46:00',
    duration: 33,
    legs: [
      leg({ lineString: '[[51.52,-0.13],[51.53,-0.12]]' }),
      leg(undefined),
      leg({ lineString: 'broken{' }),
    ],
  })
  assert.equal(it.legs[0].geometry.length, 2)
  assert.deepEqual(it.legs[1].geometry, [])
  assert.deepEqual(it.legs[2].geometry, [])
})
