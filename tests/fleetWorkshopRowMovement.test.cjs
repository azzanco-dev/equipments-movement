const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

// Owner 2026-10-29: «جدول داخل الورشة لما اضغط على المعدة مفروض يوديني على
// الحركة». A «داخل الورشة» row opens the unit's open workshop entry (its
// latest movement); the other fleet tables keep opening the equipment.

const read = (...parts) =>
  fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8')

test('the workshop table opens the movement, the others the equipment', () => {
  const source = read('src', 'components', 'admin-home', 'FleetMiniTables.tsx')
  assert.match(
    source,
    /if \(onSelectMovement && row\.lastMovementId\)\s*onSelectMovement\(row\.lastMovementId\)\s*else openEquipment\?\.\(row\)/,
  )
  const workshop = source.slice(
    source.indexOf('table="workshop"'),
    source.indexOf('table="available"'),
  )
  assert.match(workshop, /onRowClick=\{openWorkshopRow\}/)
  assert.equal(source.match(/onRowClick=\{openEquipment\}/g).length, 2)
})

test('the movement opener reaches the table from App', () => {
  assert.match(
    read('src', 'App.tsx'),
    /<AdminHomeScreen\s+onSelectMovement=\{openMovement\}/,
  )
  assert.match(
    read('src', 'screens', 'admin-home', 'AdminHomeScreen.tsx'),
    /onSelectMovement=\{onSelectMovement\}/,
  )
  assert.match(
    read('src', 'components', 'admin-home', 'FleetStateSection.tsx'),
    /onSelectMovement=\{onSelectMovement\}/,
  )
})
