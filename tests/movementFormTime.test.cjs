const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

// Loads a src/lib module, resolving its `@/lib/...` imports and its own
// relative `./...` imports to the real files (movementFormTime.ts imports
// `saudiDateKey` from `./saudiTime`).
function loadLibModule(name, cache = new Map()) {
  if (cache.has(name)) return cache.get(name)
  const file = path.join(__dirname, '..', 'src', 'lib', `${name}.ts`)
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText
  const exports = {}
  cache.set(name, exports)
  vm.runInNewContext(
    code,
    {
      exports,
      Date,
      Math,
      Number,
      require(request) {
        const match =
          /^@\/lib\/(.+)$/.exec(request) ?? /^\.\/(.+)$/.exec(request)
        if (match) return loadLibModule(match[1], cache)
        throw new Error(`Unexpected module: ${request}`)
      },
    },
    { filename: file },
  )
  return exports
}

const { resolveMovementInstant } = loadLibModule('movementFormTime')

// Same Saudi day as `2026-09-15` covers most of that calendar day in UTC+03:00
// (00:00 to 23:59 Saudi time is 2026-09-14T21:00Z to 2026-09-15T20:59:59Z).

test('no prior movement: the normal picked-day + current-time instant is unchanged', () => {
  const now = new Date(2026, 8, 15, 10, 0, 0)
  const instant = resolveMovementInstant('2026-09-15', now, null)
  assert.equal(instant.getTime(), new Date(2026, 8, 15, 10, 0, 0).getTime())
})

test('same Saudi day, naive instant already after the last movement: unchanged', () => {
  const now = new Date(2026, 8, 15, 15, 0, 0)
  const lastRecordedAt = new Date(2026, 8, 15, 9, 0, 0).toISOString()
  const instant = resolveMovementInstant('2026-09-15', now, lastRecordedAt)
  assert.equal(instant.getTime(), new Date(2026, 8, 15, 15, 0, 0).getTime())
})

test('same Saudi day, naive instant before the last movement: bumped to +60s', () => {
  // Exit recorded yesterday evening; entry keyed in this morning but dated
  // yesterday, so the naive instant (today's wall clock time on yesterday's
  // date) lands before the exit.
  const now = new Date(2026, 8, 16, 10, 0, 0)
  const lastRecordedAt = new Date(2026, 8, 15, 15, 0, 0).toISOString()
  const instant = resolveMovementInstant('2026-09-15', now, lastRecordedAt)
  assert.equal(
    instant.getTime(),
    new Date(2026, 8, 15, 15, 0, 0).getTime() + 60_000,
  )
})

test('bumping by 60s would exceed `now`: returns `now` instead', () => {
  const lastRecordedAt = new Date(2026, 8, 15, 9, 59, 30).toISOString()
  const now = new Date(2026, 8, 15, 10, 0, 0)
  const instant = resolveMovementInstant('2026-09-15', now, lastRecordedAt)
  assert.equal(instant.getTime(), now.getTime())
})

test('bumped instant would still not be after the last movement: returns `now`', () => {
  // `now` itself is not after the last movement (clock skew / same instant);
  // there is no valid instant strictly after it, so `now` is the fallback.
  const lastRecordedAt = new Date(2026, 8, 15, 10, 0, 0).toISOString()
  const now = new Date(2026, 8, 15, 10, 0, 0)
  const instant = resolveMovementInstant('2026-09-15', now, lastRecordedAt)
  assert.equal(instant.getTime(), now.getTime())
})

test('different day: the last movement does not affect the picked day', () => {
  const now = new Date(2026, 8, 16, 10, 0, 0)
  const lastRecordedAt = new Date(2026, 8, 14, 15, 0, 0).toISOString()
  const instant = resolveMovementInstant('2026-09-16', now, lastRecordedAt)
  assert.equal(instant.getTime(), new Date(2026, 8, 16, 10, 0, 0).getTime())
})

test('null last movement behaves like no prior movement', () => {
  const now = new Date(2026, 8, 16, 10, 0, 0)
  const instant = resolveMovementInstant('2026-09-16', now, null)
  assert.equal(instant.getTime(), new Date(2026, 8, 16, 10, 0, 0).getTime())
})

test('undefined last movement behaves like no prior movement', () => {
  const now = new Date(2026, 8, 16, 10, 0, 0)
  const instant = resolveMovementInstant('2026-09-16', now)
  assert.equal(instant.getTime(), new Date(2026, 8, 16, 10, 0, 0).getTime())
})
