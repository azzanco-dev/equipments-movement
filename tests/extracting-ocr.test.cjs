const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

function loadOcrModule() {
  const file = path.join(__dirname, '..', 'src', 'lib', 'extracting', 'ocr.ts')
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText
  const exports = {}
  vm.runInNewContext(code, { exports }, { filename: file })
  return exports
}

const { normalizeOcrText, normalizeOcrDate, parseOcrFields } = loadOcrModule()

test('normalizes Arabic and Persian digits', () => {
  assert.equal(normalizeOcrText('  ١٢۳  '), '123')
})

test('normalizes dates without guessing missing values', () => {
  assert.equal(normalizeOcrDate('٢٠٢٦/٧/٣١'), '31-07-2026')
  assert.equal(normalizeOcrDate('31.7.2026'), '31-07-2026')
  assert.equal(normalizeOcrDate(''), '')
})

test('returns the complete extraction shape and empty missing fields', () => {
  const result = parseOcrFields({
    full_name_ar: '  اسم تجريبي  ',
    id_number: '٢٥٥٤٣٩٨٧٣٣',
  })
  assert.equal(result.full_name_ar, 'اسم تجريبي')
  assert.equal(result.id_number, '2554398733')
  assert.equal(result.full_name_en, '')
  assert.equal(result.occupation, '')
  assert.ok(!('employer_name' in result))
})
