const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

// Loads src/lib/plate.ts (no imports of its own) so the plate parsing used by
// the equipment list, equipment selectors, and PlateNumberInput is exercised
// exactly as written, without a bundler.
function loadPlate() {
  const file = path.join(__dirname, '..', 'src', 'lib', 'plate.ts')
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText
  const exports = {}
  vm.runInNewContext(code, { exports }, { filename: file })
  return exports
}

const {
  extractPlateSearchParts,
  normalizePlateNumber,
  plateDigitsSearchTerm,
  toLatinDigits,
} = loadPlate()

// Parts come back from a separate vm context, so compare fields individually
// rather than with assert.deepEqual (cross-realm plain objects are not
// reference-equal to Object.prototype in this realm).
function assertParts(actual, digits, letters) {
  assert.equal(actual.digits, digits)
  assert.equal(actual.letters, letters)
}

test('a Latin plate typed with or without a separator resolves to the same parts', () => {
  assertParts(extractPlateSearchParts('ABJ-1234'), '1234', 'ABJ')
  assertParts(extractPlateSearchParts('ABJ1234'), '1234', 'ABJ')
  assertParts(extractPlateSearchParts('abj 1234'), '1234', 'ABJ')
})

test('an Arabic-Indic digit query converts to ASCII digits', () => {
  assertParts(extractPlateSearchParts('١٢٣٤'), '1234', '')
})

test('Arabic plate letters are visually reversed to the stored Latin order', () => {
  // ا ب ح -> A, B, J in reading order, reversed to J, B, A as printed on the
  // physical plate / stored in plate_letters_en.
  assertParts(extractPlateSearchParts('ا ب ح'), '', 'JBA')
  assertParts(extractPlateSearchParts('١٢٣٤ ا ب ح'), '1234', 'JBA')
})

test('mixed Arabic and Latin letters are not reversed', () => {
  // A search term is treated as already in Latin reading order once it
  // contains any Latin letter, matching PlateNumberInput's own rule.
  assertParts(extractPlateSearchParts('A ب ح 1234'), '1234', 'ABJ')
})

test('digits-only and letters-only terms leave the other part empty', () => {
  assertParts(extractPlateSearchParts('4821'), '4821', '')
  assertParts(extractPlateSearchParts('ABJ'), '', 'ABJ')
  assertParts(extractPlateSearchParts(''), '', '')
})

test('normalizePlateNumber still formats digits-letters from the same parts', () => {
  assert.equal(normalizePlateNumber('ABJ-1234'), '1234-ABJ')
  assert.equal(normalizePlateNumber('ا ب ح ١٢٣٤'), '1234-JBA')
  assert.equal(normalizePlateNumber('1234'), '1234')
  assert.equal(normalizePlateNumber('ABJ'), 'ABJ')
  assert.equal(normalizePlateNumber(''), '')
})

test('search terms only probe plate digits when they are digits only', () => {
  assert.equal(plateDigitsSearchTerm('341'), '341')
  assert.equal(plateDigitsSearchTerm('٣٤١'), '341')
  assert.equal(plateDigitsSearchTerm('12-34'), '1234')
  // A code such as a341 is plain text: no plate probing at all.
  assert.equal(plateDigitsSearchTerm('a341'), null)
  assert.equal(plateDigitsSearchTerm('حفار'), null)
  assert.equal(plateDigitsSearchTerm(''), null)
})

test('toLatinDigits converts digits and leaves letters untouched', () => {
  assert.equal(toLatinDigits('A٣٤١'), 'A341')
  assert.equal(toLatinDigits('حفار 12'), 'حفار 12')
})
