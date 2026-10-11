// Wave 20: one derived equipment state, the out_of_service purpose, the
// retired operational status and the active/sold asset status (migration
// 0125). Pure and regex checks only, like the rest of the suite: no database
// is reached.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const XLSX = require('xlsx')

const ROOT = path.join(__dirname, '..')
const MIGRATIONS = path.join(ROOT, 'supabase', 'migrations')
const MIGRATION = '20261011110000_0125_unified_equipment_state.sql'
const migration = (number) => {
  const name = fs
    .readdirSync(MIGRATIONS)
    .find((file) => file.includes(`_${number}_`))
  assert.ok(name, `migration ${number} exists`)
  return fs.readFileSync(path.join(MIGRATIONS, name), 'utf8')
}
const SQL = fs.readFileSync(path.join(MIGRATIONS, MIGRATION), 'utf8')

/** Loads a source module; `@/...` and relative imports resolve to the real
 *  files, zod and xlsx are the real packages, anything else is stubbed. */
function loadModule(file, cache = new Map()) {
  const resolved = resolveFile(file)
  if (cache.has(resolved)) return cache.get(resolved)
  const code = ts.transpileModule(fs.readFileSync(resolved, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.React,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText
  const exports = {}
  cache.set(resolved, exports)
  vm.runInNewContext(
    code,
    {
      exports,
      Date,
      Math,
      Number,
      String,
      Object,
      Array,
      JSON,
      Set,
      Map,
      parseInt,
      React: { createElement: () => null },
      require(request) {
        if (request.startsWith('@/'))
          return loadModule(path.join(ROOT, 'src', request.slice(2)), cache)
        if (request.startsWith('.'))
          return loadModule(path.join(path.dirname(resolved), request), cache)
        if (request === 'zod') return require('zod')
        if (request === 'xlsx') return XLSX
        return new Proxy({}, { get: () => () => null, apply: () => null })
      },
    },
    { filename: resolved },
  )
  return exports
}

function resolveFile(file) {
  for (const candidate of [file, `${file}.ts`, `${file}.tsx`])
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile())
      return candidate
  throw new Error(`Unresolved module: ${file}`)
}

const cache = new Map()
const lib = (name) => loadModule(path.join(ROOT, 'src', 'lib', name), cache)
const state = lib('equipmentState')
const admin = lib('adminHomeStats')
const form = lib('equipmentForm')
const validation = lib('formValidation')
const excel = lib('excel')
const configs = lib('listConfigs')
const { translations } = loadModule(
  path.join(ROOT, 'src', 'i18n', 'translations.ts'),
  cache,
)

const plain = (value) => JSON.parse(JSON.stringify(value ?? null))

// --- Migration helpers ---------------------------------------------------------

/** The definition without comment lines, so only the SQL is compared. */
const code = (text) =>
  text
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')

/** A function definition up to the end of its `$$` body. */
function functionBlock(sql, name) {
  const start = sql.search(
    new RegExp(`CREATE (OR REPLACE )?FUNCTION public\\.${name}\\(`),
  )
  assert.ok(start >= 0, name)
  return sql.slice(start, sql.indexOf('$$;', sql.indexOf('AS $$', start)) + 3)
}

/** The `admin_equipment_state` definition up to its lateral join. */
function viewBlock(sql) {
  const start = sql.indexOf(
    'CREATE OR REPLACE VIEW public.admin_equipment_state',
  )
  assert.ok(start >= 0, 'admin_equipment_state')
  const end = sql.indexOf(') m ON true;', start) + ') m ON true;'.length
  return sql.slice(start, end)
}

/** Replaces exactly `count` occurrences, failing when the anchor differs. */
function replaceAll(text, from, to, count = 1) {
  assert.equal(text.split(from).length - 1, count, `anchor x${count}: ${from}`)
  return text.split(from).join(to)
}

const WS3 =
  "'workshop_maintenance', 'workshop_parking', 'workshop_unclassified'"
const WS4 =
  "'workshop_maintenance', 'workshop_parking', 'workshop_out_of_service',\n          'workshop_unclassified'"

// --- The migration file --------------------------------------------------------

test('0125 is a new migration ordered after 0124', () => {
  const files = fs
    .readdirSync(MIGRATIONS)
    .filter((file) => file.endsWith('.sql'))
    .sort()
  assert.equal(files.filter((file) => /_0125_/.test(file)).length, 1)
  assert.ok(
    files.indexOf(MIGRATION) > files.findIndex((file) => /_0124_/.test(file)),
  )
  assert.match(SQL, /NOTIFY pgrst, 'reload schema';\s*$/)
  assert.ok(!/CREATE (UNIQUE )?INDEX/.test(code(SQL)))
  // No column or table is dropped: the operational status is retired, kept.
  assert.ok(!/DROP (COLUMN|TABLE)/i.test(code(SQL)))
  // Only the two recreated DEFINER functions keep SECURITY DEFINER.
  assert.equal(code(SQL).match(/SECURITY DEFINER/g).length, 3)
})

test('the sequence trigger is 0108 verbatim minus the operational restore', () => {
  const before = code(
    functionBlock(migration('0108'), 'enforce_movement_sequence'),
  )
  const after = code(functionBlock(SQL, 'enforce_movement_sequence'))
  const restore =
    "    IF v_last_entry.movement_context = 'workshop'\n" +
    "       AND v_last_entry.workshop_purpose = 'maintenance' THEN\n" +
    '      UPDATE public.equipment\n' +
    "      SET operational_status = COALESCE(v_last_entry.previous_operational_status, 'operational')\n" +
    '      WHERE id = NEW.equipment_id;\n' +
    '    END IF;\n'
  assert.equal(after, replaceAll(before, restore, ''))
  assert.ok(!/operational_status/.test(after))
  // The lock, the role checks and the chain rules are still there.
  assert.match(
    after,
    /pg_advisory_xact_lock\(hashtextextended\(NEW\.equipment_id::text, 0\)\)/,
  )
  assert.match(after, /RAISE EXCEPTION 'sequence would be invalid'/)
  assert.match(
    SQL,
    /REVOKE ALL ON FUNCTION public\.enforce_movement_sequence\(\)\s+FROM PUBLIC, anon, authenticated;/,
  )
})

test('classify_workshop_entry is 0109 with the third purpose and no status writes', () => {
  const before = code(
    functionBlock(migration('0109'), 'classify_workshop_entry'),
  )
  const after = code(functionBlock(SQL, 'classify_workshop_entry'))
  let expected = replaceAll(before, '  v_current_status text;\n', '')
  expected = replaceAll(
    expected,
    "  IF p_purpose NOT IN ('maintenance', 'parking') THEN",
    "  IF p_purpose NOT IN ('maintenance', 'parking', 'out_of_service') THEN",
  )
  const from = expected.indexOf(
    '\n  SELECT operational_status INTO v_current_status',
  )
  const to = expected.lastIndexOf('END;\n$$;')
  assert.ok(from > 0 && to > from)
  expected =
    expected.slice(0, from) +
    '\n  UPDATE public.entry_exit_logs\n  SET workshop_purpose = p_purpose\n  WHERE id = v_entry.id;\n' +
    expected.slice(to)
  assert.equal(after, expected)
  // Only the closed-entry branch still clears previous_operational_status.
  assert.ok(
    !/\boperational_status\s*=|v_current_status|UPDATE public\.equipment/.test(
      after,
    ),
  )
  assert.match(after, /SECURITY DEFINER\s+SET search_path = public, pg_temp/)
  assert.match(
    after,
    /v_role NOT IN \('admin', 'workshop_manager', 'assistant_workshop_manager'\)/,
  )
  assert.match(after, /FOR UPDATE;/)
  assert.match(
    SQL,
    /REVOKE ALL ON FUNCTION public\.classify_workshop_entry\(uuid, text\) FROM PUBLIC, anon;/,
  )
  assert.match(
    SQL,
    /GRANT EXECUTE ON FUNCTION public\.classify_workshop_entry\(uuid, text\) TO authenticated;/,
  )
})

test('the Excel update is 0102 without the operational status, two statuses', () => {
  const before = code(
    functionBlock(migration('0102'), 'update_equipment_from_excel'),
  )
  const after = code(functionBlock(SQL, 'update_equipment_from_excel'))
  let expected = replaceAll(
    before,
    "        operational_status = (v_row->>'operational_status')::text,\n",
    '',
  )
  expected = replaceAll(
    expected,
    "      IF v_status NOT IN ('active', 'sold', 'scrapped', 'rented_out') THEN",
    "      IF v_status NOT IN ('active', 'sold') THEN",
  )
  assert.equal(after, expected)
  assert.match(
    after,
    /IF auth\.uid\(\) IS NULL OR NOT public\.is_admin\(\) THEN/,
  )
})

test('the state view is 0118 plus out_of_service and two appended columns', () => {
  const before = code(viewBlock(migration('0118')))
  const after = code(viewBlock(SQL))
  let expected = replaceAll(
    before,
    "      AND m.workshop_purpose = 'parking' THEN 'workshop_parking'\n",
    "      AND m.workshop_purpose = 'parking' THEN 'workshop_parking'\n" +
      "    WHEN m.movement_context = 'workshop'\n" +
      "      AND m.workshop_purpose = 'out_of_service' THEN 'workshop_out_of_service'\n",
  )
  expected = replaceAll(
    expected,
    '  m.exit_purpose AS last_exit_purpose\nFROM',
    '  m.exit_purpose AS last_exit_purpose,\n' +
      '  public.equipment_state_from_movement(\n' +
      '    m.movement_type, m.movement_context, m.workshop_purpose\n' +
      '  ) AS equipment_state,\n' +
      '  (m.id IS NULL) AS is_new\nFROM',
  )
  assert.equal(after, expected)
  assert.match(after, /WITH \(security_invoker = true\)/)
  // The mapping function is created before the view that calls it.
  assert.ok(
    SQL.indexOf(
      'CREATE OR REPLACE FUNCTION public.equipment_state_from_movement(',
    ) < SQL.indexOf('CREATE OR REPLACE VIEW public.admin_equipment_state'),
  )
})

test('the admin home counts are 0102 with out_of_service counted', () => {
  let before = code(functionBlock(migration('0102'), 'get_admin_fleet_state'))
  let expected = replaceAll(before, WS3, WS4, 3)
  expected = replaceAll(
    expected,
    "    'workshop_unclassified',\n      (SELECT count(*) FILTER (WHERE state = 'workshop_unclassified')::int\n",
    "    'workshop_out_of_service',\n      (SELECT count(*) FILTER (WHERE state = 'workshop_out_of_service')::int\n       FROM scoped),\n" +
      "    'workshop_unclassified',\n      (SELECT count(*) FILTER (WHERE state = 'workshop_unclassified')::int\n",
  )
  assert.equal(code(functionBlock(SQL, 'get_admin_fleet_state')), expected)

  before = code(
    functionBlock(migration('0102'), 'get_admin_availability_by_type'),
  )
  assert.equal(
    code(functionBlock(SQL, 'get_admin_availability_by_type')),
    replaceAll(before, WS3, WS4, 1),
  )

  before = code(functionBlock(migration('0102'), 'get_workshop_home_stats'))
  expected = replaceAll(
    before,
    "    (SELECT count(*)::int FROM inside WHERE workshop_purpose = 'parking'),\n",
    "    (SELECT count(*)::int FROM inside WHERE workshop_purpose = 'parking'),\n" +
      "  'out_of_service',\n    (SELECT count(*)::int FROM inside\n     WHERE workshop_purpose = 'out_of_service'),\n",
  )
  expected = replaceAll(
    expected,
    "     WHERE workshop_purpose = 'parking'),\n  'pending'",
    "     WHERE workshop_purpose = 'parking'),\n  'out_of_service_yesterday',\n" +
      "    (SELECT count(*)::int FROM inside_yesterday\n     WHERE workshop_purpose = 'out_of_service'),\n  'pending'",
  )
  assert.equal(code(functionBlock(SQL, 'get_workshop_home_stats')), expected)
})

test('get_admin_fleet_equipment is 0121 plus out_of_service and is_new', () => {
  const before = code(
    functionBlock(migration('0121'), 'get_admin_fleet_equipment'),
  )
  const after = code(functionBlock(SQL, 'get_admin_fleet_equipment'))
  let expected = replaceAll(
    before,
    '  last_exit_purpose text\n)',
    '  last_exit_purpose text,\n  is_new boolean\n)',
  )
  expected = replaceAll(
    expected,
    "    IF p_purpose NOT IN ('maintenance', 'parking', 'unclassified') THEN",
    "    IF p_purpose NOT IN (\n      'maintenance', 'parking', 'out_of_service', 'unclassified'\n    ) THEN",
  )
  expected = replaceAll(
    expected,
    "      'workshop_maintenance', 'workshop_parking', 'workshop_unclassified'\n    ]",
    "      'workshop_maintenance', 'workshop_parking', 'workshop_out_of_service',\n      'workshop_unclassified'\n    ]",
  )
  expected = replaceAll(
    expected,
    '    s.last_exit_purpose\n  FROM public.admin_equipment_state s',
    '    s.last_exit_purpose,\n    s.is_new\n  FROM public.admin_equipment_state s',
  )
  expected = replaceAll(
    expected,
    "      array_position(ARRAY['maintenance', 'parking'], s.last_workshop_purpose),\n      3\n",
    "      array_position(\n        ARRAY['maintenance', 'parking', 'out_of_service'],\n        s.last_workshop_purpose\n      ),\n      4\n",
    2,
  )
  assert.equal(after, expected)
  assert.match(after, /SECURITY INVOKER\s+SET search_path = public, pg_temp/)

  const signature =
    'public\\.get_admin_fleet_equipment\\(text, text\\[\\], text, int, int, text\\)'
  const drop = SQL.search(new RegExp(`DROP FUNCTION IF EXISTS ${signature};`))
  assert.ok(drop >= 0)
  assert.ok(
    drop < SQL.indexOf('CREATE FUNCTION public.get_admin_fleet_equipment('),
  )
  assert.match(
    SQL,
    new RegExp(`REVOKE ALL ON FUNCTION\\s+${signature}\\s+FROM PUBLIC, anon;`),
  )
  assert.match(
    SQL,
    new RegExp(
      `GRANT EXECUTE ON FUNCTION\\s+${signature}\\s+TO authenticated;`,
    ),
  )
  assert.match(SQL, new RegExp(`COMMENT ON FUNCTION\\s+${signature} IS`))

  // The database and the client allowlist the same purposes.
  const allow = /IF p_purpose NOT IN \(([^)]*)\) THEN/.exec(after)[1]
  assert.deepEqual(
    allow.match(/'[^']+'/g).map((value) => value.slice(1, -1)),
    plain(admin.WORKSHOP_PURPOSE_FILTERS).filter((value) => value !== 'all'),
  )
})

test('the constraints: three purposes, and active/sold behind a guard', () => {
  const purpose =
    /ADD CONSTRAINT entry_exit_logs_workshop_purpose_check[\s\S]*?workshop_purpose IN \(([^)]*)\)/.exec(
      SQL,
    )
  assert.ok(purpose)
  assert.deepEqual(
    purpose[1].match(/'[^']+'/g).map((value) => value.slice(1, -1)),
    plain(state.WORKSHOP_PURPOSES),
  )
  assert.match(
    SQL,
    /ADD CONSTRAINT equipment_status_check\s+CHECK \(status IN \('active', 'sold'\)\);/,
  )
  // The retired column is NOT NULL (0001), so inserts that stop sending it
  // need a default.
  assert.match(
    code(SQL),
    /ALTER TABLE public\.equipment\s+ALTER COLUMN operational_status SET DEFAULT 'operational';/,
  )
  const guard = SQL.indexOf("WHERE status NOT IN ('active', 'sold');")
  assert.ok(guard > 0)
  assert.ok(guard < SQL.indexOf('ADD CONSTRAINT equipment_status_check'))
  assert.match(
    SQL,
    /RAISE EXCEPTION\s+'0125: % equipment row\(s\) still have status scrapped or rented_out/,
  )
})

test('the computed fields are invoker SQL with a fixed search_path', () => {
  for (const name of ['equipment_state', 'equipment_is_new']) {
    const block = functionBlock(SQL, name)
    assert.match(
      block,
      new RegExp(`public\\.${name}\\(p_equipment public\\.equipment\\)`),
    )
    assert.match(
      block,
      /LANGUAGE sql\s+STABLE\s+SECURITY INVOKER\s+SET search_path = public, pg_temp/,
    )
    assert.match(
      SQL,
      new RegExp(
        `REVOKE ALL ON FUNCTION public\\.${name}\\(public\\.equipment\\)\\s+FROM PUBLIC, anon;`,
      ),
    )
    assert.match(
      SQL,
      new RegExp(
        `GRANT EXECUTE ON FUNCTION public\\.${name}\\(public\\.equipment\\)\\s+TO authenticated;`,
      ),
    )
  }
  // The latest movement is picked in the deterministic chain order.
  assert.match(
    functionBlock(SQL, 'equipment_state'),
    /ORDER BY l\.recorded_at DESC, l\.id DESC\s+LIMIT 1/,
  )
})

// --- One mapping, SQL and TypeScript --------------------------------------------

/** Evaluates the SQL CASE of `equipment_state_from_movement` for one input. */
function sqlState(type, context, purpose) {
  const body = code(functionBlock(SQL, 'equipment_state_from_movement'))
  // A tiny interpreter for the exact shape of the CASE, checked below.
  assert.match(body, /WHEN p_movement_type IS NULL THEN 'available'/)
  assert.match(body, /WHEN p_movement_type <> 'entry' THEN 'available'/)
  assert.match(
    body,
    /WHEN p_movement_context = 'workshop' THEN\s+CASE p_workshop_purpose/,
  )
  assert.match(body, /ELSE 'unclassified'\s+END\s+ELSE 'working'/)
  if (type === null) return 'available'
  if (type !== 'entry') return 'available'
  if (context === 'workshop') {
    const inner = /CASE p_workshop_purpose([\s\S]*?)ELSE 'unclassified'/.exec(
      body,
    )[1]
    const map = Object.fromEntries(
      [...inner.matchAll(/WHEN '([a-z_]+)' THEN '([a-z_]+)'/g)].map((m) => [
        m[1],
        m[2],
      ]),
    )
    return map[purpose] ?? 'unclassified'
  }
  return 'working'
}

test('the client mirror gives the SQL mapping for every input', () => {
  const inputs = []
  for (const type of [null, 'entry', 'exit'])
    for (const context of ['site', 'workshop'])
      for (const purpose of [
        null,
        'maintenance',
        'parking',
        'out_of_service',
        'storage',
      ])
        inputs.push([type, context, purpose])
  for (const [type, context, purpose] of inputs) {
    const movement =
      type === null
        ? null
        : {
            movement_type: type,
            movement_context: context,
            workshop_purpose: purpose,
          }
    assert.equal(
      state.equipmentStateFromMovement(movement),
      sqlState(type, context, purpose),
      JSON.stringify(movement),
    )
  }
  // Every value the SQL can return is one the client knows, and vice versa.
  const body = code(functionBlock(SQL, 'equipment_state_from_movement'))
  const returned = new Set(
    [...body.matchAll(/THEN '([a-z_]+)'|ELSE '([a-z_]+)'/g)].map(
      (m) => m[1] ?? m[2],
    ),
  )
  assert.deepEqual(
    [...returned].sort(),
    [...plain(state.EQUIPMENT_STATES)].sort(),
  )
})

test('the state line reads like the owner examples', () => {
  const t = (key) => translations.ar[key]
  assert.equal(state.equipmentStateText(t, 'working'), 'تعمل')
  assert.equal(state.equipmentStateText(t, 'available'), 'متاحة')
  assert.equal(state.equipmentStateText(t, 'available', true), 'متاحة · جديدة')
  assert.equal(state.equipmentStateText(t, 'parking'), 'في الورشة · وقوف')
  assert.equal(
    state.equipmentStateText(t, 'out_of_service'),
    'في الورشة · خارج الخدمة',
  )
  assert.equal(
    state.equipmentStateText(t, 'unclassified'),
    'في الورشة · غير مصنفة',
  )
  assert.equal(state.equipmentStateText(t, null), '—')
  const en = (key) => translations.en[key]
  assert.equal(
    state.equipmentStateText(en, 'available', true),
    'Available · New',
  )
  assert.equal(state.equipmentStateTone('out_of_service'), 'danger')
  assert.equal(state.workshopPurposeTone('out_of_service'), 'danger')
  assert.equal(state.equipmentStateTone('working'), 'success')
  assert.equal(state.parseEquipmentState('operational'), null)
})

test('every label exists in both languages, with no hamza or madda alif', () => {
  const keys = [
    ...Object.values(plain(state.EQUIPMENT_STATE_LABEL_KEYS)),
    ...Object.values(plain(state.WORKSHOP_PURPOSE_LABEL_KEYS)),
    'equipmentState',
    'equipmentStateNew',
    'equipmentStateInWorkshop',
    'adminHomeOutOfService',
    'adminHomeStateOutOfService',
    'operationalStatusColumnIgnored',
  ]
  for (const key of keys) {
    assert.ok(translations.ar[key], `ar ${key}`)
    assert.ok(translations.en[key], `en ${key}`)
  }
  const source = fs.readFileSync(
    path.join(ROOT, 'src', 'i18n', 'translations.ts'),
    'utf8',
  )
  const blocks = source.match(
    /\/\/ wave-20-state — start[\s\S]*?\/\/ wave-20-state — end/g,
  )
  assert.equal(blocks.length, 2)
  for (const block of blocks) assert.ok(!/[أإآ]/.test(block))
  assert.equal(translations.ar.equipmentState, 'الحالة')
  assert.equal(translations.en.equipmentState, 'State')
})

// --- Form, list, home and import ------------------------------------------------

test('the form schema knows no operational status and only active/sold', () => {
  const schema = validation.equipmentFormSchema._def.schema
  assert.ok(!('operational_status' in schema.shape))
  assert.ok('status' in schema.shape)
  const valid = plain(form.EMPTY_EQUIPMENT_FORM)
  valid.code = 'A1'
  valid.type = 'حفار'
  valid.plate_number = '1234'
  valid.qr_value = 'EQ-1'
  assert.deepEqual(plain(form.validateEquipmentForm(valid)), {})
  assert.deepEqual(
    plain(form.validateEquipmentForm({ ...valid, status: 'sold' })),
    {},
  )
  for (const retired of ['scrapped', 'rented_out'])
    assert.deepEqual(
      plain(form.validateEquipmentForm({ ...valid, status: retired })),
      {
        status: 'valueNotInList',
      },
    )
  assert.ok(form.EQUIPMENT_FIELD_ORDER.includes('status'))
})

test('the equipment list filters the derived state and two asset statuses', () => {
  const list = configs.equipmentListConfig
  const field = (key) => list.filterFields.find((item) => item.key === key)
  assert.equal(field('operational_status'), undefined)
  assert.deepEqual(
    plain(field('equipment_state').options.map((option) => option.value)),
    plain(state.EQUIPMENT_STATES),
  )
  assert.deepEqual(
    plain(field('status').options.map((option) => option.value)),
    ['active', 'sold'],
  )
  assert.ok(list.sortableFields.some((item) => item.key === 'equipment_state'))
  assert.ok(
    !list.sortableFields.some((item) => item.key === 'operational_status'),
  )
  // The movement and visit purpose filters offer the third purpose.
  for (const name of ['listConfigs', 'visitsList']) {
    const source = fs.readFileSync(
      path.join(ROOT, 'src', 'lib', `${name}.ts`),
      'utf8',
    )
    assert.match(
      source,
      /value: 'out_of_service',\s+label: 'خارج الخدمة',\s+labelI18n: 'workshopPurposeOutOfService'/,
    )
  }
})

test('the fleet rows read is_new, and the workshop chip covers out_of_service', () => {
  const rows = plain(
    admin.parseFleetEquipmentRows([
      { id: 'a', code: 'A1', state: 'available', is_new: true },
      {
        id: 'b',
        code: 'A2',
        state: 'workshop_out_of_service',
        workshop_purpose: 'out_of_service',
      },
      { id: 'c', code: 'A3', state: 'available', is_new: 'yes' },
      { id: 'd', code: 'A4', state: 'available' },
    ]),
  )
  assert.deepEqual(
    rows.map((row) => row.isNew),
    [true, false, false, false],
  )
  assert.equal(rows[1].state, 'workshop_out_of_service')
  assert.equal(rows[1].workshopPurpose, 'out_of_service')
  assert.deepEqual(plain(admin.fleetJumpTarget('workshop_out_of_service')), {
    table: 'workshop',
    purpose: 'out_of_service',
  })
  assert.equal(
    admin.parseFleetState({ workshop_out_of_service: 4 }).workshopOutOfService,
    4,
  )
  const args = plain(
    admin.fleetEquipmentRpcArgs({
      state: 'workshop',
      owners: null,
      purpose: 'out_of_service',
      page: 1,
      pageSize: 7,
    }),
  )
  assert.equal(args.p_purpose, 'out_of_service')
})

test('the workshop home stats read the out_of_service counts', () => {
  const home = lib('homeStats')
  const stats = plain(
    home.parseWorkshopHomeStats({
      out_of_service: 3,
      out_of_service_yesterday: 1,
    }),
  )
  assert.equal(stats.outOfService, 3)
  assert.equal(stats.outOfServiceYesterday, 1)
  const legacy = plain(home.parseWorkshopHomeStats({}))
  assert.equal(legacy.outOfService, 0)
  assert.equal(legacy.outOfServiceYesterday, null)
})

/** An .xlsx workbook with these rows, as the browser would read it. */
function workbook(rows) {
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(
    book,
    XLSX.utils.json_to_sheet(rows),
    'Equipment',
  )
  const buffer = XLSX.write(book, { type: 'buffer', bookType: 'xlsx' })
  return buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  )
}

test('an import file with the old operational status column is noted, not rejected', () => {
  const t = (key) => translations.ar[key]
  const rows = plain(
    excel.parseEquipmentExcel(
      workbook([
        {
          'كود المعدة': 'A1',
          'نوع المعدة': 'حفار',
          'الحالة التشغيلية': 'متوقفة',
        },
        { 'كود المعدة': 'A2', 'نوع المعدة': 'حفار', 'الحالة التشغيلية': '' },
      ]),
      t,
    ),
  )
  assert.deepEqual(
    rows.map((row) => row._errors),
    [[], []],
  )
  assert.deepEqual(
    rows.map((row) => row._notes),
    [[t('operationalStatusColumnIgnored')], []],
  )
  assert.ok(!('operational_status' in rows[0]))
  // A file without the column has no note at all.
  const clean = plain(
    excel.parseEquipmentExcel(
      workbook([{ 'كود المعدة': 'A3', 'نوع المعدة': 'حفار' }]),
      t,
    ),
  )
  assert.deepEqual(clean[0]._notes, [])
  assert.deepEqual(clean[0]._errors, [])
})
