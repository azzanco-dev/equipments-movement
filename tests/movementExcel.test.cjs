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
        if (request === 'xlsx-js-style') return require('xlsx-js-style')
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
  logsSites: 'المشاريع',
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

const MOVEMENT_HEADERS = [
  'equipmentCodeLabel',
  'equipmentType',
  'plateNumber',
  'chassisNumber',
  'ownershipStatus',
  'lessor',
  'contractorEquipmentCode',
  'logsColContext',
  'exportColWorkshopPurpose',
  'movementType',
  'exitPurpose',
  'companyNameAr',
  'companyNameEn',
  'projectNameAr',
  'projectNameEn',
  'driverName',
  'exportColDriverMobile',
  'logsColForeman',
  'recordedAt',
  'createdAt',
  'notes',
  'odometerReading',
]

/** The index of a column in the export, by its header key. */
const at = (header) => {
  const index = MOVEMENT_HEADERS.indexOf(header)
  assert.ok(index >= 0, header)
  return index
}

test('the movement export lists every field, grouped, in a sensible order', () => {
  const columns = movementExcel.movementExportColumns(t, 'ar')
  // wave-15-export-fields: the equipment block (with owner and supplier), the
  // movement, company and project in Arabic then English, the driver, then
  // who recorded it and when, the notes and the odometer.
  assert.deepEqual(
    plain(columns.map((column) => column.header)),
    MOVEMENT_HEADERS,
  )
  // Every column carries a width, so no exported sheet opens with clipped
  // columns the reader has to widen by hand.
  assert.ok(columns.every((column) => typeof column.width === 'number'))
  // Every column has a group heading for the export dialog.
  assert.deepEqual(
    plain(Array.from(new Set(columns.map((column) => column.group)))),
    [
      'exportGroupEquipment',
      'exportGroupMovement',
      'exportGroupCompanyProject',
      'exportGroupDriver',
      'exportGroupRecording',
    ],
  )
  const dates = columns.filter((column) => column.type === 'date')
  assert.deepEqual(plain(dates.map((column) => column.key)), [
    'recorded_at',
    'created_at',
  ])
})

test('badges are exported as plain text, and the time as a Saudi date cell', () => {
  const columns = movementExcel.movementExportColumns(t, 'ar')
  const [row] = excel.sheetAoa(columns, [siteEntry]).slice(1)
  assert.equal(row[at('movementType')], 'دخول')
  assert.equal(row[at('logsColContext')], 'المشاريع')
  assert.equal(row[at('exportColWorkshopPurpose')], '')
  assert.equal(readSerial(row[at('recordedAt')]), '23/09/2026 12:05')
  // No created_at on the row: an empty cell, not a date.
  assert.equal(row[at('createdAt')], null)

  const [exitRow] = excel
    .sheetAoa(columns, [{ ...siteEntry, movement_type: 'exit' }])
    .slice(1)
  assert.equal(exitRow[at('movementType')], 'خروج')
})

test('wave 12: a site exit exports its purpose as words, every other row empty', () => {
  const columns = movementExcel.movementExportColumns(t, 'ar')
  const exit = { ...siteEntry, movement_type: 'exit' }
  const cell = (row) => excel.sheetAoa(columns, [row])[1][at('exitPurpose')]
  assert.equal(
    cell({ ...exit, exit_purpose: 'maintenance' }),
    t('exitPurposeMaintenance'),
  )
  assert.equal(
    cell({ ...exit, exit_purpose: 'work_completed' }),
    t('exitPurposeWorkCompleted'),
  )
  // An exit recorded before migration 0111, or a bad value: empty, no dash.
  assert.equal(cell({ ...exit, exit_purpose: null }), '')
  assert.equal(cell({ ...exit, exit_purpose: 'bogus' }), '')
  assert.equal(cell(exit), '')
  // An entry never carries a purpose, even if a value slipped through.
  assert.equal(cell({ ...siteEntry, exit_purpose: 'maintenance' }), '')
  // The purpose sits right after the movement type.
  assert.equal(at('exitPurpose'), at('movementType') + 1)
})

test('a workshop movement exports its purpose as words', () => {
  const columns = movementExcel.movementExportColumns(t, 'ar')
  const workshop = {
    ...siteEntry,
    movement_context: 'workshop',
    workshop_purpose: 'maintenance',
  }
  const row = (value) => excel.sheetAoa(columns, [value])[1]
  assert.equal(row(workshop)[at('logsColContext')], 'صيانة')
  assert.equal(row(workshop)[at('exportColWorkshopPurpose')], 'صيانة')
  const parking = row({ ...workshop, workshop_purpose: 'parking' })
  assert.equal(parking[at('logsColContext')], 'انتظار')
  assert.equal(parking[at('exportColWorkshopPurpose')], 'انتظار')
  // A workshop row with no purpose recorded still says where it happened.
  const unclassified = row({ ...workshop, workshop_purpose: null })
  assert.equal(unclassified[at('logsColContext')], 'الورشة')
  assert.equal(unclassified[at('exportColWorkshopPurpose')], '')
})

test('a driverless site entry exports a blank driver cell', () => {
  // The driver became optional on a site ENTRY on 2026-09-23 (migration 0103).
  const columns = movementExcel.movementExportColumns(t, 'ar')
  const aoa = excel.sheetAoa(columns, [{ ...siteEntry, driver_name: null }])
  assert.equal(aoa[1][at('driverName')], '')
  assert.equal(aoa[1][at('exportColDriverMobile')], '')
})

test('company and project are written in Arabic and in English, in both languages', () => {
  for (const lang of ['ar', 'en']) {
    const row = excel.sheetAoa(movementExcel.movementExportColumns(t, lang), [
      siteEntry,
    ])[1]
    assert.equal(row[at('companyNameAr')], 'شركة')
    assert.equal(row[at('companyNameEn')], 'Company')
    assert.equal(row[at('projectNameAr')], 'مشروع')
    assert.equal(row[at('projectNameEn')], 'Project')
  }
  // A missing name stays blank rather than borrowing the other language or
  // becoming an em dash.
  const missing = excel.sheetAoa(movementExcel.movementExportColumns(t, 'en'), [
    {
      ...siteEntry,
      company_name_en: null,
      project_name_ar: '  ',
      project_name_en: null,
    },
  ])[1]
  assert.equal(missing[at('companyNameAr')], 'شركة')
  assert.equal(missing[at('companyNameEn')], '')
  assert.equal(missing[at('projectNameAr')], '')
  assert.equal(missing[at('projectNameEn')], '')
})

test('the equipment, owner, supplier and record fields are exported', () => {
  const row = {
    ...siteEntry,
    id: 'm1',
    equipment_id: 'e1',
    equipment_chassis_number: ' CH-77 ',
    equipment_ownership_status: 'external_supplier',
    driver_id: 'd1',
    driver_mobile_number: '0500000001',
    created_at: '2026-09-23T10:00:00Z',
    odometer_reading: 1520,
  }
  const columns = movementExcel.movementExportColumns(t, 'ar', {
    supplierByEquipment: new Map([['e1', 'Gulf Rentals']]),
  })
  const cells = excel.sheetAoa(columns, [row])[1]
  assert.equal(cells[at('chassisNumber')], 'CH-77')
  assert.equal(cells[at('ownershipStatus')], 'adminHomeOwnerExternal')
  assert.equal(cells[at('lessor')], 'Gulf Rentals')
  assert.equal(cells[at('exportColDriverMobile')], '0500000001')
  assert.equal(cells[at('logsColForeman')], 'فورمان')
  assert.equal(readSerial(cells[at('createdAt')]), '23/09/2026 13:00')
  assert.equal(cells[at('notes')], 'ملاحظة')
  assert.equal(cells[at('odometerReading')], 1520)
  // Without the lookup the supplier is simply empty; no odometer, no cell.
  const bare = excel.sheetAoa(movementExcel.movementExportColumns(t, 'ar'), [
    { ...row, odometer_reading: null },
  ])[1]
  assert.equal(bare[at('lessor')], '')
  assert.equal(bare[at('odometerReading')], null)
})

test("a site entry exports its current driver and that driver's mobile", () => {
  const entry = {
    ...siteEntry,
    id: 'm1',
    driver_id: 'd1',
    driver_name: 'سالم',
    driver_mobile_number: '0500000001',
  }
  const exit = { ...entry, id: 'm2', movement_type: 'exit' }
  const workshop = { ...entry, id: 'm3', movement_context: 'workshop' }
  assert.deepEqual(
    plain(movementExcel.movementDriverChangeEntryIds([entry, exit, workshop])),
    ['m1'],
  )
  const change = (over) => ({
    id: 'c1',
    entry_log_id: 'm1',
    new_driver_id: 'd2',
    new_driver_name: 'خالد',
    changed_at: '2026-09-24T10:00:00+00:00',
    ...over,
  })
  const rows = movementExcel.withCurrentMovementDrivers(
    [entry, exit],
    [
      change({ id: 'c1' }),
      change({ id: 'c2', new_driver_id: 'd3', new_driver_name: 'فهد' }),
      // An exit is never rewritten, even if a change names its id.
      change({ id: 'c3', entry_log_id: 'm2', new_driver_name: 'X' }),
    ],
  )
  assert.equal(rows[0].current_driver_name, 'فهد')
  assert.equal(rows[0].current_driver_id, 'd3')
  // The stored snapshot itself stays (the entry driver is immutable).
  assert.equal(rows[0].driver_name, 'سالم')
  assert.equal(rows[1].current_driver_name, undefined)
  assert.deepEqual(plain(movementExcel.changedDriverIds(rows)), ['d3'])

  const columns = movementExcel.movementExportColumns(t, 'ar', {
    mobileByDriver: new Map([['d3', '0555555555']]),
  })
  const [changed, unchanged] = excel.sheetAoa(columns, rows).slice(1)
  assert.equal(changed[at('driverName')], 'فهد')
  assert.equal(changed[at('exportColDriverMobile')], '0555555555')
  assert.equal(unchanged[at('driverName')], 'سالم')
  assert.equal(unchanged[at('exportColDriverMobile')], '0500000001')
  // A changed driver without a known mobile is empty, never the old one's.
  const noMobile = excel.sheetAoa(
    movementExcel.movementExportColumns(t, 'ar'),
    rows,
  )[1]
  assert.equal(noMobile[at('exportColDriverMobile')], '')
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
