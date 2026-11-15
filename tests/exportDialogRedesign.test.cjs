const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const root = path.join(__dirname, '..')
const read = (...parts) =>
  fs.readFileSync(path.join(root, ...parts), 'utf8')

const dialog = read('src', 'components', 'data-list', 'ExportDialog.tsx')
const cards = read('src', 'components', 'data-list', 'ExportFileTypeCards.tsx')
const translations = read('src', 'i18n', 'translations.ts')

test('the file type is two radio cards on the Radix radio group, no CSV', () => {
  assert.match(cards, /from 'radix-ui'/)
  assert.match(cards, /RadixRadioGroup\.Item/)
  assert.match(cards, /data-\[state=checked\]:border-\[1\.5px\]/)
  assert.match(cards, /group-data-\[state=checked\]:bg-success-soft/)
  assert.match(dialog, /<RadioCardGroup/)
  assert.equal((dialog.match(/<RadioCard\b/g) ?? []).length, 2)
  assert.match(dialog, /value="xlsx"/)
  assert.match(dialog, /value="pdf"/)
  assert.match(dialog, /FileSpreadsheet/)
  assert.match(dialog, /FileText/)
  assert.doesNotMatch(dialog + cards, /csv/i)
  assert.doesNotMatch(dialog, /RadioGroupItem/)
})

test('the scope is one switch mapped to current / all', () => {
  assert.match(dialog, /<Switch\b/)
  assert.match(dialog, /checked=\{scope === 'current'\}/)
  assert.match(
    dialog,
    /setScope\(checked \? 'current' : 'all'\)/,
  )
  assert.match(dialog, /t\('exportScopeCurrent'\)/)
  assert.match(dialog, /exportSummaryNoSearch/)
})

test('the columns header counts the selection and has two buttons only', () => {
  assert.match(dialog, /t\('exportColumnsCount'\)/)
  assert.match(dialog, /t\('exportSelectAll'\)/)
  assert.match(dialog, /t\('exportBasicOnly'\)/)
  assert.doesNotMatch(dialog, /exportClearAll/)
  assert.doesNotMatch(translations, /exportClearAll/)
  assert.match(dialog, /rounded-lg bg-surface-hover/)
  assert.match(dialog, /grid grid-cols-2 gap-x-3 sm:grid-cols-3/)
})

test('the footer has the count line and the download button', () => {
  assert.match(dialog, /justify-between/)
  assert.match(dialog, /<List\b/)
  assert.match(dialog, /t\('exportFooterCount'\)/)
  assert.match(dialog, /<Download\b/)
  assert.match(dialog, /exportSubmitExcel/)
  assert.match(dialog, /exportSubmitPdf/)
  assert.match(dialog, /t\('exportContextCount'\)/)
  assert.match(dialog, /toLocaleString\('en-US'\)/)
})

test('the new keys exist in both languages and the Arabic has no hamza alif', () => {
  const keys = [
    'exportFileExcelHint',
    'exportFilePdfHint',
    'exportColumnsCount',
    'exportContextCount',
    'exportFooterCount',
    'exportSubmitExcel',
    'exportSubmitPdf',
    'exportSummaryNoSearch',
  ]
  for (const key of keys)
    assert.equal(
      (translations.match(new RegExp(`^\\s+${key}:`, 'gm')) ?? []).length,
      2,
      key,
    )
  const blocks = translations.match(
    /\/\/ wave-15-export — start[\s\S]*?\/\/ wave-15-export — end/g,
  )
  const arabic = blocks.find((block) => /[؀-ۿ]/.test(block))
  assert.ok(!/[أإآ]/.test(arabic))
  assert.match(arabic, /exportScopeCurrent: 'حسب البحث والفلاتر الحالية'/)
  assert.match(arabic, /exportSubmitExcel: 'تصدير Excel'/)
  assert.match(arabic, /exportColumnsCount: '\{selected\} من \{total\} محددة'/)
})

test('the behaviour of the export is untouched', () => {
  assert.match(dialog, /window\.open\('', '_blank'\)/)
  assert.match(dialog, /readColumnSelection\(localStore\(\), listId, fileType, columns\)/)
  assert.match(dialog, /onExported\?\.\(/)
  assert.match(dialog, /isMandatoryColumn\(column\)/)
})
