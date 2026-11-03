const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

// Owner 2026-11-03: «لما اضيف معدة جديدة لمورد, مفروض التسلسل يبدا من اخر
// شي, مش من تحت» → the generated short code «U» + number is one above the
// greatest U-number in the fleet (current and previous codes), never a lower
// free number from a sequence that did not know the codes entered by hand.

const ROOT = path.join(__dirname, '..')
const MIGRATIONS = path.join(ROOT, 'supabase', 'migrations')
const files = fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql'))
const file = files.find((name) => /_0171_/.test(name))
const sql = fs.readFileSync(path.join(MIGRATIONS, file), 'utf8')
const code = sql
  .split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n')

test('0171 is the only 0171 and comes after 0170', () => {
  assert.equal(files.filter((f) => /_0171_/.test(f)).length, 1)
  for (const f of files.filter((f) => /_0170_/.test(f))) assert.ok(file > f)
})

test('the next code is one above the greatest current or previous U-number', () => {
  assert.match(
    code,
    /CREATE OR REPLACE FUNCTION public\.next_short_equipment_code\(\)\s+RETURNS text\s+LANGUAGE plpgsql\s+SECURITY DEFINER\s+SET search_path = public, pg_temp/,
  )
  assert.match(code, /SELECT COALESCE\(MAX\(n\), 0\) \+ 1\s+INTO v_next/)
  // The current codes and BOTH columns of the code history count.
  assert.match(
    code,
    /FROM public\.equipment\s+WHERE upper\(btrim\(code\)\) ~ '\^U\[0-9\]\{1,9\}\$'/,
  )
  assert.match(
    code,
    /FROM public\.equipment_code_changes\s+WHERE upper\(btrim\(old_code\)\) ~ '\^U\[0-9\]\{1,9\}\$'/,
  )
  assert.match(
    code,
    /FROM public\.equipment_code_changes\s+WHERE upper\(btrim\(new_code\)\) ~ '\^U\[0-9\]\{1,9\}\$'/,
  )
  // The candidate still skips a taken current or previous code, counting UP.
  assert.match(code, /v_code := 'U' \|\| lpad\(v_next::text, 3, '0'\)/)
  assert.match(
    code,
    /WHERE upper\(btrim\(old_code\)\) = v_code OR upper\(btrim\(new_code\)\) = v_code/,
  )
  assert.match(code, /v_next := v_next \+ 1;\s+END LOOP;\s+RETURN v_code;/)
  assert.doesNotMatch(code, /nextval/)
})

test('serialised, locked down, and the old sequence is gone', () => {
  assert.match(
    code,
    /PERFORM pg_advisory_xact_lock\(hashtextextended\('next_short_equipment_code', 0\)\)/,
  )
  assert.match(
    code,
    /REVOKE ALL ON FUNCTION public\.next_short_equipment_code\(\) FROM PUBLIC, anon, authenticated;/,
  )
  assert.match(code, /DROP SEQUENCE IF EXISTS public\.equipment_short_code_seq;/)
  // The callers keep calling the same function; no other migration or screen
  // ever used the sequence directly.
  const others = files
    .filter((f) => f !== file && /_00(4[1-9]|[5-9][0-9])_|_01[0-9][0-9]_/.test(f))
    .map((f) => fs.readFileSync(path.join(MIGRATIONS, f), 'utf8'))
    .join('\n')
  assert.doesNotMatch(others, /equipment_short_code_seq/)
})
