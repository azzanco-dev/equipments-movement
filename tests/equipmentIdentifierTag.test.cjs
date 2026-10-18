// Owner request 2026-10-18: the admin log and visits tables show the plate
// number (or, without one, the chassis number) as a small muted tag beside the
// equipment code. No table column is added; the supplier line below the code
// (0132) is untouched.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const vm = require('node:vm')

const ROOT = path.join(__dirname, '..')
const read = (...parts) =>
  fs.readFileSync(path.join(ROOT, ...parts), 'utf8').replace(/\r\n/g, '\n')

function loadPure(file) {
  const code = ts.transpileModule(read(file), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  const exports = {}
  vm.runInNewContext(code, { exports, require: () => ({}) }, { filename: file })
  return exports
}

test('the identifier is the plate, else the chassis, else nothing', () => {
  const { equipmentIdentifier } = loadPure('src/lib/equipmentIdentifier.ts')
  assert.equal(
    equipmentIdentifier({ equipment_plate_number: ' ا ب ج 1234 ', equipment_chassis_number: 'X1' }),
    'ا ب ج 1234',
  )
  assert.equal(
    equipmentIdentifier({ equipment_plate_number: '', equipment_chassis_number: ' WDB9634031L8 ' }),
    'WDB9634031L8',
  )
  assert.equal(equipmentIdentifier({ equipment_plate_number: null }), null)
  assert.equal(equipmentIdentifier({}), null)
})

test('the tag is muted, small, direction-isolated, and rendered beside the code in both tables', () => {
  const tag = read('src/components/data-list/EquipmentIdentifierTag.tsx')
  assert.match(tag, /const value = equipmentIdentifier\(row\)\s+if \(!value\) return null/)
  assert.match(tag, /<bdi className="text-xs font-normal text-muted"/)

  for (const [file, rowName] of [
    ['src/screens/admin-home/LogsScreen.tsx', 'row'],
    ['src/components/visits/VisitsTable.tsx', 'visit'],
  ]) {
    const source = read(file)
    assert.match(source, /import \{ EquipmentIdentifierTag \} from '@\/components\/data-list\/EquipmentIdentifierTag'/)
    const cell = source.slice(source.indexOf("key: 'equipment_code'"))
    const code = cell.indexOf(`{${rowName}.equipment_code`)
    const tagAt = cell.indexOf(`<EquipmentIdentifierTag row={${rowName}} />`)
    assert.ok(code > 0 && tagAt > code && tagAt - code < 200, `${file}: tag right after the code`)
    // Same line as the code (one flex row), not a new table column.
    assert.match(cell.slice(0, tagAt), /flex flex-wrap items-baseline gap-x-1\.5/)
  }
})

test('both views select the plate; the log also selects the chassis', () => {
  const visits = read('src/lib/visitsList.ts')
  assert.match(visits, /equipment_plate_number/)
  const log = read('src/lib/movementLogSearch.ts')
  assert.match(log, /MOVEMENT_LOG_ADMIN_SELECT = `[^`]*equipment_plate_number,equipment_chassis_number/)
  assert.match(log, /MOVEMENT_LOG_WORKSHOP_SELECT = `[^`]*equipment_plate_number,equipment_chassis_number/)
})
