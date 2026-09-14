import test from 'node:test'
import assert from 'node:assert/strict'
import { describeRouteUrl, externalRouteUrl } from '../../shared/routeUrl.js'

/** Audit B07 (Pass 78): every external route link names the intended endpoints per mode. */

const home = { lat: 51.5074, lng: -0.1278 }
const school = { lat: 51.53, lng: -0.11 }

test('a planned route carries the selected origin and the destination for each mode', () => {
  for (const mode of ['walking', 'transit', 'driving']) {
    const url = externalRouteUrl({ origin: home, destination: school, mode })
    assert.ok(url.startsWith('https://www.google.com/maps/dir/?api=1&origin=51.5074,-0.1278&destination=51.53,-0.11&travelmode='))
    const d = describeRouteUrl(url)
    assert.deepEqual(d.origin, { lat: 51.5074, lng: -0.1278 })
    assert.deepEqual(d.destination, { lat: 51.53, lng: -0.11 })
    assert.equal(d.mode, mode)
  }
})

test('"from my location" omits the origin so Maps starts from the device; unknown mode falls back to transit', () => {
  const url = externalRouteUrl({ destination: school, mode: 'transit' })
  assert.equal(describeRouteUrl(url).origin, null)
  assert.equal(new URL(url).searchParams.has('origin'), false)
  assert.equal(describeRouteUrl(externalRouteUrl({ origin: null, destination: school, mode: 'cycling' })).mode, 'transit')
})

test('a missing or malformed destination is an error, never a link to nowhere', () => {
  assert.throws(() => externalRouteUrl({ destination: null, mode: 'walking' }))
  assert.throws(() => externalRouteUrl({ destination: { lat: 'x', lng: 1 }, mode: 'walking' }))
})
