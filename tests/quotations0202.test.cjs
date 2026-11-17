const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

// Migration 0202: the quotation number carries a sequence of three digits.
// Owner 2026-11-17, «لاتشيل التاريخ بس خليها 3 خانات الاصفار»: QT- + the
// Saudi YYYYMM + the global sequence padded to at least three digits
// (QT-202611001; it was QT-2026110001). Issued numbers are converted, the
// counter is not touched, and past 999 the sequence keeps all its digits.

const ROOT = path.join(__dirname, '..')
const MIGRATIONS = path.join(ROOT, 'supabase', 'migrations')
const FILE = '20261117140000_0202_quotation_number_three_digits.sql'
const SQL = fs.readFileSync(path.join(MIGRATIONS, FILE), 'utf8')
const CODE = SQL.replace(/--[^\n]*/g, '')

test('0202 comes right after 0201 and needs it', () => {
  const files = fs
    .readdirSync(MIGRATIONS)
    .filter((file) => file.endsWith('.sql'))
    .sort()
  const at = files.indexOf(FILE)
  assert.ok(at > 0)
  assert.equal(
    files[at - 1],
    '20261117120000_0201_quotation_terms_no_title.sql',
  )
  assert.match(CODE, /RAISE EXCEPTION '0202: migration 0201/)
  assert.doesNotMatch(SQL, /[أإآ]/)
})

test('the CHECK accepts nine digits or more after QT-', () => {
  const drop = CODE.indexOf(
    'DROP CONSTRAINT IF EXISTS quotations_number_format',
  )
  const add = CODE.indexOf('ADD CONSTRAINT quotations_number_format')
  assert.ok(drop > 0 && add > drop)
  assert.match(CODE, /CHECK \(quote_number ~ '\^QT-\[0-9\]\{9,\}\$'\);/)
  // The conversion runs between the two, with updated_at left alone.
  const convert = CODE.indexOf("WHERE q.quote_number ~ '^QT-[0-9]{10,}$'")
  const off = CODE.indexOf('DISABLE TRIGGER quotations_updated_at')
  const on = CODE.indexOf('ENABLE TRIGGER quotations_updated_at')
  assert.ok(drop < off && off < convert && convert < on && on < add)
})

test('an issued number keeps its date and sequence, padded to three', () => {
  assert.match(
    CODE,
    /v_seq := \(substr\(r\.quote_number, 10\)::bigint\)::text;\s+v_number := 'QT-'\s+\|\| substr\(r\.quote_number, 4, 6\)\s+\|\| lpad\(v_seq, GREATEST\(3, char_length\(v_seq\)\), '0'\);/,
  )
  // Only a changed number is written, with its event.
  assert.match(CODE, /IF v_number <> r\.quote_number THEN/)
  assert.match(
    CODE,
    /'old_number', r\.quote_number,\s+'new_number', v_number,\s+'reason', 'three_digit_sequence'/,
  )
  // The archive of deleted quotations and the counter are not touched.
  assert.doesNotMatch(CODE, /UPDATE public\.quotation_deletions/)
  assert.doesNotMatch(
    CODE,
    /UPDATE public\.quotation_number_sequence\s+SET last_seq = [0-9]/,
  )
})

test('next_quotation_number pads to three and never cuts a longer one', () => {
  const start = CODE.indexOf(
    'CREATE OR REPLACE FUNCTION public.next_quotation_number()',
  )
  const fn = CODE.slice(start, CODE.indexOf('\n$$;\n', start))
  assert.match(fn, /SECURITY DEFINER\s+SET search_path = public, pg_temp/)
  assert.match(
    fn,
    /SET last_seq = last_seq \+ 1\s+WHERE singleton\s+RETURNING last_seq INTO v_seq;/,
  )
  assert.match(
    fn,
    /RETURN 'QT-'\s+\|\| to_char\(now\(\) AT TIME ZONE 'Asia\/Riyadh', 'YYYYMM'\)\s+\|\| lpad\(v_seq::text, GREATEST\(3, char_length\(v_seq::text\)\), '0'\);/,
  )
  // lpad(text, 3, '0') alone would cut 1000 to 100.
  assert.doesNotMatch(fn, /lpad\(v_seq::text, [0-9]+, '0'\)/)
  assert.match(
    CODE,
    /REVOKE ALL ON FUNCTION public\.next_quotation_number\(\)\s+FROM PUBLIC, anon, authenticated;/,
  )
})

test('the closing guard and the client pattern', () => {
  const guard = CODE.slice(CODE.lastIndexOf('DO $$'))
  assert.match(guard, /q\.quote_number !~ '\^QT-\[0-9\]\{9,\}\$'/)
  assert.match(
    guard,
    /RAISE EXCEPTION '0202: the quotation number % is not in the three-digit shape'/,
  )
  assert.match(
    guard,
    /has_function_privilege\('authenticated', 'public\.next_quotation_number\(\)', 'EXECUTE'\)/,
  )
  // The client mirrors the CHECK.
  const lib = fs.readFileSync(
    path.join(ROOT, 'src', 'lib', 'quotations.ts'),
    'utf8',
  )
  assert.match(
    lib,
    /export const QUOTATION_NUMBER_PATTERN = \/\^QT-\[0-9\]\{9,\}\$\//,
  )
})
