const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

// Loads a src/lib module, resolving its `@/lib/...` imports to the real files,
// so the export helpers are exercised exactly as the screens use them. `xlsx`
// is the one real dependency these modules are allowed to pull in; everything
// else must be a project module or a type-only import (which is erased).
function loadLibModule(name, cache = new Map()) {
  if (cache.has(name)) return cache.get(name)
  const file = path.join(__dirname, '..', 'src', 'lib', `${name}.ts`)
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
        const relative = /^\.\/(.+)$/.exec(request)
        if (relative) return loadLibModule(relative[1], cache)
        throw new Error(`Unexpected module: ${request}`)
      },
    },
    { filename: file },
  )
  return exports
}

const cache = new Map()
const excel = loadLibModule('excel', cache)
const movementExcel = loadLibModule('movementExcel', cache)
const exporter = loadLibModule('adminHomeExport', cache)

// A stand-in for the i18n `t`: the key comes back unchanged, so a test can
// assert which key a column asks for without pinning the Arabic wording, and
// the few keys whose value matters are spelled out below.
const LABELS = {
  entry: 'دخول',
  exit: 'خروج',
  logsSites: 'المواقع',
  logsWorkshop: 'الورشة',
  maintenancePurpose: 'صيانة',
  parkingPurpose: 'انتظار',
}
const t = (key) => LABELS[key] ?? key

// The helpers run in their own vm realm, so their arrays are not
// reference-equal to this file's `Array`; comparing the plain data avoids it.
const plain = (value) => JSON.parse(JSON.stringify(value ?? null))

/** Reads a Saudi-time serial back as `dd/mm/yyyy hh:mm`, the display format. */
function readSerial(serial) {
  const EXCEL_EPOCH_DAYS = 25569
  const totalMinutes = Math.round((serial - EXCEL_EPOCH_DAYS) * 24 * 60)
  const at = new Date(totalMinutes * 60000)
  const pad = (value) => String(value).padStart(2, '0')
  return `${pad(at.getUTCDate())}/${pad(at.getUTCMonth() + 1)}/${at.getUTCFullYear()} ${pad(at.getUTCHours())}:${pad(at.getUTCMinutes())}`
}

// --- Saudi-time date cells -------------------------------------------------

test('a timestamp becomes a Saudi-time Excel date cell, not a local one', () => {
  // 21:30 UTC on 23 Sep is already 00:30 on 24 Sep in Riyadh (UTC+03:00).
  const serial = excel.saudiExcelSerial('2026-09-23T21:30:00Z')
  assert.equal(readSerial(serial), '24/09/2026 00:30')
  // Midday keeps the same calendar day, shifted by exactly three hours.
  assert.equal(
    readSerial(excel.saudiExcelSerial('2026-09-23T09:05:00Z')),
    '23/09/2026 12:05',
  )
})

test('a missing or unparseable timestamp becomes an empty cell', () => {
  assert.equal(excel.saudiExcelSerial(null), null)
  assert.equal(excel.saudiExcelSerial(undefined), null)
  assert.equal(excel.saudiExcelSerial(''), null)
  assert.equal(excel.saudiExcelSerial('not a date'), null)
})

test('the display format is the one the owner asked for', () => {
  assert.equal(excel.EXCEL_DATETIME_FORMAT, 'dd/mm/yyyy hh:mm')
})

test('the autofilter can name a column past Z', () => {
  assert.equal(excel.excelColumnLetter(0), 'A')
  assert.equal(excel.excelColumnLetter(11), 'L')
  assert.equal(excel.excelColumnLetter(25), 'Z')
  assert.equal(excel.excelColumnLetter(26), 'AA')
})

// --- the generic sheet builder --------------------------------------------

test('sheetAoa writes the headers first and converts date columns', () => {
  const columns = [
    { header: 'code', value: (row) => row.code },
    { header: 'when', type: 'date', value: (row) => row.when },
  ]
  const aoa = excel.sheetAoa(columns, [
    { code: 'A001', when: '2026-09-23T21:30:00Z' },
    { code: null, when: null },
  ])
  assert.deepEqual(plain(aoa[0]), ['code', 'when'])
  assert.equal(aoa[1][0], 'A001')
  assert.equal(readSerial(aoa[1][1]), '24/09/2026 00:30')
  // A blank cell is written as a blank cell: no "null", and no em dash, which
  // in a spreadsheet would block filtering and sorting.
  assert.deepEqual(plain(aoa[2]), [null, null])
})

// --- the movement log export ----------------------------------------------

const siteEntry = {
  equipment_code: 'A001',
  equipment_type: 'Crane',
  equipment_plate_number: '1234-ABC',
  movement_type: 'entry',
  movement_context: 'site',
  contractor_equipment_code: 'C-9',
  company_name_ar: 'شركة',
  company_name_en: 'Company',
  project_name_ar: 'مشروع',
  project_name_en: 'Project',
  driver_name: 'سالم',
  supervisor_name: 'فورمان',
  notes: 'ملاحظة',
  recorded_at: '2026-09-23T09:05:00Z',
}

test('the movement export has Arabic headers in the table column order', () => {
  const columns = movementExcel.movementExportColumns(t, 'ar')
  assert.deepEqual(plain(columns.map((column) => column.header)), [
    'equipmentCodeLabel',
    'equipmentType',
    'plateNumber',
    'movementType',
    'logsColContext',
    'company',
    'project',
    'contractorEquipmentCode',
    'driverName',
    'logsColForeman',
    'notes',
    'recordedAt',
  ])
  // Every column carries a width, so no exported sheet opens with clipped
  // columns the reader has to widen by hand.
  assert.ok(columns.every((column) => typeof column.width === 'number'))
})

test('badges are exported as plain text, and the time as a Saudi date cell', () => {
  const columns = movementExcel.movementExportColumns(t, 'ar')
  const [row] = excel.sheetAoa(columns, [siteEntry]).slice(1)
  assert.equal(row[3], 'دخول')
  assert.equal(row[4], 'المواقع')
  assert.equal(readSerial(row[11]), '23/09/2026 12:05')

  const [exitRow] = excel
    .sheetAoa(columns, [{ ...siteEntry, movement_type: 'exit' }])
    .slice(1)
  assert.equal(exitRow[3], 'خروج')
})

test('a workshop movement exports its purpose as words', () => {
  const columns = movementExcel.movementExportColumns(t, 'ar')
  const workshop = {
    ...siteEntry,
    movement_context: 'workshop',
    workshop_purpose: 'maintenance',
  }
  assert.equal(excel.sheetAoa(columns, [workshop])[1][4], 'صيانة')
  assert.equal(
    excel.sheetAoa(columns, [
      { ...workshop, workshop_purpose: 'parking' },
    ])[1][4],
    'انتظار',
  )
  // A workshop row with no purpose recorded still says where it happened.
  assert.equal(
    excel.sheetAoa(columns, [{ ...workshop, workshop_purpose: null }])[1][4],
    'الورشة',
  )
})

test('a driverless site entry exports a blank driver cell', () => {
  // The driver became optional on a site ENTRY on 2026-09-23 (migration 0103).
  const columns = movementExcel.movementExportColumns(t, 'ar')
  const aoa = excel.sheetAoa(columns, [{ ...siteEntry, driver_name: null }])
  assert.equal(aoa[1][8], '')
})

test('company and project follow the interface language', () => {
  const arabic = excel.sheetAoa(movementExcel.movementExportColumns(t, 'ar'), [
    siteEntry,
  ])[1]
  assert.equal(arabic[5], 'شركة')
  const english = excel.sheetAoa(movementExcel.movementExportColumns(t, 'en'), [
    siteEntry,
  ])[1]
  assert.equal(english[5], 'Company')
  // A name missing in the chosen language falls back to the other one, and a
  // name missing in both stays blank rather than becoming an em dash.
  const fallback = excel.sheetAoa(
    movementExcel.movementExportColumns(t, 'en'),
    [
      {
        ...siteEntry,
        company_name_en: null,
        project_name_ar: null,
        project_name_en: null,
      },
    ],
  )[1]
  assert.equal(fallback[5], 'شركة')
  assert.equal(fallback[6], '')
})

test('the file name carries the tab and the Saudi calendar day', () => {
  assert.equal(
    movementExcel.movementExportFileName('site', '2026-09-23T09:05:00Z'),
    'movements-site-20260923.xlsx',
  )
  // Exported at 00:30 Riyadh: the file belongs to the new Saudi day, not to
  // the UTC day the browser clock would have used.
  assert.equal(
    movementExcel.movementExportFileName('workshop', '2026-09-23T21:30:00Z'),
    'movements-workshop-20260924.xlsx',
  )
  assert.equal(
    movementExcel.movementExportFileName('all', '2026-01-05T06:00:00Z'),
    'movements-all-20260105.xlsx',
  )
})

// --- the cap the export walks with ----------------------------------------

test('the export reports a truncated file instead of a silently short one', async () => {
  // The log export walks the same helper the admin home export uses, with the
  // 500-row page size, so a filter wider than the cap must come back flagged.
  const collected = await exporter.collectAllPages(
    async (page, pageSize) => ({
      rows: Array.from({ length: pageSize }, (_, index) => ({
        id: `${page}-${index}`,
      })),
      total: 12000,
    }),
    { pageSize: exporter.OUTSIDE_EXPORT_PAGE_SIZE },
  )
  assert.equal(collected.rows.length, exporter.OUTSIDE_EXPORT_MAX_ROWS)
  assert.equal(collected.total, 12000)
  assert.equal(collected.capped, true)
})
