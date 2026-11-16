const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

// Owner 2026-11-16: «اعمدة الايام تكون اخر الاعمدة … المستخلص: عدد الساعات،
// عدد بدون تسجيل، عدد الورشة», and the Excel export of the PO list «حسب
// المعدات». The file the visits export writes, and the wiring of both.

const root = path.join(__dirname, '..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')

// Loads src/lib modules as the app does; anything outside `@/lib` (types
// only at run time) is an empty module.
function loadLibModule(name, cache = new Map()) {
  if (cache.has(name)) return cache.get(name)
  const file = path.join(root, 'src', 'lib', `${name}.ts`)
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText
  const exports = {}
  cache.set(name, exports)
  // The same realm as the test, so arrays and maps compare as they are.
  new Function('exports', 'require', code)(exports, (request) => {
    if (request === 'xlsx-js-style') return require('xlsx-js-style')
    const alias = /^@\/lib\/(.+)$/.exec(request)
    if (alias) return loadLibModule(alias[1], cache)
    return {}
  })
  return exports
}

const cache = new Map()
const dayExport = loadLibModule('visitDayExport', cache)
const writer = loadLibModule('excelExport', cache)
const sheetLib = loadLibModule('excelSheet', cache)
const XLSX = require('xlsx-js-style')

const NOW = Date.parse('2026-11-16T09:00:00+03:00')
const t = (key) => key
const at = (day, clock = '12:00') => `${day}T${clock}:00+03:00`

const visitRow = (entryId, unit, code, context, from, to, extra = {}) => ({
  entry_id: entryId,
  equipment_id: unit,
  equipment_code: code,
  equipment_type: 'Excavator',
  equipment_plate_number: unit === 'u1' ? '1128XVV' : null,
  equipment_chassis_number: unit === 'u2' ? 'CH-77' : null,
  equipment_ownership_status: 'alazani',
  movement_context: context,
  workshop_purpose: null,
  entry_at: at(from),
  exit_at: to ? at(to) : null,
  ...extra,
})

// u1: an open project visit since 20 September with a maintenance stop on
// 6–8 October. u2: its first visit ever, 5–7 October.
const s1 = visitRow('s1', 'u1', 'A10', 'site', '2026-09-20', null)
const w1 = visitRow('w1', 'u1', 'A10', 'workshop', '2026-10-06', '2026-10-08', {
  workshop_purpose: 'maintenance',
})
const s2 = visitRow('s2', 'u2', 'A2', 'site', '2026-10-05', '2026-10-07')
// A visit of another month: exported, but no part of October.
const old = visitRow('s0', 'u2', 'A2', 'site', '2026-11-03', '2026-11-04')

const built = dayExport.buildVisitDayExport({
  rows: [s1, s2, old],
  monthVisits: [s1, w1, s2],
  seenBefore: new Set(),
  monthKey: '2026-10',
  now: NOW,
  t,
  lang: 'ar',
})

test('the visits sheet: the counts, then one column per day, last', () => {
  const headers = built.trailingColumns.map((column) => column.header)
  assert.deepEqual(headers.slice(0, 2), [
    'exportDaysHours',
    'exportDaysWorkshop',
  ])
  assert.deepEqual(
    headers.slice(2),
    Array.from({ length: 31 }, (_, index) => String(index + 1)),
  )
  const cells = (row) =>
    built.trailingColumns.slice(2).map((column) => column.value(row))
  // The project row: 10 a day, the stop's letter on 6–8, Fridays empty.
  const first = cells(s1)
  assert.deepEqual(first.slice(0, 9), [
    10,
    null,
    10,
    10,
    10,
    'W',
    'W',
    'W',
    null,
  ])
  // 31 days of October less its 5 Fridays and the 3 days of the stop.
  assert.equal(built.trailingColumns[0].value(s1), 230)
  assert.equal(built.trailingColumns[1].value(s1), 3)
  // The first visit ever: 10 on its three days, nothing around it.
  const second = cells(s2)
  assert.deepEqual(second.slice(3, 8), [null, 10, 10, 10, null])
  assert.equal(built.trailingColumns[0].value(s2), 30)
  assert.equal(built.trailingColumns[1].value(s2), 0)
  // A visit outside the month: empty cells and blank counts, not zeros.
  assert.equal(built.trailingColumns[0].value(old), null)
  assert.ok(cells(old).every((cell) => cell === null))
  // Every trailing column is centered and narrow enough for a month.
  assert.ok(built.trailingColumns.every((column) => column.align === 'center'))
})

test('«المستخلص»: one row per unit with the three counts', () => {
  assert.deepEqual(
    built.unitRows.map((row) => row.code),
    ['A2', 'A10'],
  )
  const [u2, u1] = built.unitRows
  assert.equal(u1.plateOrChassis, '1128XVV')
  assert.equal(u2.plateOrChassis, 'CH-77')
  assert.deepEqual(JSON.parse(JSON.stringify(u1.summary)), {
    hours: 230,
    workshopDays: 3,
    unrecordedDays: 0,
  })
  // u2 had not arrived before the 5th (empty), and is unrecorded after the 7th.
  assert.deepEqual(JSON.parse(JSON.stringify(u2.summary)), {
    hours: 30,
    workshopDays: 0,
    unrecordedDays: 24,
  })
  assert.equal(u2.cells[0], '')
  assert.equal(u2.cells[7], 'A')
  const [units, legend] = built.extraSheets
  assert.equal(units.name, 'exportDaysSheetUnits')
  assert.deepEqual(
    units.columns.slice(0, 7).map((column) => column.header),
    [
      'equipmentCodeLabel',
      'equipmentType',
      'exportDaysPlateOrChassis',
      'ownershipStatus',
      'exportDaysHours',
      'exportDaysWorkshop',
      'exportDaysUnrecorded',
    ],
  )
  assert.equal(units.columns.length, 7 + 31)
  assert.equal(legend.name, 'exportDaysSheetLegend')
  assert.ok(legend.rows.some((row) => row.code === '10'))
  assert.ok(legend.rows.some((row) => row.code === 'W'))
})

test('a unit seen before the month is «بدون تسجيل» from the first day', () => {
  const known = dayExport.buildVisitDayExport({
    rows: [s2],
    monthVisits: [s2],
    seenBefore: new Set(['u2']),
    monthKey: '2026-10',
    now: NOW,
    t,
    lang: 'ar',
  })
  assert.equal(known.unitRows[0].summary.unrecordedDays, 28)
  // Only a unit whose month visits all start inside the month is looked up.
  assert.deepEqual(
    Array.from(
      dayExport.unitsNeedingHistory(['u1', 'u2'], [s1, w1, s2], '2026-10'),
    ),
    ['u2'],
  )
})

// Owner 2026-11-16: «ضمّن ايام الورشة في تصدير المشاريع, فقط في اعمدة الايام».
test('the projects export draws the workshop days on the project rows', () => {
  // u3: project A until 28 September, the workshop until 4 October, then
  // project B 4–10 October. Only the project visits are exported.
  const a = visitRow('pa', 'u3', 'B7', 'site', '2026-09-10', '2026-09-28')
  const w = {
    ...visitRow('pw', 'u3', 'B7', 'workshop', '2026-09-28', '2026-10-04', {
      workshop_purpose: 'maintenance',
    }),
    entry_at: at('2026-09-28', '12:30'),
  }
  const b = {
    ...visitRow('pb', 'u3', 'B7', 'site', '2026-10-04', '2026-10-10'),
    entry_at: at('2026-10-04', '12:30'),
  }
  const build = (rows) =>
    dayExport.buildVisitDayExport({
      rows,
      monthVisits: [w, b],
      seenBefore: new Set(['u3']),
      monthKey: '2026-10',
      now: NOW,
      t,
      lang: 'ar',
    })
  const cellsOf = (built, row) =>
    built.trailingColumns.slice(2).map((column) => column.value(row))
  const both = build([a, b])
  // A ended in September, yet the workshop days that followed it are its:
  // 1–3 October (the letter shows on a Friday too), nothing after.
  assert.deepEqual(cellsOf(both, a).slice(0, 5), ['W', 'W', 'W', null, null])
  assert.equal(both.trailingColumns[0].value(a), 0)
  assert.equal(both.trailingColumns[1].value(a), 3)
  // B: its own days only, 4–10 October less Friday the 9th.
  assert.deepEqual(cellsOf(both, b).slice(0, 10), [
    null,
    null,
    null,
    10,
    10,
    10,
    10,
    10,
    null,
    10,
  ])
  assert.equal(both.trailingColumns[0].value(b), 60)
  assert.equal(both.trailingColumns[1].value(b), 0)
  // With A out of the file (and of the month), the stay goes to the next
  // project visit instead of vanishing.
  const alone = build([b])
  assert.deepEqual(cellsOf(alone, b).slice(0, 5), ['W', 'W', 'W', 10, 10])
  assert.equal(alone.trailingColumns[1].value(b), 3)
  // «المستخلص» is the unit's whole month either way.
  assert.deepEqual(JSON.parse(JSON.stringify(both.unitRows[0].summary)), {
    hours: 60,
    workshopDays: 3,
    unrecordedDays: 21,
  })
})

test('the month a list filter names', () => {
  const range = (filter) =>
    JSON.parse(JSON.stringify(dayExport.filterDayRange(filter)))
  assert.deepEqual(
    range({ operator: 'between', value: '2026-09-01', valueTo: '2026-09-30' }),
    { from: '2026-09-01', to: '2026-09-30' },
  )
  assert.deepEqual(range({ operator: 'eq', value: '2026-09-10' }), {
    from: '2026-09-10',
    to: '2026-09-10',
  })
  // An instant is read as its Saudi day.
  assert.deepEqual(
    range({
      operator: 'between',
      value: '2026-08-31T21:00:00.000Z',
      valueTo: '2026-09-30T20:59:59.999Z',
    }),
    { from: '2026-09-01', to: '2026-09-30' },
  )
  assert.deepEqual(range({ operator: 'gte', value: '2026-09-01' }), {
    from: null,
    to: null,
  })
})

test('the file: three right-to-left sheets, numbers as numbers', () => {
  const visitColumns = [
    { header: 'Code', width: 10, value: (row) => row.equipment_code },
    ...built.trailingColumns,
  ]
  const workbook = writer.buildExportWorkbookSheets(
    [
      sheetLib.sheetSpec('Visits', visitColumns, [s1, s2, old]),
      ...built.extraSheets,
    ],
    { rtl: true },
  )
  assert.deepEqual(Array.from(workbook.SheetNames), [
    'Visits',
    'exportDaysSheetUnits',
    'exportDaysSheetLegend',
  ])
  assert.equal(workbook.Workbook.Views.length, 3)
  assert.ok(workbook.Workbook.Views.every((view) => view.RTL === true))
  const visits = workbook.Sheets.Visits
  // D2 = the first day of the first row: a number, centered.
  assert.equal(visits.D2.v, 10)
  assert.equal(visits.D2.t, 'n')
  assert.equal(visits.D2.s.alignment.horizontal, 'center')
  assert.equal(visits.D1.v, '1')
  // I2 = 6 October, the workshop letter.
  assert.equal(visits.I2.v, 'W')
  // The file really writes.
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })
  assert.ok(buffer.length > 1000)
  // Beside a real date column the day cells stay plain numbers: the writer
  // stores a date's format on the style object, so they must not share one
  // (the owner saw 10 as «10/01/1900 00:00» on 2026-11-16).
  const dated = writer.buildExportWorkbookSheets(
    [
      sheetLib.sheetSpec(
        'Visits',
        [
          {
            header: 'Entry',
            type: 'date',
            value: (row) => row.entry_at,
          },
          ...built.trailingColumns,
        ],
        [s1, s2, old],
      ),
    ],
    { rtl: true },
  )
  const back = XLSX.read(
    XLSX.write(dated, { type: 'buffer', bookType: 'xlsx' }),
    { cellNF: true, cellStyles: true },
  ).Sheets.Visits
  assert.equal(back.A2.z, 'dd/mm/yyyy hh:mm')
  // B = hours, C = workshop days, D = day 1, E = day 2 (a Friday, empty).
  for (const address of ['B2', 'C2', 'D2', 'E2', 'D3', 'B3']) {
    assert.equal(back[address].z, 'General', address)
  }
  assert.equal(back.B2.w, '230')
  assert.equal(back.D2.w, '10')
  // A repeated sheet name gets its number instead of failing.
  const twice = writer.buildExportWorkbookSheets([
    sheetLib.sheetSpec('Same', visitColumns, []),
    sheetLib.sheetSpec('Same', visitColumns, []),
  ])
  assert.deepEqual(Array.from(twice.SheetNames), ['Same', 'Same 2'])
})

test('the dialog offers the day columns for Excel only, and writes them last', () => {
  const dialog = read('src/components/data-list/ExportDialog.tsx')
  assert.match(dialog, /dayColumns\?: ExportDayColumnsOption/)
  assert.match(dialog, /fileTypes\?: readonly ExportFileType\[\]/)
  assert.match(dialog, /dayColumns && fileType === 'xlsx'/)
  assert.match(dialog, /dayMonth: withDays \? dayMonth : null/)
  // The chosen columns first, the counts and the days after them.
  assert.match(
    dialog,
    /\[\.\.\.chosen, \.\.\.\(collected\.trailingColumns \?\? \[\]\)\]/,
  )
  assert.match(dialog, /exportSheetsToExcel\(/)
  const table = read('src/components/visits/VisitsTable.tsx')
  assert.match(table, /dayColumns=\{dayColumnsOption\}/)
  assert.match(table, /loadMonthVisits\(/)
  assert.match(table, /loadUnitsSeenBefore\(/)
  assert.match(table, /exportDaysMonth\(ranges, now\)/)
  // The reads are bounded and fail loudly.
  const data = read('src/lib/visitDayExportData.ts')
  assert.match(data, /\.range\(from, from \+ PAGE_SIZE - 1\)/)
  assert.match(data, /if \(error\) throw error/)
  assert.doesNotMatch(data, /select\('\*'\)/)
})

test('the PO list «حسب المعدات» exports to Excel', () => {
  const list = read('src/screens/purchasing/PoUnitsList.tsx')
  assert.match(list, /<ExportDialog<PoUnitRow>/)
  assert.match(list, /fileTypes=\{EXCEL_ONLY\}/)
  assert.match(
    list,
    /const EXCEL_ONLY: readonly ExportFileType\[\] = \['xlsx'\]/,
  )
  // One query builder for the table, the count and the file.
  assert.match(list, /buildQuery\(\{\s*scope,\s*head: true,?\s*\}\)/)
  assert.match(list, /buildQuery\(\{ scope \}\)\.range\(/)
  const columns = loadLibModule('poUnitsExport', cache).poUnitsExportColumns(
    t,
    'ar',
  )
  assert.deepEqual(
    Array.from(columns, (column) => column.key),
    [
      'po_number',
      'approval_status',
      'start_date',
      'party',
      'company',
      'project',
      'equipment_code',
      'equipment_type',
      'plate_number',
      'chassis_number',
      'price',
      'rate_unit',
      'line_note',
      'updated_at',
    ],
  )
  const row = {
    po_number: 'DRAFT-0558',
    approval_status: 'draft',
    start_date: '2026-10-05',
    owner_class: null,
    lessor_name: 'Supplier',
    company_name_ar: 'شركة',
    company_name_en: 'Company',
    project_name_ar: null,
    project_name_en: 'Project',
    equipment_code: 'B12',
    equipment_type: 'Loader',
    equipment_plate_number: null,
    equipment_chassis_number: 'CH-1',
    price: null,
    rate_unit: 'day',
    line_note: ' note ',
    updated_at: '2026-11-10T08:00:00Z',
  }
  const cell = (key) => columns.find((column) => column.key === key).value(row)
  assert.equal(cell('po_number'), 'DRAFT-0558')
  assert.equal(cell('approval_status'), 'supplierPoApprovalPending')
  assert.equal(cell('start_date'), '05/10/2026')
  assert.equal(cell('company'), 'شركة')
  // The other language's name when this one is missing.
  assert.equal(cell('project'), 'Project')
  // An unpriced line is an empty cell, never 0.
  assert.equal(cell('price'), null)
  assert.equal(cell('rate_unit'), 'supplierPoRateUnitDay')
  assert.equal(cell('line_note'), 'note')
})

test('both languages carry the new keys', () => {
  const source = read('src/i18n/translations.ts')
  for (const key of [
    'exportDaysSwitch',
    'exportDaysSwitchHint',
    'exportDaysMonth',
    'exportDaysHours',
    'exportDaysWorkshop',
    'exportDaysUnrecorded',
    'exportDaysPlateOrChassis',
    'exportDaysSheetUnits',
    'exportDaysSheetLegend',
    'exportDaysLegendCode',
    'exportDaysLegendMeaning',
    'exportDaysLegendSite',
    'exportDaysLegendWorkshop',
    'exportDaysLegendUnrecorded',
    'exportDaysLegendEmptyCode',
    'exportDaysLegendEmpty',
    'exportDaysLegendHours',
    'exportDaysLegendUnits',
    'poUnitsExportTitle',
    'poUnitsExportContext',
  ]) {
    const hits = source.match(new RegExp(`^ {4}${key}:`, 'gm')) ?? []
    assert.equal(hits.length, 2, key)
  }
  // New Arabic copy carries no hamza or madda on the alif.
  const block = source.slice(
    source.indexOf('// --- export-days (2026-11-16) ---'),
    source.indexOf('// --- /export-days ---'),
  )
  assert.doesNotMatch(block, /[أإآ]/)
})
