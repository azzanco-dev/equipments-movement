// The WhatsApp gateway card at the foot of the sidebar (owner 2026-11-08,
// «بوابة الواتس اضف عبارة تحتها ultramsg، وكبر الارتفاع وخليه gradient
// noisy»): taller, «ultramsg» under the name, the state's tone as a grained
// diagonal wash, tokens only. Owner 2026-11-09: after a dark glowing card
// («ماعجبني») and three looks compared on /ui-kit, «ج» — one soft colour of
// the state with a fine grain, no arc, no gradient, theme text.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const read = (...parts) =>
  fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8')
const component = read('src', 'components', 'WhatsAppGatewayStatus.tsx')
const css = read('src', 'index.css')
const block = css.slice(css.indexOf('.wa-gateway-card {'))

test('taller, with the provider under the name', () => {
  assert.match(component, /const GATEWAY_PROVIDER = 'ultramsg'/)
  assert.match(component, /\{GATEWAY_PROVIDER\}/)
  assert.match(component, /data-tone=\{tone\}/)
  assert.match(component, /'wa-gateway-card flex min-h-14 w-full/)
})

test('one soft colour of the state under a fine grain, tokens only', () => {
  assert.match(
    block,
    /background-color: color-mix\(in srgb, var\(--wa-strong\) 14%, var\(--surface\)\)/,
  )
  assert.doesNotMatch(block, /gradient\(/)
  assert.match(block, /color: var\(--fg\);/)
  assert.match(block, /mix-blend-mode: multiply/)
  // The look chosen; the compared ones are gone.
  assert.doesNotMatch(css, /wa-look-/)
  // The text and the dot take their colour from the card.
  assert.match(component, /className="wa-gateway-dot /)
  assert.match(component, /className="wa-gateway-state /)
  assert.doesNotMatch(
    component,
    /text-success|text-danger|bg-success|bg-danger/,
  )
  for (const tone of ['ok', 'down'])
    assert.ok(block.includes(`.wa-gateway-card[data-tone='${tone}'] {`), tone)
  assert.match(block, /--wa-strong: var\(--success\)/)
  assert.match(block, /--wa-strong: var\(--danger\)/)
  assert.match(block, /\.wa-gateway-card::before \{[\s\S]*feTurbulence/)
  assert.match(block, /pointer-events: none/)
  // No palette value outside the noise SVG (its only `#` is the filter ref).
  const withoutSvg = block.replace(/url\("data:image\/svg\+xml[^"]*"\)/g, '')
  assert.doesNotMatch(withoutSvg, /#[0-9a-fA-F]{3,8}\b|rgba?\(/)
})
