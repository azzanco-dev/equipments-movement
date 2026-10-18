// Audit finding em:dep:xlsx-0.18.5:read-untrusted-workbook: a workbook
// comment with ref="__proto__" makes xlsx 0.18.5's `sheet_insert_comments`
// write `Object.prototype.c` in the importer's tab. src/lib/safeWorkbook.ts
// is the one guarded read; this file proves the attack on the raw library
// (control), proves the helper blocks it, and pins that no other read of
// the xlsx libraries exists under src/ or app/.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const XLSX = require('xlsx')

const ROOT = path.join(__dirname, '..')

// Loads src/lib/safeWorkbook.ts as the app sees it. Its two imports are
// type-only (erased). `Object`, `Array` and `Reflect` are the HOST's on
// purpose: xlsx runs in the host realm, so the prototypes the helper guards
// must be the ones the library can reach.
function loadSafeWorkbook() {
  const file = path.join(ROOT, 'src', 'lib', 'safeWorkbook.ts')
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText
  const exports = {}
  vm.runInNewContext(
    code,
    {
      exports,
      Object,
      Array,
      Reflect,
      Error,
      Set,
      String,
      require() {
        throw new Error('safeWorkbook.ts must not import anything at runtime')
      },
    },
    { filename: file },
  )
  return exports
}

const safeWorkbook = loadSafeWorkbook()

// --- A minimal .xlsx built by hand (stored zip, no dependency) -------------

function crc32(bytes) {
  let crc = 0xffffffff
  for (const byte of bytes) {
    let c = (crc ^ byte) & 0xff
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1
    crc = (crc >>> 8) ^ c
  }
  return (crc ^ 0xffffffff) >>> 0
}

/** A zip archive of `entries` ({name: text}) with every entry stored. */
function storedZip(entries) {
  const locals = []
  const centrals = []
  let offset = 0
  for (const [name, text] of Object.entries(entries)) {
    const nameBytes = Buffer.from(name, 'utf8')
    const data = Buffer.from(text, 'utf8')
    const crc = crc32(data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4) // version needed
    local.writeUInt16LE(0, 6) // flags
    local.writeUInt16LE(0, 8) // method: stored
    local.writeUInt16LE(0, 10) // time
    local.writeUInt16LE(0x21, 12) // date (1980-01-01)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBytes.length, 26)
    local.writeUInt16LE(0, 28)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4) // version made by
    central.writeUInt16LE(20, 6) // version needed
    central.writeUInt16LE(0, 8)
    central.writeUInt16LE(0, 10)
    central.writeUInt16LE(0, 12)
    central.writeUInt16LE(0x21, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(nameBytes.length, 28)
    central.writeUInt16LE(0, 30) // extra
    central.writeUInt16LE(0, 32) // comment
    central.writeUInt16LE(0, 34) // disk
    central.writeUInt16LE(0, 36) // internal attributes
    central.writeUInt32LE(0, 38) // external attributes
    central.writeUInt32LE(offset, 42)
    locals.push(local, nameBytes, data)
    centrals.push(central, nameBytes)
    offset += local.length + nameBytes.length + data.length
  }
  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(centrals.length / 2, 8)
  end.writeUInt16LE(centrals.length / 2, 10)
  end.writeUInt32LE(centralSize, 12)
  end.writeUInt32LE(offset, 16)
  end.writeUInt16LE(0, 20)
  return Buffer.concat([...locals, ...centrals, end])
}

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
const NS_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const NS_REL =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const NS_PKG_REL =
  'http://schemas.openxmlformats.org/package/2006/relationships'
const CT_MAIN = 'application/vnd.openxmlformats-officedocument.spreadsheetml'

/**
 * One sheet (header `code`, one row `U001`) and, when `commentRef` is
 * given, a legacy comment on that ref in xl/comments1.xml.
 */
function buildWorkbook(commentRef) {
  const sheetRels = commentRef
    ? `<Relationship Id="rId1" Type="${NS_REL}/comments" Target="../comments1.xml"/>`
    : ''
  const entries = {
    '[Content_Types].xml':
      XML +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      `<Override PartName="/xl/workbook.xml" ContentType="${CT_MAIN}.sheet.main+xml"/>` +
      `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="${CT_MAIN}.worksheet+xml"/>` +
      (commentRef
        ? `<Override PartName="/xl/comments1.xml" ContentType="${CT_MAIN}.comments+xml"/>`
        : '') +
      '</Types>',
    '_rels/.rels':
      XML +
      `<Relationships xmlns="${NS_PKG_REL}">` +
      `<Relationship Id="rId1" Type="${NS_REL}/officeDocument" Target="xl/workbook.xml"/>` +
      '</Relationships>',
    'xl/workbook.xml':
      XML +
      `<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_REL}">` +
      '<sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets>' +
      '</workbook>',
    'xl/_rels/workbook.xml.rels':
      XML +
      `<Relationships xmlns="${NS_PKG_REL}">` +
      `<Relationship Id="rId1" Type="${NS_REL}/worksheet" Target="worksheets/sheet1.xml"/>` +
      '</Relationships>',
    'xl/worksheets/sheet1.xml':
      XML +
      `<worksheet xmlns="${NS_MAIN}" xmlns:r="${NS_REL}">` +
      '<dimension ref="A1:A2"/><sheetData>' +
      '<row r="1"><c r="A1" t="inlineStr"><is><t>code</t></is></c></row>' +
      '<row r="2"><c r="A2" t="inlineStr"><is><t>U001</t></is></c></row>' +
      '</sheetData></worksheet>',
    'xl/worksheets/_rels/sheet1.xml.rels':
      XML + `<Relationships xmlns="${NS_PKG_REL}">${sheetRels}</Relationships>`,
  }
  if (commentRef)
    entries['xl/comments1.xml'] =
      XML +
      `<comments xmlns="${NS_MAIN}"><authors><author>x</author></authors>` +
      `<commentList><comment ref="${commentRef}" authorId="0">` +
      '<text><r><t>polluted</t></r></text></comment></commentList></comments>'
  return storedZip(entries)
}

const hasOwn = (target, key) =>
  Object.prototype.hasOwnProperty.call(target, key)

/** Runs `fn` and always removes `c` from Object.prototype afterwards. */
function withCleanPrototype(fn) {
  try {
    return fn()
  } finally {
    delete Object.prototype.c
    delete Array.prototype.c
  }
}

test('fixture: the hand-built workbook reads as one data row', () => {
  const workbook = XLSX.read(buildWorkbook(), { type: 'buffer' })
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  assert.deepEqual(XLSX.utils.sheet_to_json(sheet, { defval: '' }), [
    { code: 'U001' },
  ])
})

test('control: XLSX.read on the malicious workbook pollutes Object.prototype.c', () => {
  withCleanPrototype(() => {
    assert.equal(hasOwn(Object.prototype, 'c'), false)
    XLSX.read(buildWorkbook('__proto__'), { type: 'buffer' })
    assert.equal(hasOwn(Object.prototype, 'c'), true, 'the raw read polluted')
    assert.deepEqual({}.c.length, 1)
  })
  assert.equal(hasOwn(Object.prototype, 'c'), false)
})

test('dense mode alone keeps the malicious comment off Object.prototype', () => {
  // The raw library with `dense: true` and no guard around it: the comment
  // lands on sheet[-1][-1], a fresh cell, so nothing reaches the prototype.
  withCleanPrototype(() => {
    const workbook = XLSX.read(buildWorkbook('__proto__'), {
      type: 'buffer',
      dense: true,
    })
    assert.equal(hasOwn(Object.prototype, 'c'), false)
    assert.equal({}.c, undefined)
    const sheet = workbook.Sheets[workbook.SheetNames[0]]
    assert.equal(Array.isArray(sheet), true, 'the sheet is dense')
    assert.equal(hasOwn(sheet, '-1'), true)
    assert.deepEqual(sheet[-1][-1].c.length, 1)
    // ...but the widened range breaks the row conversion the importers use.
    assert.throws(
      () => XLSX.utils.sheet_to_json(sheet, { defval: '' }),
      /invalid column -1/,
    )
  })
})

test('readWorkbookSafely refuses the malicious workbook and leaves Object.prototype untouched', () => {
  withCleanPrototype(() => {
    assert.throws(
      () =>
        safeWorkbook.readWorkbookSafely(XLSX, buildWorkbook('__proto__'), {
          type: 'buffer',
        }),
      (error) =>
        safeWorkbook.isUnsafeWorkbookError(error) &&
        error.findings.join() === 'Sheet1[-1]',
    )
    assert.equal(hasOwn(Object.prototype, 'c'), false)
    assert.equal({}.c, undefined)
  })
  assert.equal(hasOwn(Object.prototype, 'c'), false)
})

test('readWorkbookSafely: "constructor" as a ref does not reach Object either', () => {
  withCleanPrototype(() => {
    assert.throws(
      () =>
        safeWorkbook.readWorkbookSafely(XLSX, buildWorkbook('constructor'), {
          type: 'buffer',
        }),
      (error) => safeWorkbook.isUnsafeWorkbookError(error),
    )
    assert.equal(hasOwn(Object, 'c'), false)
    assert.equal(hasOwn(Object.prototype, 'c'), false)
  })
})

test('a comment on a real cell is accepted and read like before', () => {
  const sparse = XLSX.read(buildWorkbook('A2'), { type: 'buffer' })
  const dense = safeWorkbook.readWorkbookSafely(XLSX, buildWorkbook('A2'), {
    type: 'buffer',
  })
  const rowsOf = (wb) =>
    XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' })
  assert.deepEqual(rowsOf(dense), [{ code: 'U001' }])
  assert.deepEqual(rowsOf(dense), rowsOf(sparse))
  assert.equal(dense.Sheets.Sheet1[1][0].c[0].t, 'polluted')
})

test('dense mode does not change the rows the importers get', () => {
  const sparse = XLSX.read(buildWorkbook(), { type: 'buffer' })
  const dense = safeWorkbook.readWorkbookSafely(XLSX, buildWorkbook(), {
    type: 'buffer',
  })
  const rowsOf = (wb) =>
    XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' })
  assert.deepEqual(rowsOf(dense), rowsOf(sparse))
  assert.deepEqual(dense.SheetNames, sparse.SheetNames)
})

test('readWorkbookSafely forwards the caller options, defaults type and forces dense', () => {
  const seen = []
  const reader = {
    read(data, opts) {
      seen.push({ data, opts })
      return { SheetNames: [], Sheets: {} }
    },
  }
  const bytes = new Uint8Array([1, 2, 3])
  safeWorkbook.readWorkbookSafely(reader, bytes)
  safeWorkbook.readWorkbookSafely(reader, bytes, {
    type: 'buffer',
    cellDates: false,
    dense: false,
  })
  assert.equal(seen[0].data, bytes)
  // Spread: the options object is created in the helper's VM realm.
  assert.deepEqual({ ...seen[0].opts }, { type: 'array', dense: true })
  assert.deepEqual(
    { ...seen[1].opts },
    { type: 'buffer', cellDates: false, dense: true },
  )
})

test('the guard removes a key a read added to Object.prototype and throws UnsafeWorkbookError', () => {
  withCleanPrototype(() => {
    const reader = {
      read() {
        Object.prototype.c = []
        return { SheetNames: [], Sheets: {} }
      },
    }
    assert.throws(
      () => safeWorkbook.readWorkbookSafely(reader, new Uint8Array()),
      (error) => {
        assert.equal(safeWorkbook.isUnsafeWorkbookError(error), true)
        assert.equal(error instanceof safeWorkbook.UnsafeWorkbookError, true)
        assert.equal(error.name, 'UnsafeWorkbookError')
        assert.deepEqual([...error.findings], ['Object.prototype.c'])
        return true
      },
    )
    assert.equal(hasOwn(Object.prototype, 'c'), false, 'the key was removed')
  })
})

test('the guard also covers Array.prototype and a read that throws after polluting', () => {
  withCleanPrototype(() => {
    const reader = {
      read() {
        Array.prototype.c = 1
        throw new Error('broken file')
      },
    }
    assert.throws(
      () => safeWorkbook.readWorkbookSafely(reader, new Uint8Array()),
      (error) =>
        safeWorkbook.isUnsafeWorkbookError(error) &&
        error.findings.join() === 'Array.prototype.c',
    )
    assert.equal(hasOwn(Array.prototype, 'c'), false)
  })
})

test('a clean read that throws rethrows its own error', () => {
  const reader = {
    read() {
      throw new Error('not a workbook')
    },
  }
  assert.throws(
    () => safeWorkbook.readWorkbookSafely(reader, new Uint8Array()),
    { message: 'not a workbook' },
  )
})

test('workbookReadErrorKey maps the unsafe error to unsafeWorkbookFile only', () => {
  const unsafe = new safeWorkbook.UnsafeWorkbookError(['Object.prototype.c'])
  assert.equal(
    safeWorkbook.workbookReadErrorKey(unsafe, 'invalidFile'),
    'unsafeWorkbookFile',
  )
  assert.equal(
    safeWorkbook.workbookReadErrorKey(
      { name: 'UnsafeWorkbookError' },
      'invalidFile',
    ),
    'unsafeWorkbookFile',
  )
  assert.equal(
    safeWorkbook.workbookReadErrorKey(new Error('x'), 'invalidFile'),
    'invalidFile',
  )
  assert.equal(safeWorkbook.workbookReadErrorKey(undefined, 'x'), 'x')
  assert.equal(safeWorkbook.isUnsafeWorkbookError(null), false)
})

test('the translation key exists in Arabic and English', () => {
  const source = fs.readFileSync(
    path.join(ROOT, 'src', 'i18n', 'translations.ts'),
    'utf8',
  )
  const matches = source.match(/^\s+unsafeWorkbookFile:/gm) ?? []
  assert.equal(matches.length, 2)
  assert.match(
    source,
    /unsafeWorkbookFile: 'الملف يحتوي محتوى غير امن ولا يمكن استيراده\.'/,
  )
})

// --- Static check: one guarded read in the whole app ------------------------

function sourceFiles(dir, found = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules') sourceFiles(full, found)
    } else if (/\.(ts|tsx|js|mjs|cjs)$/.test(entry.name)) found.push(full)
  }
  return found
}

const XLSX_IMPORT =
  /(?:from\s*|import\s*\(\s*|require\s*\(\s*)['"]xlsx(?:-js-style)?['"]/
const READ_CALL = /\.\s*read(?:File|FileSync|Sync)?\s*\(/

const IMPORTERS = [
  'src/lib/movementExcel.ts',
  'src/lib/excel.ts',
  'src/lib/driverExcel.ts',
  'src/lib/equipmentUpdateExcel.ts',
  'src/screens/AdminSettings.tsx',
]

test('no file under src/ or app/ reads a workbook except src/lib/safeWorkbook.ts', () => {
  const offenders = []
  const xlsxUsers = []
  for (const dir of ['src', 'app']) {
    for (const file of sourceFiles(path.join(ROOT, dir))) {
      const rel = path.relative(ROOT, file).replace(/\\/g, '/')
      const source = fs.readFileSync(file, 'utf8')
      if (
        /\bXLSX\s*\.\s*read\w*\s*\(/.test(source) &&
        rel !== 'src/lib/safeWorkbook.ts'
      )
        offenders.push(`${rel} (XLSX.read)`)
      if (!XLSX_IMPORT.test(source)) continue
      xlsxUsers.push(rel)
      if (rel === 'src/lib/safeWorkbook.ts') continue
      if (READ_CALL.test(source)) offenders.push(rel)
    }
  }
  assert.deepEqual(offenders, [])
  for (const importer of IMPORTERS)
    assert.ok(xlsxUsers.includes(importer), `${importer} still imports xlsx`)
})

test('every importer reads through readWorkbookSafely and safeWorkbook.ts imports xlsx as a type only', () => {
  for (const importer of IMPORTERS) {
    const source = fs.readFileSync(path.join(ROOT, importer), 'utf8')
    assert.match(source, /from '@\/lib\/safeWorkbook'/, importer)
    const reads = source.match(/readWorkbookSafely\(/g) ?? []
    assert.equal(
      reads.length,
      importer === 'src/lib/excel.ts' ? 3 : 1,
      `${importer} reads`,
    )
  }
  const helper = fs.readFileSync(
    path.join(ROOT, 'src', 'lib', 'safeWorkbook.ts'),
    'utf8',
  )
  const imports = helper.match(/^import .*$/gm) ?? []
  assert.deepEqual(imports, [
    "import type * as XLSX from 'xlsx'",
    "import type { TranslationKey } from '@/i18n/translations'",
  ])
  const code = helper
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\/\*|\*)/.test(line))
    .join('\n')
  assert.doesNotMatch(code, /import\s*\(|require\s*\(/)
})

test('every importer error path maps the unsafe error', () => {
  const catchers = [
    'src/screens/MovementImport.tsx',
    'src/components/DriverExcelImport.tsx',
    'src/components/EquipmentExcelUpdate.tsx',
    'src/screens/companies/CompanyImportDialog.tsx',
    'src/screens/projects/ProjectImportDialog.tsx',
    'src/screens/equipment/EquipmentImportDialog.tsx',
    'src/screens/AdminSettings.tsx',
  ]
  for (const file of catchers) {
    const source = fs.readFileSync(path.join(ROOT, file), 'utf8')
    assert.match(source, /workbookReadErrorKey\(error, '/, file)
  }
})
