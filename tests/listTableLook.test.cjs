const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

// Owner 2026-10-29: «ستايل الجدول في الدخوليات واوامر الشراء … ابغاها تكون
// معتمدة في باقي الجداول: المعدات، المشاريع، الشركات، الموردون، السائقون».
// 13 px rows with 8 px above and below, the secondary fact as a muted line
// under the identity, small status badges; the row icons stay.

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8')

const TABLES = [
  'src/screens/admin-home/LogsScreen.tsx',
  'src/screens/purchasing/SupplierPosListScreen.tsx',
  'src/screens/equipment/EquipmentTable.tsx',
  'src/screens/projects/ProjectsTable.tsx',
  'src/screens/companies/CompaniesTable.tsx',
  'src/screens/lessors/LessorsTable.tsx',
  'src/screens/drivers/DriversTable.tsx',
]

test('every main list table has the log / PO list row look', () => {
  for (const file of TABLES) {
    const source = read(file)
    assert.match(source, /cellTextClassName="text-\[13px\]"/, file)
    assert.match(source, /cellClassName="py-2"/, file)
  }
})

test('the secondary facts are muted lines under the identity', () => {
  const equipment = read('src/screens/equipment/EquipmentTable.tsx')
  assert.doesNotMatch(equipment, /key: 'type',/)
  assert.match(
    equipment,
    /<span className="text-xs text-muted">\{row\.type\}<\/span>/,
  )
  assert.match(
    equipment,
    /<EquipmentStateBadge\s+state=\{row\.equipment_state\}\s+assetStatus=\{row\.status\}\s+size="sm"\s*\/>/,
  )
  assert.doesNotMatch(equipment, /` - \$\{row\.lessor\.name\}`/)

  const drivers = read('src/screens/drivers/DriversTable.tsx')
  assert.doesNotMatch(drivers, /key: 'name_en',/)
  assert.match(drivers, /\{row\.name_en\}/)

  const lessors = read('src/screens/lessors/LessorsTable.tsx')
  assert.doesNotMatch(lessors, /key: 'contact_person',/)
  assert.match(lessors, /\{row\.contact_person\}/)

  // The row actions stay icon buttons (owner: «الازرار تبقى ايقونات»).
  for (const file of TABLES.slice(2))
    assert.match(read(file), /<IconButton/, file)
})
