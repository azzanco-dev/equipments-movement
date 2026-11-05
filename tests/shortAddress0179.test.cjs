const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

// 0179 (owner 2026-11-05, «العنوان الوطني المختصر … 4 حروف و4 ارقام، فابغى
// حقل يكون مقسم»): the optional short national address of suppliers and
// clients, stored as RRRD2929, entered in a split field.

const ROOT = path.join(__dirname, '..')
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8')
const MIGRATIONS = path.join(ROOT, 'supabase', 'migrations')
const files = fs.readdirSync(MIGRATIONS).sort()
const file = files.find((name) => /_0179_/.test(name))
const sql = fs
  .readFileSync(path.join(MIGRATIONS, file), 'utf8')
  .split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n')

const partyFields = (() => {
  const source = path.join(ROOT, 'src', 'lib', 'partyFields.ts')
  const code = ts.transpileModule(fs.readFileSync(source, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText
  const exports = {}
  vm.runInNewContext(code, { exports, require: () => ({}) })
  return exports
})()

test('0179: the column, its CHECK, on both tables, after 0178', () => {
  assert.match(files[files.indexOf(file) - 1], /_0178_/)
  for (const table of ['lessors', 'companies']) {
    assert.match(sql, new RegExp(`ALTER TABLE public\\.${table}\\s+ADD COLUMN IF NOT EXISTS short_address text;`))
    assert.match(
      sql,
      new RegExp(
        `${table}_short_address_check\\s+CHECK \\(short_address IS NULL OR short_address ~ '\\^\\[A-Z\\]\\{4\\}\\[0-9\\]\\{4\\}\\$'\\)`,
      ),
    )
  }
  assert.doesNotMatch(sql, /UNIQUE/)
  assert.doesNotMatch(sql, /\b(CREATE|ALTER|DROP) POLICY\b|\bGRANT\b/)
})

test('0179: both 0175 triggers re-created verbatim plus the normalised short address', () => {
  const old = read('supabase', 'migrations', '20261104130000_0175_party_fields.sql')
  for (const fn of ['normalise_lessor_fields', 'normalise_company_fields']) {
    const body = (text) =>
      new RegExp(`FUNCTION public\\.${fn}\\(\\)[\\s\\S]*?\\$\\$([\\s\\S]*?)\\$\\$`).exec(text)[1]
    const added = '  NEW.short_address :=\n    nullif(upper(regexp_replace(NEW.short_address, \'[\\s-]\', \'\', \'g\')), \'\');\n'
    assert.equal(body(sql), body(old).replace('  RETURN NEW;', added + '  RETURN NEW;'), fn)
    assert.match(sql, new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\(\\)\\s+FROM PUBLIC, anon, authenticated;`))
  }
})

test('the helpers mirror the trigger and split the two parts', () => {
  const { normalizeShortAddress, splitShortAddress, formatShortAddress, SHORT_ADDRESS_PATTERN } =
    partyFields
  assert.equal(normalizeShortAddress(' rrrd-2929 '), 'RRRD2929')
  assert.equal(normalizeShortAddress('abcd ٢٩٢٩'), 'ABCD2929')
  assert.ok(SHORT_ADDRESS_PATTERN.test('RRRD2929'))
  assert.ok(!SHORT_ADDRESS_PATTERN.test('RRR2929'))
  assert.ok(!SHORT_ADDRESS_PATTERN.test('RRRD292'))
  assert.deepEqual({ ...splitShortAddress('rrrd2929') }, { letters: 'RRRD', digits: '2929' })
  assert.deepEqual({ ...splitShortAddress('RR') }, { letters: 'RR', digits: '' })
  assert.deepEqual({ ...splitShortAddress('RRRDX29291') }, { letters: 'RRRD', digits: '2929' })
  assert.equal(formatShortAddress('RRRD2929'), 'RRRD 2929')
})

test('the forms use the split control; lists, details, import and messages carry the field', () => {
  for (const form of ['screens/lessors/LessorFormDialog.tsx', 'screens/companies/CompanyFormDialog.tsx'])
    assert.match(
      read('src', ...form.split('/')),
      /field: 'short_address',\s+label: 'shortAddress',\s+control: 'shortAddress'/,
    )
  const section = read('src', 'components', 'parties', 'PartyFormSection.tsx')
  assert.match(section, /spec\.control === 'shortAddress' \? \(\s+<ShortAddressInput/)
  const input = read('src', 'components', 'parties', 'ShortAddressInput.tsx')
  assert.match(input, /dir="ltr"/)
  assert.match(input, /inputMode="numeric"/)
  assert.match(input, /text-base/) // 16 px on phones: no iOS zoom
  for (const list of ['screens/lessors/LessorsListScreen.tsx', 'screens/companies/CompaniesListScreen.tsx'])
    assert.match(read('src', ...list.split('/')), /address,short_address,city/)
  for (const dialog of ['screens/lessors/LessorDetailsDialog.tsx', 'screens/companies/CompanyDetailsDialog.tsx'])
    assert.match(read('src', ...dialog.split('/')), /formatShortAddress\(/)
  const imports = read('src', 'lib', 'partyImport.ts')
  assert.equal(imports.match(/'short_address',\n/g).length, 2)
  assert.match(read('src', 'lib', 'partyFields.ts'), /`\$\{table\}_short_address_check`/)
  const tr = read('src', 'i18n', 'translations.ts')
  assert.equal(tr.match(/shortAddressFormatInvalid:/g).length, 2)
  assert.doesNotMatch(/shortAddress: '([^']*)'/.exec(tr)[1], /[أإآ]/)
})
