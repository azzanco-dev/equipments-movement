const { test } = require('node:test')
const assert = require('node:assert/strict')
const { loadExtractingModule } = require('./helpers/loadExtracting.cjs')

const {
  normalizeOcrText,
  normalizeOcrDate,
  parseOcrFields,
  ocrErrorForStatus,
  readOcrAnnotation,
  hasOcrData,
} = loadExtractingModule('ocr')

test('maps provider failures to specific codes, never raw status text', () => {
  assert.equal(ocrErrorForStatus(401), 'ocr_auth_failed')
  assert.equal(ocrErrorForStatus(403), 'ocr_auth_failed')
  assert.equal(ocrErrorForStatus(429), 'ocr_rate_limited')
  assert.equal(ocrErrorForStatus(422), 'ocr_image_rejected')
  assert.equal(ocrErrorForStatus(504), 'ocr_timeout')
  assert.equal(ocrErrorForStatus(503), 'ocr_provider_unavailable')
  assert.equal(ocrErrorForStatus(418), 'ocr_failed')
})

test('reads string or object annotations and detects empty results', () => {
  assert.equal(readOcrAnnotation('{"id_number":"1"}').id_number, '1')
  assert.equal(readOcrAnnotation('not json'), null)
  assert.equal(hasOcrData(parseOcrFields(null)), false)
  assert.equal(hasOcrData(parseOcrFields({ nationality: 'اليمن' })), true)
})

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
