const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

// Migration 0215 (owner 2026-11-26: «ابغاك تخليها 3 ارقام مش 4 وغير الي
// موجود حاليا»): INS- + a sequence of at least three digits, the existing
// numbers converted.

const ROOT = path.join(__dirname, '..')
const SQL = fs.readFileSync(
  path.join(ROOT, 'supabase', 'migrations', '20261126110000_0215_installment_number_three_digits.sql'),
  'utf8',
)
const CODE = SQL.replace(/--[^\n]*/g, '')

test('0215: the CHECK takes three digits or more', () => {
  assert.match(CODE, /DROP CONSTRAINT IF EXISTS installment_contracts_number_format/)
  assert.match(CODE, /CHECK \(contract_number ~ '\^INS-\[0-9\]\{3,\}\$'\)/)
})

test('0215: the existing numbers are converted without moving updated_at', () => {
  const disable = CODE.indexOf('DISABLE TRIGGER installment_contracts_updated_at')
  const update = CODE.indexOf('UPDATE public.installment_contracts')
  const enable = CODE.indexOf('ENABLE TRIGGER installment_contracts_updated_at')
  assert.ok(disable > 0 && disable < update && update < enable)
  assert.match(CODE, /lpad\(v_seq, GREATEST\(3, char_length\(v_seq\)\), '0'\)/)
})

test('0215: the next number pads to three digits and never cuts a longer one', () => {
  assert.match(
    CODE,
    /RETURN 'INS-' \|\| lpad\(v_seq::text, GREATEST\(3, char_length\(v_seq::text\)\), '0'\);/,
  )
  assert.match(
    CODE.replace(/\s+/g, ' '),
    /REVOKE ALL ON FUNCTION public\.next_installment_contract_number\(\) FROM PUBLIC, anon, authenticated;/,
  )
  // The counter is not touched.
  assert.doesNotMatch(CODE, /UPDATE public\.installment_contract_sequence\s+SET last_seq = (?!last_seq \+ 1)/)
})

test('the client pattern mirrors the CHECK', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src', 'lib', 'installments.ts'), 'utf8')
  assert.match(src, /INSTALLMENT_CONTRACT_NUMBER_PATTERN = \/\^INS-\[0-9\]\{3,\}\$\//)
  const re = /^INS-[0-9]{3,}$/
  for (const ok of ['INS-001', 'INS-028', 'INS-1000']) assert.ok(re.test(ok), ok)
  for (const bad of ['INS-01', 'INS260001', 'ins-001']) assert.ok(!re.test(bad), bad)
})
