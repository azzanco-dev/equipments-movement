// Migration 0135 (security audit run-1, owner review 2026-10-18): three
// changes, plus the client follow-through.
//
//   1. enforce_movement_sequence clears a workshop_purpose supplied at INSERT
//      by a caller without movements.workshop.classify
//      (em:entry_exit_logs:insert:workshop_purpose, the run's one CONFIRMED
//      finding).
//   2. quick_create_workshop_equipment refuses a code outside
//      `^[A-Z0-9][A-Z0-9 _-]*$` / 30 characters (token invalid_equipment_code,
//      22023) and the table gets the NOT VALID check equipment_code_format_check
//      with the same rule (em:notice-text:equipment-code-from-workshop-quick-create).
//   3. search_workshop_opening_candidates and add_workshop_opening_balance get
//      `SET search_path = public, pg_temp` (hunter hardening note).
//
// Source checks only, like the rest of the suite: the re-created functions
// are compared with their 0127 definitions so that nothing but the documented
// clauses changed, the constraint and comments are pinned, the Zod schemas
// enforce the same code rule (exercised with the real Zod), the database
// tokens are mapped to the code field, and the translation keys exist in
// both languages (new Arabic copy without hamza alif).
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const root = path.join(__dirname, '..')
const read = (...parts) =>
  fs.readFileSync(path.join(root, ...parts), 'utf8').replace(/\r\n/g, '\n')

const MIGRATION = '20261018120000_0135_workshop_purpose_and_code_rules.sql'
const BASE_0127 = '20261011140000_0127_permission_keys_in_policies.sql'
const PREVIOUS = '20261018110000_0134_permission_gap_hardening.sql'

const migrations = fs
  .readdirSync(path.join(root, 'supabase', 'migrations'))
  .filter((file) => file.endsWith('.sql'))
  .sort()
const sql = read('supabase', 'migrations', MIGRATION)
const sql0127 = read('supabase', 'migrations', BASE_0127)

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** SQL without `--` comments, whitespace collapsed: for exact comparisons. */
const norm = (text) =>
  text
    .replace(/--[^\n]*/g, '')
    .replace(/\s+/g, ' ')
    .trim()

/** `CREATE [OR REPLACE] FUNCTION public.<name>(` up to `$$;`. */
function fn(source, name) {
  const match = new RegExp(
    `CREATE (?:OR REPLACE )?FUNCTION public\\.${escape(name)}\\(`,
  ).exec(source)
  assert.ok(match, `missing function ${name}`)
  const end = source.indexOf('$$;', match.index)
  assert.ok(end > match.index, `unterminated function ${name}`)
  return source.slice(match.index, end + 3)
}

const REDEFINED =
  /FUNCTION public\.(?:enforce_movement_sequence|quick_create_workshop_equipment|search_workshop_opening_candidates|add_workshop_opening_balance)\(/

const HAMZA_ALIF = /[أإآ]/

test('0135 is the single 0135 migration, right after 0134', () => {
  const at = migrations.indexOf(MIGRATION)
  assert.ok(at > 0, 'migration 0135 present')
  assert.equal(migrations[at - 1], PREVIOUS)
  assert.equal(migrations.filter((file) => /_0135_/.test(file)).length, 1)
})

test('the 0127 baselines compared below were not redefined before 0135', () => {
  const between = migrations.filter(
    (file) => file > BASE_0127 && file < MIGRATION,
  )
  assert.ok(between.length >= 2, 'at least 0133 and 0134 lie in between')
  for (const file of between) {
    assert.doesNotMatch(
      read('supabase', 'migrations', file),
      REDEFINED,
      `${file} redefines a function 0135 re-creates from 0127`,
    )
    assert.doesNotMatch(
      read('supabase', 'migrations', file),
      /equipment_code_format_check/,
      file,
    )
  }
})

test('every change carries the fingerprint it closes', () => {
  assert.ok(sql.includes('em:entry_exit_logs:insert:workshop_purpose'))
  assert.ok(
    sql.includes('em:notice-text:equipment-code-from-workshop-quick-create'),
  )
  assert.match(sql, /search_path = public, pg_temp/)
})

// ---------------------------------------------------------------------------
// 1. workshop_purpose at INSERT
// ---------------------------------------------------------------------------
const PURPOSE_CLAUSE = norm(`
  IF NEW.workshop_purpose IS NOT NULL
     AND NOT public.has_permission('movements.workshop.classify') THEN
    NEW.workshop_purpose := NULL;
  END IF;`)

test('1: enforce_movement_sequence is 0127 verbatim plus the purpose clause before RETURN NEW', () => {
  const before = norm(fn(sql0127, 'enforce_movement_sequence'))
  const after = norm(fn(sql, 'enforce_movement_sequence'))
  const tail = 'RETURN NEW; END; $$;'
  assert.ok(before.endsWith(tail), 'the 0127 body ends with RETURN NEW')
  assert.equal(before.split('RETURN NEW;').length, 2, 'one RETURN NEW')
  assert.equal(
    after,
    before.slice(0, -tail.length) + `${PURPOSE_CLAUSE} ${tail}`,
  )
  // Still SECURITY DEFINER with the fixed search_path, still not executable.
  assert.match(after, /SECURITY DEFINER SET search_path = public, pg_temp/)
  assert.match(
    norm(sql),
    /REVOKE ALL ON FUNCTION public\.enforce_movement_sequence\(\) FROM PUBLIC, anon, authenticated;/,
  )
})

test('1: the Excel-import GUC branch of the trigger is untouched', () => {
  const after = norm(fn(sql, 'enforce_movement_sequence'))
  assert.ok(
    after.includes(
      norm(`IF current_setting('app.movement_excel_import', true) = 'true'
           AND public.has_permission('movements.import') THEN
          NEW.driver_name := NULLIF(btrim(NEW.driver_name), '');`),
    ),
  )
  // The purpose clause does not depend on the GUC: an import never sets one.
  assert.equal(after.split('app.movement_excel_import').length, 2)
})

test('1: the column comment says the trigger clears the purpose for callers without the classify key', () => {
  // The comment is several adjacent string literals ending in `';` at a line
  // end; the literal text itself contains semicolons.
  const match =
    /COMMENT ON COLUMN public\.entry_exit_logs\.workshop_purpose IS\n([\s\S]*?)';\n/.exec(
      sql,
    )
  assert.ok(match, 'column comment present')
  const comment = norm(match[1].replace(/'\s*'/g, ''))
  assert.ok(comment.includes('Written only by classify_workshop_entry'))
  assert.ok(comment.includes('0135'))
  assert.ok(comment.includes('movements.workshop.classify'))
  assert.ok(/clears/.test(comment))
})

// ---------------------------------------------------------------------------
// 2. the equipment code format
// ---------------------------------------------------------------------------
const CODE_CLAUSE = norm(`
    IF char_length(v_code) > 30 OR v_code !~ '^[A-Z0-9][A-Z0-9 _-]*$' THEN
      RAISE EXCEPTION 'invalid_equipment_code' USING ERRCODE = '22023';
    END IF;`)

test('2: quick_create_workshop_equipment is 0127 verbatim plus the format check after the emptiness check', () => {
  const before = norm(fn(sql0127, 'quick_create_workshop_equipment'))
  const after = norm(fn(sql, 'quick_create_workshop_equipment'))
  const anchor = norm(
    `IF v_code = '' THEN RAISE EXCEPTION 'equipment code required'; END IF;`,
  )
  assert.equal(before.split(anchor).length, 2, 'one emptiness check')
  // A function replacement: the clause contains `$'`, a replace pattern.
  assert.equal(
    after,
    before.replace(anchor, () => `${anchor} ${CODE_CLAUSE}`),
  )
  // The check follows upper(btrim()), so lowercase input passes it.
  assert.ok(
    after.indexOf('v_code := upper(btrim(p_code));') <
      after.indexOf(CODE_CLAUSE),
  )
  assert.match(
    norm(sql),
    /REVOKE ALL ON FUNCTION public\.quick_create_workshop_equipment\(text, text, text\) FROM PUBLIC, anon; GRANT EXECUTE ON FUNCTION public\.quick_create_workshop_equipment\(text, text, text\) TO authenticated;/,
  )
})

test('2: equipment_code_format_check is added NOT VALID with the same rule (both letter cases)', () => {
  const text = norm(sql)
  assert.ok(
    text.includes(
      norm(`ALTER TABLE public.equipment
  DROP CONSTRAINT IF EXISTS equipment_code_format_check;`),
    ),
  )
  assert.ok(
    text.includes(
      norm(`ALTER TABLE public.equipment
  ADD CONSTRAINT equipment_code_format_check
  CHECK (
    char_length(code) <= 30
    AND code ~ '^[A-Za-z0-9][A-Za-z0-9 _-]*$'
  ) NOT VALID;`),
    ),
  )
  assert.match(
    sql,
    /COMMENT ON CONSTRAINT equipment_code_format_check ON public\.equipment IS/,
  )
})

test('2: the SQL rule accepts the production shapes and refuses link or phone text', () => {
  // The table rule, evaluated by JavaScript's regex engine: the same POSIX
  // class syntax, no engine-specific feature.
  const sqlRule = /^[A-Za-z0-9][A-Za-z0-9 _-]*$/
  const ok = (code) => code.length <= 30 && sqlRule.test(code)
  for (const code of ['A055', 'TK-12', 'U001', 'F 7', 'b_3', 'a'.repeat(30)])
    assert.ok(ok(code), code)
  for (const code of [
    '',
    ' A1',
    '-A1',
    'PAY.EXAMPLE/AZZANCO 0550000000',
    'A+1',
    'A1\n',
    'A' + '1'.repeat(30),
    'أ1',
  ])
    assert.ok(!ok(code), JSON.stringify(code))
})

test('2: the other code writers keep btrim and remain unchanged by 0135', () => {
  // update_equipment_from_excel (0134) and admin_change_equipment_code (0127)
  // store the code as typed; the check accepts both cases so neither has to
  // be re-created here.
  assert.doesNotMatch(
    sql,
    /FUNCTION public\.(?:update_equipment_from_excel|admin_change_equipment_code)\(/,
  )
  const excel = fn(
    read('supabase', 'migrations', PREVIOUS),
    'update_equipment_from_excel',
  )
  assert.ok(excel.includes("code = btrim(v_row->>'code')"))
  const admin = fn(sql0127, 'admin_change_equipment_code')
  assert.ok(admin.includes('v_code text := btrim(p_new_code);'))
})

// ---------------------------------------------------------------------------
// 3. search_path hardening
// ---------------------------------------------------------------------------
for (const name of [
  'search_workshop_opening_candidates',
  'add_workshop_opening_balance',
]) {
  test(`3: ${name} is 0127 verbatim with search_path = public, pg_temp`, () => {
    const before = norm(fn(sql0127, name))
    const after = norm(fn(sql, name))
    const oldSet = 'SET search_path = public AS $$'
    assert.equal(before.split(oldSet).length, 2, 'the 0127 SET clause')
    assert.equal(
      after,
      // A function replacement: `$$` is a replace pattern.
      before.replace(oldSet, () => 'SET search_path = public, pg_temp AS $$'),
    )
  })
}

test('3: the two functions keep their REVOKE and GRANT lines', () => {
  const text = norm(sql)
  for (const sig of [
    'search_workshop_opening_candidates(text)',
    'add_workshop_opening_balance(uuid)',
  ]) {
    assert.ok(
      text.includes(`REVOKE ALL ON FUNCTION public.${sig} FROM PUBLIC, anon;`),
    )
    assert.ok(
      text.includes(
        `GRANT EXECUTE ON FUNCTION public.${sig} TO authenticated;`,
      ),
    )
  }
})

// ---------------------------------------------------------------------------
// Client: the Zod rule and the database mapping
// ---------------------------------------------------------------------------
// Loads a src/lib module, resolving its `@/lib/...` imports to the real files
// (the pattern of tests/formValidation.test.cjs). Type-only imports are
// erased by the transpile step.
function loadLibModule(name, cache = new Map()) {
  if (cache.has(name)) return cache.get(name)
  const file = path.join(root, 'src', 'lib', `${name}.ts`)
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
      parseInt,
      require(request) {
        const match = /^@\/lib\/(.+)$/.exec(request)
        if (match) return loadLibModule(match[1], cache)
        if (request === 'zod') return require('zod')
        throw new Error(`Unexpected module: ${request}`)
      },
    },
    { filename: file },
  )
  return exports
}

const plain = (value) => JSON.parse(JSON.stringify(value ?? null))
const v = loadLibModule('formValidation')
const form = loadLibModule('equipmentForm')

const quickForm = (code, overrides = {}) => ({
  plate: '1234 ABC',
  chassis: '',
  identifierType: 'plate',
  code,
  type: '',
  lessorId: '',
  numberingStatus: 'numbered',
  ...overrides,
})
const quickErrors = (code, overrides) =>
  plain(form.validateQuickEquipmentForm(quickForm(code, overrides), true))

test('client: the quick-create schema accepts codes within the rule', () => {
  for (const code of ['A055', ' tk-12 ', 'U001', 'F 7', 'b_3', 'a'.repeat(30)])
    assert.deepEqual(quickErrors(code), {}, code)
})

test('client: the quick-create schema refuses link or phone text and over-long codes', () => {
  for (const code of [
    'PAY.EXAMPLE/AZZANCO 0550000000',
    'A+1',
    '-A1',
    'A' + '1'.repeat(30),
    'أ1',
  ])
    assert.deepEqual(quickErrors(code), { code: 'equipmentCodeInvalid' }, code)
  // A blank code still gets its own message, and the rule never fires on an
  // unnumbered unit (the code is generated) or in the foreman panel.
  assert.deepEqual(quickErrors('   '), { code: 'equipmentCodeRequired' })
  assert.deepEqual(quickErrors('A+1', { numberingStatus: 'unnumbered' }), {})
  assert.equal(
    plain(form.validateQuickEquipmentForm(quickForm('A+1'), false)).code,
    undefined,
  )
})

test('client: the rule constants match the migration', () => {
  assert.equal(v.EQUIPMENT_CODE_MAX_LENGTH, 30)
  assert.equal(
    String(v.EQUIPMENT_CODE_PATTERN),
    '/^[A-Za-z0-9][A-Za-z0-9 _-]*$/',
  )
  assert.ok(v.isValidEquipmentCode('A-1'))
  assert.ok(!v.isValidEquipmentCode(''))
  assert.ok(!v.isValidEquipmentCode('A/1'))
})

test('client: the admin equipment form applies the same rule to the code', () => {
  const errors = (code) =>
    plain(
      v.validateWithSchema(v.equipmentFormSchema, {
        ...plain(form.EMPTY_EQUIPMENT_FORM),
        code,
        type: 'Loader',
        qr_value: 'QR-1',
        status: 'active',
      }),
    )
  assert.equal(errors('A-1').code, undefined)
  assert.equal(errors('A/1').code, 'equipmentCodeInvalid')
  assert.equal(errors('').code, 'equipmentCodeRequired')
})

test('client: the database tokens are mapped to the code field', () => {
  const quick = (error) => plain(form.quickEquipmentSaveFieldErrors(error))
  assert.deepEqual(
    quick({ code: '22023', message: 'invalid_equipment_code' }),
    { code: 'equipmentCodeInvalid' },
  )
  const check = {
    code: '23514',
    message:
      'new row for relation "equipment" violates check constraint "equipment_code_format_check"',
  }
  assert.deepEqual(quick(check), { code: 'equipmentCodeInvalid' })
  assert.deepEqual(plain(form.equipmentSaveFieldErrors(check)), {
    code: 'equipmentCodeInvalid',
  })
  // The older tokens of the RPC still map as before.
  assert.deepEqual(
    quick({ code: 'P0001', message: 'duplicate equipment code' }),
    { code: 'equipmentCodeExists' },
  )
})

test('client: the translation key exists in both languages, plain alif only', () => {
  const translations = read('src', 'i18n', 'translations.ts')
  const matches = [
    ...translations.matchAll(/equipmentCodeInvalid:\s*\n?\s*'([^']+)'/g),
  ]
  assert.equal(matches.length, 2, 'ar and en')
  const [ar, en] = matches.map((match) => match[1])
  assert.ok(/[؀-ۿ]/.test(ar), 'Arabic first')
  assert.doesNotMatch(ar, HAMZA_ALIF)
  assert.ok(ar.includes('30'))
  assert.ok(/letters, digits and dashes/.test(en))
})

test('client: the quick-create form still sends the trimmed code to the RPC', () => {
  const source = read('src', 'components', 'EntryExitForm.tsx')
  assert.ok(source.includes('p_code: quickEquipment.code.trim(),'))
  assert.ok(
    source.includes('validateQuickEquipmentForm(quickEquipment, workshopMode)'),
  )
})
