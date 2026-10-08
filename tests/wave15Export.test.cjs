const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

// wave-15-export: the /logs export dialog (Excel or the PDF print page, scope,
// count, caps, remembered columns), the print page payload, and the search by
// a previous equipment code on both /logs views.

const ROOT = path.join(__dirname, '..')
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8')

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
      Date,
      Math,
      Number,
      String,
      Object,
      Array,
      JSON,
      console,
      require(request) {
        if (request === 'xlsx') return require('xlsx')
        const alias = /^@\/lib\/(.+)$/.exec(request)
        if (alias) return loadLibModule(alias[1], cache)
        throw new Error(`Unexpected module: ${request}`)
      },
    },
    { filename: file },
  )
  return exports
}

const cache = new Map()
const options = loadLibModule('exportOptions', cache)
const print = loadLibModule('printExport', cache)
const previous = loadLibModule('previousCodeSearch', cache)
const movementExcel = loadLibModule('movementExcel', cache)
const visits = loadLibModule('visitsList', cache)
const exporter = loadLibModule('adminHomeExport', cache)
const fields = loadLibModule('exportFields', cache)
const plain = (value) => JSON.parse(JSON.stringify(value))
const t = (key) => key

/** An in-memory `Storage`; `failing` makes every call throw. */
function memoryStorage(initial = {}, failing = false) {
  const data = new Map(Object.entries(initial))
  const guard = () => {
    if (failing) throw new Error('blocked')
  }
  return {
    data,
    get length() {
      guard()
      return data.size
    },
    key(index) {
      guard()
      return Array.from(data.keys())[index] ?? null
    },
    getItem(key) {
      guard()
      return data.has(key) ? data.get(key) : null
    },
    setItem(key, value) {
      guard()
      data.set(key, String(value))
    },
    removeItem(key) {
      guard()
      data.delete(key)
    },
  }
}

const COLUMNS = [
  { key: 'code', mandatory: true, header: 'Code', value: () => '' },
  { key: 'company', header: 'Company', value: () => '' },
  { key: 'driver', header: 'Driver', value: () => '' },
  { key: 'date', mandatory: true, header: 'Date', value: () => '' },
]

// --- Caps ---------------------------------------------------------------------

test('Excel keeps the existing cap and PDF is capped at 500 rows', () => {
  assert.equal(options.PDF_EXPORT_MAX_ROWS, 500)
  assert.equal(options.exportRowCap('pdf'), 500)
  assert.equal(options.exportRowCap('xlsx'), exporter.OUTSIDE_EXPORT_MAX_ROWS)
  assert.equal(options.exportRowCap('xlsx'), 5000)
  assert.equal(options.exportedRowCount(1234, 500), 500)
  assert.equal(options.exportedRowCount(120, 500), 120)
  assert.equal(options.exportedRowCount(0, 500), 0)
  assert.equal(options.exportedRowCount(-3, 500), 0)
  assert.equal(options.exportedRowCount(Number.NaN, 500), 0)
})

test('collectAllPages honours the PDF cap and reports the truncation', async () => {
  const total = 1200
  const collected = await exporter.collectAllPages(
    async (page, pageSize) => ({
      rows: Array.from(
        { length: Math.min(pageSize, total - (page - 1) * pageSize) },
        (_, index) => (page - 1) * pageSize + index,
      ),
      total,
    }),
    { pageSize: 500, maxRows: options.PDF_EXPORT_MAX_ROWS },
  )
  assert.equal(collected.rows.length, 500)
  assert.equal(collected.total, 1200)
  assert.equal(collected.capped, true)
})

// --- Column selection ---------------------------------------------------------

test('a missing or invalid saved selection falls back to every column', () => {
  const all = ['code', 'company', 'driver', 'date']
  for (const value of [undefined, null, 'x', 3, {}, [1, 'code'], [null]])
    assert.deepEqual(
      plain(options.normalizeColumnSelection(COLUMNS, value)),
      all,
    )
})

test('a saved selection keeps the mandatory columns and the column order', () => {
  assert.deepEqual(
    plain(options.normalizeColumnSelection(COLUMNS, ['driver', 'unknown'])),
    ['code', 'driver', 'date'],
  )
  // «الغاء الكل» leaves the mandatory columns, never an empty file.
  assert.deepEqual(plain(options.normalizeColumnSelection(COLUMNS, [])), [
    'code',
    'date',
  ])
  assert.deepEqual(plain(options.mandatoryColumnKeys(COLUMNS)), [
    'code',
    'date',
  ])
  assert.deepEqual(plain(options.allColumnKeys(COLUMNS)), [
    'code',
    'company',
    'driver',
    'date',
  ])
})

test('a mandatory column cannot be unticked', () => {
  const selection = ['code', 'company', 'date']
  assert.deepEqual(
    plain(options.toggleColumnKey(COLUMNS, selection, 'code', false)),
    ['code', 'company', 'date'],
  )
  assert.deepEqual(
    plain(options.toggleColumnKey(COLUMNS, selection, 'company', false)),
    ['code', 'date'],
  )
  assert.deepEqual(
    plain(options.toggleColumnKey(COLUMNS, selection, 'driver', true)),
    ['code', 'company', 'driver', 'date'],
  )
  assert.equal(options.isMandatoryColumn({ key: 'x', mandatory: true }), true)
  // A column without a key can never be named in a selection: always kept.
  assert.equal(options.isMandatoryColumn({}), true)
})

test('the written columns follow the selection in column order', () => {
  const chosen = options.selectExportColumns(COLUMNS, ['driver'])
  assert.deepEqual(plain(chosen.map((column) => column.header)), [
    'Code',
    'Driver',
    'Date',
  ])
})

test('the column choice is remembered per list and file type', () => {
  const storage = memoryStorage()
  assert.equal(
    options.columnSelectionStorageKey('logs', 'pdf'),
    'em.export-columns.logs.pdf',
  )
  options.writeColumnSelection(
    storage,
    'logs',
    'pdf',
    ['code', 'date'],
    COLUMNS,
  )
  assert.deepEqual(
    plain(options.readColumnSelection(storage, 'logs', 'pdf', COLUMNS)),
    ['code', 'date'],
  )
  // Another file type of the same list starts from every column.
  assert.equal(
    options.readColumnSelection(storage, 'logs', 'xlsx', COLUMNS).length,
    4,
  )
  // Corrupt JSON and a throwing storage fall back to every column.
  storage.setItem('em.export-columns.logs.xlsx', '{not json')
  assert.equal(
    options.readColumnSelection(storage, 'logs', 'xlsx', COLUMNS).length,
    4,
  )
  const blocked = memoryStorage({}, true)
  assert.equal(
    options.readColumnSelection(blocked, 'logs', 'pdf', COLUMNS).length,
    4,
  )
  assert.doesNotThrow(() =>
    options.writeColumnSelection(blocked, 'logs', 'pdf', ['code'], COLUMNS),
  )
  assert.equal(
    options.readColumnSelection(null, 'logs', 'pdf', COLUMNS).length,
    4,
  )
})

test('every export column of both /logs views has a unique key', () => {
  const movement = movementExcel.movementExportColumns(t, 'ar')
  const visit = visits.visitExportColumns(t, 'ar')
  for (const columns of [movement, visit]) {
    const keys = columns.map((column) => column.key)
    assert.ok(keys.every((key) => typeof key === 'string' && key))
    assert.equal(new Set(keys).size, keys.length)
  }
  assert.deepEqual(plain(options.mandatoryColumnKeys(movement)), [
    'equipment_code',
    'equipment_type',
    'plate_number',
    'movement_type',
    'recorded_at',
  ])
  assert.deepEqual(plain(options.mandatoryColumnKeys(visit)), [
    'equipment_code',
    'equipment_type',
    'plate_number',
    'visit_state',
    'entry_at',
  ])
  // The equipment block opens both files.
  for (const columns of [movement, visit])
    assert.deepEqual(
      plain(columns.map((column) => column.header).slice(0, 3)),
      ['equipmentCodeLabel', 'equipmentType', 'plateNumber'],
    )
})

test('the visits export columns built with lookups keep the same keys', () => {
  const bare = visits.visitExportColumns(t, 'ar')
  const looked = visits.visitExportColumns(t, 'ar', {
    supplierByEquipment: new Map([['e1', 'Supplier']]),
    chassisByEquipment: new Map([['e1', 'CH']]),
    mobileByDriver: new Map([['d1', '0500']]),
    nameByProfile: new Map([['u1', 'Name']]),
  })
  assert.deepEqual(
    plain(looked.map((column) => column.key)),
    plain(bare.map((column) => column.key)),
  )
})

// --- Print payload ------------------------------------------------------------

test('dates on the print page are Saudi time whatever the device timezone', () => {
  assert.equal(
    print.formatSaudiDateTime('2026-10-07T21:30:00Z'),
    '08/10/2026 12:30 AM',
  )
  assert.equal(
    print.formatSaudiDateTime('2026-10-07T09:05:00Z'),
    '07/10/2026 12:05 PM',
  )
  assert.equal(
    print.formatSaudiDateTime('2026-01-31T18:59:00Z'),
    '31/01/2026 09:59 PM',
  )
  assert.equal(print.formatSaudiDateTime(null), '')
  assert.equal(print.formatSaudiDateTime('not a date'), '')
})

test('the payload holds display strings only, in the chosen columns', () => {
  const columns = [
    { header: 'Code', width: 14, value: (row) => row.code },
    { header: 'Count', value: (row) => row.count },
    { header: 'Note', width: 30, value: (row) => row.note },
    { header: 'At', width: 18, type: 'date', value: (row) => row.at },
  ]
  const payload = print.buildPrintPayload({
    title: 'سجل الحركات',
    lang: 'ar',
    summary: 'المشاريع · بحث: A1',
    columns,
    rows: [
      { code: 'A1', count: 3, note: null, at: '2026-10-07T09:05:00Z' },
      { code: 'B2', count: 0, note: 'x', at: null },
    ],
    total: 900,
    capped: true,
    now: new Date('2026-10-07T10:00:00Z'),
  })
  assert.deepEqual(plain(payload.rows), [
    ['A1', '3', '', '07/10/2026 12:05 PM'],
    ['B2', '0', 'x', ''],
  ])
  assert.deepEqual(plain(payload.columns), [
    { header: 'Code', width: 14, type: 'text' },
    { header: 'Count', width: 16, type: 'text' },
    { header: 'Note', width: 30, type: 'text' },
    { header: 'At', width: 18, type: 'date' },
  ])
  assert.equal(payload.generatedAt, '2026-10-07T10:00:00.000Z')
  assert.equal(payload.total, 900)
  assert.equal(payload.capped, true)

  const decoded = print.decodePrintPayload(print.encodePrintPayload(payload))
  assert.deepEqual(plain(decoded), plain(payload))
})

test('a missing, corrupt or misshapen payload decodes to null', () => {
  const good = print.buildPrintPayload({
    title: 'T',
    lang: 'en',
    summary: 'S',
    columns: [{ header: 'A', value: () => 'a' }],
    rows: [{}],
    total: 1,
    capped: false,
  })
  assert.equal(print.decodePrintPayload(null), null)
  assert.equal(print.decodePrintPayload(''), null)
  assert.equal(print.decodePrintPayload('{oops'), null)
  assert.equal(print.decodePrintPayload('[]'), null)
  const broken = [
    { ...good, version: 2 },
    { ...good, lang: 'fr' },
    { ...good, columns: [] },
    { ...good, rows: [['a', 'b']] },
    { ...good, rows: [[1]] },
    { ...good, title: 3 },
  ]
  for (const value of broken)
    assert.equal(print.decodePrintPayload(JSON.stringify(value)), null)
})

test('column shares follow the width hints and fill the page', () => {
  const shares = print.printColumnShares([
    { width: 10 },
    { width: 30 },
    { width: 0 },
  ])
  assert.equal(shares.length, 3)
  assert.ok(Math.abs(shares.reduce((sum, share) => sum + share, 0) - 100) < 0.1)
  assert.ok(shares[1] > shares[0])
  // A nonsensical hint counts as the default width.
  assert.equal(shares[2], Math.round((16 / 56) * 10000) / 100)
})

test('the payload is read once and deleted from every storage', () => {
  const payload = print.buildPrintPayload({
    title: 'T',
    lang: 'ar',
    summary: 'S',
    columns: [{ header: 'A', value: () => 'a' }],
    rows: [{}],
    total: 1,
    capped: false,
  })
  const id = 'abcd1234-ef56'
  const own = memoryStorage({ 'em.print-export.old-leftover-1': 'x' })
  const opener = memoryStorage()
  print.storePrintPayload([own, opener, null], id, payload)
  // An earlier export's leftover is pruned when a new one is stored.
  assert.equal(own.getItem('em.print-export.old-leftover-1'), null)
  assert.ok(own.getItem(print.printExportStorageKey(id)))
  assert.ok(opener.getItem(print.printExportStorageKey(id)))

  const taken = print.takePrintPayload([own, opener], id)
  assert.equal(taken.title, 'T')
  assert.equal(own.getItem(print.printExportStorageKey(id)), null)
  assert.equal(opener.getItem(print.printExportStorageKey(id)), null)
  // A second read in the same page (StrictMode) still gets it.
  assert.equal(print.takePrintPayload([own], id).title, 'T')
  // Another id, or a malformed one, finds nothing.
  assert.equal(print.takePrintPayload([own, opener], 'zzzz9999-other'), null)
  assert.equal(print.takePrintPayload([own], 'bad id'), null)
  assert.equal(print.takePrintPayload([own], null), null)
})

test('the payload is found in the opener when the tab has none', () => {
  const payload = print.buildPrintPayload({
    title: 'Opener',
    lang: 'ar',
    summary: 'S',
    columns: [{ header: 'A', value: () => 'a' }],
    rows: [{}],
    total: 1,
    capped: false,
  })
  const id = 'opener-only-1234'
  const blocked = memoryStorage({}, true)
  const opener = memoryStorage()
  print.storePrintPayload([blocked, opener], id, payload)
  assert.equal(print.takePrintPayload([blocked, opener], id).title, 'Opener')
  // No storage accepts it: the export fails visibly instead of a blank page.
  assert.throws(() => print.storePrintPayload([blocked, null], id, payload))
})

test('the print url carries only the random key', () => {
  const id = print.newPrintExportId()
  assert.ok(print.isPrintExportId(id))
  assert.equal(print.printExportUrl('abcd1234'), '/print/export?key=abcd1234')
  assert.equal(print.isPrintExportId('../../x'), false)
})

// --- Previous code search ------------------------------------------------------

const UUID_A = '11111111-2222-4333-8444-555555555555'
const UUID_B = 'AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE'

test('a previous code adds one equipment_id branch to the search', () => {
  assert.equal(previous.previousCodeEquipmentBranch([]), null)
  assert.equal(
    previous.previousCodeEquipmentBranch([UUID_A, UUID_B, UUID_A]),
    `equipment_id.in.(${UUID_A},${UUID_B.toLowerCase()})`,
  )
  // Anything that is not a uuid never reaches the filter tree.
  assert.equal(previous.previousCodeEquipmentBranch(['x),id.neq.(1', '']), null)
  assert.equal(
    previous.withPreviousCodeBranch('equipment_code.ilike.%A1%', [UUID_A]),
    `equipment_code.ilike.%A1%,equipment_id.in.(${UUID_A})`,
  )
  assert.equal(
    previous.withPreviousCodeBranch('equipment_code.ilike.%A1%', []),
    'equipment_code.ilike.%A1%',
  )
  // The branch only widens a search; it never filters on its own.
  assert.equal(previous.withPreviousCodeBranch(null, [UUID_A]), null)
})

test('the export reuses the ids the list resolved for the same term', () => {
  const resolved = { term: 'A115', ids: [UUID_A] }
  assert.deepEqual(
    plain(previous.reusablePreviousCodeIds(resolved, '  A115 ')),
    [UUID_A],
  )
  assert.equal(previous.reusablePreviousCodeIds(resolved, 'A116'), null)
  assert.equal(previous.reusablePreviousCodeIds(null, 'A115'), null)
  assert.deepEqual(plain(previous.reusablePreviousCodeIds(null, '   ')), [])
  // Arabic-Indic digits are searched as ASCII, like the list search.
  assert.equal(previous.previousCodeSearchTerm('A١١٥'), 'A115')
})

test('an empty term never probes and a failed probe throws', async () => {
  let calls = 0
  const client = {
    from() {
      calls += 1
      const chain = {
        select: () => chain,
        ilike: () => chain,
        order: () => chain,
        limit: () => chain,
        abortSignal: () => chain,
        then: (resolve) => resolve({ data: null, error: { message: 'x' } }),
      }
      return chain
    },
  }
  assert.deepEqual(
    plain(await previous.resolvePreviousCodeIds(client, '  ')),
    [],
  )
  assert.equal(calls, 0)
  await assert.rejects(previous.resolvePreviousCodeIds(client, 'A1'), {
    name: 'SupabaseLoadError',
  })
})

// --- Wiring --------------------------------------------------------------------

test('both /logs views add the previous-code branch and reuse it on export', () => {
  const logs = read('src', 'screens', 'admin-home', 'LogsScreen.tsx')
  const table = read('src', 'components', 'visits', 'VisitsTable.tsx')
  for (const source of [logs, table]) {
    assert.match(source, /withPreviousCodeBranch\(/)
    assert.match(source, /resolvePreviousCodeIds\(supabase, /)
    assert.match(
      source,
      /reusablePreviousCodeIds\(resolvedPreviousRef\.current/,
    )
    // The probe runs inside the list request and honours its abort signal.
    assert.match(source, /if \(signal\.aborted\) return/)
    assert.match(source, /head: true,/)
    assert.match(source, /<ExportDialog</)
    assert.doesNotMatch(source, /FileSpreadsheet/)
  }
  // The visits view probes only on the admin log, never on the homes.
  assert.match(table, /if \(isLog\) \{\s+try \{\s+previousIds = await/)
})

test('the print page is a chrome-less route of the signed-in app', () => {
  const app = read('src', 'App.tsx')
  const route = app.indexOf("segments[0] === 'print'")
  assert.ok(route > 0)
  // After the session/profile gate, before any role layout.
  assert.ok(route > app.indexOf('if (!profile) return <AuthScreen />'))
  assert.ok(route < app.indexOf("if (profile.role === 'monitor')"))
  assert.match(
    app,
    /\(profile\.role === 'admin' \|\| profile\.role === 'monitor'\)\s+\)\s+return <PrintExport payloadKey=\{searchParams\.get\('key'\)\} \/>/,
  )
  const page = read('src', 'screens', 'PrintExport.tsx')
  // Display strings only: no data access on the print page.
  assert.doesNotMatch(page, /supabase|fetch\(/)
  assert.match(page, /document\.fonts/)
  assert.match(page, /window\.print\(\)/)
  assert.match(page, /print:hidden/)
  assert.match(page, /\[display:table-header-group\]/)
  assert.match(page, /break-inside-avoid/)
  assert.match(page, /@page \{/)
  assert.match(page, /t\('printBackToLogs'\)/)
  assert.doesNotMatch(
    page,
    /(gray|slate|zinc|neutral|emerald)-\d|#[0-9a-f]{3,6}\b/i,
  )
  const dialog = read('src', 'components', 'data-list', 'ExportDialog.tsx')
  assert.doesNotMatch(
    dialog,
    /(gray|slate|zinc|neutral|emerald)-\d|#[0-9a-f]{3,6}\b/i,
  )
  assert.doesNotMatch(dialog + page, /tracking-|uppercase/)
})

test('the wave-15 strings exist in both languages and follow the Arabic rule', () => {
  const source = read('src', 'i18n', 'translations.ts')
  const blocks = source.match(
    /\/\/ wave-15-export — start[\s\S]*?\/\/ wave-15-export — end/g,
  )
  assert.equal(blocks?.length, 2, 'one delimited block per language')
  const keysOf = (block) =>
    Array.from(block.matchAll(/^\s+(\w+):/gm), (match) => match[1])
  assert.deepEqual(keysOf(blocks[0]), keysOf(blocks[1]))
  const arabic = blocks.find((block) => /[؀-ۿ]/.test(block))
  assert.ok(arabic)
  assert.ok(!/[أإآ]/.test(arabic))
  assert.match(arabic, /exportScopeCurrent: 'السجلات حسب الفلتر الحالي'/)
  assert.match(arabic, /exportScopeAll: 'كل السجلات'/)
  assert.match(arabic, /exportSelectAll: 'تحديد الكل'/)
  assert.match(arabic, /exportBasicOnly: 'الاساسية فقط'/)
  assert.match(arabic, /exportClearAll: 'الغاء الكل'/)
  assert.match(arabic, /printAction: 'طباعة \/ حفظ PDF'/)
  for (const key of [
    'exportSubmit',
    'exportCappedBefore',
    'printMissingTitle',
    'printMissingDesc',
  ])
    assert.match(arabic, new RegExp(`\\b${key}:`))
})

// --- wave-15-export-fields: every field ---------------------------------------

test('a saved choice keeps unticked columns and selects columns added later', () => {
  const storage = memoryStorage()
  const before = COLUMNS.slice(0, 3) // code, company, driver
  // The user unticks «company» while the list had three columns.
  options.writeColumnSelection(
    storage,
    'logs',
    'xlsx',
    ['code', 'driver'],
    before,
  )
  const saved = JSON.parse(storage.getItem('em.export-columns.logs.xlsx'))
  assert.deepEqual(saved, {
    v: 2,
    known: ['code', 'company', 'driver'],
    selected: ['code', 'driver'],
  })
  // A release adds «date» and «chassis»: both come in ticked, «company»
  // stays unticked.
  const after = [
    ...COLUMNS,
    { key: 'chassis', header: 'Chassis', value: () => '' },
  ]
  assert.deepEqual(
    plain(options.readColumnSelection(storage, 'logs', 'xlsx', after)),
    ['code', 'driver', 'date', 'chassis'],
  )
  // A removed column disappears from the selection.
  assert.deepEqual(
    plain(
      options.readColumnSelection(storage, 'logs', 'xlsx', [
        COLUMNS[0],
        COLUMNS[2],
      ]),
    ),
    ['code', 'driver'],
  )
})

test('the first wave-15 format (a plain array) resets to every column', () => {
  // It never recorded which columns existed, so a new column cannot be told
  // from an unticked one: every column, rather than a silently hidden one.
  const storage = memoryStorage({
    'em.export-columns.logs.pdf': JSON.stringify(['code', 'date']),
  })
  assert.deepEqual(
    plain(options.readColumnSelection(storage, 'logs', 'pdf', COLUMNS)),
    ['code', 'company', 'driver', 'date'],
  )
  for (const value of [
    { v: 1, known: [], selected: [] },
    { v: 2, known: 'code', selected: [] },
    { v: 2, known: [], selected: [3] },
    null,
  ])
    assert.equal(options.resolveStoredSelection(COLUMNS, value).length, 4)
  // A stored v2 choice still keeps the mandatory columns.
  assert.deepEqual(
    plain(
      options.resolveStoredSelection(COLUMNS, {
        v: 2,
        known: ['code', 'company', 'driver', 'date'],
        selected: [],
      }),
    ),
    ['code', 'date'],
  )
})

test('the checklist groups consecutive columns under one heading', () => {
  const groups = options.groupExportColumns([
    { key: 'a', group: 'G1' },
    { key: 'b', group: 'G1' },
    { key: 'c', group: 'G2' },
    { key: 'd' },
  ])
  assert.deepEqual(
    plain(
      groups.map((group) => [
        group.label,
        group.columns.map((column) => column.key),
      ]),
    ),
    [
      ['G1', ['a', 'b']],
      ['G2', ['c']],
      ['', ['d']],
    ],
  )
  const movement = movementExcel.movementExportColumns(t, 'ar')
  const visit = visits.visitExportColumns(t, 'ar')
  // Every column of both views is grouped, and each group appears once.
  for (const columns of [movement, visit]) {
    assert.ok(columns.every((column) => column.group))
    const labels = options
      .groupExportColumns(columns)
      .map((group) => group.label)
    assert.equal(new Set(labels).size, labels.length)
  }
})

test('both views export the company and the project in Arabic and English', () => {
  const pairs = ['company_ar', 'company_en', 'project_ar', 'project_en']
  const movement = movementExcel.movementExportColumns(t, 'ar')
  const visit = visits.visitExportColumns(t, 'ar')
  for (const columns of [movement, visit]) {
    const keys = columns.map((column) => column.key)
    assert.deepEqual(
      plain(keys.filter((key) => pairs.includes(key))),
      pairs,
      'Arabic then English, company then project',
    )
    assert.ok(!keys.includes('company') && !keys.includes('project'))
    for (const key of [
      'chassis_number',
      'owner',
      'supplier',
      'contractor_code',
      'context',
      'workshop_purpose',
      'exit_purpose',
      'driver_name',
      'driver_mobile',
    ])
      assert.ok(keys.includes(key), key)
  }
  const movementKeys = movement.map((column) => column.key)
  for (const key of [
    'foreman',
    'recorded_at',
    'created_at',
    'notes',
    'odometer_reading',
  ])
    assert.ok(movementKeys.includes(key), key)
  const visitKeys = visit.map((column) => column.key)
  for (const key of ['entry_by', 'exit_by', 'entry_at', 'exit_at', 'duration'])
    assert.ok(visitKeys.includes(key), key)
  // The owner cell is the one shared label in both files.
  assert.equal(visits.visitOwnerLabel, fields.exportOwnerLabel)
})

/** A fake Supabase client that records each query and answers it. */
function recordingClient(answer) {
  const calls = []
  return {
    calls,
    from(table) {
      const call = { table, select: null, ids: null, column: null }
      calls.push(call)
      const chain = {
        select(columns) {
          call.select = columns
          return chain
        },
        in(column, ids) {
          call.column = column
          call.ids = ids
          return chain
        },
        abortSignal: () => chain,
        then: (resolve, reject) =>
          Promise.resolve(answer(call)).then(resolve, reject),
      }
      return chain
    },
  }
}

test('one shared equipment lookup gives the supplier and the chassis', async () => {
  const ids = Array.from({ length: 230 }, (_, index) => `e${index}`)
  const client = recordingClient((call) => ({
    data: call.ids.map((id) => ({
      id,
      chassis_number: id === 'e1' ? ' CH-1 ' : null,
      lessor: id === 'e2' ? { name: 'Gulf' } : null,
    })),
    error: null,
  }))
  const result = await fields.loadEquipmentExportDetails(client, [
    ...ids,
    'e1',
    null,
    '',
  ])
  // One request per chunk of at most 100 distinct ids, nothing else.
  assert.equal(client.calls.length, 3)
  for (const call of client.calls) {
    assert.equal(call.table, 'equipment')
    assert.equal(call.select, 'id,chassis_number,lessor:lessors(name)')
    assert.equal(call.column, 'id')
    assert.ok(call.ids.length <= fields.EXPORT_LOOKUP_CHUNK_SIZE)
  }
  assert.equal(client.calls.flatMap((call) => call.ids).length, 230)
  assert.equal(result.chassisByEquipment.get('e1'), 'CH-1')
  assert.equal(result.supplierByEquipment.get('e2'), 'Gulf')
  assert.equal(result.supplierByEquipment.has('e1'), false)
  // No ids, no request.
  const idle = recordingClient(() => ({ data: [], error: null }))
  await fields.loadEquipmentExportDetails(idle, [])
  assert.equal(idle.calls.length, 0)
})

test('the shared lookups throw on a failed query instead of exporting blanks', async () => {
  const failing = recordingClient(() => ({
    data: null,
    error: { message: 'x' },
  }))
  await assert.rejects(fields.loadEquipmentExportDetails(failing, ['e1']), {
    name: 'SupabaseLoadError',
  })
  await assert.rejects(fields.loadDriverMobiles(failing, ['d1']), {
    name: 'SupabaseLoadError',
  })
  await assert.rejects(fields.loadProfileNames(failing, ['u1']), {
    name: 'SupabaseLoadError',
  })
  await assert.rejects(fields.loadDriverChanges(failing, ['m1']), {
    name: 'SupabaseLoadError',
  })
  const names = recordingClient((call) => ({
    data: call.ids.map((id) => ({ id, full_name: ` ${id} name ` })),
    error: null,
  }))
  const map = await fields.loadProfileNames(names, ['u1', 'u1', null])
  assert.equal(names.calls[0].table, 'profile_names')
  assert.equal(names.calls[0].select, 'id,full_name')
  assert.deepEqual(plain(names.calls[0].ids), ['u1'])
  assert.equal(map.get('u1'), 'u1 name')
})

test('both /logs exports use the shared lookups, not their own queries', () => {
  const logs = read('src', 'screens', 'admin-home', 'LogsScreen.tsx')
  const table = read('src', 'components', 'visits', 'VisitsTable.tsx')
  for (const source of [logs, table]) {
    assert.match(source, /loadEquipmentExportDetails\(\s*supabase,/)
    assert.match(source, /loadDriverMobiles\(supabase, /)
    assert.match(source, /loadDriverChanges\(/)
    assert.doesNotMatch(source, /\.from\('equipment'\)/)
    assert.doesNotMatch(source, /\.from\('drivers'\)/)
  }
  assert.match(table, /loadProfileNames\(/)
  assert.match(table, /exit_supervisor_id/)
  assert.match(logs, /withCurrentMovementDrivers\(/)
})

test('the column list is compact: small checkboxes, 12 px, 2 then 3 columns', () => {
  const dialog = read('src', 'components', 'data-list', 'ExportDialog.tsx')
  assert.match(dialog, /size="sm"\s+label=\{column\.header\}/)
  assert.match(dialog, /grid grid-cols-2 gap-x-3 sm:grid-cols-3/)
  assert.match(dialog, /groupExportColumns\(columns\)/)
  assert.match(dialog, /text-xs font-semibold text-muted/)
  assert.match(
    dialog,
    /writeColumnSelection\(\s*localStore\(\),\s*listId,\s*fileType,\s*normalized,\s*columns,?\s*\)/,
  )
  const checkbox = read('src', 'components', 'ui', 'Checkbox.tsx')
  assert.match(checkbox, /size === 'sm' \? 'h-4 w-4 rounded'/)
  assert.match(checkbox, /size === 'sm' \? 'text-xs leading-tight'/)
  // A wide print selection drops to 10 px and wraps its headers.
  const page = read('src', 'screens', 'PrintExport.tsx')
  assert.match(page, /const COMPACT_FROM_COLUMNS = 14/)
  assert.match(page, /'text-\[10px\]' : 'text-\[11px\]'/)
  assert.match(page, /break-words border bg-surface-hover/)
})

test('the wave-15-export-fields strings exist in both languages', () => {
  const source = read('src', 'i18n', 'translations.ts')
  const blocks = source.match(
    /\/\/ wave-15-export-fields — start[\s\S]*?\/\/ wave-15-export-fields — end/g,
  )
  assert.equal(blocks?.length, 2, 'one delimited block per language')
  const keysOf = (block) =>
    Array.from(block.matchAll(/^\s+(\w+):/gm), (match) => match[1])
  assert.deepEqual(keysOf(blocks[0]), keysOf(blocks[1]))
  const arabic = blocks.find((block) => /[؀-ۿ]/.test(block))
  assert.ok(arabic)
  assert.ok(!/[أإآ]/.test(arabic))
  assert.match(arabic, /exportColWorkshopPurpose: 'غرض دخول الورشة'/)
})
