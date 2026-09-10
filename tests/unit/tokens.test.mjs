import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * V1 (visual audit §15): every semantic text/background pair must reach the
 * ordinary-text contrast target (4.5:1) in BOTH themes, computed from the
 * actual token values in src/index.css — and the legacy hard-coded pinks and
 * oranges the audit measured (3.45:1) must be gone.
 */

const css = readFileSync(new URL('../../src/index.css', import.meta.url), 'utf8')

function block(selectorStart) {
  const i = css.indexOf(selectorStart)
  assert.ok(i >= 0, `missing ${selectorStart}`)
  const open = css.indexOf('{', i)
  let depth = 0
  for (let j = open; j < css.length; j++) {
    if (css[j] === '{') depth++
    if (css[j] === '}') depth--
    if (depth === 0) return css.slice(open + 1, j)
  }
  throw new Error('unbalanced block')
}
const vars = (text) => Object.fromEntries([...text.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)].map((m) => [m[1], m[2].toLowerCase()]))

const light = vars(block(':root {'))
const dark = { ...light, ...vars(block(":root[data-theme='dark'] {")) }
const darkMedia = { ...light, ...vars(block(":root:not([data-theme='light']) {")) }

function luminance(hex) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}
export function contrast(a, b) {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (l1 + 0.05) / (l2 + 0.05)
}

const PAIRS = [
  ['text', 'bg'],
  ['text', 'surface'],
  ['text-supporting', 'bg'],
  ['text-supporting', 'surface'],
  ['text-muted', 'surface'],
  ['on-accent', 'accent'],
  ['accent', 'accent-soft'],
  ['saved-text', 'saved-bg'],
  ['attention-text', 'attention-bg'],
  ['error-text', 'error-bg'],
  ['development-text', 'development-bg'],
  ['info-text', 'info-bg'],
  ['error-text', 'bg'],
  ['attention-text', 'bg'],
  ['saved-text', 'bg'],
]

for (const [name, theme] of [['light', light], ['dark (data-theme)', dark], ['dark (prefers)', darkMedia]]) {
  test(`${name}: every semantic text/background pair reaches 4.5:1`, () => {
    for (const [fg, bg] of PAIRS) {
      assert.ok(theme[fg] && theme[bg], `${name}: missing token ${fg}/${bg}`)
      const ratio = contrast(theme[fg], theme[bg])
      assert.ok(ratio >= 4.5, `${name}: --${fg} ${theme[fg]} on --${bg} ${theme[bg]} = ${ratio.toFixed(2)}:1`)
    }
  })
}

test('the dark themes declare the same semantic tokens as light', () => {
  for (const key of Object.keys(light)) {
    if (key === 'shadow') continue
    assert.ok(dark[key], `dark missing --${key}`)
  }
  assert.deepEqual(vars(block(":root[data-theme='dark'] {")), vars(block(":root:not([data-theme='light']) {")))
})

test('legacy hard-coded status colours are gone from the stylesheet', () => {
  for (const hex of ['#e64980', '#f08c00', '#e8590c', '#c2255c', '#b02a37', '#37b24d', '#0ca678', '#4ad3a5', '#0a7a58']) {
    assert.ok(!css.toLowerCase().includes(hex), `${hex} still present`)
  }
  assert.ok(!css.includes('rgba(230, 73, 128'), 'legacy pink rgba still present')
  assert.ok(css.includes('--control-min: 44px'))
})
