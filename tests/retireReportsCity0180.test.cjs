// 0180 retires the reports permission (the report pages were removed on
// 2026-11-07) and 0181 drops the city of suppliers and clients (out of the
// screens since 2026-11-05). Owner 2026-11-07: «3 و 4».
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8')
const migrations = fs.readdirSync(path.join(root, 'supabase', 'migrations')).sort()
const migration = (tag) => {
  const file = migrations.find((name) => name.includes(`_${tag}_`))
  assert.ok(file, tag)
  return read('supabase', 'migrations', file)
}

test('0180 drops the two report functions, then the grants, then the key', () => {
  const sql = migration('0180')
  const summary = sql.indexOf(
    'DROP FUNCTION IF EXISTS public.get_entry_report_summary(timestamptz, timestamptz, text[], text);',
  )
  const attention = sql.indexOf(
    'DROP FUNCTION IF EXISTS public.get_equipment_attention_report(integer, integer, text, text[]);',
  )
  const grants = sql.indexOf(
    "DELETE FROM public.role_permissions\nWHERE permission_key = 'reports.view';",
  )
  const key = sql.indexOf("DELETE FROM public.permissions\nWHERE key = 'reports.view';")
  for (const at of [summary, attention, grants, key]) assert.ok(at > 0)
  assert.ok(summary < grants && attention < grants && grants < key)
  assert.match(sql, /prosrc LIKE '%reports\.view%'/)
  assert.match(sql, /'reports\.view' = ANY \(requires\)/)
})

test('0180: the drops match the latest signatures of the two functions', () => {
  assert.match(
    migration('0158'),
    /GRANT EXECUTE ON FUNCTION\n  public\.get_entry_report_summary\(timestamptz, timestamptz, text\[\], text\)/,
  )
  assert.match(
    migration('0127'),
    /GRANT EXECUTE ON FUNCTION public\.get_equipment_attention_report\(integer, integer, text, text\[\]\) TO authenticated;/,
  )
})

test('no client code calls the report functions or reads reports.view', () => {
  const files = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const rel = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(rel)
      else if (/\.(ts|tsx)$/.test(entry.name)) files.push(rel)
    }
  }
  walk('src')
  walk('app')
  for (const file of files) {
    // The /ui-kit roles mockup keeps its sample catalogue for review.
    if (file.includes('ui-kit')) continue
    const text = fs.readFileSync(path.join(root, file), 'utf8')
    assert.doesNotMatch(text, /get_entry_report_summary|get_equipment_attention_report/, file)
    assert.doesNotMatch(text, /'reports\.view'/, file)
  }
})

test('0181 folds the city into the address, re-creates the triggers, then drops', () => {
  const sql = migration('0181')
  const fold = sql.indexOf('UPDATE public.lessors\nSET address = CASE')
  const foldCompanies = sql.indexOf('UPDATE public.companies\nSET address = CASE')
  const lessorTrigger = sql.indexOf('CREATE OR REPLACE FUNCTION public.normalise_lessor_fields()')
  const companyTrigger = sql.indexOf('CREATE OR REPLACE FUNCTION public.normalise_company_fields()')
  const dropLessors = sql.indexOf('ALTER TABLE public.lessors DROP COLUMN IF EXISTS city;')
  const dropCompanies = sql.indexOf('ALTER TABLE public.companies DROP COLUMN IF EXISTS city;')
  for (const at of [fold, foldCompanies, lessorTrigger, companyTrigger, dropLessors, dropCompanies])
    assert.ok(at > 0)
  assert.ok(fold < lessorTrigger && foldCompanies < lessorTrigger)
  assert.ok(companyTrigger < dropLessors && companyTrigger < dropCompanies)
  // The fold respects the 200-character address CHECK of 0175.
  assert.equal(sql.split("char_length(address || '، ' || city) <= 200").length - 1, 2)
  assert.match(sql, /prosrc LIKE '%NEW\.city%'/)
})

test('0181 triggers are the 0179 bodies minus the city line', () => {
  const body = (sql, name) => {
    const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}()`)
    const open = sql.indexOf('AS $$', start)
    return sql.slice(open, sql.indexOf('$$;', open + 5))
  }
  const before = migration('0179')
  const after = migration('0181')
  for (const name of ['normalise_lessor_fields', 'normalise_company_fields']) {
    assert.equal(
      body(after, name),
      body(before, name).split("  NEW.city := nullif(btrim(NEW.city), '');\n").join(''),
      name,
    )
    assert.doesNotMatch(body(after, name), /city/)
  }
})

test('the screens no longer select, validate, import or save the city', () => {
  for (const file of [
    ['src', 'lib', 'partyFields.ts'],
    ['src', 'lib', 'partyImport.ts'],
    ['src', 'lib', 'lessorForm.ts'],
    ['src', 'lib', 'companyForm.ts'],
    ['src', 'lib', 'types.ts'],
    ['src', 'screens', 'lessors', 'LessorsListScreen.tsx'],
    ['src', 'screens', 'companies', 'CompaniesListScreen.tsx'],
  ])
    assert.doesNotMatch(read(...file), /\bcity\b(?! left with migration 0181)|CITY/, file.join('/'))
  assert.doesNotMatch(read('src', 'lib', 'formValidation.ts'), /PARTY_CITY_MAX|cityTooLong/)
  assert.doesNotMatch(read('src', 'i18n', 'translations.ts'), /^ {4}city(TooLong)?:/m)
})
