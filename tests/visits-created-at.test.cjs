const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

// Owner request 2026-10-28: «في الزيارات، اضف عمود اخر شي "الانشاء" ويكون بنفس
// نمط مدة الزيارة». Migration 0159 appends the ENTRY's `created_at` to
// `movement_visits` as `entry_created_at`; the visits tables show it as their
// LAST column in the duration's style, and the export lists it last.

const ROOT = path.join(__dirname, '..')
const MIGRATIONS = path.join(ROOT, 'supabase', 'migrations')
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8')
const readMigration = (name) =>
  fs.readFileSync(path.join(MIGRATIONS, name), 'utf8')

const V0132 = readMigration('20261015120000_0132_movement_views_lessor.sql')
const MIGRATION = '20261028150000_0159_visits_entry_created_at.sql'
const V0159 = readMigration(MIGRATION)

/** From `CREATE OR REPLACE VIEW public.movement_visits` to the file's end. */
const visitsTail = (sql) => {
  const start = sql.indexOf('CREATE OR REPLACE VIEW public.movement_visits')
  assert.ok(start >= 0, 'movement_visits is recreated')
  return sql.slice(start)
}

/** Replaces exactly one occurrence, failing when the anchor is missing. */
function replaceOnce(text, from, to) {
  assert.equal(text.split(from).length, 2, `anchor found once: ${from}`)
  return text.replace(from, to)
}

test('0159 is the only 0159 and recreates movement_visits only', () => {
  const files = fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql'))
  assert.equal(files.filter((file) => /_0159_/.test(file)).length, 1)
  assert.ok(files.includes(MIGRATION))
  const code = V0159.split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
  assert.equal(code.match(/CREATE OR REPLACE VIEW/g).length, 1)
  assert.doesNotMatch(code, /CREATE (UNIQUE )?INDEX|\bFUNCTION\b/)
  assert.doesNotMatch(code, /\b(UPDATE|DELETE FROM|INSERT INTO)\b/)
})

test('0159 is the 0132 view verbatim plus the two additions', () => {
  let expected = visitsTail(V0132)
  expected = replaceOnce(
    expected,
    '    l.contractor_equipment_code,\n    LEAD(l.id)',
    '    l.contractor_equipment_code,\n' +
      '    -- 0159: appended to the CTE; the window below is unchanged.\n' +
      '    l.created_at,\n' +
      '    LEAD(l.id)',
  )
  expected = replaceOnce(
    expected,
    '  ls.name AS equipment_lessor_name\nFROM paired p',
    '  ls.name AS equipment_lessor_name,\n' +
      '  -- 0159: appended; everything above is 0132 verbatim. When the ENTRY was\n' +
      '  -- registered in the system (`entry_exit_logs.created_at`), as opposed to\n' +
      "  -- `entry_at`, the movement's own date (`recorded_at`).\n" +
      '  p.created_at AS entry_created_at\n' +
      'FROM paired p',
  )
  expected = replaceOnce(
    expected,
    "-- 0124's comment, with the equipment supplier described.",
    "-- 0132's comment, with the entry's creation time described.",
  )
  expected = replaceOnce(
    expected,
    "  'supplier line of the admin log; NULL when the equipment has none.';",
    "  'supplier line of the admin log; NULL when the equipment has none. '\n" +
      "  'entry_created_at (0159) is when the ENTRY row was created in the system '\n" +
      "  '(entry_exit_logs.created_at), shown as the «الانشاء» column of the '\n" +
      "  'visits tables; entry_at stays the movement''s own date (recorded_at).';",
  )
  assert.equal(visitsTail(V0159), expected)
  assert.match(V0159, /WITH \(security_invoker = true\)/)
  assert.match(
    V0159,
    /REVOKE ALL ON public\.movement_visits FROM PUBLIC, anon;/,
  )
  assert.match(
    V0159,
    /GRANT SELECT ON public\.movement_visits TO authenticated;/,
  )
  assert.match(V0159, /NOTIFY pgrst, 'reload schema';\s*$/)
})

function loadLibModule(name, cache = new Map()) {
  if (cache.has(name)) return cache.get(name)
  const file = path.join(ROOT, 'src', 'lib', `${name}.ts`)
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText
  const exports = {}
  cache.set(name, exports)
  vm.runInNewContext(
    code,
    {
      exports,
      require(request) {
        const match = /^@\/lib\/(.+)$/.exec(request)
        if (match) return loadLibModule(match[1], cache)
        throw new Error(`Unexpected module: ${request}`)
      },
    },
    { filename: file },
  )
  return exports
}

const visits = loadLibModule('visitsList')

test('the visits select reads entry_created_at, never *', () => {
  const columns = visits.EQUIPMENT_VISITS_SELECT.split(',')
  assert.ok(columns.includes('entry_created_at'))
  assert.ok(!columns.includes('*'))
  assert.ok(
    visits.EQUIPMENT_VISITS_LOG_SELECT.split(',').includes('entry_created_at'),
  )
})

test('the creation age uses the duration words', () => {
  const now = Date.parse('2026-10-28T12:00:00Z')
  const ago = (iso, lang = 'ar') => visits.formatVisitCreatedAgo(iso, lang, now)
  assert.equal(
    ago('2026-10-25T10:00:00Z'),
    visits.formatVisitDuration(3 * 24 * 60 + 120, 'ar'),
  )
  assert.equal(ago('2026-10-25T10:00:00Z'), '3 ايام')
  // After «منذ» the dual is genitive: «منذ ساعتين», «منذ يومين».
  assert.equal(ago('2026-10-28T10:00:00Z'), 'ساعتين')
  assert.equal(ago('2026-10-26T11:00:00Z'), 'يومين')
  assert.equal(ago('2026-10-28T11:58:00Z'), 'دقيقتين')
  assert.equal(ago('2026-10-27T11:00:00Z'), 'يوم')
  assert.equal(ago('2026-10-28T11:55:00Z', 'en'), '5 minutes')
  // A creation time slightly ahead of the device clock is "0 minutes".
  assert.equal(ago('2026-10-28T12:01:00Z'), '0 دقيقة')
  assert.equal(ago(null), null)
  assert.equal(ago(undefined), null)
  assert.equal(ago('not a date'), null)
})

test('«الانشاء» is the last column of every variant, in the duration style', () => {
  const source = read('src/components/visits/VisitsTable.tsx')
  // Every column list returned by the memo ends with the duration, then it.
  const lists = source.match(/\[\s*equipment,[\s\S]*?\]/g)
  assert.equal(lists.length, 5)
  for (const list of lists) assert.match(list, /duration,\s*createdAt,?\s*\]$/)
  const column = source.slice(
    source.indexOf('const createdAt: DataTableColumn'),
    source.indexOf("if (context === 'workshop')"),
  )
  assert.match(column, /key: 'entry_created_at'/)
  assert.match(column, /header: t\('visitCreatedAt'\)/)
  assert.match(column, /align: 'end'/)
  assert.doesNotMatch(column, /sortable:|hideBelow:/)
  // The same span as the duration cell, through the duration's words.
  assert.match(column, /className="text-\[11px\] text-muted"/)
  assert.match(column, /formatVisitCreatedAgo\(visit\.entry_created_at, lang\)/)
  assert.match(column, /title=\{formatSaudiDateTime\(visit\.entry_created_at\)/)
  assert.match(column, /t\('visitCreatedAgo'\)\.replace\('\{duration\}', ago\)/)
  const duration = source.slice(
    source.indexOf('const duration: DataTableColumn'),
    source.indexOf('const createdAt: DataTableColumn'),
  )
  assert.match(duration, /align: 'end'/)
  assert.doesNotMatch(duration, /sortable:|hideBelow:/)
  // Not a server sort key.
  assert.deepEqual([...visits.VISIT_SORT_FIELDS], ['entry_at', 'exit_at'])
})

test('the visits export lists the creation time last, as a date', () => {
  const t = (key) => key
  const columns = visits.visitExportColumns(t, 'ar')
  const last = columns[columns.length - 1]
  assert.equal(last.key, 'created_at')
  assert.equal(last.header, 'visitCreatedAt')
  assert.equal(last.type, 'date')
  assert.equal(columns[columns.length - 2].key, 'duration')
  assert.equal(
    last.value({ entry_created_at: '2026-10-28T09:00:00Z' }),
    '2026-10-28T09:00:00Z',
  )
  assert.equal(last.value({}), null)
})

test('the column copy exists in Arabic and English without hamza forms', () => {
  const source = read('src/i18n/translations.ts')
  assert.match(source, /visitCreatedAt: 'الانشاء'/)
  assert.match(source, /visitCreatedAgo: 'منذ \{duration\}'/)
  assert.match(source, /visitCreatedAt: 'Created'/)
  assert.match(source, /visitCreatedAgo: '\{duration\} ago'/)
  for (const line of source.split('\n').filter((l) => /visitCreatedA/.test(l)))
    assert.doesNotMatch(line, /[أإآ]/)
})
