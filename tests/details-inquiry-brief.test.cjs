const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

// Loads a src/lib module, resolving its `@/lib/...` imports to the real files.
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
      require(request) {
        const match = /^@\/lib\/(.+)$/.exec(request)
        if (match) return loadLibModule(match[1], cache)
        throw new Error(`Unexpected module: ${request}`)
      },
    },
    { filename: file },
  )
  return exports
}

const { inquiryBriefIdentifier } = loadLibModule('equipmentInquiry')
const plain = (value) => JSON.parse(JSON.stringify(value))

test('the brief shows the plate when the equipment has one', () => {
  assert.deepEqual(
    plain(
      inquiryBriefIdentifier({
        plate_number: '1234 ABC',
        chassis_number: 'JH4KA8260MC012345',
      }),
    ),
    { kind: 'plate', value: '1234 ABC' },
  )
})

test('the brief falls back to the chassis number without a plate', () => {
  assert.deepEqual(
    plain(
      inquiryBriefIdentifier({
        plate_number: '  ',
        chassis_number: 'JH4KA8260MC012345',
      }),
    ),
    { kind: 'chassis', value: 'JH4KA8260MC012345' },
  )
})

test('with neither, the plate row stays with an empty value', () => {
  assert.deepEqual(
    plain(inquiryBriefIdentifier({ plate_number: null, chassis_number: null })),
    { kind: 'plate', value: null },
  )
})
