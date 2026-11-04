const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

// EM-260 (owner 2026-11-03 / 2026-11-04, «اضافة حقول اضافية للموردين
// والعملاء مثل الرقم الضريبي والسجل التجاري وغيره», then «البنك والايبان»)
// → 0175: optional official, contact and (suppliers only) bank columns on
// `lessors` and `companies`, normalised by a trigger, the two numbers unique
// per table when set. Static checks only: no database is reached.

const ROOT = path.join(__dirname, '..')
const MIGRATIONS = path.join(ROOT, 'supabase', 'migrations')
const files = fs.readdirSync(MIGRATIONS).sort()
const file = files.find((name) => /_0175_/.test(name))
const sql = fs.readFileSync(path.join(MIGRATIONS, file), 'utf8')
const code = sql
  .split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n')

test('0175 is the only 0175 and comes right after 0174', () => {
  assert.equal(files.filter((name) => /_0175_/.test(name)).length, 1)
  const at = files.indexOf(file)
  assert.match(files[at - 1], /_0174_/)
  assert.equal(file, '20261104130000_0175_party_fields.sql')
})

const COLUMNS = {
  lessors: [
    'tax_number',
    'commercial_register',
    'address',
    'city',
    'email',
    'bank_name',
    'iban',
  ],
  companies: [
    'tax_number',
    'commercial_register',
    'address',
    'city',
    'email',
    'contact_person',
    'contact_number',
  ],
}

test('the optional columns of each table, every one nullable text', () => {
  for (const [table, columns] of Object.entries(COLUMNS)) {
    const added = [
      ...code.matchAll(
        new RegExp(`ALTER TABLE public\\.${table}\\s+((?:ADD COLUMN[^;]*?)+);`, 'g'),
      ),
    ]
      .flatMap((match) => [
        ...match[1].matchAll(/ADD COLUMN IF NOT EXISTS (\w+) ([^,;\n]+)/g),
      ])
      .map((match) => {
        // Plain `text`: no NOT NULL, no default.
        assert.equal(match[2].trim(), 'text', `${table}.${match[1]} is nullable text`)
        return match[1]
      })
    assert.deepEqual(added, columns, table)
  }
  // The client contact fields are the companies' only; the bank, the
  // suppliers' only.
  assert.doesNotMatch(code, /public\.companies\s+ADD COLUMN[^;]*\b(iban|bank_name)\b/)
})

test('the CHECKs: the 15-digit tax number, the CR, the lengths, the email, the IBAN', () => {
  for (const table of ['lessors', 'companies']) {
    assert.match(
      code,
      new RegExp(
        `${table}_tax_number_check\\s+CHECK \\(tax_number IS NULL OR tax_number ~ '\\^\\[0-9\\]\\{15\\}\\$'\\)`,
      ),
    )
    assert.match(
      code,
      new RegExp(
        `${table}_commercial_register_check\\s+CHECK \\(commercial_register IS NULL OR commercial_register ~ '\\^\\[0-9\\]\\{4,20\\}\\$'\\)`,
      ),
    )
    assert.match(code, new RegExp(`${table}_address_check[\\s\\S]*?BETWEEN 1 AND 200`))
    assert.match(code, new RegExp(`${table}_city_check[\\s\\S]*?BETWEEN 1 AND 60`))
    assert.match(code, new RegExp(`${table}_email_check[\\s\\S]*?char_length\\(email\\) <= 120`))
  }
  assert.match(code, /companies_contact_person_check[\s\S]*?BETWEEN 1 AND 120/)
  assert.match(code, /companies_contact_number_check[\s\S]*?BETWEEN 1 AND 30/)
  assert.match(code, /lessors_bank_name_check[\s\S]*?BETWEEN 1 AND 100/)
  // A Saudi IBAN is 24 characters: SA, 2 check digits, 2 bank digits, 18.
  assert.match(code, /lessors_iban_check\s+CHECK \(iban IS NULL OR iban ~ '\^SA\[0-9\]\{4\}\[0-9A-Z\]\{18\}\$'\)/)
})

test('the two numbers are unique per table only when set', () => {
  for (const table of ['lessors', 'companies'])
    for (const column of ['tax_number', 'commercial_register'])
      assert.match(
        code,
        new RegExp(
          `CREATE UNIQUE INDEX IF NOT EXISTS ${table}_${column}_unique\\s+ON public\\.${table} \\(${column}\\)\\s+WHERE ${column} IS NOT NULL;`,
        ),
      )
})

test('one normalising trigger per table, BEFORE INSERT OR UPDATE, not callable', () => {
  for (const [table, fn] of [
    ['lessors', 'normalise_lessor_fields'],
    ['companies', 'normalise_company_fields'],
  ]) {
    assert.match(
      code,
      new RegExp(
        `DROP TRIGGER IF EXISTS ${fn} ON public\\.${table};\\s+CREATE TRIGGER ${fn}\\s+BEFORE INSERT OR UPDATE ON public\\.${table}\\s+FOR EACH ROW EXECUTE FUNCTION public\\.${fn}\\(\\);`,
      ),
    )
    assert.match(
      code,
      new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\(\\)\\s+FROM PUBLIC, anon, authenticated;`),
    )
    const body = new RegExp(`FUNCTION public\\.${fn}\\(\\)[\\s\\S]*?\\$\\$([\\s\\S]*?)\\$\\$`).exec(code)[1]
    assert.match(body, /NEW\.tax_number := nullif\(regexp_replace\(NEW\.tax_number, '\[\\s-\]', '', 'g'\), ''\)/)
    assert.match(body, /NEW\.email := nullif\(lower\(btrim\(NEW\.email\)\), ''\)/)
    // Every new column is normalised and nothing else is written.
    const written = [...body.matchAll(/NEW\.(\w+) :=/g)].map((m) => m[1]).sort()
    assert.deepEqual(written, [...COLUMNS[table]].sort(), table)
  }
  assert.match(code, /NEW\.iban := nullif\(upper\(regexp_replace\(NEW\.iban, '\[\\s-\]', '', 'g'\)\), ''\)/)
  assert.match(code, /SET search_path = public, pg_temp/)
})

test('no policy, grant, view or other function changes; lessor_contacts untouched', () => {
  assert.doesNotMatch(code, /\b(CREATE|ALTER|DROP) POLICY\b/i)
  assert.doesNotMatch(code, /\bGRANT\b/i)
  assert.doesNotMatch(code, /\bCREATE (OR REPLACE )?VIEW\b/i)
  assert.doesNotMatch(code, /lessor_contacts/)
  assert.doesNotMatch(code, /ROW LEVEL SECURITY/i)
  const functions = [...code.matchAll(/CREATE (?:OR REPLACE )?FUNCTION ([\w.]+)/g)].map(
    (match) => match[1],
  )
  assert.deepEqual(functions, [
    'public.normalise_lessor_fields',
    'public.normalise_company_fields',
  ])
})
