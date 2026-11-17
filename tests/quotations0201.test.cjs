const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

// Migration 0201: quotation terms without a title. Owner 2026-11-17, «شيل
// العنوان العربي والانجليزي في الشروط»: a term of the template and its copy
// on a quotation keep one text in Arabic and one in English. title_ar and
// title_en are dropped from quotation_term_templates and quotation_terms,
// the template trigger trims the two texts only, and save_quotation,
// delete_quotation and copy_quotation are 0200's bodies without the two
// columns. 0199 and 0200 stay as they were written.

const ROOT = path.join(__dirname, '..')
const MIGRATIONS = path.join(ROOT, 'supabase', 'migrations')
const read = (file) => fs.readFileSync(path.join(MIGRATIONS, file), 'utf8')
const SQL = read('20261117120000_0201_quotation_terms_no_title.sql')
const SQL_0200 = read('20261117100000_0200_quotations_no_lifecycle.sql')
/** A migration without its `--` comments. */
const codeOf = (sql) => sql.replace(/--[^\n]*/g, '')
const CODE = codeOf(SQL)
const HAMZA_ALIF = /[أإآ]/

/** One function of a migration: CREATE … up to its closing `$$;`. */
function fn(sql, name) {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`)
  assert.ok(start >= 0, `${name} is in the migration`)
  return sql.slice(start, sql.indexOf('\n$$;\n', start) + 5)
}

test('0201 comes right after 0200 and is the newest quotation migration', () => {
  const files = fs
    .readdirSync(MIGRATIONS)
    .filter((file) => file.endsWith('.sql'))
    .sort()
  const at = files.indexOf('20261117120000_0201_quotation_terms_no_title.sql')
  assert.ok(at > 0)
  assert.equal(files[at - 1], '20261117100000_0200_quotations_no_lifecycle.sql')
  // It refuses to run without 0200.
  assert.match(
    CODE,
    /to_regclass\('public\.quotation_deletions'\) IS NULL[\s\S]*?RAISE EXCEPTION '0201: migration 0200/,
  )
  assert.doesNotMatch(SQL, HAMZA_ALIF)
})

test('a stored title is folded into its text before the columns go', () => {
  const fold = CODE.indexOf('UPDATE public.quotation_term_templates t')
  const foldCopies = CODE.indexOf('UPDATE public.quotation_terms t')
  const drop = CODE.indexOf('DROP COLUMN title_ar')
  assert.ok(fold > 0 && foldCopies > fold && drop > foldCopies)
  // The title becomes the first line while the text still fits 1000.
  assert.equal(
    (
      CODE.match(
        /WHEN char_length\(btrim\(t\.title_(ar|en)\) \|\| E'\\n' \|\| btrim\(t\.body_\1\)\) <= 1000\s+THEN btrim\(t\.title_\1\) \|\| E'\\n' \|\| btrim\(t\.body_\1\)\s+ELSE t\.body_\1/g,
      ) ?? []
    ).length,
    4,
  )
  // updated_at does not move: both triggers are off around the fold.
  for (const [table, trigger] of [
    ['quotation_term_templates', 'quotation_term_templates_updated_at'],
    ['quotation_terms', 'quotation_terms_updated_at'],
  ]) {
    const off = CODE.indexOf(
      `ALTER TABLE public.${table} DISABLE TRIGGER ${trigger};`,
    )
    const on = CODE.indexOf(
      `ALTER TABLE public.${table} ENABLE TRIGGER ${trigger};`,
    )
    assert.ok(off > 0 && off < fold && on > foldCopies && on < drop, table)
  }
})

test('the two title columns are dropped from both tables', () => {
  for (const table of ['quotation_term_templates', 'quotation_terms'])
    assert.match(
      CODE,
      new RegExp(
        `ALTER TABLE public\\.${table}\\s+DROP COLUMN title_ar,\\s+DROP COLUMN title_en;`,
      ),
    )
  // Nothing else of the tables changes.
  assert.doesNotMatch(CODE, /DROP COLUMN (?!title_(ar|en)\b)/)
  assert.doesNotMatch(CODE, /DROP TABLE|DROP POLICY|CREATE POLICY|ADD COLUMN/)
})

test('the template trigger trims the two texts only', () => {
  const trigger = fn(SQL, 'normalise_quotation_term_template')
  assert.match(trigger, /SECURITY DEFINER\s+SET search_path = public, pg_temp/)
  assert.match(trigger, /NEW\.body_ar := btrim\(NEW\.body_ar\);/)
  assert.match(trigger, /NEW\.body_en := btrim\(NEW\.body_en\);/)
  assert.doesNotMatch(trigger, /title/)
  // The rest of 0199's body: the position and the author.
  assert.match(trigger, /COALESCE\(max\(t\.position\), 0\) \+ 1 INTO NEW\.position/)
  assert.match(trigger, /NEW\.created_by := auth\.uid\(\);/)
  assert.match(trigger, /NEW\.created_by := OLD\.created_by;/)
  assert.match(
    CODE,
    /REVOKE ALL ON FUNCTION public\.normalise_quotation_term_template\(\)\s+FROM PUBLIC, anon, authenticated;/,
  )
})

test('the three functions are the 0200 bodies without the titles', () => {
  const without = (text) =>
    text
      .replace(/ title_ar, title_en,/g, '')
      .replace(/ t\.title_ar, t\.title_en,/g, '')
      .replace(/\s+'title_ar', t\.title_ar,\s+'title_en', t\.title_en,/, '')
  for (const name of ['save_quotation', 'delete_quotation', 'copy_quotation']) {
    const now = fn(SQL, name)
    const before = fn(SQL_0200, name)
    assert.match(before, /title_ar/, `${name} read the title in 0200`)
    assert.doesNotMatch(now, /title_(ar|en)/, name)
    assert.equal(now, without(before), name)
  }
  // The same signatures, so the grants and comments of 0200 stay.
  assert.doesNotMatch(CODE, /DROP FUNCTION/)
  assert.doesNotMatch(CODE, /GRANT EXECUTE/)
})

test('the closing guard: no title column, no function reading one', () => {
  const guard = CODE.slice(CODE.lastIndexOf('DO $$'))
  assert.match(guard, /a\.attname IN \('title_ar', 'title_en'\)/)
  assert.match(guard, /RAISE EXCEPTION '0201: the column % still exists'/)
  assert.match(guard, /p\.prosrc ~ '\\m\(title_ar\|title_en\)\\M'/)
  for (const name of [
    'normalise_quotation_term_template',
    'save_quotation',
    'delete_quotation',
    'copy_quotation',
  ])
    assert.match(guard, new RegExp(`'${name}'`))
  assert.match(guard, /has_function_privilege\('anon', v_fn, 'EXECUTE'\)/)
  assert.match(SQL.trimEnd(), /NOTIFY pgrst, 'reload schema';$/)
})
