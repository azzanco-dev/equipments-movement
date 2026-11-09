const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

// Owner 2026-11-09 («خلي النقطة الخضراء حق واتساب انيماتد وهج»): the connected
// dot of the WhatsApp gateway card glows; tokens only, still under reduced
// motion; the other states keep their static dot.
const read = (...parts) =>
  fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8')

test('the connected dot carries the glow class, the others do not', () => {
  const component = read('src', 'components', 'WhatsAppGatewayStatus.tsx')
  assert.match(component, /tone === 'ok' &&\s*'wa-dot-live bg-success/)
  assert.equal((component.match(/wa-dot-live/g) ?? []).length, 1)
})

test('the glow is a token-only keyframe, off under reduced motion', () => {
  const css = read('src', 'index.css')
  const block = css.slice(css.indexOf('@keyframes wa-glow'))
  assert.match(block, /color-mix\(in srgb, var\(--success\)/)
  assert.doesNotMatch(block.slice(0, 900), /#[0-9a-fA-F]{3,6}\b|rgba?\(/)
  assert.match(block, /\.wa-dot-live \{\s*animation: wa-glow/)
  assert.match(
    block,
    /@media \(prefers-reduced-motion: reduce\) \{\s*\.wa-dot-live \{\s*animation: none;/,
  )
})
