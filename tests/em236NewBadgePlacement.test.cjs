// EM-236, owner decision 2026-10-14: the small «جديدة» badge (created within
// the last 7 days, migration 0129) sits right next to the EQUIPMENT CODE
// wherever the code is shown, through the one shared `EquipmentNewBadge`,
// and is no longer part of the state badge («متاحة …»). Source checks only,
// like the rest of the suite: no database and no DOM are reached.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..')
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8')

const BADGE = 'src/components/equipment/EquipmentNewBadge.tsx'
const STATE_BADGE = 'src/components/equipment/EquipmentStateBadge.tsx'
const IMPORT =
  /import \{ EquipmentNewBadge \} from '@\/components\/equipment\/EquipmentNewBadge'/

/** The files that show an equipment code, with the code expression the
 *  badge must follow in the same JSX span. */
const PLACEMENTS = {
  'src/screens/equipment/EquipmentTable.tsx': [
    // 2026-10-29: the code is bold in its own span (the type sits under it).
    /<span dir="ltr" className="font-semibold">\s*\{row\.code\}\s*<\/span>\s*<EquipmentNewBadge isNew=\{row\.equipment_is_new\} \/>/,
  ],
  'src/screens/EquipmentDetail.tsx': [
    // The detail header: first in the `badges` slot, right after the code.
    /identifier=\{equipment\.code\}\s+identifierLtr\s+subtitle=\{equipment\.type\}\s+badges=\{\s*<>\s*(\{\/\*[\s\S]*?\*\/\}\s*)?<EquipmentNewBadge isNew=\{equipment\.equipment_is_new\} \/>/,
  ],
  'src/screens/inquiry/EquipmentInquiryScreen.tsx': [
    /<LtrValue>\{equipment\.code\}<\/LtrValue>\s*<EquipmentNewBadge isNew=\{isEquipmentNew\(equipment\.created_at\)\} \/>/,
  ],
  'src/components/admin-home/FleetMiniTables.tsx': [
    // The shared `codeColumn` of the three fleet tables (card and expanded).
    /const codeColumn: DataTableColumn<FleetEquipmentRow> = \{\s*key: 'code',\s*header: t\('adminHomeColEquipment'\),\s*cell: \(row\) => \(\s*<span className="inline-flex flex-wrap items-center gap-1">\s*<span className="font-semibold">\{row\.code\}<\/span>\s*<EquipmentNewBadge isNew=\{row\.isNew\} \/>/,
    // The «المتاحة» card keeps the exit purpose after the mark.
    /<span className="font-semibold">\{row\.code\}<\/span>\s*<EquipmentNewBadge isNew=\{row\.isNew\} \/>\s*<ExitPurposeBadge purpose=\{row\.exitPurpose\} \/>/,
  ],
}

test('the shared badge is small, tokened, and reuses the existing key', () => {
  const source = read(BADGE)
  assert.match(source, /export function EquipmentNewBadge\(/)
  assert.match(source, /if \(!isNew\) return null/)
  assert.match(source, /<Badge tone="info" size="sm" className=\{className\}>/)
  assert.match(source, /\{t\('equipmentStateNew'\)\}/)
  // The shared Badge only: no palette classes, no hex, no hardcoded label.
  assert.match(source, /from '@\/components\/ui\/Badge'/)
  assert.ok(
    !/(gray|emerald|blue|sky|amber|red|green)-\d{2,3}|#[0-9a-fA-F]{3,6}\b/.test(
      source,
    ),
  )
  assert.ok(!/'جديدة'/.test(source))
  // Arabic in comments: plain alif only.
  assert.ok(!/[أإآ]/.test(source))
  // Left/right utilities are not used; spacing is logical or a gap.
  assert.ok(!/\b(ml|mr|pl|pr)-\d/.test(source))
})

test('every code placement renders the shared badge next to the code', () => {
  for (const [file, patterns] of Object.entries(PLACEMENTS)) {
    const source = read(file)
    assert.match(source, IMPORT, `${file} imports EquipmentNewBadge`)
    for (const pattern of patterns)
      assert.match(source, pattern, `${file}: ${pattern}`)
    // No second, local rendering of the label in the same file.
    assert.ok(
      !/<Badge[^>]*>\s*\{t\('equipmentStateNew'\)\}/.test(source),
      `${file} has no ad hoc «جديدة» badge`,
    )
  }
})

test('the state badge no longer renders «جديدة»', () => {
  const source = read(STATE_BADGE)
  assert.ok(!/isNew/.test(source), 'no isNew prop')
  assert.match(source, /equipmentStateText\(t, parsed\)/)
  assert.ok(!/equipmentStateNew/.test(source))
  // And no caller passes the retired prop any more.
  for (const file of [
    'src/screens/equipment/EquipmentTable.tsx',
    'src/screens/EquipmentDetail.tsx',
    'src/screens/inquiry/EquipmentInquiryScreen.tsx',
  ]) {
    const callers = read(file).match(/<EquipmentStateBadge[\s\S]*?\/>/g) ?? []
    assert.ok(callers.length >= 1, `${file} renders the state badge`)
    for (const call of callers)
      assert.ok(!/isNew/.test(call), `${file}: ${call}`)
  }
})

test('the fleet tables share one code column and have no local badge', () => {
  const source = read('src/components/admin-home/FleetMiniTables.tsx')
  assert.ok(!/const newBadge\b/.test(source))
  assert.ok(!/availableExpandedCodeColumn/.test(source))
  // The expanded «المتاحة» table reuses the shared column.
  assert.match(
    source,
    /table="available"[\s\S]*?expandedColumns=\{\[\s*sortable\(codeColumn\),/,
  )
  // The inside-sites and workshop tables build on the same column.
  assert.match(source, /const insideColumns = \[codeColumn,/)
  assert.match(source, /const workshopColumns = \[\s*codeColumn,/)
})

test('the inquiry no longer carries isNew in its state object', () => {
  const source = read('src/screens/inquiry/EquipmentInquiryScreen.tsx')
  assert.match(
    source,
    /type InquiryState = \{ state: EquipmentState \} \| 'error' \| null/,
  )
  assert.ok(!/isNew: isEquipmentNew/.test(source))
  assert.match(
    source,
    /import \{ LtrValue \} from '@\/components\/ui\/InfoGrid'/,
  )
})
