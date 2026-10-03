const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

// Loads src/lib modules as the app does; `xlsx-js-style` is the one real
// library the styled writer is allowed to import.
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
        if (request === 'xlsx-js-style') return require('xlsx-js-style')
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
const sheet = loadLibModule('excelSheet', cache)
const writer = loadLibModule('excelExport', cache)
const XLSX = require('xlsx-js-style')

const columns = [
  { header: 'Code', width: 10, value: (row) => row.code },
  { header: 'Notes', width: 30, value: (row) => row.notes },
  { header: 'When', width: 18, type: 'date', value: (row) => row.when },
]
const rows = [
  { code: 'A1', notes: 'first', when: '2026-09-23T21:30:00Z' },
  { code: 'A2', notes: null, when: null },
]

/** Writes the workbook and reads the XML parts back out of the real zip. */
function writtenParts(rtl) {
  const workbook = writer.buildExportWorkbook('Visits', columns, rows, { rtl })
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })
  const zip = XLSX.CFB.read(buffer, { type: 'buffer' })
  const part = (name) => {
    const index = zip.FullPaths.findIndex((entry) => entry.endsWith(name))
    return Buffer.from(zip.FileIndex[index].content).toString('utf8')
  }
  return {
    sheet: part('xl/worksheets/sheet1.xml'),
    styles: part('xl/styles.xml'),
  }
}

test('the writer gives the header a taller row and data rows comfortable height', () => {
  const { sheet: xml } = writtenParts(true)
  assert.match(xml, /<row r="1" ht="30" customHeight="1">/)
  assert.match(xml, /<row r="2" ht="24" customHeight="1">/)
  assert.match(xml, /<row r="3" ht="24" customHeight="1">/)
})

test('the writer pads, centers and borders every cell, header included', () => {
  const { styles } = writtenParts(true)
  // Text is read from the right in an Arabic sheet, indented from the border.
  assert.match(
    styles,
    /<alignment horizontal="right" vertical="center" indent="1"\/>/,
  )
  // Dates are centered and vertically centered too.
  assert.match(styles, /<alignment horizontal="center" vertical="center"\/>/)
  assert.match(styles, /<border><left style="thin">/)
  assert.match(styles, /D1D5DB/)
  // The header: bold, light neutral fill.
  assert.match(styles, /F3F4F6/)
  assert.match(styles, /<b\/>/)
})

test('an English sheet reads from the left', () => {
  const { styles } = writtenParts(false)
  assert.match(
    styles,
    /<alignment horizontal="left" vertical="center" indent="1"\/>/,
  )
})

test('an empty value still gets its border and height, and dates keep the format', () => {
  const workbook = writer.buildExportWorkbook('Visits', columns, rows, {
    rtl: true,
  })
  const ws = workbook.Sheets.Visits
  assert.ok(ws.B3.s, 'a blank cell is styled')
  assert.equal(ws.C2.z, sheet.EXCEL_DATETIME_FORMAT)
  assert.equal(ws.C2.t, 'n')
  assert.equal(ws['!autofilter'].ref, 'A1:C3')
  // Columns are a little wider than the content so indented text never clips.
  assert.equal(ws['!cols'][1].wch, 30 + sheet.EXPORT_WIDTH_PADDING)
  assert.equal(workbook.Workbook.Views[0].RTL, true)
})

test('the sheet is marked right-to-left in the written file', () => {
  assert.match(writtenParts(true).sheet, /rightToLeft="1"/)
  assert.doesNotMatch(writtenParts(false).sheet, /rightToLeft="1"/)
})

test('no saturated color is used by the sheet look', () => {
  const style = sheet.exportCellStyle('header', true)
  const colors = [
    style.font.color.rgb,
    style.fill.fgColor.rgb,
    style.border.top.color.rgb,
  ]
  for (const hex of colors) {
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16))
    assert.ok(Math.max(r, g, b) - Math.min(r, g, b) <= 24, hex)
  }
})
