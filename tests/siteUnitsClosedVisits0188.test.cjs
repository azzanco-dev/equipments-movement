// Migration 0188 and «المعدات في المشاريع» (owner 2026-11-09): the page lists
// the site VISITS, open and closed — by default the units inside now or
// exited since 1 August 2026 («خليها الي خرجت من 1-8 وبعد») — and a closed visit
// can join a supplier PO under the unchanged same-entry-day rule (0148); the
// client side widens the same way (no entry-day rule).
//
// Source checks plus the pure helpers of src/lib/siteVisits.ts.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const root = path.join(__dirname, '..')
const read = (...parts) =>
  fs.readFileSync(path.join(root, ...parts), 'utf8').replace(/\r\n/g, '\n')

const MIGRATION = '20261109120000_0188_site_units_closed_visits.sql'
const PREVIOUS = '20261109110000_0187_remove_supplier_po_equipment.sql'
const norm = (text) =>
  text
    .replace(/--[^\n]*/g, '')
    .replace(/\s+/g, ' ')
    .trim()
const raw = read('supabase', 'migrations', MIGRATION)
const sql = norm(raw)

/** Loads a src module with `@/` and relative imports resolved. */
function loadModule(file, cache = new Map()) {
  const resolved = ['', '.ts', '.tsx']
    .map((ext) => file + ext)
    .find(
      (candidate) =>
        fs.existsSync(candidate) && fs.statSync(candidate).isFile(),
    )
  if (!resolved) return new Proxy({}, { get: () => () => null })
  if (cache.has(resolved)) return cache.get(resolved)
  const code = ts.transpileModule(fs.readFileSync(resolved, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText
  const exports = {}
  cache.set(resolved, exports)
  vm.runInNewContext(
    code,
    {
      exports,
      Intl,
      Date,
      require(request) {
        const target = request.startsWith('@/')
          ? path.join(root, 'src', request.slice(2))
          : request.startsWith('.')
            ? path.join(path.dirname(resolved), request)
            : null
        return target
          ? loadModule(target, cache)
          : new Proxy({}, { get: () => () => null })
      },
    },
    { filename: resolved },
  )
  return exports
}
const visits = loadModule(path.join(root, 'src', 'lib', 'siteVisits'))
const plain = (value) => JSON.parse(JSON.stringify(value))

test('0188 is the single 0188 migration, right after 0187', () => {
  const migrations = fs
    .readdirSync(path.join(root, 'supabase', 'migrations'))
    .filter((file) => file.endsWith('.sql'))
    .sort()
  const at = migrations.indexOf(MIGRATION)
  assert.ok(at > 0)
  assert.equal(migrations[at - 1], PREVIOUS)
  assert.equal(migrations.filter((file) => /_0188_/.test(file)).length, 1)
})

test('the view lists every site visit, open or closed, with the 0169 columns first', () => {
  assert.match(
    sql,
    /CREATE VIEW public\.purchasing_site_visits WITH \(security_invoker = true\) AS/,
  )
  assert.match(sql, /FROM public\.movement_visits v/)
  assert.match(sql, /WHERE v\.movement_context = 'site';/)
  assert.doesNotMatch(sql, /v\.is_open/)
  // purchasing_site_units (the home counts and the inquiry) is not touched.
  assert.doesNotMatch(sql, /VIEW public\.purchasing_site_units/)
  // The column list of 0169, in order, then the three trailing columns.
  const view0169 = norm(
    read('supabase', 'migrations', '20261102120000_0169_client_pos.sql'),
  )
  const columnsOf = (text, from) => {
    const body = text.slice(text.indexOf(from))
    const select = body.slice(
      body.indexOf('SELECT ') + 7,
      body.indexOf(' FROM public.movement_visits v'),
    )
    return select.split(/,(?![^(]*\))/).map((part) =>
      part
        .trim()
        .split(' ')
        .pop()
        .replace(/^\w+\./, ''),
    )
  }
  const before = columnsOf(
    view0169,
    'CREATE OR REPLACE VIEW public.purchasing_site_units',
  )
  const after = columnsOf(sql, 'CREATE VIEW public.purchasing_site_visits')
  assert.equal(before.length, 30)
  assert.deepEqual(after.slice(0, before.length), before)
  assert.deepEqual(after.slice(before.length), [
    'visit_state',
    'exit_at',
    'exit_purpose',
  ])
  assert.match(
    sql,
    /CASE WHEN v\.exit_id IS NULL THEN 'inside' ELSE 'exited' END AS visit_state, v\.exit_at, v\.exit_purpose FROM/,
  )
  // A closed visit counts a PO only through a card covering its entry day.
  assert.equal(
    (
      sql.match(
        /AND \( v\.exit_id IS NULL OR \(c\.period_from <= \(v\.entry_at AT TIME ZONE 'Asia\/Riyadh'\)::date/g,
      ) ?? []
    ).length,
    2,
  )
  // party_po: unchanged (0148 same day, 0160 draft only).
  assert.match(
    sql,
    /AND p\.start_date = \(v\.entry_at AT TIME ZONE 'Asia\/Riyadh'\)::date AND p\.approval_status = 'draft'/,
  )
  assert.match(
    sql,
    /REVOKE ALL ON public\.purchasing_site_visits FROM PUBLIC, anon;/,
  )
  assert.match(
    sql,
    /GRANT SELECT ON public\.purchasing_site_visits TO authenticated;/,
  )
  assert.match(sql, /COMMENT ON VIEW public\.purchasing_site_visits IS/)
})

const fnBody = (name) => {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`)
  assert.ok(start >= 0, name)
  return sql.slice(start, sql.indexOf('$$;', start))
}

test('add_supplier_po_equipment: a visit of the start date, open or closed', () => {
  const body = fnBody('add_supplier_po_equipment')
  assert.match(body, /SECURITY DEFINER SET search_path = public, pg_temp/)
  assert.match(body, /PERFORM public\.assert_purchasing_manage\(\);/)
  assert.match(
    body,
    /PERFORM pg_advisory_xact_lock\(hashtextextended\(p_equipment_id::text, 0\)\);/,
  )
  assert.match(
    body,
    /SELECT l\.\* INTO v_entry FROM public\.entry_exit_logs l WHERE l\.equipment_id = p_equipment_id AND l\.movement_type = 'entry' AND l\.movement_context = 'site' AND l\.company_id = v_po\.company_id AND l\.project_id = v_po\.project_id AND \(l\.recorded_at AT TIME ZONE 'Asia\/Riyadh'\)::date = v_po\.start_date ORDER BY \(l\.id IS NOT DISTINCT FROM v_last\.id\) DESC, l\.recorded_at DESC, l\.id DESC LIMIT 1;/,
  )
  // The old «latest movement is an open entry there» test is gone.
  assert.doesNotMatch(body, /v_last\.movement_type <> 'entry'/)
  // Unchanged tokens: another day there, else no visit there.
  assert.match(body, /RAISE EXCEPTION 'entry_date_mismatch'/)
  assert.match(body, /RAISE EXCEPTION 'equipment_not_at_po_project'/)
  for (const token of [
    'po_closed',
    'po_approved_locked',
    'invalid_equipment',
    'invalid_price',
    'invalid_rate_unit',
    'equipment_not_of_po_supplier',
    'card_overlap',
    'equipment_already_on_open_po',
  ])
    assert.match(body, new RegExp(`'${token}'`), token)
  // The card and the event take that entry.
  assert.match(body, /v_entry_date, auth\.uid\(\), v_entry\.id/)
  assert.match(
    body,
    /SET entry_log_id = v_entry\.id WHERE id = v_card_id AND entry_log_id IS NULL;/,
  )
  assert.match(body, /'entry_log_id', v_entry\.id/)
  // v_last (the latest movement) only ranks the open visit first.
  assert.doesNotMatch(
    body,
    /auth\.uid\(\), v_last\.id|'entry_log_id', v_last\.id/,
  )
  assert.equal((body.match(/v_last\.id/g) ?? []).length, 1)
  assert.match(
    sql,
    /REVOKE ALL ON FUNCTION public\.add_supplier_po_equipment\(uuid, uuid, numeric, text, text\) FROM PUBLIC, anon;/,
  )
  assert.match(
    sql,
    /GRANT EXECUTE ON FUNCTION public\.add_supplier_po_equipment\(uuid, uuid, numeric, text, text\) TO authenticated;/,
  )
})

test('add_client_po_equipment: a visit there, open or closed, no day rule', () => {
  const body = fnBody('add_client_po_equipment')
  assert.match(body, /PERFORM public\.assert_sales_manage\(\);/)
  assert.match(
    body,
    /SELECT l\.\* INTO v_entry FROM public\.entry_exit_logs l WHERE l\.equipment_id = p_equipment_id AND l\.movement_type = 'entry' AND l\.movement_context = 'site' AND l\.company_id = v_po\.company_id AND l\.project_id = v_po\.project_id ORDER BY \(l\.id IS NOT DISTINCT FROM v_last\.id\) DESC, l\.recorded_at DESC, l\.id DESC LIMIT 1;/,
  )
  assert.doesNotMatch(body, /start_date|entry_date_mismatch/)
  assert.match(body, /RAISE EXCEPTION 'equipment_not_at_po_project'/)
  assert.match(body, /AND c\.entry_log_id = v_entry\.id LIMIT 1;/)
  assert.match(body, /'entry_log_id', v_entry\.id/)
  assert.match(body, /'equipment_already_on_open_client_po'/)
  assert.match(
    sql,
    /REVOKE ALL ON FUNCTION public\.add_client_po_equipment\(uuid, uuid, numeric, text, integer, numeric, text\) FROM PUBLIC, anon;/,
  )
  assert.match(
    sql,
    /GRANT EXECUTE ON FUNCTION public\.add_client_po_equipment\(uuid, uuid, numeric, text, integer, numeric, text\) TO authenticated;/,
  )
  // create_* pass through the add functions and are not re-created.
  assert.doesNotMatch(sql, /FUNCTION public\.create_(supplier|client)_po/)
})

test('the default window: a visible removable filter, one PostgREST or', () => {
  const now = new Date('2026-11-09T10:00:00Z')
  // The default: exits since 1 August 2026 (Saudi day start 2026-07-31T21:00Z).
  assert.equal(visits.SITE_VISITS_SINCE_DAY, '2026-08-01')
  assert.equal(visits.defaultVisitsSince(), '2026-07-31T21:00:00.000Z')
  assert.equal(
    visits.recentVisitOrClause(),
    'exit_at.is.null,exit_at.gte.2026-07-31T21:00:00.000Z',
  )
  // A rolling window in days still works from the URL.
  // 60 Saudi days before 2026-11-09 is 2026-09-10, whose day starts at
  // 2026-09-09T21:00:00Z.
  assert.equal(visits.recentVisitsSince(60, now), '2026-09-09T21:00:00.000Z')
  assert.equal(
    visits.recentVisitOrClause('2026-09-09T21:00:00.000Z'),
    'exit_at.is.null,exit_at.gte.2026-09-09T21:00:00.000Z',
  )
  const other = { id: 'x', field: 'has_po', operator: 'eq', value: 'false' }
  const split = visits.siteUnitsRecentOrFilter(
    [visits.SITE_UNITS_RECENT_DEFAULT_FILTER, other],
    now,
  )
  assert.equal(
    split.clause,
    'exit_at.is.null,exit_at.gte.2026-07-31T21:00:00.000Z',
  )
  assert.deepEqual(plain(split.rest), [other])
  assert.equal(
    visits.siteUnitsRecentOrFilter(
      [{ ...visits.SITE_UNITS_RECENT_DEFAULT_FILTER, value: '60' }],
      now,
    ).clause,
    'exit_at.is.null,exit_at.gte.2026-09-09T21:00:00.000Z',
  )
  // Removed, or a value that is neither a day key nor a number of days: no clause.
  assert.equal(visits.siteUnitsRecentOrFilter([other], now).clause, null)
  // purchasing_site_visits exposes exit_at but not exit_id: a clause naming
  // exit_id made the page fail with 42703 (owner 2026-11-10, «يطلع تعذر»).
  assert.doesNotMatch(visits.recentVisitOrClause(), /exit_id/)
  assert.doesNotMatch(
    read('supabase', 'migrations', '20261109120000_0188_site_units_closed_visits.sql'),
    /^s*v.exit_id,?s*$/m,
  )
  assert.equal(
    visits.siteUnitsRecentOrFilter(
      [{ ...visits.SITE_UNITS_RECENT_DEFAULT_FILTER, value: '60),x' }],
      now,
    ).clause,
    null,
  )
  assert.deepEqual(plain(visits.SITE_UNITS_RECENT_DEFAULT_FILTER), {
    id: 'default-recent-exit',
    field: 'recent_exit',
    operator: 'eq',
    value: '2026-08-01',
  })

  const config = read('src', 'lib', 'listConfigs.ts')
  const site = config.slice(
    config.indexOf('export const siteUnitsListConfig'),
    config.indexOf('export const clientPoUnitsListConfig'),
  )
  assert.match(site, /key: 'visit_state',/)
  assert.match(site, /labelI18n: 'siteUnitsInside'/)
  assert.match(site, /labelI18n: 'siteUnitsExited'/)
  assert.match(site, /key: SITE_UNITS_RECENT_FILTER_KEY,/)
  assert.match(site, /label: 'خرجت منذ 1 اغسطس 2026 او داخل الان',/)
  assert.match(site, /defaultFilters: \[SITE_UNITS_RECENT_DEFAULT_FILTER\],/)

  const screen = read('src', 'screens', 'purchasing', 'SiteUnitsScreen.tsx')
  // The list and the two counts share the window; the window never reaches
  // applyListFilters as a column.
  assert.equal(
    (screen.match(/siteUnitsRecentOrFilter\(list\.filters\)/g) ?? []).length,
    2,
  )
  assert.equal(
    (
      screen.match(
        /if \(recent\.clause\) query = query\.or\(recent\.clause\)/g,
      ) ?? []
    ).length,
    2,
  )
  assert.match(
    screen,
    /applyListFilters\(query, recent\.rest, COLUMN_FILTER_KEYS\)/,
  )
  assert.match(screen, /applyListFilters\(query, recent\.rest, filterKeys\)/)
  assert.match(screen, /siteUnitsColumnFilterKeys\(siteUnitsListConfig\)/)
  assert.doesNotMatch(screen, /'purchasing_site_units'/)
  // Inside first, then the latest exit, after the chosen sort.
  assert.match(
    screen,
    /\.order\('exit_at', \{ ascending: false, nullsFirst: true \}\)/,
  )
})

test('the ticket of a closed visit: «خرجت», its exit day and purpose', () => {
  const screen = read('src', 'screens', 'purchasing', 'SiteUnitsScreen.tsx')
  assert.match(
    screen,
    /\{row\.visit_state === 'exited' && \(\s+<Badge tone="neutral" size="sm">/,
  )
  // Owner 2026-11-11: the exit line sits UNDER the entry date; the foreman
  // is still shown for a visit that is not exited.
  assert.match(screen, /\{row\.visit_state === 'exited' && \(\s+<p [^>]*>\s+\{exitLine\(row\)\}/)
  assert.match(screen, /\{row\.visit_state !== 'exited' && \(\s+<p [^>]*>\s+\{t\('logsColForeman'\)\}/)
  assert.ok(
    screen.indexOf('formatDate(row.entry_at)') <
      screen.indexOf('{exitLine(row)}'),
  )
  assert.match(screen, /exitPurposeLabelKey\(row\.exit_purpose\)/)
  // The Saudi day of the exit.
  assert.match(
    screen,
    /<bdi dir="ltr">\{formatDate\(saudiDateKey\(row\.exit_at\)\)\}<\/bdi>/,
  )
  // The «+» is the same for every visit.
  assert.match(screen, /startDate: saudiDateKey\(row\.entry_at\),/)
  const data = read('src', 'lib', 'purchasingData.ts')
  assert.match(
    data,
    /party_po_id,party_po_number,visit_state,exit_at,exit_purpose,entry_created_at'/,
  )
})

test('the pickers offer closed visits, marked, never a unit already on the PO', () => {
  const data = read('src', 'lib', 'purchasingData.ts')
  const visitsFn = data.slice(
    data.indexOf('function partySiteVisits('),
    data.indexOf('export function partyOptionLoader('),
  )
  assert.doesNotMatch(visitsFn, /is_open/)
  assert.match(visitsFn, /\.select\(VISIT_SELECT\)/)
  assert.match(data, /entry_at,exit_at,company_id/)
  const loader = data.slice(
    data.indexOf('export function equipmentAtProjectOptionLoader'),
  )
  assert.match(
    loader,
    /\.gte\('entry_at', saudiDayStart\(options\.entryDay\)\)/,
  )
  assert.match(loader, /else request = request\.or\(recentVisitOrClause\(\)\)/)
  assert.match(loader, /\.not\('equipment_id', 'in', /)
  assert.match(loader, /visit\.exit_at \? options\.exitedLabel : null/)
  const fetchFn = data.slice(
    data.indexOf('export async function fetchPartyVisits'),
  )
  assert.match(fetchFn, /\.or\(recentVisitOrClause\(since\)\)/)

  const add = read('src', 'components', 'purchasing', 'AddEquipmentDialog.tsx')
  assert.match(add, /exitedLabel: t\('siteUnitsExited'\),/)
  const create = read(
    'src',
    'components',
    'purchasing',
    'CreateSupplierPoDialog.tsx',
  )
  assert.match(
    create,
    /function isPicked\(picked: Picked, visit: PartyVisit\): boolean/,
  )
  assert.match(create, /line\.entry_day === visitEntryDay\(visit\)/)
  assert.match(create, /key=\{visit\.entry_id\}/)
  assert.match(create, /\{visit\.exit_at && \(/)

  const sales = read('src', 'lib', 'salesData.ts')
  assert.match(
    sales,
    /\.eq\('movement_context', 'site'\)\s+\.or\(recentVisitOrClause\(\)\)/,
  )
  assert.doesNotMatch(sales, /\.eq\('is_open', true\)/)
  assert.match(sales, /return latestVisitPerUnit\(rows\)/)
  assert.match(sales, /visit\.exit_at \? options\.exitedLabel : null/)
  const addClient = read(
    'src',
    'components',
    'sales',
    'AddClientPoEquipmentDialog.tsx',
  )
  assert.match(addClient, /exitedLabel: t\('siteUnitsExited'\),/)
  const createClient = read(
    'src',
    'components',
    'sales',
    'CreateClientPoDialog.tsx',
  )
  assert.match(createClient, /fetchRecentSiteVisits\(\)/)
  assert.match(createClient, /\{visit\.exit_at && \(/)
})

test('one visit per unit: the open one first, else the latest', () => {
  const v = (id, day, exit) => ({
    entry_id: id,
    equipment_id: 'u1',
    company_id: 'c',
    project_id: 'p',
    entry_at: `${day}T08:00:00Z`,
    exit_at: exit,
  })
  const closedOld = v('a', '2026-10-01', '2026-10-01T12:00:00Z')
  const closedNew = v('b', '2026-10-20', '2026-10-20T12:00:00Z')
  const open = v('c', '2026-10-15', null)
  assert.deepEqual(
    plain(visits.latestVisitPerUnit([closedOld, closedNew, open])).map(
      (x) => x.entry_id,
    ),
    ['c'],
  )
  assert.deepEqual(
    plain(visits.latestVisitPerUnit([closedOld, closedNew])).map(
      (x) => x.entry_id,
    ),
    ['b'],
  )
  // The supplier side keeps one per entry day.
  const sameDay = v('d', '2026-10-20', null)
  assert.deepEqual(
    plain(visits.latestVisitPerUnitDay([closedOld, closedNew, sameDay])).map(
      (x) => x.entry_id,
    ),
    ['a', 'd'],
  )
})

test('messages and translations: both languages, no hamza on alif', () => {
  const translations = read('src', 'i18n', 'translations.ts')
  const valuesOf = (key) =>
    [
      ...translations.matchAll(
        new RegExp(`^    ${key}:\\s*\\n?\\s*('[^'\\n]*'|"[^"\\n]*"),$`, 'gm'),
      ),
    ].map((m) => m[1])
  for (const key of [
    'siteUnitsStateFilter',
    'siteUnitsInside',
    'siteUnitsExited',
    'siteUnitsRecentFilter',
    'siteUnitsRecentSince',
    'supplierPoErrorNotAtProject',
    'clientPoErrorNotAtProject',
    'siteUnitsDesc',
    'supplierPoEquipmentAtProjectHint',
    'clientPoEquipmentAtProjectHint',
  ]) {
    const values = valuesOf(key)
    assert.equal(values.length, 2, key)
    assert.doesNotMatch(values[0], /[أإآ]/, key)
  }
  assert.deepEqual(
    valuesOf('supplierPoErrorNotAtProject')[0],
    "'لا زيارة للمعدة في مشروع الـ PO بهذا اليوم.'",
  )
  // The client side has no day rule, so its own words.
  const sales = read('src', 'lib', 'sales.ts')
  assert.match(
    sales,
    /equipment_not_at_po_project: 'clientPoErrorNotAtProject'/,
  )
  assert.match(
    read('src', 'lib', 'purchasing.ts'),
    /match: 'equipment_not_at_po_project',\s+field: 'equipment_id',\s+key: 'supplierPoErrorNotAtProject'/,
  )
  // No hamza in the new SQL copy or the new library either.
  assert.doesNotMatch(raw, /[أإآ]/)
  assert.doesNotMatch(read('src', 'lib', 'siteVisits.ts'), /[أإآ]/)
})

// Owner 2026-11-11 («الي سويناه بخصوص تاريخ انشاء الدخولية ابغاه يكون في
// المعدات في المشاريع», then «انشاء الدخول فقط»; migration 0192).
test('0192: the tickets show and sort by the entry registration only', () => {
  const fs = require('node:fs')
  const path = require('node:path')
  const root = path.join(__dirname, '..')
  const readFile = (...parts) =>
    fs.readFileSync(path.join(root, ...parts), 'utf8').replace(/\r\n/g, '\n')
  const sql = readFile('supabase', 'migrations', '20261111130000_0192_site_visits_created_at.sql')
  assert.match(sql, /CREATE OR REPLACE VIEW public\.purchasing_site_visits\nWITH \(security_invoker = true\)/)
  // ONE column, appended last; the exit's registration is not exposed.
  assert.match(sql, /v\.exit_at,\n  v\.exit_purpose,\n(?:  --.*\n)+  v\.entry_created_at\nFROM public\.movement_visits v/)
  assert.doesNotMatch(sql, /exit_created_at/)
  assert.match(sql, /WHERE v\.movement_context = 'site';/)
  assert.match(sql, /REVOKE ALL ON public\.purchasing_site_visits FROM PUBLIC, anon;/)
  assert.match(sql, /GRANT SELECT ON public\.purchasing_site_visits TO authenticated;/)

  const data = readFile('src', 'lib', 'purchasingData.ts')
  const select = /export const SITE_UNITS_SELECT =\s+'([^']+)'/.exec(data)[1].split(',')
  assert.equal(select[select.length - 1], 'entry_created_at')
  assert.ok(!select.includes('exit_created_at'))

  const configs = readFile('src', 'lib', 'listConfigs.ts')
  const config = configs
    .split('export const siteUnitsListConfig: DataListConfig')[1]
    .split('\n}\n')[0]
  assert.match(config, /\{ key: 'entry_created_at', label: \{ ar: 'تاريخ الانشاء', en: 'Created' \} \},/)
  // The default stays «بدون PO اولا».
  assert.match(config, /defaultSort: 'has_po',\s+defaultDirection: 'asc',/)

  const screen = readFile('src', 'screens', 'purchasing', 'SiteUnitsScreen.tsx')
  assert.match(screen, /formatVisitCreatedAgo\(row\.entry_created_at, lang\)/)
  assert.match(screen, /<bdi dir="ltr">\{formatSaudiDateTime\(row\.entry_created_at\)\}<\/bdi>/)
  assert.match(screen, /\{createdLine\(row\)\}/)
  assert.doesNotMatch(screen, /exit_created_at/)
})
